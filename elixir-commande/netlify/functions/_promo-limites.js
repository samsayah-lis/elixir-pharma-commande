// ── Limites de quantité des menus promo et des précommandes (26/10/2026, docs/limites-promo.md) : lecture et contrôle ──
// Règles et textes : src/limites-promo.js (partagé avec le site). Ici : limites des menus actifs (ec_config admin_promos), commandes
// enregistrées depuis l'ajout du produit au menu (elixir_orders, toutes origines), ce que la pharmacie peut encore commander,
// et le contrôle d'une commande avant et juste après son enregistrement (order-save). Commandes relues sur 180 jours au plus.
// Lectures seules ; sb injectable (tests), par défaut la clé serveur Supabase.
import { limitesActives, etatLimite, depassementsLimites, messageDepassement } from "../../src/limites-promo.js";

const FENETRE_MAX = 180 * 864e5, PAGE = 1000, PAGES_MAX = 50;

async function sbDefaut(path, { range } = {}) {
  const key = process.env.SUPABASE_KEY;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, ...(range ? { Range: range } : {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} : ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Limites des menus actifs → { <CIP>: { cip, nom, menu, parPharmacie, total, depuis, regles } }
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
// Pharmacie sans CIP valide : ses commandes ne se retrouvent que par adresse → toutes les adresses de connexion de sa fiche Odoo
// (une ligne elixir_pharmacies par adresse), telles qu'enregistrées et en minuscules, comme le contingentement (_api-contingent.js)
async function adressesDeLaFiche(sb, ph) {
  if (!ph || ph.cip || !ph.emails.length) return ph;
  const parAdresse = (await sb(`elixir_pharmacies?email=in.${encodeURIComponent(`(${ph.emails.map(e => JSON.stringify(e)).join(",")})`)}&select=odoo_id`)) || [];
  const fiches = [...new Set(parAdresse.map(r => Number(r.odoo_id)).filter(n => Number.isSafeInteger(n) && n > 0))];
  if (!fiches.length) return ph;
  const comptes = (await sb(`elixir_pharmacies?odoo_id=in.(${fiches.join(",")})&select=email`)) || [];
  const autres = comptes.flatMap(r => { const e = String(r.email || "").trim(); return [e, e.toLowerCase()]; }).filter(e => e.includes("@"));
  return { ...ph, emails: [...new Set([...ph.emails, ...autres])] };
}

// Commandes enregistrées depuis `depuis` (ms) : toutes, ou celles de la pharmacie ph ; pages de 1 000, ordre stable.
// Cache (lecture de toutes les commandes seulement) : cacheMs > 0, par instance de fonction.
const cache = new Map();
export async function commandesDepuis(sb, depuis, ph = null, cacheMs = 0) {
  const since = new Date(Math.max(depuis, Date.now() - FENETRE_MAX)).toISOString();
  const ou = ph ? [...(ph.cip ? [`pharmacy_cip.eq.${ph.cip}`] : []), ...ph.emails.map(e => `pharmacy_email.eq.${JSON.stringify(e)}`)] : [];
  if (ph && !ou.length) return [];
  const cle = !ph && cacheMs > 0 ? since.slice(0, 16) : null, vu = cle && cache.get(cle);
  if (vu && Date.now() - vu.at < cacheMs) return vu.commandes;
  const base = `elixir_orders?date=gte.${encodeURIComponent(since)}${ou.length ? `&or=(${encodeURIComponent(ou.join(","))})` : ""}&select=id,date,items,pharmacy_cip,pharmacy_email,source&order=id.asc`;
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

// État des limites : { <CIP>: etatLimite } (reste, motif, deja, parPharmacie, dejaTotal, parMenu) pour la pharmacie ph (null :
// totaux seuls). cips : CIP à calculer (défaut : tous) ; sauf : numéro(s) de commande ignoré(s) — une liste ne vaut que pour les
// commandes de la pharmacie ; cacheMs : commandes de toutes les pharmacies gardées (max total) — celles de la pharmacie sont alors
// relues à l'instant (sa commande qui vient de partir comptée, une commande retirée oubliée)
export async function etatLimites({ sb = sbDefaut, limites, ph = null, cips = null, sauf = null, cacheMs = 0 }) {
  const liste = Object.values(limites).filter(l => !cips || cips.includes(l.cip));
  if (!liste.length) return {};
  ph = await adressesDeLaFiche(sb, ph);
  // un max total demande les commandes de toutes les pharmacies ; sinon, celles de la pharmacie suffisent
  const depuis = Math.min(...liste.map(l => l.depuis)), tous = !ph || liste.some(l => (l.regles || [l]).some(r => r.total != null));
  let commandes = await commandesDepuis(sb, depuis, tous ? null : ph, tous ? cacheMs : 0);
  if (tous && ph && cacheMs > 0) {
    // celles du cache que la lecture filtrée aurait rendues (même comparaison exacte que or=) sont remplacées par celle-ci
    const siennes = await commandesDepuis(sb, depuis, ph), ids = new Set(siennes.map(o => String(o.id)));
    const relue = (o) => (ph.cip && String(o.pharmacy_cip ?? "") === ph.cip) || ph.emails.includes(o.pharmacy_email);
    commandes = [...commandes.filter(o => !relue(o) && !ids.has(String(o.id))), ...siennes];
  }
  const dePh = ph ? deLaPharmacie(ph) : null, out = {};
  if (Array.isArray(sauf)) sauf = dePh ? sauf.filter(id => commandes.some(o => String(o.id) === String(id) && dePh(o))) : [];
  for (const l of liste) out[l.cip] = etatLimite(commandes, l, dePh, sauf);
  return out;
}

// Contrôle d'une commande (order-save, avant et juste après l'écriture) → { limite: produit limité dans la commande,
// refus: null | { message, over } }. Limites illisibles : rien de limité (la commande passe, comme le contingentement quand Odoo
// ne répond pas) ; commandes illisibles pour une commande qui contient un produit limité : exception (order-save répond 503).
export async function controleLimites({ sb = sbDefaut, items, ph, sauf = null }) {
  let limites;
  try { limites = await lireLimites(sb); }
  catch (e) { console.warn("[limites promo] limites illisibles, commande non contrôlée :", e.message); return { limite: false, refus: null }; }
  const cips = [...new Set((Array.isArray(items) ? items : []).map(i => String(i?.cip ?? "")).filter(c => limites[c]))];
  if (!cips.length) return { limite: false, refus: null };
  const etat = await etatLimites({ sb, limites, ph, cips, sauf });
  const { over } = depassementsLimites(items, limites, etat);
  return { limite: true, refus: over.length ? { message: over.map(messageDepassement).join(" ; "), over } : null };
}
