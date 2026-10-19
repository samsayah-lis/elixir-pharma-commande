// Tests de la page d'accueil « La Tête de gondole » (serveur) : node scripts/test-accueil.mjs
// Hors ligne : Odoo, Supabase, kv_store et jetons simulés (dépendances injectées), aucune lecture ni écriture réelle.
//  • règle : fenêtre de 15 jours (heure de Paris, changement d'heure), textes de la boîte, prix (fusion products-get,
//    Saisie, paliers, colis), exclusions (rupture, contingenté, justificatif, stupéfiant, seuils, prix anormal, menu
//    masqué, précommande), un produit par marque (dosages en variantes), départages, 12 diapositives + 8 réserves ;
//  • GET : rupture remplacée par la première réserve, principal de repli, cache périmé (36 h), aucun compte exact ni
//    stock dans la réponse ;
//  • calcul : Odoo en lecture seule (read_group, read, search_read), courbe par jour de Paris ;
//  • accueil-offres : 401 sans jeton (rien lu), 503 si Supabase Auth est en panne, 403 sans compte, 200 privé (60 s)
//    pour une pharmacie et pour l'admin, calcul au premier appel sous verrou, échec → perime ;
//  • accueil-offres-refresh : Odoo en panne → cache conservé, journal écrit.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ODOO_URL = "https://odoo.test";
globalThis.fetch = async (url) => { throw new Error(`réseau interdit dans les tests : ${url}`); };

const S = await import("../netlify/functions/_accueil-selection.js");
const { calculerClassement } = await import("../netlify/functions/_accueil-donnees.js");
const { creerHandler: creerGet } = await import("../netlify/functions/accueil-offres.js");
const { creerHandler: creerRefresh } = await import("../netlify/functions/accueil-offres-refresh.js");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── 1. Fenêtre ──
{
  const f = S.fenetre(Date.parse("2026-10-19T20:16:44Z"));
  eq("15 jours, aujourd'hui compris", [f.jours.length, f.jours[0], f.jours[14], f.aujourdhui], [15, "2026-10-05", "2026-10-19", "2026-10-19"]);
  eq("depuis = J−14 à minuit, heure de Paris (été)", new Date(f.depuis).toISOString(), "2026-10-04T22:00:00.000Z");
  eq("période précédente : 15 jours avant", new Date(f.avant).toISOString(), "2026-09-19T22:00:00.000Z");
  eq("minuit de Paris après le passage à l'heure d'hiver", new Date(S.minuitParis("2026-10-26")).toISOString(), "2026-10-25T23:00:00.000Z");
  eq("23 h 30 UTC le 31/10 = 1er novembre à Paris", S.jourParis("2026-10-31T23:30:00Z"), "2026-11-01");
  eq("date Odoo", S.dateOdoo(Date.parse("2026-10-04T22:00:00Z")), "2026-10-04 22:00:00");
}

// ── 2. Textes ──
eq("dosages", ["MOUNJARO 5mg", "EYLEA 114,3 mg/ml", "VENTOLINE 100µG/DOSE SUSP 120 DOSES", "IZALGI MYLAN 500MG/25MG BTE 16", "ZYMAD 10000U BUV GTT 10ML", "SPASFON COMPRIME ENROBE BTE 30"].map(n => S.dosage(n)),
  ["5 mg", "114,3 mg/ml", "100 µg/dose", "500 mg/25 mg", "10 000 UI", null]);
eq("formes", ["MOUNJARO 5MG/DOSE KWIKPEN", "DUPIXENT 300 mg (dupilumab), solution injectable en stylo prérempli (B/2)", "MONOPROST 50MCG/ML COLLY DOS 30", "SPASFON (phloroglucinol), comprimés enrobés (B/30)"].map(n => S.forme(n)),
  ["KwikPen", "Stylo prérempli", "Collyre", "Comprimés"]);
