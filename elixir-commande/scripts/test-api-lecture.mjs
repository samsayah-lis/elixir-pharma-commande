// Tests de l'API des pharmacies, phase 2 « lecture » : node scripts/test-api-lecture.mjs
// Hors ligne : faux PostgREST (scripts/api-faux.mjs : tables api_*, odoo_catalog, elixir_orders, elixir_pharmacies, kv_store),
// faux Odoo (scripts/api-odoo-faux.mjs : listes de prix facturées au MINIMUM des règles applicables, rapport de liste de prix
// au format d'Odoo 17, stock libre, contingents ; commandes, factures et bons de livraison du faux Odoo de l'Assistant),
// fetch global intercepté (toute adresse inconnue lève). Données FICTIVES : CIP 3400000000011…, « PRODUIT EXEMPLE … ».
//  1. prix : lecture du rapport (montants français, plusieurs quantités, comparée à lireRapport de la péremption), paliers ;
//  2. calcul d'une liste (MIN des règles, catégorie parente, règle expirée ou future, formule, liste de base, prix de base nul,
//     liste introuvable, appels comptés) ; fonction d'arrière-plan (secret, prise, reprise, purge, erreur, temps dépassé) ;
//  3. passage planifié (listes des fiches relues, une liste par passage, priorités, nuit) ;
//  4. routes : catalogue (prix de LA liste de la fiche, paliers, niveaux, contingentés, ETag/304, pages, liste changée,
//     aperçu), produit, disponibilités (direct, cache, jamais de quantité), contingents (valeurs, dispense, cache) ;
//  5. commandes (états du site, du relais, d'Odoo ; quantités servies ; API et test ; périmètre), factures et avoirs,
//     bons de livraison (listes et PDF), domaines imposés à chaque lecture Odoo (société 2 + fiche) ;
//  6. limites : débit par classe, charge d'Odoo par fiche et globale, coupure à 8,5 s, Odoo injoignable ;
//  7. contingentement : même résultat que quota-status.js sur les mêmes données (heure réelle) ;
//  8. admin : état des listes, « Recalculer » ; fichiers (SQL, planification, zones).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
process.env.CRON_SECRET = "secret-cron-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.ODOO_APIKEY = "cle-odoo-test";
process.env.ADMIN_EMAIL = "admin@elixir.test";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const { fauxPostgrestApi } = await import("./api-faux.mjs");
const { creerOdooApi, montantOdoo } = await import("./api-odoo-faux.mjs");
const { jeuOdoo, COMPTES, COMMANDES_SITE, TACHES, controlerAppels, INJECTION } = await import("./test-chat-perimetre.mjs");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

let T = Date.parse("2026-10-20T10:00:00Z");
const maintenant = () => new Date(T);
const avancer = (s) => { T += s * 1000; };
const silence = () => {};

// ═══ Données fictives ═══
const db = fauxPostgrestApi({ horloge: () => T });
const { creerStockApi } = await import("../netlify/functions/_api-stock.js");
const stock = creerStockApi({ fetch: db.fetch, maintenant });

const donnees = jeuOdoo();
for (const so of donnees["sale.order"]) so.create_date = so.date_order;
const fiche = (id) => donnees["res.partner"].find(p => p.id === id);
Object.assign(fiche(100), { property_product_pricelist: [15, "Liste 15"], deny_quota: false });
Object.assign(fiche(200), { property_product_pricelist: [5, "Liste 5"], deny_quota: false });
Object.assign(fiche(700), { property_product_pricelist: [77, "Liste 77"], deny_quota: true });
const PRODUITS = [
  // [pid, cip, code-barres, nom, prix de base, modèle, catégorie, stock libre, en stock (catalogue), disponible (catalogue)]
  [4001, "3400000000011", "3400000000011", "PRODUIT EXEMPLE A 30 CPR", 10, 5001, 31, 50, true, 50],
  [4002, "3400000000028", "3400000000028", "PRODUIT EXEMPLE B", 6, 5002, 32, 4, true, 4],
  [4003, "3400000000035", "3400000000035", "PRODUIT EXEMPLE C", 2.4, 5003, 31, 0, false, 0],
  [4004, "3400000000042", "3400000000042", "PRODUIT EXEMPLE D", 0, 5004, 33, 20, true, 20],
  [4005, "3400000000059", "3400000000059", "PRODUIT EXEMPLE E", 600, 5005, 31, 12, true, 12],
  [4006, "3400000000066", "3400000000073", "PRODUIT EXEMPLE F", 8, 5006, 32, 30, true, null],
  [4007, "3400000000080", "3400000000080", "PRODUIT EXEMPLE G", 1500, 5007, 33, 9, true, 9],
];
donnees["product.product"].push(...PRODUITS.map(([id, cip, barre, name, lp, tmpl, categ, libre]) => ({ id, default_code: cip, barcode: barre, name, list_price: lp,
  product_tmpl_id: [tmpl, name], categ_id: [categ, `Catégorie ${categ}`], free_qty: libre, company_id: false })));
for (const p of donnees["product.product"]) p.free_qty ??= 40;
donnees["product.category"] = [{ id: 30, parent_id: false }, { id: 31, parent_id: [30, "C30"] }, { id: 32, parent_id: false }, { id: 33, parent_id: false }];
donnees["product.pricelist"] = [{ id: 5 }, { id: 15 }, { id: 77 }];
let nr = 1;
const regle = (liste, applied_on, cible, compute, valeurs, extra = {}) => ({ id: nr++, pricelist_id: [liste, `Liste ${liste}`], applied_on, compute_price: compute, base: "list_price",
  product_id: false, product_tmpl_id: false, categ_id: false, min_quantity: 0, fixed_price: 0, percent_price: 0, price_discount: 0, price_surcharge: 0,
  date_start: false, date_end: false, base_pricelist_id: false, ...cible, ...valeurs, ...extra });
donnees["product.pricelist.item"] = [
  // liste 15 : barème global −2 %, règle produit PLUS CHÈRE (ignorée : Odoo facture le minimum), catégorie parente −5 %,
  // formule sur une variante, paliers (modèle à 12 et 24, catégorie à 50), règle expirée et règle future
  regle(15, "3_global", {}, "percentage", { percent_price: 2 }),
  regle(15, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.9 }),
  regle(15, "2_product_category", { categ_id: [30, "C30"] }, "percentage", { percent_price: 5 }),
  regle(15, "0_product_variant", { product_id: [4002, "B"] }, "formula", { price_discount: 10, price_surcharge: -0.05 }),
  regle(15, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.2, min_quantity: 12 }),
  regle(15, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.3, min_quantity: 24 }),
  regle(15, "2_product_category", { categ_id: [31, "C31"] }, "percentage", { percent_price: 20, min_quantity: 50 }),
  regle(15, "0_product_variant", { product_id: [4001, "A"] }, "fixed", { fixed_price: 1 }, { date_end: "2026-01-01 00:00:00" }),
  regle(15, "0_product_variant", { product_id: [4006, "F"] }, "fixed", { fixed_price: 7 }, { date_start: "2026-12-01 00:00:00" }),
  // liste 5 : barème global −4,5 %, règle produit plus chère (ignorée), palier d'une variante à 6
  regle(5, "3_global", {}, "percentage", { percent_price: 4.5 }),
  regle(5, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.7 }),
  regle(5, "0_product_variant", { product_id: [4002, "B"] }, "fixed", { fixed_price: 5.5, min_quantity: 6 }),
  // liste 77 : formule sur la liste 5 (−2 %) : ses paliers viennent de la liste 5
  regle(77, "3_global", {}, "formula", { price_discount: 2 }, { base: "pricelist", base_pricelist_id: [5, "Liste 5"] }),
];
// contingents : DOLIPRANE du jeu de l'Assistant (12 par mois) et PRODUIT EXEMPLE E (6 par semaine)
donnees["product.template"] = [
  { id: 9011, default_code: "3400930000011", barcode: "3400930000011", name: "DOLIPRANE 1000 mg cp B/8", quota: 12, quota_period: "-4", quota_slippery_days: 0, product_variant_id: [11, "D"], active: true },
  { id: 5005, default_code: "3400000000059", barcode: "3400000000059", name: "PRODUIT EXEMPLE E", quota: 6, quota_period: "-1", quota_slippery_days: 0, product_variant_id: [4005, "E"], active: true },
];
donnees["ir.property"] = [
  { id: 1, name: "quota", company_id: [2, "Elixir"], value_integer: 12, res_id: "product.template,9011" },
  { id: 2, name: "quota", company_id: [2, "Elixir"], value_integer: 6, res_id: "product.template,5005" },
];
const faux = creerOdooApi(donnees, { jour: () => new Date(T).toISOString().slice(0, 10) });
// le faux Odoo travaille sur une COPIE des données : les fiches se modifient dans ses tables
const ficheOdoo = (id) => faux.tables["res.partner"].find(p => p.id === id);

