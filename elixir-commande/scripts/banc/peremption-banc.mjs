// ── Banc d'essai : « Odoo facture la remise » (Péremption courte, V1) sur un faux Odoo et un faux Supabase en mémoire ──
// Le banc (plugin.mjs) envoie ici peremption (GET et POST) et odoo-catalog?expiry_months=4 : le VRAI code de
// netlify/functions/peremption.js et _peremption.js tourne, branché sur scripts/peremption-faux.mjs. Rien ne part vers Odoo
// ni Supabase. Données (hors git, dev-fixtures/) : peremption-odoo.json (relevé Odoo du 20/10/2026 des 178 produits de la
// page : lots, prix par liste, coût, règles), peremption-ventes.json (ventes 30 j), get/odoo-catalog__expiry_months=4.json
// (la page), config-get__key=admin_promos.json, products-get.json (menus).
// Variables : BANC_PEREMPTION_MODE=simulation|actif|creations_suspendues (défaut simulation), BANC_PEREMPTION_ECRITURE=1
// (variable Netlify simulée ; écritures dans le FAUX Odoo seulement), BANC_PEREMPTION_ESSAI=1 (au démarrage, remises
// d'exemple appliquées par le vrai code : Zinnat −12 %, Pneumovax −40 %, Surgam −45 %, avec confirmation sous le coût).
// Règle panier (21/10/2026, docs/peremption.md) : tables expiry_discounts (remise affichée de l'admin) et peremption_ecarts
// (suivi des rectifications) en mémoire ; BANC_PEREMPTION_ECARTS=1 : commandes du site d'exemple (pharmacies fictives,
// passées ce jour) avec des lignes « Pér. » facturées plus cher par le faux Odoo, dont une commande à part (separeDe) et une
// ligne déjà marquée « rectifiée » — pour le Contrôle des écarts de l'admin.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOSSIER_FIXTURES, DOSSIER_GET } from "./commun.mjs";
import { fauxOdoo, fauxSupabase, mondeDepuisReleve } from "../peremption-faux.mjs";
import { creerPeremption } from "../../netlify/functions/_peremption.js";
import { creerHandler } from "../../netlify/functions/peremption.js";

const lit = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
let monde = null;

export function mondePeremption() {
  if (monde) return monde;
  const releve = lit(resolve(DOSSIER_FIXTURES, "peremption-odoo.json"));
  const page = lit(resolve(DOSSIER_GET, "odoo-catalog__expiry_months=4.json"))?.products || [];
  if (!releve) return null;
  const top = lit(resolve(DOSSIER_FIXTURES, "peremption-ventes.json"))?.top || [];
  const ventes = {};
  for (const r of releve.rows || []) { const v = top.find(x => String(r.name || "").startsWith(x.n)); if (v) ventes[r.pid] = { lgo: v.lgo, site: v.site }; }
  const w = mondeDepuisReleve(releve, page, { ventes });
  const O = fauxOdoo(w);
  const promos = lit(resolve(DOSSIER_GET, "config-get__key=admin_promos.json"));
  const produits = lit(resolve(DOSSIER_GET, "products-get.json"))?.products || [];
  const S = fauxSupabase({ tables: {
    odoo_catalog: w.catalogue.map(c => ({ ...c, lots: Array.isArray(c.lots) ? JSON.stringify(c.lots) : c.lots })),
    ec_config: promos ? [{ key: "admin_promos", value: typeof promos.value === "string" ? promos.value : JSON.stringify(promos.value ?? []) }] : [],
    elixir_products: produits.map(p => ({ cip: p.cip, section: p.section })),
    expiry_discounts: [], peremption_ecarts: [],
  } });
  const mode = ["actif", "creations_suspendues"].includes(process.env.BANC_PEREMPTION_MODE) ? process.env.BANC_PEREMPTION_MODE : "simulation";
  S.table("peremption_reglages")[0].mode = mode;
  const env = { SUPABASE_KEY: S.cleAnon, ...(process.env.BANC_PEREMPTION_ECRITURE === "1" ? { PEREMPTION_ODOO_ECRITURE: "1" } : {}) };
  const X = creerPeremption({ odoo: O.odoo, fetch: S.fetch, url: S.url, cle: S.cleService, env });
  const handler = creerHandler({ peremption: X, verifyAdmin: async () => ({ admin: { email: "admin@banc.local" } }), isCronAuthorized: () => true });
  monde = { O, S, X, handler, pret: null };
  if (process.env.BANC_PEREMPTION_ESSAI === "1") monde.pret = essai(X).catch(e => console.error("[banc péremption] essai :", e.message));
  if (process.env.BANC_PEREMPTION_ECARTS === "1") semerEcarts(O, S, w.catalogue);
  return monde;
}

