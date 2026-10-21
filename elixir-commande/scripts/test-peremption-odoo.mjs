// Tests de « Odoo facture la remise » (V1, conception § 13) : node scripts/test-peremption-odoo.mjs
// Hors ligne : faux Odoo (règles en mémoire, prix facturé = MINIMUM des règles applicables, dates et quantités minimales
// respectées, rapport des listes au format réel) et faux Supabase (PostgREST, index uniques, journal en ajout seul, RLS),
// scripts/peremption-faux.mjs. Aucune écriture réelle, ni Odoo, ni Supabase, ni PharmaML.
//  • parties pures : fenêtre, date de fin, rapport, stock par lot, cible, valeurs envoyées, réglages, verrous ;
//  • éligibilité : seulement court, lot long (forcé ou non), court épuisé (« fantôme »), sortie par la date, stock sans
//    date, multi-CIP, menu promo, campagne, justificatif, Sanofi Pro, sans effet (Hec −5 %), sous le coût, plafonds ;
//  • simulation : AUCUN create/write/unlink (le faux Odoo lève et compte toute tentative), plan journalisé « simule » ;
//    sans PEREMPTION_ODOO_ECRITURE, ou mode ≠ Actif : aucune écriture ;
//  • création : valeurs exactes (applied_on, compute_price, nombres décimaux, dates UTC), 6 listes dont la 25, jamais la
//    4, relecture, contrôle par le rapport, prix du site, la page n'annonce qu'à la fin ;
//  • idempotence : appel rejoué, coupure entre create et l'enregistrement (adoption par date_start), verrou ;
//  • échec partiel (liste 1112), complément au passage suivant, 3e échec → erreur et alerte ;
//  • retrait : A puis B, report tant qu'une commande contient le CIP, règle modifiée ou supprimée à la main, « Tout
//    retirer » sur nos seuls identifiants ; disjoncteurs ; règle datée inconnue jamais touchée ;
//  • page publique : ni coût ni marge, remise seulement si facturée et reprise par le prix du site, « fantômes » masqués ;
//  • HTTP (peremption.js) : page publique, admin, cron, confirmations ; nuit pas à pas ; écarts ; droits.
process.env.ODOO_APIKEY = process.env.ODOO_APIKEY || "test-hors-ligne";   // odoo.js (importé par odoo-price-sync) : pas d'avertissement
import { readFileSync } from "node:fs";
import { fauxOdoo, fauxSupabase, bareme5 } from "./peremption-faux.mjs";
const M = await import("../netlify/functions/_peremption.js");
const { creerHandler } = await import("../netlify/functions/peremption.js");
const { indexRegles, prixUnitaire } = await import("../netlify/functions/odoo-price-sync.js");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// ── 1. Parties pures ──
// (règle panier du 21/10/2026 : écarts d'une ligne, section 15)
const T0 = Date.parse("2026-10-21T09:14:07Z");
eq("fenêtre de la page (UTC) : J+30 → fin du 4e mois", M.fenetre(T0), { aujourdhui: "2026-10-21", min: "2026-11-20", max: "2027-02-28" });
eq("date de fin : lot court − 30 j, 22:59:59 UTC (28/02/2027 → 29/01/2027)", M.finRegle("2027-02-28"), "2027-01-29T22:59:59.000Z");
eq("datetime Odoo", [M.versOdoo(T0), M.depuisOdoo("2026-10-21 09:14:07") === T0], ["2026-10-21 09:14:07", true]);
{
  const html = readFileSync(new URL("./banc/peremption-rapport-exemple.html", import.meta.url), "utf8");
  eq("rapport Odoo (HTML relevé le 20/10/2026) : prix par produit", M.lireRapport(html), { 44966: 3.51, 44113: 9.76 });
  eq("rapport : séparateur de milliers et virgule", M.lireRapport('<tr><a data-res-id="7"></a><span class="oe_currency_value">1 417,48</span></tr>'), { 7: 1417.48 });
}
{
  const fen = M.fenetre(T0);
  const q = (lot, qte, loc = 8, reserve = 0) => ({ product_id: [1, "x"], lot_id: lot ? [lot, "L"] : false, location_id: [loc, "x"], quantity: qte, reserved_quantity: reserve });
  const lots = { 11: "2026-12-31 22:59:59", 12: "2028-05-31 22:59:59", 13: false, 14: "2027-02-28 22:59:59" };
  eq("stock : court, long, sans date ; réservé et quarantaine retirés", M.classerStock([q(11, 43), q(12, 109), q(13, 2), q(null, 3), q(14, 5, 8, 4.5), q(11, 7, 1789)], lots, new Set([1789]), fen),
    { court_qte: 43, court_fin: "2026-12-31", long_qte: 109, long_debut: "2028-05-31", autre_qte: 5 });
  eq("stock : deux lots courts → le plus proche", M.classerStock([q(14, 3), q(11, 2)], lots, new Set(), fen).court_fin, "2026-12-31");
}
const R0 = M.normaliserReglages({});
eq("réglages : propositions de la conception", [R0.mode, R0.listes, R0.base_remise, R0.remise_auto_pct, R0.sous_cout, R0.lot_long_recu, R0.delai_retrait_min, R0.seuil_annonce_pct, R0.plafond_produits_par_lot, R0.plafond_produits_factures],
  ["simulation", [5, 15, 1110, 1112, 1114, 25], "prix_base", null, "confirmation", "retrait", 120, 5, 40, 120]);
eq("réglages : jamais la liste 4, toujours la 5", M.normaliserReglages({ listes: [4, 15, "1112"] }).listes, [5, 15, 1112]);
eq("verrous : variable ET mode Actif", [M.verrous({ mode: "actif" }, {}), M.verrous({ mode: "simulation" }, { PEREMPTION_ODOO_ECRITURE: "1" }), M.verrous({ mode: "actif" }, { PEREMPTION_ODOO_ECRITURE: "1" }), M.verrous({ mode: "creations_suspendues" }, { PEREMPTION_ODOO_ECRITURE: "1" })].map(v => [v.creation, v.retrait]),
  [[false, false], [false, false], [true, true], [false, true]]);
