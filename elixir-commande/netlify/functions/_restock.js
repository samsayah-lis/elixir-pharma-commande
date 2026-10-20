// ── Alertes « M'avertir du retour » : retours en stock, e-mails aux pharmacies, tableau de bord de l'admin ──
// Demande de Zineb (20/10/2026, docs/alertes-retour.md). Le bouton « M'avertir du retour » de la Saisie de commande
// (src/components/OrderEntry.jsx → restock-alert.js) range une ligne dans restock_alerts (pharmacy_cip, cip,
// pharmacy_email, product_name, created_at, notified=false ; clé primaire pharmacy_cip + cip). Ce module :
//  • passage() — après chaque mise à jour du stock (run-sync.mjs → restock-notify) et toutes les 3 h
//    (restock-notify-cron) : produits revenus en stock (règle de la Saisie : en stock et prix net > 0 ; article sous
//    plusieurs CIP : le groupe, comme la Saisie) attendus par une pharmacie → UN e-mail par adresse (celle de la demande,
//    encore compte de ce CIP dans elixir_pharmacies), plusieurs produits regroupés, puis demande marquée avertie.
//    Envois entre 7 h et 21 h, heure de Paris (« Envoyer maintenant » de l'admin : à toute heure) ;
//  • apercu() — admin : produits les plus attendus, prêts à partir, demandes traitées, envois à vérifier, journal ;
//  • marquerRetours() — restock-alert (GET d'une pharmacie) : mention « De retour en stock » de la Saisie.
// Mise en service : les envois AUTOMATIQUES (passages « planifie » et « synchro ») sont suspendus tant que l'admin ne
// les a pas activés (kv restock_notify:reglages) ; suspendus, les passages ne font que les clôtures. Les demandes déjà
// vieilles de plus de 60 jours à la mise en service (première activation) sont closes sans e-mail ; ensuite, une demande
// reste valable jusqu'au retour du produit (le bouton promet un e-mail « à son retour en stock »).
// Jamais deux e-mails pour une même demande : réservation par PATCH conditionnel (notified=eq.false → true) AVANT
// l'envoi, compte rendu après. Réponse de Resend (envoyerResend, délai de 4 s, clé d'idempotence) :
//  • refus propre à la demande (400/422) → réservation rendue, essai compté, clôture « echec » au 3e ;
//  • panne générale (401, 403, quota, configuration) → réservation rendue SANS compter, passage arrêté ;
//  • limite de débit (429 rate_limit_exceeded) → rendue sans compter, reprise à l'appel suivant ;
//  • issue incertaine (pas de réponse, délai dépassé, 5xx, 409) → JAMAIS renvoyée d'office : « interrompu » (à vérifier
//    dans Resend, bouton « Relancer » de l'admin) ; la clé d'idempotence évite tout doublon côté Resend pendant 24 h.
// Plafonds : un e-mail par adresse sur 24 h (les demandes suivantes attendent), 150 e-mails par jour au total.
// Base : colonnes attempts, outcome et notified_at (sql/restock-notify.sql). Sans elles (« mode réduit »), tout
// fonctionne : réservation sur notified seul, essais comptés dans kv_store, issues lues dans le journal ; un envoi
// incertain reste réservé (pas de « Relancer » possible). Aucune adresse e-mail dans le journal ni les réponses, sauf
// celle des envois à vérifier, montrée à l'admin seul (apercu, derrière verifyAdmin) pour la recherche dans Resend.
import { createHash } from "node:crypto";
import { ADMIN_MAIL } from "./_gp-mail.js";
import { kvGet, kvSet, kvParse, kvDeleteOlder } from "./_kv.js";
import { ALL_GROUP_CODES, ALL_FALLBACK_CIPS, allocate, totalStock } from "../../src/wheelchair-logic.js";

export const AGE_MAX_JOURS = 60;        // à la mise en service : demandes de plus de 60 jours closes sans e-mail
export const RECENT_JOURS = 14;         // « De retour en stock » dans la Saisie pendant 14 jours après l'avertissement
export const ESSAIS_MAX = 3;            // refus propres à la demande avant clôture « echec »
export const HISTORIQUE_JOURS = 30;     // admin : demandes traitées
const JOURNAL_JOURS = 60;               // journal des passages (kv_store) gardé 60 jours
export const FENETRE = { de: 7, a: 21 };   // heures d'envoi, heure de Paris (passages automatiques)
export const SITE_PHARMACIES = "https://elixir-commande.expepharma.com";   // adresse des pharmacies (liens ?cip= du catalogue)
export const ESPACEMENT_MS = 600;       // Resend : 2 envois par seconde au plus
export const DELAI_RESEND_MS = 4000;    // réponse de Resend attendue 4 s au plus (puis : issue incertaine)
export const COUT_ENVOI_MS = DELAI_RESEND_MS + 1500;   // un groupe au pire : réservation, pause, envoi, compte rendu, plafonds
const COUT_REQUETE_MS = 1000;           // une écriture Supabase, avec marge
export const RECLAMATION_PERIMEE_MS = 15 * 60e3;
export const PLAFOND_JOUR = 150;        // e-mails par jour (heure de Paris), toutes sources confondues
export const ADRESSE_HEURES = 24;       // au plus un e-mail par adresse sur 24 h
const AVANCE_MAX_MS = 5 * 60e3;         // demande datée de plus de 5 min dans le futur : écartée (jamais vraie)
export const CLE_DERNIER = "restock_notify:dernier";
export const CLE_REGLAGES = "restock_notify:reglages";   // { actif, mise_en_service, maj }
export const CLE_GROUPES = "restock_notify:groupes";     // { at, groupes: { code fournisseur: [CIP…] } }
export const PREFIXE_PASSAGE = "restock_notify:passage:";
export const PREFIXE_DEST = "restock_notify:dest:";      // + empreinte de l'adresse → { at } (jamais l'adresse)
export const PREFIXE_JOUR = "restock_notify:jour:";      // + AAAA-MM-JJ (Paris) → { n }
const PREFIXE_ESSAIS = "restock_notify:essais:";
const JOUR = 86400e3;
const COLONNES_SUIVI = ["attempts", "outcome", "notified_at"];
const FROM_DEFAUT = "Elixir Pharma <pharmacien@elixirpharma.fr>";   // même expéditeur que _gp-mail.js

