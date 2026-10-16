// Tests du laboratoire (Centrale OTC, docs/labo-otc.md) : node scripts/test-labo.mjs
// Hors ligne : fetch simulé (Supabase et Medipim), aucune donnée réelle lue ni écrite.
//  • medipim-lookup, mode lot (POST action « labos ») et fiche (GET) : choix du laboratoire (dépositaires, répartiteurs),
//    rapprochement des codes (CIP7 dans cipOrAcl7), pages, erreurs (page illisible : jamais « introuvables ») ;
//  • products-upsert : colonne labo écrite seulement quand elle est envoyée, avant et après la migration SQL.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
let ok = 0, ko = 0;
const trie = (o) => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));   // ordre des clés : « 3015892 » est un index
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── fetch simulé ──
const org = (id, name) => ({ id, name: typeof name === "string" ? { fr: name } : name });
const FICHES = [
  { id: 1, status: "active", cip13: "3400926744588", organizations: [org(87, "Recordati"), org(2000, "Laboratoires Tonipharm")] },
  // dépositaire logistique écarté même avec un id plus petit (Lamisilate : Alloga France → Karo Healthcare) ; codes
  // comme sur la fiche réelle M78C6080C6 : CIP7 dans cipOrAcl7, aucun champ cip7 ni acl7
  { id: 2, status: "active", cipOrAcl7: "3015892", cip13: "3400930158920", acl13: null, ean: [], organizations: [org(5, "ALLOGA FRANCE"), org(900, "KARO HEALTHCARE AB")] },
  // EAN renvoyé avec un zéro de tête
  { id: 3, status: "active", ean: ["03574660115390"], organizations: [org(12, "  Bayer  ")] },
  // fiche retirée puis fiche active pour le même code : l'active l'emporte
  { id: 4, status: "replaced", acl13: "3401560000001", organizations: [org(3, "Ancien labo")] },
  { id: 5, status: "active", acl13: "3401560000001", organizations: [org(4, "Nouveau labo")] },
  // trouvée sans organisation
  { id: 6, status: "active", acl13: "3401111111111", organizations: [] },
  // répartiteur écarté au profit du laboratoire, même avec un id plus petit (Oxyplastine)
  { id: 7, status: "active", cip13: "3400930771440", organizations: [org(1284, "SAS Alliance Healthcare Group France"), org(5000, "ALLIANCE PHARMA IRELAND LTD")] },
  // répartiteur seul : pas de laboratoire, à saisir à la main (Kelo-Cote)
  { id: 8, status: "active", ean: ["5036631008011"], organizations: [org(1284, "SAS Alliance Healthcare Group France")] },
  // « Alliance Pharma » est un laboratoire, pas un répartiteur
  { id: 9, status: "active", acl13: "3401396534945", organizations: [org(77, "Alliance Pharma")] },
];
const codesDe = (f) => [f.cip13, f.acl13, ...(f.ean || [])].filter(Boolean);
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
    if (corps.filter?.and) {   // fiche (GET) : recherche par code-barres (refcode) ou par CIP7 (cipOrAcl7)
      const f = corps.filter.and[1];
      const res = FICHES.filter(x => f.cipOrAcl7 ? x.cipOrAcl7 === f.cipOrAcl7 : codesDe(x).includes(f.search?.query));
      return json({ results: res, meta: { total: res.length } });
    }
    const no = corps.page.no;
    // réponse illisible sur une page donnée : délai dépassé pendant la lecture du corps, HTML, JSON sans results
    if (medipim.panne && medipim.panne.page === no) {
      if (medipim.panne.type === "delai") return { status: 200, ok: true, json: async () => { throw new DOMException("délai dépassé", "TimeoutError"); } };
      if (medipim.panne.type === "html") return new Response("<html>Erreur</html>", { status: 200 });
      return json({ meta: { total: 260 } });
    }
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
const codes = ["3400926744588", "3400930158920", "3574660115390", "3401560000001", "3401111111111", "9999999999999", "1234567",
  "3015892", "3400930771440", "5036631008011", "3401396534945"];
