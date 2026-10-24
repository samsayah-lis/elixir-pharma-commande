// Tests de l'API des pharmacies, phase 3 « commandes » : node scripts/test-api-commandes.mjs
// Hors ligne : faux PostgREST (scripts/api-faux.mjs : tables api_*, elixir_orders, kv_store du relais, ec_notifications,
// decrement_stock), faux Odoo (scripts/api-odoo-faux.mjs : listes de prix facturées au MINIMUM des règles applicables, stock
// libre, contingents, lignes de commande), fetch global intercepté (toute adresse inconnue lève : jamais de réseau, jamais
// PharmaML). Le VRAI relais (_relais.js, envoiAuto) met les commandes en file dans le faux kv_store. Données FICTIVES.
//  1. demande : contrôles de structure, empreinte, prix d'une quantité, en-tête de simulation ;
//  2. interrupteur « Commandes par API » fermé : commande réelle refusée (503), rien d'écrit ; simulation renseignée ;
//  3. mode test : commande « T… » contrôlée comme en production, écrite seulement dans api_commandes ; X-Elixir-Simulation ;
//     parcours de test → test_valide_le ;
//  4. prix : ceux de LA liste de la fiche, MINIMUM des règles à chaque quantité (comparés au faux Odoo) ;
//  5. commande réelle : exclusions, rupture retirée, contingent ramené au reste, elixir_orders (source « api »), notification ;
//  6. idempotence : rejeu, clé réutilisée, requêtes simultanées, reference_client, refus rejoué, reprise après coupure,
//     numéro déjà pris ;
//  7. plafonds (lignes, boîtes, montant, commandes du jour) ; 8. contingents (dispense, Odoo muet) ;
//  9. anomalies nettes (quantité, quasi-doublon site / API / logiciel / test) ; 10. annulation (délai, relais, autre fiche) ;
// 11. envoi : passage planifié + fonction d'arrière-plan + envoiAuto, une seule mise en file même si deux passages se
//     croisent, ruptures retirées ou gardées, relais coupé, interrupteur refermé, retard, réservations en suspens ;
// 12. admin (commandes, états de l'onglet Commandes, produits exclus) ; 13. rien d'interne ne sort, écritures bornées ;
// 14. order-save.js et le chemin du site inchangés.
import { execFileSync } from "node:child_process";
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
const BASE = "fb2a76b";   // production d'où part la branche api-pharmacies
const { fauxPostgrestApi } = await import("./api-faux.mjs");
const { creerOdooApi } = await import("./api-odoo-faux.mjs");
const { jeuOdoo, COMPTES } = await import("./test-chat-perimetre.mjs");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const r2 = (x) => Math.round(x * 100) / 100;

// Horloge des tests : un mardi… à 9 h UTC, après le 02/11/2026 (P3) et toujours dans le futur de l'horloge réelle (le relais
// compare l'âge d'une commande à Date.now() : 30 min au plus)
let T = Date.parse("2026-11-03T09:00:00Z");
while (T < Date.now() + 86400e3) T += 7 * 86400e3;
const maintenant = () => new Date(T);
const avancer = (s) => { T += s * 1000; };
const silence = () => {};
const iso = (ms = T) => new Date(ms).toISOString();
const odooDt = (ms) => iso(ms).slice(0, 19).replace("T", " ");

// ═══ Données fictives ═══
const db = fauxPostgrestApi({ horloge: () => T });
const { creerStockApi } = await import("../netlify/functions/_api-stock.js");
const stock = creerStockApi({ fetch: db.fetch, maintenant });
const A = "3400000000011", B = "3400000000028", C = "3400000000035", D = "3400000000042", E = "3400000000059", F = "3400000000066", G = "3400000000080", INCONNU = "3400000009999";
const PRODUITS = [
  // [pid, cip, code-barres, nom, prix de base, modèle, catégorie, stock libre]
  [4001, A, A, "PRODUIT EXEMPLE A 30 CPR", 10, 5001, 31, 50], [4002, B, B, "PRODUIT EXEMPLE B", 6, 5002, 32, 4], [4003, C, C, "PRODUIT EXEMPLE C", 2.4, 5003, 31, 0],
  [4004, D, D, "PRODUIT EXEMPLE D", 0, 5004, 33, 20], [4005, E, E, "PRODUIT EXEMPLE E", 600, 5005, 31, 12], [4006, F, "3400000000073", "PRODUIT EXEMPLE F", 8, 5006, 32, 30],
  [4007, G, G, "PRODUIT EXEMPLE G", 1500, 5007, 33, 9],
];
const donnees = jeuOdoo();
const ficheD = (id) => donnees["res.partner"].find(p => p.id === id);
Object.assign(ficheD(100), { property_product_pricelist: [5, "Liste 5"], deny_quota: false });
Object.assign(ficheD(200), { property_product_pricelist: [15, "Liste 15"], deny_quota: false, customer_rank: 1 });
Object.assign(ficheD(700), { property_product_pricelist: [15, "Liste 15"], deny_quota: true, customer_rank: 1 });
donnees["product.product"].push(...PRODUITS.map(([id, cip, barre, name, lp, tmpl, categ, libre]) => ({ id, default_code: cip, barcode: barre, name, list_price: lp,
  product_tmpl_id: [tmpl, name], categ_id: [categ, `Catégorie ${categ}`], free_qty: libre, company_id: false })));
for (const p of donnees["product.product"]) p.free_qty ??= 40;
donnees["product.category"] = [{ id: 30, parent_id: false }, { id: 31, parent_id: [30, "C30"] }, { id: 32, parent_id: false }, { id: 33, parent_id: false }];
donnees["product.pricelist"] = [{ id: 5 }, { id: 15 }];
let nr = 1;
const regle = (liste, applied_on, cible, compute, valeurs, extra = {}) => ({ id: nr++, pricelist_id: [liste, `Liste ${liste}`], applied_on, compute_price: compute, base: "list_price",
  product_id: false, product_tmpl_id: false, categ_id: false, min_quantity: 0, fixed_price: 0, percent_price: 0, price_discount: 0, price_surcharge: 0,
  date_start: false, date_end: false, base_pricelist_id: false, ...cible, ...valeurs, ...extra });
donnees["product.pricelist.item"] = [
  // liste 15 : barème global −2 %, règle produit PLUS CHÈRE (ignorée : Odoo facture le minimum), catégorie parente −5 %, formule,
  // paliers (modèle à 12 et — plus cher — à 24, catégorie −20 % à 50), règle expirée
  regle(15, "3_global", {}, "percentage", { percent_price: 2 }),
  regle(15, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.9 }),
  regle(15, "2_product_category", { categ_id: [30, "C30"] }, "percentage", { percent_price: 5 }),
  regle(15, "0_product_variant", { product_id: [4002, "B"] }, "formula", { price_discount: 10, price_surcharge: -0.05 }),
  regle(15, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.2, min_quantity: 12 }),
  regle(15, "1_product", { product_tmpl_id: [5001, "A"] }, "fixed", { fixed_price: 9.3, min_quantity: 24 }),
  regle(15, "2_product_category", { categ_id: [31, "C31"] }, "percentage", { percent_price: 20, min_quantity: 50 }),
  regle(15, "0_product_variant", { product_id: [4001, "A"] }, "fixed", { fixed_price: 1 }, { date_end: "2026-01-01 00:00:00" }),
  // liste 5 : barème global −4,5 %, palier d'une variante à 6
  regle(5, "3_global", {}, "percentage", { percent_price: 4.5 }),
  regle(5, "0_product_variant", { product_id: [4002, "B"] }, "fixed", { fixed_price: 5.5, min_quantity: 6 }),
];
// contingent : PRODUIT EXEMPLE E, 6 par semaine
donnees["product.template"] = [{ id: 5005, default_code: E, barcode: E, name: "PRODUIT EXEMPLE E", quota: 6, quota_period: "-1", quota_slippery_days: 0, product_variant_id: [4005, "E"], active: true }];
donnees["ir.property"] = [{ id: 2, name: "quota", company_id: [2, "Elixir"], value_integer: 6, res_id: "product.template,5005" }];
// historique de la pharmacie B (fiche 200) : 30 boîtes de B il y a 85 jours (habitude : 5 par mois) ; 2 boîtes de E cette semaine
const so = (id, part, dateMs, extra = {}) => ({ id, name: `S${id}`, partner_id: [part, `Fiche ${part}`], company_id: [2, "Elixir"], state: "sale", date_order: odooDt(dateMs),
  create_date: odooDt(dateMs), from_pharmaml: true, ...extra });
const sol = (id, order, part, pid, qte, creeMs) => ({ id, order_id: [order, `S${order}`], order_partner_id: [part, `Fiche ${part}`], company_id: [2, "Elixir"],
  product_id: [pid, `[${PRODUITS.find(p => p[0] === pid)[1]}] produit`], product_uom_qty: qte, create_date: odooDt(creeMs), display_type: false });
donnees["sale.order"].push(so(380001, 200, T - 85 * 86400e3), so(380002, 200, T - 60e3));
donnees["sale.order.line"].push(sol(98001, 380001, 200, 4002, 30, T - 85 * 86400e3), sol(98002, 380002, 200, 4005, 2, T - 2 * 86400e3));
const faux = creerOdooApi(donnees, { jour: () => new Date(T).toISOString().slice(0, 10) });
const produitOdoo = (pid) => faux.tables["product.product"].find(p => p.id === pid);

db.tables.odoo_catalog.push(...PRODUITS.map(([pid, cip, barre, name, lp, tmpl, categ, libre]) => ({ cip, barcode: barre, name, list_price: lp, odoo_pid: pid,
  odoo_tmpl_id: tmpl, categ_id: categ, in_stock: libre > 0, available: libre, updated_at: iso(), discounted_price: 1.11 })));
db.tables.elixir_pharmacies.push(...COMPTES.map(c => ({ ...c })));
const kvConfig = (autoSite) => {
  db.tables.kv_store = db.tables.kv_store.filter(k => k.key !== "pmlr:config");
  db.tables.kv_store.push({ key: "pmlr:config", value: JSON.stringify({ autoSite, depuis: "2026-01-01T00:00:00.000Z", alertes: "alertes@elixir.test" }), updated_at: iso() });
};
kvConfig(true);

// ── fetch global : Odoo (JSON-RPC du relais, de _quota.js), Supabase (clé anon du relais → même fausse base) ; rien d'autre ──
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === "https://odoo.test/jsonrpc") {
    if (faux.etat.panne) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(await faux.jsonrpc(opts.body)), { status: 200 });
  }
  if (url.startsWith("https://supabase.test/rest/v1/")) return db.fetch(url, { ...opts, headers: { ...(opts.headers || {}), apikey: "cle-service-test", Authorization: "Bearer cle-service-test" } });
  throw new Error(`appel réseau inattendu : ${url}`);
};