eq("laboratoires courts", ["Eli Lilly and Company", "IBSA PHARMA SAS", "SIFI France", "LABORATOIRES THEA", "GSK", null].map(S.laboCourt), ["Lilly", "IBSA", "SIFI", "Théa", "GSK", null]);
eq("marque", [S.marque("MOUNJARO 5mg"), S.marque("ACIDE ACETYLSALICYLIQUE BIOGARAN 75 mg"), S.marque("Vismed Multi 15ml")], ["MOUNJARO", "ACIDE ACETYLSALICYLIQUE", "VISMED"]);
eq("famille : même marque et même labo", [S.cleFamille("MOUNJARO 5mg", 7), S.cleFamille("MOUNJARO KWIKPEN 2,5 mg", 7), S.cleFamille("MOUNJARO 5mg", 8)], ["MOUNJARO|7", "MOUNJARO|7", "MOUNJARO|8"]);
eq("tranches de popularité, jamais de compte", [252, 134, 89, 21, 12, 6].map(S.tranche),
  ["Plus de 200 pharmacies", "Plus de 100 pharmacies", "Plus de 50 pharmacies", "Plus de 20 pharmacies", "Plus de 10 pharmacies", "Plus de 5 pharmacies"]);
eq("courbe normalisée (forme, sans chiffres)", S.normaliser([49, 42, 0, 65]), [0.75, 0.65, 0, 1]);
eq("nom court : nom curaté, sinon nom Odoo sans parenthèses", [S.nomCourt("MOUNJARO 5mg", "x"), S.nomCourt(null, "EYLEA 114,3 mg/ml (aflibercept), solution injectable")], ["MOUNJARO 5mg", "EYLEA 114,3 mg/ml"]);

// ── 3. Prix ──
eq("fusion products-get : prix Odoo n° 5", S.fusionPrix({ pv: 3.3, pn: 3.1, pct: 6 }, { list_price: 3.24, discounted_price: 3.01, discount_pct: 7.1, price_tiers: [] }),
  { pv: 3.24, pn: 3.01, pct: 7.1, remise_eur: 0.23, price_tiers: null });
eq("fusion : prix curaté si Odoo sans prix", S.fusionPrix({ pv: 2, pn: 1.8, pct: 10, remise_eur: 0.2 }, { list_price: 0, discounted_price: 0 }), { pv: 2, pn: 1.8, pct: 10, remise_eur: 0.2, price_tiers: null });
eq("règle de la Saisie : prix remisé si remise", S.prixSaisie({ list_price: 1080.35, discounted_price: 1055.25, discount_pct: 2.3 }), { pv: 1080.35, pn: 1055.25, pct: 2.3, remise_eur: 25.1, price_tiers: null });
eq("règle de la Saisie : prix catalogue sans remise", S.prixSaisie({ list_price: 9.32, discounted_price: 9.32, discount_pct: 0 }).pn, 9.32);
eq("colis Stratège : lot d'un carton", S.regleQte("stratege", { colis: 120 }), { step: 120, min: 120, multiple: 120, libelle: "Se commande par 120 (carton)" });
eq("hors colis : 1 boîte", S.regleQte("obeso", {}), { step: 1, min: 1, multiple: 1, libelle: null });
eq("palier atteint au lot (Spasfon 240 × 1,67)", S.applyTiers(1.7, [{ min_qty: 240, price: 1.67 }], 240), 1.67);
eq("niveau de stock", [S.niveauStock({ available: 5 }, 10, 1), S.niveauStock({ available: 30 }, 10, 1), S.niveauStock({ available: 900 }, 10, 120), S.niveauStock({ available: 100 }, 10, 120)],
  ["dernieres", "limite", "ok", "dernieres"]);

// ── 4. Sélection ──
const menus = S.contexteMenus({ displayConfig: { labels: { obeso: "🔥🔥Mounjaro / Wegovy" }, hiddenTabs: ["ulabs"] },
  promos: [{ id: 9, active: true, name: "Précommande", sansStock: true, products: [{ cip: "3400000000099", pn: 1, pv: 2 }] }, { id: 8, active: false, name: "Ancienne", products: [] }] });