// ── Supabase (PostgREST), clé du site (SUPABASE_KEY) lue à l'appel ──
async function sb(chemin, { method = "GET", body, prefer, range } = {}) {
  const cle = process.env.SUPABASE_KEY;
  const headers = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  if (range) headers.Range = range;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${chemin}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data, text };
}
const enc = encodeURIComponent;
const trim = (v) => String(v ?? "").trim();
const guillemets = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const dans = (col, vals) => `${col}=in.${enc(`(${vals.map(guillemets).join(",")})`)}`;
const egal = (col, v) => `${col}=eq.${enc(v)}`;
const lots = (liste, n) => { const out = []; for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n)); return out; };
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
export const colonneManquante = (t) => /PGRST204|42703|schema cache|does not exist/i.test(String(t || ""));
// motif d'erreur montrable (journal, admin, journaux GitHub) : jamais d'adresse e-mail
export const sansAdresse = (t) => String(t ?? "").replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "‹adresse›").slice(0, 240);
// plafond par adresse : empreinte (sha256) de l'adresse en minuscules, jamais l'adresse elle-même
export const empreinteAdresse = (email) => sha(trim(email).toLowerCase()).slice(0, 32);
const jourParis = (ms) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// ── Règle de la Saisie de commande (OrderEntry : prix remisé s'il y a remise, sinon prix catalogue) ──
export function prixNet(p) {
  if (!p) return null;
  const remise = !!p.discounted_price && Number(p.discount_pct) > 0;
  const v = Number(remise ? p.discounted_price : p.list_price);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}
export const enStock = (p) => !!p && p.in_stock === true && prixNet(p) != null;

// Articles vendus sous plusieurs CIP (même code fournisseur, src/product-groups.js) : la Saisie n'en montre qu'une ligne,
// en stock dès qu'un des CIP l'est, au nom, au CIP et au prix de la référence servie en premier (FIFO). Même règle ici.
// idx : CIP → { code, cips } (indexGroupes) ; → { connu, p (ligne du catalogue à annoncer), cip (CIP montré), en_stock, pret }
export const indexGroupes = (groupes) => {
  const out = new Map();
  for (const [code, cips] of Object.entries(groupes || {})) {
    if (!Array.isArray(cips) || cips.length < 2) continue;
    const liste = cips.map(trim).filter(Boolean);
    for (const c of liste) out.set(c, { code, cips: liste });
  }
  return out;
};
const cipsALire = (cips, idx) => [...new Set(cips.flatMap(c => idx.get(trim(c))?.cips || [trim(c)]))].filter(Boolean);
export function etatProduit(cip, cat, idx = new Map()) {
  const k = trim(cip);
  const g = idx.get(k);
  if (!g) { const p = cat[k] || null; return { connu: !!p, p, cip: k, en_stock: p?.in_stock === true, pret: enStock(p) }; }
  const refs = g.cips.map(c => cat[c]).filter(Boolean);
  if (!refs.length) return { connu: false, p: null, cip: k, en_stock: false, pret: false };
  const tete = allocate(refs, 1).lines[0]?.ref || refs[0];
  const en_stock = totalStock(refs) > 0;
  return { connu: true, p: tete, cip: trim(tete.cip), en_stock, pret: en_stock && prixNet(tete) != null, groupe: g.code };
}

const heureParis = (ms) => Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" })
  .formatToParts(new Date(ms)).find(x => x.type === "hour")?.value);
export const dansFenetre = (ms) => { const h = heureParis(ms); return h >= FENETRE.de && h < FENETRE.a; };
// Prochain passage planifié (netlify.toml « 50 */3 * * * », heure UTC) qui tombe dans la fenêtre d'envoi
export function prochainPassage(maintenant = Date.now()) {
  const h = new Date(maintenant); h.setUTCMinutes(50, 0, 0);
  for (let i = -1; i < 72; i++) {
    const t = h.getTime() + i * 3600e3;
    if (t > maintenant && new Date(t).getUTCHours() % 3 === 0 && dansFenetre(t)) return new Date(t).toISOString();
  }
  return null;
}

// Demande avertie récemment et pas close pour ancienneté : « De retour en stock » dans la Saisie (si le produit l'est).
// Mode réduit (sans colonne outcome) : close pour ancienneté = avertie plus de 60 jours après la demande (une demande
// avertie par e-mail après plus de 60 jours d'attente n'aura alors pas la mention ; l'e-mail, lui, part).
export function retourRecent(r, maintenant = Date.now()) {
  if (r?.notified !== true || r.outcome === "ancienne") return false;
  const cree = Date.parse(r.created_at), avise = Date.parse(r.notified_at);
  if (Number.isFinite(avise)) return maintenant - avise <= RECENT_JOURS * JOUR && (r.outcome != null || !Number.isFinite(cree) || avise - cree <= AGE_MAX_JOURS * JOUR);
  return Number.isFinite(cree) && maintenant - cree <= AGE_MAX_JOURS * JOUR;   // sans notified_at : la demande elle-même
}

// ── Réglages (kv_store) : envois automatiques actifs ou suspendus, date de mise en service ──
export async function lireReglages() {
  const v = await kvGet(CLE_REGLAGES);   // lecture en échec : exception (l'appelant n'envoie rien)
  return { actif: v?.actif === true, mise_en_service: typeof v?.mise_en_service === "string" ? v.mise_en_service : null, maj: v?.maj ?? null };
}
export async function changerActif(actif, maintenant = Date.now()) {
  const avant = (await kvGet(CLE_REGLAGES)) || {};   // lecture en échec : exception (date de mise en service jamais écrasée)
  const at = new Date(maintenant).toISOString();
  const v = { actif: actif === true, maj: at, mise_en_service: avant.mise_en_service || (actif === true ? at : null) };
  await kvSet(CLE_REGLAGES, v);
  return v;
}
// Demandes trop anciennes : plus de 60 jours avant la mise en service (première activation), seuil figé ensuite ;
// avant la mise en service : 60 jours glissants
export function seuilAnciennes(reglages, maintenant) {
  const m = Date.parse(reglages?.mise_en_service);
  return (Number.isFinite(m) ? Math.min(m, maintenant) : maintenant) - AGE_MAX_JOURS * JOUR;
}

// ── Groupes d'articles sous plusieurs CIP : copie de supplier-code-refs (Odoo), gardée un jour dans kv_store ──
// Lue par les passages, l'aperçu et la Saisie (aucun appel Odoo) ; rafraîchie par le passage planifié (restock-notify-cron).
export async function lireGroupes() {
  try { const v = await kvGet(CLE_GROUPES); return v?.groupes && typeof v.groupes === "object" ? v.groupes : {}; } catch { return {}; }
}
async function chargerGroupesOdoo() {
  const { handler } = await import("./supplier-code-refs.js");
  const r = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: { codes: ALL_GROUP_CODES.join(","), cips: ALL_FALLBACK_CIPS.join(",") } });
  let j = {};
  try { j = JSON.parse(r.body || "{}"); } catch { j = {}; }
  if (r.statusCode !== 200 || j.error) throw new Error(`supplier-code-refs : ${j.error || `HTTP ${r.statusCode}`}`);
  return Object.fromEntries(Object.entries(j.refs || {}).map(([code, refs]) => [code, (refs || []).map(x => trim(x.cip)).filter(Boolean)]).filter(([, l]) => l.length > 1));
}
export async function rafraichirGroupes({ maintenant = Date.now(), charger = chargerGroupesOdoo, forcer = false } = {}) {
  const v = await kvGet(CLE_GROUPES).catch(() => null);
  if (!forcer && v?.groupes && maintenant - Date.parse(v.at) < JOUR) return { frais: false, groupes: v.groupes };
  const groupes = await charger();
  await kvSet(CLE_GROUPES, { at: new Date(maintenant).toISOString(), groupes });
  return { frais: true, groupes };
}