const Cmd = await import("../netlify/functions/_api-commande.js");
const conf = await import("../netlify/functions/_api-config.js");
const cles = await import("../netlify/functions/_api-cles.js");
const { isoParis } = await import("../netlify/functions/_api-http.js");
const { ficheVerifiee } = await import("../netlify/functions/_chat-perimetre.js");
const { creerHandler: creerRouteur } = await import("../netlify/functions/api-v1.js");
const { creerHandler: creerFondPrix } = await import("../netlify/functions/api-prix-background.js");
const { creerHandler: creerFondEnvoi } = await import("../netlify/functions/api-envoi-background.js");
const { creerHandler: creerCron } = await import("../netlify/functions/api-commandes-cron.js");
const { creerHandler: creerAdmin } = await import("../netlify/functions/api-admin.js");

// prix des listes 15 et 5, calculés par la vraie fonction d'arrière-plan
for (const l of [15, 5]) await creerFondPrix({ stock, odoo: faux.odoo, maintenant, journal: silence })({ headers: { "x-cron-secret": "secret-cron-test" }, body: JSON.stringify({ liste_id: l }) });
eq("prix calculés (listes 15 et 5)", [15, 5].map(l => db.tables.api_prix.filter(p => p.liste_id === l).length), [7, 7]);

// accès : B (fiche 200, liste 15, test validé), A (fiche 100, liste 5, test à faire), G (fiche 700, dispensée de contingent)
const ouvrir = (id, extra) => stock.acces.creer({ odoo_id: id, nom: ficheD(id).name, cip: ficheD(id).cip, ville: "Ville", ouvert_par: "admin@elixir.test",
  cgu_version: conf.CGU.version, cgu_acceptees_le: iso(), ...extra });
await ouvrir(200, { liste_prix_id: 15, test_valide_le: iso(), plafond_commandes_jour: 200, anomalie_doublon_min: 0 });
await ouvrir(100, { liste_prix_id: 5 });
await ouvrir(700, { liste_prix_id: 15, test_valide_le: iso() });
const cle = async (id, env, portees = ["lecture", "commande"]) => (await cles.creerCle(stock, { acces: await stock.acces.lire(id), environnement: env, libelle: `Outil ${id} ${env}`,
  portees, par: `compte@fiche-${id}.test`, role: "pharmacie", maintenant: maintenant() })).secret;
const K = { bLive: await cle(200, "live"), bTest: await cle(200, "test"), aTest: await cle(100, "test"), aLive: await cle(100, "live"), gLive: await cle(700, "live"),
  bLecture: await cle(200, "live", ["lecture"]) };
const JUSTIF = { [G]: { lab: { key: "labo-exemple", site: true }, produit: { cip: G, nom: "PRODUIT EXEMPLE G" } } };
// débits relevés pour les essais en série (le débit lui-même est couvert par test-api-fondations)
const LIM = structuredClone(conf.LIMITES);
for (const k of ["commande", "simulation", "lecture"]) conf.LIMITES[k] = { par_minute: 100000, par_jour: 1000000 };
conf.LIMITES.ip.par_minute = 100000;
conf.LIMITES.odoo = { fiche_par_minute: 100000, global_par_minute: 100000 };
const routeur = (extra = {}) => creerRouteur({ stock, maintenant, verifierFiche: (id) => ficheVerifiee(id, { odoo: faux.odoo }), odoo: faux.odoo, log: silence,
  hasard: () => 0.5, justificatifs: async () => JUSTIF, ...extra });
let ip = 1;
const textes = [];
const appel = async (h, methode, chemin, { cle: k, corps, idem: cleIdem, entetes = {}, host = "elixir-commande.expepharma.com" } = {}) => {
  const r = await h({ httpMethod: methode, path: `/api/v1${chemin}`, headers: { host, "x-nf-client-connection-ip": `198.51.${(ip++ % 200) + 1}.10`,
    ...(k ? { authorization: `Bearer ${k}` } : {}), ...(cleIdem ? { "idempotency-key": cleIdem } : {}), ...entetes },
    body: corps === undefined ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps) });
  if (r.body && !r.isBase64Encoded) textes.push(r.body);
  return r;
};
const corpsDe = (r) => JSON.parse(r.body);
let nIdem = 0;
const idem = () => `essai-${String(++nIdem).padStart(5, "0")}`;
const cmd = (lignes, extra = {}) => ({ lignes: lignes.map(([cip, quantite]) => ({ cip, quantite })), ...extra });
const commander = (h, k, lignes, extra = {}, opts = {}) => appel(h, "POST", "/commandes", { cle: k, idem: opts.idem || idem(), corps: cmd(lignes, extra), entetes: opts.entetes });
const simuler = (h, k, lignes, extra = {}, entetes = {}) => appel(h, "POST", "/commandes/simulation", { cle: k, corps: cmd(lignes, extra), entetes });
const api = (id) => db.tables.api_commandes.find(r => r.order_id === String(id));
const site = (id) => db.tables.elixir_orders.find(o => String(o.id) === String(id));
const sitesApi = () => db.tables.elixir_orders.filter(o => o.source === "api");
const taches = (id) => db.tables.kv_store.filter(k => k.key === `pmlr:tache:${id}` || k.key.startsWith(`pmlr:tache:${id}P`)).map(k => JSON.parse(k.value));
const reglages = (v) => { db.tables.api_reglages[0].valeur = JSON.stringify(v); db.tables.api_reglages[0].updated_at = iso(); };
const TOUS = () => Object.fromEntries(conf.PREREQUIS.map(p => [p.id, { fait: true, le: iso(), par: "admin@elixir.test" }]));
const modifierAcces = (id, champs) => stock.acces.modifier(id, champs);
const fiveMinutes = 5 * 60;

// ═══ 1. Demande ═══
{
  const ev = (corps, b64 = false) => ({ body: b64 ? Buffer.from(JSON.stringify(corps)).toString("base64") : JSON.stringify(corps), isBase64Encoded: b64 });
  const erreur = (f) => { try { f(); return null; } catch (e) { return e; } };
  eq("demande : valeurs par défaut", Cmd.lireDemande(ev(cmd([[A, 2]]))), { reference_client: null, lignes: [{ cip: A, quantite: 2 }], si_rupture: "retirer", tout_ou_rien: false, commentaire: null });
  eq("demande : corps en base64", Cmd.lireDemande(ev(cmd([[A, 2]]), true)).lignes, [{ cip: A, quantite: 2 }]);
  eq("JSON illisible → json_invalide", erreur(() => Cmd.lireDemande({ body: "{oups" }))?.code, "json_invalide");
  let e = erreur(() => Cmd.lireDemande(ev({ lignes: [{ cip: A, quantite: 0 }, { cip: "34000", quantite: 2 }, { cip: A, quantite: 2.5 }, { cip: B, qty: 1 }], quantity: 1 })));
  eq("erreurs par champ (champ inconnu, quantité, CIP, doublon)", [e?.code, e?.extra.erreurs.map(x => x.champ)],
    ["requete_invalide", ["quantity", "lignes[0].quantite", "lignes[1].cip", "lignes[2].quantite", "lignes[3].qty", "lignes[3].quantite", "lignes[2].cip"]]);
  eq("CIP en nombre → refus (texte attendu)", erreur(() => Cmd.lireDemande(ev({ lignes: [{ cip: 3400000000011, quantite: 1 }] })))?.extra.erreurs[0].champ, "lignes[0].cip");
  eq("prix envoyé par le client → refus (champ inconnu)", erreur(() => Cmd.lireDemande(ev({ lignes: [{ cip: A, quantite: 1, prix: 0.01 }] })))?.extra.erreurs[0].champ, "lignes[0].prix");
  eq("201 lignes → refus", erreur(() => Cmd.lireDemande(ev(cmd(Array.from({ length: 201 }, (_, i) => [String(3400000100000 + i), 1])))))?.extra.erreurs[0].champ, "lignes");
  eq("quantité 1000 → refus", erreur(() => Cmd.lireDemande(ev(cmd([[A, 1000]]))))?.extra.erreurs[0].champ, "lignes[0].quantite");
  for (const [champ, valeur] of [["reference_client", "<script>"], ["reference_client", "x".repeat(41)], ["si_rupture", "jeter"], ["tout_ou_rien", "oui"],
    ["commentaire", "x".repeat(201)], ["commentaire", "deux\nlignes"]]) {
    eq(`${champ} invalide (${String(valeur).slice(0, 12)}) → refus`, erreur(() => Cmd.lireDemande(ev(cmd([[A, 1]], { [champ]: valeur }))))?.extra.erreurs[0].champ, champ);
  }
  eq("référence et commentaire nettoyés", Cmd.lireDemande(ev(cmd([[A, 1]], { reference_client: " REASSORT 2026/11-A ", commentaire: "  avant   jeudi " }))).reference_client, "REASSORT 2026/11-A");
  const d1 = Cmd.lireDemande(ev(cmd([[A, 2], [B, 3]]))), d2 = Cmd.lireDemande(ev(cmd([[B, 3], [A, 2]]))), d3 = Cmd.lireDemande(ev(cmd([[A, 2], [B, 4]])));
  vrai("empreinte : même commande dans un autre ordre → même empreinte", Cmd.empreinteDemande(d1) === Cmd.empreinteDemande(d2));
  vrai("empreinte : autre quantité → autre empreinte", Cmd.empreinteDemande(d1) !== Cmd.empreinteDemande(d3));
  vrai("empreinte : en-tête de simulation compris", Cmd.empreinteDemande(d1) !== Cmd.empreinteDemande(d1, "rupture"));
  const p = { prix_ht: 9.5, paliers: [{ a_partir_de: 12, prix_ht: 9.2 }, { a_partir_de: 50, prix_ht: 8 }] };
  eq("prix d'une quantité : paliers atteints", [1, 11, 12, 49, 50, 999].map(q => Cmd.prixPour(p, q)), [9.5, 9.5, 9.2, 9.2, 8, 8]);
  eq("X-Elixir-Simulation lu sans casse", Cmd.simulationDe({ headers: { "X-Elixir-Simulation": " Rupture " } }), "rupture");
  eq("X-Elixir-Simulation inconnu → 422", erreur(() => Cmd.simulationDe({ headers: { "x-elixir-simulation": "panne" } }))?.code, "requete_invalide");
}