eq("libellé de menu sans emoji, menus masqués, promos actives", [menus.libelle("obeso"), menus.caches.has("ulabs"), menus.promos.map(p => p.key)], ["Mounjaro / Wegovy", true, ["promo_9"]]);
const cat = (cip, pv, pn, extra = {}) => ({ cip, name: `NOM ${cip}`, list_price: pv, discounted_price: pn, discount_pct: Math.round((pv - pn) / pv * 1000) / 10, price_tiers: null, in_stock: true, available: 5000, ...extra });
const C = (n) => `34000000000${String(n).padStart(2, "0")}`;
// pid → fiche ; 1-2 Mounjaro (même labo) ; 3 Ventoline (Stratège, colis 120) ; 4 rupture ; 5 contingenté ; 6 justificatif ;
// 7 stupéfiant ; 8 seuil ; 9 prix anormal ; 10 menu masqué ; 11 précommande ; 12 inactif ; 13-40 produits simples
const fiches = {
  1: { cip: C(1), nom: "MOUNJARO 5MG/DOSE KWIKPEN", labo: "Eli Lilly and Company", laboId: 7, active: true },
  2: { cip: C(2), nom: "MOUNJARO KWIKPEN 2,5 mg/dose sol inj stylo prérempli", labo: "Eli Lilly and Company", laboId: 7, active: true },
  3: { cip: C(3), nom: "VENTOLINE 100 microgrammes/dose, suspension pour inhalation", labo: "GSK", laboId: 3, active: true },
  4: { cip: C(4), nom: "LAMALINE Gél", labo: "X", laboId: 4, active: true },
  5: { cip: C(5), nom: "REPATHA 140 mg", labo: "Amgen", laboId: 5, active: true },
  6: { cip: C(6), nom: "NINLARO 4 mg", labo: "Takeda", laboId: 6, active: true },
  7: { cip: C(7), nom: "RITALINE 10 mg", labo: "Novartis", laboId: 17, active: true, stup: true },
  8: { cip: C(8), nom: "RARE 1 mg", labo: "Y", laboId: 8, active: true },
  9: { cip: C(9), nom: "AIGUILLES 0,60 x 25", labo: "Z", laboId: 9, active: true },
  10: { cip: C(10), nom: "PAROGENCYL dentifrice", labo: "U", laboId: 10, active: true },
  11: { cip: "3400000000099", nom: "VASELINE 100 ml", labo: "V", laboId: 11, active: true },
  12: { cip: C(12), nom: "ANCIEN 5 mg", labo: "W", laboId: 12, active: false },
};
for (let i = 13; i <= 40; i++) fiches[i] = { cip: C(i), nom: `PRODUIT${i} ${i} mg`, labo: `Labo ${i}`, laboId: 100 + i, active: true };
const catalogue = {};
for (const f of Object.values(fiches)) catalogue[f.cip] = cat(f.cip, 10, 9);
catalogue[C(1)] = cat(C(1), 221.32, 210.03); catalogue[C(2)] = cat(C(2), 163.7, 155.35);
catalogue[C(3)] = cat(C(3), 3.24, 3.01);
catalogue[C(4)] = cat(C(4), 5, 4, { in_stock: false });
catalogue[C(9)] = cat(C(9), 0.25, 0.01);
const curees = [
  { cip: C(1), section: "obeso", name: "MOUNJARO 5mg", pv: 1, pn: 1 }, { cip: C(2), section: "obeso", name: "MOUNJARO 2,5mg", pv: 1, pn: 1 },
  { cip: C(3), section: "stratege", name: "VENTOLINE 100µG/DOSE", pv: 3, pn: 2.9, colis: 120, image_url: "https://assets.test/media/medium/v.png" },
  { cip: C(10), section: "ulabs", name: "PAROGENCYL", pv: 3, pn: 2 },
];
const classement = [
  { pid: 1, cmd: 556, ph: 252, qte: 900 }, { pid: 2, cmd: 491, ph: 233, qte: 700 }, { pid: 4, cmd: 480, ph: 50, qte: 10 },
  { pid: 5, cmd: 470, ph: 100, qte: 100 }, { pid: 6, cmd: 460, ph: 100, qte: 100 }, { pid: 7, cmd: 450, ph: 100, qte: 100 },
  { pid: 8, cmd: 9, ph: 9, qte: 9 }, { pid: 9, cmd: 440, ph: 100, qte: 100 }, { pid: 10, cmd: 430, ph: 100, qte: 100 },
  { pid: 11, cmd: 420, ph: 100, qte: 100 }, { pid: 12, cmd: 410, ph: 100, qte: 100 },
  { pid: 3, cmd: 199, ph: 114, qte: 24000 },
  ...Array.from({ length: 28 }, (_, i) => ({ pid: 13 + i, cmd: 150 - i, ph: 60, qte: 300 })),
  { pid: 14, cmd: 200, ph: 80, qte: 300 },   // doublon ignoré par le tri (même pid, gardé tel quel)
].filter((c, i, a) => a.findIndex(x => x.pid === c.pid) === i);
const sel = S.selectionner({ classement, precedent: { 1: 492, 3: 0 }, fiches, catalogue, curees, menus, quotas: new Set([5]), justifs: new Set([C(6)]) });
eq("12 diapositives, 8 réserves", [sel.slides.length, sel.reserves.length], [12, 8]);
eq("Mounjaro : une diapositive, deux dosages", [sel.slides[0].famille, sel.slides[0].membres.map(m => m.cip), sel.slides[0].principal], ["MOUNJARO", [C(1), C(2)], C(1)]);
eq("Ventoline en 2e (après les exclusions)", sel.slides[1].famille, "VENTOLINE");
const exclus = sel.journal.join(" | ");
eq("motifs d'exclusion", ["rupture", "contingenté", "sur justificatif labo", "stupéfiant", "seuil", "prix anormal", "menu masqué", "précommande", "fiche inactive"].filter(m => !exclus.includes(m)), []);
eq("tendance et « nouveau »", [sel.slides[0].tendance_pct, sel.slides[0].nouveau, sel.slides[1].tendance_pct, sel.slides[1].nouveau], [13, false, null, true]);
eq("départage : commandes puis pharmacies", S.selectionner({ classement: [{ pid: 13, cmd: 100, ph: 10, qte: 5 }, { pid: 14, cmd: 100, ph: 20, qte: 5 }], fiches, catalogue, curees, menus }).slides.map(d => d.principal), [C(14), C(13)]);

