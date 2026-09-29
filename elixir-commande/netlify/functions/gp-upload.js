// ── Commandes groupées : dépôt d'un fichier à analyser par l'IA ─────────
// POST { action: "upload", kind: "offre" | "lgo", op_id, file_name, mime, text | data_base64 }
// POST { action: "status", job }
// « offre » = admin uniquement ; « lgo » = admin, ou pharmacie ayant accès au module,
// inscrite à l'opération, opération « ouverte » et dans ses dates.
// L'analyse tourne dans gp-extract-background (15 min max) ; l'écran interroge le statut.
//
// Quotas comptés en base (kv_store, clés gp_import:<job>) avant toute écriture :
//  - 1 analyse « en_cours » à la fois par propriétaire (pharmacie ou « admin ») ;
//  - 10 analyses par 24 h glissantes par pharmacie, 60 pour l'admin.
// Filtres PostgREST sur le JSON : value->>champ compare en texte ; created_at est
// toujours un toISOString() (24 caractères, UTC), donc ordre du texte = ordre du temps.
import crypto from "node:crypto";
import { getCors } from "./cors.js";
import { verifyTokenAsync } from "./auth.js";
import { json, sb, identifyPharmacy, today } from "./_gp.js";
import { rateLimit } from "./rate-limit.js";