// ═══ 2. Interrupteur « Commandes par API » fermé ═══
let h = routeur();
{
  const n0 = [db.tables.api_commandes.length, db.tables.elixir_orders.length];
  let r = await commander(h, K.bLive, [[A, 2]]);
  eq("fermé : commande réelle → 503 ecriture_suspendue, Retry-After", [r.statusCode, corpsDe(r).code, r.headers["Retry-After"]], [503, "ecriture_suspendue", "3600"]);
  vrai("…problem+json, message clair (clés de test possibles)", /problem\+json/.test(r.headers["Content-Type"]) && /clés de test/.test(corpsDe(r).detail));
  eq("…rien d'écrit (api_commandes, elixir_orders)", [db.tables.api_commandes.length, db.tables.elixir_orders.length], n0);
  r = await commander(h, K.bLive, [[A, 2]], {}, { idem: "" });
  eq("fermé : refus avant même l'Idempotency-Key", corpsDe(r).code, "ecriture_suspendue");
  r = await simuler(h, K.bLive, [[A, 12]]);
  const s = corpsDe(r);
  eq("fermé : simulation renseignée (refus annoncé, lignes calculées)", [r.statusCode, s.simulation, s.resultat, s.refus?.code, s.refus?.statut, s.lignes[0].prix_unitaire_ht],
    [200, true, "refusee", "ecriture_suspendue", 503, faux.prix(15, 4001, 12)]);
  eq("…simulation : rien d'écrit", [db.tables.api_commandes.length, db.tables.elixir_orders.length], n0);
  r = await appel(h, "GET", "/etat", { cle: K.bLive });
  eq("etat (production) : commandes indisponibles, fermées", [corpsDe(r).commandes.disponibles, corpsDe(r).commandes.production], [false, "fermees"]);
  r = await appel(h, "GET", "/etat", { cle: K.bTest });
  eq("etat (test) : commandes disponibles", corpsDe(r).commandes.disponibles, true);
  eq("etat : vérification des anomalies annoncée", corpsDe(r).commandes.verification, { active: true, facteur_habitude_mensuelle: 10, quasi_doublon_min: 0 });
  r = await commander(h, K.bLecture, [[A, 2]]);
  eq("clé sans droit « commande » → 403", [r.statusCode, corpsDe(r).code], [403, "portee_insuffisante"]);
  r = await appel(h, "GET", "/commandes/simulation", { cle: K.bLive });
  eq("GET /commandes/simulation → 404", r.statusCode, 404);
  r = await appel(h, "PUT", "/commandes", { cle: K.bLive });
  eq("PUT /commandes → 405 (GET, POST)", [r.statusCode, r.headers.Allow], [405, "GET, POST"]);
}

