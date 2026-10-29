// Tests hors ligne des vraies fonctions : plafonds 1 000 / 500, actifs seuls, tri et prix Odoo,
// erreur en deuxième page, stocks complets ou CIP explicites ; pagination sans total,
// page vide, limite de pages, dédoublonnage, corps invalide et erreur HTTP tronquée.
process.env.SUPABASE_URL = "https://supabase.faux";
process.env.SUPABASE_KEY = "cle-factice";
let ok = 0, ko = 0;
const eq = (label, got, exp) => {
  if (JSON.stringify(got) === JSON.stringify(exp)) ok++;
  else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); }
};
const vrai = (label, v) => eq(label, !!v, true);
const rejette = async (label, fn, motif) => {
  try { await fn(); vrai(label, false); }
  catch (e) { vrai(label, motif.test(e.message)); }
};
const json = (rows, range) => new Response(JSON.stringify(rows), {
  status: 200, headers: range == null ? {} : { "Content-Range": range },
});
const comparer = (champs) => (a, b) => {
  for (const champ of champs) {
    if (a[champ] < b[champ]) return -1;
    if (a[champ] > b[champ]) return 1;
  }
  return 0;
};
const donnees = (n) => Array.from({ length: n + 7 }, (_, i) => ({
  cip: String(3400000000000 + i), active: i < n, section: `section-${i % 3}`,
  name: `Produit ${i % 11}`, pv: 9, pn: 7, pct: 10, note: "Fictif",
})).reverse();
let lignes = [], plafond = 1000, panne = 0, totalConnu = true, appels = [], lots = [];
const faux = async (url, opts = {}) => {
  const u = new URL(url), h = new Headers(opts.headers);
  if (u.origin !== process.env.SUPABASE_URL) throw new Error(`Appel inattendu : ${url}`);
  if (u.pathname === "/rest/v1/odoo_catalog") {
    const filtre = u.searchParams.get("cip");
    if (!/^in\.\(.*\)$/.test(filtre)) throw new Error("Filtre Odoo inattendu");
    const cips = filtre.slice(4, -1).split(",");
    lots.push(cips);
    return json(cips.map(cip => ({ cip, list_price: "10", discounted_price: "8", discount_pct: "20",
      in_stock: true, available: 12, updated_at: "2026-10-01T00:00:00Z" })));
  }
  if (u.pathname !== "/rest/v1/elixir_products") throw new Error(`Appel inattendu : ${url}`);
  appels.push({ range: h.get("Range"), prefer: h.get("Prefer"), ordre: u.searchParams.get("order") });
  if (appels.length === panne) return new Response("Panne fictive", { status: 500 });
  let rows = lignes.filter(p => u.searchParams.get("active") !== "eq.true" || p.active);
  const ordre = u.searchParams.get("order");
  if (ordre) rows.sort(comparer(ordre.split(",").map(c => c.split(".")[0])));
  const total = totalConnu && h.get("Prefer")?.includes("count=exact") ? rows.length : "*";
  const [de, fin] = (h.get("Range") || "0-999").split("-").map(Number);
  rows = rows.slice(de, Math.min(fin + 1, de + plafond));
  const range = rows.length ? `${de}-${de + rows.length - 1}/${total}` : `*/${total}`;
  if (u.searchParams.get("select") === "cip") rows = rows.map(p => ({ cip: p.cip }));
  return json(rows, range);
};
const reset = (n, cap = 1000) => {
  lignes = donnees(n); plafond = cap; panne = 0; totalConnu = true; appels = []; lots = [];
  globalThis.fetch = faux;
};
reset(0);
const { handler: productsGet } = await import("../netlify/functions/products-get.js");
const { handler: stockGet } = await import("../netlify/functions/stock-get.js");
const { lireToutesLesPages } = await import("../netlify/functions/_supabase-pages.js");
const event = { httpMethod: "GET", headers: {} };
const url = `${process.env.SUPABASE_URL}/rest/v1/elixir_products?active=eq.true&order=cip.asc&select=cip`;
for (const [n, cap] of [[988, 1000], [1000, 1000], [1001, 1000], [2500, 1000], [1050, 500]]) {
  reset(n, cap);
  const r = await productsGet(event), body = JSON.parse(r.body), produits = body.products || [];
  const label = `${n} actifs, plafond ${cap}`;
  eq(`${label} : statut`, r.statusCode, 200);
  eq(`${label} : nombre complet`, produits.length, n);
  eq(`${label} : aucun doublon`, new Set(produits.map(p => p.cip)).size, n);
  vrai(`${label} : aucun inactif`, produits.every(p => p.active));
  const attendus = lignes.filter(p => p.active).sort(comparer(["section", "name", "cip"])).map(p => ({
    ...p, pv: 10, pn: 8, pct: 20, remise_eur: 2, price_tiers: null, _price_source: "odoo",
  }));
  eq(`${label} : ordre, champs et prix`, produits, attendus);
  eq(`${label} : pages`, appels.map(a => a.range), Array.from({ length: Math.ceil(n / cap) }, (_, i) => `${i * cap}-${i * cap + 999}`));
  vrai(`${label} : total exact et tri stable`, appels.every(a => a.prefer === "count=exact" && a.ordre === "section.asc,name.asc,cip.asc"));
  vrai(`${label} : lots Odoo de 200 maximum`, lots.every(l => l.length <= 200));
}
reset(1001); panne = 2;
{
  const r = await productsGet(event), body = JSON.parse(r.body);
  eq("Erreur deuxième page : statut", r.statusCode, 500);
  vrai("Erreur deuxième page : message, aucune liste partielle", /500.*Panne fictive/.test(body.error) && !Object.hasOwn(body, "products"));
  vrai("Erreur : CORS conservé", !!r.headers["Access-Control-Allow-Origin"]);
  eq("Erreur : aucun lot Odoo", lots.length, 0);
}
reset(2500);
{
  const r = await stockGet(event), body = JSON.parse(r.body);
  eq("Stocks : statut", r.statusCode, 200);
  eq("Stocks : tous les CIP actifs", Object.keys(body.stocks).sort(), lignes.filter(p => p.active).map(p => p.cip).sort());
  vrai("Stocks : valeurs", Object.values(body.stocks).every(s => s.dispo === 1 && s.stock === 12));
  eq("Stocks : date", body.updatedAt, "2026-10-01T00:00:00Z");
  vrai("Stocks : tri stable", appels.every(a => a.ordre === "cip.asc"));
}
reset(2500);
{
  // a et b désignent deux CIP valides : les lettres seules sont rejetées par le filtre existant.
  const a = "3400000000001", b = "3400000000002";
  const r = await stockGet({ ...event, queryStringParameters: { cips: `${a},${b}` } });
  eq("CIP explicites : aucune lecture produits", appels.length, 0);
  eq("CIP explicites : disponibilité seule", JSON.parse(r.body).stocks, { [a]: { dispo: 1 }, [b]: { dispo: 1 } });
}
reset(1001); totalConnu = false;
eq("Total inconnu : page courte", (await lireToutesLesPages(url, {})).length, 1001);
eq("Total inconnu : deux pages", appels.length, 2);
reset(0);
eq("Page vide : arrêt", await lireToutesLesPages(url, {}), []);
eq("Page vide : une requête", appels.length, 1);
reset(2500);
await rejette("maxPages : erreur sans liste partielle", () => lireToutesLesPages(url, {}, { maxPages: 2 }), /2 pages.*incomplète/);
reset(2);
lignes = [{ cip: "a", valeur: 1 }, { cip: "a", valeur: 2 }, { cip: "b", valeur: 3 }].map(p => ({ ...p, active: true }));
plafond = 1;
const headers = Object.freeze({ apikey: "factice", Range: "9-9", Prefer: "count=planned" });
const dedup = await lireToutesLesPages(`${process.env.SUPABASE_URL}/rest/v1/elixir_products?active=eq.true&order=cip.asc&select=*`, headers, { cle: "cip" });
eq("Doublon : première occurrence gardée", dedup.map(p => [p.cip, p.valeur]), [["a", 1], ["b", 3]]);
eq("Doublon : progression sur les lignes reçues", appels.map(a => a.range), ["0-999", "1-1000", "2-1001"]);
eq("En-têtes reçus inchangés", headers, { apikey: "factice", Range: "9-9", Prefer: "count=planned" });
globalThis.fetch = async () => json({ erreur: "pas un tableau" });
await rejette("Corps non tableau : erreur", () => lireToutesLesPages(url, {}), /tableau/);
globalThis.fetch = async () => new Response("x".repeat(301), { status: 503 });
try { await lireToutesLesPages(url, {}); vrai("HTTP : erreur attendue", false); }
catch (e) { eq("HTTP : statut et 300 caractères", e.message, `Supabase 503 : ${"x".repeat(300)}`); }
globalThis.fetch = async () => json([{ cip: "a" }]);
eq("Content-Range absent : page courte", await lireToutesLesPages(url, {}), [{ cip: "a" }]);
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