eq("cible : % du prix de base (Zinnat −10 % : 3,37 €)", M.cibleRemise({ list_price: 3.74, prix_listes: { 5: 3.51 } }, 10, R0), { percent_price: 10, prix_vise: 3.37 });
{
  const c = M.cibleRemise({ list_price: 3.74, prix_listes: { 5: 3.51 } }, 10, { base_remise: "prix_liste5" });
  eq("cible : % du prix habituel liste 5 (réglage) → 3,16 € = 3,51 × 0,9 ; remise posée avec 2 décimales (précision « Discount » de la ligne de vente)", [c.prix_vise, c.percent_price], [3.16, 15.53]);
}
{
  const v = M.valeursRegle({ liste: 25, tmpl: 44966, percent: 12.5, debut: T0, fin: M.finRegle("2027-02-28") });
  eq("valeurs envoyées à Odoo : forme exacte", v, { pricelist_id: 25, applied_on: "1_product", product_tmpl_id: 44966, compute_price: "percentage", percent_price: 12.5, base: "list_price",
    min_quantity: 0, date_start: "2026-10-21 09:14:07", date_end: "2027-01-29 22:59:59" });
  eq("valeurs envoyées : nombre décimal en JSON (pas d'arrondi XML-RPC)", JSON.stringify(v.percent_price), "12.5");
}
{
  // copie de applyRule (paliers) : même prix que prixUnitaire d'odoo-price-sync sur une règle seule
  const regles = [{ ao: "1_product", cp: "fixed", fp: 3.06, tid: 9, mq: 0 }, { ao: "1_product", cp: "percentage", pp: 37, tid: 9, mq: 0 }, { ao: "1_product", cp: "formula", pd: 12, ps: -0.4, tid: 9, mq: 0 }];
  for (const r of regles) {
    const ix = indexRegles([{ ...r, pid: 0, cid: 0, ds: "", de: "" }], "2026-10-21");
    const lp = 6.12;
    eq(`prixRegle = prixUnitaire d'odoo-price-sync (${r.cp})`, Math.min(M.prixRegle(r, lp), bareme5(lp)), prixUnitaire({ list_price: lp, odoo_pid: 0, odoo_tmpl_id: 9, categ_id: 0 }, ix, {}));
  }
}
{
  // statique : jamais odoo.js (XML-RPC arrondit) ; écriture Odoo seulement par ecrireOdoo
  const src = lire("netlify/functions/_peremption.js");
  vrai("_peremption.js n'importe jamais odoo.js", !/from\s+["']\.\/odoo\.js["']/.test(src) && /from "\.\/_odoo-rpc\.js"/.test(src));
  vrai("peremption.js et peremption-cron.js n'importent pas odoo.js", ![lire("netlify/functions/peremption.js"), lire("netlify/functions/peremption-cron.js")].some(t => /from\s+["']\.\/odoo\.js["']/.test(t)));
  const ecritures = [...src.matchAll(/([\w.]+)\(([^()]*?)"product\.pricelist\.item", "(create|write|unlink)"/g)];
  vrai("toute écriture product.pricelist.item passe par ecrireOdoo (4 appels : créer, modifier remise ou date avec intention enregistrée, supprimer, supprimer un doublon du site)",
    ecritures.length === 4 && ecritures.every(m => m[1] === "ecrireOdoo"));
  vrai("lire() refuse toute méthode d'écriture", /if \(ECRITURES\.has\(method\)\) throw/.test(src));
  vrai("jamais la liste 4 : refusée par la porte d'écriture", /liste 4 \(Export\) interdite/.test(src));
}

// ── Monde d'essai (relevé Odoo du 20/10/2026, simplifié) ──
const P = {
  ZINNAT: { id: 44966, cip: "3400933121549", nom: "ZINNAT 125 mg B/8", tmpl: 44966, list_price: 3.74, cout: 3.44 },
  HEC: { id: 44113, cip: "3400930470312", nom: "HEC POM NACU T/25G", tmpl: 44113, list_price: 10.32, cout: 8.54 },
  ZADI: { id: 44622, cip: "3400932448951", nom: "ZADITEN 1 mg/5 ml", tmpl: 44622, list_price: 3.83, cout: 3.53 },
  FANTOME: { id: 45001, cip: "3400935000017", nom: "PARLODEL 10 mg", tmpl: 45001, list_price: 8.2, cout: 7.6 },
  FFP2: { id: 45002, cip: "3401560000022", nom: "FFP2 NR x10", tmpl: 45002, list_price: 5.99, cout: 0 },
  PROMO: { id: 45003, cip: "3400935000031", nom: "PRODUIT EN MENU PROMO", tmpl: 45003, list_price: 6, cout: 2 },
  CAMP: { id: 45004, cip: "3400935000048", nom: "PRODUIT EN CAMPAGNE", tmpl: 45004, list_price: 6, cout: 2 },
  TAKEDA: { id: 39909, cip: "3400930077696", nom: "NINLARO 2,3 mg B/3", tmpl: 39909, list_price: 5000, cout: 4000 },
  FAUTEUIL: { id: 45005, cip: "3662050045614", nom: "FAUTEUIL ACTION 2NG 40,5", tmpl: 45005, list_price: 300, cout: 150 },
  SANOFI: { id: 45006, cip: "3400930999999", nom: "DUPIXENT 300 mg", tmpl: 45006, list_price: 900, cout: 500 },
  PROCHE: { id: 45007, cip: "3400935000055", nom: "LOT AU 20/11", tmpl: 45007, list_price: 12, cout: 4 },
  SURB: { id: 45008, cip: "3400935000062", nom: "SURBRONC 30 mg", tmpl: 45008, list_price: 7.03, cout: 5.86 },
  RENI: { id: 45009, cip: "3400935000079", nom: "RENITEC 20 mg", tmpl: 45009, list_price: 9.5, cout: 3 },
};
const PRIX = {   // prix facturé par liste sans les règles du site (relevé), liste 5 : barème + règles commerciales
  ZINNAT: { 15: 3.54, 25: 3.54, 1110: 3.54, 1112: 3.51, 1114: 3.45 }, HEC: { 15: 9.76, 25: 9.96, 1110: 9.76, 1112: 9.76, 1114: 7.86 },
  ZADI: { 15: 3.63, 25: 3.63, 1110: 3.63, 1112: 3.6, 1114: 3.54 }, FANTOME: {}, FFP2: { 25: 5.78 }, PROMO: {}, CAMP: {}, TAKEDA: {}, FAUTEUIL: {}, SANOFI: {}, PROCHE: {},
  SURB: { 15: 6, 25: 6.78, 1110: 6, 1112: 6, 1114: 6 }, RENI: {},
};
const LONG = { ZADI: [{ exp: "2026-12-31", qte: 43 }, { exp: "2028-05-31", qte: 109 }], FANTOME: [{ exp: "2026-12-31", qte: 1, loc: 1789 }, { exp: "2028-03-31", qte: 5 }],
  PROCHE: [{ exp: "2026-11-24", qte: 6 }], RENI: [{ exp: "2027-01-31", qte: 41 }, { lot: false, qte: 2 }] };
// latence : { odoo, sb } en ms par appel, ajoutés à l'horloge simulée (durée des appels HTTP, revue V1) ; crochet(model,
// method, args) : appelé après chaque appel Odoo réussi (concurrence simulée)
function monde({ env = { PEREMPTION_ODOO_ECRITURE: "1" }, mode = "actif", reglages = {}, t = T0, latence = null, crochet = null, suiviEcarts = true, remisesAffichees = [] } = {}) {
  const horloge = { t };
  const maintenant = () => horloge.t;
  const quants = [];
  for (const [k, p] of Object.entries(P)) for (const q of LONG[k] || [{ exp: k === "HEC" ? "2026-12-31" : "2027-02-28", qte: k === "ZINNAT" ? 10 : k === "HEC" ? 288 : 20 }]) quants.push({ pid: p.id, ...q });
  const prixListes = {};
  for (const [k, pr] of Object.entries(PRIX)) for (const [l, v] of Object.entries(pr)) (prixListes[l] ||= {})[P[k].id] = v;
  const O = fauxOdoo({ produits: Object.values(P), quants, prixListes,
    regles: [{ liste: 5, tmpl: P.HEC.tmpl, fixe: 9.76 }, { liste: 15, tmpl: P.HEC.tmpl, fixe: 9.76 }, { liste: 5, tmpl: P.FFP2.tmpl, fixe: 2.99 }, { liste: 15, tmpl: P.FFP2.tmpl, fixe: 2.99 },
      { liste: 1110, tmpl: P.FFP2.tmpl, fixe: 2.99 }, { liste: 1112, tmpl: P.FFP2.tmpl, fixe: 2.99 }, { liste: 1114, tmpl: P.FFP2.tmpl, fixe: 2.99 }, { liste: 5, tmpl: P.SURB.tmpl, fixe: 6 },
      { liste: 5, tmpl: P.ZADI.tmpl, fixe: 3.4, mq: 6 }],
    ventes: [{ pid: P.HEC.id, qte: 26, ref: "LGO-9" }, { pid: P.HEC.id, qte: 7, ref: "1792359187062" }, { pid: P.SURB.id, qte: 104, ref: "LGO-7" }],
    commandesListes: [{ liste: 5, n: 6628 }, { liste: 15, n: 62 }, { liste: 25, n: 10 }, { liste: 1110, n: 112 }, { liste: 1112, n: 192 }, { liste: 1114, n: 74 }, { liste: 4, n: 3 }] }, { maintenant });
  const cat = Object.entries(P).map(([k, p]) => {
    const l5 = O.prixFacture(p.id, 5);
    const stock = (LONG[k] || [{ exp: k === "HEC" ? "2026-12-31" : "2027-02-28" }]).filter(x => x.exp).map(x => x.exp).sort()[0];
    return { cip: p.cip, name: p.nom, list_price: p.list_price, discounted_price: l5 < p.list_price ? l5 : null, discount_pct: l5 < p.list_price ? Math.round((1 - l5 / p.list_price) * 1000) / 10 : 0,
      price_tiers: k === "ZADI" ? [{ min_qty: 6, price: 3.4, pct: 11.2 }] : null, in_stock: true, available: 20, earliest_expiry: stock, lots: JSON.stringify([{ lot_name: "L1", qty: 10, expiry: stock }]),
      odoo_pid: p.id, odoo_tmpl_id: p.tmpl, categ_id: 1, updated_at: new Date(t - 3600e3).toISOString() };
  });
  const S = fauxSupabase({ maintenant, tables: {
    odoo_catalog: cat,
    ec_config: [{ key: "admin_promos", value: JSON.stringify([{ id: 1, name: "Offre", active: true, products: [{ cip: P.PROMO.cip, pn: 3, pv: 6 }] }]) }],
    elixir_products: [{ cip: P.CAMP.cip, section: "camp-1" }, { cip: P.HEC.cip, section: "otc" }],
    elixir_campaigns: [{ id: "camp-1", active: true }],
    kv_store: [{ key: "sp:ord:1", value: JSON.stringify({ lignes: [{ code: P.SANOFI.cip, qte: 1 }] }), updated_at: new Date(t).toISOString() }],
    // règle panier (21/10/2026) : remises affichées de l'admin (table publique existante) et suivi des écarts (sql/peremption-ecarts.sql)
    expiry_discounts: remisesAffichees,
    ...(suiviEcarts ? { peremption_ecarts: [] } : {}),
  } });
  S.table("peremption_reglages")[0] = { ...S.table("peremption_reglages")[0], mode, ...reglages };
  const odoo = latence || crochet ? async (m, me, a, k) => { horloge.t += latence?.odoo || 0; const r = await O.odoo(m, me, a, k); if (crochet) await crochet(m, me, a); return r; } : O.odoo;
  const fetchS = latence ? async (...a) => { horloge.t += latence.sb || 0; return S.fetch(...a); } : S.fetch;
  const X0 = M.creerPeremption({ odoo, fetch: fetchS, url: S.url, cle: S.cleService, env: { SUPABASE_KEY: S.cleAnon, ...env }, maintenant });
  // appliquer, retirer et reessayer enregistrent le passage et rendent la main (le navigateur fait avancer par « etape ») :
  // ici, menés jusqu'au bout comme le fait suivre() de l'admin ; X.brut : réponses telles quelles
  const suite = (f) => async (o) => jusquauBout(X0, await f(o), o?.acteur);
  const X = { ...X0, appliquer: suite(X0.appliquer), retirer: suite(X0.retirer), reessayer: suite(X0.reessayer), brut: X0 };
  return { O, S, X, horloge, avance: (min) => { horloge.t += min * 60e3; } };
}
async function jusquauBout(X0, r, acteur = "z") {
  let cur = r, n = 0;
  while (cur && !cur.fini && !cur.erreur && cur.passage_id && n++ < 200) cur = { ...(await X0.etape({ passageId: cur.passage_id, acteur, budgetMs: 60000 })), passage_id: cur.passage_id, refus: r.refus, commandes_en_cours: r.commandes_en_cours };
  return cur;
}
const journalDe = (S, action) => S.table("peremption_journal").filter(j => !action || j.action === action);
const decisionDe = (S, cip) => S.table("peremption_decisions").filter(d => d.cip === cip).at(-1);
const reglesSite = (O) => O.reglesSite();
const catDe = (S, cip) => S.table("odoo_catalog").find(c => c.cip === cip);

// ── 2. Faits frais et éligibilité ──
{
  const { X } = monde();
  const { faits, absents, douteux } = await X.lireFaits(Object.values(P).map(p => p.cip), { listes: M.LISTES_DEFAUT });
  eq("faits : tous lus, aucun douteux", [Object.keys(faits).length, absents, douteux], [Object.keys(P).length, [], false]);
  const z = faits[P.ZINNAT.cip];
  eq("faits Zinnat : stock court seul, prix par liste (rapport), coût, ventes", [z.court_qte, z.court_fin, z.long_qte, z.autre_qte, z.prix_listes, z.cout, z.ventes_30j],
    [10, "2027-02-28", 0, 0, { 5: 3.51, 15: 3.54, 1110: 3.54, 1112: 3.51, 1114: 3.45, 25: 3.54 }, 3.44, { lgo: 0, site: 0, autre: 0 }]);
  eq("faits Hec : ventes par canal (LGO, site)", faits[P.HEC.cip].ventes_30j, { lgo: 26, site: 7, autre: 0 });
  eq("faits : exclusions (menu promo, campagne, justificatif, multi-CIP, Sanofi Pro)", [P.PROMO, P.CAMP, P.TAKEDA, P.FAUTEUIL, P.SANOFI].map(p => faits[p.cip].exclusions),
    [["menu_promo"], ["campagne"], ["justificatif"], ["multi_cip"], ["sanofipro"]]);
  eq("faits « fantôme » : boîte courte en quarantaine, lot long reçu", [faits[P.FANTOME.cip].court_qte, faits[P.FANTOME.cip].long_qte], [0, 5]);
  const R = M.normaliserReglages({});
  const el = (k, o) => M.eligibilite(faits[P[k].cip], R, T0, o);
  eq("Zinnat −10 % (essai T2 de la conception) : 3,37 € contre 3,51 €, 4 % d'économie < seuil de 5 % → sans effet", el("ZINNAT", { remise: 10, sousCout: true }).statut, "sans_effet");
  eq("Zinnat −11 % : 3,33 €, juste au seuil → remisable", el("ZINNAT", { remise: 11, sousCout: true }).ok, true);
  eq("Zinnat −12 % : sous le coût, à confirmer", [el("ZINNAT", { remise: 12 }).ok, el("ZINNAT", { remise: 12 }).raisons.map(r => r.code)], [false, ["sous_cout"]]);
  eq("Zinnat −12 % confirmé : remisable ; pertes", [el("ZINNAT", { remise: 12, sousCout: true }).ok, el("ZINNAT", { remise: 12, sousCout: true }).pertes],
    [true, { cout: 3.44, cout_inconnu: false, sous_cout: true, marge_pct: -4.6, perte_boite: 0.15, qte: 10, perte_totale: 1.5, perte_court: 1.5, destruction: 34.4, effet_lgo_mois: 0, ventes_lgo_30j: 0, remise_max_sans_perte: 8 }]);
  eq("proposé « À remiser » : seulement court, sans exclusion", [el("ZINNAT").propose, el("ZADI").propose, el("PROMO").propose, el("FANTOME").propose], [true, false, false, false]);
  eq("lot long non forcé : refusé", el("ZADI", { remise: 30, sousCout: true }).raisons.map(r => r.code), ["lot_long"]);
  eq("lot long forcé (109 boîtes acceptées) : remisable", el("ZADI", { remise: 30, sousCout: true, force: 109 }).ok, true);
  eq("lot long forcé avec un compte dépassé (100 < 109) : refusé", el("ZADI", { remise: 30, sousCout: true, force: 100 }).raisons.map(r => r.code), ["lot_long"]);
  eq("forcé : la perte compte aussi les boîtes longues", el("ZADI", { remise: 30, sousCout: true, force: 109 }).pertes.qte, 152);
  eq("stock sans date : traité comme un lot long", el("RENI", { remise: 30 }).raisons.map(r => r.code), ["lot_long"]);
  eq("court épuisé (« fantôme ») : refusé", el("FANTOME", { remise: 30, force: 5 }).raisons[0].code, "court_epuise");
  eq("exclusions : non remisable", ["PROMO", "CAMP", "TAKEDA", "FAUTEUIL", "SANOFI"].map(k => el(k, { remise: 30, sousCout: true }).statut), ["exclu", "exclu", "exclu", "exclu", "exclu"]);
  eq("sans effet : Hec −5 % (9,80 € > 9,76 € habituel)", el("HEC", { remise: 5 }).statut, "sans_effet");
  eq("FFP2 : coût non renseigné → confirmation", el("FFP2", { remise: 60 }).raisons.map(r => r.code), ["sous_cout"]);
  eq("sous le coût interdit (réglage)", M.eligibilite(faits[P.ZINNAT.cip], M.normaliserReglages({ sous_cout: "interdit" }), T0, { remise: 12, sousCout: true }).raisons.map(r => r.code), ["sous_cout_interdit"]);
  eq("perte maximale par produit (réglage 1 €)", M.eligibilite(faits[P.ZINNAT.cip], M.normaliserReglages({ perte_max_produit: 1 }), T0, { remise: 12, sousCout: true }).raisons.map(r => r.code), ["perte_max"]);
  eq("ventes LGO (réglage 0 : produits non vendus par LGO seulement)", M.eligibilite(faits[P.SURB.cip], M.normaliserReglages({ ventes_lgo_max: 0 }), T0, { remise: 40, sousCout: true }).raisons.map(r => r.code), ["lgo"]);
  eq("plafond des produits facturés", M.eligibilite(faits[P.RENI.cip], M.normaliserReglages({ plafond_produits_factures: 3 }), T0, { remise: 30, force: 2, nbFacturees: 3 }).raisons.map(r => r.code), ["plafond"]);
  eq("plafond d'une application en lot", el("ZINNAT", { remise: 12, sousCout: true, lot: 41 }).raisons.map(r => r.code), ["plafond_lot"]);
  eq("remise hors bornes (0, 91, 12,5)", [0, 91, 12.5].map(r => el("ZINNAT", { remise: r }).raisons[0].code), ["remise", "remise", "remise"]);
  {
    // demi-centime (Oroken 200, banc du 20/10/2026) : 6,35 × 0,7 = 4,445 → Odoo 4,45 € (float_round), synchro du site 4,44 €
    const oro = { ...faits[P.ZINNAT.cip], list_price: 6.35, cout: 5.94, prix_listes: { 5: 6.06, 15: 6.06, 1110: 6.06, 1112: 6.03, 1114: 6, 25: 6.13 } };
    eq("demi-centime : détecté en centimes exacts", [M.demiCentime(6.35, 30), M.demiCentime(6.3500000000000005, 30), M.demiCentime(6.35, 29), M.demiCentime(3.74, 12)], [true, true, false, false]);
    eq("demi-centime : la synchro du site (applyRule, Math.round flottant) et Odoo divergent d'un centime", [M.prixRegle({ cp: "percentage", pp: 30 }, 6.35), (await import("./peremption-faux.mjs")).arrondiOdoo(6.35 * 0.7)], [4.44, 4.45]);
    eq("remise tombant sur un demi-centime : refusée, le pourcentage voisin passe", [M.eligibilite(oro, R, T0, { remise: 30, sousCout: true }).raisons.map(r => r.code), M.eligibilite(oro, R, T0, { remise: 29, sousCout: true }).ok],
      [["arrondi"], true]);
    eq("prix visé calculé en centimes (4,51 € pour −29 %)", M.cibleRemise(oro, 29, R).prix_vise, 4.51);
  }
  const { X: X2 } = monde({ t: Date.parse("2026-10-26T09:00:00Z") });
  const f2 = (await X2.lireFaits([P.PROCHE.cip], { listes: [5] })).faits[P.PROCHE.cip];
  eq("sortie par la date : lot au 24/11, le 26/10 (J+30 = 25/11)", M.eligibilite(f2, R, Date.parse("2026-10-26T09:00:00Z"), { remise: 30 }).raisons[0].code, "sortie_date");
  // revue V1 (dates) : remise décidée le soir du dernier jour possible : la règle vivrait quelques heures, ou naîtrait expirée
  const fp = { ...faits[P.ZINNAT.cip], court_fin: "2026-11-20" };   // fin de règle : 21/10 22:59:59 UTC
  eq("fin trop proche : lot au 20/11, décidée le 21/10 à 9 h 14 (règle jusqu'à 22 h 59 UTC) → refusée", M.eligibilite(fp, R, T0, { remise: 12, sousCout: true }).raisons.map(r => r.code), ["fin_proche"]);
  eq("fin trop proche : décidée à 23 h 30 UTC (date_end déjà passée) → refusée", M.eligibilite(fp, R, Date.parse("2026-10-21T23:30:00Z"), { remise: 12, sousCout: true }).raisons[0].code, "fin_proche");
  eq("fin trop proche : ne vaut pas pour une décision existante (complément)", M.eligibilite(fp, R, T0, { remise: 12, sousCout: true, controleFin: false, decision: true }).ok, true);
}

// ── 3. Simulation : le plan seul, aucune écriture Odoo ──
{
  const { O, S, X } = monde({ mode: "simulation" });
  O.etat.interdireEcritures = true;
  const a = await X.apercu({ cips: [P.ZINNAT.cip], remise: 12, sousCout: { [P.ZINNAT.cip]: true } });
  const z = a.produits[0];
  eq("aperçu : 6 listes, prix aujourd'hui → après, jamais la 4", z.listes.map(l => [l.liste, l.prix_aujourdhui, l.prix_apres]),
    [[5, 3.51, 3.29], [15, 3.54, 3.29], [1110, 3.54, 3.29], [1112, 3.51, 3.29], [1114, 3.45, 3.29], [25, 3.54, 3.29]]);
  eq("aperçu : changement dans Odoo en clair", z.listes[0].changement, "Créer : « Produit ZINNAT 125 mg B/8 · Remise 12 % sur PGHT · qté min. 0 · du 21/10/2026 au 29/01/2027 »");
  eq("aperçu : fin automatique, stock, perte", [z.fin_regle, z.stock.court, z.pertes.perte_totale, z.eligibilite.ok, !!z.apercu_id], ["2027-01-29T22:59:59.000Z", 10, 1.5, true, true]);
  const r = await X.appliquer({ cips: [P.ZINNAT.cip], remise: 12, sousCout: { [P.ZINNAT.cip]: true }, apercus: { [P.ZINNAT.cip]: z.apercu_id }, acteur: "zineb@elixir.test" });
  const d = decisionDe(S, P.ZINNAT.cip);
  eq("simulation : décision simulée, restée « voulue »", [r.refus, d.simulee, d.statut], [[], true, "voulue"]);
  eq("simulation : AUCUN create, write ni unlink dans Odoo", [O.etat.ecritures.length, O.etat.ecrituresRefusees, reglesSite(O).length], [0, 0, 0]);
  const sim = journalDe(S, "creer");
  eq("simulation : 6 créations journalisées « simule », valeurs exactes", [sim.length, sim.every(j => j.resultat === "simule"), sim.map(j => j.pricelist_id), sim[0].apres.applied_on, sim[0].apres.compute_price, sim[0].apres.percent_price, sim[0].apres.date_end],
    [6, true, [5, 15, 1110, 1112, 1114, 25], "1_product", "percentage", 12, "2027-01-29 22:59:59"]);
  eq("simulation : prix du site inchangé, page sans remise", [catDe(S, P.ZINNAT.cip).discounted_price, (await X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip).facturee], [3.51, false]);
  const pr = await X.retirer({ cips: [P.ZINNAT.cip], toutDeSuite: true, acteur: "zineb@elixir.test" });
  eq("simulation : retrait d'une décision simulée, sans écriture", [decisionDe(S, P.ZINNAT.cip).statut, O.etat.ecrituresRefusees, O.etat.ecritures.length, pr.fini], ["retiree", 0, 0, true]);
  const n = await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("simulation : passage du filet sans écriture", [O.etat.ecrituresRefusees, O.etat.ecritures.length, n.fini], [0, 0, true]);
  for (let off = 0, g = 0; g < 20; g++) { const r2 = await X.passageNuit({ offset: off }); if (r2.done) break; off = r2.next_offset; }
  eq("simulation : nuit complète sans écriture ; résumé et alertes au journal seulement (« simule », aucun e-mail)",
    [O.etat.ecrituresRefusees, O.etat.ecritures.length, O.etat.mails.length, journalDe(S, "alerte").every(j => j.resultat === "simule"), journalDe(S, "resume").some(j => /Résumé de la nuit/.test(j.message) && j.resultat === "simule")], [0, 0, 0, true, true]);
  vrai("résumé de la nuit : hors des alertes (le panneau d'alertes n'est pas allumé chaque matin)", !journalDe(S, "alerte").some(j => /Résumé de la nuit/.test(j.message)));
  const m = await X.changerMode({ mode: "actif", acteur: "zineb@elixir.test" });
  eq("mode « Actif » refusé sans PEREMPTION_ODOO_ECRITURE (variable présente : voir ci-dessous)", m.erreur ? "refusé" : "accepté", "accepté");
}
{
  const { O, S, X } = monde({ mode: "actif", env: {} });
  O.etat.interdireEcritures = true;
  const m = await X.changerMode({ mode: "simulation", acteur: "z" });
  const m2 = await X.changerMode({ mode: "actif", acteur: "z" });
  eq("sans la variable : passage en « Actif » refusé", [m.mode, /PEREMPTION_ODOO_ECRITURE/.test(m2.erreur || "")], ["simulation", true]);
  S.table("peremption_reglages")[0].mode = "actif";   // mode laissé « Actif », variable retirée de Netlify
  await X.appliquer({ cips: [P.ZINNAT.cip], remise: 12, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  eq("mode Actif mais variable absente : aucune écriture, décision simulée", [O.etat.ecrituresRefusees, O.etat.ecritures.length, decisionDe(S, P.ZINNAT.cip).simulee], [0, 0, true]);
}
{
  const { O, X } = monde({ mode: "creations_suspendues" });
  const r = await X.appliquer({ cips: [P.ZINNAT.cip], remise: 12, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  eq("créations suspendues : appliquer refusé, rien écrit", [/suspendues/.test(r.erreur), O.etat.ecritures.length], [true, 0]);
}

// ── 4. Création (mode Actif, variable présente) ──
async function zinnatFacture(w, remise = 12) {   // aperçu puis application, menée jusqu'au bout
  const a = await w.X.apercu({ cips: [P.ZINNAT.cip], remise, sousCout: { [P.ZINNAT.cip]: true } });
  return w.X.appliquer({ cips: [P.ZINNAT.cip], remise, sousCout: { [P.ZINNAT.cip]: true }, apercus: { [P.ZINNAT.cip]: a.produits[0].apercu_id }, acteur: "zineb@elixir.test" });
}
{
  const w = monde();
  const { O, S, X } = w;
  const r = await zinnatFacture(w);
  const creations = O.etat.ecritures.filter(e => e.method === "create");
  eq("création : un seul create, 6 valeurs, listes 5 15 1110 1112 1114 25", [creations.length, creations[0].args[0].length, creations[0].args[0].map(v => v.pricelist_id)], [1, 6, [5, 15, 1110, 1112, 1114, 25]]);
  const v0 = creations[0].args[0][0];
  eq("création : valeurs exactes (applied_on et compute_price toujours précisés)", v0, { pricelist_id: 5, applied_on: "1_product", product_tmpl_id: 44966, compute_price: "percentage", percent_price: 12, base: "list_price", min_quantity: 0,
    date_start: "2026-10-21 09:12:07", date_end: "2027-01-29 22:59:59" });
  vrai("création : même date_start (repère) sur les 6 règles, et jamais la liste 4", creations[0].args[0].every(v => v.date_start === v0.date_start) && !creations[0].args[0].some(v => v.pricelist_id === 4));
  const regles = S.table("peremption_regles");
  eq("création : 6 règles actives, vérifiées, identifiants enregistrés", [regles.length, regles.every(x => x.statut === "active" && x.verifiee_at && x.odoo_item_id), regles.map(x => x.prix_verifie)],
    [6, true, [3.29, 3.29, 3.29, 3.29, 3.29, 3.29]]);
  eq("Odoo facture 3,29 € sur les 6 listes (logique MIN)", M.LISTES_DEFAUT.map(l => O.prixFacture(P.ZINNAT.id, l)), [3.29, 3.29, 3.29, 3.29, 3.29, 3.29]);
  eq("prix du site repris d'Odoo (discounted_price 3,29 €)", [catDe(S, P.ZINNAT.cip).discounted_price, catDe(S, P.ZINNAT.cip).discount_pct], [3.29, 12]);
  const d = decisionDe(S, P.ZINNAT.cip);
  eq("décision facturée", [d.statut, d.simulee, d.remise_pct, d.prix_attendu["5"], !!d.facturee_at, r.fini], ["facturee", false, 12, 3.29, true, true]);
  const page = await X.etatPublic();
  const z = page.produits.find(p => p.cip === P.ZINNAT.cip);
  eq("page : remise annoncée = facture (prix de base barré, −12 %, habituellement 3,51 €)", [z.facturee, z.prix, z.prix_base, z.remise_pct, z.prix_habituel], [true, 3.29, 3.74, 12, 3.51]);
  const ordre = S.etat.requetes.filter(q => ["peremption_regles", "odoo_catalog", "peremption_decisions"].includes(q.table) && q.methode !== "GET").map(q => q.table);
  vrai("ordre : règles (réservées puis enregistrées) → prix du site → décision facturée", ordre.indexOf("peremption_regles") < ordre.lastIndexOf("odoo_catalog") && ordre.lastIndexOf("odoo_catalog") < ordre.lastIndexOf("peremption_decisions"));
  const rejoue = await X.appliquer({ cips: [P.ZINNAT.cip], remise: 12, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  eq("appel rejoué (même remise) : rien de recréé", [rejoue.refus[0].raisons[0].code, O.etat.ecritures.filter(e => e.method === "create").length, reglesSite(O).length], ["deja", 1, 6]);
  const ap = await X.etape({ passageId: r.passage_id, acteur: "z" });
  eq("étape rejouée sur un passage fini : rien", [ap.fini, O.etat.ecritures.length], [true, 1]);
  const pub = JSON.stringify(page);
  vrai("page publique : ni coût, ni marge, ni perte, ni identifiant Odoo de règle", !/"cout"|marge|perte|standard_price|odoo_item_id|"decision"/.test(pub));
  // prix du site qui s'écarte (passage « Prix remisés » plus ancien) : la page cesse d'annoncer
  catDe(S, P.ZINNAT.cip).discounted_price = 3.51;
  eq("page : pas de remise si le prix du site n'est pas repris", (await X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip).facturee, false);
  catDe(S, P.ZINNAT.cip).discounted_price = 3.29;

  // ── 5. Modification : la remise monte (prix plus bas), puis baisse (page cachée d'abord) ──
  const m1 = await X.appliquer({ cips: [P.ZINNAT.cip], remise: 30, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  const ecr = O.etat.ecritures.filter(e => e.method === "write");
  eq("modification 12 → 30 % : un write sur nos 6 identifiants, percent_price seul", [ecr.length, ecr[0].args[0].length, ecr[0].args[1]], [1, 6, { percent_price: 30 }]);
  eq("modification : Odoo et le site à 2,62 €, décision facturée", [O.prixFacture(P.ZINNAT.id, 5), catDe(S, P.ZINNAT.cip).discounted_price, decisionDe(S, P.ZINNAT.cip).statut, m1.fini], [2.62, 2.62, "facturee", true]);
  S.etat.requetes = [];
  const ecrituresAvantBaisse = O.etat.ecritures.length;
  await X.appliquer({ cips: [P.ZINNAT.cip], remise: 20, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  const prixSite = S.etat.requetes.filter(q => q.table === "odoo_catalog" && q.methode === "PATCH").length;
  // revue V1 : une baisse est un retrait partiel → étape A tout de suite, écriture Odoo après le délai et les commandes
  eq("modification 30 → 20 % (baisse) : page sans remise et site au prix habituel tout de suite, Odoo encore à 30 % (en faveur de la pharmacie), aucune écriture",
    [prixSite, catDe(S, P.ZINNAT.cip).discounted_price, O.prixFacture(P.ZINNAT.id, 1114), decisionDe(S, P.ZINNAT.cip).statut, !!decisionDe(S, P.ZINNAT.cip).modification?.baisse, O.etat.ecritures.length - ecrituresAvantBaisse, (await X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip).facturee],
    [1, 3.51, 2.62, "voulue", true, 0, false]);
  S.table("kv_store").push({ key: "pmlr:tache:1792400000000", value: JSON.stringify({ ref: "1792400000000", etat: "a_envoyer", source: "site", creeA: new Date(w.horloge.t).toISOString(),
    corps: [{ lignes: [{ CIP: P.ZINNAT.cip, quantiteCommandee: 5, prix: 2.62 }] }] }), updated_at: new Date(w.horloge.t).toISOString() });
  await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("baisse : avant le délai de 2 h, rien n'est écrit", [O.etat.ecritures.length - ecrituresAvantBaisse, O.prixFacture(P.ZINNAT.id, 5)], [0, 2.62]);
  w.avance(121);
  await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("baisse : délai passé mais commande du relais en cours avec ce CIP → reportée (la commande affichée 2,62 € sera facturée 2,62 €)", [O.etat.ecritures.length - ecrituresAvantBaisse, O.prixFacture(P.ZINNAT.id, 5), journalDe(S, "modifier").at(-1).resultat], [0, 2.62, "reporte"]);
  S.table("kv_store").find(k => k.key === "pmlr:tache:1792400000000").value = JSON.stringify({ ref: "1792400000000", etat: "envoyee", renduA: new Date(w.horloge.t - 2 * 3600e3).toISOString(), source: "site", corps: [{ lignes: [{ CIP: P.ZINNAT.cip, quantiteCommandee: 5 }] }] });
  await X.reconcilier({ acteur: "filet", etendue: "filet" });
  const ecrBaisse = O.etat.ecritures.slice(ecrituresAvantBaisse);
  eq("baisse : commande importée → un write de percent_price (20 %), Odoo et le site à 2,99 €, décision facturée", [ecrBaisse.map(e => e.method), ecrBaisse[0]?.args[1], O.prixFacture(P.ZINNAT.id, 1114), catDe(S, P.ZINNAT.cip).discounted_price, decisionDe(S, P.ZINNAT.cip).statut, decisionDe(S, P.ZINNAT.cip).remise_pct, decisionDe(S, P.ZINNAT.cip).modification],
    [["write"], { percent_price: 20 }, 2.99, 2.99, "facturee", 20, null]);

  // ── 6. Retrait : A (page et prix du site) puis B (Odoo, après le délai et les commandes en cours) ──
  S.table("kv_store").push({ key: "pmlr:tache:1792500000000", value: JSON.stringify({ ref: "1792500000000", etat: "a_envoyer", source: "site", creeA: new Date(w.horloge.t).toISOString(),
    corps: [{ identifiantPML: "1234567", referenceCommande: "1792500000000", lignes: [{ CIP: P.ZINNAT.cip, quantiteCommandee: 2, prix: 2.99 }] }] }), updated_at: new Date(w.horloge.t).toISOString() });
  const ra = await X.retirer({ cips: [P.ZINNAT.cip], acteur: "zineb@elixir.test" });
  eq("retrait A : page sans remise, prix habituel sur le site, règles encore dans Odoo (en faveur de la pharmacie)",
    [decisionDe(S, P.ZINNAT.cip).statut, (await X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip).facturee, catDe(S, P.ZINNAT.cip).discounted_price, reglesSite(O).length, O.prixFacture(P.ZINNAT.id, 5), ra.fini],
    ["retrait_demande", false, 3.51, 6, 2.99, true]);
  const page2 = await X.etatPublic();
  eq("page : remise finie listée avec le prix actuel (paniers enregistrés)", page2.retirees.map(x => [x.cip, x.prix]), [[P.ZINNAT.cip, 3.51]]);
  let f = await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("retrait B avant le délai de 2 h : reporté", [reglesSite(O).length, decisionDe(S, P.ZINNAT.cip).statut], [6, "retrait_demande"]);
  w.avance(121);
  f = await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("retrait B : tâche du relais avec ce CIP → reporté", [reglesSite(O).length, journalDe(S, "retirer").at(-1).resultat, /1792500000000/.test(journalDe(S, "retirer").at(-1).message)], [6, "reporte", true]);
  S.table("kv_store").find(k => k.key === "pmlr:tache:1792500000000").value = JSON.stringify({ ref: "1792500000000", etat: "envoyee", renduA: new Date(w.horloge.t - 10 * 60e3).toISOString(), source: "site",
    corps: [{ lignes: [{ CIP: P.ZINNAT.cip, quantiteCommandee: 2 }] }] });
  await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("retrait B : tâche envoyée il y a 10 min, pas encore importée dans Odoo → reporté", reglesSite(O).length, 6);
  O.ajouterVente({ pid: P.ZINNAT.id, qte: 2, ref: "1792500000000" });
  S.table("elixir_orders").push({ id: w.horloge.t - 3600e3, processed: false, source: "catalogue", items: [{ cip: P.ZINNAT.cip, qty: 1, pn: 2.99 }] });
  await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("retrait B : commande du site pas encore envoyée (synchro manuelle) → reporté", reglesSite(O).length, 6);
  S.table("elixir_orders")[0].items = [{ cip: P.ZINNAT.cip, qty: 1, pn: 2.99, synced_at: new Date(w.horloge.t).toISOString() }];
  const avantUnlink = O.etat.ecritures.length;
  f = await X.reconcilier({ acteur: "filet", etendue: "filet" });
  const unlinks = O.etat.ecritures.slice(avantUnlink).filter(e => e.method === "unlink");
  eq("retrait B : 6 suppressions, une règle à la fois, après contrôle d'identité", [unlinks.length, unlinks.every(u => u.args[0].length === 1), reglesSite(O).length], [6, true, 0]);
  eq("retrait fini : décision retirée, Odoo et le site au prix habituel", [decisionDe(S, P.ZINNAT.cip).statut, decisionDe(S, P.ZINNAT.cip).raison_fin, O.prixFacture(P.ZINNAT.id, 5), catDe(S, P.ZINNAT.cip).discounted_price],
    ["retiree", "remise_retiree", 3.51, 3.51]);
  vrai("journal : chaque appel Odoo (créer, contrôler, modifier, retirer) avec son instantané", ["creer", "controler", "modifier", "retirer", "prix_site", "cacher"].every(a => journalDe(S, a).length) && journalDe(S, "retirer").some(j => j.avant?.id));
  eq("nouvel épisode : une nouvelle décision est nécessaire (la remise ne repart pas seule)", (await X.reconcilier({ acteur: "nuit", etendue: "nuit" })) && reglesSite(O).length, 0);
}
{
  // retrait après 24 h d'attente : supprimé quand même, alerte avec les commandes
  const w = monde();
  await zinnatFacture(w);
  w.S.table("kv_store").push({ key: "pmlr:tache:17925", value: JSON.stringify({ ref: "17925", etat: "incertaine", source: "site", corps: [{ lignes: [{ CIP: P.ZINNAT.cip, quantiteCommandee: 1 }] }] }), updated_at: new Date(w.horloge.t).toISOString() });
  await w.X.retirer({ cips: [P.ZINNAT.cip], acteur: "z" });
  w.avance(24 * 60 + 5);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("attente des commandes au-delà de 24 h : suppression et alerte (e-mail par Odoo, verrous ouverts)",
    [w.O.reglesSite().length, journalDe(w.S, "alerte").some(j => /24 h/.test(j.message)), w.O.etat.mails.some(m => /24 h/.test(m.subject))], [0, true, true]);
}
{
  // règle modifiée à la main dans Odoo : jamais supprimée, « modifiée dans Odoo », alerte ; règle supprimée à la main : retirée
  const w = monde();
  await zinnatFacture(w);
  const regles = w.S.table("peremption_regles");
  w.O.modifierALaMain(regles[1].odoo_item_id, { percent_price: 15 });
  w.O.supprimerALaMain(regles[2].odoo_item_id);
  await w.X.retirer({ cips: [P.ZINNAT.cip], toutDeSuite: true, acteur: "z" });
  eq("règle modifiée à la main : gardée dans Odoo, décision « modifiée », alerte", [w.O.items.has(regles[1].odoo_item_id), regles[1].statut, decisionDe(w.S, P.ZINNAT.cip).statut, journalDe(w.S, "alerte").some(j => /modifiée dans Odoo/.test(j.message))],
    [true, "modifiee_odoo", "modifiee_odoo", true]);
  eq("règle supprimée à la main : « retirée » ; les autres supprimées", [regles[2].statut, regles.filter(r => r.statut === "retiree").length, w.O.reglesSite().length], ["retiree", 5, 1]);
  const re = await w.X.reessayer({ cip: P.ZINNAT.cip, acteur: "z" });
  eq("« Réessayer » refusé tant que la règle reste différente", /toujours différente/.test(re.erreur || ""), true);
  w.O.modifierALaMain(regles[1].odoo_item_id, { percent_price: 12 });
  await w.X.retirer({ cips: [P.ZINNAT.cip], acteur: "z" });
  eq("règle remise en état à la main puis « Retirer » : supprimée", [w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut], [0, "retiree"]);
}
{
  // « Tout retirer » : seulement nos identifiants (règles commerciales et règle datée inconnue intactes)
  const w = monde();
  await zinnatFacture(w);
  const inconnue = w.O.ajouterRegleALaMain({ pricelist_id: 5, applied_on: "1_product", product_tmpl_id: P.RENI.tmpl, compute_price: "fixed", fixed_price: 5, date_start: "2026-10-01 08:00:00" });
  const avant = [...w.O.items.values()].filter(r => !r._site).length;
  const t = await w.X.retirer({ tout: true, acteur: "z" });
  eq("« Tout retirer » : nos 6 règles supprimées, rien d'autre", [w.O.reglesSite().length, [...w.O.items.values()].filter(r => !r._site).length, w.O.items.has(inconnue), t.fini], [0, avant, true, true]);
  await w.X.reconcilier({ acteur: "nuit", etendue: "nuit" });
  eq("règle datée inconnue : jamais touchée, alerte « règle datée inconnue »", [w.O.items.has(inconnue), journalDe(w.S, "alerte").some(j => /datée inconnue/.test(j.message))], [true, true]);
  const h = creerHandler({ peremption: w.X, verifyAdmin: async () => ({ admin: { email: "z@e.test" } }) });
  const mauvais = await h({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "tout_retirer", confirmation: "oui" }) });
  eq("« Tout retirer » sans la saisie RETIRER : refusé", mauvais.statusCode, 400);
}

// ── 7. Idempotence : coupure entre create et l'enregistrement, verrou ──
{
  const w = monde();
  w.O.etat.perdreReponse = 1;
  const r = await zinnatFacture(w);
  const regles = w.S.table("peremption_regles");
  eq("coupure : règles créées dans Odoo, réservations sans identifiant, page sans remise", [w.O.reglesSite().length, regles.every(x => x.statut === "reservee" && !x.odoo_item_id), decisionDe(w.S, P.ZINNAT.cip).statut, r.fini],
    [6, true, "voulue", true]);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("reprise : 6 règles adoptées par date_start, puis vérifiées → facturée, sans doublon dans Odoo",
    [journalDe(w.S, "adopter").filter(j => j.resultat === "ok").length, w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut, w.O.etat.ecritures.filter(e => e.method === "create").length], [6, 6, "facturee", 1]);
}
{
  const w = monde();
  w.O.etat.couperAvant = 1;   // coupure avant que la création n'atteigne Odoo : réservations sans règle
  await zinnatFacture(w);
  eq("coupure avant la création : réservations gardées, aucune règle dans Odoo", [w.S.table("peremption_regles").every(x => x.statut === "reservee"), w.O.reglesSite().length], [true, 0]);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("moins de 10 min après : réservations laissées (un passage peut être en cours)", [w.S.table("peremption_regles").filter(x => x.statut === "reservee").length, w.O.reglesSite().length], [6, 0]);
  w.avance(15);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("réservation sans règle dans Odoo : « echec » puis recréée", [w.S.table("peremption_regles").filter(x => x.statut === "echec").length, w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut], [6, 6, "facturee"]);
}
{
  const w = monde();
  const tenu = await w.X.prendreVerrou("00000000-0000-4000-8000-000000000001");
  const r = await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("deux passages simultanés : le second s'arrête (verrou), rien fait", [tenu, !!r.verrou, journalDe(w.S, "verrou").length], [true, true, 1]);
}

// ── 8. Échec partiel : la liste 1112 refuse ──
{
  const w = monde();
  w.O.etat.refuserListes.add(1112);
  await zinnatFacture(w);
  const d = decisionDe(w.S, P.ZINNAT.cip);
  eq("échec partiel : 5 règles posées, décision partielle, page sans remise", [w.O.reglesSite().length, d.statut, (await w.X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip).facturee, /1112/.test(d.erreur)],
    [5, "partielle", false, true]);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("2e essai : toujours refusé, partielle", [decisionDe(w.S, P.ZINNAT.cip).statut, decisionDe(w.S, P.ZINNAT.cip).essais], ["partielle", 2]);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("3e échec : erreur et alerte", [decisionDe(w.S, P.ZINNAT.cip).statut, journalDe(w.S, "alerte").some(j => /Échec de création/.test(j.message))], ["erreur", true]);
  w.O.etat.refuserListes.clear();
  const avant = w.O.etat.ecritures.filter(e => e.method === "create").length;
  await w.X.reessayer({ cip: P.ZINNAT.cip, acteur: "z" });
  const creees = w.O.etat.ecritures.filter(e => e.method === "create").slice(avant);
  eq("« Réessayer » : seule la liste manquante est créée, puis facturée", [creees.map(c => c.args[0].map(v => v.pricelist_id)).flat(), decisionDe(w.S, P.ZINNAT.cip).statut, w.O.reglesSite().length], [[1112], "facturee", 6]);
}

// ── 9. Sorties automatiques : date, stock épuisé, lot long reçu ; disjoncteurs ──
{
  const w = monde();
  const a = await w.X.apercu({ cips: [P.PROCHE.cip], remise: 40 });
  await w.X.appliquer({ cips: [P.PROCHE.cip], remise: 40, apercus: { [P.PROCHE.cip]: a.produits[0].apercu_id }, acteur: "z" });
  const d = decisionDe(w.S, P.PROCHE.cip);
  eq("lot au 24/11 : règle jusqu'au 25/10 22:59:59 UTC (dernier jour sur la page)", [d.statut, d.date_fin_regle], ["facturee", "2026-10-25T22:59:59.000Z"]);
  w.horloge.t = Date.parse("2026-10-25T19:25:00Z");
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("filet à 19 h 25 UTC (date_end − 3 h 35) : rien encore", decisionDe(w.S, P.PROCHE.cip).statut, "facturee");
  w.horloge.t = Date.parse("2026-10-25T20:25:00Z");
  eq("page : la remise n'est plus annoncée 3 h avant date_end, avant même le passage du filet (calcul sans Odoo)", (await w.X.etatPublic()).produits.find(p => p.cip === P.PROCHE.cip).facturee, false);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("filet 3 h avant date_end : page cachée (sortie par la date)", [decisionDe(w.S, P.PROCHE.cip).statut, decisionDe(w.S, P.PROCHE.cip).raison_fin], ["retrait_demande", "sortie_date"]);
  w.horloge.t = Date.parse("2026-10-25T23:30:00Z");
  eq("Odoo n'applique plus la règle après date_end (filet Odoo)", w.O.prixFacture(P.PROCHE.id, 5), bareme5(12));
}
{
  const w = monde();
  await zinnatFacture(w);
  w.O.ajouterQuant({ pid: P.ZINNAT.id, exp: "2028-06-30", qte: 24 });
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("lot long reçu (non forcé) : retrait et alerte « lot long reçu : 24 boîtes »", [decisionDe(w.S, P.ZINNAT.cip).statut, decisionDe(w.S, P.ZINNAT.cip).raison_fin, journalDe(w.S, "alerte").some(j => /Lot long reçu/.test(j.message) && /24 boîte/.test(j.apres?.texte || ""))],
    ["retrait_demande", "lot_long_recu", true]);
}
{
  const w = monde({ reglages: { lot_long_recu: "maintien" } });
  await zinnatFacture(w);
  w.O.ajouterQuant({ pid: P.ZINNAT.id, exp: "2028-06-30", qte: 24 });
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("réglage « maintien » : la remise reste, alerte seulement", [decisionDe(w.S, P.ZINNAT.cip).statut, journalDe(w.S, "alerte").some(j => /Lot long reçu/.test(j.message))], ["facturee", true]);
}
{
  const w = monde();
  await zinnatFacture(w);
  w.O.mettreEnQuarantaine(P.ZINNAT.id);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("stock court parti en quarantaine : retrait (court épuisé)", [decisionDe(w.S, P.ZINNAT.cip).statut, decisionDe(w.S, P.ZINNAT.cip).raison_fin], ["retrait_demande", "court_epuise"]);
}
{
  const w = monde();
  await zinnatFacture(w);
  w.O.etat.panne = (m) => m === "stock.quant";
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("disjoncteur : lecture du stock en échec → aucun retrait pour cause de stock, alerte", [decisionDe(w.S, P.ZINNAT.cip).statut, journalDe(w.S, "alerte").some(j => /Disjoncteur/.test(j.message))], ["facturee", true]);
}
{
  // plus de 30 % des produits facturés sortiraient pour cause de stock dans un même passage
  const w = monde();
  for (const k of ["ZINNAT", "SURB", "RENI"]) {
    const a = await w.X.apercu({ cips: [P[k].cip], remise: 40, sousCout: { [P[k].cip]: true }, force: { [P[k].cip]: 2 } });
    await w.X.appliquer({ cips: [P[k].cip], remise: 40, sousCout: { [P[k].cip]: true }, force: k === "RENI" ? { [P[k].cip]: 2 } : {}, apercus: { [P[k].cip]: a.produits[0].apercu_id }, acteur: "z" });
  }
  eq("trois produits facturés", w.S.table("peremption_decisions").filter(d => d.statut === "facturee").length, 3);
  for (const k of ["ZINNAT", "SURB", "RENI"]) w.O.viderStockCourt(P[k].id);
  const r = await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("disjoncteur : 3 sorties sur 3 produits (> 30 %) mises en attente, alerte", [w.S.table("peremption_decisions").filter(d => d.statut === "facturee").length, r.en_attente, !!r.disjoncteur], [3, 3, true]);
  const t = await w.X.retirer({ tout: true, acteur: "z" });
  eq("« Tout retirer » passe outre le disjoncteur", [w.O.reglesSite().length, t.fini], [0, true]);
}

// ── 10. Nuit pas à pas, listes en usage, journal en ajout seul, RLS ──
{
  const w = monde();
  await zinnatFacture(w);
  w.O.etat.panne = null;
  const pas = [];
  for (let off = 0, garde = 0; garde < 20; garde++) { const r = await w.X.passageNuit({ offset: off }); pas.push(r.etape); if (r.done) break; off = r.next_offset; }
  eq("nuit : faits puis plan (et exécution s'il y a lieu), puis fini", [pas[0], pas.includes("plan")], ["plan", true]);
  eq("nuit : faits de toute la page enregistrés", w.S.table("peremption_faits").length, Object.keys(P).length);
  eq("nuit : liste 4 jamais signalée ; listes couvertes → aucune alerte de liste", journalDe(w.S, "alerte").some(j => /non couverte/.test(j.message)), false);
  eq("nuit : résumé envoyé à l'équipe (verrous ouverts : e-mail par Odoo mail.mail), libellé du mode", [journalDe(w.S, "resume").some(j => /Résumé de la nuit/.test(j.message)), w.O.etat.mails.some(m => /Résumé de la nuit/.test(m.subject)), /Mode « Actif »/.test(journalDe(w.S, "resume")[0]?.apres?.texte || "")], [true, true, true]);
}
{
  const w = monde();
  w.O.etat.panne = null;
  const O2 = fauxOdoo({ produits: [P.ZINNAT], quants: [{ pid: P.ZINNAT.id, exp: "2027-02-28", qte: 10 }], commandesListes: [{ liste: 5, n: 10 }, { liste: 1200, nom: "Nouvelle liste (EUR)", n: 4 }, { liste: 4, n: 2 }] }, { maintenant: () => w.horloge.t });
  const X2 = M.creerPeremption({ odoo: O2.odoo, fetch: w.S.fetch, url: w.S.url, cle: w.S.cleService, env: { PEREMPTION_ODOO_ECRITURE: "1" }, maintenant: () => w.horloge.t });
  const u = await X2.listesEnUsage({ reglages: M.normaliserReglages({}), acteur: "nuit" });
  eq("liste en usage non couverte (1200) : alerte ; la 4 jamais", [u.non_couvertes, journalDe(w.S, "alerte").some(j => /Nouvelle liste/.test(j.apres?.texte || ""))], [[1200], true]);
  vrai("le module n'utilise que la clé service_role pour ses tables", w.S.etat.requetes.filter(q => /^peremption_/.test(q.table)).every(q => q.cle === "service"));
  const patch = await w.S.fetch(`${w.S.url}/rest/v1/peremption_journal?id=eq.1`, { method: "PATCH", headers: { apikey: w.S.cleService }, body: JSON.stringify({ message: "x" }) });
  eq("journal en ajout seul : modification refusée", patch.status, 400);
  const anon = await (await w.S.fetch(`${w.S.url}/rest/v1/peremption_decisions?select=*`, { headers: { apikey: w.S.cleAnon } })).json();
  eq("RLS : la clé anon du navigateur ne lit rien", anon, []);
}

// ── 11. Page publique : fantômes, tables absentes ──
{
  const w = monde();
  await w.X.reconcilier({ acteur: "nuit", etendue: "nuit" });
  const page = await w.X.etatPublic();
  eq("page : produit « fantôme » (aucune boîte courte, faits < 24 h) masqué", [page.produits.some(p => p.cip === P.FANTOME.cip), page.produits.some(p => p.cip === P.ZINNAT.cip)], [false, true]);
  eq("page : aucune remise sans décision facturée", page.facturees, 0);
  const S2 = fauxSupabase({ tables: { odoo_catalog: w.S.table("odoo_catalog") } });
  S2.T.delete("peremption_reglages");
  const X2 = M.creerPeremption({ odoo: w.O.odoo, fetch: S2.fetch, url: S2.url, cle: null, env: { SUPABASE_KEY: S2.cleAnon }, maintenant: () => w.horloge.t });
  const p2 = await X2.etatPublic();
  eq("tables pas encore créées / clé service absente : la page reste servie, sans remise (comportement du lot 0)", [p2.etat, p2.produits.length, p2.facturees], ["non_installe", Object.keys(P).length, 0]);
}

// ── 12. HTTP (peremption.js) ──
{
  const w = monde();
  const admin = async (ev) => (/jeton-admin/.test(ev.headers?.authorization || "") ? { admin: { email: "Zineb@Elixir.test" } } : { error: { statusCode: /jeton/.test(ev.headers?.authorization || "") ? 403 : 401, headers: {}, body: "{}" } });
  const h = creerHandler({ peremption: w.X, verifyAdmin: admin, isCronAuthorized: (ev) => ev.headers?.["x-cron-secret"] === "s" });
  const ev = (methode, { q, corps, jeton, entetes } = {}) => ({ httpMethod: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(entetes || {}) }, queryStringParameters: q || {}, body: corps ? JSON.stringify(corps) : null });
  const r1 = await h(ev("GET", { q: { action: "page" } }));
  eq("GET page : public, sans cache", [r1.statusCode, r1.headers["Cache-Control"], JSON.parse(r1.body).produits.length > 0], [200, "no-store", true]);
  eq("GET admin sans jeton : 401 ; jeton pharmacie : 403", [(await h(ev("GET", { q: { action: "admin" } }))).statusCode, (await h(ev("GET", { q: { action: "admin" }, jeton: "jeton-pharmacie" }))).statusCode], [401, 403]);
  eq("POST sans jeton admin : refusé, rien lu", [(await h(ev("POST", { corps: { action: "appliquer", cips: [P.ZINNAT.cip], remise_pct: 12 } }))).statusCode, w.O.etat.ecritures.length], [401, 0]);
  eq("cron nuit sans secret : 403", (await h(ev("GET", { q: { step: "nuit" } }))).statusCode, 403);
  const adm = await h(ev("GET", { q: { action: "admin" }, jeton: "jeton-admin" }));
  const etat = JSON.parse(adm.body);
  eq("GET admin : réglages, verrous, compteurs, produits (faits pas encore lus)", [adm.statusCode, etat.reglages.mode, etat.verrous.creation, etat.compteurs.page, etat.produits.find(p => p.cip === P.ZINNAT.cip).etat], [200, "actif", true, Object.keys(P).length, "faits_absents"]);
  let off = 0, n = 0;
  do { const f = JSON.parse((await h(ev("POST", { jeton: "jeton-admin", corps: { action: "faits", offset: off } }))).body); off = f.next_offset; n++; } while (off != null && n < 10);
  const etat2 = JSON.parse((await h(ev("GET", { q: { action: "admin" }, jeton: "jeton-admin" }))).body);
  eq("POST faits (« Actualiser depuis Odoo ») puis GET admin : Zinnat « À remiser », Zaditen non facturé (lot long), Parlodel court épuisé, menu promo exclu",
    ["ZINNAT", "ZADI", "FANTOME", "PROMO"].map(k => etat2.produits.find(p => p.cip === P[k].cip).etat), ["a_remiser", "non_facture", "court_epuise", "exclu"]);
  eq("POST apercu : remise 0 refusée (« Retirer »)", (await h(ev("POST", { jeton: "jeton-admin", corps: { action: "apercu", cips: [P.ZINNAT.cip], remise_pct: 0 } }))).statusCode, 400);
  const ap = JSON.parse((await h(ev("POST", { jeton: "jeton-admin", corps: { action: "apercu", cips: [P.ZINNAT.cip], remise_pct: 12, sous_cout_confirme: { [P.ZINNAT.cip]: true } } }))).body);
  const app = JSON.parse((await h(ev("POST", { jeton: "jeton-admin", corps: { action: "appliquer", cips: [P.ZINNAT.cip], remise_pct: 12, sous_cout_confirme: { [P.ZINNAT.cip]: true }, apercus: { [P.ZINNAT.cip]: ap.produits[0].apercu_id } } }))).body);
  eq("POST appliquer (admin) : facturée, auteur = e-mail de l'admin", [app.fini, decisionDe(w.S, P.ZINNAT.cip).statut, decisionDe(w.S, P.ZINNAT.cip).decide_par], [true, "facturee", "zineb@elixir.test"]);
  const lot = JSON.parse((await h(ev("POST", { jeton: "jeton-admin", corps: { action: "appliquer", cips: [P.SURB.cip, P.HEC.cip], remise_pct: 40, sous_cout_confirme: { [P.SURB.cip]: true, [P.HEC.cip]: true } } }))).body);
  eq("application en lot : saisie du nombre de règles exigée", /12/.test(lot.erreur || ""), true);
  const md = await h(ev("POST", { jeton: "jeton-admin", corps: { action: "mode", mode: "simulation" } }));
  eq("POST mode sans confirmation : 400", md.statusCode, 400);
  const dr = JSON.parse((await h(ev("GET", { q: { action: "droits" }, jeton: "jeton-admin" }))).body);
  eq("droits Odoo (lecture seule) : OK, login du compte du site", [dr.ok, dr.compte.login, dr.modele.unlink, dr.regle.unlink, w.O.etat.ecritures.filter(e => e.at && /check/.test(e.method)).length], [true, "pharmacien@elixirpharma.fr", true, true, 0]);
  const nuit = await h(ev("GET", { q: { step: "nuit", offset: "0" }, entetes: { "x-cron-secret": "s" } }));
  eq("cron nuit avec secret : 200", nuit.statusCode, 200);
  const j = JSON.parse((await h(ev("GET", { q: { action: "journal", cip: P.ZINNAT.cip }, jeton: "jeton-admin" }))).body);
  vrai("journal par CIP (admin)", j.lignes.length > 0 && j.lignes.every(x => x.cip === P.ZINNAT.cip));
}
{
  // droits incomplets (règle multisociété refusée)
  const O = fauxOdoo({ produits: [P.ZINNAT], refusRegle: true, societes: [1] });
  const S = fauxSupabase();
  const X = M.creerPeremption({ odoo: O.odoo, fetch: S.fetch, url: S.url, cle: S.cleService, env: {}, maintenant: () => T0 });
  O.ajouterRegleALaMain({ pricelist_id: 5, applied_on: "1_product", product_tmpl_id: P.ZINNAT.tmpl, compute_price: "fixed", fixed_price: 3 });
  const d = await X.droits({ acteur: "z" });
  eq("droits KO : règle multisociété refusée, société Elixir non autorisée", [d.ok, /refusé/.test(d.regle.write), d.compte.societe_elixir], [false, true, false]);
}

// ── 13. Écarts des factures passées (lecture seule) ──
{
  const w = monde();
  w.O.ajouterVente({ pid: P.ZADI.id, qte: 3, ref: "1791000000000", pu: 3.83, remise: 6, commande: "S351354" });
  w.O.ajouterVente({ pid: P.HEC.id, qte: 2, ref: "1791000000000", pu: 10.32, remise: 5.43, commande: "S351354" });
  w.S.table("elixir_orders").push({ id: 1791000000000, date: "2026-10-18T10:00:00Z", pharmacy_name: "Pharmacie d'essai", source: "catalogue",
    items: [{ cip: P.ZADI.cip, name: "ZADITEN", qty: 3, pn: 1.92 }, { cip: P.HEC.cip, name: "HEC", qty: 2, pn: 9.76 }] });
  const e = await w.X.ecarts({ depuis: "2026-10-01" });
  eq("écarts : ligne facturée au-dessus du prix du panier (Zaditen 1,92 € → 3,60 €), pas celle au bon prix", e.lignes.map(l => [l.cip, l.pn, l.net, l.ecart]), [[P.ZADI.cip, 1.92, 3.6, 5.04]]);
  eq("écarts : aucune écriture", [w.O.etat.ecritures.length, w.S.etat.requetes.filter(q => q.methode !== "GET").length], [0, 0]);
}

// ── 14. Remise automatique (réglage, désactivée par défaut) ──
{
  const w = monde({ reglages: { remise_auto_pct: null } });
  await w.X.reconcilier({ acteur: "nuit", etendue: "nuit" });
  eq("sans remise automatique (défaut) : la nuit ne crée aucune décision", w.S.table("peremption_decisions").length, 0);
  const w2 = monde({ reglages: { remise_auto_pct: 40 } });
  await w2.X.reconcilier({ acteur: "nuit", etendue: "nuit" });
  const auto = w2.S.table("peremption_decisions");
  eq("remise automatique (réglage à 40 %) : seulement les produits « À remiser » au-dessus du coût", auto.map(d => d.cip), [P.PROCHE.cip]);
}

// ── 15. Essai T1 (scripts/essai-dates-peremption.mjs) contre le faux Odoo ──
// Revue V1 : T1 écrit par la porte unique du module (verrou PEREMPTION_ODOO_ECRITURE, journal d'intention puis de résultat)
{
  const { essaiDates, CONFIRMATION } = await import("./essai-dates-peremption.mjs");
  const muet = () => {};
  const porteDe = (O, { env = { PEREMPTION_ODOO_ECRITURE: "1" }, S = fauxSupabase({ maintenant: () => T0 }) } = {}) => ({ S, porte: M.creerPeremption({ odoo: O.odoo, fetch: S.fetch, url: S.url, cle: S.cleService, env, maintenant: () => T0 }).ecrireOdoo });
  const O = fauxOdoo({ produits: [P.ZINNAT], prixListes: { 2: { [P.ZINNAT.id]: 3.74 } } }, { maintenant: () => T0 });
  const plan = await essaiDates({ odoo: async () => { throw new Error("aucun appel attendu"); }, ecrire: false, journal: muet });
  eq("T1 sans --ecrire : plan seul, aucun appel à Odoo ; confirmation à taper", [plan, CONFIRMATION], [{ plan: true }, "ZINNAT-LISTE-2"]);
  const { S, porte } = porteDe(O);
  const r = await essaiDates({ odoo: O.odoo, porte, ecrire: true, maintenant: () => T0, journal: muet });
  eq("T1 : Odoo qui respecte les dates → normal, −10 %, normal, supprimée", [r.resultats.map(x => [x.prix, x.ok]), r.dates_respectees, r.supprimee, O.items.size],
    [[[3.74, true], [3.37, true], [3.74, true], [3.74, true]], true, true, 0]);
  eq("T1 : 4 écritures (create, 2 write, unlink) sur la liste 2 seulement", [O.etat.ecritures.map(e => e.method), O.etat.ecritures[0].args[0][0].pricelist_id], [["create", "write", "write", "unlink"], 2]);
  eq("T1 : les 4 écritures au journal (intention puis résultat)", S.table("peremption_journal").filter(j => j.action === "essai_t1").map(j => j.resultat), ["en_cours", "ok", "en_cours", "ok", "en_cours", "ok", "en_cours", "ok"]);
  const Ov = fauxOdoo({ produits: [P.ZINNAT], prixListes: { 2: { [P.ZINNAT.id]: 3.74 } } }, { maintenant: () => T0 });
  let refus = null; try { await essaiDates({ odoo: Ov.odoo, porte: porteDe(Ov, { env: {} }).porte, ecrire: true, maintenant: () => T0, journal: muet }); } catch (e) { refus = e.message; }
  eq("T1 sans la variable : la porte refuse, rien écrit", [/PEREMPTION_ODOO_ECRITURE/.test(refus || ""), Ov.etat.ecritures.length], [true, 0]);
  const Oj = fauxOdoo({ produits: [P.ZINNAT], prixListes: { 2: { [P.ZINNAT.id]: 3.74 } } }, { maintenant: () => T0 });
  const Sj = fauxSupabase({ maintenant: () => T0 }); Sj.etat.panne = (t) => t === "peremption_journal";
  let arretJ = null; try { await essaiDates({ odoo: Oj.odoo, porte: porteDe(Oj, { S: Sj }).porte, ecrire: true, maintenant: () => T0, journal: muet }); } catch (e) { arretJ = e.message; }
  eq("T1 journal en panne : aucune écriture dans Odoo (échec fermé)", [!!arretJ, Oj.etat.ecritures.length], [true, 0]);
  const Op = fauxOdoo({ produits: [P.ZINNAT], prixListes: { 2: { [P.ZINNAT.id]: 3.74 } } }, { maintenant: () => T0 });
  Op.etat.perdreReponse = 1;
  let arretP = null; try { await essaiDates({ odoo: Op.odoo, porte: porteDe(Op).porte, ecrire: true, maintenant: () => T0, journal: muet }); } catch (e) { arretP = e.message; }
  eq("T1 réponse de la création perdue : règle retrouvée par son repère et supprimée, rien ne reste", [!!arretP, Op.items.size, Op.etat.ecritures.map(e => e.method)], [true, 0, ["create", "unlink"]]);
  const O2 = fauxOdoo({ produits: [P.ZINNAT], prixListes: { 2: { [P.ZINNAT.id]: 3.74 } }, ignorerDates: true }, { maintenant: () => T0 });
  const r2 = await essaiDates({ odoo: O2.odoo, porte: porteDe(O2).porte, ecrire: true, maintenant: () => T0, journal: muet });
  eq("T1 : Odoo qui ignorerait les dates → « non », règle quand même supprimée", [r2.dates_respectees, r2.supprimee, O2.items.size], [false, true, 0]);
  O2.ajouterRegleALaMain({ pricelist_id: 2, applied_on: "1_product", product_tmpl_id: P.ZINNAT.tmpl, compute_price: "fixed", fixed_price: 3, date_start: "2026-10-01 00:00:00" });
  const avant = O2.etat.ecritures.length;
  let arret = null; try { await essaiDates({ odoo: O2.odoo, porte: porteDe(O2).porte, ecrire: true, maintenant: () => T0, journal: muet }); } catch (e) { arret = e.message; }
  eq("T1 : règle datée déjà présente → arrêt, rien écrit", [/déjà/.test(arret || ""), O2.etat.ecritures.length - avant], [true, 0]);
  vrai("T1 : plus aucun appel d'écriture direct dans le script (porte du module seulement)", !/odoo\("product\.pricelist\.item", "(create|write|unlink)"/.test(lire("scripts/essai-dates-peremption.mjs")));
}

// ── 16. Revue de la V1 (21/10/2026) : non-régression, un bloc par constat ──
const LAT = { odoo: 120, sb: 20 };
const facturerTout = async (w, cips, remise, acteur = "zineb") => {
  const sc = Object.fromEntries(cips.map(c => [c, true]));
  const a = await w.X.apercu({ cips, remise, sousCout: sc });
  return w.X.brut.appliquer({ cips, remise, sousCout: sc, apercus: Object.fromEntries(a.produits.map(p => [p.cip, p.apercu_id])), confirmationRegles: cips.length > 1 ? cips.length * 6 : null, acteur });
};
const LOT = [P.ZINNAT.cip, P.SURB.cip, P.HEC.cip];
// O1 : filet entre deux « etape » d'une application en lot, puis étape rejouée → aucune décision close avec des règles vivantes
{
  const w = monde({ latence: LAT });
  const r = await facturerTout(w, LOT, 40);
  eq("appliquer rend la main sans rien écrire (l'exécution se fait par « etape »)", [r.fini, r.curseur, r.total, w.O.etat.ecritures.length], [false, 0, 3, 0]);
  const t1 = w.horloge.t;
  const e1 = await w.X.brut.etape({ passageId: r.passage_id, acteur: "zineb", budgetMs: 7000 });
  eq("première étape (latence Odoo 120 ms) : un ou deux éléments, l'appel reste dans son budget de 7 s, le reste attend", [e1.curseur >= 1 && e1.curseur < 3, e1.fini, w.horloge.t - t1 <= 7000], [true, false, true]);
  const voulues = LOT.filter(c => decisionDe(w.S, c).statut === "voulue");
  await w.X.reconcilier({ acteur: "filet", etendue: "filet", budgetMs: 60000 });
  eq("filet pendant le lot (< 30 min) : il ne complète pas les décisions « voulue » du passage de l'admin", [voulues.length > 0, voulues.map(c => decisionDe(w.S, c).statut).every(x => x === "voulue")], [true, true]);
  w.avance(31);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet", budgetMs: 60000 });
  eq("passage de l'admin abandonné depuis 30 min : le filet complète", LOT.map(c => decisionDe(w.S, c).statut), ["facturee", "facturee", "facturee"]);
  let e = { fini: false }, n = 0;
  while (!e.fini && n++ < 10) e = await w.X.brut.etape({ passageId: r.passage_id, acteur: "zineb", budgetMs: 7000 });
  eq("étapes rejouées ensuite : éléments périmés, aucune décision close, 6 règles chacune, aucune en double",
    [LOT.map(c => decisionDe(w.S, c).statut), w.O.reglesSite().length, journalDe(w.S, "refus").filter(j => /aperçu a changé/.test(j.message)).length],
    [["facturee", "facturee", "facturee"], 18, 0]);
}
{
  // verrou non réentrant : deux « etape » simultanées sur un même passage → une seule s'exécute
  const w = monde({ latence: LAT });
  const r = await facturerTout(w, LOT, 40);
  const [e1, e2] = await Promise.all([w.X.brut.etape({ passageId: r.passage_id, acteur: "z", budgetMs: 60000 }), w.X.brut.etape({ passageId: r.passage_id, acteur: "z", budgetMs: 60000 })]);
  eq("deux « etape » simultanées : l'une attend le verrou, aucune règle en double", [[e1, e2].filter(x => x.attente).length, w.O.reglesSite().length, w.O.etat.ecritures.filter(x => x.method === "create").length], [1, 18, 3]);
}
{
  // balayage : une décision close qui porte encore des règles vivantes est rouverte et ses règles supprimées
  const w = monde();
  await zinnatFacture(w);
  const d = decisionDe(w.S, P.ZINNAT.cip);
  Object.assign(d, { statut: "retiree", raison_fin: "refus", retiree_at: new Date(w.horloge.t).toISOString() });   // ancien défaut (« l'aperçu a changé » sur règles vivantes)
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("règles sous une décision close : rouverte (retrait immédiat), alerte, règles supprimées, prix habituel",
    [decisionDe(w.S, P.ZINNAT.cip).statut, decisionDe(w.S, P.ZINNAT.cip).raison_fin, journalDe(w.S, "alerte").some(j => /décision close/.test(j.message)), w.O.reglesSite().length, catDe(w.S, P.ZINNAT.cip).discounted_price],
    ["retiree", "regle_orpheline", true, 0, 3.51]);
}
// O2 : « Retirer » pendant une application en lot : jamais annulé
{
  const w = monde({ latence: LAT });
  const r = await facturerTout(w, LOT, 40);
  await w.X.brut.etape({ passageId: r.passage_id, acteur: "zineb", budgetMs: 7000 });
  await w.X.retirer({ cips: [P.HEC.cip], acteur: "sam" });
  eq("« Retirer » sur un produit du lot pas encore créé : clos tout de suite (aucune règle)", decisionDe(w.S, P.HEC.cip).statut, "retiree");
  let e = { fini: false }, n = 0;
  while (!e.fini && n++ < 10) e = await w.X.brut.etape({ passageId: r.passage_id, acteur: "zineb", budgetMs: 7000 });
  eq("fin du lot : élément périmé, aucune règle pour ce produit, la page ne l'annonce pas",
    [decisionDe(w.S, P.HEC.cip).statut, w.O.reglesSite().filter(x => x.product_tmpl_id[0] === P.HEC.tmpl).length, (await w.X.etatPublic()).produits.find(p => p.cip === P.HEC.cip)?.facturee, journalDe(w.S).some(j => j.cip === P.HEC.cip && /périmé/.test(j.message || ""))],
    ["retiree", 0, false, true]);
}
{
  // « Tout retirer » pendant la création (après le create, avant la bascule « facturee ») : écriture conditionnelle perdue
  let w;
  w = monde({ crochet: async (m, me) => { if (m === "product.pricelist.item" && me === "create" && w.armer) { w.armer = false; await w.X.brut.retirer({ tout: true, acteur: "sam" }); } } });
  w.armer = true;
  await zinnatFacture(w);
  eq("« Tout retirer » pendant la création : la décision reste en retrait, prix habituel, la page n'annonce rien",
    [decisionDe(w.S, P.ZINNAT.cip).statut, catDe(w.S, P.ZINNAT.cip).discounted_price, (await w.X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip).facturee], ["retrait_demande", 3.51, false]);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("… puis ses règles sont supprimées (retrait immédiat)", [w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut], [0, "retiree"]);
}
// O3 : création liste par liste, réponse perdue : réservation gardée, adoptée, jamais de doublon ni d'orpheline
{
  const w = monde();
  w.O.etat.refuserListes.add(1112);
  w.O.etat.perdreReponse = 1;   // la 1re création liste par liste (liste 5) aboutit mais sa réponse se perd
  await zinnatFacture(w);
  const l5 = w.S.table("peremption_regles").filter(r => r.pricelist_id === 5);
  eq("réponse perdue en liste par liste : réservation gardée (pas « echec »)", l5.map(r => r.statut), ["reservee"]);
  w.O.etat.refuserListes.clear();
  for (let i = 0; i < 2; i++) { w.avance(61); await w.X.reconcilier({ acteur: "filet", etendue: "admin" }); }
  eq("passages suivants : adoptée, liste 1112 complétée, facturée, aucune règle en double", [decisionDe(w.S, P.ZINNAT.cip).statut, w.O.reglesSite().filter(x => x.pricelist_id[0] === 5).length, w.O.reglesSite().length], ["facturee", 1, 6]);
  await w.X.retirer({ cips: [P.ZINNAT.cip], toutDeSuite: true, acteur: "z" });
  eq("« Retirer tout de suite » : plus aucune règle du site dans Odoo", [w.O.reglesSite().length, w.O.prixFacture(P.ZINNAT.id, 5)], [0, 3.51]);
}
{
  // une « echec » de moins de 48 h dont la règle existe (réponse perdue classée à tort) : retrouvée ; doublon supprimé
  const w = monde();
  await zinnatFacture(w);
  const vraie = w.S.table("peremption_regles").find(r => r.pricelist_id === 15);
  const doublon = w.O.ajouterRegleALaMain({ pricelist_id: 15, applied_on: "1_product", product_tmpl_id: P.ZINNAT.tmpl, compute_price: "percentage", percent_price: 12, date_start: "2026-10-21 08:00:00", date_end: "2027-01-29 22:59:59" });
  w.O.items.get(doublon)._site = true;
  w.S.table("peremption_regles").push({ id: "00000000-0000-4000-8000-0000000000aa", decision_id: vraie.decision_id, cip: P.ZINNAT.cip, pricelist_id: 15, odoo_tmpl_id: P.ZINNAT.tmpl, odoo_item_id: null,
    operation_id: "00000000-0000-4000-8000-0000000000ab", date_start: "2026-10-21T08:00:00.000Z", percent_price: 12, date_end: vraie.date_end, statut: "echec", created_at: new Date(w.horloge.t - 3600e3).toISOString(), cible: null });
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("réservation « echec » retrouvée dans Odoo alors que la liste est recréée : doublon supprimé, pas d'alerte « datée inconnue »",
    [w.O.items.has(doublon), w.S.table("peremption_regles").find(r => r.id === "00000000-0000-4000-8000-0000000000aa").statut, journalDe(w.S, "alerte").some(j => /datée inconnue/.test(j.message))], [false, "retiree", false]);
}
// O4 : « Tout retirer » : étape A en bloc au premier appel, étape B finie par le filet si le navigateur s'arrête
{
  const w = monde({ latence: LAT });
  for (const cip of LOT) { await jusquauBout(w.X.brut, await facturerTout(w, [cip], 40), "z"); }
  eq("trois remises facturées", w.S.table("peremption_decisions").filter(d => d.statut === "facturee").length, 3);
  const t0 = w.horloge.t;
  const r = await w.X.brut.retirer({ tout: true, acteur: "zineb" });
  const pub = await w.X.etatPublic();
  eq("« Tout retirer », premier appel : plus aucune remise annoncée, prix habituel sur le site, en moins de 10 s, aucune suppression encore",
    [pub.facturees, LOT.map(c => catDe(w.S, c).discounted_price), (w.horloge.t - t0) < 10000, w.O.reglesSite().length, r.total], [0, [3.51, 6, 9.76], true, 18, 3]);
  const { filet } = await import("../netlify/functions/peremption-cron.js");
  w.avance(15);
  const fl = await filet({ peremption: w.X.brut, maintenant: Date.parse("2026-10-21T09:40:00Z") });
  eq("navigateur fermé : le filet du quart d'heure finit les suppressions (retraits immédiats)", [w.O.reglesSite().length, w.S.table("peremption_decisions").filter(d => d.statut === "retiree").length, !!fl.passage_id], [0, 3, true]);
  const rien = await filet({ peremption: w.X.brut, maintenant: Date.parse("2026-10-21T09:55:00Z") });
  eq("quart d'heure sans retrait immédiat : rien (pas de lecture d'Odoo)", rien, { rien: true });
}
// O5 : échec partiel : le site garde le prix habituel (jamais en dessous de ce que facture une liste)
{
  const w = monde();
  w.O.etat.refuserListes.add(1112);
  await zinnatFacture(w);
  const d = decisionDe(w.S, P.ZINNAT.cip);
  const site = catDe(w.S, P.ZINNAT.cip).discounted_price;
  eq("partielle : prix du site = prix habituel (3,51 €), ≥ au prix facturé sur chaque liste", [d.statut, site, M.LISTES_DEFAUT.every(l => site >= w.O.prixFacture(P.ZINNAT.id, l) - 0.005)], ["partielle", 3.51, true]);
}
// O7 : écriture Odoo puis échec Supabase : notre écriture n'est jamais prise pour une modification à la main
{
  const w = monde();
  await zinnatFacture(w);
  let n = 0;
  w.S.etat.panne = (table, methode) => table === "peremption_regles" && methode === "PATCH" && ++n === 2;   // 1 : intention (ok) ; 2 : finalisation
  const m = await w.X.appliquer({ cips: [P.ZINNAT.cip], remise: 20, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  w.S.etat.panne = null;
  eq("hausse 12 → 20 % : Odoo écrit, finalisation Supabase en échec → intention gardée sur les règles, décision partielle",
    [w.O.reglesSite().map(x => x.percent_price)[0], w.S.table("peremption_regles").filter(r => r.statut === "active")[0].percent_price, !!w.S.table("peremption_regles")[0].cible, decisionDe(w.S, P.ZINNAT.cip).statut, (m.erreurs || []).length],
    [20, 12, true, "partielle", 1]);
  w.avance(61);
  await w.X.reconcilier({ acteur: "filet", etendue: "admin" });
  eq("passage suivant : relecture → écriture finalisée (20 %), remise 20 %, facturée, aucune alerte « modifiée »",
    [w.S.table("peremption_regles").filter(r => r.statut === "active").map(r => r.percent_price)[0], decisionDe(w.S, P.ZINNAT.cip).remise_pct, decisionDe(w.S, P.ZINNAT.cip).statut, journalDe(w.S, "alerte").some(j => /modifiée dans Odoo/.test(j.message))],
    [20, 20, "facturee", false]);
  await w.X.retirer({ cips: [P.ZINNAT.cip], toutDeSuite: true, acteur: "z" });
  eq("… et « Retirer tout de suite » supprime bien les 6 règles", [w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut], [0, "retiree"]);
}
// O8 : commandes en cours au-delà de 500 tâches du relais ; lecture incomplète → suppression reportée (échec fermé)
{
  const w = monde();
  const vieux = new Date(w.horloge.t - 5 * 864e5).toISOString();
  for (let i = 0; i < 600; i++) w.S.table("kv_store").push({ key: `pmlr:tache:${1790000000000 + i}`, value: JSON.stringify({ ref: String(1790000000000 + i), etat: "envoyee", source: "site", renduA: vieux, corps: [{ lignes: [{ CIP: "3400930000999", quantiteCommandee: 1 }] }] }), updated_at: vieux });
  w.S.table("kv_store").push({ key: "pmlr:tache:1795000000000", value: JSON.stringify({ ref: "1795000000000", etat: "a_envoyer", source: "site", corps: [{ lignes: [{ CIP: P.ZINNAT.cip, quantiteCommandee: 2 }] }] }), updated_at: new Date(w.horloge.t - 60e3).toISOString() });
  eq("600 tâches anciennes + 1 en attente : la tâche en attente est vue", (await w.X.commandesEnCours([P.ZINNAT.cip])).map(c => c.ref), ["1795000000000"]);
  const ancienne = new Date(w.horloge.t - 3 * 864e5).toISOString();
  w.S.table("kv_store").push({ key: "pmlr:file:1780000000000", value: JSON.stringify({ ref: "1780000000000" }), updated_at: ancienne },
    { key: "pmlr:tache:1780000000000", value: JSON.stringify({ ref: "1780000000000", etat: "a_envoyer", source: "site", corps: [{ lignes: [{ CIP: P.SURB.cip, quantiteCommandee: 1 }] }] }), updated_at: ancienne });
  eq("tâche de la file plus ancienne que 48 h : vue par la file du relais", (await w.X.commandesEnCours([P.SURB.cip])).map(c => c.ref), ["1780000000000"]);
  for (let i = 0; i < 1000; i++) w.S.table("kv_store").push({ key: `pmlr:tache:${1791000000000 + i}`, value: "{}", updated_at: new Date(w.horloge.t - 3600e3).toISOString() });
  let err = null; try { await w.X.commandesEnCours([P.ZINNAT.cip]); } catch (e) { err = e.code; }
  eq("1 000 tâches récentes (lecture peut-être incomplète) : erreur, jamais une liste vide", err, "commandes_illisibles");
  await zinnatFacture(w);
  await w.X.retirer({ cips: [P.ZINNAT.cip], acteur: "z" });
  w.avance(121);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("étape B avec des commandes illisibles : reportée, règles gardées", [w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut, journalDe(w.S, "retirer").at(-1).resultat], [6, "retrait_demande", "reporte"]);
}
// O9 : prix du site après l'étape B (synchro « Prix remisés » avec des règles périmées, recalcul final en échec)
{
  const w = monde();
  await zinnatFacture(w);
  await w.X.retirer({ cips: [P.ZINNAT.cip], toutDeSuite: true, acteur: "z" });
  catDe(w.S, P.ZINNAT.cip).discounted_price = 3.29;   // « apply » de la nuit avec les règles relues avant la suppression
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("remise retirée depuis moins de 24 h, prix de la remise remis par une synchro : le filet reprend le prix d'Odoo", catDe(w.S, P.ZINNAT.cip).discounted_price, 3.51);
}
{
  const w = monde();
  await zinnatFacture(w);
  await w.X.brut.retirer({ cips: [P.ZINNAT.cip], toutDeSuite: false, acteur: "z" }).then(r => jusquauBout(w.X.brut, r));
  w.avance(121);
  let unlinks = 0;
  w.O.etat.panne = (m, me) => m === "product.category" && unlinks >= 6;   // recalcul final du prix du site en échec
  const o0 = w.O.odoo;
  const X = M.creerPeremption({ odoo: async (m, me, a, k) => { const r = await o0(m, me, a, k); if (me === "unlink") unlinks++; return r; }, fetch: w.S.fetch, url: w.S.url, cle: w.S.cleService, env: { PEREMPTION_ODOO_ECRITURE: "1", SUPABASE_KEY: w.S.cleAnon }, maintenant: () => w.horloge.t });
  await X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("règles supprimées mais prix du site non repris : la décision reste en retrait (pas « retiree »)", [w.O.reglesSite().length, decisionDe(w.S, P.ZINNAT.cip).statut], [0, "retrait_demande"]);
  w.O.etat.panne = null;
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("passage suivant : prix repris d'Odoo, décision close", [catDe(w.S, P.ZINNAT.cip).discounted_price, decisionDe(w.S, P.ZINNAT.cip).statut], [3.51, "retiree"]);
}
// O10 : Odoo injoignable : la page cesse d'annoncer à la date, le filet n'échoue pas, retraits bloqués signalés
{
  const w = monde();
  await zinnatFacture(w);
  w.O.etat.panne = () => true;
  w.horloge.t = Date.parse("2027-01-29T21:00:00Z");   // date_end − 2 h
  const pub = await w.X.etatPublic();
  eq("Odoo en panne, 2 h avant date_end : la page n'annonce plus (calcul pur)", pub.produits.find(p => p.cip === P.ZINNAT.cip)?.facturee ?? false, false);
  const f = await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("filet avec Odoo en panne : pas d'erreur, retrait par la date (étape A), prix habituel figé écrit par Supabase, alerte",
    [!!f.passage_id, decisionDe(w.S, P.ZINNAT.cip).statut, catDe(w.S, P.ZINNAT.cip).discounted_price, journalDe(w.S, "alerte").some(j => /Odoo injoignable/.test(j.message))], [true, "retrait_demande", 3.51, true]);
}
{
  const w = monde();
  await zinnatFacture(w);
  await w.X.retirer({ cips: [P.ZINNAT.cip], acteur: "z" });
  w.O.etat.panne = (m, me) => me === "unlink";   // droit de suppression retiré
  for (let i = 0; i < 3; i++) { w.avance(121); await w.X.reconcilier({ acteur: "filet", etendue: "filet" }); }
  eq("étape B en échec 3 fois de suite : alerte « Suppression dans Odoo en échec »", journalDe(w.S, "alerte").some(j => /Suppression dans Odoo en échec/.test(j.message)), true);
  w.avance(26 * 60);
  await w.X.reconcilier({ acteur: "filet", etendue: "filet" });
  eq("retrait bloqué plus de 24 h après le délai : alerte « Retrait bloqué »", journalDe(w.S, "alerte").some(j => /Retrait bloqué/.test(j.message)), true);
}
{
  const w = monde();
  w.S.etat.panne = (table, methode) => table === "peremption_decisions" && methode === "GET";
  const { filet } = await import("../netlify/functions/peremption-cron.js");
  const r = await filet({ peremption: w.X.brut, maintenant: Date.parse("2026-10-21T09:25:00Z") });
  w.S.etat.panne = null;
  const passages = w.S.table("peremption_passages");
  eq("filet en erreur (Supabase) : réponse « erreur », passage marqué « erreur », alerte au journal", [!!r.erreur, passages.at(-1).statut, journalDe(w.S, "alerte").some(j => /« filet » en échec/.test(j.message))], [true, "erreur", true]);
  eq("admin : bandeau « filet en échec depuis … »", !!(await w.X.etatAdmin()).filet.echec_depuis, true);
}
// O12 : piste d'audit : intention avant chaque écriture, journal en panne → aucune écriture (échec fermé)
{
  const w = monde();
  await zinnatFacture(w);
  const lignes = journalDe(w.S, "creer").map(j => j.resultat);
  eq("création : ligne d'intention puis de résultat autour de l'appel Odoo", lignes, ["en_cours", "ok"]);
  const w2 = monde();
  w2.S.etat.panne = (table, methode) => table === "peremption_journal" && methode === "POST";
  await zinnatFacture(w2);
  eq("journal en panne : aucune écriture dans Odoo", w2.O.etat.ecritures.length, 0);
}
// O15 : aperçus de déploiement : jamais d'écriture, même avec la variable
eq("verrous : déploiement « deploy-preview » avec la variable → aucune écriture", [M.verrous({ mode: "actif" }, { PEREMPTION_ODOO_ECRITURE: "1", CONTEXT: "deploy-preview" }).creation, M.verrous({ mode: "actif" }, { PEREMPTION_ODOO_ECRITURE: "1", CONTEXT: "production" }).creation], [false, true]);
// O16 : plafond : toutes les décisions qui portent des règles comptent (voulue, partielle, erreur…)
{
  const w = monde({ reglages: { plafond_produits_factures: 2 } });
  w.O.etat.refuserListes.add(1112);
  await zinnatFacture(w);                                             // partielle
  const a = await w.X.apercu({ cips: [P.SURB.cip], remise: 40, sousCout: { [P.SURB.cip]: true } });
  await w.X.brut.appliquer({ cips: [P.SURB.cip], remise: 40, sousCout: { [P.SURB.cip]: true }, apercus: { [P.SURB.cip]: a.produits[0].apercu_id }, acteur: "z" });   // voulue (pas exécutée)
  const r = await w.X.brut.appliquer({ cips: [P.HEC.cip], remise: 40, sousCout: { [P.HEC.cip]: true }, acteur: "z" });
  eq("plafond de 2 : une partielle et une voulue comptent, la 3e est refusée", r.refus.map(x => x.raisons[0].code), ["plafond"]);
}
// Admin : aperçu d'une modification, d'un produit en retrait, chiffres du lot ; compteurs ; réglages corrigés ; écarts
{
  const w = monde();
  await zinnatFacture(w, 30);
  const a = await w.X.apercu({ cips: [P.ZINNAT.cip], remise: 20, sousCout: { [P.ZINNAT.cip]: true } });
  const z = a.produits[0];
  eq("aperçu d'une modification : type « modifier », « Modifier la règle n° … : remise 30 % → 20 % (dates inchangées) »",
    [z.type, /^Modifier la règle n° \d+ : remise 30 % → 20 % sur PGHT \(dates inchangées : du 21\/10\/2026 au 29\/01\/2027\)$/.test(z.listes[0].changement)], ["modifier", true]);
  eq("aperçu d'une modification : « sans effet » comparé au prix habituel figé (pas au prix du jour, qui porte notre remise)", z.listes.map(l => l.sans_effet), [false, false, false, false, false, false]);
  eq("aperçu : ce que dira la facture et l'économie par liste", [z.facture, z.listes[0].economie_pct], [{ pu: 3.74, remise_pct: 20 }, 14.8]);
  await w.X.retirer({ cips: [P.ZINNAT.cip], acteur: "z" });
  const b = await w.X.apercu({ cips: [P.ZINNAT.cip, P.ZADI.cip], remise: 12, sousCout: {} });
  eq("aperçu : produit en retrait → « en_retrait » (réappliquer après la suppression), lot long → écarté ; chiffres du lot sans eux",
    [b.produits.map(p => p.type), /En cours de retrait/.test(b.produits[0].eligibilite.raisons[0].texte), b.lot.creations, b.lot.effet_lgo_mois], [["en_retrait", "ecarte"], true, 0, 0]);
  const r = await w.X.brut.appliquer({ cips: [P.ZINNAT.cip], remise: 12, sousCout: { [P.ZINNAT.cip]: true }, acteur: "z" });
  vrai("appliquer sur un produit en retrait : refus qui dit quoi faire", /en cours de retrait : réappliquer après la suppression/.test(r.refus[0].raisons[0].texte));
  const reg = await w.X.changerReglages({ valeurs: { remise_max_pct: 95, delai_retrait_min: "abc" }, acteur: "z" });
  eq("réglages : valeurs corrigées signalées (95 → 90, « abc » → 120)", reg.corrections.map(c => [c.champ, c.garde]), [["remise_max_pct", 90], ["delai_retrait_min", 120]]);
}
{
  const w = monde();
  for (let off = 0, g = 0; g < 20; g++) { const r = await w.X.passageNuit({ offset: off }); if (r.done) break; off = r.next_offset; }
  await zinnatFacture(w);
  const e = await w.X.etatAdmin();
  eq("compteurs : page visible (fantôme masqué compté à part), en cours, non facturés dont à remiser ; perte prévue sur les faits du jour",
    [e.compteurs.page, e.compteurs.masques, e.compteurs.visibles, e.compteurs.facturees, typeof e.compteurs.en_cours, e.compteurs.perte_prevue, e.compteurs.valeur_court_cout], [13, 1, 12, 1, "number", 1.5, 34.4]);
  eq("alertes de l'admin : le résumé de la nuit n'en est pas une", [e.alertes.some(a => /Résumé/.test(a.message)), !!e.resume_nuit], [false, true]);
}
{
  const w = monde();
  w.O.ajouterVente({ pid: P.ZADI.id, qte: 3, ref: "1791000000000", pu: 3.83, remise: 6, commande: "S351354" });
  w.O.ajouterVente({ pid: P.HEC.id, qte: 2, ref: "1791000000000", pu: 10.32, remise: 5.43, commande: "S351354" });
  w.O.ajouterVente({ pid: P.SURB.id, qte: 1, ref: "1791000000001", pu: 7.03, remise: 14.65, commande: "S351355", liste: 15 });
  w.S.table("elixir_orders").push({ id: 1791000000000, date: "2026-10-18T10:00:00Z", pharmacy_name: "Pharmacie d'essai", source: "catalogue",
    items: [{ cip: P.ZADI.cip, name: "ZADITEN", qty: 3, pn: 1.92 }, { cip: P.HEC.cip, name: "HEC", qty: 2, pn: 9.76 }] },
    { id: 1791000000001, date: "2026-10-18T11:00:00Z", pharmacy_name: "Pharmacie liste 15", source: "catalogue", items: [{ cip: P.SURB.cip, name: "SURBRONC", qty: 1, pn: 5.98 }] });
  const e = await w.X.ecarts({ depuis: "2026-10-01" });
  eq("écarts : « page péremption probable » (PU = prix de base × 0,5, ancienne page) à part des autres écarts (client d'une autre liste), liste de la commande",
    [e.lignes.map(l => [l.cip, l.type, l.page_peremption, l.liste]), e.total_peremption, e.total_probable, e.total_autres], [[[P.ZADI.cip, "probable", true, 5], [P.SURB.cip, "autre", false, 15]], 0, 5.04, 0.02]);
}
// Site : produits « fantômes » renvoyés à part (paniers de l'ancienne page), page en base « prix habituel »
{
  const w = monde();
  await w.X.reconcilier({ acteur: "nuit", etendue: "nuit" });
  const page = await w.X.etatPublic();
  eq("page : produit « fantôme » absent de la liste mais renvoyé dans « masques » avec son prix actuel", [page.produits.some(p => p.cip === P.FANTOME.cip), page.masques.map(m => [m.cip, m.prix])], [false, [[P.FANTOME.cip, w.O.prixFacture(P.FANTOME.id, 5)]]]);
}
{
  const w = monde({ reglages: { base_remise: "prix_liste5" } });
  await zinnatFacture(w, 10);
  const z = (await w.X.etatPublic()).produits.find(p => p.cip === P.ZINNAT.cip);
  eq("base « % du prix habituel » : la page barre le prix habituel (3,51 €) et annonce −10 % ; la règle porte 15,53 % (2 décimales)",
    [z.facturee, z.prix_barre, z.prix, z.remise_pct, w.O.reglesSite()[0].percent_price], [true, 3.51, 3.16, 10, 15.53]);
}

// ── 15. Règle panier (21/10/2026) : remise affichée, offre de la page, écarts et leur suivi ──
{
  // écart d'une ligne (pur) : ligne « Pér. » au prix de la page contre sa ligne de vente Odoo
  const per = { cip: P.HEC.cip, qty: 2, pn: 5.16, peremption: "2026-12-31", remise: 50, facture_odoo: false };
  const odoo = (qte, pu, remise) => ({ product_uom_qty: qte, price_unit: pu, discount: remise, price_subtotal: Math.round(pu * (1 - remise / 100) * qte * 100) / 100 });
  const e1 = M.ecartLigne(per, odoo(2, 10.32, 5.43));
  eq("écart : ligne « Pér. » à −50 % (5,16 €) facturée 9,76 € → 9,20 € à rectifier, cohérente", [e1.type, e1.qte, e1.net, e1.ecart, e1.coherent, e1.remise], ["peremption", 2, 9.76, 9.2, true, 50]);
  eq("écart : ligne réellement facturée par une règle Odoo (V1, net ≤ prix du panier) → pas d'écart", M.ecartLigne({ ...per, facture_odoo: true }, odoo(2, 10.32, 50)), null);
  const v1 = M.ecartLigne({ ...per, remise: undefined, peremption_remise: 12, pn: 9.08 }, odoo(2, 10.32, 5.43));
  eq("écart : ligne « facturée par Odoo » au panier mais règle absente à l'import (retirée, finie) → écart signalé (règle absente)", [v1.type, v1.ecart, v1.regle_absente], ["peremption", 1.36, true]);
  eq("écart : prix corrigé à la main dans Odoo (travail manuel fait) → aucun écart", M.ecartLigne(per, odoo(2, 10.32, 50)), null);
  eq("écart : boîtes additionnées par le connecteur (menu 3 + péremption 2 sur une ligne de 5) → 2 boîtes seulement", [M.ecartLigne({ ...per, separeDe: "1" }, odoo(5, 10.32, 5.43)).qte, M.ecartLigne({ ...per, separeDe: "1" }, odoo(5, 10.32, 5.43)).ecart], [2, 9.2]);
  eq("écart : quantité servie plus petite → boîtes servies", M.ecartLigne(per, odoo(1, 10.32, 5.43)).qte, 1);
  eq("écart : prix plus bas que prix de base × (1 − remise) → « à vérifier »", M.ecartLigne({ ...per, pn: 1 }, odoo(2, 10.32, 5.43)).coherent, false);
  eq("écart : ligne du lot 0 (mention sans remise) facturée plus cher → « autre » ; ancienne page → « probable »",
    [M.ecartLigne({ cip: "1", qty: 1, pn: 9.5, peremption: "2026-12-31" }, odoo(1, 10.32, 5.43)).type, M.ecartLigne({ cip: "1", qty: 1, pn: 5.16 }, odoo(1, 10.32, 5.43)).type], ["autre", "probable"]);
  eq("clé d'écart : « <n° commande>:<CIP> »", ["1792000000000:3400930470312", "1792000000000:3400930470312:2", "x:1", "1792000000000:12"].map(M.cleEcartValide), [true, true, false, false]);
}
{
  // offre de la page (etatPublic) : −50 % par défaut, −20 % dès 500 €, remise de l'admin (0 = aucune), prix habituel plus bas,
  // règle Odoo facturée (V1) prioritaire
  const w = monde({ remisesAffichees: [{ cip: P.ZADI.cip, discount_pct: 30 }, { cip: P.SURB.cip, discount_pct: 0 }] });
  await zinnatFacture(w, 12);
  const page = await w.X.etatPublic();
  const of = (k) => { const p = page.produits.find(x => x.cip === P[k].cip); return p ? [p.offre.pn, p.offre.remise, p.offre.source, p.offre.facture_odoo, p.remise_admin] : null; };
  eq("page : Hec −50 % par défaut (10,32 → 5,16 €), comme avant le 20/10", of("HEC"), [5.16, 50, "defaut", false, null]);
  eq("page : Ninlaro (5 000 €) −20 % dès 500 € → 4 000 €", of("TAKEDA"), [4000, 20, "defaut", false, null]);
  eq("page : Zaditen −30 % (remise affichée de l'admin)", of("ZADI"), [2.68, 30, "admin", false, 30]);
  eq("page : Surbronc à 0 % (admin) → prix habituel, sans remise", of("SURB"), [6, 0, "habituel", false, 0]);
  eq("page : FFP2 au prix habituel (2,99 €, sous 5,99 × 0,5)", of("FFP2"), [2.99, 0, "habituel", false, null]);
  eq("page : Zinnat facturé par Odoo (V1) à −12 % → 3,29 €, remise de la facture (pas −50 %)", of("ZINNAT"), [3.29, 12, "odoo", true, null]);
  eq("page : nombre de produits remisés", page.remises, page.produits.filter(p => p.offre.remise >= 1).length);
  vrai("page publique : ni coût ni marge", !/"cout"|marge/.test(JSON.stringify(page)));
  // admin : remise affichée par produit et ce que facture Odoo
  const etat = await w.X.etatAdmin();
  const ad = (k) => etat.produits.find(p => p.cip === P[k].cip);
  eq("admin : remise affichée et facturation par produit", [ad("HEC").affichage.remise, ad("HEC").affichage.facture_odoo, ad("ZADI").remise_admin, ad("ZINNAT").affichage.source, ad("SURB").affichage.motif],
    [50, false, 30, "odoo", "admin_zero"]);
  eq("admin : compteur des produits remisés sur la page", etat.compteurs.remises_affichees, etat.produits.filter(p => p.affichage?.remise >= 1 && !p.masque).length);
}
{
  // HTTP : remise affichée (admin, expiry_discounts, aucune écriture Odoo) ; prix des produits sortis de la page (public)
  const w = monde();
  const admin = async (ev) => (/jeton-admin/.test(ev.headers?.authorization || "") ? { admin: { email: "Zineb@Elixir.test" } } : { error: { statusCode: 401, headers: {}, body: "{}" } });
  const h = creerHandler({ peremption: w.X, verifyAdmin: admin });
  const ev = (methode, { q, corps, jeton } = {}) => ({ httpMethod: methode, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, queryStringParameters: q || {}, body: corps ? JSON.stringify(corps) : null });
  eq("remise affichée sans jeton admin : 401, rien écrit", [(await h(ev("POST", { corps: { action: "remise_affichee", cip: P.HEC.cip, remise_pct: 30 } }))).statusCode, w.S.table("expiry_discounts").length], [401, 0]);
  eq("remise affichée hors bornes (95, 12,5, « abc ») : 400", await Promise.all([95, 12.5, "abc"].map(async r => (await h(ev("POST", { jeton: "jeton-admin", corps: { action: "remise_affichee", cip: P.HEC.cip, remise_pct: r } }))).statusCode)), [400, 400, 400]);
  const r30 = await h(ev("POST", { jeton: "jeton-admin", corps: { action: "remise_affichee", cip: P.HEC.cip, remise_pct: 30, nom: "HEC" } }));
  eq("remise affichée 30 % : enregistrée (clé serveur), page à 7,22 €", [r30.statusCode, w.S.table("expiry_discounts").map(x => [x.cip, x.discount_pct]), (await w.X.etatPublic()).produits.find(p => p.cip === P.HEC.cip).offre.pn],
    [200, [[P.HEC.cip, 30]], 7.22]);
  await h(ev("POST", { jeton: "jeton-admin", corps: { action: "remise_affichee", cip: P.HEC.cip, remise_pct: 0 } }));
  eq("remise affichée 0 % : aucune remise, prix habituel (9,76 €)", (await w.X.etatPublic()).produits.find(p => p.cip === P.HEC.cip).offre.pn, 9.76);
  await h(ev("POST", { jeton: "jeton-admin", corps: { action: "remise_affichee", cip: P.HEC.cip, remise_pct: null } }));
  eq("remise affichée vide : retour au défaut (−50 %), ligne supprimée", [w.S.table("expiry_discounts").length, (await w.X.etatPublic()).produits.find(p => p.cip === P.HEC.cip).offre.remise], [0, 50]);
  eq("remise affichée : journal (qui, avant → après), aucune écriture Odoo", [journalDe(w.S, "remise_affichee").length, journalDe(w.S, "remise_affichee")[0].acteur, journalDe(w.S, "remise_affichee")[0].mode, w.O.etat.ecritures.length],
    [3, "zineb@elixir.test", "site", 0]);
  const px = JSON.parse((await h(ev("GET", { q: { action: "prix", cips: `${P.HEC.cip},${P.ZADI.cip}` } }))).body);
  eq("prix des produits sortis de la page : public, prix et paliers, ni stock ni lot", [px.produits.map(p => [p.cip, p.discounted_price]), /available|lots|cout/.test(JSON.stringify(px))], [[[P.HEC.cip, 9.76], [P.ZADI.cip, 3.6]], false]);
  eq("prix : 51 CIP ou aucun → 400", [(await h(ev("GET", { q: { action: "prix", cips: Array.from({ length: 51 }, (_, i) => String(3400930000000 + i)).join(",") } }))).statusCode, (await h(ev("GET", { q: { action: "prix", cips: "abc" } }))).statusCode], [400, 400]);
}
{
  // Contrôle des écarts : lignes « Pér. » de la règle panier, commande à part (separeDe : boîtes additionnées sur la ligne Odoo
  // de l'autre commande), ligne facturée par une règle Odoo, ligne corrigée à la main ; statuts ; résumé ; table absente
  const w = monde();
  const A = 1792600000000, B = 1792600000002, C = 1792650000000, D = 1792800000000;
  // Pharmacie 1 : menu Hec 3 (commande A) + Hec 2 en péremption (commande B, à part) → une ligne Odoo de 5 sous la réf. A
  w.O.ajouterVente({ pid: P.HEC.id, qte: 5, ref: String(A), pu: 10.32, remise: 5.43, commande: "S400001" });
  // Pharmacie 1 : Zaditen −50 % (1,92 €), facturé 3,60 €
  w.O.ajouterVente({ pid: P.ZADI.id, qte: 2, ref: String(A), pu: 3.83, remise: 6, commande: "S400001" });
  // Pharmacie 2 : Surbronc −50 %, prix corrigé à la main dans Odoo (3,52 €) → aucun écart ; Ninlaro facturé par une règle Odoo
  w.O.ajouterVente({ pid: P.SURB.id, qte: 1, ref: String(C), pu: 7.03, remise: 50, commande: "S400002" });
  w.O.ajouterVente({ pid: P.TAKEDA.id, qte: 1, ref: String(C), pu: 5000, remise: 5, commande: "S400002" });
  // Pharmacie 3 : Zinnat −50 % (1,87 €) facturé 3,51 €, commande d'avant la règle panier (période)
  w.O.ajouterVente({ pid: P.ZINNAT.id, qte: 4, ref: String(D), pu: 3.74, remise: 6.15, commande: "S400003" });
  const ligne = (cip, qty, pn, remise, extra = {}) => ({ cip, name: Object.values(P).find(p => p.cip === cip).nom, qty, pn, total: pn * qty, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise, facture_odoo: false, ...extra });
  w.S.table("elixir_orders").push(
    { id: A, date: new Date(A).toISOString(), pharmacy_name: "Pharmacie Une", pharmacy_cip: "1111111", source: "catalogue", items: [{ cip: P.HEC.cip, name: "HEC", qty: 3, pn: 9.76, total: 29.28 }, ligne(P.ZADI.cip, 2, 1.92, 50)] },
    { id: B, date: new Date(B).toISOString(), pharmacy_name: "Pharmacie Une", pharmacy_cip: "1111111", source: "catalogue", items: [ligne(P.HEC.cip, 2, 5.16, 50, { separeDe: String(A) })] },
    { id: C, date: new Date(C).toISOString(), pharmacy_name: "Pharmacie Deux", source: "catalogue", items: [ligne(P.SURB.cip, 1, 3.52, 50), ligne(P.TAKEDA.cip, 1, 4750, 5, { facture_odoo: true })] },
    { id: D, date: new Date(D).toISOString(), pharmacy_name: "Pharmacie Trois", source: "catalogue", items: [ligne(P.ZINNAT.cip, 4, 1.87, 50)] });
  const e = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("écarts « Pér. » : Hec à part (2 boîtes sur la ligne de 5 de l'autre commande), Zaditen, Zinnat ; ni Surbronc (corrigé dans Odoo) ni Ninlaro (règle Odoo)",
    e.lignes.map(l => [l.cle, l.commande, l.odoo, l.qte, l.pn, l.net, l.ecart, l.separe_de, l.statut]),
    [[`${A}:${P.ZADI.cip}`, String(A), "S400001", 2, 1.92, 3.6, 3.36, null, "a_rectifier"], [`${B}:${P.HEC.cip}`, String(B), "S400001", 2, 5.16, 9.76, 9.2, String(A), "a_rectifier"],
      [`${D}:${P.ZINNAT.cip}`, String(D), "S400003", 4, 1.87, 3.51, 6.56, null, "a_rectifier"]]);
  eq("écarts : liste de prix, pharmacie, suivi installé", [e.lignes.map(l => l.liste), e.lignes.map(l => l.pharmacie), e.suivi], [[5, 5, 5], ["Pharmacie Une", "Pharmacie Une", "Pharmacie Trois"], "ok"]);
  const periode = await w.X.ecarts({ depuis: "2026-10-21", jusqua: new Date(C).toISOString().slice(0, 10), types: ["peremption"] });
  eq("écarts : filtre de période (jusqu'au jour de la commande C)", periode.lignes.map(l => l.commande), [String(A), String(B)]);
  const res0 = await w.X.ecartsResume({ depuis: "2026-10-21", frais: true });
  eq("résumé : « 19,12 € à rectifier pour 2 pharmacies »", [res0.a_rectifier, res0.rectifie.lignes, res0.pharmacies.map(p => [p.pharmacie, p.montant])],
    [{ montant: 19.12, lignes: 3, pharmacies: 2 }, 0, [["Pharmacie Une", 12.56], ["Pharmacie Trois", 6.56]]]);
  // marquer rectifié (avoir), puis annuler ; qui, quand, montants gardés ; journal
  const lUne = e.lignes.filter(l => l.pharmacie === "Pharmacie Une");
  const st = await w.X.changerStatutEcarts({ lignes: lUne, statut: "rectifie", reference: "  AV-2026-118  ", acteur: "zineb@elixir.test" });
  eq("rectifié : 2 lignes, référence nettoyée, qui", [st.ok, st.lignes, st.reference, st.par, st.total], [true, 2, "AV-2026-118", "zineb@elixir.test", 12.56]);
  const e2 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("écarts relus : statut, référence, qui, quand", e2.lignes.map(l => [l.statut, l.reference, l.par, !!l.le]),
    [["rectifie", "AV-2026-118", "zineb@elixir.test", true], ["rectifie", "AV-2026-118", "zineb@elixir.test", true], ["a_rectifier", null, null, false]]);
  eq("table : montants au moment du changement", w.S.table("peremption_ecarts").map(r => [r.cle, r.statut, r.prix_page, r.prix_facture, r.ecart, r.commande_odoo]),
    [[`${A}:${P.ZADI.cip}`, "rectifie", 1.92, 3.6, 3.36, "S400001"], [`${B}:${P.HEC.cip}`, "rectifie", 5.16, 9.76, 9.2, "S400001"]]);
  const res1 = await w.X.ecartsResume({ depuis: "2026-10-21" });
  eq("résumé après rectification (cache vidé) : 6,56 € pour 1 pharmacie, 12,56 € rectifiés", [res1.a_rectifier, res1.rectifie], [{ montant: 6.56, lignes: 1, pharmacies: 1 }, { montant: 12.56, lignes: 2 }]);
  await w.X.changerStatutEcarts({ lignes: [lUne[0]], statut: "a_rectifier", acteur: "zineb@elixir.test" });
  eq("annuler : la ligne repasse « à rectifier »", (await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] })).lignes.map(l => l.statut), ["a_rectifier", "rectifie", "a_rectifier"]);
  eq("statut : journal (ajout seul), aucune écriture Odoo", [journalDe(w.S, "ecart").length, w.O.etat.ecritures.length], [2, 0]);
  eq("statut invalide ou clé invalide : refusé", [(await w.X.changerStatutEcarts({ lignes: lUne, statut: "paye" })).erreur != null, (await w.X.changerStatutEcarts({ lignes: [{ cle: "x" }], statut: "rectifie" })).erreur != null], [true, true]);
  const tous = await w.X.ecarts({ depuis: "2026-10-21" });
  eq("tous les types : Hec du menu au bon prix, pas d'écart ; aucune autre ligne", tous.lignes.length, 3);
  // HTTP : résumé et statut (admin)
  const h = creerHandler({ peremption: w.X, verifyAdmin: async (ev) => (/jeton-admin/.test(ev.headers?.authorization || "") ? { admin: { email: "z@e.test" } } : { error: { statusCode: 401, headers: {}, body: "{}" } }) });
  const g = (q, jeton = "jeton-admin") => h({ httpMethod: "GET", headers: { authorization: `Bearer ${jeton}` }, queryStringParameters: q, body: null });
  eq("HTTP : écarts et résumé réservés à l'admin", [(await g({ action: "ecarts_resume" }, "x")).statusCode, (await g({ action: "ecarts", depuis: "2026-10-21" }, "x")).statusCode], [401, 401]);
  const rh = JSON.parse((await g({ action: "ecarts_resume", depuis: "2026-10-21", frais: "1" })).body);
  eq("HTTP : résumé", rh.a_rectifier, { montant: 9.92, lignes: 2, pharmacies: 2 });
  const eh = JSON.parse((await g({ action: "ecarts", depuis: "2026-10-21", types: "peremption,inconnu" })).body);
  eq("HTTP : écarts filtrés par type (type inconnu ignoré)", eh.lignes.length, 3);
  const sh = await h({ httpMethod: "POST", headers: { authorization: "Bearer jeton-admin" }, queryStringParameters: {}, body: JSON.stringify({ action: "ecart_statut", statut: "rectifie", reference: "AV-9", lignes: [eh.lignes[2]] }) });
  eq("HTTP : statut (admin)", [sh.statusCode, JSON.parse(sh.body).par], [200, "z@e.test"]);
}
// ── 15 bis. Contrôle des écarts, revue du 21/10/2026 : regroupement par commande Odoo et produit, factures et avoirs, offre
// recalculée côté serveur, lignes non retrouvées, période à l'heure de Paris, statuts (complément, référence gardée, recalcul) ──
{
  const L = (boites, montant, puNet) => ({ boites, montant, puNet });
  const site = (menu, per, pnMenu = 9.76, pnPer = 5.16) => [...(menu ? [{ qty: menu, pn: pnMenu, per: false }] : []), { qty: per, pn: pnPer, per: true }];
  const g = (o, s0) => M.repartirGroupe(o, s0).lignes[0];
  eq("groupe : ligne de 5 (menu 3 + Pér. 2) non corrigée → 2 boîtes, 9,20 €", g([L(5, 48.8, 9.76)], site(3, 2)), { qte: 2, ecart: 9.2, net: 9.76 });
  eq("groupe : même ligne corrigée comme le demande l'e-mail (39,60 €) → aucun écart", g([L(5, 39.6, 7.92)], site(3, 2)).ecart, 0);
  eq("groupe : ligne scindée à la main (3 × 9,76 + 2 × 5,16) → aucun écart", g([L(3, 29.28, 9.76), L(2, 10.32, 5.16)], site(3, 2)).ecart, 0);
  eq("groupe : commande à part pas encore importée (3 boîtes du menu seulement) → 0 boîte « Pér. », aucun écart", g([L(3, 29.28, 9.76)], site(3, 2)), { qte: 0, ecart: 0, net: null });
  eq("groupe : Pér. 5, Odoo 3 à 9,76 puis 2 corrigées à 5,16 → 13,80 €", g([L(3, 29.28, 9.76), L(2, 10.32, 5.16)], site(0, 5)).ecart, 13.8);
  eq("groupe : service réduit (2 servies sur 5) → boîtes du menu d'abord, aucune « Pér. », service réduit", [g([L(2, 19.52, 9.76)], site(3, 2)).qte, M.repartirGroupe([L(2, 19.52, 9.76)], site(3, 2)).serviReduit], [0, true]);
  eq("groupe : autre panier inconnu additionné (8 boîtes) → plafonné aux boîtes « Pér. » × (PU − prix de la page)", g([L(8, 78.08, 9.76)], site(3, 2)).ecart, 9.2);
  const mv = new Map([[1, { type: "out_invoice", etat: "posted", quantite: 2, montant: 19.52, numero: "INV/1" }], [2, { type: "out_refund", etat: "posted", quantite: 2, montant: 9.2, numero: "RINV/7" }],
    [3, { type: "out_refund", etat: "draft", quantite: 1, montant: 4.6, numero: "RINV/8" }]]);
  eq("facturé : factures postées − avoirs postés (brouillon ignoré), avoirs listés", M.factureLigne({ product_uom_qty: 2, price_subtotal: 19.52, invoice_lines: [1, 2, 3], qty_delivered: 2 }, mv),
    { boites: 2, montant: 10.32, puNet: 9.76, avoirs: [{ numero: "RINV/7", montant: 9.2 }], facturee: true });
  eq("facturé : rien de facturé, 3 livrées sur 5 → 3 boîtes au net de la ligne", M.factureLigne({ product_uom_qty: 5, price_subtotal: 48.8, invoice_lines: [], qty_delivered: 3 }), { boites: 3, montant: 29.28, puNet: 9.76, avoirs: [], facturee: false });
  eq("période : minuit à Paris (heure d'été, d'hiver)", [M.minuitParisIso("2026-10-21"), M.minuitParisIso("2026-10-26"), M.jourValide("2026-02-30")], ["2026-10-20T22:00:00.000Z", "2026-10-25T23:00:00.000Z", false]);
}
{
  const w = monde({ t: Date.parse("2026-10-23T08:00:00Z") });
  const A = 1792600000000, B = A + 2;
  const ligne = (cip, qty, pn, remise, extra = {}) => ({ cip, name: "nom du navigateur", qty, pn, total: pn * qty, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise, facture_odoo: false, ...extra });
  const cmd = (id, nom, items, extra = {}) => ({ id, date: extra.date || new Date(id).toISOString(), pharmacy_name: nom, pharmacy_cip: extra.pcip || "1111111", source: "catalogue", items });
  const menu = (cip, qty, pn) => ({ cip, name: "HEC", qty, pn, total: qty * pn });
  // 1. commande à part pas encore importée : la commande A n'a que les 3 boîtes du menu
  w.O.ajouterVente({ pid: P.HEC.id, qte: 3, ref: String(A), pu: 10.32, remise: 5.43, commande: "S500001" });
  w.S.table("elixir_orders").push(cmd(A, "Pharmacie Une", [menu(P.HEC.cip, 3, 9.76)]), cmd(B, "Pharmacie Une", [ligne(P.HEC.cip, 2, 5.16, 50, { separeDe: String(A) })]));
  const e1 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("à part pas encore importée : aucun écart (boîtes du menu jamais baissées), ligne « en attente d'import »", [e1.lignes.length, e1.non_retrouvees.map(x => [x.cle, x.motif])], [0, [[`${B}:${P.HEC.cip}`, "attente_import"]]]);
  // la commande à part arrive dans la même commande Odoo (le connecteur : deuxième ligne du même produit, même réf.)
  const v2 = w.O.ajouterVente({ pid: P.HEC.id, qte: 2, ref: String(A), pu: 10.32, remise: 5.43, commande: "S500001" });
  const e2 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("importée (deux lignes Odoo de la même commande, même réf.) : 2 boîtes, 9,20 €, cohérente, à corriger avant facture", e2.lignes.map(l => [l.cle, l.qte, l.ecart, l.coherent, l.facturation, l.odoo, l.nom]),
    [[`${B}:${P.HEC.cip}`, 2, 9.2, true, "to invoice", "S500001", "HEC POM NACU T/25G"]]);
  // corrigée dans Odoo en scindant : la ligne de 2 annulée, une ligne ajoutée à la main sans référence (2 × 5,16 €)
  w.O.modifierVente(v2, { state: "cancel" });
  w.O.ajouterVente({ pid: P.HEC.id, qte: 2, ref: null, pu: 5.16, remise: 0, commande: "S500001" });
  const e3 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("corrigée à la main (ligne annulée ignorée, ligne ajoutée sans référence lue) : la ligne disparaît d'elle-même", [e3.lignes.length, e3.non_retrouvees.length], [0, 0]);
}
{
  // correction complète : remise sur la ligne additionnée (total 39,60 €) ; servie réduite ; règle absente ; offre forgée
  const w = monde({ t: Date.parse("2026-10-23T08:00:00Z") });
  const A = 1792600000000, B = A + 2, C = A + 10, D = A + 20, E = A + 30;
  const ligne = (cip, qty, pn, remise, extra = {}) => ({ cip, name: "x", qty, pn, total: pn * qty, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise, facture_odoo: false, ...extra });
  const cmd = (id, nom, items, pcip = "1111111") => ({ id, date: new Date(id).toISOString(), pharmacy_name: nom, pharmacy_cip: pcip, source: "catalogue", items });
  w.O.ajouterVente({ pid: P.HEC.id, qte: 5, ref: String(A), pu: 10.32, remise: 23.26, commande: "S600001" });
  w.O.ajouterVente({ pid: P.ZADI.id, qte: 4, ref: String(C), pu: 3.83, remise: 6, commande: "S600002" });   // 4 servies sur 5 (menu 3 + Pér. 2)
  w.O.ajouterVente({ pid: P.ZINNAT.id, qte: 2, ref: String(D), pu: 3.74, remise: 6.15, commande: "S600003" });
  w.O.ajouterVente({ pid: P.TAKEDA.id, qte: 1, ref: String(E), pu: 5000, remise: 0, commande: "S600004" });
  w.O.ajouterVente({ pid: P.SURB.id, qte: 10, ref: String(E), pu: 7.03, remise: 0, commande: "S600004" });
  w.S.table("elixir_orders").push(cmd(A, "Pharmacie Une", [{ cip: P.HEC.cip, name: "HEC", qty: 3, pn: 9.76 }]), cmd(B, "Pharmacie Une", [ligne(P.HEC.cip, 2, 5.16, 50, { separeDe: String(A) })]),
    cmd(C, "PHARMACIE CENTRALE", [{ cip: P.ZADI.cip, name: "Z", qty: 3, pn: 3.6 }, ligne(P.ZADI.cip, 2, 1.92, 50)], "2222222"),
    cmd(D, "PHARMACIE CENTRALE", [ligne(P.ZINNAT.cip, 2, 1.87, 50, { facture_odoo: true, remise: 50 })], "3333333"),
    cmd(E, "Pharmacie Forgée", [ligne(P.TAKEDA.cip, 1, 2500, 50), ligne(P.SURB.cip, 10, 0.7, 90)]));
  const e = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  const par = (cip) => e.lignes.find(l => l.cip === cip);
  eq("ligne additionnée corrigée par une remise (39,60 €) : aucun écart", par(P.HEC.cip), undefined);
  eq("4 servies sur 5 (menu 3 + Pér. 2) : 1 boîte « Pér. », à vérifier (service réduit)", [par(P.ZADI.cip).qte, par(P.ZADI.cip).ecart, par(P.ZADI.cip).coherent, /servies/.test(par(P.ZADI.cip).a_verifier.join())], [1, 1.68, false, true]);
  eq("« facturée par Odoo » au panier, règle absente à l'import : écart signalé (règle absente), cohérent (−50 % de la page)", [par(P.ZINNAT.cip).ecart, par(P.ZINNAT.cip).regle_absente, par(P.ZINNAT.cip).coherent], [3.28, true, true]);
  eq("offre forgée (Ninlaro −50 % au lieu de −20 % ; Surbronc −90 %) : à vérifier, hors des totaux", [par(P.TAKEDA.cip).coherent, par(P.SURB.cip).coherent, /au plus −20 %/.test(par(P.TAKEDA.cip).a_verifier[0]), e.total_peremption],
    [false, false, true, 3.28]);
  const r = await w.X.ecartsResume({ depuis: "2026-10-21", frais: true });
  eq("résumé : seules les lignes cohérentes ; pharmacies par CIP (deux « PHARMACIE CENTRALE » restent deux) ; à vérifier à part",
    [r.a_rectifier, r.pharmacies.map(p => [p.pharmacie, p.pharmacy_cip, p.montant]), r.a_verifier.lignes], [{ montant: 3.28, lignes: 1, pharmacies: 1 }, [["PHARMACIE CENTRALE", "3333333", 3.28]], 3]);
  // statuts recalculés côté serveur : montant du navigateur ignoré ; clé sans écart refusée
  const st = await w.X.changerStatutEcarts({ lignes: [{ cle: `${D}:${P.ZINNAT.cip}`, ecart: 999, pharmacie: "=HYPERLINK()" }], statut: "rectifie", reference: "AV-1", acteur: "z" });
  eq("rectifié : montants du serveur (3,28 €, pas 999), nom de la pharmacie du serveur", [st.total, w.S.table("peremption_ecarts").map(x => [x.ecart, x.pharmacie, x.nom])], [3.28, [[3.28, "PHARMACIE CENTRALE", "ZINNAT 125 mg B/8"]]]);
  eq("rectifié : clé sans écart actuel refusée", (await w.X.changerStatutEcarts({ lignes: [{ cle: `${A}:${P.HEC.cip}` }], statut: "rectifie", acteur: "z" })).erreur != null, true);
  // complément : l'écart a grossi depuis le marquage (montant enregistré plus petit)
  w.S.table("peremption_ecarts")[0].ecart = 2;
  const e2 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("rectifiée puis écart grossi : complément à rectifier (1,28 €), compté dans le résumé", [e2.lignes.find(l => l.cip === P.ZINNAT.cip).complement, (await w.X.ecartsResume({ depuis: "2026-10-21", frais: true })).a_rectifier.montant], [1.28, 1.28]);
  // remettre à rectifier : la référence (n° d'avoir) est gardée
  await w.X.changerStatutEcarts({ lignes: [`${D}:${P.ZINNAT.cip}`], statut: "a_rectifier", acteur: "z2" });
  const e3 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("remise à rectifier : référence gardée (ancienne réf.), qui et quand du changement", [w.S.table("peremption_ecarts")[0].reference, e3.lignes.find(l => l.cip === P.ZINNAT.cip).reference_precedente, w.S.table("peremption_ecarts")[0].par],
    ["AV-1", "AV-1", "z2"]);
  eq("aucune écriture Odoo", w.O.etat.ecritures.length, 0);
}
{
  // factures et avoirs : facturée → avoir à faire ; avoir posté → déduit, la ligne disparaît ; avoir partiel → reste
  const w = monde({ t: Date.parse("2026-10-23T08:00:00Z") });
  const B = 1792600000002;
  const v = w.O.ajouterVente({ pid: P.HEC.id, qte: 2, ref: String(B), pu: 10.32, remise: 5.43, commande: "S700001", livre: 2 });
  w.S.table("elixir_orders").push({ id: B, date: new Date(B).toISOString(), pharmacy_name: "P", pharmacy_cip: "1", source: "catalogue", items: [{ cip: P.HEC.cip, name: "HEC", qty: 2, pn: 5.16, peremption: "2026-12-31", remise: 50, facture_odoo: false }] });
  w.O.facturer([{ vente: v, qte: 2 }], "INV/2026/00100");
  const e1 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("facturée : 9,20 €, « facturée »", e1.lignes.map(l => [l.ecart, l.facturation]), [[9.2, "invoiced"]]);
  w.O.avoir([{ vente: v, qte: 1, prix: 4.6 }], "RINV/2026/00042");
  const e2 = await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
  eq("avoir partiel (1 × 4,60 €) détecté et déduit : reste 4,60 €, avoir listé", e2.lignes.map(l => [l.ecart, l.avoirs]), [[4.6, [{ numero: "RINV/2026/00042", montant: 4.6 }]]]);
  w.O.avoir([{ vente: v, qte: 1, prix: 4.6 }], "RINV/2026/00043");
  eq("avoir complet : plus d'écart", (await w.X.ecarts({ depuis: "2026-10-21", types: ["peremption"] })).lignes.length, 0);
}
{
  // lignes non retrouvées, références « <n°>P2 », code interne ≠ CIP (produit relu par odoo_pid), période à l'heure de Paris
  const T = Date.parse("2026-10-25T08:00:00Z");
  const PR = { id: 501, cip: "3400930000001", code: "HEC-25G", nom: "PRODUIT AU CODE INTERNE", tmpl: 501, list_price: 10.32 };
  const mini = () => {
    const O = fauxOdoo({ produits: [PR], quants: [{ pid: 501, exp: "2026-12-31", qte: 10 }] }, { maintenant: () => T });
    const S = fauxSupabase({ maintenant: () => T, tables: { odoo_catalog: [{ cip: PR.cip, name: PR.nom, list_price: 10.32, discounted_price: 9.76, discount_pct: 5.4, earliest_expiry: "2026-12-31", lots: [], odoo_pid: 501 }],
      expiry_discounts: [], peremption_ecarts: [], elixir_orders: [] } });
    return { O, S, X: M.creerPeremption({ odoo: O.odoo, fetch: S.fetch, url: S.url, cle: S.cleService, env: { SUPABASE_KEY: S.cleAnon }, maintenant: () => T }) };
  };
  const per = (qty, extra = {}) => ({ cip: PR.cip, name: "x", qty, pn: 5.16, peremption: "2026-12-31", remise: 50, facture_odoo: false, ...extra });
  const A = 1792800000000, B = A + 2, C = A + 5000, D = A + 9000;
  {
    const { O, S, X } = mini();
    O.ajouterVente({ pid: 501, qte: 5, ref: String(A), pu: 10.32, remise: 5.43, commande: "S800001" });   // A et C regroupées, réf. A seule citée
    O.ajouterVente({ pid: 501, qte: 2, ref: String(B), pu: 10.32, remise: 5.43, commande: "S800003" });
    O.ajouterVente({ pid: 501, qte: 2, ref: `${D}P2`, pu: 10.32, remise: 5.43, commande: "S800002" });     // relais : référence « <n°>P2 »
    S.table("elixir_orders").push({ id: A, date: "2026-10-21T21:30:00.000Z", pharmacy_name: "Une", pharmacy_cip: "1", source: "catalogue", items: [{ cip: PR.cip, name: "x", qty: 3, pn: 9.76 }] },
      { id: B, date: "2026-10-21T21:40:00.000Z", pharmacy_name: "Une", pharmacy_cip: "1", source: "catalogue", items: [per(2)] },
      { id: C, date: "2026-10-21T22:30:00.000Z", pharmacy_name: "Une", pharmacy_cip: "1", source: "catalogue", items: [per(2)] },
      { id: D, date: "2026-10-22T09:00:00.000Z", pharmacy_name: "Deux", pharmacy_cip: "2", source: "catalogue", items: [per(2)] });
    const e = await X.ecarts({ depuis: "2026-10-21", types: ["peremption"] });
    eq("code interne ≠ CIP (produit par odoo_pid) ; « <n°>P2 » retrouvée ; C (citée nulle part) non retrouvée, avec une piste", [e.lignes.map(l => [l.commande, l.ecart]), e.non_retrouvees.map(x => [x.commande, x.motif, x.ancien, /^S8000/.test(x.piste)])],
      [[[String(B), 9.2], [String(D), 9.2]], [[String(C), "introuvable", true, true]]]);
    eq("période à l'heure de Paris : le 21/10 s'arrête à minuit à Paris (C, passée à 00 h 30 le 22, n'en est pas)",
      [(await X.ecarts({ depuis: "2026-10-21", jusqua: "2026-10-21", types: ["peremption"] })).lignes.map(l => l.commande), (await X.ecarts({ depuis: "2026-10-22", types: ["peremption"] })).non_retrouvees.map(x => x.commande)],
      [[String(B)], [String(C)]]);
    const r = await X.ecartsResume({ depuis: "2026-10-21", frais: true });
    eq("tuile : lignes non retrouvées comptées (plus de 24 h)", [r.non_retrouvees, r.a_rectifier.montant], [{ lignes: 1, recentes: 0 }, 18.4]);
  }
  {
    // commande visée par separeDe sur la page précédente : relue, ses boîtes du menu déduites (ligne additionnée corrigée : 39,60 €)
    const { O, S, X } = mini();
    O.ajouterVente({ pid: 501, qte: 5, ref: String(A), pu: 10.32, remise: 23.26, commande: "S900001" });
    S.table("elixir_orders").push({ id: A, date: "2026-10-21T08:00:00.000Z", pharmacy_name: "Une", pharmacy_cip: "1", source: "catalogue", items: [{ cip: PR.cip, name: "x", qty: 3, pn: 9.76 }] },
      { id: B, date: "2026-10-21T08:00:01.000Z", pharmacy_name: "Une", pharmacy_cip: "1", source: "catalogue", items: [per(2, { separeDe: String(A) })] });
    const page2 = await X.lignesEcarts({ depuis: "2026-10-21", page: 1, offset: 1, types: ["peremption"] });
    eq("commande visée par separeDe sur la page précédente : relue (avant : 5,52 € à tort)", [page2.cmds, page2.sortie.length, page2.non_retrouvees.length], [1, 0, 0]);
  }
}
{
  // suivi non installé (sql/peremption-ecarts.sql pas exécuté) : écarts lisibles, statut refusé (503), résumé sans erreur
  const w = monde({ suiviEcarts: false });
  w.O.ajouterVente({ pid: P.HEC.id, qte: 2, ref: "1792800000000", pu: 10.32, remise: 5.43, commande: "S400009" });
  w.S.table("elixir_orders").push({ id: 1792800000000, date: "2026-10-22T10:00:00Z", pharmacy_name: "Pharmacie", source: "catalogue",
    items: [{ cip: P.HEC.cip, name: "HEC", qty: 2, pn: 5.16, total: 10.32, peremption: "2026-12-31", remise: 50, facture_odoo: false }] });
  const e = await w.X.ecarts({ depuis: "2026-10-21" });
  eq("suivi absent : écart lisible, « à rectifier », suivi non installé", [e.lignes.length, e.lignes[0].statut, e.suivi], [1, "a_rectifier", "non_installe"]);
  eq("suivi absent : statut refusé, message de mise en service", [(await w.X.changerStatutEcarts({ lignes: e.lignes, statut: "rectifie" })).erreur, (await w.X.ecartsResume({ depuis: "2026-10-21" })).suivi], ["non_installe", "non_installe"]);
  vrai("sql/peremption-ecarts.sql : RLS activé, aucune policy, revoke anon, rejouable", (() => { const t = lire("sql/peremption-ecarts.sql"); return /enable row level security/.test(t) && !/create policy/i.test(t) && /revoke all on table peremption_ecarts from anon, authenticated/.test(t) && /create table if not exists peremption_ecarts/.test(t); })());
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