// ── 5. Réponse publique ──
const cacheInterne = { version: 1, genere_le: "2026-10-19T20:00:00.000Z", periode: { du: "2026-10-05", au: "2026-10-19", jours: [] }, slides: sel.slides, reserves: sel.reserves };
const ctx = { catalogue, curees, menus };
const maintenant = Date.parse("2026-10-19T21:00:00Z");
const pub = S.publique(cacheInterne, ctx, maintenant);
eq("réponse : 12 + 8, rangs 1 à 20", [pub.slides.length, pub.reserves.length, pub.slides[0].rang, pub.reserves[7].rang, pub.perime], [12, 8, 1, 20, false]);
const texte = JSON.stringify(pub);
eq("aucun compte exact, stock ni champ interne", ["nb_commandes", "nb_pharmacies", "available", "_cmd", "_rythme", "_pid", "odoo_product_id", "membres", "\"556\"", "556"].filter(k => texte.includes(k)), []);
eq("Ventoline : carton de 120 au prix Odoo, menu Stratège, photo", [pub.slides[1].lot, pub.slides[1].menu, pub.slides[1].regle_qte.libelle, !!pub.slides[1].image_url],
  [{ qte: 120, pu: 3.01, total: 361.2 }, { key: "stratege", label: "Sélection Stratège" }, "Se commande par 120 (carton)", true]);
eq("Mounjaro : variantes triées par dose, principal 5 mg, menu sans emoji", [pub.slides[0].variantes.map(v => [v.libelle, v.principal]), pub.slides[0].menu.label, pub.slides[0].boite],
  [[["2,5 mg", false], ["5 mg", true]], "Mounjaro / Wegovy", { marque: "MOUNJARO", dosage: "5 mg", forme: "KwikPen", labo: "Lilly" }]);
eq("produit hors menu : Saisie, règle de la Saisie", [pub.slides[2].menu.key, pub.slides[2].pn, pub.slides[2].lot.qte], ["saisie", 9, 1]);
// Mounjaro 5 mg en rupture : 2,5 mg devient principal ; Ventoline en rupture : remplacée (la 1re réserve entre)
const enRupture = (cips) => ({ ...ctx, catalogue: Object.fromEntries(Object.entries(catalogue).map(([c, r]) => [c, cips.includes(c) ? { ...r, in_stock: false } : r])) });
const pub2 = S.publique(cacheInterne, enRupture([C(1), C(3)]), maintenant);
eq("dosage principal en rupture : le suivant devient principal, sans variantes", [pub2.slides[0].cip, pub2.slides[0].variantes.length], [C(2), 0]);
eq("diapositive en rupture remplacée par la première réserve", [pub2.slides.some(s => s.famille === "VENTOLINE"), pub2.slides[11].cip, pub2.reserves.length], [false, sel.reserves[0].principal, 7]);
eq("prix relus au moment de l'appel", S.publique(cacheInterne, { ...ctx, catalogue: { ...catalogue, [C(3)]: cat(C(3), 3.24, 2.95) } }, maintenant).slides[1].lot.total, 354);
eq("cache de plus de 36 h : périmé, vitrine vide", (({ slides, reserves, perime }) => [slides.length, reserves.length, perime])(S.publique(cacheInterne, ctx, Date.parse("2026-10-21T09:00:00Z"))), [0, 0, true]);
eq("sans cache : périmé", S.publique(null, ctx, maintenant).perime, true);
eq("CIP à relire : 20 diapositives et le 2e dosage de Mounjaro", S.cipsDuCache(cacheInterne).length, 21);

