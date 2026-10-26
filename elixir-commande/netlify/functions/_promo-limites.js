// ── Limites de quantité des menus promo et des précommandes (26/10/2026, docs/limites-promo.md) : lecture et contrôle ──
// Règles et textes : src/limites-promo.js (partagé avec le site). Ici : limites des menus actifs (ec_config admin_promos), commandes
// enregistrées depuis l'ajout du produit au menu (elixir_orders, toutes origines), ce que la pharmacie peut encore commander,
// et le contrôle d'une commande avant son enregistrement (order-save). Commandes relues sur 180 jours au plus.
// Lectures seules ; sb injectable (tests), par défaut la clé serveur Supabase.
import { limitesActives, quantitesCommandees, resteLimite, depassementsLimites, messageDepassement } from "../../src/limites-promo.js";

const FENETRE_MAX = 180 * 864e5, PAGE = 1000, PAGES_MAX = 50;

async function sbDefaut(path, { range } = {}) {
  const key = process.env.SUPABASE_KEY;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, ...(range ? { Range: range } : {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} : ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Limites des menus actifs → { <CIP>: { cip, nom, menu, parPharmacie, total, depuis } }
export async function lireLimites(sb = sbDefaut) {
  const [r] = (await sb("ec_config?key=eq.admin_promos&select=value&limit=1")) || [];
  let v = r?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = []; } }
  return limitesActives(v);
}

// Pharmacie : { cip, emails } (CIP de la fiche, adresses de connexion en minuscules) — ses commandes portent l'un ou l'autre
// (comparaison exacte, jamais ilike : « _ » et « % » y sont des jokers)
const minuscule = (v) => String(v || "").trim().toLowerCase();
export const pharmacie = (cip, ...emails) => ({ cip: /^\d{7,13}$/.test(String(cip || "").trim()) ? String(cip).trim() : null,
  emails: [...new Set(emails.map(minuscule).filter(e => e.includes("@")))] });
const deLaPharmacie = (ph) => (o) => !!(ph.cip && String(o.pharmacy_cip || "").trim() === ph.cip) || ph.emails.includes(minuscule(o.pharmacy_email));

// Commandes enregistrées depuis `depuis` (ms) : toutes, ou celles de la pharmacie ph ; pages de 1 000, ordre stable.
// Cache (lecture de toutes les commandes seulement) : cacheMs > 0, par instance de fonction.
const cache = new Map();
export async function commandesDepuis(sb, depuis, ph = null, cacheMs = 0) {
  const since = new Date(Math.max(depuis, Date.now() - FENETRE_MAX)).toISOString();
  const ou = ph ? [...(ph.cip ? [`pharmacy_cip.eq.${ph.cip}`] : []), ...ph.emails.map(e => `pharmacy_email.eq.${JSON.stringify(e)}`)] : [];
  if (ph && !ou.length) return [];
  const cle = !ph && cacheMs > 0 ? since.slice(0, 16) : null, vu = cle && cache.get(cle);
  if (vu && Date.now() - vu.at < cacheMs) return vu.commandes;
  const base = `elixir_orders?date=gte.${encodeURIComponent(since)}${ou.length ? `&or=(${encodeURIComponent(ou.join(","))})` : ""}&select=id,date,items,pharmacy_cip,pharmacy_email&order=id.asc`;
  const commandes = [];
  for (let p = 0; ; p++) {
    if (p >= PAGES_MAX) throw new Error("trop de commandes à relire pour les limites");
    const rows = await sb(base, { range: `${p * PAGE}-${p * PAGE + PAGE - 1}` });
    commandes.push(...(rows || []));
    if (!rows || rows.length < PAGE) break;
  }
  if (cle) { if (cache.size > 20) cache.clear(); cache.set(cle, { at: Date.now(), commandes }); }
  return commandes;
}

// État des limites : { <CIP>: { reste, motif, deja, dejaTotal } } pour la pharmacie ph (null : totaux seuls, reste au total).
// cips : CIP à calculer (défaut : tous) ; sauf : numéro de commande ignoré
export async function etatLimites({ sb = sbDefaut, limites, ph = null, cips = null, sauf = null, cacheMs = 0 }) {
  const L = Object.fromEntries(Object.entries(limites).filter(([c]) => !cips || cips.includes(c)));
  const liste = Object.values(L);
  if (!liste.length) return {};
  // un max total demande les commandes de toutes les pharmacies ; sinon, celles de la pharmacie suffisent
  const tous = !ph || liste.some(l => l.total != null);
  const commandes = await commandesDepuis(sb, Math.min(...liste.map(l => l.depuis)), tous ? null : ph, tous ? cacheMs : 0);
  const deja = quantitesCommandees(commandes, L, ph ? deLaPharmacie(ph) : null, sauf);
  const out = {};
  for (const l of liste) out[l.cip] = { ...resteLimite(l, ph ? deja[l.cip] : { pharmacie: 0, total: deja[l.cip].total }), dejaTotal: deja[l.cip].total };
  return out;
}

// Contrôle d'une commande avant son enregistrement (order-save) → null (rien de limité, ou dans les limites) ou
// { message, over }. Limites illisibles : null (la commande passe, comme le contingentement quand Odoo ne répond pas) ;
// commandes illisibles pour une commande qui contient un produit limité : exception (order-save répond 503, rien d'écrit).
export async function controleLimites({ sb = sbDefaut, items, ph, sauf = null }) {
  let limites;
  try { limites = await lireLimites(sb); }
  catch (e) { console.warn("[limites promo] limites illisibles, commande non contrôlée :", e.message); return null; }
  const cips = [...new Set((Array.isArray(items) ? items : []).map(i => String(i?.cip ?? "")).filter(c => limites[c]))];
  if (!cips.length) return null;
  const etat = await etatLimites({ sb, limites, ph, cips, sauf });
  const { over } = depassementsLimites(items, limites, etat);
  return over.length ? { message: over.map(messageDepassement).join(" ; "), over } : null;
}
