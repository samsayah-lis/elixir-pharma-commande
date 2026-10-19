// Tests du lot 0 (sécurité de l'existant, avant l'Assistant Elixir) : node scripts/test-lot0.mjs
// Hors ligne : fetch simulé (Supabase Auth, tables, Odoo), aucune donnée réelle lue ni écrite.
//  • order-list : sans jeton → 401 ; jeton pharmacie sans CIP → 403 ; une pharmacie ne voit que SON CIP
//    (?pharmacy_cip= et ?source= n'élargissent plus rien) ; l'admin garde tout (liste, saisie pour une pharmacie, ?source=) ;
//  • restock-alert : alertes (GET, POST, DELETE) sur jeton, au CIP et à l'e-mail du jeton ; admin inchangé ; remises publiques ;
//  • pharmacy-lookup : rien en mode code (OTP) ni si le mode est illisible ; ancien mode : champs réduits ; limite par IP (429).
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ODOO_URL = "https://odoo.test";
process.env.ODOO_APIKEY = "";
process.env.ADMIN_EMAIL = "admin@elixir.test";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── Données fictives ──
const CIP_A = "2000001", CIP_B = "2000002";
const JETONS = {
  "jeton-a": { id: "u-a", email: "compte@pharmacie-a.test" },
  "jeton-sans-cip": { id: "u-c", email: "compte@pharmacie-c.test" },
  "jeton-cip-zero": { id: "u-z", email: "compte@pharmacie-z.test" },
  "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", app_metadata: { role: "admin" } },
};
const CIP_DU_COMPTE = { "compte@pharmacie-a.test": CIP_A, "compte@pharmacie-c.test": null, "compte@pharmacie-z.test": "0" };
const COMMANDES = [
  { id: 101, date: "2026-10-10", pharmacy_name: "Pharmacie A", pharmacy_email: "compte@pharmacie-a.test", pharmacy_cip: CIP_A, items: [{ cip: "3400000000011", qty: 2 }], source: "catalogue" },
  { id: 102, date: "2026-10-09", pharmacy_name: "Pharmacie A", pharmacy_email: "compte@pharmacie-a.test", pharmacy_cip: CIP_A, items: [{ cip: "3400000000028", qty: 6 }], source: "ulabs" },
  { id: 103, date: "2026-10-08", pharmacy_name: "Pharmacie A", pharmacy_email: "compte@pharmacie-a.test", pharmacy_cip: CIP_A, items: [{ cip: "3400000000035", qty: 1 }], source: "justificatif" },
  { id: 201, date: "2026-10-07", pharmacy_name: "Pharmacie B", pharmacy_email: "compte@pharmacie-b.test", pharmacy_cip: CIP_B, items: [{ cip: "3400000000042", qty: 3 }], source: "catalogue" },
  { id: 202, date: "2026-10-06", pharmacy_name: "Pharmacie B", pharmacy_email: "compte@pharmacie-b.test", pharmacy_cip: CIP_B, items: [{ cip: "3400000000059", qty: 12 }], source: "ulabs" },
];
const DEMANDE_LABO = { id: "dem-1", orderId: "103", lab: "takeda", statut: "transmise", envoyeLe: "2026-10-08", poNom: "P00042", motif: "note interne" };
const ALERTES = [
  { pharmacy_cip: CIP_A, cip: "3400000000066", pharmacy_email: "compte@pharmacie-a.test" },
  { pharmacy_cip: CIP_B, cip: "3400000000066", pharmacy_email: "compte@pharmacie-b.test" },
  { pharmacy_cip: CIP_B, cip: "3400000000073", pharmacy_email: "compte@pharmacie-b.test" },
];
const CACHE_PHARMACIES = {
  "compte@pharmacie-a.test": { email: "compte@pharmacie-a.test", name: "Pharmacie A", cip: CIP_A, street: "1 rue d'essai", cp: "75001", ville: "Paris", tel: "0100000000", odoo_id: 11 },
};
let modeConnexion = { statut: 200, rows: [{ value: "otp" }] };
let odooTrouve = null;   // fiche Odoo renvoyée par res.partner search_read (null = aucune)