db.tables.odoo_catalog.push(...PRODUITS.map(([pid, cip, barre, name, lp, tmpl, categ, , enStock, dispo]) => ({ cip, barcode: barre, name, list_price: lp, odoo_pid: pid,
  odoo_tmpl_id: tmpl, categ_id: categ, in_stock: enStock, available: dispo, updated_at: "2026-10-20T06:00:00.000Z", lots: "[]", discounted_price: 1.11 })));
db.tables.elixir_pharmacies.push(...COMPTES.map(c => ({ ...c })));
db.tables.elixir_orders.push(...COMMANDES_SITE.map(o => ({ ...o, items: JSON.stringify(o.items), csv: "ligne;csv;interne" })));
db.tables.kv_store.push(...TACHES.map(t => ({ ...t })));

// ── fetch global : Odoo (_quota.js, quota-status.js), Supabase (quota-status.js, avec la clé anon → même fausse base), Auth ──
const JETONS = { "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } } };
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === "https://odoo.test/jsonrpc") {
    if (faux.etat.panne) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(await faux.jsonrpc(opts.body)), { status: 200 });
  }
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? new Response(JSON.stringify(JETONS[t])) : new Response(JSON.stringify({ msg: "jeton invalide" }), { status: 401 });
  }
  if (url.startsWith("https://supabase.test/rest/v1/")) {
    const h = { ...(opts.headers || {}), apikey: "cle-service-test", Authorization: "Bearer cle-service-test" };
    return db.fetch(url, { ...opts, headers: h });
  }
  throw new Error(`appel réseau inattendu : ${url}`);
};

const prixMod = await import("../netlify/functions/_api-prix.js");
const { lireRapport } = await import("../netlify/functions/_peremption.js");
const { ficheVerifiee } = await import("../netlify/functions/_chat-perimetre.js");
const cles = await import("../netlify/functions/_api-cles.js");
const conf = await import("../netlify/functions/_api-config.js");
const { creerHandler: creerRouteur } = await import("../netlify/functions/api-v1.js");
const { creerHandler: creerFond } = await import("../netlify/functions/api-prix-background.js");
const { creerHandler: creerCron, priorite, heureParis: heureCron } = await import("../netlify/functions/api-cron.js");
const { creerHandler: creerAdmin } = await import("../netlify/functions/api-admin.js");
const { resteContingents } = await import("../netlify/functions/_api-contingent.js");
const { etatDepuisOdoo, etatTest } = await import("../netlify/functions/_api-suivi.js");
const { isoParis } = await import("../netlify/functions/_api-http.js");

// ═══ 1. Prix : lecture du rapport d'Odoo ═══
{
  eq("nombre français", prixMod.nombreRapport("1 417,48"), 1417.48);
  eq("nombre à point", prixMod.nombreRapport("3.51"), 3.51);
  eq("nombre illisible", prixMod.nombreRapport("n/a"), null);
  eq("montant du faux Odoo (espace fine)", montantOdoo(1417.48), "1 417,48");
  const html = await faux.odoo("report.product.report_pricelist", "get_html", [{ active_model: "product.product", active_ids: [4001, 4007, 999], pricelist_id: 15, quantities: [1, 12, 50] }]);
  const lu = prixMod.lireRapportQuantites(html, 3);
  eq("rapport : trois quantités, dans l'ordre", lu.get(4001), [9.5, 9.2, 8]);
  eq("rapport : milliers (« 1 470,00 »)", lu.get(4007), [1470, 1470, 1470]);
  eq("rapport : produit absent du rapport", lu.has(999), false);
  eq("rapport : nombre de montants différent → ligne écartée", prixMod.lireRapportQuantites(html, 2).size, 0);
  // une quantité : même lecture que le contrôle des écarts de la péremption (lireRapport)
  const h1 = await faux.odoo("report.product.report_pricelist", "get_html", [{ active_model: "product.product", active_ids: PRODUITS.map(p => p[0]), pricelist_id: 5, quantities: [1] }]);
  const ref = lireRapport(h1), moi = prixMod.lireRapportQuantites(h1, 1);
  eq("une quantité : identique à lireRapport (_peremption.js)", PRODUITS.map(p => moi.get(p[0])?.[0] ?? null), PRODUITS.map(p => ref[p[0]] ?? null));
  const exemple = readFileSync(join(APP, "scripts/banc/peremption-rapport-exemple.html"), "utf8");
  eq("exemple d'Odoo (banc de la péremption) : même lecture", [...prixMod.lireRapportQuantites(exemple, 1)].map(([k, v]) => [String(k), v[0]]).sort(),
    Object.entries(lireRapport(exemple)).sort());
  // paliers
  eq("paliers : strictement décroissants", prixMod.prixEtPaliers([9.5, 9.2, 9.2, 8], [1, 12, 24, 50]), { prix_ht: 9.5, paliers: [{ a_partir_de: 12, prix_ht: 9.2 }, { a_partir_de: 50, prix_ht: 8 }] });
  eq("paliers : plus cher ignoré", prixMod.prixEtPaliers([5, 5.5], [1, 6]), { prix_ht: 5, paliers: [] });
  eq("prix nul : aucun prix", prixMod.prixEtPaliers([0, 0], [1, 6]), { prix_ht: null, paliers: [] });
}

