// ── Commandes groupées : dépôt d'un fichier à analyser par l'IA ─────────
// POST { action: "upload", kind: "offre" | "lgo", op_id, file_name, mime, text | data_base64 }
// POST { action: "status", job }
// « offre » = admin uniquement ; « lgo » = admin ou pharmacie participante.
// L'analyse tourne dans gp-extract-background (jusqu'à 15 min) ; l'écran interroge le statut.
import crypto from "node:crypto";
import { getCors } from "./cors.js";
import { verifyTokenAsync } from "./auth.js";
import { json, sb, identifyPharmacy } from "./_gp.js";
import { rateLimit } from "./rate-limit.js";

const MAX_B64 = 5_500_000;       // ≈ 4 Mo de fichier (limite Netlify : 6 Mo par requête)
const MAX_TEXT = 1_500_000;
const MIMES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/csv", "text/plain"];

const kvSet = (key, value) => sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates", body: { key, value } });

async function whoIs(event, b) {
  const tok = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  if (tok) {
    const u = await verifyTokenAsync(tok);
    if (u?.isAdmin) return { admin: true, owner: "admin" };
  }
  const ph = await identifyPharmacy(event, b.cip, b.email);
  return ph ? { admin: false, owner: ph.cip, pharmacy: ph } : null;
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
  try {
    const b = JSON.parse(event.body || "{}");
    const who = await whoIs(event, b);
    if (!who) return json(cors, 403, { error: "Non autorisé" });

    if (b.action === "status") {
      const [row] = await sb(`kv_store?key=eq.${encodeURIComponent("gp_import:" + b.job)}&select=value`);
      if (!row || (row.value.owner !== who.owner && !who.admin)) return json(cors, 404, { error: "Analyse introuvable" });
      return json(cors, 200, row.value);
    }
    if (b.action !== "upload") return json(cors, 400, { error: "Action inconnue" });

    const limited = rateLimit(event, 10, 60);
    if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
    const kind = b.kind === "lgo" ? "lgo" : "offre";
    if (kind === "offre" && !who.admin) return json(cors, 403, { error: "Accès admin requis" });
    if (!b.text && !b.data_base64) return json(cors, 400, { error: "Fichier vide" });
    if (b.data_base64 && (b.data_base64.length > MAX_B64 || !MIMES.includes(b.mime))) return json(cors, 400, { error: "Fichier trop lourd (4 Mo max) ou format non pris en charge (PDF, image, Excel, CSV)" });
    if (b.text && b.text.length > MAX_TEXT) return json(cors, 400, { error: "Fichier trop volumineux" });

    // pour un bon LGO : la liste des produits de l'opération sert à la correspondance
    let lines = [];
    if (kind === "lgo") {
      if (!b.op_id) return json(cors, 400, { error: "Opération manquante" });
      if (!who.admin) {
        const [part] = await sb(`gp_participants?operation_id=eq.${encodeURIComponent(b.op_id)}&pharmacy_cip=eq.${encodeURIComponent(who.owner)}&limit=1`);
        if (!part) return json(cors, 403, { error: "Vous ne participez pas à cette opération" });
      }
      lines = await sb(`gp_lines?operation_id=eq.${encodeURIComponent(b.op_id)}&select=id,cip,name&order=position.asc`);
    }

    const job = crypto.randomUUID();
    await kvSet(`gp_file:${job}`, { kind, file_name: String(b.file_name || "fichier").slice(0, 200), mime: b.mime || "text/plain",
      text: b.text || null, data_base64: b.data_base64 || null, lines });
    await kvSet(`gp_import:${job}`, { status: "en_cours", kind, owner: who.owner, op_id: b.op_id || null, file_name: b.file_name || null, created_at: new Date().toISOString() });

    const base = `https://${event.headers?.host || "commandes-elixir.netlify.app"}`;
    const r = await fetch(`${base}/.netlify/functions/gp-extract-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET || "" }, body: JSON.stringify({ job }),
    });
    if (!r.ok && r.status !== 202) {
      await kvSet(`gp_import:${job}`, { status: "erreur", kind, owner: who.owner, error: `Lancement de l'analyse impossible (HTTP ${r.status})` });
      return json(cors, 500, { error: `Lancement de l'analyse impossible (HTTP ${r.status})` });
    }
    return json(cors, 200, { job });
  } catch (e) {
    console.error("gp-upload", e);
    return json(cors, 500, { error: e.message || String(e) });
  }
};
