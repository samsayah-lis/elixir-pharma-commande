// Tests du laboratoire (Centrale OTC, docs/labo-otc.md) : node scripts/test-labo.mjs
// Hors ligne : fetch simulé (Supabase et Medipim), aucune donnée réelle lue ni écrite.
//  • medipim-lookup, mode lot (POST action « labos ») et fiche (GET) : choix du laboratoire, rapprochement des codes,
//    pages, erreurs ;
//  • products-upsert : colonne labo écrite seulement quand elle est envoyée, avant et après la migration SQL.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── fetch simulé ──
const org = (id, name) => ({ id, name: typeof name === "string" ? { fr: name } : name });
const FICHES = [
  { id: 1, status: "active", cip13: "3400926744588", organizations: [org(87, "Recordati"), org(2000, "Laboratoires Tonipharm")] },
  // dépositaire logistique écarté même avec un id plus petit (Lamisilate : Alloga France → Karo Healthcare)
  { id: 2, status: "active", cip13: "3400930158920", organizations: [org(5, "ALLOGA FRANCE"), org(900, "KARO HEALTHCARE AB")] },
  // EAN renvoyé avec un zéro de tête
  { id: 3, status: "active", ean: ["03574660115390"], organizations: [org(12, "  Bayer  ")] },
  // fiche retirée puis fiche active pour le même code : l'active l'emporte
  { id: 4, status: "replaced", acl13: "3401560000001", organizations: [org(3, "Ancien labo")] },
  { id: 5, status: "active", acl13: "3401560000001", organizations: [org(4, "Nouveau labo")] },
  // trouvée sans organisation
  { id: 6, status: "active", acl13: "3401111111111", organizations: [] },
];
let medipim = { pages: [], statut: 200 };
let colonneLabo = false;
const envois = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status });
  if (url.includes("/auth/v1/user")) return json({ id: "admin", email: "pharmacien@elixirpharma.fr", app_metadata: { role: "admin" } });
  if (url.includes("/products/query")) {
    const corps = JSON.parse(opts.body);
    medipim.pages.push(corps);
    if (medipim.statut !== 200) return json({ error: { code: "x" } }, medipim.statut);
    if (corps.filter?.and) return json({ results: [FICHES[0]], meta: { total: 1 } });   // fiche (GET) : recherche par code
    const no = corps.page.no;
    return json({ results: no === 0 ? FICHES.slice(0, 4) : FICHES.slice(4), meta: { total: 260 } });
  }
  if (url.includes("/rest/v1/elixir_products")) {
    if (url.includes("select=history")) return json([{ history: "[]" }]);
    const corps = opts.body ? JSON.parse(opts.body) : null;
    envois.push({ methode: opts.method, corps });
    if (corps && "labo" in corps && !colonneLabo) return json({ code: "PGRST204", message: "Could not find the 'labo' column of 'elixir_products' in the schema cache" }, 400);
    return opts.method === "PATCH" ? json([{ cip: corps.cip }]) : json([]);
  }
  throw new Error("appel inattendu : " + url);
};

// ── medipim-lookup ──
const { handler: lookup } = await import("../netlify/functions/medipim-lookup.js");
const appelLot = async (corps) => { const r = await lookup({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(corps) }); return { statut: r.statusCode, corps: JSON.parse(r.body), entetes: r.headers }; };

eq("action inconnue", (await appelLot({ action: "x" })).statut, 400);
eq("codes requis", (await appelLot({ action: "labos", codes: ["12", null] })).statut, 400);
eq("150 codes au plus", (await appelLot({ action: "labos", codes: Array.from({ length: 151 }, (_, i) => String(3400930000000 + i)) })).statut, 413);