// ── Lectures ──
// Colonnes de restock_alerts (ligne témoin) ; null : table vide
async function lireColonnes() {
  const r = await sb("restock_alerts?select=*&limit=1");
  if (!r.ok) throw new Error(`alertes illisibles (HTTP ${r.status})`);
  return Array.isArray(r.data) && r.data[0] ? new Set(Object.keys(r.data[0])) : null;
}
async function lireAttente() {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const r = await sb("restock_alerts?notified=eq.false&select=*&order=created_at.asc", { range: `${de}-${de + 999}` });
    if (!r.ok) throw new Error(`alertes illisibles (HTTP ${r.status})`);
    const rows = Array.isArray(r.data) ? r.data : [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
// CIP → ligne odoo_catalog (stock et prix de la Saisie)
export async function lireCatalogue(cips) {
  const out = {};
  const uniques = [...new Set((cips || []).map(trim).filter(Boolean))];
  for (const lot of lots(uniques, 100)) {
    const r = await sb(`odoo_catalog?${dans("cip", lot)}&select=cip,name,in_stock,available,list_price,discounted_price,discount_pct`);
    if (!r.ok) throw new Error(`catalogue illisible (HTTP ${r.status})`);
    for (const p of Array.isArray(r.data) ? r.data : []) out[trim(p.cip)] = p;
  }
  return out;
}
// adresse (minuscules) → comptes elixir_pharmacies [{ cip, name }]
async function lireComptes(adresses) {
  const out = new Map();
  for (const lot of lots(adresses, 50)) {
    const r = await sb(`elixir_pharmacies?${dans("email", lot)}&select=email,cip,name`);
    if (!r.ok) throw new Error(`comptes des pharmacies illisibles (HTTP ${r.status})`);
    for (const c of Array.isArray(r.data) ? r.data : []) {
      const e = trim(c.email).toLowerCase();
      out.set(e, [...(out.get(e) || []), c]);
    }
  }
  return out;
}
// CIP de pharmacie → nom (journal et admin : jamais d'adresse)
async function lireNoms(cips) {
  const out = new Map();
  const uniques = [...new Set(cips.map(trim).filter(Boolean))];
  for (const lot of lots(uniques, 100)) {
    const r = await sb(`elixir_pharmacies?${dans("cip", lot)}&select=cip,name`);
    if (!r.ok) continue;
    for (const c of Array.isArray(r.data) ? r.data : []) if (c.name && !out.has(trim(c.cip))) out.set(trim(c.cip), c.name);
  }
  return out;
}
async function lirePassages(depuisMs) {
  const r = await sb(`kv_store?key=like.${enc(PREFIXE_PASSAGE)}*&select=key,value&order=key.desc&limit=300`);
  if (!r.ok) return [];
  return (Array.isArray(r.data) ? r.data : []).map(x => kvParse(x.value)).filter(p => p && Date.parse(p.at) >= depuisMs);
}
// empreintes des adresses averties depuis depuisMs (plafond par adresse)
async function lireDestinataires(depuisMs) {
  const r = await sb(`kv_store?key=like.${enc(PREFIXE_DEST)}*&select=key,value&limit=5000`);
  if (!r.ok) throw new Error(`plafond par adresse illisible (HTTP ${r.status})`);
  const out = new Set();
  for (const x of Array.isArray(r.data) ? r.data : []) if (Date.parse(kvParse(x.value)?.at) >= depuisMs) out.add(String(x.key).slice(PREFIXE_DEST.length));
  return out;
}

// ── Mention « De retour en stock » (restock-alert, GET d'une pharmacie ou de l'admin en saisie) ──
// Lignes renvoyées au navigateur : sans adresse e-mail ni suivi interne ; retour = avertie récemment ET en stock ;
// retour_cip : CIP de la ligne de la Saisie (article sous plusieurs CIP : la référence servie en premier).
export async function marquerRetours(rows, { maintenant = Date.now(), catalogue = lireCatalogue, groupes = lireGroupes } = {}) {
  const liste = Array.isArray(rows) ? rows : [];
  const candidats = liste.filter(r => retourRecent(r, maintenant));
  let cat = {}, idx = new Map();
  if (candidats.length) {
    try { idx = indexGroupes(await groupes()); } catch { idx = new Map(); }
    try { cat = await catalogue(cipsALire(candidats.map(r => r.cip), idx)); } catch { cat = {}; }
  }
  const etats = new Map(candidats.map(r => [r.cip, etatProduit(r.cip, cat, idx)]));
  return liste.map(r => {
    const e = etats.get(r.cip);
    const retour = r.notified === true && !!e?.pret;
    return { pharmacy_cip: r.pharmacy_cip, cip: r.cip, product_name: (retour && e.p?.name) || r.product_name || null, created_at: r.created_at ?? null,
      notified: r.notified === true, notified_at: r.notified_at ?? null, retour, ...(retour ? { retour_cip: e.cip } : {}) };
  });
}

// ── Envoi par Resend (même expéditeur et même adresse de réponse que _gp-mail.js) ──
// → { sent: true, id } | { sent: false, status, name, reason } | { sent: false, ambigu: true, reason } (pas de réponse)
export async function envoyerResend({ to, subject, html, idempotence }) {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) return { sent: false, status: 401, name: "missing_api_key", reason: "RESEND_API_KEY absent des variables Netlify" };
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(DELAI_RESEND_MS),
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json", ...(idempotence ? { "Idempotency-Key": idempotence } : {}) },
      body: JSON.stringify({ from: process.env.GP_MAIL_FROM || FROM_DEFAUT, to: [to], subject, html, reply_to: ADMIN_MAIL }),
    });
  } catch (e) {
    const delai = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { sent: false, ambigu: true, reason: delai ? `pas de réponse de Resend en ${DELAI_RESEND_MS / 1000} s` : `envoi sans réponse (${e?.message || e})` };
  }
  const corps = await res.json().catch(() => ({}));
  return res.ok ? { sent: true, id: corps?.id ?? null } : { sent: false, status: res.status, name: corps?.name || null, reason: corps?.message || `HTTP ${res.status}` };
}
// Réponse de l'envoi → envoye | deja (Resend avait déjà cette clé d'idempotence) | demande (refus propre à la demande)
// | debit (limite de débit) | panne (refus général : clé, domaine, quota, configuration) | ambigu (issue inconnue)
const PANNES = /^(missing_api_key|restricted_api_key|suspended_api_key|invalid_api_key|invalid_from_address|invalid_idempotency_key|not_found|method_not_allowed|daily_quota_exceeded|monthly_quota_exceeded)$/;
export function classer(res) {
  if (res?.sent) return "envoye";
  const s = Number(res?.status), n = String(res?.name || "");
  if (res?.ambigu || !Number.isFinite(s) || s <= 0) return "ambigu";
  if (s === 409) return n === "invalid_idempotent_request" ? "deja" : "ambigu";
  if (s >= 500) return "ambigu";
  if (s === 429) return n === "rate_limit_exceeded" ? "debit" : "panne";
  if (s === 401 || s === 403 || PANNES.test(n)) return "panne";
  if (s === 400 || s === 422) return "demande";
  return "panne";
}
// Clé d'idempotence d'un envoi : la pharmacie et les demandes réservées (CIP, date, essais) — même envoi, même clé
export const cleIdempotence = (pharmacyCip, rows) =>
  `restock-${sha(`${trim(pharmacyCip)}|${rows.map(r => `${trim(r.cip)}:${r.created_at}:${Number(r.attempts) || 0}`).sort().join(",")}`).slice(0, 48)}`;