// ═══ 2. Calcul d'une liste (MIN des règles) et fonction d'arrière-plan ═══
const ATTENDU = {
  15: { "3400000000011": [9.5, [[12, 9.2], [50, 8]]], "3400000000028": [5.35, []], "3400000000035": [2.28, [[50, 1.92]]], "3400000000042": [null, []],
    "3400000000059": [570, [[50, 480]]], "3400000000066": [7.84, []], "3400000000080": [1470, []] },
  5: { "3400000000011": [9.55, []], "3400000000028": [5.73, [[6, 5.5]]], "3400000000035": [2.29, []], "3400000000042": [null, []], "3400000000059": [573, []],
    "3400000000066": [7.64, []], "3400000000080": [1432.5, []] },
  77: { "3400000000011": [9.36, []], "3400000000028": [5.62, [[6, 5.39]]], "3400000000035": [2.24, []], "3400000000042": [null, []], "3400000000059": [561.54, []],
    "3400000000066": [7.49, []], "3400000000080": [1403.85, []] },
};
const forme = (lignes) => Object.fromEntries(lignes.map(l => [l.cip, [l.prix_ht, (l.paliers || []).map(p => [p.a_partir_de, p.prix_ht])]]).sort((a, b) => a[0].localeCompare(b[0])));
{
  const catalogue = await stock.catalogue.pourPrix();
  eq("catalogue pour les prix : tout, trié", catalogue.map(c => c.cip), PRODUITS.map(p => p[1]).sort());
  const lire = prixMod.lecteurOdoo(faux.odoo);
  const depuis = faux.etat.appels.length;
  for (const l of [15, 5, 77]) {
    const r = await prixMod.calculerListe({ listeId: l, catalogue, lire, jour: "2026-10-20" });
    eq(`liste ${l} : prix facturés (MIN des règles) et paliers`, forme(r.lignes), ATTENDU[l]);
    eq(`liste ${l} : produits, sans prix`, [r.produits, r.sans_prix, r.tronque], [7, 1, false]);
    if (l === 15) eq("liste 15 : appels (existence, bases, règles, catégories, 3 rapports)", r.appels, 7);
    if (l === 77) eq("liste 77 : bases relues (77 puis 5), pas de catégorie, 2 rapports", r.appels, 6);
  }
  // contrôle du faux : prix à la quantité, et règle la plus spécifique bien plus chère que le minimum
  eq("faux Odoo : règle produit 9,90 ignorée, catégorie parente −5 %", faux.prix(15, 4001, 1), 9.5);
  let erreur = null;
  try { await prixMod.calculerListe({ listeId: 999, catalogue, lire, jour: "2026-10-20" }); } catch (e) { erreur = e.code; }
  eq("liste introuvable : refus (le rapport d'Odoo prendrait une autre liste)", erreur, "liste_introuvable");
  const ecritures = faux.etat.appels.filter(a => ["create", "write", "unlink"].includes(a.method));
  eq("aucune écriture Odoo", ecritures.length, 0);
  vrai("contexte société 2 et coupure sur chaque lecture", faux.etat.appels.slice(depuis)
    .every(a => JSON.stringify(a.kwargs?.context?.allowed_company_ids) === "[2]" && a.opts?.timeoutMs > 0));
  let refus = null;
  try { lire("product.pricelist.item", "write", [[1], { fixed_price: 0 }]); } catch (e) { refus = e.message; }
  vrai("lecteur Odoo : écriture refusée", /interdite/.test(refus || ""));
}
{
  const evt = (liste, secret = "secret-cron-test") => ({ httpMethod: "POST", headers: secret ? { "x-cron-secret": secret } : {}, body: JSON.stringify({ liste_id: liste }) });
  const fond = creerFond({ stock, odoo: faux.odoo, maintenant, journal: silence });
  eq("arrière-plan : sans secret → 403", (await fond(evt(15, null))).statusCode, 403);
  eq("arrière-plan : mauvais secret → 403", (await fond(evt(15, "faux"))).statusCode, 403);
  eq("arrière-plan : liste illisible → 400", (await fond({ ...evt(15), body: "{oups" })).statusCode, 400);
  db.tables.api_prix.push({ liste_id: 15, cip: "3400000000999", prix_ht: 1, paliers: "[]", calcule_le: "2026-10-01T00:00:00.000Z" });   // produit sorti du catalogue
  for (const l of [15, 5, 77]) eq(`arrière-plan : liste ${l}`, (await fond(evt(l))).statusCode, 200);
  const lignes15 = db.tables.api_prix.filter(r => r.liste_id === 15);
  eq("api_prix : liste 15 écrite (paliers en JSON)", forme(lignes15.map(r => ({ ...r, paliers: JSON.parse(r.paliers) }))), ATTENDU[15]);
  eq("api_prix : produit sorti du catalogue supprimé", lignes15.some(r => r.cip === "3400000000999"), false);
  const e15 = db.tables.api_prix_listes.find(l => l.liste_id === 15);
  eq("api_prix_listes : prête, produits, sans prix, appels", [e15.etat, e15.produits, e15.sans_prix, e15.appels, e15.erreur], ["pret", 7, 1, 7, null]);
  // prise : un calcul en cours n'est pas doublé ; un calcul coupé (20 min) est repris
  Object.assign(e15, { etat: "en_cours", debut_le: new Date(T).toISOString() });
  const n0 = faux.etat.appels.length;
  await fond(evt(15));
  eq("calcul en cours : pas de second calcul", faux.etat.appels.length, n0);
  avancer(21 * 60);
  await fond(evt(15));
  eq("calcul coupé depuis 20 min : repris", e15.etat, "pret");
  // Odoo injoignable : erreur neutre, anciens prix gardés
  faux.etat.panne = true;
  await fond(evt(5));
  const e5 = db.tables.api_prix_listes.find(l => l.liste_id === 5);
  eq("Odoo injoignable : erreur, message neutre", [e5.etat, e5.erreur], ["erreur", "calcul impossible (Odoo ou base injoignable) : nouvel essai au prochain passage"]);
  eq("…anciens prix gardés", db.tables.api_prix.filter(r => r.liste_id === 5).length, 7);
  faux.etat.panne = false;
  await fond(evt(999));
  eq("liste inconnue d'Odoo : erreur explicite", db.tables.api_prix_listes.find(l => l.liste_id === 999)?.erreur, "liste de prix introuvable dans Odoo");
  // temps dépassé : lignes faites gardées, pas de purge, état « erreur »
  let h = 0;
  const lent = creerFond({ stock, odoo: faux.odoo, maintenant, journal: silence, horloge: () => (h += 1000), budgetMs: 1500 });
  db.tables.api_prix.push({ liste_id: 5, cip: "3400000000998", prix_ht: 1, paliers: "[]", calcule_le: "2026-10-01T00:00:00.000Z" });
  await lent(evt(5));
  eq("temps dépassé : erreur « interrompu »", /interrompu/.test(e5.erreur) && e5.etat === "erreur", true);
  eq("…pas de purge (calcul partiel)", db.tables.api_prix.some(r => r.liste_id === 5 && r.cip === "3400000000998"), true);
  await fond(evt(5));
  eq("nouveau calcul complet : prête, purge faite", [e5.etat, db.tables.api_prix.some(r => r.cip === "3400000000998")], ["pret", false]);
  db.tables.api_prix_listes.splice(db.tables.api_prix_listes.findIndex(l => l.liste_id === 999), 1);
}

// ═══ 3. Admin : ouverture des accès (listes demandées au calcul), état des listes, « Recalculer » ═══
const lances = [];
const admin = creerAdmin({ stock, maintenant, journal: silence, verifierAdmin: async () => ({ admin: { email: "admin@elixir.test" } }),
  verifierFiche: (id) => ficheVerifiee(id, { odoo: faux.odoo }), listePrix: async (id) => ({ 100: 15, 200: 5, 700: 77, 101: 88 })[id] ?? null,
  lancerPrix: async (base, id) => { lances.push([base, id]); return null; } });
const appelAdmin = (corps, methode = "POST", query = null) => admin({ httpMethod: methode, headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer x" },
  queryStringParameters: query, body: corps ? JSON.stringify(corps) : undefined });
{
  for (const id of [100, 200, 700]) eq(`admin : accès ouvert (${id})`, (await appelAdmin({ action: "ouvrir_acces", odoo_id: id })).statusCode, 200);
  eq("ouverture : listes déjà calculées non redemandées", db.tables.api_prix_listes.map(l => [l.liste_id, l.etat]), [[15, "pret"], [5, "pret"], [77, "pret"]]);
  const t = JSON.parse((await appelAdmin(null, "GET", { vue: "tableau" })).body);
  eq("tableau : listes, accès actifs, état", t.prix.map(l => [l.liste_id, l.acces_actifs, l.etat, l.produits]), [[5, 1, "pret", 7], [15, 1, "pret", 7], [77, 1, "pret", 7]]);
  eq("tableau : nom connu de la liste", t.prix.find(l => l.liste_id === 15).nom, "Expepharma (n° 15)");
  vrai("tableau : aucun prix", !/prix_ht|9\.5|573/.test(JSON.stringify(t.prix)));
  let r = await appelAdmin({ action: "prix_recalculer", liste_id: 5 });
  eq("Recalculer : demandé et lancé", [r.statusCode, JSON.parse(r.body).lancement, db.tables.api_prix_listes.find(l => l.liste_id === 5).etat, lances.at(-1)],
    [200, null, "a_calculer", ["https://elixir-commande.expepharma.com", 5]]);
  db.tables.api_prix_listes.find(l => l.liste_id === 5).etat = "en_cours";
  r = await appelAdmin({ action: "prix_recalculer", liste_id: 5 });
  eq("Recalculer pendant un calcul : 409", r.statusCode, 409);
  eq("Recalculer : liste manquante → 400", (await appelAdmin({ action: "prix_recalculer" })).statusCode, 400);
  db.tables.api_prix_listes.find(l => l.liste_id === 5).etat = "pret";
  eq("événement tracé", db.tables.api_evenements.some(e => e.type === "prix_recalcul_demande"), true);
}

