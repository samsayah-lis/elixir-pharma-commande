// Tests : search-track après la bascule de SUPABASE_KEY sur une clé secrète — node scripts/test-search-track.mjs
// Hors ligne : VRAIE fonction netlify/functions/search-track.js sur un faux Supabase (PostgREST + /auth/v1/user) en mémoire ;
// aucune donnée réelle lue ni écrite.
//  1. GET (trending, zero_results, funnel, stats) : refusé sans jeton, avec un jeton refusé et avec un jeton de pharmacie
//     (403, aucune lecture de ec_search_patterns) ; Supabase Auth en panne → 503 ; admin → 200 avec les vraies données ;
//  2. POST : toujours public (Saisie, recherche globale), une ligne écrite, champs bornés (CIP, nombre de résultats),
//     requête trop courte ou corps invalide → rien d'écrit ;
//  3. OPTIONS, méthode inconnue.
process.env.SUPABASE_URL = "https://supabase.faux";
process.env.SUPABASE_KEY = "cle-secrete-de-test";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };

// ── faux Supabase ──
const ilYa = (j) => new Date(Date.now() - j * 86400000).toISOString();
let lignes = [];
let appels = [];          // { methode, chemin, apikey, bearer }
let authEnPanne = false;
const reponse = (corps, status = 200, entetes = {}) => new Response(corps === null ? null : JSON.stringify(corps), { status, headers: { "content-type": "application/json", ...entetes } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const h = opts.headers || {};
  appels.push({ methode: opts.method || "GET", chemin: u.pathname, apikey: h.apikey, bearer: h.Authorization });
  if (u.pathname === "/auth/v1/user") {
    if (authEnPanne) return reponse({ message: "upstream" }, 503);
    if (h.Authorization === "Bearer jeton-admin") return reponse({ id: "a1", email: "pharmacien@elixirpharma.fr" });
    if (h.Authorization === "Bearer jeton-pharmacie") return reponse({ id: "p1", email: "pharmacie@exemple.test" });
    return reponse({ code: 401, msg: "invalid JWT" }, 401);
  }
  if (u.pathname === "/rest/v1/elixir_pharmacies") return reponse([{ cip: "2000000000001" }]);
  if (u.pathname === "/rest/v1/rpc/ec_search_trending") return reponse({ code: "PGRST202", message: "introuvable" }, 404);
  if (u.pathname === "/rest/v1/ec_search_patterns") {
    if ((opts.method || "GET") === "POST") { lignes.push(JSON.parse(opts.body)); return reponse(null, 201); }
    const depuis = (u.searchParams.get("created_at") || "").replace(/^gte\./, "");
    let r = lignes.filter(l => !depuis || l.created_at >= depuis);
    if (u.searchParams.get("results_count") === "eq.0") r = r.filter(l => l.results_count === 0);
    const champs = (u.searchParams.get("select") || "").split(",").filter(Boolean);
    if (h.Prefer === "count=exact") return reponse([], 200, { "content-range": `0-0/${r.length}` });
    return reponse(r.map(l => Object.fromEntries(champs.map(c => [c, l[c]]))));
  }
  return reponse({ message: "inattendu " + u.pathname }, 500);
};

const { handler } = await import("../netlify/functions/search-track.js");
const evt = (methode, { params = {}, jeton, corps, ip = "198.51.100.7" } = {}) => ({
  httpMethod: methode, queryStringParameters: params, body: corps === undefined ? null : (typeof corps === "string" ? corps : JSON.stringify(corps)),
  headers: { origin: "https://elixir-commande.expepharma.com", "x-nf-client-connection-ip": ip, ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
});
const lus = () => appels.filter(a => a.chemin.startsWith("/rest/v1/ec_search_patterns") || a.chemin.startsWith("/rest/v1/rpc/"));
const corpsDe = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

const DONNEES = () => [
  { query: "doliprane", pharmacy_cip: "2000000000001", results_count: 12, clicked_cip: "3400935955838", added_to_cart: true, created_at: ilYa(1) },
  { query: "doliprane", pharmacy_cip: "2000000000002", results_count: 12, clicked_cip: null, added_to_cart: false, created_at: ilYa(2) },
  { query: "ninlaro", pharmacy_cip: "2000000000002", results_count: 0, clicked_cip: null, added_to_cart: false, created_at: ilYa(3) },
  { query: "vieille recherche", pharmacy_cip: "2000000000003", results_count: 0, clicked_cip: null, added_to_cart: false, created_at: ilYa(20) },
];
const GETS = [{ trending: "1" }, { zero_results: "1" }, { funnel: "1" }, { stats: "1" }];

// ── 1. GET : admin seulement ──
lignes = DONNEES();
for (const params of GETS) {
  const nom = Object.keys(params)[0];
  for (const [cas, jeton, attendu] of [["sans jeton", undefined, 403], ["jeton refusé", "jeton-bidon", 403], ["jeton de pharmacie", "jeton-pharmacie", 403]]) {
    appels = [];
    const r = await handler(evt("GET", { params, jeton }));
    eq(`GET ${nom} ${cas} : statut`, r.statusCode, attendu);
    eq(`GET ${nom} ${cas} : aucune lecture des recherches`, lus().length, 0);
    eq(`GET ${nom} ${cas} : pas de cache`, r.headers?.["Cache-Control"], "no-store");
    vrai(`GET ${nom} ${cas} : aucune donnée renvoyée`, !/doliprane|ninlaro|2000000000/.test(r.body || ""), r.body);
  }
  authEnPanne = true; appels = [];
  const rp = await handler(evt("GET", { params, jeton: "jeton-admin" }));
  authEnPanne = false;
  eq(`GET ${nom} Supabase Auth en panne : 503`, rp.statusCode, 503);
  eq(`GET ${nom} Supabase Auth en panne : aucune lecture`, lus().length, 0);
}
// la clé du serveur part bien dans apikey ET Bearer (comme avant), vers SUPABASE_URL seulement
appels = [];
let r = await handler(evt("GET", { params: { trending: "1" }, jeton: "jeton-admin" }));
eq("GET trending admin : 200", r.statusCode, 200);
eq("GET trending admin : classement (repli sans RPC, 7 jours)", corpsDe(r).trending.map(t => [t.query, t.count]), [["doliprane", 2], ["ninlaro", 1]]);
vrai("GET trending admin : clé du serveur en apikey et Bearer pour PostgREST", lus().every(a => a.apikey === "cle-secrete-de-test" && a.bearer === "Bearer cle-secrete-de-test"));
vrai("GET trending admin : jeton de l'admin envoyé à /auth/v1/user seulement", appels.filter(a => a.bearer === "Bearer jeton-admin").every(a => a.chemin === "/auth/v1/user"));
r = await handler(evt("GET", { params: { zero_results: "1" }, jeton: "jeton-admin" }));
eq("GET zero_results admin", corpsDe(r).zero_results, [{ query: "ninlaro", count: 1 }, { query: "vieille recherche", count: 1 }]);
r = await handler(evt("GET", { params: { funnel: "1" }, jeton: "jeton-admin" }));
eq("GET funnel admin : total et clics", [corpsDe(r).funnel.total_searches, corpsDe(r).funnel.clicked, corpsDe(r).funnel.added_to_cart], [4, 1, 1]);
r = await handler(evt("GET", { params: { stats: "1" }, jeton: "jeton-admin" }));
eq("GET stats admin", corpsDe(r).total, 4);
r = await handler(evt("GET", { params: {}, jeton: "jeton-admin" }));
eq("GET admin sans paramètre : 400", r.statusCode, 400);
r = await handler(evt("GET", { params: {} }));
eq("GET sans paramètre ni jeton : 403 (rien n'indique les paramètres)", r.statusCode, 403);

// ── 2. POST : public, champs bornés ──
lignes = []; appels = [];
r = await handler(evt("POST", { corps: { query: "  Doliprane 1000  ", pharmacy_cip: "2000000000001", results_count: 7, clicked_cip: "3400935955838", added_to_cart: true }, ip: "198.51.100.8" }));
eq("POST sans jeton : 200", r.statusCode, 200);
eq("POST : une ligne écrite", lignes, [{ query: "doliprane 1000", pharmacy_cip: "2000000000001", results_count: 7, clicked_cip: "3400935955838", added_to_cart: true }]);
eq("POST : pas d'appel à /auth/v1", appels.filter(a => a.chemin.startsWith("/auth/")).length, 0);
lignes = [];
await handler(evt("POST", { corps: { query: "x".repeat(300), pharmacy_cip: "9".repeat(5000), results_count: 1e12, clicked_cip: { a: 1 }, added_to_cart: "oui" }, ip: "198.51.100.9" }));
eq("POST : champs bornés", [lignes[0].query.length, lignes[0].pharmacy_cip.length, lignes[0].results_count, lignes[0].clicked_cip, lignes[0].added_to_cart], [100, 20, 100000, null, true]);
lignes = [];
await handler(evt("POST", { corps: { query: "ab", pharmacy_cip: "", results_count: -5, clicked_cip: null }, ip: "198.51.100.10" }));
eq("POST : CIP vide → null, nombre négatif → 0", [lignes[0].pharmacy_cip, lignes[0].clicked_cip, lignes[0].results_count], [null, null, 0]);
lignes = [];
r = await handler(evt("POST", { corps: { query: "a" }, ip: "198.51.100.11" }));
eq("POST requête d'un caractère : 200, rien d'écrit", [r.statusCode, lignes.length], [200, 0]);
r = await handler(evt("POST", { corps: { query: 12345 }, ip: "198.51.100.12" }));
eq("POST requête non textuelle : 200, rien d'écrit", [r.statusCode, lignes.length], [200, 0]);
r = await handler(evt("POST", { corps: "null", ip: "198.51.100.13" }));
eq("POST corps null : 200, rien d'écrit", [r.statusCode, lignes.length], [200, 0]);
r = await handler(evt("POST", { corps: "{pas du json", ip: "198.51.100.14" }));
eq("POST JSON invalide : 400", r.statusCode, 400);

// ── 3. divers ──
r = await handler(evt("OPTIONS"));
eq("OPTIONS : 200", r.statusCode, 200);
r = await handler(evt("DELETE", { jeton: "jeton-admin" }));
eq("DELETE : 405", r.statusCode, 405);

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