// ── E-mail à la pharmacie (charte Elixir : Inter, pétrole et or ; textes échappés ; typographie française) ──
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, "&nbsp;")}&nbsp;€`;
const pct = (n) => `−${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}&nbsp;%`;
const couper = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const lienProduit = (cip, site = SITE_PHARMACIES) => `${site}/?cip=${enc(trim(cip))}`;
const dateParis = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.day}&nbsp;${p.month} à ${p.hour}&nbsp;h&nbsp;${p.minute}`;
};
const POLICE = "font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif";

// produits : [{ cip, nom, prix, prixCatalogue?, remisePct? }] ; pharmacie : nom (facultatif) ; constate : date du stock (ms)
// Une seule colonne (lisible à 320 px) ; bouton « à l'épreuve d'Outlook » (cellule bgcolor) ; or en filet, jamais en texte.
export function emailRetour({ produits, pharmacie = null, constate = Date.now(), site = SITE_PHARMACIES }) {
  const un = produits.length === 1;
  const subject = (un ? `De retour en stock : ${couper(produits[0].nom, 90)}` : `${produits.length} produits que vous attendiez sont de retour en stock`).replace(/[\r\n]+/g, " ");
  const cartes = produits.map(p => `
          <tr><td style="padding:0 0 12px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e3ddd2;border-radius:14px;border-collapse:separate;">
              <tr><td style="padding:16px 18px;${POLICE};">
                <div style="font-size:15px;line-height:21px;font-weight:600;color:#201917;">${esc(p.nom)}</div>
                <div style="font-size:12px;line-height:18px;color:#6f6863;margin-top:4px;white-space:nowrap;">CIP&nbsp;${esc(p.cip)}</div>
                <div style="margin-top:10px;font-size:12px;line-height:22px;color:#6f6863;">
                  <span style="font-size:19px;line-height:25px;font-weight:700;color:#201917;white-space:nowrap;">${eur(p.prix)}</span><span style="white-space:nowrap;">&nbsp;net&nbsp;HT</span>${p.remisePct > 0 && p.prixCatalogue ? `
                  <span style="white-space:nowrap;padding-left:6px;"><span style="text-decoration:line-through;">${eur(p.prixCatalogue)}</span> <span style="background:#b5904a;color:#201917;font-weight:700;border-radius:999px;padding:1px 6px;">${pct(p.remisePct)}</span></span>` : ""}
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
                  <td bgcolor="#0f2d3d" style="border-radius:999px;background:#0f2d3d;">
                    <a href="${esc(lienProduit(p.cip, site))}" style="display:inline-block;padding:10px 20px;border:1px solid #0f2d3d;border-radius:999px;color:#fbf8f2;background:#0f2d3d;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;${POLICE};">Commander ce produit</a>
                  </td>
                </tr></table>
              </td></tr>
            </table>
          </td></tr>`).join("");
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4efe4;${POLICE};color:#201917;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4efe4;">${esc(un ? `${couper(produits[0].nom, 80)} est de nouveau disponible chez Elixir Pharma.` : `${produits.length} produits que vous attendiez sont de nouveau disponibles chez Elixir Pharma.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4efe4;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#fbf8f2;border-radius:16px;border-collapse:separate;overflow:hidden;">
      <tr><td style="background:#0f2d3d;padding:20px 28px;${POLICE};">
        <span style="font-size:17px;line-height:24px;font-weight:700;letter-spacing:-0.02em;color:#fbf8f2;">Elixir Pharma</span>
        <span style="font-size:12px;line-height:24px;font-weight:600;color:#d7bb7f;padding-left:10px;">Alerte retour en stock</span>
      </td></tr>
      <tr><td style="padding:30px 28px 6px 28px;${POLICE};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="32" height="3" bgcolor="#b5904a" style="width:32px;height:3px;background:#b5904a;font-size:0;line-height:0;">&nbsp;</td></tr></table>
        <h1 style="margin:14px 0 16px 0;font-size:23px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:#0f2d3d;">${un ? "Le produit que vous attendiez est disponible" : "Les produits que vous attendiez sont disponibles"}</h1>
        <p style="margin:0 0 10px 0;font-size:15px;line-height:23px;color:#201917;">Bonjour,</p>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:23px;color:#201917;">Vous nous aviez demandé de vous avertir du retour ${un ? "de ce produit" : "de ces produits"}${pharmacie ? ` pour <b>${esc(pharmacie)}</b>` : ""}&nbsp;: ${un ? "il est" : "ils sont"} de nouveau en stock chez Elixir Pharma.</p>
      </td></tr>
      <tr><td style="padding:0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cartes}
        </table>
      </td></tr>
      <tr><td style="padding:8px 28px 26px 28px;${POLICE};font-size:14px;line-height:22px;color:#4b4440;">
        <p style="margin:0 0 10px 0;">Disponibilité constatée le ${dateParis(constate)}&nbsp;; les quantités peuvent partir vite. ${un ? "Le bouton ouvre" : "Chaque bouton ouvre"} le produit dans votre espace de commande Elixir&nbsp;: indiquez la quantité, puis ajoutez-le à votre panier.</p>
        <p style="margin:0;">L’équipe Elixir Pharma</p>
      </td></tr>
      <tr><td style="padding:18px 28px 24px 28px;border-top:1px solid #e3ddd2;${POLICE};font-size:12px;line-height:19px;color:#6f6863;">
        <p style="margin:0 0 8px 0;">Vous recevez cet e-mail parce que vous avez demandé à être averti du retour de ce${un ? "" : "s"} produit${un ? "" : "s"} (bouton «&nbsp;M’avertir du retour&nbsp;» de la Saisie de commande). Cet e-mail ne sera pas renvoyé pour cette demande.</p>
        <p style="margin:0 0 8px 0;">Pour retirer une autre alerte en attente, recherchez le produit dans la Saisie de commande et cliquez sur «&nbsp;Alerte activée&nbsp;», ou répondez à cet e-mail&nbsp;: nous la retirerons pour vous.</p>
        <p style="margin:0;">Elixir Pharma · pharmacien@elixirpharma.fr · 01&nbsp;86&nbsp;04&nbsp;39&nbsp;95</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return { subject, html };
}