// ═══ 4. Passage planifié ═══
{
  const now = new Date("2026-10-20T12:00:00Z");
  eq("heure de Paris (été, hiver)", [heureCron(new Date("2026-10-21T00:30:00Z")), heureCron(new Date("2026-12-01T00:30:00Z"))], [2, 1]);
  eq("priorité : jamais vue", priorite(undefined, now, { nuit: false }), 0);
  eq("priorité : demandée", priorite({ etat: "a_calculer" }, now, { nuit: false }), 1);
  eq("priorité : en cours récent", priorite({ etat: "en_cours", debut_le: "2026-10-20T11:50:00Z" }, now, { nuit: true }), null);
  eq("priorité : en cours coupé", priorite({ etat: "en_cours", debut_le: "2026-10-20T11:30:00Z" }, now, { nuit: false }), 2);
  eq("priorité : erreur récente", priorite({ etat: "erreur", fin_le: "2026-10-20T11:30:00Z" }, now, { nuit: true }), null);
  eq("priorité : erreur d'il y a plus d'1 h", priorite({ etat: "erreur", fin_le: "2026-10-20T10:30:00Z" }, now, { nuit: false }), 3);
  eq("priorité : à jour, ancienne, de jour", priorite({ etat: "pret", fin_le: "2026-10-19T10:00:00Z" }, now, { nuit: false }), null);
  eq("priorité : à jour, ancienne, la nuit", priorite({ etat: "pret", fin_le: "2026-10-19T10:00:00Z" }, now, { nuit: true }), 4);
  const lancees = [];
  const cron = (quand) => creerCron({ stock, odoo: faux.odoo, maintenant: () => new Date(quand), journal: silence, lancer: async (id) => { lancees.push(id); return null; } })();
  // listes des fiches relues une fois par jour
  db.tables.api_acces.find(a => a.odoo_id === 100).liste_prix_lue_le = "2026-10-18T00:00:00.000Z";
  ficheOdoo(100).property_product_pricelist = [5, "Liste 5"];
  await cron("2026-10-20T13:00:00Z");
  eq("cron : liste relue et changée", db.tables.api_acces.find(a => a.odoo_id === 100).liste_prix_id, 5);
  eq("cron : de jour, listes à jour : rien lancé", lancees, []);
  ficheOdoo(100).property_product_pricelist = [15, "Liste 15"];
  await stock.acces.modifier(100, { liste_prix_id: 15, liste_prix_lue_le: "2026-10-20T13:00:00.000Z" });
  db.tables.api_prix_listes.find(l => l.liste_id === 77).etat = "a_calculer";
  await cron("2026-10-20T13:15:00Z");
  eq("cron : liste demandée lancée de jour", lancees, [77]);
  db.tables.api_prix_listes.find(l => l.liste_id === 77).etat = "pret";
  for (const l of db.tables.api_prix_listes) l.fin_le = l.liste_id === 5 ? "2026-10-20T00:30:00.000Z" : "2026-10-20T00:10:00.000Z";
  lancees.length = 0;
  await cron("2026-10-21T00:30:00Z");   // 2 h 30 à Paris
  eq("cron : la nuit, une seule liste (la plus ancienne)", lancees, [15]);
  const nAcces = db.appels.filter(a => a.table === "api_acces" && a.methode === "PATCH").length;
  await creerCron({ stock, odoo: faux.odoo, maintenant: () => new Date("2026-10-21T00:45:00Z"), journal: silence, lancer: async () => null })();
  eq("cron : listes lues il y a moins d'un jour : pas relues", db.appels.filter(a => a.table === "api_acces" && a.methode === "PATCH").length, nAcces);
  // remise en état
  for (const l of db.tables.api_prix_listes) l.fin_le = new Date(T).toISOString();
}

// ═══ 5. Routes de lecture ═══
// clés : A (fiche 100, liste 15) test et production ; B (fiche 200, liste 5) production ; G (fiche 700, dispensée) ;
// A sans droit de lecture
for (const id of [100, 200, 700]) await stock.acces.modifier(id, { cgu_version: conf.CGU.version, test_valide_le: "2026-10-01T00:00:00.000Z" });
const accesDe = async (id) => stock.acces.lire(id);
const cle = async (id, env, portees = ["lecture", "commande"]) => (await cles.creerCle(stock, { acces: await accesDe(id), environnement: env, libelle: `Outil ${id} ${env}`, portees,
  par: `compte@fiche-${id}.test`, role: "pharmacie", maintenant: maintenant() })).secret;
const K = { aTest: await cle(100, "test"), aLive: await cle(100, "live"), bLive: await cle(200, "live"), gLive: await cle(700, "live"), aCommande: await cle(100, "live", ["commande"]) };
const nouveauRouteur = (extra = {}) => creerRouteur({ stock, maintenant, verifierFiche: (id) => ficheVerifiee(id, { odoo: faux.odoo }), odoo: faux.odoo, log: silence, hasard: () => 0.5, ...extra });
let ip = 1;
const requete = (h, chemin, { cle: k = K.aLive, host = "elixir-commande.expepharma.com", entetes = {}, query = null } = {}) => {
  const [p, qs] = chemin.split("?");
  return h({ httpMethod: "GET", path: `/api/v1${p}`, headers: { host, "x-nf-client-connection-ip": `198.51.${ip}.10`, ...(k ? { authorization: `Bearer ${k}` } : {}), ...entetes },
    queryStringParameters: query || (qs ? Object.fromEntries(new URLSearchParams(qs)) : null) });
};
const corps = (r) => JSON.parse(r.body);
const debutMinute = () => avancer(60 - (Math.floor(T / 1000) % 60));
const textes = [];   // corps JSON des réponses de lecture : contrôlés à la fin (rien d'interne ne sort)
const garder = (r) => { if (r.body && !r.isBase64Encoded) textes.push(r.body); return r; };