// Commandes d'exemple pour le Contrôle des écarts (pharmacies fictives) : lignes « Pér. » au prix de la page (−50 %) que le
// faux Odoo facture au prix de la liste n° 5 ; Hec : 3 au menu (commande A) + 2 en péremption (commande B, à part), additionnées
// par le connecteur sur une ligne de 5 sous la référence de A ; Euphytose : déjà rectifiée (avoir d'exemple).
function semerEcarts(O, S, catalogue) {
  const c = (cip) => catalogue.find(x => x.cip === cip);
  const pid = (cip) => O.parCip.get(cip)?.id;
  const page = (cip) => Math.round(Number(c(cip).list_price) * 50) / 100;
  const ligne = (cip, qty, extra = {}) => ({ cip, name: c(cip).name, qty, pn: page(cip), total: Math.round(page(cip) * qty * 100) / 100, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false, ...extra });
  const vente = (cip, qte, ref, commande) => { const x = c(cip); O.ajouterVente({ pid: pid(cip), qte, ref: String(ref), pu: Number(x.list_price), remise: Math.round((1 - Number(x.discounted_price) / Number(x.list_price)) * 10000) / 100, commande }); };
  const t = Date.now();
  const A = t - 3 * 3600e3, B = A + 2, C = t - 2 * 3600e3, D = t - 3600e3;
  const HEC = "3400930470312", EUPHY = "3534510001778", ZADI = "3400932448951", RULID = "3400933761318", VERCYTE = "3400934872730";
  if (![HEC, EUPHY, ZADI, RULID, VERCYTE].every(x => c(x) && pid(x))) { console.error("[banc péremption] écarts d'exemple : produits absents du relevé"); return; }
  vente(HEC, 5, A, "S900101"); vente(ZADI, 2, A, "S900101");
  vente(RULID, 3, C, "S900102"); vente(EUPHY, 2, C, "S900102");
  vente(VERCYTE, 1, D, "S900103");
  S.table("elixir_orders").push(
    { id: A, date: new Date(A).toISOString(), pharmacy_name: "PHARMACIE DU BANC D'ESSAI", pharmacy_cip: "9999999", source: "catalogue",
      items: [{ cip: HEC, name: c(HEC).name, qty: 3, pn: Number(c(HEC).discounted_price), total: Math.round(Number(c(HEC).discounted_price) * 300) / 100 }, ligne(ZADI, 2)] },
    { id: B, date: new Date(B).toISOString(), pharmacy_name: "PHARMACIE DU BANC D'ESSAI", pharmacy_cip: "9999999", source: "catalogue", items: [ligne(HEC, 2, { separeDe: String(A) })] },
    { id: C, date: new Date(C).toISOString(), pharmacy_name: "PHARMACIE EXEMPLE DES LILAS", pharmacy_cip: "9999998", source: "catalogue", items: [ligne(RULID, 3), ligne(EUPHY, 2)] },
    { id: D, date: new Date(D).toISOString(), pharmacy_name: "PHARMACIE EXEMPLE DU MARCHÉ", pharmacy_cip: "9999997", source: "catalogue", items: [ligne(VERCYTE, 1)] });
  S.table("peremption_ecarts").push({ cle: `${C}:${EUPHY}`, commande: String(C), cip: EUPHY, pharmacie: "PHARMACIE EXEMPLE DES LILAS", commande_odoo: "S900102", nom: c(EUPHY).name, qte: 2,
    prix_page: page(EUPHY), prix_facture: Number(c(EUPHY).discounted_price), ecart: Math.round((Number(c(EUPHY).discounted_price) - page(EUPHY)) * 200) / 100, statut: "rectifie",
    reference: "AV-2026-0042 (exemple)", par: "admin@banc.local", le: new Date(t - 1800e3).toISOString(), created_at: new Date(t).toISOString(), updated_at: new Date(t).toISOString() });
}

// Remises d'exemple (vrai code, faux Odoo) : aperçu puis application, comme l'admin
async function essai(X) {
  await X.reconcilier({ acteur: "nuit", etendue: "nuit", budgetMs: 60000 });
  for (const [cip, remise] of [["3400933121549", 12], ["3400930044384", 40], ["3400932399482", 45]]) {
    const a = await X.apercu({ cips: [cip], remise, sousCout: { [cip]: true } });
    const p = a.produits[0];
    if (!p?.apercu_id) continue;
    // appliquer rend la main ; le passage avance par « etape », comme suivre() de l'admin
    let r = await X.appliquer({ cips: [cip], remise, sousCout: { [cip]: true }, apercus: { [cip]: p.apercu_id }, acteur: "admin@banc.local" });
    for (let n = 0; r && !r.fini && r.passage_id && n < 50; n++) r = { ...(await X.etape({ passageId: r.passage_id, acteur: "admin@banc.local", budgetMs: 60000 })), passage_id: r.passage_id };
  }
}

// Requête du banc → événement Netlify → réponse { statut, corps }
export async function repondrePeremption({ methode, url, corps }) {
  const m = mondePeremption();
  if (!m) return null;
  if (m.pret) await m.pret;
  const u = new URL(url, "http://banc.local/");
  const r = await m.handler({ httpMethod: methode, headers: { authorization: "Bearer banc" }, queryStringParameters: Object.fromEntries(u.searchParams), body: corps == null ? null : JSON.stringify(corps) });
  return { statut: r.statusCode, corps: JSON.parse(r.body || "null"), source: "banc péremption (vrai code, faux Odoo)" };
}
// Page de la Péremption du catalogue du banc (prix du site mis à jour par le vrai code)
export async function cataloguePeremption() {
  const m = mondePeremption();
  if (!m) return null;
  if (m.pret) await m.pret;
  const rows = m.S.table("odoo_catalog").map(c => ({ ...c, lots: typeof c.lots === "string" ? JSON.parse(c.lots || "[]") : c.lots || [] }));
  return { products: rows, total: rows.length };
}