// ── Passage : détection, clôtures, envois ──
// source : "planifie" | "synchro" (GitHub Action) | "admin" ; budgetMs : plus de nouvelle opération après ce temps (sauf la
// première de l'appel) ; limiteMs : aucune opération qui pourrait finir au-delà (fonction HTTP : 10 s au plus ;
// planifiée : 30 s) ; horsFenetre : envoyer même hors 7 h – 21 h (admin).
// → bilan { envoyes, pharmacies, produits, closes, echecs, restants, reportes, done, erreurs, lignes… } (lignes : noms, jamais d'adresse)
export async function passage({ source = "admin", budgetMs = 4000, limiteMs = 9000, horsFenetre = false, maintenant = () => Date.now(),
  envoyer = envoyerResend, attendre = (ms) => new Promise(r => setTimeout(r, ms)), journaliser = true } = {}) {
  const debut = maintenant();
  const iso = new Date(debut).toISOString();
  const b = { at: iso, source, mode: null, envoyes: 0, pharmacies: 0, produits: 0, closes: { ancienne: 0, destinataire: 0, echec: 0, interrompu: 0 },
    echecs: 0, deja_pris: 0, restants: 0, reportes: 0, ecartees: 0, hors_fenetre: false, suspendu: false, plafond: false, panne: null,
    done: true, erreur: null, erreurs: [], lignes: [] };
  const noms = new Map(), nomsProduits = new Map();
  const ligne = (r, issue, extra = {}) => b.lignes.push({ pharmacy_cip: trim(r.pharmacy_cip), cip: trim(r.cip), produit: r.product_name || null, issue, ...extra });
  const destinataires = new Set();
  const ecoule = () => maintenant() - debut;
  // nouvelle opération : avant le budget (ou la première de l'appel : chaque appel avance), jamais au-delà de la limite
  const peut = (cout, faits) => (faits === 0 || ecoule() <= budgetMs) && ecoule() + cout <= limiteMs;
  try {
    const cols = await lireColonnes();
    if (!cols) { b.mode = "vide"; return await fin(); }
    const complet = COLONNES_SUIVI.every(c => cols.has(c));
    b.mode = complet ? "complet" : "reduit";
    const garder = (patch) => Object.fromEntries(Object.entries(patch).filter(([k]) => cols.has(k)));
    const maintenantIso = () => new Date(maintenant()).toISOString();
    let reglages;
    try { reglages = await lireReglages(); } catch (e) { throw new Error(`réglages illisibles (kv_store) : ${e.message}`); }
    b.suspendu = source !== "admin" && !reglages.actif;

    // 1. envois interrompus (réservés depuis plus de 15 min sans compte rendu) : jamais renvoyés d'office
    if (complet) {
      const r = await sb(`restock_alerts?outcome=eq.envoi&notified_at=lt.${enc(new Date(debut - RECLAMATION_PERIMEE_MS).toISOString())}`,
        { method: "PATCH", body: { outcome: "interrompu" }, prefer: "return=representation" });
      if (r.ok) for (const x of r.data || []) { b.closes.interrompu++; ligne(x, "interrompu"); }
      else b.erreurs.push(`envois interrompus non repérés (HTTP ${r.status})`);
    }

    // 2. demandes déjà vieilles de plus de 60 jours à la mise en service : closes sans e-mail (conditionnel : notified=eq.false)
    const seuilMs = seuilAnciennes(reglages, debut);
    const rv = await sb(`restock_alerts?notified=eq.false&created_at=lt.${enc(new Date(seuilMs).toISOString())}`,
      { method: "PATCH", body: garder({ notified: true, notified_at: iso, outcome: "ancienne" }), prefer: "return=representation" });
    if (rv.ok) for (const x of rv.data || []) { b.closes.ancienne++; ligne(x, "ancienne"); }
    else b.erreurs.push(`demandes anciennes non closes (HTTP ${rv.status}) : écartées de l'envoi`);

    // 3. demandes en attente dont le produit est de retour (règle de la Saisie, groupes compris) ; datées dans le futur : écartées
    const attente = [];
    for (const r of await lireAttente()) {
      const t = Date.parse(r.created_at);
      if (!Number.isFinite(t) || t < seuilMs) continue;
      if (t > debut + AVANCE_MAX_MS) { b.ecartees++; continue; }
      attente.push(r);
    }
    if (b.ecartees) b.erreurs.push(`${b.ecartees} demande(s) datée(s) dans le futur : écartée(s)`);
    if (!attente.length) return await fin();
    const idx = indexGroupes(await lireGroupes());
    const cat = await lireCatalogue(cipsALire(attente.map(r => r.cip), idx));
    for (const p of Object.values(cat)) if (p?.name) nomsProduits.set(trim(p.cip), p.name);
    const etats = new Map();
    const etat = (cip) => { const k = trim(cip); if (!etats.has(k)) etats.set(k, etatProduit(k, cat, idx)); return etats.get(k); };
    const pretes = attente.filter(r => etat(r.cip).pret);
    if (!pretes.length) return await fin();

    // 4. un groupe par pharmacie et adresse (un e-mail), la demande la plus ancienne d'abord. Filtres d'écriture sur les
    // valeurs ENREGISTRÉES (cipsBruts, emailsBruts) : une valeur avec espaces se réserve et se clôt comme les autres
    const groupes = new Map();
    for (const r of pretes) {
      const email = r.pharmacy_email == null ? null : trim(r.pharmacy_email);
      const cle = `${trim(r.pharmacy_cip)}|${email === null ? "∅" : `@${email.toLowerCase()}`}`;
      if (!groupes.has(cle)) groupes.set(cle, { pharmacy_cip: trim(r.pharmacy_cip), email, cipsBruts: new Set(), emailsBruts: new Set(), rows: [] });
      const g = groupes.get(cle);
      g.cipsBruts.add(r.pharmacy_cip); if (email !== null) g.emailsBruts.add(r.pharmacy_email); g.rows.push(r);
    }
    const tous = [...groupes.values()];
    const filtreGroupe = (g, cips) => `restock_alerts?${dans("pharmacy_cip", [...g.cipsBruts])}&${g.email === null ? "pharmacy_email=is.null" : dans("pharmacy_email", [...g.emailsBruts])}&${dans("cip", cips)}`;

    // 5. destinataire : l'adresse de la demande, seulement si c'est encore un compte de CE CIP (elixir_pharmacies) ;
    // sinon close sans e-mail — avant tout envoi, dans le budget (le reste au prochain appel, done=false)
    const comptes = await lireComptes([...new Set(tous.map(g => (g.email || "").toLowerCase()).filter(e => e.includes("@")))]);
    for (const g of tous) {
      const c = (comptes.get((g.email || "").toLowerCase()) || []).find(x => trim(x.cip) === g.pharmacy_cip);
      if (c) { g.valide = true; g.nom = c.name || null; if (c.name) noms.set(g.pharmacy_cip, c.name); }
    }
    const invalides = tous.filter(g => !g.valide);
    for (let k = 0; k < invalides.length; k++) {
      if (!peut(COUT_REQUETE_MS, k)) { b.done = false; b.restants += invalides.length - k; break; }
      const g = invalides[k];
      const r = await sb(`${filtreGroupe(g, g.rows.map(x => x.cip))}&notified=eq.false`,
        { method: "PATCH", body: garder({ notified: true, notified_at: maintenantIso(), outcome: "destinataire" }), prefer: "return=representation" });
      if (r.ok) for (const x of r.data || []) { b.closes.destinataire++; ligne(x, "destinataire"); }
      else b.erreurs.push(`clôture « destinataire » impossible (HTTP ${r.status})`);
    }
    if (!b.done) return await fin();
    const valides = tous.filter(g => g.valide)
      .sort((x, y) => Math.min(...x.rows.map(r => Date.parse(r.created_at))) - Math.min(...y.rows.map(r => Date.parse(r.created_at))));
    if (!valides.length) return await fin();
    if (b.suspendu) { b.restants = valides.length; return await fin(); }
    if (envoyer === envoyerResend && !process.env.RESEND_API_KEY) {
      b.restants = valides.length; b.erreurs.push("RESEND_API_KEY absent des variables Netlify : aucun e-mail envoyé");
      return await fin();
    }
    if (!horsFenetre && !dansFenetre(debut)) { b.hors_fenetre = true; b.restants = valides.length; return await fin(); }

    // 6. plafonds : un e-mail par adresse sur 24 h, PLAFOND_JOUR e-mails par jour (lectures en échec : aucun envoi)
    const cleJour = `${PREFIXE_JOUR}${jourParis(debut)}`;
    let duJour = Number((await kvGet(cleJour))?.n) || 0;
    const recents = await lireDestinataires(debut - ADRESSE_HEURES * 3600e3);
    const reste = (i) => valides.slice(i).filter(x => !recents.has(empreinteAdresse(x.email))).length;

    // 7. envois : réservation conditionnelle, e-mail, compte rendu
    let dernierEnvoi = -Infinity, envois = 0;
    const rendre = async (rows, compter) => {
      for (const r of rows) {
        let n = complet ? Number(r.attempts) || 0 : 0;
        const cleEssais = `${PREFIXE_ESSAIS}${trim(r.pharmacy_cip)}:${r.cip}`;
        if (compter) {
          if (complet) n += 1;
          else {
            const v = await kvGet(cleEssais).catch(() => null);
            n = (v && v.created_at === r.created_at ? Number(v.n) || 0 : 0) + 1;
          }
        }
        const cible = `restock_alerts?${egal("pharmacy_cip", r.pharmacy_cip)}&${egal("cip", r.cip)}&${complet ? "outcome=eq.envoi" : "notified=eq.true"}`;
        if (compter && n >= ESSAIS_MAX) {   // close : la réservation reste (notified=true), issue « echec »
          if (complet) await sb(cible, { method: "PATCH", body: { outcome: "echec", attempts: n } });
          b.closes.echec++; ligne(r, "echec");
          continue;
        }
        if (!complet && compter) await kvSet(cleEssais, { n, created_at: r.created_at }).catch(() => {});
        const rr = await sb(cible, { method: "PATCH", body: garder({ notified: false, notified_at: null, outcome: null, ...(complet ? { attempts: n } : {}) }) });
        if (!rr.ok) b.erreurs.push(`réservation non rendue (HTTP ${rr.status}) : demande gardée avertie`);
      }
    };
    for (let i = 0; i < valides.length; i++) {
      const g = valides[i];
      const empreinte = empreinteAdresse(g.email);
      if (recents.has(empreinte)) { b.reportes++; continue; }   // adresse avertie depuis moins de 24 h : attend, sans clôture
      if (duJour >= PLAFOND_JOUR) {
        b.plafond = true; b.restants += reste(i);
        b.erreurs.push(`plafond du jour atteint (${PLAFOND_JOUR} e-mails) : la suite part demain`);
        break;
      }
      if (!peut(COUT_ENVOI_MS, envois)) { b.restants += reste(i); b.done = false; break; }
      envois++;
      const rc = await sb(`${filtreGroupe(g, g.rows.map(x => x.cip))}&notified=eq.false`,
        { method: "PATCH", body: garder({ notified: true, notified_at: maintenantIso(), outcome: "envoi" }), prefer: "return=representation" });
      if (!rc.ok) { b.erreurs.push(`réservation impossible (HTTP ${rc.status})`); b.restants++; continue; }
      const pris = Array.isArray(rc.data) ? rc.data : [];
      if (!pris.length) { b.deja_pris++; continue; }   // un autre passage s'en occupe
      const pause = dernierEnvoi + ESPACEMENT_MS - maintenant();
      if (pause > 0) await attendre(pause);
      // nom, CIP et prix du catalogue (jamais le nom envoyé par le navigateur, sauf CIP inconnu) ; un article sous
      // plusieurs CIP n'apparaît qu'une fois, à la référence servie en premier
      const produits = [], vus = new Set();
      for (const r of pris) {
        const e = etat(r.cip), p = e.p;
        if (vus.has(e.cip)) continue;
        vus.add(e.cip);
        const remise = !!p.discounted_price && Number(p.discount_pct) > 0;
        produits.push({ cip: e.cip, nom: p.name || r.product_name || e.cip, prix: prixNet(p),
          ...(remise ? { prixCatalogue: Number(p.list_price) || null, remisePct: Number(p.discount_pct) } : {}) });
      }
      const mail = emailRetour({ produits, pharmacie: g.nom, constate: debut });
      let res;
      try { res = await envoyer({ to: g.email, subject: mail.subject, html: mail.html, idempotence: cleIdempotence(g.pharmacy_cip, pris) }); }
      catch (e) { res = { sent: false, ambigu: true, reason: e?.message || String(e) }; }
      dernierEnvoi = maintenant();
      const issue = classer(res);
      const motif = sansAdresse(res?.reason || res?.name || "envoi refusé");
      if (issue === "envoye" || issue === "deja") {
        if (complet) {
          const rf = await sb(`${filtreGroupe(g, pris.map(r => r.cip))}&outcome=eq.envoi`, { method: "PATCH", body: { outcome: "envoye" } });
          if (!rf.ok) b.erreurs.push(`e-mail parti, issue non notée (HTTP ${rf.status})`);
        }
        if (issue === "deja") b.erreurs.push("Resend avait déjà reçu cet envoi (même clé d'idempotence) : noté envoyé, aucun nouvel e-mail");
        b.envoyes++; b.produits += pris.length; destinataires.add(g.pharmacy_cip);
        pris.forEach(r => ligne(r, "envoye", { prix: prixNet(etat(r.cip).p) }));
        recents.add(empreinte); duJour++;
        await Promise.all([kvSet(cleJour, { n: duJour }), kvSet(`${PREFIXE_DEST}${empreinte}`, { at: maintenantIso() })])
          .catch(e => b.erreurs.push(`plafonds non mis à jour (${sansAdresse(e?.message)})`));
        continue;
      }
      if (issue === "demande") {   // refus propre à cette demande : nouvel essai au passage suivant, ESSAIS_MAX au plus
        b.echecs++; b.erreurs.push(`envoi refusé pour cette demande (${motif})`);
        await rendre(pris, true);
        continue;
      }
      if (issue === "debit" || issue === "panne") {   // refus général : rien n'est compté, tout reprend plus tard
        await rendre(pris, false);
        b.restants += reste(i);
        if (issue === "debit") { b.done = false; b.erreurs.push(`Resend : limite de débit (${motif}), reprise à l'appel suivant`); }
        else { b.panne = motif; b.erreurs.push(`Resend refuse les envois (${motif}) : aucun essai compté, reprise au passage suivant`); }
        break;
      }
      // issue incertaine (pas de réponse, délai dépassé, 5xx…) : l'e-mail est peut-être parti → jamais renvoyé d'office
      if (complet) {
        const ri = await sb(`${filtreGroupe(g, pris.map(r => r.cip))}&outcome=eq.envoi`, { method: "PATCH", body: { outcome: "interrompu" } });
        if (!ri.ok) b.erreurs.push(`envoi incertain non noté (HTTP ${ri.status}) : repéré « interrompu » dans 15 min`);
      }
      b.closes.interrompu += pris.length;
      pris.forEach(r => ligne(r, "interrompu", { motif }));
      b.erreurs.push(`envoi incertain (${motif}) : demande mise de côté, à vérifier dans Resend${complet ? " puis « Relancer » dans l'admin si l'e-mail n'est pas parti" : ""}`);
      b.restants += reste(i + 1);
      break;
    }
  } catch (e) {
    b.erreur = sansAdresse(e?.message || e); b.done = true;
  }
  return await fin();

  async function fin() {
    b.pharmacies = destinataires.size;
    const manquants = [...new Set(b.lignes.map(l => l.pharmacy_cip).filter(c => !noms.has(c)))];
    if (manquants.length) { try { for (const [k, v] of await lireNoms(manquants)) noms.set(k, v); } catch { /* noms facultatifs */ } }
    const sansNom = [...new Set(b.lignes.map(l => l.cip).filter(c => !nomsProduits.has(c)))];
    if (sansNom.length) { try { for (const p of Object.values(await lireCatalogue(sansNom))) if (p?.name) nomsProduits.set(trim(p.cip), p.name); } catch { /* noms facultatifs */ } }
    for (const l of b.lignes) { l.pharmacie = noms.get(l.pharmacy_cip) || null; l.produit = nomsProduits.get(l.cip) || l.produit || null; }
    b.duree_ms = maintenant() - debut;
    const { lignes, ...resume } = b;
    console.log(`[restock-notify] ${source} (${b.mode}) : ${b.envoyes} e-mail(s), ${b.produits} produit(s), closes ${JSON.stringify(b.closes)}, ` +
      `${b.echecs} refus, ${b.restants} restant(s), ${b.reportes} reporté(s)${b.suspendu ? " (envois automatiques suspendus)" : ""}${b.hors_fenetre ? " (hors 7 h – 21 h)" : ""}` +
      `${b.plafond ? " (plafond du jour)" : ""}${b.panne ? `, Resend en panne : ${b.panne}` : ""}${b.erreur ? `, erreur : ${b.erreur}` : ""}`);
    if (journaliser) {
      if (lignes.length || b.erreurs.length || b.erreur) {
        await kvSet(`${PREFIXE_PASSAGE}${iso}:${Math.random().toString(36).slice(2, 6)}`, b).catch(e => console.error("[restock-notify] journal", e.message));
      }
      await kvSet(CLE_DERNIER, { ...resume, lignes: lignes.length }).catch(() => {});
    }
    return b;
  }
}