// ═══ 3. Mode test (pharmacie A, clé elx_test_, liste 5) ═══
let commandeTestA;
{
  const ecrituresAvant = db.appels.length;
  let r = await appel(h, "GET", "/etat", { cle: K.aTest });
  eq("parcours : étape « etat » notée", Object.keys(JSON.parse(db.tables.api_acces.find(a => a.odoo_id === 100).test_parcours || "{}")), ["etat"]);
  const { creerHandler: creerCompte } = await import("../netlify/functions/api-compte.js");
  const compte = creerCompte({ stock, maintenant, journal: silence, identifier: async () => ({ odooId: 100, cip: "1111111", nom: "PHARMACIE A", ville: "Ville", mode: "complet", compteEmail: "a@pharma-a.test", admin: null }) });
  const vu = JSON.parse((await compte({ httpMethod: "POST", headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer x" }, body: JSON.stringify({ action: "etat" }) })).body);
  eq("« Accès API » : étapes du parcours montrées à la pharmacie", vu.test_parcours?.map(e => [e.etape, e.faite]),
    [["etat", true], ["simulation", false], ["commande", false], ["relecture", false], ["annulation", false], ["rejeu", false]]);
  r = await simuler(h, K.aTest, [[A, 12], [B, 6]]);
  eq("test : simulation acceptée, prix de la liste 5 (palier de B à 6)", [corpsDe(r).resultat, corpsDe(r).lignes.map(l => l.prix_unitaire_ht)], ["acceptee", [faux.prix(5, 4001, 12), faux.prix(5, 4002, 6)]]);
  const cleIdem = idem();
  r = await appel(h, "POST", "/commandes", { cle: K.aTest, idem: cleIdem, corps: cmd([[A, 12], [B, 6]], { reference_client: "ESSAI-1" }) });
  const c = corpsDe(r);
  commandeTestA = { id: c.id, idem: cleIdem };
  eq("test : 201, numéro « T… », environnement, état reçu", [r.statusCode, /^T1[7-9]\d{11}$/.test(c.id), c.environnement, c.etat, c.canal], [201, true, "test", "recue", "api"]);
  eq("test : Location", r.headers.Location, `/api/v1/commandes/${c.id}`);
  eq("test : annulable 10 min", c.annulable_jusqu_a, isoParis(T + 10 * 60e3));
  eq("test : total recalculé au serveur", c.total_indicatif_ht, r2(12 * faux.prix(5, 4001, 12) + 6 * faux.prix(5, 4002, 6)));
  vrai("test : avertissement « jamais envoyée ni facturée »", c.avertissements.some(a => /jamais envoyée ni facturée/.test(a)));
  eq("test : api_commandes (test, reçue, délai)", [api(c.id)?.test, api(c.id)?.etat, api(c.id)?.envoi_apres, api(c.id)?.statut_http], [true, "recue", iso(T + 10 * 60e3), 201]);
  const ecrites = db.appels.slice(ecrituresAvant).filter(a => a.methode !== "GET").map(a => a.table);
  vrai("test : écritures dans les tables api_* seulement (jamais elixir_orders, notification, stock, relais)", ecrites.every(t => t.startsWith("api_") || t.startsWith("rpc/api_")));
  eq("test : ni commande du site, ni tâche du relais", [site(c.id.slice(1)), taches(c.id.slice(1)).length, db.tables.ec_notifications.length, db.tables.decrements.length], [undefined, 0, 0, 0]);
  r = await appel(h, "GET", `/commandes/${c.id}`, { cle: K.aTest });
  eq("test : relecture (reçue, annulable, lignes)", [corpsDe(r).etat, corpsDe(r).annulable_jusqu_a, corpsDe(r).lignes.length], ["recue", c.annulable_jusqu_a, 2]);
  r = await appel(h, "GET", `/commandes/${c.id}`, { cle: K.aLive });
  eq("clé de production : commande de test → 404", r.statusCode, 404);
  vrai("parcours : pas encore validé (4 étapes)", db.tables.api_acces.find(a => a.odoo_id === 100).test_valide_le == null);
  r = await appel(h, "DELETE", `/commandes/${c.id}`, { cle: K.aTest });
  eq("test : annulation dans le délai", [r.statusCode, corpsDe(r).etat], [200, "annulee"]);
  eq("test : relecture annulée, lignes annulées", (await appel(h, "GET", `/commandes/${c.id}`, { cle: K.aTest }).then(corpsDe)).lignes.map(l => l.etat), ["annulee", "annulee"]);
  r = await appel(h, "POST", "/commandes", { cle: K.aTest, idem: cleIdem, corps: cmd([[A, 12], [B, 6]], { reference_client: "ESSAI-1" }) });
  eq("test : rejeu → même réponse, Idempotent-Replayed", [r.statusCode, r.headers["Idempotent-Replayed"], corpsDe(r).id], [201, "true", c.id]);
  const a100 = db.tables.api_acces.find(a => a.odoo_id === 100);
  eq("parcours complet → test validé seul (événement tracé)", [a100.test_valide_le != null, /parcours de test/.test(a100.test_valide_par), db.tables.api_evenements.some(e => e.type === "test_valide" && e.odoo_id === 100)],
    [true, true, true]);
  eq("parcours : six étapes", Object.keys(JSON.parse(a100.test_parcours)).sort(), ["annulation", "commande", "etat", "rejeu", "relecture", "simulation"]);
  // aperçu Netlify (clé de production traitée comme une clé de test) et clé de production : jamais comptés
  await stock.acces.modifier(100, { test_valide_le: null });
  a100.test_parcours = null;
  await appel(routeur(), "GET", "/etat", { cle: K.aLive, host: "deploy-preview-7--commandes-elixir.netlify.app" });
  await appel(routeur(), "GET", "/etat", { cle: K.aLive });
  eq("parcours : rien de noté pour une clé de production, ni sur un aperçu", a100.test_parcours, null);
  await stock.acces.modifier(100, { test_valide_le: iso() });
  // X-Elixir-Simulation (test seulement)
  h = routeur();
  r = await simuler(h, K.aTest, [[A, 2], [F, 1]], {}, { "x-elixir-simulation": "rupture" });
  eq("simulation « rupture » : lignes retirées → refus aucune_ligne_acceptee", [corpsDe(r).resultat, corpsDe(r).refus.code, corpsDe(r).lignes.map(l => l.etat)], ["refusee", "aucune_ligne_acceptee", ["rupture", "rupture"]]);
  r = await simuler(h, K.aTest, [[A, 10]], {}, { "x-elixir-simulation": "contingent" });
  eq("simulation « contingent » : ligne ramenée", [corpsDe(r).lignes[0].quantite, corpsDe(r).lignes[0].motif], [5, "contingentement"]);
  r = await simuler(h, K.aTest, [[A, 2]], {}, { "x-elixir-simulation": "doublon" });
  eq("simulation « doublon » : gardée à vérifier", [corpsDe(r).etat, corpsDe(r).motif], ["en_attente_elixir", "quasi_doublon"]);
  r = await commander(h, K.aTest, [[A, 2]], {}, { entetes: { "x-elixir-simulation": "indisponible" } });
  eq("commande « indisponible » : 503 rejouable, rien d'écrit", [r.statusCode, corpsDe(r).code, /même Idempotency-Key/.test(corpsDe(r).detail), db.tables.api_commandes.filter(x => x.etat === "en_cours").length],
    [503, "indisponible", true, 0]);
  r = await simuler(h, K.aTest, [[A, 2]], {}, { "x-elixir-simulation": "inconnu" });
  eq("X-Elixir-Simulation inconnu → 422", r.statusCode, 422);
  r = await simuler(h, K.bLive, [[A, 2]], {}, { "x-elixir-simulation": "rupture" });
  eq("X-Elixir-Simulation ignoré en production", corpsDe(r).lignes[0].etat, "acceptee");
}

// ═══ 4. Ouverture ; prix de LA liste de la fiche, MINIMUM des règles à chaque quantité ═══
reglages({ actif: true, commandes_live: true, prerequis: TOUS() });
h = routeur();
{
  let r = await appel(h, "GET", "/etat", { cle: K.bLive });
  eq("ouvertes : etat (production)", [corpsDe(r).commandes.disponibles, corpsDe(r).commandes.production], [true, "ouvertes"]);
  for (const q of [1, 12, 24, 50]) {
    r = await simuler(h, K.bLive, [[A, q], [B, q], [C, q], [F, q]], { si_rupture: "garder" });
    const s = corpsDe(r);
    eq(`prix à la quantité ${q} : ceux d'Odoo (minimum des règles, liste 15)`, s.lignes.map(l => l.prix_unitaire_ht), [4001, 4002, 4003, 4006].map(pid => faux.prix(15, pid, q)));
    eq(`…totaux de ligne et de commande (${q})`, [s.lignes.map(l => l.total_ht), s.total_indicatif_ht],
      [s.lignes.map(l => r2(l.prix_unitaire_ht * q)), r2(s.lignes.reduce((t, l) => t + r2(l.prix_unitaire_ht * q), 0))]);
  }
  eq("contrôle du faux : règle produit 9,90 et palier à 24 (9,30) plus chers ignorés", [faux.prix(15, 4001, 1), faux.prix(15, 4001, 24), faux.prix(15, 4001, 50)], [9.5, 9.2, 8]);
  r = await simuler(h, K.bLive, [[C, 2]], { si_rupture: "garder" });
  eq("rupture gardée : acceptée, en attente du stock", [corpsDe(r).lignes[0].etat, corpsDe(r).lignes[0].motif], ["acceptee", "en_attente_stock"]);
  r = await simuler(h, K.bLive, [["3400000000073", 2]]);
  eq("commande par code-barres : CIP du catalogue, code demandé rendu", [corpsDe(r).lignes[0].cip, corpsDe(r).lignes[0].code_demande, corpsDe(r).lignes[0].prix_unitaire_ht], [F, "3400000000073", faux.prix(15, 4006, 2)]);
  r = await simuler(h, K.aTest, [[A, 12]]);
  eq("autre pharmacie, autre liste (5)", corpsDe(r).lignes[0].prix_unitaire_ht, faux.prix(5, 4001, 12));
}

// ═══ 5. Commande réelle ═══
let principale;
{
  const avant = db.tables.elixir_orders.length;
  const r = await commander(h, K.bLive, [[A, 12], [B, 3], [C, 2], [G, 1], [INCONNU, 1], [E, 10], [D, 1]], { reference_client: "REASSORT-B-1", commentaire: "Livraison avant jeudi" });
  const c = corpsDe(r);
  principale = c;
  eq("commande : 201, réelle, reçue, annulable 10 min", [r.statusCode, /^1[7-9]\d{11}$/.test(c.id), c.environnement, c.etat, c.annulable_jusqu_a], [201, true, "live", "recue", isoParis(T + 10 * 60e3)]);
  eq("lignes : états et motifs", c.lignes.map(l => [l.ligne, l.etat, l.motif, l.quantite]), [[1, "acceptee", null, 12], [2, "acceptee", null, 3], [3, "rupture", "rupture", 0],
    [4, "refusee", "produit_sur_justificatif", 0], [5, "refusee", "produit_inconnu", 0], [6, "acceptee", "contingentement", 4], [7, "refusee", "prix_indisponible", 0]]);
  vrai("contingent : reste de la semaine expliqué", /reste du contingent : 4 boîte\(s\) \(6 par semaine, du /.test(c.lignes[5].detail));
  eq("prix serveur (liste 15, à la quantité)", c.lignes.filter(l => l.etat === "acceptee").map(l => l.prix_unitaire_ht), [faux.prix(15, 4001, 12), faux.prix(15, 4002, 3), faux.prix(15, 4005, 4)]);
  eq("total recalculé", c.total_indicatif_ht, r2(12 * faux.prix(15, 4001, 12) + 3 * faux.prix(15, 4002, 3) + 4 * faux.prix(15, 4005, 4)));
  vrai("mention « hors offres du site »", /Prix HT de votre liste, hors offres du site/.test(c.mention));
  const o = site(c.id);
  eq("elixir_orders : une ligne, source « api », identité de la fiche, sans e-mail", [db.tables.elixir_orders.length - avant, o?.source, o?.pharmacy_cip, o?.pharmacy_email, o?.pharmacy_name, o?.processed, o?.csv, o?.is_client],
    [1, "api", "2222222", null, "PHARMACIE B", false, null, true]);
  eq("elixir_orders : lignes acceptées (CIP, quantité, prix, rang de la demande)", o?.items.map(i => [i.cip, i.qty, i.pn, i.total, i.ligne_api]),
    c.lignes.filter(l => l.etat === "acceptee").map(l => [l.cip, l.quantite, l.prix_unitaire_ht, l.total_ht, l.ligne]));
  eq("elixir_orders : totaux, date du serveur", [o?.total_ht, o?.nb_lignes, o?.date], [c.total_indicatif_ht, 3, iso(Math.floor(T / 1000) * 1000)]);
  const row = api(c.id);
  eq("api_commandes : reçue, délai, réponse, demande normalisée", [row.etat, row.envoi_apres, row.statut_http, JSON.parse(row.reponse).id, JSON.parse(row.demande).commentaire, row.reference_client, row.test],
    [principale.etat, iso(T + 10 * 60e3), 201, c.id, "Livraison avant jeudi", "REASSORT-B-1", false]);
  eq("notification de l'admin", [db.tables.ec_notifications.length, /Commande API de PHARMACIE B/.test(db.tables.ec_notifications.at(-1)?.title), db.tables.ec_notifications.at(-1)?.data?.source], [1, true, "api"]);
  eq("pas de décrément ni de mise en file avant la fin du délai", [db.tables.decrements.length, taches(c.id).length], [0, 0]);
  // la commande compte aussitôt dans le contingent (comme une commande du site), dans « commandes » et dans le suivi
  let x = await appel(h, "GET", "/contingents", { cle: K.bLive });
  eq("contingent : commandé (Odoo + API), reste 0", (({ deja_commande, reste }) => [deja_commande, reste])(corpsDe(x).donnees.find(d => d.cip === E)), [6, 0]);
  x = await commander(h, K.bLive, [[A, 1], [E, 1]]);
  eq("contingent épuisé : ligne refusée, le reste accepté", [x.statusCode, corpsDe(x).lignes.map(l => [l.etat, l.motif])], [201, [["acceptee", null], ["refusee", "contingentement"]]]);
  x = await commander(h, K.bLive, [[A, 1], [E, 1]], { tout_ou_rien: true });
  eq("tout_ou_rien et une ligne refusée → 422 commande_refusee, lignes détaillées", [x.statusCode, corpsDe(x).code, corpsDe(x).lignes?.length], [422, "commande_refusee", 2]);
  x = await commander(h, K.bLive, [[E, 1], [INCONNU, 2]]);
  eq("aucune ligne acceptée → 422", [x.statusCode, corpsDe(x).code], [422, "aucune_ligne_acceptee"]);
  x = await appel(h, "GET", `/commandes/${c.id}`, { cle: K.bLive });
  eq("suivi : canal api, reçue, annulable, référence, lignes et motifs", [corpsDe(x).canal, corpsDe(x).etat, corpsDe(x).annulable_jusqu_a, corpsDe(x).reference_client, corpsDe(x).lignes.map(l => l.etat)],
    ["api", "recue", c.annulable_jusqu_a, "REASSORT-B-1", ["acceptee", "acceptee", "rupture", "refusee", "refusee", "acceptee", "refusee"]]);
  x = await appel(h, "GET", "/commandes", { cle: K.bLive });
  eq("liste : commande API vérifiée (sans e-mail de compte), reçue, 3 lignes", (({ canal, etat, lignes }) => [canal, etat, lignes])(corpsDe(x).donnees.find(d => d.id === c.id)), ["api", "recue", 3]);
}

// ═══ 6. Idempotence ═══
{
  const corps = cmd([[A, 2], [F, 1]], { reference_client: "IDEM-1" });
  const k1 = idem();
  let r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k1, corps });
  const premier = r.body, id1 = corpsDe(r).id;
  const n = sitesApi().length;
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k1, corps });
  eq("rejeu : même statut, même corps, Idempotent-Replayed, Location", [r.statusCode, r.body === premier, r.headers["Idempotent-Replayed"], r.headers.Location], [201, true, "true", `/api/v1/commandes/${id1}`]);
  eq("rejeu : aucune nouvelle commande", sitesApi().length, n);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k1, corps: { ...corps, lignes: [{ cip: A, quantite: 3 }] } });
  eq("même clé, autre contenu → 422 idempotency_key_reutilisee", [r.statusCode, corpsDe(r).code], [422, "idempotency_key_reutilisee"]);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k1, corps: { lignes: [{ cip: F, quantite: 1 }, { cip: A, quantite: 2 }], reference_client: "IDEM-1" } });
  eq("même contenu dans un autre ordre → rejeu", [r.statusCode, r.headers["Idempotent-Replayed"]], [201, "true"]);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, corps });
  eq("sans Idempotency-Key → 400", [r.statusCode, corpsDe(r).code], [400, "idempotency_key_absente"]);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: "court", corps });
  eq("Idempotency-Key mal formée → 400", [r.statusCode, /8 à 128/.test(corpsDe(r).detail)], [400, true]);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: idem(), corps });
  eq("reference_client déjà prise (nouvelle clé) → 409, numéro existant", [r.statusCode, corpsDe(r).code, corpsDe(r).id], [409, "reference_deja_utilisee", id1]);
  eq("…aucune nouvelle commande", sitesApi().length, n);
  // requêtes simultanées avec la même clé : une seule commande
  const k2 = idem(), c2 = cmd([[A, 4]], { reference_client: "SIMULT-1" });
  const [x, y] = await Promise.all([appel(h, "POST", "/commandes", { cle: K.bLive, idem: k2, corps: c2 }), appel(h, "POST", "/commandes", { cle: K.bLive, idem: k2, corps: c2 })]);
  const statuts = [x.statusCode, y.statusCode].sort();
  vrai(`simultanées, même clé : 201 + (409 en cours | rejeu) (${statuts})`, statuts[0] === 201 && [201, 409].includes(statuts[1]));
  const deuxieme = [x, y].find(z => z.statusCode === 409);
  if (deuxieme) eq("…409 requete_en_cours, Retry-After 2", [corpsDe(deuxieme).code, deuxieme.headers["Retry-After"]], ["requete_en_cours", "2"]);
  eq("…une seule réservation et une seule commande", [db.tables.api_commandes.filter(z => z.idempotency_key === k2).length, sitesApi().length], [1, n + 1]);
  // simultanées, clés différentes, même reference_client : une seule passe
  const [u, v] = await Promise.all([commander(h, K.bLive, [[A, 5]], { reference_client: "SIMULT-2" }), commander(h, K.bLive, [[A, 6]], { reference_client: "SIMULT-2" })]);
  eq("simultanées, même reference_client : 201 + 409", [u.statusCode, v.statusCode].sort(), [201, 409]);
  eq("…une seule commande", sitesApi().length, n + 2);
  // refus enregistré et rejoué ; sa référence est libérée
  const k3 = idem();
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k3, corps: cmd([[INCONNU, 1]], { reference_client: "REF-REFUSEE" }) });
  const refus = r.body;
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k3, corps: cmd([[INCONNU, 1]], { reference_client: "REF-REFUSEE" }) });
  eq("refus 422 rejoué à l'identique", [r.statusCode, r.body === refus, r.headers["Idempotent-Replayed"], /problem\+json/.test(r.headers["Content-Type"])], [422, true, "true", true]);
  r = await commander(h, K.bLive, [[A, 1]], { reference_client: "REF-REFUSEE" });
  eq("référence d'une commande refusée : réutilisable", r.statusCode, 201);
  // coupure pendant l'insertion : 503, réservation gardée avec son numéro ; nouvel essai trop tôt → 409 ; après 1 min → terminée
  const insererVrai = stock.site.inserer;
  stock.site.inserer = async () => { throw new Error("coupure réseau"); };
  const k4 = idem(), c4 = cmd([[A, 7]], { reference_client: "COUPURE-1" });
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k4, corps: c4 });
  stock.site.inserer = insererVrai;
  const reservee = db.tables.api_commandes.find(z => z.idempotency_key === k4);
  eq("coupure à l'insertion : 503 rejouable (1 min), numéro noté, rien dans elixir_orders", [r.statusCode, r.headers["Retry-After"], reservee?.etat, /^1[7-9]\d{11}$/.test(reservee?.order_id || ""), site(reservee?.order_id)],
    [503, "60", "en_cours", true, undefined]);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k4, corps: c4 });
  eq("nouvel essai immédiat → 409 en cours", [r.statusCode, corpsDe(r).code], [409, "requete_en_cours"]);
  avancer(61);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k4, corps: c4 });
  eq("après 1 min : reprise, MÊME numéro, une commande", [r.statusCode, corpsDe(r).id, sitesApi().filter(o => String(o.id) === reservee.order_id).length], [201, reservee.order_id, 1]);
  // coupure APRÈS l'insertion (fin de la réservation perdue) : la reprise reconnaît la commande, pas de doublon
  const ecrireVrai = stock.commandes.ecrire;
  stock.commandes.ecrire = async (row, champs) => { if (champs.statut_http === 201) throw new Error("coupure réseau"); return ecrireVrai(row, champs); };
  const k5 = idem(), c5 = cmd([[A, 8]], { reference_client: "COUPURE-2" });
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k5, corps: c5 });
  stock.commandes.ecrire = ecrireVrai;
  const r5 = db.tables.api_commandes.find(z => z.idempotency_key === k5);
  eq("coupure après l'insertion : 503, commande enregistrée, réservation en cours", [r.statusCode, r5.etat, !!site(r5.order_id)], [503, "en_cours", true]);
  avancer(61);
  r = await appel(h, "POST", "/commandes", { cle: K.bLive, idem: k5, corps: c5 });
  eq("reprise : même numéro, toujours une seule commande", [r.statusCode, corpsDe(r).id, db.tables.elixir_orders.filter(o => String(o.id) === r5.order_id).length, api(r5.order_id).etat], [201, r5.order_id, 1, "recue"]);
  // numéro déjà pris par une autre commande (même milliseconde) : nouveau numéro noté avant l'insertion
  const N = Number(Cmd.nouveauNumero(false, maintenant()));
  db.tables.elixir_orders.push({ id: N + 1, date: iso(), pharmacy_cip: "9999999", pharmacy_email: "autre@pharma.test", source: "catalogue", processed: false, items: [{ cip: A, qty: 1 }] });
  r = await commander(h, K.bLive, [[A, 9]]);
  eq("numéro pris : nouveau numéro, l'autre commande intacte", [r.statusCode, corpsDe(r).id, api(String(N + 2))?.etat, site(N + 1).pharmacy_cip, site(N + 2)?.source], [201, String(N + 2), "recue", "9999999", "api"]);
}