// ── fetch simulé : toute adresse inconnue échoue (aucun appel réel possible) ──
let appels = [];
const params = (url) => Object.fromEntries(new URL(url).searchParams);
const filtreEq = (rows, q) => rows.filter(r => Object.entries(q).every(([k, v]) => !String(v).startsWith("eq.") || String(r[k]) === String(v).slice(3)));
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const methode = opts.method || "GET";
  appels.push({ url, methode, corps: opts.body || null });
  const rep = (corps, status = 200) => new Response(status === 204 ? null : JSON.stringify(corps), { status });
  if (url.startsWith("https://supabase.test/auth/v1/user")) {
    const t = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return JETONS[t] ? rep(JETONS[t]) : rep({ msg: "jeton invalide" }, 401);
  }
  if (url.startsWith("https://supabase.test/rest/v1/elixir_pharmacies")) {
    const q = params(url);
    const email = String(q.email || "").replace(/^eq\./, "");
    if (methode === "POST") return rep(null, 201);
    if (q.select === "cip") return rep(email in CIP_DU_COMPTE ? [{ cip: CIP_DU_COMPTE[email] }] : []);
    return rep(CACHE_PHARMACIES[email] ? [CACHE_PHARMACIES[email]] : []);
  }
  if (url.startsWith("https://supabase.test/rest/v1/elixir_orders")) return rep(filtreEq(COMMANDES, params(url)));
  if (url.startsWith("https://supabase.test/rest/v1/kv_store")) {
    const q = params(url);
    if (q.or?.includes("lj:req:s-103-")) return rep([{ key: "lj:req:s-103-takeda", value: JSON.stringify(DEMANDE_LABO) }]);
    if (q.key?.includes("lj:suivi:dem-1")) return rep([{ key: "lj:suivi:dem-1", value: { etape: "transmise" } }]);
    return rep([]);
  }
  if (url.startsWith("https://supabase.test/rest/v1/restock_alerts")) {
    if (methode === "POST") return rep(null, 201);
    if (methode === "DELETE") return rep(null, 204);
    return rep(filtreEq(ALERTES, params(url)));
  }
  if (url.startsWith("https://supabase.test/rest/v1/expiry_discounts")) return methode === "POST" ? rep(null, 201) : rep([{ cip: "3400000000080", discount_pct: 30 }]);
  if (url.startsWith("https://supabase.test/rest/v1/ec_config")) return rep(modeConnexion.rows, modeConnexion.statut);
  if (url === "https://odoo.test/jsonrpc") {
    const p = JSON.parse(opts.body).params;
    if (p.service === "common") return rep({ result: 7 });
    const [, , , model, method] = p.args;
    if (model === "res.partner" && method === "search_read") return rep({ result: odooTrouve ? [odooTrouve] : [] });
    return rep({ error: { message: `appel Odoo inattendu : ${model}.${method}` } });
  }
  throw new Error(`appel réseau inattendu : ${methode} ${url}`);
};

const appelsVers = (morceau, methode) => appels.filter(a => a.url.includes(morceau) && (!methode || a.methode === methode));
const tab = (x) => Array.isArray(x) ? x : [];
const lit = (r) => { let corps; try { corps = JSON.parse(r.body); } catch { corps = r.body; } return { statut: r.statusCode, corps, entetes: r.headers || {} }; };
const ev = (methode, { jeton, q, corps, ip } = {}) => ({
  httpMethod: methode,
  headers: { origin: "https://elixir-commande.expepharma.com", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(ip ? { "x-nf-client-connection-ip": ip } : {}) },
  queryStringParameters: q || {},
  body: corps === undefined ? null : (typeof corps === "string" ? corps : JSON.stringify(corps)),
});

// ════════════════════════ order-list ════════════════════════
const { handler: orderList } = await import("../netlify/functions/order-list.js");
const liste = async (o) => { appels = []; return lit(await orderList(ev("GET", o))); };
const ids = (r) => tab(r.corps?.orders).map(o => o.id);