// Chiffres seulement (réponse à la GitHub Action et à l'admin) : ni nom, ni adresse, ni ligne
export const chiffres = (b) => ({ done: b.done, mode: b.mode, envoyes: b.envoyes, pharmacies: b.pharmacies, produits: b.produits, closes: b.closes,
  echecs: b.echecs, deja_pris: b.deja_pris, restants: b.restants, reportes: b.reportes, ecartees: b.ecartees, hors_fenetre: b.hors_fenetre,
  suspendu: b.suspendu, plafond: b.plafond, panne: b.panne, erreurs: b.erreurs, ...(b.erreur ? { error: b.erreur } : {}) });

// Journal de plus de 60 jours, essais du mode réduit de plus de 90 jours, plafonds échus (passage planifié)
export async function menageJournal(maintenant = Date.now()) {
  await kvDeleteOlder(PREFIXE_PASSAGE, new Date(maintenant - JOURNAL_JOURS * JOUR).toISOString());
  await kvDeleteOlder(PREFIXE_ESSAIS, new Date(maintenant - 90 * JOUR).toISOString());
  await kvDeleteOlder(PREFIXE_DEST, new Date(maintenant - 2 * JOUR).toISOString());
  await kvDeleteOlder(PREFIXE_JOUR, new Date(maintenant - 8 * JOUR).toISOString());
}