// ═══ 7. Plafonds de l'accès ═══
{
  const essai = async (champs, lignes) => {
    await modifierAcces(200, champs);
    const r = await commander(routeur(), K.bLive, lignes);
    await modifierAcces(200, { plafond_lignes: 100, plafond_boites: 1000, plafond_montant_ht: 3000 });
    return r;
  };
  const n = sitesApi().length;
  let r = await essai({ plafond_lignes: 2 }, [[A, 1], [B, 1], [F, 1]]);
  eq("plafond de lignes : 422 explicite, valeurs", [r.statusCode, corpsDe(r).code, corpsDe(r).plafond], [422, "plafond_depasse", { nom: "lignes", limite: 2, valeur: 3 }]);
  r = await essai({ plafond_boites: 10 }, [[A, 11]]);
  eq("plafond de boîtes", [r.statusCode, corpsDe(r).plafond.nom, corpsDe(r).plafond.valeur], [422, "boites", 11]);
  r = await essai({ plafond_montant_ht: 100 }, [[A, 12]]);
  eq("plafond de montant (sur ce qui serait envoyé)", [r.statusCode, corpsDe(r).plafond.nom, corpsDe(r).plafond.valeur], [422, "montant_ht", r2(12 * faux.prix(15, 4001, 12))]);
  r = await essai({ plafond_lignes: 1 }, [[A, 1], [INCONNU, 1]]);
  eq("plafond compté sur les lignes acceptées (refusées hors compte)", r.statusCode, 201);
  eq("refus de plafond : rien dans elixir_orders", sitesApi().length, n + 1);
  // commandes du jour (toutes clés de la fiche, réelles)
  const faites = db.tables.api_commandes.filter(z => z.odoo_id === 200 && !z.test && z.order_id && !["refusee", "en_cours"].includes(z.etat)).length;
  await modifierAcces(200, { plafond_commandes_jour: faites });
  const k = idem();
  const hp = routeur();
  r = await appel(hp, "POST", "/commandes", { cle: K.bLive, idem: k, corps: cmd([[A, 1]]) });
  const minuit = Date.parse(new Date(T + 86400e3).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) + "T00:00:00+01:00");
  eq("plafond du jour : 429, Retry-After jusqu'à minuit (Paris), réservation rendue", [r.statusCode, corpsDe(r).code, Math.abs(Number(r.headers["Retry-After"]) - Math.ceil((minuit - T) / 1000)) <= 3600,
    db.tables.api_commandes.some(z => z.idempotency_key === k)], [429, "plafond_commandes_jour", true, false]);
  r = await simuler(hp, K.bLive, [[A, 1]]);
  eq("plafond du jour annoncé par la simulation", [corpsDe(r).resultat, corpsDe(r).refus.code, corpsDe(r).refus.statut], ["refusee", "plafond_commandes_jour", 429]);
  await modifierAcces(200, { plafond_commandes_jour: 200 });
  r = await appel(routeur(), "POST", "/commandes", { cle: K.bLive, idem: k, corps: cmd([[A, 1]]) });
  eq("…plafond relevé : la même clé passe", r.statusCode, 201);
}

// ═══ 7 bis. Accès bloqué, conditions d'utilisation à ré-accepter ═══
{
  await modifierAcces(200, { mode: "bloque" });
  let r = await commander(routeur(), K.bLive, [[A, 1]]);
  eq("accès « bloqué » : 403 commandes_bloquees, rien d'écrit", [r.statusCode, corpsDe(r).code, db.tables.api_commandes.some(z => z.etat === "en_cours")], [403, "commandes_bloquees", false]);
  r = await simuler(routeur(), K.bLive, [[A, 1]]);
  eq("…simulation : refus annoncé", [corpsDe(r).resultat, corpsDe(r).refus.code], ["refusee", "commandes_bloquees"]);
  await modifierAcces(200, { mode: "auto", cgu_version: "2026-01-01-ancienne" });
  r = await commander(routeur(), K.bLive, [[A, 1]]);
  eq("nouvelle version des conditions : 403 cgu_a_accepter", [r.statusCode, corpsDe(r).code], [403, "cgu_a_accepter"]);
  await modifierAcces(200, { cgu_version: conf.CGU.version });
}

// ═══ 8. Contingents ═══
h = routeur();
{
  await modifierAcces(700, { plafond_montant_ht: 10000 });
  let r = await commander(routeur(), K.gLive, [[E, 10]]);
  eq("fiche dispensée : pas de contingent (10 au-delà des 6 par semaine)", [r.statusCode, corpsDe(r).lignes[0].quantite, corpsDe(r).lignes[0].motif], [201, 10, null]);
  const n = db.tables.api_commandes.length;
  const hq = routeur({ quota: { resteContingents: async () => { throw new Error("Odoo muet"); } } });
  r = await commander(hq, K.bLive, [[A, 1], [E, 1]]);
  eq("contingent impossible à vérifier → 503 contingent_indisponible, Retry-After 60, rien d'enregistré", [r.statusCode, corpsDe(r).code, r.headers["Retry-After"], db.tables.api_commandes.length],
    [503, "contingent_indisponible", "60", n]);
  r = await commander(hq, K.bLive, [[A, 1]]);
  eq("…sans produit contingenté : acceptée", r.statusCode, 201);
  faux.etat.panne = true;
  r = await commander(routeur(), K.bLive, [[A, 1]]);
  faux.etat.panne = false;
  eq("Odoo injoignable → 503 indisponible, rien d'enregistré", [r.statusCode, corpsDe(r).code, db.tables.api_commandes.length], [503, "indisponible", n + 1]);
}

// ═══ 9. Anomalies nettes → « à vérifier » ═══
avancer(31 * 60);
await modifierAcces(200, { anomalie_doublon_min: 30 });
h = routeur();
let gardee;
{
  let r = await commander(h, K.bLive, [[A, 40]]);
  gardee = corpsDe(r);
  eq("quantité > 10 × l'habitude (produit jamais commandé : plancher 3 / mois) → gardée", [r.statusCode, gardee.etat, gardee.motif, gardee.lignes[0].anomalie, gardee.annulable_jusqu_a],
    [201, "en_attente_elixir", "anomalie_quantite", "anomalie_quantite", null]);
  eq("…api_commandes « a_verifier », sans date d'envoi ; commande visible dans l'admin", [api(gardee.id).etat, api(gardee.id).envoi_apres, site(gardee.id)?.source], ["a_verifier", null, "api"]);
  vrai("…notification « à vérifier »", /À vérifier/.test(db.tables.ec_notifications.at(-1).title));
  vrai("…avertissement clair", gardee.avertissements.some(a => /gardée « à vérifier »/.test(a)));
  r = await simuler(h, K.bLive, [[B, 60]]);
  eq("habitude de B : 5 / mois → 60 boîtes gardées", [corpsDe(r).etat, corpsDe(r).motif], ["en_attente_elixir", "anomalie_quantite"]);
  r = await simuler(h, K.bLive, [[B, 50]]);
  eq("…50 boîtes (10 × 5) : acceptées", corpsDe(r).etat, "recue");
  // quasi-doublons (site et API, 30 min)
  r = await commander(h, K.bLive, [[F, 2], [B, 1]]);
  const x = corpsDe(r);
  eq("commande ordinaire : reçue", x.etat, "recue");
  r = await appel(h, "DELETE", `/commandes/${x.id}`, { cle: K.bLive });
  r = await commander(h, K.bLive, [[F, 2], [B, 1]]);
  const y = corpsDe(r);
  eq("commande annulée puis repassée : pas un doublon", y.etat, "recue");
  r = await commander(h, K.bLive, [[F, 4], [B, 2]]);
  eq("mêmes produits moins de 30 min après → quasi-doublon gardé", [corpsDe(r).etat, corpsDe(r).motif], ["en_attente_elixir", "quasi_doublon"]);
  r = await commander(h, K.bLive, [[F, 1], [A, 1], [C, 1], [D, 1]]);
  eq("part commune < 80 % : reçue", corpsDe(r).etat, "recue");
  // logiciel d'officine (commande Odoo de la fiche reçue il y a 5 min)
  avancer(31 * 60);
  faux.tables["sale.order"].push(so(380010, 200, T - fiveMinutes * 1000));
  faux.tables["sale.order.line"].push(sol(98010, 380010, 200, 4006, 3, T - fiveMinutes * 1000), sol(98011, 380010, 200, 4002, 1, T - fiveMinutes * 1000));
  r = await commander(h, K.bLive, [[F, 1], [B, 1]]);
  eq("quasi-doublon d'une commande du logiciel d'officine (vue dans Odoo) → gardée", [corpsDe(r).etat, corpsDe(r).motif], ["en_attente_elixir", "quasi_doublon"]);
  // réglages : fenêtre à 0, contrôle coupé
  await modifierAcces(200, { anomalie_doublon_min: 0 });
  r = await commander(routeur(), K.bLive, [[F, 1], [B, 1]]);
  eq("fenêtre de doublon à 0 : reçue", corpsDe(r).etat, "recue");
  await modifierAcces(200, { anomalie_active: false });
  r = await simuler(routeur(), K.bLive, [[A, 40]]);
  eq("contrôle des anomalies coupé : reçue", corpsDe(r).etat, "recue");
  await modifierAcces(200, { anomalie_active: true });
  // mode test : quasi-doublons parmi les commandes de TEST
  r = await commander(h, K.aTest, [[A, 3]]);
  eq("test : première commande reçue", corpsDe(r).etat, "recue");
  r = await commander(h, K.aTest, [[A, 4]]);
  eq("test : seconde identique → gardée (parmi les commandes de test)", [corpsDe(r).etat, corpsDe(r).motif], ["en_attente_elixir", "quasi_doublon"]);
  r = await appel(h, "GET", `/commandes/${corpsDe(r).id}`, { cle: K.aTest });
  eq("test : relecture « en attente d'Elixir »", [corpsDe(r).etat, corpsDe(r).motif], ["en_attente_elixir", "quasi_doublon"]);
}