medipim = { pages: [], statut: 200 };
const codes = ["3400926744588", "3400930158920", "3574660115390", "3401560000001", "3401111111111", "9999999999999", "1234567"];
const r = await appelLot({ action: "labos", codes });
eq("lot : statut", r.statut, 200);
eq("lot : laboratoires", r.corps.labos, {
  "3400926744588": { labo: "Recordati", autres: ["Laboratoires Tonipharm"] },
  "3400930158920": { labo: "KARO HEALTHCARE AB", autres: ["ALLOGA FRANCE"] },
  "3574660115390": { labo: "Bayer", autres: [] },
  "3401560000001": { labo: "Nouveau labo", autres: [] },
});
eq("lot : introuvables", r.corps.introuvables, ["9999999999999", "1234567"]);
eq("lot : trouvés sans laboratoire", r.corps.sans_labo, ["3401111111111"]);
eq("lot : 2 pages lues (total 260, pages de 250)", medipim.pages.map(p => p.page), [{ no: 0, size: 250 }, { no: 1, size: 250 }]);
eq("lot : filtres (cip13 34009, acl13 3401, CIP7, ean)", medipim.pages[0].filter.or.map(f => Object.keys(f)[0] + ":" + Object.values(f)[0].length),
  ["cip13:2", "acl13:2", "cipOrAcl7:1", "ean:6"]);

medipim = { pages: [], statut: 429 };
const sature = await appelLot({ action: "labos", codes: ["3400926744588"] });
eq("Medipim saturé → 429 + Retry-After", [sature.statut, sature.entetes["Retry-After"]], [429, "30"]);
medipim = { pages: [], statut: 503 };
eq("Medipim en panne → 503", (await appelLot({ action: "labos", codes: ["3400926744588"] })).statut, 503);

medipim = { pages: [], statut: 200 };
const g = await lookup({ httpMethod: "GET", headers: { authorization: "Bearer t" }, queryStringParameters: { cip: "3400926744588", sansPhoto: "1" } });
const fiche = JSON.parse(g.body);
eq("fiche (GET) : laboratoire", [g.statusCode, fiche.labo, fiche.labo_autres], [200, "Recordati", ["Laboratoires Tonipharm"]]);

// ── products-upsert ──
const { handler: upsert } = await import("../netlify/functions/products-upsert.js");
const ecrire = async (corps) => {
  envois.length = 0;
  const r = await upsert({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(corps) });
  const ecrit = envois.map(e => e.corps && "labo" in e.corps ? e.corps.labo : "∅");
  return { statut: r.statusCode, code: JSON.parse(r.body).code || null, labo: ecrit };
};
colonneLabo = false;   // avant la migration SQL
eq("avant : modification ordinaire (labo jamais envoyé)", await ecrire({ product: { cip: "1", name: "X", pv: 2, pn: 1 }, action: "update" }), { statut: 200, code: null, labo: ["∅"] });
eq("avant : création sans labo", await ecrire({ product: { cip: "2", name: "Y", pn: 1 }, action: "create" }), { statut: 200, code: null, labo: ["∅"] });
eq("avant : désactivation", await ecrire({ product: { cip: "1", active: false }, action: "delete" }), { statut: 200, code: null, labo: ["∅"] });
eq("avant : labo envoyé → erreur claire, rien d'écrit", await ecrire({ product: { cip: "1", labo: "Bayer" }, action: "update" }), { statut: 409, code: "labo_colonne_absente", labo: ["Bayer"] });
colonneLabo = true;    // après la migration SQL
eq("après : modification ordinaire", await ecrire({ product: { cip: "1", name: "X", pv: 2, pn: 1 }, action: "update" }), { statut: 200, code: null, labo: ["∅"] });
eq("après : labo nettoyé", await ecrire({ product: { cip: "1", labo: "  Procter   & Gamble " }, action: "update" }), { statut: 200, code: null, labo: ["Procter & Gamble"] });
eq("après : labo vidé → null", await ecrire({ product: { cip: "1", labo: "  " }, action: "update" }), { statut: 200, code: null, labo: [null] });
eq("après : création avec labo", await ecrire({ product: { cip: "3", name: "Z", pn: 1, labo: "Cooper" }, action: "create" }), { statut: 200, code: null, labo: ["Cooper"] });

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
