// ── Banc d'essai : API des pharmacies (onglet admin 🔌 API, « Accès API » de Mes commandes, /api/v1) ──
// VRAI code (netlify/functions/api-compte.js, api-admin.js, api-v1.js) sur un faux PostgREST en mémoire (scripts/api-faux.mjs),
// jusqu'au redémarrage du banc. Rien ne part vers Supabase ni Odoo :
//  • identité de la pharmacie : la pharmacie du banc (fiche fictive n° 999999), dès qu'un jeton est présenté ; saisie Elixir
//    « pour une pharmacie » (pour_odoo_id) : admin du banc, panneau en lecture seule, comme en ligne ;
//  • admin : tout jeton présenté (connexion fictive) ; fiches Odoo : la pharmacie du banc et deux fiches d'exemple ;
//  • /api/v1/* (règle de public/_redirects) : servi par le vrai routeur, avec les clés créées sur le banc ;
//  • phase 2 (lecture) : faux Odoo de scripts/api-odoo-faux.mjs (catalogue fictif, prix des listes au minimum des règles,
//    stock libre ; la pharmacie du banc n'a ni commande ni facture), contingents fictifs, prix de la liste n° 5 calculés au
//    démarrage par la vraie fonction d'arrière-plan ; « Recalculer » de l'admin la relance en mémoire.
// Accès de la pharmacie du banc ouvert d'avance (CGU à accepter), pour voir tout le parcours.
// Modules chargés à la première requête seulement : vite.config.js importe le plugin du banc à chaque « vite build », et
// rate-limit.js (importé par les fonctions) pose un minuteur qui empêcherait le build de se terminer.

const FICHE_BANC = { id: 999999, name: "PHARMACIE DU BANC D'ESSAI", city: "Banc-sur-Essai", cip: "9999999", company_id: [2, "Elixir"] };
// catalogue fictif du banc : [pid, CIP13, nom, prix de base, stock libre]
const CATALOGUE_BANC = [[4001, "3400000000011", "PRODUIT EXEMPLE A 30 CPR", 10, 50], [4002, "3400000000028", "PRODUIT EXEMPLE B", 6, 4],
  [4003, "3400000000035", "PRODUIT EXEMPLE C", 2.4, 0], [4005, "3400000000059", "PRODUIT EXEMPLE E (contingenté)", 600, 12]];
const FICHES = { 999999: FICHE_BANC, 999998: { id: 999998, name: "PHARMACIE EXEMPLE", city: "Exempleville", cip: "9999998", company_id: false } };
let monde = null;