const MAX_TEXT = { lgo: 200_000, offre: 1_500_000 };
const MAX_B64 = {                         // l'API refuse une image de plus de 5 Mo
  "application/pdf": 5_500_000,           // ≈ 4 Mo de PDF (Netlify : 6 Mo par requête)
  "image/png": 4_800_000, "image/jpeg": 4_800_000, "image/webp": 4_800_000,
};
const TEXT_MIMES = ["text/csv", "text/plain"];
const STALE_MS = 16 * 60 * 1000;          // au-delà, une analyse « en_cours » est morte (Netlify coupe à 15 min)
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_QUOTA = { pharmacy: 10, admin: 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const INTERRUPTED = "Analyse interrompue (délai dépassé)";

const enc = encodeURIComponent;
const kvSet = (key, value) => sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates", body: { key, value } });
const kvGet = async (key) => (await sb(`kv_store?key=eq.${enc(key)}&select=value&limit=1`))?.[0]?.value || null;
const kvDel = (key) => sb(`kv_store?key=eq.${enc(key)}`, { method: "DELETE" });
const frDate = (d) => String(d).slice(0, 10).split("-").reverse().join("/");

// Analyses d'un propriétaire créées après sinceIso (option : d'un statut donné)
async function importsOf(owner, sinceIso, status) {
  let q = `kv_store?key=like.gp_import:*&value->>owner=eq.${enc(owner)}&value->>created_at=gt.${enc(sinceIso)}`;
  if (status) q += `&value->>status=eq.${enc(status)}`;
  return (await sb(`${q}&select=key,updated_at,value->>created_at&limit=200`)) || [];
}

async function whoIs(event, b) {
  const tok = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  if (tok) {
    const u = await verifyTokenAsync(tok).catch(() => null);
    if (u?.isAdmin) return { admin: true, owner: "admin" };
  }
  const ph = await identifyPharmacy(event, b.cip, b.email);
  return ph?.id ? { admin: false, owner: String(ph.id), pharmacy: ph } : null;
}

// Contrôle du fichier reçu → { text | data_base64, mime } ou { error, status }
function checkPayload(b, kind) {
  const hasText = typeof b.text === "string" && b.text.trim().length > 0;
  const hasB64 = typeof b.data_base64 === "string" && b.data_base64.length > 0;
  if (hasText === hasB64) return { status: 400, error: "Fichier vide ou illisible" };
  if (hasText) {
    if (b.text.length > MAX_TEXT[kind]) {
      return { status: 413, error: `Fichier trop volumineux : ${b.text.length.toLocaleString("fr-FR")} caractères, ${MAX_TEXT[kind].toLocaleString("fr-FR")} au maximum pour ${kind === "lgo" ? "un bon de commande" : "une offre"}. Supprimez les feuilles ou colonnes inutiles.` };
    }
    return { text: b.text, mime: TEXT_MIMES.includes(b.mime) ? b.mime : "text/plain" };
  }
  const max = Object.hasOwn(MAX_B64, String(b.mime)) ? MAX_B64[b.mime] : 0;
  if (!max) return { status: 400, error: "Format non pris en charge : PDF, Excel, CSV ou image (PNG, JPEG, WebP)" };
  if (b.data_base64.length > max) {
    return { status: 413, error: b.mime === "application/pdf" ? "PDF trop lourd (4 Mo maximum) : envoyez seulement les pages utiles" : "Image trop lourde (5 Mo maximum) : réduisez-la ou recadrez-la" };
  }
  if (b.data_base64.length % 4 !== 0 || !BASE64.test(b.data_base64)) return { status: 400, error: "Fichier mal encodé : réessayez" };
  return { data_base64: b.data_base64, mime: b.mime };
}

const SITE_HOSTS = ["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"];
const siteBase = (event) => { const h = String(event.headers?.host || "").toLowerCase(); return `https://${SITE_HOSTS.includes(h) || /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/.test(h) ? h : SITE_HOSTS[0]}`; };

// Lance la fonction d'arrière-plan ; renvoie null si elle est partie, sinon la raison de l'échec
async function launch(event, job) {
  const base = siteBase(event);
  try {
    const r = await fetch(`${base}/.netlify/functions/gp-extract-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
      body: JSON.stringify({ job }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok || r.status === 202 ? null : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "délai dépassé" : (e?.message || String(e));
  }
}

async function status(cors, who, b) {
  const job = String(b.job || "");
  const v = UUID.test(job) ? await kvGet(`gp_import:${job}`) : null;
  if (!v || (!who.admin && v.owner !== who.owner)) return json(cors, 404, { error: "Analyse introuvable" });
  if (v.status === "en_cours" && !(Date.parse(v.created_at) > Date.now() - STALE_MS)) {
    await kvSet(`gp_import:${job}`, { ...v, status: "erreur", error: INTERRUPTED, finished_at: new Date().toISOString() }).catch(e => console.error("gp-upload status", e));
    await kvDel(`gp_file:${job}`).catch(() => {});
    return json(cors, 200, { status: "erreur", error: INTERRUPTED });
  }
  return json(cors, 200, v);
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
  let b;
  try { b = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "Requête illisible" }); }
  try {
    const who = await whoIs(event, b);
    if (!who) return json(cors, 403, { error: "Non autorisé" });
    if (b.action === "status") return await status(cors, who, b);
    if (b.action !== "upload") return json(cors, 400, { error: "Action inconnue" });

    const limited = rateLimit(event, 10, 60);
    if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
    if (!process.env.CRON_SECRET) {
      console.error("gp-upload : CRON_SECRET absent, l'analyse ne peut pas être lancée");
      return json(cors, 503, { error: "Analyse indisponible : configuration du serveur incomplète" });
    }
    const kind = b.kind === "lgo" || b.kind === "offre" ? b.kind : null;
    if (!kind) return json(cors, 400, { error: "Type d'analyse inconnu" });
    if (kind === "offre" && !who.admin) return json(cors, 403, { error: "Accès admin requis" });
    const file = checkPayload(b, kind);
    if (file.error) return json(cors, file.status, { error: file.error });

    // Opération : obligatoire pour un bon LGO (sa liste de produits sert à la correspondance)
    const opId = b.op_id == null || b.op_id === "" ? null : String(b.op_id);
    if (opId && !UUID.test(opId)) return json(cors, 400, { error: "Opération inconnue" });
    let lines = [];
    let slots = [];
    if (kind === "lgo") {
      if (!opId) return json(cors, 400, { error: "Opération manquante" });
      const [ops, access, part] = await Promise.all([
        sb(`gp_operations?id=eq.${opId}&select=id,status,start_date,end_date,delivery_slots&limit=1`),
        who.admin ? null : sb(`gp_access?pharmacy_id=eq.${enc(who.owner)}&select=pharmacy_id&limit=1`),
        who.admin ? null : sb(`gp_participants?operation_id=eq.${opId}&pharmacy_id=eq.${enc(who.owner)}&select=operation_id&limit=1`),
      ]);
      const op = ops?.[0];
      if (!op) return json(cors, 404, { error: "Opération introuvable" });
      if (!who.admin) {
        if (!access?.length) return json(cors, 403, { error: "Votre pharmacie n'a pas accès aux commandes groupées" });
        if (!part?.length) return json(cors, 403, { error: "Vous ne participez pas à cette opération" });
        if (op.status !== "ouverte") return json(cors, 403, { error: "Cette opération n'est pas ouverte aux commandes" });
        const d = today();
        if (op.start_date && d < String(op.start_date).slice(0, 10)) return json(cors, 403, { error: `Les commandes de cette opération ouvrent le ${frDate(op.start_date)}` });
        if (op.end_date && d > String(op.end_date).slice(0, 10)) return json(cors, 403, { error: `Les commandes de cette opération sont closes depuis le ${frDate(op.end_date)}` });
      }
      lines = await sb(`gp_lines?operation_id=eq.${opId}&select=id,cip,name&order=position.asc,id.asc`) || [];
      slots = (op.delivery_slots || []).filter(s => s && s.id && s.date).map(s => ({ id: s.id, date: s.date, label: s.label || null }));
      if (!lines.length) return json(cors, 400, { error: "Cette opération ne contient encore aucun produit" });
    }

    // Quotas durables, comptés avant toute écriture
    const now = Date.now();
    const staleIso = new Date(now - STALE_MS).toISOString();
    const [running, lastDay] = await Promise.all([
      importsOf(who.owner, staleIso, "en_cours"),
      importsOf(who.owner, new Date(now - DAY_MS).toISOString()),
    ]);
    // analyses restées « en_cours » au-delà du délai (fonction coupée) : marquées en erreur, fichier supprimé
    const dead = (await sb(`kv_store?key=like.gp_import:*&value->>owner=eq.${enc(who.owner)}&value->>status=eq.en_cours&value->>created_at=lte.${enc(staleIso)}&select=key,value&limit=50`)) || [];
    for (const d of dead) {
      await kvSet(d.key, { ...d.value, status: "erreur", error: "Analyse interrompue (délai dépassé)", finished_at: new Date().toISOString() }).catch(() => {});
      await kvDel(d.key.replace("gp_import:", "gp_file:")).catch(() => {});
    }
    if (running.length) return json(cors, 429, { error: "Une analyse est déjà en cours : attendez qu'elle se termine (quelques minutes au plus)" });
    const quota = who.admin ? DAILY_QUOTA.admin : DAILY_QUOTA.pharmacy;
    if (lastDay.length >= quota) return json(cors, 429, { error: `Limite atteinte : ${quota} analyses par 24 heures. Réessayez plus tard ou saisissez les quantités à la main.` });

    const job = crypto.randomUUID();
    const importKey = `gp_import:${job}`, fileKey = `gp_file:${job}`;
    const fileName = String(b.file_name || "fichier").slice(0, 200);
    const record = { status: "en_cours", kind, owner: who.owner, op_id: opId, file_name: fileName, created_at: new Date(now).toISOString() };
    await kvSet(importKey, record);
    const fail = async (httpStatus, error) => {
      await kvDel(fileKey).catch(() => {});
      await kvSet(importKey, { ...record, status: "erreur", error, finished_at: new Date().toISOString() }).catch(e => console.error("gp-upload", e));
      return json(cors, httpStatus, { error });
    };

    // Deux dépôts simultanés passent tous deux le contrôle : seul le plus ancien continue,
    // l'autre efface sa trace (rien n'a été analysé, il ne compte pas dans le quota)
    const concurrent = (await importsOf(who.owner, staleIso, "en_cours"))
      .sort((x, y) => String(x.updated_at).localeCompare(String(y.updated_at)) || String(x.key).localeCompare(String(y.key)));
    if (concurrent.length > 1 && concurrent[0].key !== importKey) {
      await kvDel(importKey).catch(e => console.error("gp-upload", e));
      return json(cors, 429, { error: "Une analyse est déjà en cours : attendez qu'elle se termine (quelques minutes au plus)" });
    }

    await kvSet(fileKey, { kind, file_name: fileName, mime: file.mime, text: file.text || null, data_base64: file.data_base64 || null, lines, slots });
    const why = await launch(event, job);
    if (why) {
      console.error("gp-upload : lancement impossible", job, why);
      return fail(502, `Lancement de l'analyse impossible (${why}) : réessayez`);
    }
    return json(cors, 200, { job });
  } catch (e) {
    console.error("gp-upload", e);
    return json(cors, 500, { error: e.message || String(e) });
  }
};