// ═══ 10. Annulation ═══
h = routeur();
{
  let r = await commander(h, K.bLive, [[A, 2], [F, 1]]);
  const o1 = corpsDe(r).id;
  r = await appel(h, "DELETE", `/commandes/${o1}`, { cle: K.bLive });
  eq("dans le délai : annulée", [r.statusCode, corpsDe(r).etat, corpsDe(r).id], [200, "annulee", o1]);
  eq("…lignes « traitées » (annulation de l'API), commande traitée", [site(o1).items.map(i => [!!i.handled_at, i.api_motif]), site(o1).processed, api(o1).etat],
    [[[true, "annulee"], [true, "annulee"]], true, "annulee"]);
  r = await appel(h, "DELETE", `/commandes/${o1}`, { cle: K.bLive });
  eq("…rejeu de l'annulation : 200", [r.statusCode, corpsDe(r).etat], [200, "annulee"]);
  r = await appel(h, "GET", `/commandes/${o1}`, { cle: K.bLive });
  eq("…relecture : annulée, lignes annulées", [corpsDe(r).etat, corpsDe(r).lignes.map(l => l.etat)], ["annulee", ["annulee", "annulee"]]);
  r = await appel(h, "GET", "/contingents", { cle: K.bLive });
  r = await commander(h, K.bLive, [[A, 3]]);
  const o2 = corpsDe(r).id;
  avancer(10 * 60 + 1);
  r = await appel(h, "DELETE", `/commandes/${o2}`, { cle: K.bLive });
  eq("délai écoulé → 409 trop_tard", [r.statusCode, corpsDe(r).code, corpsDe(r).etat], [409, "trop_tard", "en_transmission"]);
  r = await commander(h, K.bLive, [[B, 1]]);
  const o3 = corpsDe(r).id;
  db.tables.kv_store.push({ key: `pmlr:tache:${o3}`, value: JSON.stringify({ ref: o3, orderId: o3, etat: "a_envoyer", idx: [0] }), updated_at: iso() });
  r = await appel(h, "DELETE", `/commandes/${o3}`, { cle: K.bLive });
  eq("mise en envoi par Elixir pendant le délai → 409, rien changé", [r.statusCode, api(o3).etat, !!site(o3).items[0].handled_at], [409, "recue", false]);
  r = await appel(h, "GET", `/commandes/${o3}`, { cle: K.bLive });
  eq("…état : celui du relais (plus annulable)", [corpsDe(r).etat, corpsDe(r).annulable_jusqu_a], ["en_transmission", null]);
  db.tables.kv_store = db.tables.kv_store.filter(k => k.key !== `pmlr:tache:${o3}`);
  r = await appel(h, "DELETE", `/commandes/${gardee.id}`, { cle: K.bLive });
  eq("commande gardée « à vérifier » : annulable", [r.statusCode, api(gardee.id).etat], [200, "annulee"]);
  r = await appel(h, "DELETE", `/commandes/${o3}`, { cle: K.gLive });
  eq("commande d'une autre pharmacie → 404", [r.statusCode, corpsDe(r).code], [404, "introuvable"]);
  r = await appel(h, "DELETE", `/commandes/${o3}`, { cle: K.bTest });
  eq("clé de test sur une commande réelle → 404", r.statusCode, 404);
  r = await appel(h, "DELETE", "/commandes/1790000000001", { cle: K.bLive });
  eq("numéro inconnu → 404", r.statusCode, 404);
  r = await appel(h, "DELETE", `/commandes/${o3}`, { cle: K.bLecture });
  eq("annulation sans droit « commande » → 403", r.statusCode, 403);
  // l'envoi a pris la commande : l'annulation (conditionnelle) ne passe plus
  r = await commander(h, K.bLive, [[A, 1], [B, 1], [F, 1]]);
  const o4 = corpsDe(r).id;
  await stock.commandes.ecrire(api(o4), { etat: "envoi_demande" });
  r = await appel(h, "DELETE", `/commandes/${o4}`, { cle: K.bLive });
  eq("envoi en cours → 409 trop_tard", [r.statusCode, api(o4).etat], [409, "envoi_demande"]);
  api(o4).etat = "annulee";   // hors des essais d'envoi qui suivent
}