let h = nouveauRouteur();
{
  // ── catalogue ──
  let r = garder(await requete(h, "/catalogue?page=1&par_page=3"));
  eq("catalogue : 200", r.statusCode, 200);
  let c = corps(r);
  eq("catalogue : page de 3, total, suivante", [c.donnees.length, c.total, c.page, c.par_page, c.suivante], [3, 7, 1, 3, "/api/v1/catalogue?page=2&par_page=3"]);
  eq("catalogue : prix de LA liste de la fiche (15), paliers", c.donnees.map(p => [p.cip, p.prix_ht, p.paliers]), [
    ["3400000000011", 9.5, [{ a_partir_de: 12, prix_ht: 9.2 }, { a_partir_de: 50, prix_ht: 8 }]], ["3400000000028", 5.35, []], ["3400000000035", 2.28, [{ a_partir_de: 50, prix_ht: 1.92 }]]]);
  eq("catalogue : niveaux de disponibilité", c.donnees.map(p => p.disponibilite), ["en_stock", "stock_faible", "rupture"]);
  eq("catalogue : contingentés", c.donnees.map(p => p.contingente), [false, false, false]);
  eq("catalogue : prix à jour, base « liste_pharmacie »", [c.prix.base, c.prix.etat, c.prix.calcule_le != null], ["liste_pharmacie", "a_jour", true]);
  vrai("catalogue : mention « hors offres du site »", /^Prix HT de votre liste, hors offres du site/.test(c.mention));
  vrai("catalogue : jamais de quantité de stock, ni prix du site, ni lots", !/available|discounted|lots|free_qty|1\.11/.test(r.body));
  vrai("catalogue : jamais le numéro ni le nom de la liste", !/liste_id|Liste 15|"15"/.test(r.body));
  const etag = r.headers.ETag;
  vrai("catalogue : ETag faible", /^W\/"[A-Za-z0-9_-]{27}"$/.test(etag));
  eq("catalogue : cache privé à revalider", r.headers["Cache-Control"], "private, no-cache");
  r = await requete(h, "/catalogue?page=1&par_page=3", { entetes: { "if-none-match": etag } });
  eq("catalogue : If-None-Match → 304 sans corps", [r.statusCode, r.body, r.headers.ETag, !!r.headers["X-Request-Id"]], [304, "", etag, true]);
  eq("journal : 304 noté", db.tables.api_journal.at(-1).statut, 304);
  r = garder(await requete(h, "/catalogue?page=3&par_page=3"));
  c = corps(r);
  eq("catalogue : dernière page", [c.donnees.map(p => p.cip), c.suivante], [["3400000000080"], null]);
  eq("catalogue : milliers et produit lourd", c.donnees[0].prix_ht, 1470);
  r = garder(await requete(h, "/catalogue?page=2&par_page=3"));
  c = corps(r);
  eq("catalogue : prix de base nul → pas de prix", c.donnees.find(p => p.cip === "3400000000042").prix_ht, null);
  eq("catalogue : contingenté (E)", c.donnees.find(p => p.cip === "3400000000059").contingente, true);
  eq("catalogue : en stock sans quantité connue → en_stock", c.donnees.find(p => p.cip === "3400000000066").disponibilite, "en_stock");
  // autre pharmacie : SA liste (5)
  r = garder(await requete(h, "/catalogue?par_page=2", { cle: K.bLive }));
  eq("catalogue (B) : prix de la liste 5", corps(r).donnees.map(p => [p.prix_ht, p.paliers]), [[9.55, []], [5.73, [{ a_partir_de: 6, prix_ht: 5.5 }]]]);
  eq("catalogue (B) : autre ETag", r.headers.ETag !== etag, true);
  // paramètres
  for (const q of ["page=0", "par_page=501", "page=abc", "par_page=2.5"]) {
    r = await requete(h, `/catalogue?${q}`);
    eq(`catalogue : ${q} → 422`, [r.statusCode, corps(r).code, corps(r).erreurs?.length > 0], [422, "requete_invalide", true]);
  }
  // un produit
  r = garder(await requete(h, "/catalogue/3400000000011"));
  c = corps(r);
  eq("produit : prix, paliers, niveau, contingenté", [c.cip, c.nom, c.prix_ht, c.paliers.length, c.disponibilite, c.contingente, c.prix.etat], ["3400000000011", "PRODUIT EXEMPLE A 30 CPR", 9.5, 2, "en_stock", false, "a_jour"]);
  r = garder(await requete(h, "/catalogue/3400000000073"));
  eq("produit : par son code-barres", corps(r).cip, "3400000000066");
  r = await requete(h, "/catalogue/3400000009999");
  eq("produit inconnu : 404", [r.statusCode, corps(r).code], [404, "introuvable"]);
  r = await requete(h, "/catalogue/34000");
  eq("produit : CIP invalide → 422", [r.statusCode, corps(r).erreurs[0].champ], [422, "cip"]);
  eq("journal : gabarit, jamais le CIP", db.tables.api_journal.at(-1).route, "/v1/catalogue/{cip}");
}
{
  // liste pas encore calculée (fiche G : liste 77 vidée), puis liste changée dans Odoo
  db.tables.api_prix = db.tables.api_prix.filter(r => r.liste_id !== 77);
  db.tables.api_prix_listes = db.tables.api_prix_listes.filter(l => l.liste_id !== 77);
  let r = garder(await requete(h, "/catalogue?par_page=2", { cle: K.gLive }));
  let c = corps(r);
  eq("liste jamais calculée : prix absents, « en_calcul »", [c.donnees.map(p => p.prix_ht), c.prix.etat], [[null, null], "en_calcul"]);
  vrai("…avertissement", c.avertissements.some(a => /en cours de calcul/.test(a)));
  eq("…liste demandée au calcul", db.tables.api_prix_listes.find(l => l.liste_id === 77)?.etat, "a_calculer");
  await creerFond({ stock, odoo: faux.odoo, maintenant, journal: silence })({ headers: { "x-cron-secret": "secret-cron-test" }, body: JSON.stringify({ liste_id: 77 }) });
  r = garder(await requete(h, "/catalogue?par_page=2", { cle: K.gLive }));
  eq("liste calculée : prix de la liste 77 (paliers venus de la liste 5)", corps(r).donnees.map(p => [p.prix_ht, p.paliers]), [[9.36, []], [5.62, [{ a_partir_de: 6, prix_ht: 5.39 }]]]);
  // liste de A changée dans Odoo : vue au plus 10 min après ; aperçu : rien n'est écrit
  ficheOdoo(100).property_product_pricelist = [5, "Liste 5"];
  r = await requete(h, "/catalogue?par_page=1");
  eq("liste changée : encore l'ancienne (cache de 10 min)", corps(r).donnees[0].prix_ht, 9.5);
  avancer(601);
  const hApercu = nouveauRouteur();
  r = await requete(hApercu, "/catalogue?par_page=1", { host: "deploy-preview-7--commandes-elixir.netlify.app" });
  eq("aperçu : nouvelle liste lue, rien d'écrit", [corps(r).donnees[0].prix_ht, (await accesDe(100)).liste_prix_id], [9.55, 15]);
  r = await requete(h, "/catalogue?par_page=1");
  eq("liste changée : nouveaux prix, accès mis à jour", [corps(r).donnees[0].prix_ht, (await accesDe(100)).liste_prix_id], [9.55, 5]);
  ficheOdoo(100).property_product_pricelist = [15, "Liste 15"];
  await stock.acces.modifier(100, { liste_prix_id: 15 });
  h = nouveauRouteur();
  // prix anciens (plus de 48 h)
  for (const p of db.tables.api_prix.filter(x => x.liste_id === 15)) p.calcule_le = new Date(T - 49 * 3600e3).toISOString();
  r = await requete(h, "/catalogue?par_page=1");
  eq("prix de plus de 48 h : « ancien » + avertissement", [corps(r).prix.etat, corps(r).avertissements.some(a => /48 heures/.test(a))], ["ancien", true]);
  for (const p of db.tables.api_prix.filter(x => x.liste_id === 15)) p.calcule_le = new Date(T).toISOString();
}
{
  // ── disponibilités : stock libre lu en direct, niveaux seulement ──
  debutMinute();
  const lectures = () => faux.etat.appels.filter(a => a.model === "product.product" && a.kwargs?.fields?.includes("free_qty")).length;
  const n0 = lectures();
  let r = garder(await requete(h, "/disponibilites?cips=3400000000011,3400000000028,3400000000035,3400000000073,3400000009999"));
  eq("disponibilités : niveaux (code-barres compris), inconnu", corps(r).donnees, [
    { cip: "3400000000011", disponibilite: "en_stock" }, { cip: "3400000000028", disponibilite: "stock_faible" }, { cip: "3400000000035", disponibilite: "rupture" },
    { cip: "3400000000073", disponibilite: "en_stock" }, { cip: "3400000009999", disponibilite: null, inconnu: true }]);
  eq("disponibilités : une lecture Odoo pour tous", lectures(), n0 + 1);
  vrai("disponibilités : mention, heure de lecture", /indicative/.test(corps(r).mention) && /\+0[12]:00$/.test(corps(r).lu_le));
  vrai("disponibilités : jamais de quantité", !/"(free_qty|quantite|stock)"\s*:/.test(r.body) && !/\b50\b|\b30\b/.test(r.body));
  const derniere = faux.etat.appels.filter(a => a.model === "product.product").at(-1);
  vrai("disponibilités : domaine société 2, contexte, coupure", JSON.stringify(derniere.args[0]).includes('["company_id","in",[2,false]]')
    && JSON.stringify(derniere.kwargs.context.allowed_company_ids) === "[2]" && derniere.opts.timeoutMs === 6000);
  r = await requete(h, "/disponibilites?cips=3400000000011,3400000000028");
  eq("disponibilités : cache de 60 s", lectures(), n0 + 1);
  avancer(61);
  await requete(h, "/disponibilites?cips=3400000000011");
  eq("disponibilités : relues après 60 s", lectures(), n0 + 2);
  eq("disponibilités : classe de débit à part", db.tables.api_journal.at(-1).route, "/v1/disponibilites");
  vrai("disponibilités : compteur de classe", db.tables.api_compteurs.some(c => /:disponibilites:60$/.test(c.cle)));
  for (const [q, msg] of [["", "cips"], ["cips=123", "invalide"], [`cips=${Array.from({ length: 201 }, (_, i) => String(3400000000000 + i)).join(",")}`, "200 au plus"]]) {
    r = await requete(h, `/disponibilites${q ? `?${q}` : ""}`);
    eq(`disponibilités : refus (${msg})`, [r.statusCode, corps(r).code], [422, "requete_invalide"]);
  }
  r = await requete(h, "/disponibilites", { query: null, entetes: {} });
  eq("disponibilités : sans paramètre → 422", r.statusCode, 422);
}
{
  // ── contingents : même calcul que le panier ──
  let r = garder(await requete(h, "/contingents"));
  eq("contingents (A) : 200", r.statusCode, 200);
  eq("contingents (A) : valeurs", corps(r), { exempte: false, jour: "2026-10-20", donnees: [
    { cip: "3400000000059", nom: "PRODUIT EXEMPLE E", quota: 6, periode: "semaine", jours_glissants: null, libelle: "6 par semaine", debut: "2026-10-19", fin: "2026-10-25", deja_commande: 0, reste: 6 },
    { cip: "3400930000011", nom: "DOLIPRANE 1000 mg cp B/8", quota: 12, periode: "mois", jours_glissants: null, libelle: "12 par mois", debut: "2026-10-01", fin: "2026-10-31", deja_commande: 10, reste: 2 }] });
  const n = faux.etat.appels.length;
  await requete(h, "/contingents");
  eq("contingents : cache de 60 s par fiche", faux.etat.appels.length, n);
  r = garder(await requete(h, "/contingents", { cle: K.gLive }));
  eq("contingents (G, dispensée) : exempte", [corps(r).exempte, corps(r).donnees], [true, []]);
  r = garder(await requete(h, "/contingents", { cle: K.bLive }));
  eq("contingents (B) : ses commandes seulement (1 dans Odoo, 9 sur le site)", corps(r).donnees.map(d => [d.cip, d.deja_commande, d.reste]), [["3400000000059", 0, 6], ["3400930000011", 10, 2]]);
}