let r = await liste({ q: { pharmacy_cip: CIP_A } });
eq("order-list sans jeton, ?pharmacy_cip= → 401 reconnexion", [r.statut, r.corps.error], [401, "reconnexion"]);
eq("order-list sans jeton : aucune lecture des commandes", appelsVers("elixir_orders").length, 0);
eq("order-list 401 : CORS et no-store", [r.entetes["Access-Control-Allow-Origin"], r.entetes["Cache-Control"]], ["https://elixir-commande.expepharma.com", "no-store"]);
r = await liste({ q: { source: "ulabs" } });
eq("order-list sans jeton, ?source= → 401 (plus de commandes de toutes les pharmacies)", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
r = await liste({});
eq("order-list sans jeton ni paramètre → 401", r.statut, 401);
r = await liste({ jeton: "jeton-expire", q: { pharmacy_cip: CIP_A } });
eq("order-list jeton invalide ou expiré + ?pharmacy_cip= → 401 (plus de repli sur le CIP de la requête)", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
r = await liste({ jeton: "jeton-sans-cip", q: { pharmacy_cip: CIP_A } });
eq("order-list jeton pharmacie sans CIP + ?pharmacy_cip= → 403 fiche", [r.statut, r.corps.error, appelsVers("elixir_orders").length], [403, "fiche", 0]);
r = await liste({ jeton: "jeton-cip-zero" });
eq("order-list jeton pharmacie au CIP « 0 » → 403", r.statut, 403);

r = await liste({ jeton: "jeton-a" });
eq("order-list pharmacie A : ses commandes", [r.statut, ids(r)], [200, [101, 102, 103]]);
r = await liste({ jeton: "jeton-a", q: { pharmacy_cip: CIP_B } });
eq("order-list pharmacie A + ?pharmacy_cip=B → toujours A seule", ids(r), [101, 102, 103]);
eq("order-list pharmacie A : filtre Supabase sur le CIP du jeton seulement", appelsVers("elixir_orders").map(a => params(a.url).pharmacy_cip), [`eq.${CIP_A}`]);
r = await liste({ jeton: "jeton-a", q: { source: "ulabs" } });
eq("order-list pharmacie A + ?source=ulabs → ses commandes de la campagne seulement", ids(r), [102]);
eq("order-list pharmacie A + ?source= : forme lue par la barre de campagne (source, items[].cip)", [r.corps.orders?.[0]?.source, r.corps.orders?.[0]?.items?.[0]?.cip], ["ulabs", "3400000000028"]);
r = await liste({ jeton: "jeton-a", q: { source: "ulabs", pharmacy_cip: CIP_B } });
eq("order-list pharmacie A + ?source= + ?pharmacy_cip=B → rien de B", ids(r), [102]);
r = await liste({ jeton: "jeton-a" });
const cmdJustif = tab(r.corps.orders).find(o => o.id === 103);
eq("order-list pharmacie : suivi labo présent, champs internes absents", [typeof cmdJustif?.justif?.[0]?.suivi?.etape, "poNom" in (cmdJustif?.justif?.[0] || {}), "motif" in (cmdJustif?.justif?.[0] || {})], ["string", false, false]);
eq("order-list pharmacie : ni relais ni avis lus", [appelsVers("pmlr%3Atache").length + appelsVers("pmlr:tache").length, appelsVers("pmlr%3Aavis").length + appelsVers("pmlr:avis").length], [0, 0]);

r = await liste({ jeton: "jeton-admin" });
eq("order-list admin : toutes les commandes", [r.statut, ids(r)], [200, [101, 102, 103, 201, 202]]);
eq("order-list admin : champs internes du suivi labo", tab(r.corps.orders).find(o => o.id === 103)?.justif?.[0]?.poNom, "P00042");
r = await liste({ jeton: "jeton-admin", q: { pharmacy_cip: CIP_B } });
eq("order-list admin en saisie pour B (?pharmacy_cip=B)", ids(r), [201, 202]);
r = await liste({ jeton: "jeton-admin", q: { source: "ulabs" } });
eq("order-list admin ?source=ulabs : toutes pharmacies, détail complet", [ids(r), tab(r.corps.orders).map(o => o.pharmacyName)], [[102, 202], ["Pharmacie A", "Pharmacie B"]]);
// barre de progression d'une campagne : références validées de TOUTES les pharmacies, rien d'autre (constat de la relecture)
r = await liste({ q: { source: "ulabs", agrege: "1" } });
eq("order-list ?agrege=1 sans jeton → 401, aucune lecture", [r.statut, appelsVers("elixir_orders").length], [401, 0]);
r = await liste({ jeton: "jeton-a", q: { source: "ulabs", agrege: "1" } });
eq("order-list pharmacie A ?source=ulabs&agrege=1 : CIP distincts des commandes de toutes les pharmacies, seulement",
  [r.statut, [...r.corps.cips].sort(), Object.keys(r.corps)], [200, ["3400000000028", "3400000000059"], ["cips"]]);
eq("order-list agrégat : aucune donnée de pharmacie dans la réponse", /Pharmacie|pharmacie-|@/.test(JSON.stringify(r.corps)), false);
r = await liste({ jeton: "jeton-a", q: { source: "catalogue", agrege: "1" } });
eq("order-list agrégat hors campagne (catalogue) → 400, aucune lecture", [r.statut, appelsVers("elixir_orders").length], [400, 0]);
r = lit(await orderList(ev("OPTIONS")));
eq("order-list OPTIONS → 200", r.statut, 200);

// ════════════════════════ restock-alert ════════════════════════
const { handler: alerte } = await import("../netlify/functions/restock-alert.js");
const ra = async (methode, o) => { appels = []; return lit(await alerte(ev(methode, o))); };

r = await ra("GET", { q: { pharmacy_cip: CIP_B } });
eq("restock-alert GET sans jeton → 401, aucune lecture", [r.statut, r.corps.error, appelsVers("restock_alerts").length], [401, "reconnexion", 0]);
r = await ra("GET", { jeton: "jeton-sans-cip", q: { pharmacy_cip: CIP_B } });
eq("restock-alert GET jeton sans CIP → 403", [r.statut, r.corps.error, appelsVers("restock_alerts").length], [403, "fiche", 0]);
r = await ra("GET", { jeton: "jeton-a", q: { pharmacy_cip: CIP_B } });
eq("restock-alert GET pharmacie A + ?pharmacy_cip=B → alertes de A seulement", [r.statut, tab(r.corps).map(a => a.pharmacy_cip)], [200, [CIP_A]]);
r = await ra("GET", { jeton: "jeton-a" });
eq("restock-alert GET pharmacie A sans paramètre → ses alertes", tab(r.corps).map(a => a.cip), ["3400000000066"]);
r = await ra("GET", { jeton: "jeton-a", q: { cip: "3400000000066" } });
eq("restock-alert GET ?cip= (abonnés d'un produit) par une pharmacie → 403", [r.statut, appelsVers("restock_alerts").length], [403, 0]);
r = await ra("GET", { q: { cip: "3400000000066" } });
eq("restock-alert GET ?cip= sans jeton → 403 (admin requis, inchangé)", r.statut, 403);
r = await ra("GET", { jeton: "jeton-admin", q: { cip: "3400000000066" } });
eq("restock-alert GET ?cip= admin → abonnés", tab(r.corps).map(a => a.pharmacy_cip), [CIP_A, CIP_B]);
r = await ra("GET", { jeton: "jeton-admin", q: { pharmacy_cip: CIP_B } });
eq("restock-alert GET admin en saisie pour B", tab(r.corps).map(a => a.cip), ["3400000000066", "3400000000073"]);
r = await ra("GET", { jeton: "jeton-admin" });
eq("restock-alert GET admin sans pharmacy_cip → 400", r.statut, 400);
r = await ra("GET", { q: { action: "expiry_discounts" } });
eq("restock-alert remises péremption : publiques (catalogue)", [r.statut, r.corps], [200, [{ cip: "3400000000080", discount_pct: 30 }]]);

r = await ra("DELETE", { q: { pharmacy_cip: CIP_B, cip: "3400000000073" } });
eq("restock-alert DELETE sans jeton → 401, rien supprimé", [r.statut, appelsVers("restock_alerts", "DELETE").length], [401, 0]);
r = await ra("DELETE", { jeton: "jeton-sans-cip", q: { pharmacy_cip: CIP_B, cip: "3400000000073" } });
eq("restock-alert DELETE jeton sans CIP → 403, rien supprimé", [r.statut, appelsVers("restock_alerts", "DELETE").length], [403, 0]);
r = await ra("DELETE", { jeton: "jeton-a", q: { pharmacy_cip: CIP_B, cip: "3400000000066" } });
eq("restock-alert DELETE pharmacie A + ?pharmacy_cip=B → supprime chez A seulement", [r.statut, appelsVers("restock_alerts", "DELETE").map(a => [params(a.url).pharmacy_cip, params(a.url).cip])], [200, [[`eq.${CIP_A}`, "eq.3400000000066"]]]);
r = await ra("DELETE", { jeton: "jeton-a" });
eq("restock-alert DELETE sans cip → 400", r.statut, 400);
r = await ra("DELETE", { jeton: "jeton-admin", q: { pharmacy_cip: CIP_B, cip: "3400000000073" } });
eq("restock-alert DELETE admin pour B", appelsVers("restock_alerts", "DELETE").map(a => params(a.url).pharmacy_cip), [`eq.${CIP_B}`]);
r = await ra("DELETE", { jeton: "jeton-admin", q: { cip: "3400000000073" } });
eq("restock-alert DELETE admin sans pharmacy_cip → 400", [r.statut, appelsVers("restock_alerts", "DELETE").length], [400, 0]);

const abonnement = { pharmacy_cip: CIP_B, pharmacy_email: "autre@ailleurs.test", cip: "3400000000097", product_name: "Produit d'essai" };
r = await ra("POST", { corps: abonnement });
eq("restock-alert POST sans jeton → 401, rien écrit", [r.statut, appelsVers("restock_alerts", "POST").length], [401, 0]);
r = await ra("POST", { jeton: "jeton-sans-cip", corps: abonnement });
eq("restock-alert POST jeton sans CIP → 403, rien écrit", [r.statut, appelsVers("restock_alerts", "POST").length], [403, 0]);
r = await ra("POST", { jeton: "jeton-a", corps: abonnement });
const ecrit = JSON.parse(appelsVers("restock_alerts", "POST")[0]?.corps || "{}");
eq("restock-alert POST pharmacie A : CIP et e-mail du jeton (corps ignoré)", [r.statut, ecrit.pharmacy_cip, ecrit.pharmacy_email, ecrit.cip], [200, CIP_A, "compte@pharmacie-a.test", "3400000000097"]);
r = await ra("POST", { jeton: "jeton-a", corps: { product_name: "sans cip" } });
eq("restock-alert POST sans cip → 400", r.statut, 400);
r = await ra("POST", { jeton: "jeton-admin", corps: abonnement });
const ecritAdmin = JSON.parse(appelsVers("restock_alerts", "POST")[0]?.corps || "{}");
eq("restock-alert POST admin en saisie pour B : CIP et e-mail du corps", [r.statut, ecritAdmin.pharmacy_cip, ecritAdmin.pharmacy_email], [200, CIP_B, "autre@ailleurs.test"]);
r = await ra("POST", { jeton: "jeton-admin", corps: { cip: "3400000000097" } });
eq("restock-alert POST admin sans pharmacy_cip → 400", r.statut, 400);
r = await ra("POST", { jeton: "jeton-a", corps: { action: "set_expiry_discount", cip: "3400000000080", discount_pct: 50 } });
eq("restock-alert remise péremption par une pharmacie → 403, rien écrit", [r.statut, appelsVers("expiry_discounts", "POST").length], [403, 0]);
r = await ra("POST", { jeton: "jeton-admin", corps: { action: "set_expiry_discount", cip: "3400000000080", discount_pct: 50 } });
eq("restock-alert remise péremption par l'admin → 200", [r.statut, appelsVers("expiry_discounts", "POST").length], [200, 1]);
r = await ra("POST", { jeton: "jeton-a", corps: "{pas du json" });
eq("restock-alert POST JSON invalide → 400", r.statut, 400);

// ════════════════════════ pharmacy-lookup ════════════════════════
const { handler: recherche } = await import("../netlify/functions/pharmacy-lookup.js");
let ipSuivante = 1;
const pl = async (corps, ip = `10.0.0.${ipSuivante++}`) => { appels = []; return lit(await recherche(ev("POST", { corps, ip }))); };
const lectures = () => appelsVers("elixir_pharmacies").length + appelsVers("odoo.test").length;

modeConnexion = { statut: 200, rows: [{ value: "otp" }] };
r = await pl({ email: "compte@pharmacie-a.test" });
eq("pharmacy-lookup mode code : aucune identité", [r.statut, r.corps], [200, { found: false, otp: true }]);
eq("pharmacy-lookup mode code : ni cache ni Odoo lus", lectures(), 0);
eq("pharmacy-lookup : no-store", r.entetes["Cache-Control"], "no-store");
modeConnexion = { statut: 200, rows: [] };
r = await pl({ email: "compte@pharmacie-a.test" });
eq("pharmacy-lookup mode absent → fermé (code)", [r.corps, lectures()], [{ found: false, otp: true }, 0]);
modeConnexion = { statut: 500, rows: { message: "panne" } };
r = await pl({ email: "compte@pharmacie-a.test" });
eq("pharmacy-lookup mode illisible → fermé (code)", [r.corps, lectures()], [{ found: false, otp: true }, 0]);

modeConnexion = { statut: 200, rows: [{ value: "legacy" }] };
r = await pl({ email: "  Compte@Pharmacie-A.test " });
eq("pharmacy-lookup ancien mode, cache : champs réduits (ni rue ni téléphone)", [r.statut, r.corps],
  [200, { found: true, pharmacy: { name: "Pharmacie A", email: "compte@pharmacie-a.test", cip: CIP_A, cp: "75001", ville: "Paris" } }]);
odooTrouve = null;
r = await pl({ email: "inconnue@nulle-part.test" });
eq("pharmacy-lookup ancien mode, adresse inconnue → found:false", r.corps, { found: false });
odooTrouve = { id: 55, name: "Pharmacie D", email: "compte@pharmacie-d.test", cip: "2000004", ref: false, street: "4 rue d'essai", zip: "69001", city: "Lyon", phone: "0400000000",
  mobile: false, company_id: [2, "Elixir"], commercial_partner_id: [55, "Pharmacie D"], parent_id: false, active: true, customer_rank: 1, supplier_rank: 0 };
r = await pl({ email: "compte@pharmacie-d.test" });
eq("pharmacy-lookup ancien mode, fiche Odoo : champs réduits", r.corps, { found: true, pharmacy: { name: "Pharmacie D", email: "compte@pharmacie-d.test", cip: "2000004", cp: "69001", ville: "Lyon" } });
eq("pharmacy-lookup ancien mode, fiche Odoo : cache mis à jour (inchangé)", appelsVers("elixir_pharmacies", "POST").length, 1);
odooTrouve = null;

r = await pl({});
eq("pharmacy-lookup sans e-mail → 400", r.statut, 400);
r = await pl("{pas du json");
eq("pharmacy-lookup JSON invalide → 400", r.statut, 400);
r = lit(await recherche(ev("GET", { ip: "10.9.9.9" })));
eq("pharmacy-lookup GET → 405", r.statut, 405);

// limite par IP : 5 par minute, la 6e est refusée avant toute lecture
modeConnexion = { statut: 200, rows: [{ value: "legacy" }] };
const statuts = [];
for (let i = 0; i < 6; i++) statuts.push((await pl({ email: "compte@pharmacie-a.test" }, "10.1.1.1")).statut);
eq("pharmacy-lookup : 5 essais par minute et par IP, puis 429", statuts, [200, 200, 200, 200, 200, 429]);
r = await pl({ email: "compte@pharmacie-a.test" }, "10.1.1.1");
eq("pharmacy-lookup 429 : rien lu, CORS et Retry-After", [r.statut, lectures(), appelsVers("ec_config").length, r.entetes["Access-Control-Allow-Origin"], !!r.entetes["Retry-After"]],
  [429, 0, 0, "https://elixir-commande.expepharma.com", true]);
r = await pl({ email: "compte@pharmacie-a.test" }, "10.1.1.2");
eq("pharmacy-lookup : une autre IP n'est pas bloquée", r.statut, 200);

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);   // rate-limit.js garde un minuteur de nettoyage : sortie explicite