// ═══ 11. Envoi : passage planifié → arrière-plan → envoiAuto (relais) ═══
{
  // toutes les commandes reçues jusqu'ici sont mises de côté (annulées) : on suit une commande à la fois
  for (const z of db.tables.api_commandes) if (!z.test && z.etat === "recue") z.etat = "annulee";
  const fond = creerFondEnvoi({ stock, odoo: faux.odoo, maintenant, journal: silence });
  const evt = (id, secret = "secret-cron-test") => ({ httpMethod: "POST", headers: secret ? { "x-cron-secret": secret } : {}, body: JSON.stringify({ id }) });
  const lances = [];
  const cron = () => creerCron({ stock, maintenant, journal: silence, lancer: async (id) => { lances.push(id); await fond(evt(id)); return null; } })();
  const empreintesVides = () => { db.tables.kv_store = db.tables.kv_store.filter(k => !k.key.startsWith("pmlr:empreinte:")); };
  eq("arrière-plan : sans secret → 403", (await fond(evt("00000000-0000-4000-8000-000000000000", null))).statusCode, 403);
  eq("arrière-plan : identifiant illisible → 400", (await fond(evt("x"))).statusCode, 400);
  h = routeur();
  empreintesVides();
  let r = await commander(h, K.bLive, [[A, 5], [F, 2], [B, 1]]);
  const o1 = corpsDe(r).id;
  await fond(evt(api(o1).id));
  eq("délai pas écoulé : rien n'est envoyé", [api(o1).etat, taches(o1).length], ["recue", 0]);
  await cron();
  eq("passage planifié avant la fin du délai : rien", [lances.length, taches(o1).length], [0, 0]);
  avancer(10 * 60 + 1);
  await Promise.all([cron(), cron()]);
  eq("deux passages qui se croisent : UNE seule mise en file", [taches(o1).length, lances.filter(x => x === api(o1).id).length], [1, 2]);
  const t1 = taches(o1)[0];
  eq("tâche du relais : CIP de la fiche, référence = numéro, 3 lignes aux prix du serveur", [t1.cip, t1.ref, t1.etat, t1.corps[0].lignes.map(l => [l.CIP, l.quantiteCommandee, l.prix])],
    ["2222222", o1, "a_envoyer", site(o1).items.map(i => [i.cip, i.qty, i.pn])]);
  eq("api_commandes : envoyée", [api(o1).etat, /en file \(réf\. /.test(api(o1).envoi_resultat)], ["envoyee", true]);
  eq("stock affiché du site décrémenté (lignes mises en file)", db.tables.decrements.slice(-3).map(d => [d.cip, d.qty]).sort(), [[A, 5], [B, 1], [F, 2]]);
  r = await appel(h, "GET", `/commandes/${o1}`, { cle: K.bLive });
  eq("suivi : en transmission", corpsDe(r).etat, "en_transmission");
  const avant = lances.length;
  await cron();
  eq("passage suivant : plus rien à envoyer", [lances.length, taches(o1).length], [avant, 1]);
  // rupture à l'envoi (si_rupture « retirer ») : ligne retirée AVANT la mise en file
  empreintesVides();
  r = await commander(h, K.bLive, [[A, 4], [F, 3]]);
  const o2 = corpsDe(r).id;
  produitOdoo(4006).free_qty = 0;
  avancer(10 * 60 + 1);
  await cron();
  eq("rupture à l'envoi : F retirée, A mise en file", [site(o2).items.map(i => [i.cip, i.api_motif || null, !!i.handled_at]), taches(o2)[0]?.corps[0].lignes.map(l => l.CIP)],
    [[[A, null, false], [F, "rupture", true]], [A]]);
  r = await appel(h, "GET", `/commandes/${o2}`, { cle: K.bLive });
  eq("suivi : ligne en rupture", corpsDe(r).lignes.map(l => l.etat), ["acceptee", "rupture"]);
  // tout en rupture : rien envoyé, non servie
  empreintesVides();
  produitOdoo(4006).free_qty = 30;
  r = await commander(h, K.bLive, [[F, 2]]);
  const o3 = corpsDe(r).id;
  produitOdoo(4006).free_qty = 0;
  avancer(10 * 60 + 1);
  await cron();
  eq("tout en rupture : non servie, aucune tâche", [api(o3).etat, api(o3).motif, taches(o3).length], ["non_servie", "rupture", 0]);
  r = await appel(h, "GET", `/commandes/${o3}`, { cle: K.bLive });
  eq("suivi : non servie (rupture)", [corpsDe(r).etat, corpsDe(r).motif], ["non_servie", "rupture"]);
  // si_rupture « garder » : la ligne attend, Elixir l'enverra au retour du stock
  empreintesVides();
  produitOdoo(4006).free_qty = 30;
  r = await commander(h, K.bLive, [[A, 2], [F, 2]], { si_rupture: "garder" });
  const o4 = corpsDe(r).id;
  produitOdoo(4006).free_qty = 0;
  avancer(10 * 60 + 1);
  await cron();
  eq("garder : A en file, F en attente (non marquée), « à vérifier » précommande", [taches(o4)[0]?.corps[0].lignes.map(l => l.CIP), !!site(o4).items[1].handled_at, api(o4).etat, api(o4).motif],
    [[A], false, "a_verifier", "precommande"]);
  produitOdoo(4006).free_qty = 30;
  // synchronisée à la main par Elixir pendant le délai : rien n'est retiré ni renvoyé, l'état suit le relais
  empreintesVides();
  r = await commander(h, K.bLive, [[A, 2], [F, 2]]);
  const o4b = corpsDe(r).id;
  db.tables.kv_store.push({ key: `pmlr:tache:${o4b}`, value: JSON.stringify({ ref: o4b, orderId: o4b, etat: "a_envoyer", idx: [0, 1], creeA: iso() }), updated_at: iso() });
  produitOdoo(4006).free_qty = 0;
  avancer(10 * 60 + 1);
  await cron();
  eq("synchro manuelle pendant le délai : envoyée (prise en main), aucune ligne retirée, aucune autre tâche",
    [api(o4b).etat, /prise en main/.test(api(o4b).envoi_resultat), site(o4b).items.map(i => !!i.handled_at), taches(o4b).length], ["envoyee", true, [false, false], 1]);
  db.tables.kv_store = db.tables.kv_store.filter(k => k.key !== `pmlr:tache:${o4b}`);
  produitOdoo(4006).free_qty = 30;
  // stock tombé entre la vérification et la mise en file (« retirer ») : la ligne non envoyée n'est pas réécrite après la
  // mise en file (le relais y pose ses marques) → « à vérifier » pour Elixir, avec un avis
  empreintesVides();
  r = await commander(h, K.bLive, [[A, 2], [F, 2]]);
  const o4c = corpsDe(r).id;
  db.tables.kv_store.push({ key: "pmlr:tache:1790000000777", value: JSON.stringify({ ref: "1790000000777", orderId: "1790000000777", etat: "a_envoyer", source: "site", creeA: iso(),
    corps: [{ lignes: [{ CIP: F, quantiteCommandee: 29 }] }] }), updated_at: iso() });
  avancer(10 * 60 + 1);
  const avisAvant = db.tables.ec_notifications.length;
  await creerFondEnvoi({ stock, odoo: faux.odoo, maintenant, journal: silence, enVolRelais: async () => new Map() })(evt(api(o4c).id));
  eq("stock tombé entre-temps : A en file, F non envoyée et non marquée, « à vérifier » (rupture_envoi), avis",
    [taches(o4c)[0]?.corps[0].lignes.map(l => l.CIP), !!site(o4c).items[1].handled_at, api(o4c).etat, api(o4c).motif, db.tables.ec_notifications.length - avisAvant],
    [[A], false, "a_verifier", "rupture_envoi", 1]);
  db.tables.kv_store = db.tables.kv_store.filter(k => k.key !== "pmlr:tache:1790000000777");
  // intégrité : commande du site modifiée depuis l'acceptation (quantité, ligne ajoutée, autre pharmacie) → rien ne part
  for (const [quoi, modifier] of [["quantité", (o) => { o.items[0].qty = 50; }], ["ligne ajoutée", (o) => { o.items.push({ cip: B, qty: 1, pn: 1, ligne_api: 9 }); }],
    ["autre pharmacie", (o) => { o.pharmacy_cip = "9999999"; }]]) {
    empreintesVides();
    r = await commander(h, K.bLive, [[A, 2], [F, 1]]);
    const om = corpsDe(r).id;
    modifier(site(om));
    avancer(10 * 60 + 1);
    await cron();
    eq(`commande modifiée (${quoi}) : « à vérifier », aucune tâche`, [api(om).etat, api(om).motif, taches(om).length], ["a_verifier", "commande_modifiee", 0]);
  }
  // fiche Odoo muette à l'envoi : CIP noté sur l'accès (la commande part)
  empreintesVides();
  r = await commander(h, K.bLive, [[A, 2], [B, 1]]);
  const of = corpsDe(r).id;
  avancer(10 * 60 + 1);
  await creerFondEnvoi({ stock, odoo: faux.odoo, maintenant, journal: silence, verifierFiche: async () => { throw new Error("Odoo muet"); } })(evt(api(of).id));
  eq("fiche illisible à l'envoi : CIP de l'accès, mise en file", [api(of).etat, taches(of).length], ["envoyee", 1]);
  // envoi automatique du relais coupé : à la main
  empreintesVides();
  kvConfig(false);
  r = await commander(h, K.bLive, [[A, 1], [B, 1]]);
  const o5 = corpsDe(r).id;
  avancer(10 * 60 + 1);
  await cron();
  eq("relais en envoi manuel : « à vérifier », aucune tâche, avis à Elixir", [api(o5).etat, api(o5).motif, taches(o5).length, /à vérifier/.test(db.tables.ec_notifications.at(-1).title)],
    ["a_verifier", "envoi_manuel", 0, true]);
  kvConfig(true);
  // interrupteur refermé après l'acceptation : rien ne part
  empreintesVides();
  r = await commander(h, K.bLive, [[A, 2], [B, 1]]);
  const o6 = corpsDe(r).id;
  reglages({ actif: true, commandes_live: false, prerequis: TOUS() });
  avancer(10 * 60 + 1);
  await cron();
  eq("commandes par API refermées : rien ne part (envoi suspendu)", [api(o6).etat, api(o6).motif, taches(o6).length], ["a_verifier", "envoi_suspendu", 0]);
  reglages({ actif: true, commandes_live: true, prerequis: TOUS() });
  // retard de plus de 30 min (horloge du relais) : envoi manqué
  empreintesVides();
  h = routeur();
  r = await commander(h, K.bLive, [[A, 3], [B, 1]]);
  const o7 = corpsDe(r).id;
  site(o7).date = new Date(Date.now() - 40 * 60e3).toISOString();
  avancer(10 * 60 + 1);
  await cron();
  eq("commande de plus de 30 min : envoi manqué, à la main", [api(o7).etat, api(o7).motif, taches(o7).length], ["a_verifier", "envoi_manque", 0]);
  // jamais envoyées : gardée à vérifier, annulée, de test
  eq("gardées, annulées, de test : jamais mises en file", [taches(gardee.id).length, taches(principale.id).length, db.tables.kv_store.filter(k => /^pmlr:tache:T/.test(k.key)).length], [0, 0, 0]);
  // réservations et envois en suspens
  const vieux = iso(T - 11 * 60e3);
  db.tables.api_commandes.push(
    { id: "11111111-1111-4111-8111-111111111111", odoo_id: 200, cle_id: "k", test: false, idempotency_key: "suspens-0001", empreinte_requete: "x", etat: "en_cours", order_id: null, recu_le: vieux, updated_at: vieux },
    { id: "22222222-2222-4222-8222-222222222222", odoo_id: 200, cle_id: "k", test: false, idempotency_key: "suspens-0002", empreinte_requete: "x", etat: "envoi_demande", order_id: "1790000000100", recu_le: vieux, updated_at: iso(T - 21 * 60e3) },
    { id: "33333333-3333-4333-8333-333333333333", odoo_id: 100, cle_id: "k", test: true, idempotency_key: "suspens-0003", empreinte_requete: "x", etat: "en_cours", order_id: "T1790000000200",
      reponse: JSON.stringify({ id: "T1790000000200", etat: "recue", annulable_jusqu_a: isoParis(T - 60e3), lignes: [] }), recu_le: vieux, updated_at: vieux },
    { id: "44444444-4444-4444-8444-444444444444", odoo_id: 200, cle_id: "k", test: false, idempotency_key: "suspens-0004", empreinte_requete: "x", etat: "en_cours", order_id: "1790000000300",
      reponse: JSON.stringify({ id: "1790000000300", etat: "recue", lignes: [] }), recu_le: vieux, updated_at: vieux },
    { id: "55555555-5555-4555-8555-555555555555", odoo_id: 200, cle_id: "k", test: false, idempotency_key: "suspens-0005", empreinte_requete: "x", etat: "en_cours", order_id: "1790000000400",
      reponse: JSON.stringify({ id: "1790000000400", etat: "recue", lignes: [] }), recu_le: vieux, updated_at: vieux });
  db.tables.elixir_orders.push({ id: 1790000000300, date: vieux, pharmacy_cip: "2222222", pharmacy_email: null, source: "api", processed: false, items: [] });
  await cron();
  const par = (k) => db.tables.api_commandes.find(z => z.idempotency_key === k);
  eq("suspens : réservation vide supprimée", par("suspens-0001"), undefined);
  eq("suspens : envoi interrompu → à vérifier", [par("suspens-0002").etat, par("suspens-0002").motif], ["a_verifier", "envoi_a_verifier"]);
  eq("suspens : commande de test préparée → terminée", [par("suspens-0003").etat, par("suspens-0003").statut_http], ["recue", 201]);
  eq("suspens : commande enregistrée → à vérifier (reprise)", [par("suspens-0004").etat, par("suspens-0004").motif, par("suspens-0004").statut_http], ["a_verifier", "reprise", 201]);
  eq("suspens : préparée mais jamais enregistrée → supprimée", par("suspens-0005"), undefined);
}

// ═══ 12. Admin ═══
{
  const admin = creerAdmin({ stock, maintenant, journal: silence, verifierAdmin: async () => ({ admin: { email: "admin@elixir.test" } }), verifierFiche: (id) => ficheVerifiee(id, { odoo: faux.odoo }),
    listePrix: async () => 15, lancerPrix: async () => null });
  const appelAdmin = (corps, methode = "POST", query = null) => admin({ httpMethod: methode, headers: { host: "elixir-commande.expepharma.com", authorization: "Bearer x" }, queryStringParameters: query,
    body: corps ? JSON.stringify(corps) : undefined });
  let r = await appelAdmin(null, "GET", { vue: "commandes" });
  const liste = JSON.parse(r.body).commandes;
  const p = liste.find(c => c.numero === principale.id);
  eq("admin : commandes (pharmacie, référence, commentaire, lignes acceptées / demandées)", [p.pharmacie, p.reference_client, p.commentaire, p.lignes_acceptees, p.lignes_demandees, p.environnement],
    ["PHARMACIE B", "REASSORT-B-1", "Livraison avant jeudi", 3, 7, "live"]);
  vrai("admin : commandes de test comprises, jamais de corps brut", liste.some(c => c.environnement === "test") && !/"demande"|"reponse"|empreinte/.test(r.body));
  r = await appelAdmin(null, "GET", { vue: "commandes_etat", ids: `${gardee.id},${principale.id},1790000000999,abc` });
  const etats = JSON.parse(r.body).etats;
  eq("admin : états pour l'onglet Commandes (numéros réels seulement)", Object.keys(etats).sort(), [gardee.id, principale.id].sort());
  vrai("…clé (libellé + préfixe), sans secret", /Outil 200 live \(elx_live_/.test(etats[principale.id].cle) && !/elx_live_[0-9A-Za-z]{40}/.test(r.body));
  const base = (await stock.reglages.lire()).updated_at;
  r = await appelAdmin({ action: "reglages", cips_exclus: `${A}\n${F}`, base });
  eq("admin : produits exclus enregistrés", [r.statusCode, conf.fusionnerReglages((await stock.reglages.lire()).valeur).cips_exclus], [200, [A, F]]);
  r = await simuler(routeur(), K.bLive, [[A, 1], ["3400000000073", 1], [B, 1]]);
  eq("produit exclu (CIP ou code-barres) → refusé", corpsDe(r).lignes.map(l => l.motif), ["produit_non_commandable", "produit_non_commandable", null]);
  r = await appelAdmin({ action: "reglages", cips_exclus: "3400 abc", base: (await stock.reglages.lire()).updated_at });
  eq("admin : CIP illisible → 400", r.statusCode, 400);
  await appelAdmin({ action: "reglages", cips_exclus: [], base: (await stock.reglages.lire()).updated_at });
}

// ═══ 12 bis. Offres du site hors V1 ; même produit par son CIP et son code-barres ═══
{
  // produits fictifs : un fauteuil livré sous un nouveau CIP (correspondance de l'accueil), un produit U-Labs, un produit
  // d'une campagne active, un produit d'une campagne terminée (commandable)
  const FAUT = "3400000000097", ULABS = "3400000000103", CAMP = "3400000000110", FINIE = "3400000000127";
  db.tables.odoo_catalog.push(...[FAUT, ULABS, CAMP, FINIE].map((cip, i) => ({ cip, barcode: cip, name: `PRODUIT EXEMPLE H${i}`, in_stock: true, available: 10, updated_at: iso() })));
  db.tables.kv_store.push({ key: "accueil:outils", value: JSON.stringify({ at: iso(), fauteuils: { BR1538207: [FAUT] } }), updated_at: iso() });
  db.tables.elixir_campaigns.push({ id: "campagne_exemple", active: true }, { id: "campagne_finie", active: false });
  db.tables.elixir_products.push({ cip: ULABS, section: "ulabs" }, { cip: CAMP, section: "campagne_exemple" }, { cip: FINIE, section: "campagne_finie" });
  let r = await simuler(routeur(), K.bLive, [[FAUT, 1], [ULABS, 1], [CAMP, 1], [FINIE, 1], [A, 1]]);
  const l = corpsDe(r).lignes;
  eq("hors API : multi-CIP, U-Labs, campagne active refusés ; campagne terminée et produit ordinaire passent l'exclusion",
    l.map(x => x.motif), ["produit_non_commandable", "produit_non_commandable", "produit_non_commandable", "prix_indisponible", null]);
  vrai("…détails : « à commander sur le site »", /plusieurs références/.test(l[0].detail) && /campagne/.test(l[1].detail) && /campagne/.test(l[2].detail));
  const n = db.tables.api_commandes.length;
  r = await commander(routeur(), K.bLive, [[FAUT, 1]]);
  eq("commande d'un seul produit hors API → 422 aucune_ligne_acceptee, réponse enregistrée (rejouable)", [r.statusCode, corpsDe(r).code, db.tables.api_commandes.length - n], [422, "aucune_ligne_acceptee", 1]);
  // exclusions illisibles (base muette sur les campagnes) : jamais « commandable » par défaut
  const lireVrai = stock.sbLecture;
  stock.sbLecture = async (chemin) => { if (/^elixir_campaigns/.test(chemin)) throw new Error("base muette"); return lireVrai(chemin); };
  r = await commander(routeur(), K.bLive, [[A, 1]]);
  stock.sbLecture = lireVrai;
  eq("campagnes illisibles → 503 indisponible, rien d'enregistré", [r.statusCode, corpsDe(r).code, db.tables.api_commandes.filter(z => z.etat === "en_cours").length], [503, "indisponible", 0]);
  // un même produit par son CIP et son code-barres : une ligne par produit
  r = await commander(routeur(), K.bLive, [[F, 1], ["3400000000073", 2]]);
  eq("même produit (CIP + code-barres) → 422 requete_invalide sur la 2e ligne, rien d'enregistré", [r.statusCode, corpsDe(r).code, corpsDe(r).erreurs?.map(e => e.champ),
    db.tables.api_commandes.filter(z => z.etat === "en_cours").length], [422, "requete_invalide", ["lignes[1].cip"], 0]);
  db.tables.kv_store = db.tables.kv_store.filter(k => k.key !== "accueil:outils");
  db.tables.elixir_campaigns = [];
  db.tables.elixir_products = [];
}

// ═══ 13. Rien d'interne ne sort ; écritures bornées ═══
{
  const tout = textes.join("\n");
  for (const [motif, quoi] of [[/@/, "adresse e-mail"], [/pmlr|relais/i, "relais"], [/odoo|supabase|pharmaml|infosoft/i, "plomberie interne"], [/pharmacy_email|entered_by|"csv"|empreinte_requete|"idempotency_key"|"demande"|cle_id/, "champs internes"],
    [/liste_prix|Liste 15|"liste"/, "liste de prix"], [/purchase_price|free_qty|"available"/, "stock exact ou prix d'achat"]]) {
    vrai(`réponses : jamais ${quoi}`, !motif.test(tout));
  }
  vrai("réponses : aucune clé", !/elx_(live|test)_[0-9A-Za-z]{40}/.test(tout));
  const tables = new Set(db.appels.filter(a => a.methode !== "GET").map(a => a.table));
  eq("écritures : tables api_*, commandes du site, notifications, stock affiché et file du relais seulement",
    [...tables].filter(t => !(t.startsWith("api_") || t.startsWith("rpc/api_") || ["elixir_orders", "ec_notifications", "rpc/decrement_stock", "kv_store"].includes(t))), []);
  vrai("aucune requête Supabase sans la clé serveur", db.etat.refusees === 0);
  vrai("aucune écriture Odoo", !faux.etat.appels.some(a => ["create", "write", "unlink"].includes(a.method)));
  vrai("journal : gabarits, jamais un numéro", db.tables.api_journal.every(l => !/\d{7,}/.test(l.route)));
  vrai("journal : routes de commande notées", ["/v1/commandes", "/v1/commandes/simulation", "/v1/commandes/{id}"].every(g => db.tables.api_journal.some(l => l.route === g)));
}

// ═══ 14. order-save et le chemin du site inchangés ═══
{
  const git = (...a) => { try { return execFileSync("git", a, { cwd: APP, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 }); } catch { return null; } };
  const ref = git("rev-parse", "--verify", `${BASE}^{commit}`);
  if (!ref) console.log(`· ${BASE} absent de git : comparaisons avec la production sautées`);
  else {
    for (const f of ["order-save.js", "submit-order.js", "pml-relais.js", "quota-status.js", "_quota.js", "order-update.js", "order-list.js"]) {
      eq(`${f} : identique à la production (${BASE})`, git("diff", "--name-only", BASE, "--", `netlify/functions/${f}`)?.trim(), "");
    }
    const d = (git("diff", "-U0", BASE, "--", "netlify/functions/_relais.js") || "").split("\n").filter(l => /^[+-][^+-]/.test(l));
    eq("_relais.js : deux lignes AJOUTÉES (commentaire + source « api » par user.api), aucune retirée", [d.filter(l => l.startsWith("-")).length, d.filter(l => l.startsWith("+")).length,
      d.some(l => /o\.source === "api" && user\?\.api === true/.test(l))], [0, 2, true]);
  }
  // order-save : toujours le même comportement (sans jeton → 401, rien d'écrit)
  const n = db.appels.length;
  const { handler: orderSave } = await import("../netlify/functions/order-save.js");
  const r = await orderSave({ httpMethod: "POST", headers: { host: "elixir-commande.expepharma.com", "x-elixir-session": "1" }, body: JSON.stringify({ items: [{ cip: A, qty: 1 }] }) });
  eq("order-save sans jeton : 401, rien d'écrit", [r.statusCode, db.appels.slice(n).filter(a => a.methode !== "GET").length], [401, 0]);
  const sql = readFileSync(join(APP, "sql/api-schema.sql"), "utf8");
  vrai("SQL : colonne test_parcours (rejouable)", /alter table api_acces add column if not exists test_parcours text;/.test(sql));
  const toml = readFileSync(join(APP, "netlify.toml"), "utf8");
  vrai("netlify.toml : api-commandes-cron toutes les 2 min", /\[functions\."api-commandes-cron"\]\s+schedule = "\*\/2 \* \* \* \*"/.test(toml));
  const zones = readFileSync(join(APP, "scripts/verifie-zones.mjs"), "utf8");
  vrai("zones : api-commandes-cron et api-envoi-background admises", /api-\(commandes-cron\|envoi-background\)/.test(zones));
  const panneau = readFileSync(join(APP, "src/AdminPanel.jsx"), "utf8");
  vrai("onglet Commandes : badge 🔌 API, commandes API hors « Sync toutes »", /o\.source === "api" && <BadgeApi/.test(panneau) && /o\.source !== "api" && !\(o\.items/.test(panneau));
  for (const f of ["_api-commande.js", "_api-parcours.js", "api-envoi-background.js", "api-commandes-cron.js"]) {
    const src = readFileSync(join(APP, "netlify/functions", f), "utf8");
    vrai(`${f} : aucune écriture Odoo écrite en dur, aucun appel PharmaML`, !/["'](create|write|unlink)["']\s*,\s*\[/.test(src) && !/commandes\.php|pharmaml\.|infosoft/i.test(src));
    vrai(`${f} : aucun CIP réel ni clé`, !/\b34009\d{8}\b/.test(src) && !/elx_(live|test)_[0-9A-Za-z]{40}/.test(src));
  }
}
// ═══ 15. Débits par clé : simulation (10/min) et commande (6/min) ═══
Object.assign(conf.LIMITES, LIM);
{
  h = routeur();
  avancer(60 - (Math.floor(T / 1000) % 60));
  const statuts = [];
  for (let i = 0; i < 11; i++) statuts.push((await simuler(h, K.bLive, [[A, 1]])).statusCode);
  eq("simulation : 10 par minute, la 11e → 429", [statuts.slice(0, 10).every(x => x === 200), statuts[10]], [true, 429]);
  avancer(60);
  await modifierAcces(200, { plafond_commandes_jour: 200 });
  const c = [];
  for (let i = 0; i < 7; i++) c.push((await commander(h, K.bTest, [[A, 1]])).statusCode);
  eq("commande : 6 par minute, la 7e → 429 (rien d'écrit)", [c.slice(0, 6).every(x => x === 201), c[6]], [true, 429]);
}

console.log(`\nAPI des pharmacies (commandes) : ${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