// ═══ 6. Commandes, factures, bons de livraison ═══
{
  faux.appelsChat.length = 0;
  let r = garder(await requete(h, "/commandes"));
  eq("commandes : 200", r.statusCode, 200);
  let c = corps(r);
  eq("commandes : période par défaut (30 jours)", c.periode, { debut: "2026-09-21", fin: "2026-10-20" });
  eq("commandes (A) : du site, les plus récentes d'abord, états", c.donnees.map(x => [x.id, x.canal, x.etat, x.motif, x.lignes]), [
    ["1792400000000", "site", "en_transmission", null, 1], ["1792600000000", "site", "en_attente_elixir", "verification", 1], ["1792300000000", "site", "en_attente_elixir", "verification", 1]]);
  eq("commandes : date de création (Paris)", c.donnees[0].cree_le, "2026-10-19T10:00:00+02:00");
  r = garder(await requete(h, "/commandes?debut=2026-09-01&fin=2026-10-20"));
  c = corps(r);
  const s = c.donnees.find(x => x.id === "1791915880329");
  eq("commande passée dans notre système : facturée, numéro de commande", [s.etat, s.commandes_elixir], ["facturee", ["S300002"]]);
  r = garder(await requete(h, "/commandes?debut=2026-09-01&fin=2026-10-20&par_page=2"));
  eq("commandes : pages", [corps(r).donnees.length, corps(r).suivante], [2, "/api/v1/commandes?debut=2026-09-01&fin=2026-10-20&page=2&par_page=2"]);
  r = garder(await requete(h, "/commandes?debut=2026-09-01&fin=2026-10-20&page=2&par_page=2"));
  eq("commandes : page 2", corps(r).donnees.map(x => x.id), ["1792300000000", "1791915880329"]);
  r = garder(await requete(h, "/commandes", { cle: K.bLive }));
  eq("commandes (B) : les siennes seulement", corps(r).donnees.map(x => x.id), ["1792500000000"]);
  for (const [q, champ] of [["debut=2026-01-01&fin=2026-10-20", "fin"], ["debut=2026-10-20&fin=2026-10-01", "debut"], ["debut=2026-13-01", "debut"], ["par_page=51", "par_page"]]) {
    r = await requete(h, `/commandes?${q}`);
    eq(`commandes : ${q} → 422 (${champ})`, [r.statusCode, corps(r).erreurs?.[0]?.champ], [422, champ]);
  }
  // détail
  r = garder(await requete(h, "/commandes/1791915880329"));
  c = corps(r);
  eq("détail : état, canal, environnement", [c.etat, c.canal, c.environnement, c.annulable_jusqu_a], ["facturee", "site", "live", null]);
  eq("détail : lignes, quantités servies", c.lignes, [{ cip: "3400930000035", nom: "SMECTA 3 g B/30", quantite_demandee: 2,
    suivi: { commandee: 2, acceptee: 2, servie: 2, non_servie: 0, a_livrer: 0, facturee: 2 } }]);
  eq("détail : nos commandes, factures, bons", c.commandes_elixir, [{ numero: "S300002", etat: "facturee", sortie_le: "2026-09-02T21:35:00+02:00", factures: ["INV/2026/40001"], avoirs: [],
    livraisons: [{ id: 5002, numero: "EP/OUT/1002", sortie_le: "2026-09-02T21:35:00+02:00" }] }]);
  r = garder(await requete(h, "/commandes/1792400000000"));
  eq("détail : commande en transmission, sans suivi", [corps(r).etat, corps(r).lignes[0].suivi, corps(r).lignes[0].nom], ["en_transmission", null, "DOLIPRANE 1000 mg cp B/8"]);
  r = garder(await requete(h, "/commandes/1792600000000"));
  eq("détail : commande non rattachée → à vérifier, aucun nom relu", [corps(r).etat, corps(r).motif, corps(r).lignes[0].nom], ["en_attente_elixir", "verification", null]);
  r = await requete(h, "/commandes/1792500000000");
  eq("détail : commande d'une autre pharmacie → 404 (comme inconnue)", [r.statusCode, corps(r).code], [404, "introuvable"]);
  r = await requete(h, "/commandes/1792999999999");
  eq("détail : inconnue → 404", r.statusCode, 404);
  r = await requete(h, "/commandes/S300002");
  eq("détail : numéro mal formé → 404", r.statusCode, 404);
  eq("journal : gabarit, jamais le numéro", db.tables.api_journal.at(-1).route, "/v1/commandes/{id}");
  // lectures Odoo des commandes : société 2 + fiche A (et ses contacts) sur chaque domaine, coupure, aucun champ interdit
  eq("domaines imposés (commandes)", controlerAppels(faux.appelsChat, [100, 101, 200]), []);
}
{
  // commandes passées par l'API (phase commande : ligne api_commandes) et commandes de test
  const finDelai = isoParis(T + 5 * 60e3), finTest = isoParis(T + 10 * 60e3);
  db.tables.api_commandes.push(
    { id: "c1", odoo_id: 100, cle_id: "k", test: false, idempotency_key: "cle-essai-0001", empreinte_requete: "x", reference_client: "REASSORT-A", order_id: "1792400000000",
      etat: "recue", motif: null, envoi_apres: new Date(T + 5 * 60e3).toISOString(), recu_le: "2026-10-19T08:00:00.000Z" },
    { id: "c2", odoo_id: 100, cle_id: "k", test: false, idempotency_key: "cle-essai-0002", empreinte_requete: "x", reference_client: null, order_id: "1792300000000",
      etat: "a_verifier", motif: "anomalie_quantite", envoi_apres: null, recu_le: "2026-10-18T07:00:00.000Z" },
    { id: "c3", odoo_id: 100, cle_id: "k", test: true, idempotency_key: "cle-essai-0003", empreinte_requete: "x", reference_client: "ESSAI-1", order_id: "T1792700000000",
      etat: "recue", motif: null, envoi_apres: new Date(T + 10 * 60e3).toISOString(), recu_le: new Date(T - 60e3).toISOString(),
      reponse: JSON.stringify({ id: "T1792700000000", total_indicatif_ht: 110.4, lignes: [{ cip: "3400000000011", nom: "PRODUIT EXEMPLE A 30 CPR", quantite_demandee: 12, quantite: 12, prix_unitaire_ht: 9.2, etat: "acceptee" }] }) },
    { id: "c4", odoo_id: 200, cle_id: "k", test: true, idempotency_key: "cle-essai-0004", empreinte_requete: "x", order_id: "T1792700000009", etat: "recue",
      envoi_apres: new Date(T).toISOString(), recu_le: new Date(T - 60e3).toISOString(), reponse: "{}" });
  let r = garder(await requete(h, "/commandes"));
  let c = corps(r).donnees;
  // phase 3 : dès qu'une ligne part (ici une tâche du relais « à envoyer » : Elixir l'a synchronisée pendant le délai), l'état
  // du relais l'emporte et la commande n'est plus annulable ; le cas « reçue, annulable » est couvert par test-api-commandes
  eq("commande API dans son délai mais déjà mise en envoi par Elixir : état du relais, plus annulable", [c[0].canal, c[0].etat, c[0].reference_client, c[0].annulable_jusqu_a],
    ["api", "en_transmission", "REASSORT-A", null]);
  vrai("(délai de la commande encore en cours)", Date.parse(finDelai) > T);
  eq("commande API gardée à vérifier", [c[2].canal, c[2].etat, c[2].motif], ["api", "en_attente_elixir", "anomalie_quantite"]);
  vrai("clé de production : pas de commande de test", !c.some(x => x.id.startsWith("T")));
  r = await requete(h, "/commandes/T1792700000000");
  eq("clé de production : commande de test → 404", r.statusCode, 404);
  r = garder(await requete(h, "/commandes", { cle: K.aTest }));
  c = corps(r).donnees;
  eq("clé de test : commandes réelles + ses commandes de test (pas celles d'une autre fiche)", c.map(x => [x.id, x.environnement]),
    [["T1792700000000", "test"], ["1792400000000", "live"], ["1792600000000", "live"], ["1792300000000", "live"]]);
  r = garder(await requete(h, "/commandes/T1792700000000", { cle: K.aTest }));
  c = corps(r);
  eq("test : reçue, annulable, lignes de la réponse rendue", [c.etat, c.annulable_jusqu_a, c.total_indicatif_ht, c.lignes[0].prix_unitaire_ht, c.lignes[0].suivi],
    ["recue", finTest, 110.4, 9.2, null]);
  avancer(10 * 60);
  eq("test : transmise après le délai", corps(await requete(h, "/commandes/T1792700000000", { cle: K.aTest })).etat, "transmise");
  eq("API : délai passé → état du site", corps(await requete(h, "/commandes")).donnees[0].etat, "en_transmission");
  avancer(10 * 60);
  eq("test : sortie de l'entrepôt 10 min plus tard", corps(await requete(h, "/commandes/T1792700000000", { cle: K.aTest })).etat, "sortie_entrepot");
  r = await requete(h, "/commandes/T1792700000009", { cle: K.aTest });
  eq("test : commande de test d'une autre fiche → 404", r.statusCode, 404);
  // états : règles pures
  eq("état Odoo : le moins avancé", etatDepuisOdoo(["facturee", "en_preparation"]), "en_preparation");
  eq("état Odoo : non servie ignorée s'il reste une commande servie", etatDepuisOdoo(["non_servie", "sortie_entrepot"]), "sortie_entrepot");
  eq("état Odoo : tout non servi", etatDepuisOdoo(["non_servie", "annulee"]), "non_servie");
  eq("état Odoo : tout annulé", etatDepuisOdoo(["annulee"]), "annulee");
  eq("état de test annulé", etatTest({ etat: "annulee", recu_le: "2026-10-20T00:00:00Z" }, new Date(T)).etat, "annulee");
  db.tables.api_commandes.length = 0;
}
{
  // ── factures et avoirs ──
  faux.appelsChat.length = 0;
  let r = garder(await requete(h, "/factures"));
  let c = corps(r);
  eq("factures : période par défaut (90 jours)", c.periode, { debut: "2026-07-23", fin: "2026-10-20" });
  eq("factures (A) : société 2, validées, de la fiche, récentes d'abord", c.donnees.map(x => [x.numero, x.type]), [["INV/2026/40010", "facture"], ["RINV/2026/00501", "avoir"],
    ["INV/2026/40003", "facture"], ["INV/2026/40002", "facture"], ["INV/2026/40001", "facture"]]);
  eq("factures : montants, commandes, PDF", c.donnees.at(-1), { id: 1001, type: "facture", numero: "INV/2026/40001", date: "2026-09-03", montant_ht: 150, montant_tva: 12.1,
    montant_ttc: 162.1, commandes_elixir: ["S300001", "S300002"], pdf_disponible: true });
  r = garder(await requete(h, "/factures?type=avoirs"));
  eq("avoirs : origine et motif", corps(r).donnees, [{ id: 1003, type: "avoir", numero: "RINV/2026/00501", date: "2026-09-20", montant_ht: -20, montant_tva: -0.42, montant_ttc: -20.42,
    commandes_elixir: [], pdf_disponible: false, avoir_de: "INV/2026/40001", motif: "Extourne de : INV/2026/40001, Erreur de prix" }]);
  r = garder(await requete(h, "/factures?par_page=2&page=2"));
  eq("factures : pages", [corps(r).donnees.map(x => x.id), corps(r).total, corps(r).suivante], [[1004, 1002], 5, "/api/v1/factures?page=3&par_page=2"]);
  r = await requete(h, "/factures?type=tout");
  eq("factures : type inconnu → 422", corps(r).erreurs[0].champ, "type");
  r = garder(await requete(h, "/factures?debut=2026-01-01&fin=2026-12-31"));
  eq("factures : un an au plus (366 jours)", r.statusCode, 200);
  r = await requete(h, "/factures?debut=2025-01-01&fin=2026-10-20");
  eq("factures : plus d'un an → 422", r.statusCode, 422);
  r = garder(await requete(h, "/factures", { cle: K.bLive }));
  eq("factures (B) : les siennes", corps(r).donnees.map(x => x.numero), ["INV/2026/40050"]);
  // PDF d'origine
  debutMinute();
  r = await requete(h, "/factures/1001/pdf");
  eq("PDF : 200, application/pdf, pièce jointe", [r.statusCode, r.headers["Content-Type"], r.headers["Content-Disposition"], r.isBase64Encoded],
    [200, "application/pdf", 'attachment; filename="Facture_INV_2026_40001.pdf"', true]);
  eq("PDF : contenu d'origine", Buffer.from(r.body, "base64").toString(), "%PDF-1.4 facture 40001");
  eq("PDF : jamais en cache", r.headers["Cache-Control"], "no-store");
  for (const [id, quoi] of [[1003, "avoir sans PDF"], [2001, "autre pharmacie"], [1005, "autre société"], [1006, "brouillon"], ["abc", "illisible"]]) {
    r = await requete(h, `/factures/${id}/pdf`);
    eq(`PDF : ${quoi} → 404`, [r.statusCode, corps(r).code], [404, "introuvable"]);
  }
  eq("journal : gabarit du PDF", db.tables.api_journal.at(-1).route, "/v1/factures/{id}/pdf");
  eq("domaines imposés (factures)", controlerAppels(faux.appelsChat, [100, 101, 200]), []);
}
{
  // ── bons de livraison ──
  faux.appelsChat.length = 0;
  let r = garder(await requete(h, "/livraisons"));
  let c = corps(r);
  eq("livraisons : période par défaut, bons de la fiche", [c.periode, c.donnees.map(x => x.numero)], [{ debut: "2026-09-21", fin: "2026-10-20" }, ["EP/OUT/1008"]]);
  eq("livraisons : sortie à l'heure de Paris (nuit), commande, produits", c.donnees[0], { id: 5008, numero: "EP/OUT/1008", sortie_le: "2026-10-16T00:30:00+02:00",
    commande_elixir: "S300008", renvoi: false, reste_a_livrer: false, produits: [{ cip: "3400930000059", nom: "DAFALGAN 1 g B/8" }] });
  r = garder(await requete(h, "/livraisons?debut=2026-09-01&fin=2026-10-20"));
  eq("livraisons : sorties seulement (ni retours ni non validées)", corps(r).donnees.map(x => x.numero), ["EP/OUT/1008", "EP/OUT/1010", "EP/OUT/1003", "EP/OUT/1002", "EP/OUT/1001"]);
  debutMinute();
  r = await requete(h, "/livraisons/5008/pdf");
  eq("BL : duplicata PDF", [r.statusCode, r.headers["Content-Type"], Buffer.from(r.body, "base64").subarray(0, 5).toString()], [200, "application/pdf", "%PDF-"]);
  vrai("BL : nom de fichier", /^attachment; filename="[A-Za-z0-9._-]+\.pdf"$/.test(r.headers["Content-Disposition"]));
  for (const [id, quoi] of [[5006, "autre pharmacie"], [5004, "retour reçu"], [5005, "non validé"], [999999, "inconnu"]]) {
    r = await requete(h, `/livraisons/${id}/pdf`);
    eq(`BL : ${quoi} → 404`, r.statusCode, 404);
  }
  eq("domaines imposés (livraisons)", controlerAppels(faux.appelsChat, [100, 101, 200]), []);
}