async function mondeApi() {
  if (monde) return monde;
  const [{ fauxPostgrestApi }, { creerStockApi }, { creerHandler: handlerCompte }, { creerHandler: handlerAdmin }, { creerHandler: handlerV1 },
    { creerOdooApi }, { creerHandler: handlerPrix }] = await Promise.all([
    import("../api-faux.mjs"), import("../../netlify/functions/_api-stock.js"), import("../../netlify/functions/api-compte.js"),
    import("../../netlify/functions/api-admin.js"), import("../../netlify/functions/api-v1.js"), import("../api-odoo-faux.mjs"),
    import("../../netlify/functions/api-prix-background.js")]);
  if (monde) return monde;
  const db = fauxPostgrestApi({ cleService: "cle-service-banc" });
  const stock = creerStockApi({ fetch: db.fetch, url: "https://supabase.banc", cle: "cle-service-banc" });
  const verifierFiche = async (id) => FICHES[id] || null;
  const jeton = (event) => /^Bearer\s+\S+/i.test(event.headers?.authorization || "");
  const identifier = async (event, body) => {
    if (!jeton(event)) throw Object.assign(new Error("reconnexion"), { status: 401, code: "reconnexion", identite: true });
    if (body?.pour_odoo_id) {
      const p = FICHES[Number(body.pour_odoo_id)] || FICHE_BANC;
      return { odooId: p.id, cip: p.cip, nom: p.name, ville: p.city, mode: "complet", compteEmail: "admin@banc.local", admin: "admin@banc.local" };
    }
    return { odooId: FICHE_BANC.id, cip: FICHE_BANC.cip, nom: FICHE_BANC.name, ville: FICHE_BANC.city, mode: "complet", compteEmail: "pharmacie@banc.local", admin: null };
  };
  const verifierAdmin = async (event) => (jeton(event) ? { admin: { email: "admin@banc.local" } }
    : { error: { statusCode: 403, headers: {}, body: JSON.stringify({ error: "Accès admin requis" }) } });
  // faux Odoo (lectures de la phase 2) : fiches du banc, catalogue fictif, liste n° 5 (barème −4,5 %, palier à 6 sur B)
  const odoo = creerOdooApi({
    "res.partner": Object.values(FICHES).map(f => ({ ...f, parent_id: false, active: true, commercial_partner_id: [f.id, f.name], property_product_pricelist: [5, "Liste 5"], deny_quota: false })),
    "product.product": CATALOGUE_BANC.map(([id, cip, name, lp, libre]) => ({ id, default_code: cip, barcode: cip, name, list_price: lp, product_tmpl_id: [id + 1000, name],
      categ_id: [31, "C"], free_qty: libre, company_id: false })),
    "product.category": [{ id: 31, parent_id: false }], "product.pricelist": [{ id: 5 }],
    "product.pricelist.item": [
      { id: 1, pricelist_id: [5, "Liste 5"], applied_on: "3_global", compute_price: "percentage", percent_price: 4.5, min_quantity: 0, base: "list_price" },
      { id: 2, pricelist_id: [5, "Liste 5"], applied_on: "0_product_variant", product_id: [4002, "B"], compute_price: "fixed", fixed_price: 5.5, min_quantity: 6, base: "list_price" }],
  }, { jour: () => new Date().toISOString().slice(0, 10) });
  db.tables.odoo_catalog.push(...CATALOGUE_BANC.map(([pid, cip, name, lp, libre]) => ({ cip, barcode: cip, name, list_price: lp, odoo_pid: pid, odoo_tmpl_id: pid + 1000,
    categ_id: 31, in_stock: libre > 0, available: libre, updated_at: new Date().toISOString() })));
  const jour = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const quota = { cipsContingentes: async () => new Set(["3400000000059"]),
    resteContingents: async () => ({ exempt: false, today: jour, products: { "3400000000059": { name: "PRODUIT EXEMPLE E (contingenté)", quota: 6, period: "-1", days: 0,
      label: "6 par semaine", used: 2, used_odoo: 2, used_site: 0, remaining: 4, start: jour, end: null } } }) };
  const prix = handlerPrix({ autoriser: () => true, stock, odoo: odoo.odoo, journal: () => {} });
  const calculer = (id) => prix({ body: JSON.stringify({ liste_id: id }) });
  const pret = stock.acces.creer({ odoo_id: FICHE_BANC.id, nom: FICHE_BANC.name, cip: FICHE_BANC.cip, ville: FICHE_BANC.city, ouvert_par: "admin@banc.local", note: "banc d'essai",
    liste_prix_id: 5, liste_prix_lue_le: new Date().toISOString() }).then(() => calculer(5));
  monde = { db, pret,
    compte: handlerCompte({ stock, identifier, journal: () => {} }),
    admin: handlerAdmin({ stock, verifierAdmin, verifierFiche, listePrix: async () => 5, journal: () => {}, lancerPrix: async (base, id) => { setTimeout(() => calculer(id), 1500); return null; } }),
    v1: handlerV1({ stock, verifierFiche, odoo: odoo.odoo, quota, log: () => {} }) };
  return monde;
}

// fonction Netlify (api-compte, api-admin) ou /api/v1 → { statut, corps, entetes, source } | null (pas pour ce banc)
export async function repondreApi({ fn, methode, url, corps, entetes }) {
  if (!["api-compte", "api-admin", "api-v1"].includes(fn)) return null;
  const m = await mondeApi();
  await m.pret;
  const u = new URL(url, "http://banc.local");
  const event = { httpMethod: methode, path: u.pathname, headers: { host: "localhost", ...entetes, "x-nf-client-connection-ip": "127.0.0.1" },
    queryStringParameters: Object.fromEntries(u.searchParams), body: corps == null ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps) };
  const r = await m[fn === "api-compte" ? "compte" : fn === "api-admin" ? "admin" : "v1"](event);
  return { statut: r.statusCode, texte: r.body, entetes: r.headers || {}, source: `banc API (vrai code, mémoire)` };
}