// ── 6. Calcul (Odoo en lecture seule, simulé) ──
const appelsOdoo = [];
const lectures = new Set(["read_group", "read", "search_read", "search", "search_count", "fields_get"]);
const commandes = { 501: "2026-10-05 08:00:00", 502: "2026-10-18 22:30:00", 503: "2026-10-19 09:00:00" };   // 502 = 19/10 à 0 h 30 à Paris
const odooFictif = async (model, method, args, kw = {}) => {
  appelsOdoo.push(`${model}.${method}`);
  if (!lectures.has(method)) throw new Error(`écriture Odoo interdite : ${method}`);
  if (model === "sale.order.line" && method === "read_group" && args[1].length === 3) return classement.map(c => ({ product_id: [c.pid, "x"], order_id: c.cmd, order_partner_id: c.ph, product_uom_qty: c.qte }));
  if (model === "sale.order.line" && method === "read_group") return [{ product_id: [1, "x"], order_id: 492 }];
  if (model === "product.product" && method === "read") return args[0].map(id => ({ id, default_code: fiches[id]?.cip, name: fiches[id]?.nom, manufacturer_id: [fiches[id]?.laboId, fiches[id]?.labo], stup: !!fiches[id]?.stup, active: fiches[id]?.active !== false, sale_ok: true }));
  if (model === "sale.order.line" && method === "search_read") return kw.offset ? [] : [{ product_id: [1, "x"], order_id: [501, "S1"] }, { product_id: [1, "x"], order_id: [502, "S2"] }, { product_id: [1, "x"], order_id: [503, "S3"] }];
  if (model === "sale.order" && method === "read") return args[0].map(id => ({ id, date_order: commandes[id] }));
  throw new Error(`appel inattendu ${model}.${method}`);
};
const appelsSb = [];
const sbFictif = async (path) => {
  appelsSb.push(path.split("?")[0]);
  if (path.startsWith("odoo_catalog")) return Object.values(catalogue);
  if (path.startsWith("elixir_products")) return curees;
  if (path.startsWith("ec_config")) return [{ key: "display_config", value: JSON.stringify({ hiddenTabs: ["ulabs"] }) }, { key: "admin_promos", value: [] }];
  if (path.startsWith("elixir_campaigns")) return [];
  if (path.startsWith("elixir_pharmacies")) return path.includes(encodeURIComponent("compte@pharmacie-a.test")) ? [{ email: "compte@pharmacie-a.test" }] : [];
  throw new Error(`table inattendue ${path}`);
};
const kv = new Map();
const deps = (extra = {}) => ({
  odoo: odooFictif, sb: sbFictif, quotaProducts: async () => [{ product_id: 5, cip: C(5) }], justifs: async () => new Set([C(6)]),
  kvGet: async (k) => (kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : null), kvSet: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); },
  verrou: async (fn) => ({ resultat: await fn() }), rateLimit: () => null,
  verifierJeton: async (t) => ({ "jeton-a": { id: "a", email: "compte@pharmacie-a.test" }, "jeton-sans-compte": { id: "c", email: "inconnu@ailleurs.test" },
    "jeton-admin": { id: "adm", email: "equipe@elixir.test", isAdmin: true } })[t] || null,
  maintenant: () => maintenant, ...extra,
});
{
  const { cache } = await calculerClassement(deps());
  eq("calcul : seules des méthodes de lecture d'Odoo", appelsOdoo.every(a => lectures.has(a.split(".").pop())), true);
  eq("calcul : 12 diapositives, Mounjaro en tête", [cache.slides.length, cache.slides[0].famille], [12, "MOUNJARO"]);
  // série : 501 le 5/10, 502 le 19/10 à 0 h 30 (Paris), 503 le 19/10 → 1 le premier jour, 2 le dernier
  eq("courbe par jour de Paris", [cache.slides[0].serie_15j[0], cache.slides[0].serie_15j[14], cache.slides[0].serie_15j[13]], [0.5, 1, 0]);
  eq("période : 15 jours de Paris", [cache.periode.du, cache.periode.au, cache.periode.jours.length], ["2026-10-05", "2026-10-19", 15]);
}