// ═══ 7. Limites, pannes, droits ═══
{
  // documents : 20 par minute et par clé
  debutMinute();
  h = nouveauRouteur();
  let r;
  for (let i = 0; i < 21; i++) r = await requete(h, "/factures/1001/pdf", { cle: K.aTest });
  eq("documents : 21e PDF de la minute → 429", [r.statusCode, corps(r).code], [429, "debit"]);
  // charge d'Odoo par fiche, toutes clés confondues (30 lectures réelles par minute)
  debutMinute();
  h = nouveauRouteur();
  for (let i = 0; i < 15; i++) r = await requete(h, "/factures", { cle: K.aLive });
  for (let i = 0; i < 15; i++) r = await requete(h, "/factures", { cle: K.aTest });
  eq("charge d'Odoo : 30 lectures de la fiche admises", r.statusCode, 200);
  r = await requete(h, "/factures", { cle: K.aLive });
  eq("charge d'Odoo : 31e lecture de la fiche → 429 + Retry-After", [r.statusCode, corps(r).code, !!r.headers["Retry-After"]], [429, "debit", true]);
  vrai("…message « toutes clés confondues »", /toutes clés/.test(corps(r).detail));
  r = await requete(h, "/factures", { cle: K.bLive });
  eq("…autre pharmacie non touchée", r.statusCode, 200);
  r = await requete(h, "/catalogue?par_page=1", { cle: K.aLive });
  eq("…catalogue (base seule, caches) toujours servi", r.statusCode, 200);
  // charge globale
  debutMinute();
  h = nouveauRouteur();
  const fen = new Date(Math.floor(T / 60000) * 60000).toISOString();
  db.tables.api_compteurs.push({ cle: "odoo:global", fenetre: fen, n: conf.LIMITES.odoo.global_par_minute });
  r = await requete(h, "/factures", { cle: K.bLive });
  eq("charge globale d'Odoo atteinte → 503 + Retry-After 30", [r.statusCode, corps(r).code, r.headers["Retry-After"]], [503, "indisponible", "30"]);
  // coupure à 8,5 s (ici 50 ms) : 503 rejouable
  debutMinute();
  h = nouveauRouteur({ delaiRouteMs: 50 });
  faux.etat.lenteurMs = 120;
  r = await requete(h, "/factures", { cle: K.bLive });
  eq("route trop longue → 503 indisponible, Retry-After 30", [r.statusCode, corps(r).code, r.headers["Retry-After"]], [503, "indisponible", "30"]);
  faux.etat.lenteurMs = 0;
  await new Promise(ok => setTimeout(ok, 300));
  // Odoo injoignable
  h = nouveauRouteur();
  faux.etat.panne = true;
  r = await requete(h, "/factures", { cle: K.bLive });
  eq("Odoo injoignable : documents → 503", [r.statusCode, corps(r).code], [503, "indisponible"]);
  r = await requete(h, "/catalogue?par_page=1", { cle: K.bLive });
  eq("Odoo injoignable : catalogue servi (liste enregistrée, prix de la base)", [r.statusCode, corps(r).donnees[0].prix_ht], [200, 9.55]);
  r = await requete(h, "/disponibilites?cips=3400000000011", { cle: K.bLive });
  eq("Odoo injoignable : disponibilités → 503", r.statusCode, 503);
  faux.etat.panne = false;
  // droit « lecture » exigé
  r = await requete(h, "/catalogue", { cle: K.aCommande });
  eq("clé sans droit de lecture → 403", corps(r).code, "portee_insuffisante");
  r = await requete(h, "/catalogue", { cle: null });
  eq("sans clé → 401", r.statusCode, 401);
  r = await requete(h, "/catalogue?api_key=x");
  eq("clé dans l'adresse → 400", corps(r).code, "cle_dans_url");
  // /v1/etat : limites par classe
  r = await requete(h, "/etat");
  eq("etat : limites par classe", Object.keys(corps(r).limites), ["lecture", "disponibilites", "documents", "commande", "simulation"]);
  eq("etat : clé de production, commandes réelles fermées → commandes indisponibles", corps(r).commandes.disponibles, false);
}
{
  // rien d'interne ne sort des réponses de lecture
  const tout = textes.join("\n");
  for (const [motif, quoi] of [[/@/, "adresse e-mail"], [new RegExp(INJECTION.slice(0, 20)), "texte libre d'une commande du site"], [/pmlr|relais/i, "relais"],
    [/odoo|supabase|pharmaml/i, "plomberie interne"], [/pharmacy_email|entered_by|"csv"|ligne;csv/, "champs internes"], [/détail technique/, "message du relais"],
    [/IMPERATIFS/, "tournée interne"], [/secret-jeton-portail|note interne|PML-|purchase_price|1\.23/, "secrets et champs interdits"], [/liste_prix|Liste 15|Liste 5\b/, "liste de prix"]]) {
    vrai(`réponses : jamais ${quoi}`, !motif.test(tout));
  }
  vrai("réponses : aucune clé", !/elx_(live|test)_/.test(tout));
  vrai("journal : ni corps, ni CIP, ni numéro", db.tables.api_journal.every(l => !/\d{7,}/.test(l.route)));
  vrai("aucune requête Supabase sans la clé serveur", db.etat.refusees === 0);
  vrai("aucune écriture hors des tables api_*", db.appels.filter(a => a.methode !== "GET").every(a => a.table.startsWith("api_") || a.table.startsWith("rpc/api_")));
  vrai("aucune écriture Odoo", !faux.etat.appels.some(a => ["create", "write", "unlink"].includes(a.method)));
}