// ── Admin : tableau de bord (verifyAdmin). Adresses e-mail : seulement celles des envois à vérifier (recherche dans Resend) ──
export async function apercu({ maintenant = Date.now() } = {}) {
  const cols = await lireColonnes();
  const complet = cols ? COLONNES_SUIVI.every(c => cols.has(c)) : null;
  const reglages = await lireReglages().catch(() => null);
  const seuil = seuilAnciennes(reglages || {}, maintenant);
  const toutes = cols ? await lireAttente() : [];
  const actives = [];
  let anciennes = 0, futures = 0;
  for (const r of toutes) {
    const t = Date.parse(r.created_at);
    if (!Number.isFinite(t)) continue;
    if (t < seuil) anciennes++;
    else if (t > maintenant + AVANCE_MAX_MS) futures++;
    else actives.push(r);
  }
  // envois à vérifier : incertains (« interrompu », toujours) et refusés 3 fois (« echec », 30 jours)
  let aVerifier = [];
  if (complet) {
    const r = await sb(`restock_alerts?${dans("outcome", ["interrompu", "echec"])}&notified=eq.true&select=pharmacy_cip,cip,product_name,pharmacy_email,notified_at,outcome&order=notified_at.desc&limit=100`);
    if (r.ok && Array.isArray(r.data)) aVerifier = r.data.filter(x => x.outcome === "interrompu" || Date.parse(x.notified_at) >= maintenant - HISTORIQUE_JOURS * JOUR);
  }
  const idx = indexGroupes(actives.length || aVerifier.length ? await lireGroupes() : {});
  const cat = actives.length || aVerifier.length ? await lireCatalogue(cipsALire([...actives, ...aVerifier].map(r => r.cip), idx)) : {};
  const noms = await lireNoms([...actives, ...aVerifier].map(r => r.pharmacy_cip)).catch(() => new Map());
  const produits = new Map();
  const groupesPrets = new Map();   // pharmacie|adresse → { pharmacy_cip, email, n }
  let alertesPretes = 0;
  for (const r of actives) {
    const cip = trim(r.cip);
    const e = etatProduit(cip, cat, idx);
    if (!produits.has(cip)) produits.set(cip, { cip, nom: e.p?.name || r.product_name || cip, connu: e.connu, en_stock: e.en_stock,
      prix: prixNet(e.p), pret: e.pret, cip_servi: e.cip !== cip ? e.cip : null, plus_ancienne: r.created_at, pharmacies: [] });
    const x = produits.get(cip);
    x.pharmacies.push({ nom: noms.get(trim(r.pharmacy_cip)) || null, cip: trim(r.pharmacy_cip), pharmacy_cip: r.pharmacy_cip, depuis: r.created_at });
    if (Date.parse(r.created_at) < Date.parse(x.plus_ancienne)) x.plus_ancienne = r.created_at;
    if (e.pret) {
      alertesPretes++;
      const email = trim(r.pharmacy_email).toLowerCase();
      const k = `${trim(r.pharmacy_cip)}|${email}`;
      groupesPrets.set(k, { pharmacy_cip: trim(r.pharmacy_cip), email, n: (groupesPrets.get(k)?.n || 0) + 1 });
    }
  }
  // e-mails qui partiront : adresse encore compte de ce CIP (sinon demande close sans e-mail), pas avertie depuis 24 h
  const prets = [...groupesPrets.values()];
  const comptes = prets.length ? await lireComptes([...new Set(prets.map(g => g.email).filter(e => e.includes("@")))]).catch(() => null) : new Map();
  const dest = prets.length ? await lireDestinataires(maintenant - ADRESSE_HEURES * 3600e3).catch(() => new Set()) : new Set();
  let emailsPrets = 0, emailsReportes = 0, closesDestinataire = 0;
  for (const g of prets) {
    const valide = comptes ? (comptes.get(g.email) || []).some(c => trim(c.cip) === g.pharmacy_cip) : true;
    if (!valide) closesDestinataire += g.n;
    else if (dest.has(empreinteAdresse(g.email))) emailsReportes++;
    else emailsPrets++;
  }
  const liste = [...produits.values()].map(e => ({ ...e, pharmacies: e.pharmacies.sort((a, b) => Date.parse(a.depuis) - Date.parse(b.depuis)), attente: e.pharmacies.length }))
    .sort((a, b) => b.attente - a.attente || Date.parse(a.plus_ancienne) - Date.parse(b.plus_ancienne));
  const passages60 = await lirePassages(maintenant - JOURNAL_JOURS * JOUR);
  const passages = passages60.filter(p => Date.parse(p.at) >= maintenant - HISTORIQUE_JOURS * JOUR);
  const recents = passages.flatMap(p => (p.lignes || []).map(l => ({ at: p.at, source: p.source, pharmacie: l.pharmacie || null,
    pharmacy_cip: l.pharmacy_cip, cip: l.cip, produit: l.produit, issue: l.issue, prix: l.prix ?? null }))).slice(0, 300);
  const dernier = await kvGet(CLE_DERNIER).catch(() => null);
  return {
    mode: cols ? (complet ? "complet" : "reduit") : "vide",
    regles: { age_max_jours: AGE_MAX_JOURS, recent_jours: RECENT_JOURS, essais_max: ESSAIS_MAX, fenetre: FENETRE, dans_fenetre: dansFenetre(maintenant),
      plafond_jour: PLAFOND_JOUR, adresse_heures: ADRESSE_HEURES },
    reglages: { lisibles: !!reglages, actif: reglages?.actif === true, mise_en_service: reglages?.mise_en_service || null, seuil_anciennes: new Date(seuil).toISOString() },
    prochain_passage: prochainPassage(maintenant),
    envoyes_jour: Number((await kvGet(`${PREFIXE_JOUR}${jourParis(maintenant)}`).catch(() => null))?.n) || 0,
    deja_envoye: passages60.some(p => Number(p.envoyes) > 0) || Number(dernier?.envoyes) > 0,
    totaux: { en_attente: actives.length, pharmacies_en_attente: new Set(actives.map(r => trim(r.pharmacy_cip))).size, anciennes, futures,
      alertes_pretes: alertesPretes, emails_prets: emailsPrets, emails_reportes: emailsReportes, closes_destinataire: closesDestinataire,
      produits_prets: liste.filter(p => p.pret).length },
    produits: liste.slice(0, 200),
    recents,
    passages: passages.slice(0, 15).map(({ lignes, ...p }) => ({ ...p, lignes: Array.isArray(lignes) ? lignes.length : 0 })),
    dernier,
    a_verifier: aVerifier.map(r => ({ pharmacy_cip: r.pharmacy_cip, pharmacie: noms.get(trim(r.pharmacy_cip)) || null, cip: r.cip,
      produit: etatProduit(r.cip, cat, idx).p?.name || r.product_name || null, issue: r.outcome, at: r.notified_at, email: r.pharmacy_email || null })),
  };
}

// Admin : envoi incertain vérifié non reçu (Resend), ou refusé 3 fois → la demande repart au prochain passage (un essai
// de plus pour un « echec » ; clé d'idempotence inchangée pour un « interrompu » : Resend écarte un doublon pendant 24 h)
export async function relancer({ pharmacy_cip, cip }) {
  if (!pharmacy_cip || !cip) return { ok: false, statut: 400, error: "pharmacy_cip et cip requis" };
  const r = await sb(`restock_alerts?${egal("pharmacy_cip", pharmacy_cip)}&${egal("cip", cip)}&${dans("outcome", ["interrompu", "echec"])}`,
    { method: "PATCH", body: { notified: false, notified_at: null, outcome: null }, prefer: "return=representation" });
  if (!r.ok) return { ok: false, statut: colonneManquante(r.text) ? 409 : 502, error: colonneManquante(r.text) ? "Colonnes de suivi absentes (sql/restock-notify.sql)" : `HTTP ${r.status}` };
  return (r.data || []).length ? { ok: true } : { ok: false, statut: 404, error: "Aucun envoi à relancer pour cette demande" };
}