const r = await appelLot({ action: "labos", codes });
eq("lot : statut", r.statut, 200);
eq("lot : laboratoires", trie(r.corps.labos), trie({
  "3400926744588": { labo: "Recordati", autres: ["Laboratoires Tonipharm"] },
  "3400930158920": { labo: "KARO HEALTHCARE AB", autres: ["ALLOGA FRANCE"] },
  "3574660115390": { labo: "Bayer", autres: [] },
  "3401560000001": { labo: "Nouveau labo", autres: [] },
  "3015892": { labo: "KARO HEALTHCARE AB", autres: ["ALLOGA FRANCE"] },                                     // CIP7 → cipOrAcl7
  "3400930771440": { labo: "ALLIANCE PHARMA IRELAND LTD", autres: ["SAS Alliance Healthcare Group France"] },   // répartiteur écarté
  "3401396534945": { labo: "Alliance Pharma", autres: [] },
}));
eq("lot : introuvables", r.corps.introuvables, ["9999999999999", "1234567"]);
eq("lot : trouvés sans laboratoire (aucune organisation, répartiteur seul)", r.corps.sans_labo, ["3401111111111", "5036631008011"]);
eq("lot : 2 pages lues (total 260, pages de 250)", medipim.pages.map(p => p.page), [{ no: 0, size: 250 }, { no: 1, size: 250 }]);
eq("lot : filtres (cip13 34009, acl13 3401, CIP7, ean)", medipim.pages[0].filter.or.map(f => Object.keys(f)[0] + ":" + Object.values(f)[0].length),
  ["cip13:3", "acl13:3", "cipOrAcl7:2", "ean:9"]);

// page illisible : erreur (l'admin relance le lot), jamais 200 avec des codes « introuvables »
for (const [panne, attendu] of [[{ type: "delai", page: 0 }, 504], [{ type: "delai", page: 1 }, 504], [{ type: "html", page: 0 }, 502], [{ type: "sans-results", page: 1 }, 502]]) {
  medipim = { pages: [], statut: 200, panne };
  const x = await appelLot({ action: "labos", codes: ["3400926744588", "3400930158920"] });
  eq(`lot : page ${panne.page + 1} illisible (${panne.type}) → ${attendu}`, [x.statut, x.corps.introuvables, typeof x.corps.error], [attendu, undefined, "string"]);
}

medipim = { pages: [], statut: 429 };
const sature = await appelLot({ action: "labos", codes: ["3400926744588"] });
eq("Medipim saturé → 429 + Retry-After", [sature.statut, sature.entetes["Retry-After"]], [429, "30"]);
medipim = { pages: [], statut: 503 };
eq("Medipim en panne → 503", (await appelLot({ action: "labos", codes: ["3400926744588"] })).statut, 503);

medipim = { pages: [], statut: 200 };
const fiche = async (q) => { const g = await lookup({ httpMethod: "GET", headers: { authorization: "Bearer t" }, queryStringParameters: { sansPhoto: "1", ...q } }); const d = JSON.parse(g.body); return [g.statusCode, d.labo, d.labo_autres]; };
eq("fiche (GET) : laboratoire", await fiche({ cip: "3400926744588" }), [200, "Recordati", ["Laboratoires Tonipharm"]]);
// bouton « 🔍 Medipim » de l'admin : un code à 7 chiffres part aussi en cip7 (sans lui : 404, la recherche par code exige 8 chiffres)
eq("fiche (GET) : CIP7 avec cip7", await fiche({ cip: "3015892", cip7: "3015892" }), [200, "KARO HEALTHCARE AB", ["ALLOGA FRANCE"]]);
eq("fiche (GET) : CIP7 sans cip7 → 404", (await fiche({ cip: "3015892" }))[0], 404);
eq("fiche (GET) : répartiteur seul → pas de laboratoire", await fiche({ cip: "5036631008011" }), [200, null, []]);

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