// ═══ 8. Contingentement : même résultat que quota-status.js (heure réelle) ═══
{
  const now = new Date();
  const odooDt = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
  donnees["sale.order"].push({ id: 390001, name: "S390001", partner_id: [100, "A"], company_id: [2, "Elixir"], state: "sale", date_order: odooDt(now - 3600e3), create_date: odooDt(now - 3600e3), from_pharmaml: true });
  donnees["sale.order"].push({ id: 390002, name: "S390002", partner_id: [200, "B"], company_id: [2, "Elixir"], state: "sale", date_order: odooDt(now - 7200e3), create_date: odooDt(now - 7200e3), from_pharmaml: true });
  faux.tables["sale.order"].push(...donnees["sale.order"].slice(-2));
  faux.tables["sale.order.line"].push(
    { id: 9901, order_id: [390001, "S390001"], order_partner_id: [100, "A"], company_id: [2, "Elixir"], product_id: [11, "[3400930000011] DOLIPRANE"], product_uom_qty: 2 },
    { id: 9902, order_id: [390002, "S390002"], order_partner_id: [200, "B"], company_id: [2, "Elixir"], product_id: [4005, "[3400000000059] E"], product_uom_qty: 1 },
    { id: 9903, order_id: [390001, "S390001"], order_partner_id: [100, "A"], company_id: [2, "Elixir"], product_id: [4005, "[3400000000059] E"], product_uom_qty: 1, state: "cancel" });
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  db.tables.elixir_orders.push(
    { id: 1799000000001, date: iso(30 * 60e3), pharmacy_cip: "1111111", pharmacy_email: "a@pharma-a.test", processed: false, source: "catalogue", items: JSON.stringify([{ cip: "3400930000011", qty: 4 }]) },
    { id: 1799000000002, date: iso(3 * 3600e3), pharmacy_cip: "1111111", pharmacy_email: "a@pharma-a.test", processed: true, source: "catalogue",
      items: JSON.stringify([{ cip: "3400000000059", qty: 2, synced_at: iso(3 * 3600e3 - 60e3) }]) },
    { id: 1799000000003, date: iso(10 * 60e3), pharmacy_cip: "1111111", pharmacy_email: "A2@Pharma-A.test", processed: false, source: "catalogue",
      items: JSON.stringify([{ cip: "3400930000011", qty: 1, handled_at: iso(5 * 60e3) }, { cip: "3400000000059", qty: 3 }]) },
    { id: 1799000000004, date: iso(10 * 60e3), pharmacy_cip: "2222222", pharmacy_email: "b@pharma-b.test", processed: true, source: "catalogue",
      items: JSON.stringify([{ cip: "3400000000059", qty: 2 }]) });
  const { handler: quotaStatus } = await import("../netlify/functions/quota-status.js");
  for (const [id, cip] of [[100, "1111111"], [200, "2222222"], [700, "7777777"]]) {
    const r = await quotaStatus({ httpMethod: "POST", headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer jeton-admin" }, body: JSON.stringify({ odoo_id: id, cip }) });
    const site = JSON.parse(r.body);
    const api = await resteContingents({ odooId: id, cip }, { sb: stock.sbLecture, odoo: faux.odoo });
    eq(`contingent (${id}) : quota-status répond`, r.statusCode, 200);
    eq(`contingent (${id}) : même résultat que le panier (quota-status.js)`, { exempt: api.exempt, today: api.today, products: api.products },
      { exempt: site.exempt, today: site.today, products: site.products });
    if (id === 100) vrai("…données de l'essai prises en compte (Odoo et site)", site.products["3400930000011"].used_odoo > 0 && site.products["3400930000011"].used_site > 0 && site.products["3400000000059"].used_site > 0);
  }
}

// ═══ 9. Fichiers ═══
{
  const sql = readFileSync(join(APP, "sql/api-schema.sql"), "utf8");
  vrai("SQL : api_prix et api_prix_listes (RLS, revoke)", ["api_prix", "api_prix_listes"].every(t => new RegExp(`alter table ${t}\\s+enable row level security`).test(sql))
    && /revoke all on table [\s\S]*api_prix, api_prix_listes[\s\S]*from anon, authenticated;/.test(sql));
  const toml = readFileSync(join(APP, "netlify.toml"), "utf8");
  vrai("netlify.toml : api-cron planifiée toutes les 15 min", /\[functions\."api-cron"\]\s+schedule = "\*\/15 \* \* \* \*"/.test(toml));
  const zones = readFileSync(join(APP, "scripts/verifie-zones.mjs"), "utf8");
  vrai("zones : api-cron et api-prix-background admis", /api-\(v1\|admin\|compte\|cron\|prix-background\)/.test(zones));
  const redirects = readFileSync(join(APP, "public/_redirects"), "utf8");
  vrai("_redirects : /api/v1/* toujours avant /*", redirects.indexOf("/api/v1/*") >= 0 && redirects.indexOf("/api/v1/*") < redirects.indexOf("/*    /index.html"));
  for (const f of ["_api-lecture.js", "_api-prix.js", "_api-suivi.js", "_api-contingent.js", "api-prix-background.js", "api-cron.js"]) {
    const src = readFileSync(join(APP, "netlify/functions", f), "utf8");
    vrai(`${f} : aucune écriture Odoo écrite en dur`, !/["'](create|write|unlink)["']\s*,\s*\[/.test(src.replace(/ECRITURES = new Set\([^)]*\)/, "")));
    vrai(`${f} : aucun CIP réel ni clé`, !/\b34009\d{8}\b/.test(src) && !/elx_(live|test)_[0-9A-Za-z]{40}/.test(src));
  }
}

console.log(`\nAPI des pharmacies (lecture) : ${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