// ── 7. GET accueil-offres ──
const evt = (jeton, methode = "GET") => ({ httpMethod: methode, headers: jeton ? { authorization: `Bearer ${jeton}`, origin: "https://elixir-commande.expepharma.com" } : {} });
const appel = async (jeton, extra, methode) => { const r = await creerGet(deps(extra))(evt(jeton, methode)); return { statut: r.statusCode, corps: r.body ? JSON.parse(r.body) : null, entetes: r.headers || {} }; };
{
  kv.clear(); appelsSb.length = 0; appelsOdoo.length = 0;
  let r = await appel(null);
  eq("sans jeton → 401 reconnexion, rien lu", [r.statut, r.corps.error, appelsSb.length, appelsOdoo.length], [401, "reconnexion", 0, 0]);
  r = await appel("jeton-faux");
  eq("jeton refusé → 401", r.statut, 401);
  r = await appel("jeton-a", { verifierJeton: async () => { throw Object.assign(new Error("panne"), { indisponible: true }); } });
  eq("Supabase Auth en panne → 503, jamais 401", [r.statut, r.corps.error], [503, "indisponible"]);
  r = await appel("jeton-sans-compte");
  eq("connecté sans compte pharmacie → 403 fiche, aucune lecture d'Odoo", [r.statut, r.corps.error, appelsOdoo.length], [403, "fiche", 0]);
  r = await appel("jeton-a", undefined, "POST");
  eq("POST → 405", r.statut, 405);
  // premier appel sans cache : calcul sous verrou, cache écrit, réponse publique
  r = await appel("jeton-a");
  eq("pharmacie : 200, cache privé de 60 s, calcul au premier appel", [r.statut, r.entetes["Cache-Control"], r.corps.slides.length, r.corps.perime, kv.has("accueil:offres"), kv.has("accueil:dernier_passage")],
    [200, "private, max-age=60", 12, false, true, true]);
  eq("pas de compte exact ni de stock dans la réponse", /nb_commandes|nb_pharmacies|"available"|_cmd|_rythme|_pid/.test(JSON.stringify(r.corps)), false);
  const odooAvant = appelsOdoo.length;
  r = await appel("jeton-admin");
  eq("admin : 200, cache relu (Odoo non rappelé)", [r.statut, r.corps.slides[0].famille, appelsOdoo.length - odooAvant], [200, "MOUNJARO", 0]);
  // cache absent et Odoo en panne : vitrine vide « périmée », rien écrit
  kv.clear();
  r = await appel("jeton-a", { odoo: async () => { throw new Error("Odoo injoignable"); } });
  eq("cache absent, Odoo en panne → 200 perime, rien écrit", [r.statut, r.corps.perime, r.corps.slides.length, kv.has("accueil:offres")], [200, true, 0, false]);
  // verrou pris par un autre appel : perime sans attendre
  r = await appel("jeton-a", { verrou: async () => ({ occupe: true }) });
  eq("calcul déjà en cours ailleurs → perime", [r.statut, r.corps.perime], [200, true]);
  // cache ancien (> 36 h) : perime
  kv.set("accueil:offres", { ...cacheInterne, genere_le: "2026-10-17T00:00:00.000Z" });
  r = await appel("jeton-a");
  eq("cache de plus de 36 h → perime", [r.corps.perime, r.corps.slides.length], [true, 0]);
}

// ── 8. Fonction planifiée ──
{
  kv.clear();
  kv.set("accueil:offres", { ...cacheInterne, genere_le: "ancien" });
  await creerRefresh(deps({ odoo: async () => { throw new Error("Odoo injoignable"); } }))();
  eq("Odoo en panne : cache conservé, journal écrit", [kv.get("accueil:offres").genere_le, /Erreur/.test(kv.get("accueil:dernier_passage").journal.join(" "))], ["ancien", true]);
  appelsOdoo.length = 0;
  await creerRefresh(deps())();
  eq("passage réussi : cache remplacé, Odoo en lecture seule", [kv.get("accueil:offres").slides.length, kv.get("accueil:offres").genere_le, appelsOdoo.every(a => lectures.has(a.split(".").pop()))],
    [12, new Date(maintenant).toISOString(), true]);
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
