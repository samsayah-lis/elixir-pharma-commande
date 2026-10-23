// ── Banc d'essai : API des pharmacies (onglet admin 🔌 API, « Accès API » de Mes commandes, /api/v1) ──
// VRAI code (netlify/functions/api-compte.js, api-admin.js, api-v1.js) sur un faux PostgREST en mémoire (scripts/api-faux.mjs),
// jusqu'au redémarrage du banc. Rien ne part vers Supabase ni Odoo :
//  • identité de la pharmacie : la pharmacie du banc (fiche fictive n° 999999), dès qu'un jeton est présenté ; saisie Elixir
//    « pour une pharmacie » (pour_odoo_id) : admin du banc, panneau en lecture seule, comme en ligne ;
//  • admin : tout jeton présenté (connexion fictive) ; fiches Odoo : la pharmacie du banc et deux fiches d'exemple ;
//  • /api/v1/* (règle de public/_redirects) : servi par le vrai routeur, avec les clés créées sur le banc.
// Accès de la pharmacie du banc ouvert d'avance (CGU à accepter), pour voir tout le parcours.
// Modules chargés à la première requête seulement : vite.config.js importe le plugin du banc à chaque « vite build », et
// rate-limit.js (importé par les fonctions) pose un minuteur qui empêcherait le build de se terminer.

const FICHE_BANC = { id: 999999, name: "PHARMACIE DU BANC D'ESSAI", city: "Banc-sur-Essai", cip: "9999999", company_id: [2, "Elixir"] };
const FICHES = { 999999: FICHE_BANC, 999998: { id: 999998, name: "PHARMACIE EXEMPLE", city: "Exempleville", cip: "9999998", company_id: false } };
let monde = null;

async function mondeApi() {
  if (monde) return monde;
  const [{ fauxPostgrestApi }, { creerStockApi }, { creerHandler: handlerCompte }, { creerHandler: handlerAdmin }, { creerHandler: handlerV1 }] = await Promise.all([
    import("../api-faux.mjs"), import("../../netlify/functions/_api-stock.js"), import("../../netlify/functions/api-compte.js"),
    import("../../netlify/functions/api-admin.js"), import("../../netlify/functions/api-v1.js")]);
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
  const pret = stock.acces.creer({ odoo_id: FICHE_BANC.id, nom: FICHE_BANC.name, cip: FICHE_BANC.cip, ville: FICHE_BANC.city, ouvert_par: "admin@banc.local", note: "banc d'essai" });
  monde = { db, pret,
    compte: handlerCompte({ stock, identifier, journal: () => {} }),
    admin: handlerAdmin({ stock, verifierAdmin, verifierFiche, listePrix: async () => 5, journal: () => {} }),
    v1: handlerV1({ stock, verifierFiche, log: () => {} }) };
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
