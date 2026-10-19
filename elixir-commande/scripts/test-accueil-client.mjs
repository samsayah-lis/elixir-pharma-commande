// Tests de la page d'accueil « La Tête de gondole » (navigateur) : node scripts/test-accueil-client.mjs
// Hors ligne, sans navigateur : src/components/accueil/resolution.js et applyTiers de src/tiers.jsx (celui du panier) sont
// assemblés par esbuild (React remplacé par un module vide : seul applyTiers sert), puis importés.
// Ce que l'interface garde du GET : la SÉLECTION ; prix, paliers, menu, règle de quantité et lot sont recalculés ici avec
// le catalogue du site. Chaque cas vérifie que le montant affiché sur le bouton (lot.total) est ce que le panier facture :
// cartItems d'App.jsx (applyTiers(prix, paliers, quantité).pn × quantité ; ligne hors catalogue : mêmes calculs avec les
// paliers de la ligne), la règle de quantité étant celle de regleSaisie / getStepMin d'App.jsx (recopiées ci-dessous ;
// le test échoue si les lignes recopiées ne sont plus dans App.jsx).
//  • colis Stratège avec palier (Spasfon 240 × 1,67), palier Master, gamme blanche ; produit hors menu (Saisie) ;
//  • menu promo à remise en texte (« -10% »), prix public absent (pas de remise négative) ;
//  • écartés : campagne, justificatif, rupture d'un produit de menu, menu non ouvrable ; dosage principal retiré ;
//  • exclusion de l'admin : toute la famille (principal ou dosage), la réserve suivante entre ; 10 diapositives au plus ;
//  • catalogue pas encore chargé : prix du GET ; offres échues retirées ; liste de diapositives qui raccourcit.
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("..", import.meta.url).pathname;
const sortie = await build({
  stdin: { contents: 'export * from "./src/components/accueil/resolution.js"; export { applyTiers } from "./src/tiers.jsx";', resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false,
  loader: { ".jsx": "jsx", ".js": "jsx" }, jsx: "transform", logLevel: "silent",
  plugins: [{ name: "sans-react", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "export default {};", loader: "js" }));
  } }],
});
const dossier = mkdtempSync(join(tmpdir(), "test-accueil-client-"));
const fichier = join(dossier, "resolution.mjs");
writeFileSync(fichier, sortie.outputFiles[0].text);
const R = await import(pathToFileURL(fichier).href);
rmSync(dossier, { recursive: true, force: true });

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── Règles d'App.jsx recopiées (vérifiées présentes dans App.jsx) ──
const APP = readFileSync(join(RACINE, "src/App.jsx"), "utf8");
const LIGNES_APP = [
  'if (catKey === "stratege") return { step: p.colis||1, min: p.colis||1, multiple: p.colis||1 };',
  'if (catKey === "master")   return { step: p.palier||1, min: p.palier||1, multiple: p.palier||1 };',
  'if (catKey === "blanche")  return { step: p.colis||1, min: p.colis||1, multiple: p.colis||1 };',
  'return multiple > 1 || r.min > 1 ? { step: r.step, min: r.min, multiple, rayon: c.label || SECTION_META[catKey]?.label || catKey } : null;',
  "const tiered = camp ? { pn: basePn, tier: null, next: null } : applyTiers(basePn, p.price_tiers, qty);",
  "total: tiered.pn * qty,",
  "const tiered = applyTiers(s.pn ?? null, s.tiers, s.qty);",
  "total: (pn || 0) * s.qty,",
  "const arrondi = Math.round(qty / r.multiple) * r.multiple;",
];
eq("règles recopiées toujours présentes dans App.jsx", LIGNES_APP.filter(l => !APP.includes(l)), []);
const getStepMin = (catKey, p) => {
  if (catKey === "stratege") return { step: p.colis || 1, min: p.colis || 1, multiple: p.colis || 1 };
  if (catKey === "master") return { step: p.palier || 1, min: p.palier || 1, multiple: p.palier || 1 };
  if (catKey === "blanche") return { step: p.colis || 1, min: p.colis || 1, multiple: p.colis || 1 };
  return { step: 1, min: 0, multiple: 1 };
};
const regleSaisieDe = (catalogue) => (cip) => {
  for (const [catKey, c] of Object.entries(catalogue)) {
    const p = (c.products || []).find(x => x.cip === cip);
    if (!p) continue;
    const r = getStepMin(catKey, p);
    const multiple = r.multiple > 1 ? r.multiple : (r.step > 1 ? r.step : 1);
    return multiple > 1 || r.min > 1 ? { step: r.step, min: r.min, multiple, rayon: c.label } : null;
  }
  return null;
};
const arrondiSaisie = (qty, r) => { const a = Math.round(qty / r.multiple) * r.multiple; return a > 0 && r.min > 0 ? Math.max(r.min, a) : a; };
// ce que le panier facture pour un ajout de la vitrine (ajouterDepuisSaisie → addItemToCart → cartItems)
function factureDuPanier(catalogue, offre, qty) {
  const regle = regleSaisieDe(catalogue)(offre.cip);
  const q = regle ? arrondiSaisie(qty, regle) : qty;
  for (const [, c] of Object.entries(catalogue)) {
    const p = (c.products || []).find(x => x.cip === offre.cip);
    if (p) return { qty: q, total: R.applyTiers(p.pn, p.price_tiers, q).pn * q };
  }
  // ligne hors catalogue (specialItems) : pn et paliers envoyés par la vitrine
  return { qty: q, total: (R.applyTiers(offre.pn ?? null, offre.price_tiers || null, q).pn || 0) * q };
}
const r2 = (x) => Math.round(x * 100) / 100;

// ── Données ──
const C = (n) => `34009000000${String(n).padStart(2, "0")}`;
const catalogue = {
  obeso: { label: "🔥🔥Mounjaro / Wegovy", accent: "#7c3aed", products: [
    { cip: C(1), name: "MOUNJARO 5mg", pv: 221.32, pn: 210.03, pct: 5.1, remise_eur: 11.29 },
    { cip: C(2), name: "MOUNJARO 2,5mg", pv: 163.7, pn: 155.35, pct: 5.1, remise_eur: 8.35 } ] },
  stratege: { label: "Sélection Stratège", accent: "#0f766e", products: [
    { cip: C(3), name: "SPASFON CPR", pv: 2.1, pn: 1.7, pct: 19, colis: 240, price_tiers: [{ min_qty: 240, price: 1.67 }] },
    { cip: C(4), name: "VENTOLINE 100µG", pv: 3.24, pn: 3.01, pct: 7.1, colis: 120 } ] },
  master: { label: "Sélection Master", accent: "#b45309", products: [{ cip: C(5), name: "MASTER 6", pv: 10, pn: 8, pct: 20, palier: 6, price_tiers: [{ min_qty: 12, price: 7.5 }] }] },
  blanche: { label: "Gamme Blanche", accent: "#64748b", products: [{ cip: C(6), name: "BLANCHE 24", pv: 2, pn: 1.5, pct: 25, colis: 24 }] },
  camp_rentree: { label: "Campagne rentrée", accent: "#059669", isCampaign: true, products: [{ cip: C(7), name: "CAMPAGNE", pv: 10, pn: 9 }] },
  masque: { label: "Menu masqué", accent: "#000", products: [{ cip: C(8), name: "CACHÉ", pv: 10, pn: 9 }] },
  promo_1792040000000: { label: "Culottes et Cup", accent: "#a855f7", isPromo: true, products: [
    { cip: C(9), name: "CULOTTE M", pv: 14.4, pn: 12.96, pct: "-10%" },
    { cip: C(10), name: "VASELINE 100", pv: null, pn: 1.59, pct: null } ] },
  saisie: { label: "Saisie de commande", accent: "#2d9cbc", products: [] },
};
const offreGET = (cip, extra = {}) => ({ cip, nom_court: `NOM ${cip}`, nom_panier: `NOM ${cip}`, pv: 99, pn: 98, pct: 1, remise_eur: 1, price_tiers: null,
  regle_qte: { step: 1, min: 1, multiple: 1 }, lot: { qte: 1, pu: 98, total: 98 }, stock: { en_stock: true, niveau: "ok" }, menu: { key: "saisie", label: "Saisie de commande" },
  popularite: "Plus de 50 pharmacies", boite: { marque: "X" }, ...extra });
const diapo = (famille, cip, variantes = [], extra = {}) => ({ ...offreGET(cip, extra), famille, labo: "Labo", tendance_pct: 3, nouveau: false, serie_15j: [0, 1],
  variantes: variantes.map(([c, libelle, popularite]) => ({ ...offreGET(c, { popularite }), libelle, principal: c === cip })) });
const donnees = {
  slides: [
    diapo("MOUNJARO", C(1), [[C(2), "2,5 mg", "Plus de 200 pharmacies"], [C(1), "5 mg", "Plus de 200 pharmacies"]]),
    diapo("SPASFON", C(3)), diapo("VENTOLINE", C(4)), diapo("MASTER", C(5)), diapo("BLANCHE", C(6)), diapo("CAMPAGNE", C(7)),
    diapo("CACHE", C(8)), diapo("CULOTTE", C(9)), diapo("VASELINE", C(10)),
    diapo("DUPIXENT", C(11), [], { pn: 1055.25, pv: 1080.35, price_tiers: [{ min_qty: 2, price: 1050 }] }),
    diapo("JUSTIF", C(12)),
    diapo("EYLEA", C(13)),
  ],
  reserves: [diapo("RESERVE1", C(14)), diapo("RESERVE2", C(15)), diapo("RESERVE3", C(16))],
};
const ctx = (extra = {}) => ({
  catalogue, catalogueCharge: true, stockData: {}, justifProducts: { [C(12)]: { labo: "Takeda" } },
  menuOuvrable: (k) => k !== "masque", regleSaisie: regleSaisieDe(catalogue),
  estCampagne: (k) => !!catalogue[k]?.isCampaign, photos: {}, teinte: (k) => catalogue[k]?.accent || "#2d9cbc", exclus: new Set(), ...extra,
});
const parFamille = (slides) => Object.fromEntries(slides.map(s => [s.famille, s]));

// ── 1. Résolution et lot = ce que le panier facture ──
{
  const sl = R.construireDiapos(donnees, ctx());
  const F = parFamille(sl);
  eq("10 diapositives au plus, dans l'ordre (écartés : campagne, menu masqué, justificatif)", sl.map(s => s.famille),
    ["MOUNJARO", "SPASFON", "VENTOLINE", "MASTER", "BLANCHE", "CULOTTE", "VASELINE", "DUPIXENT", "EYLEA", "RESERVE1"]);
  for (const s of sl) {
    for (const o of [s.principal, ...s.variantes]) {
      const f = factureDuPanier(catalogue, o, o.lot.qte);
      eq(`${s.famille} ${o.cip} : quantité du lot = quantité au panier, montant = facture`, [o.lot.qte, o.lot.total], [f.qty, r2(f.total)]);
    }
  }
  eq("Spasfon : carton de 240 au prix du palier (240 × 1,67)", F.SPASFON.principal.lot, { qte: 240, pu: 1.67, total: 400.8 });
  eq("Ventoline : carton de 120 au prix du menu", F.VENTOLINE.principal.lot, { qte: 120, pu: 3.01, total: 361.2 });
  eq("Master : palier de 6, palier de prix non atteint", F.MASTER.principal.lot, { qte: 6, pu: 8, total: 48 });
  eq("Gamme blanche : colis de 24", F.BLANCHE.principal.lot, { qte: 24, pu: 1.5, total: 36 });
  eq("menu et prix du catalogue, pas ceux du GET", [F.MOUNJARO.principal.menu, F.MOUNJARO.principal.pn, F.MOUNJARO.principal.nom_panier], [{ key: "obeso", label: "Mounjaro / Wegovy" }, 210.03, "MOUNJARO 5mg"]);
  eq("Mounjaro : deux dosages, 5 mg principal", F.MOUNJARO.variantes.map(v => [v.cip, v.principal]), [[C(2), false], [C(1), true]]);
  eq("promo à remise en texte (« -10% ») : remise de 10 %, 1,44 € ", [F.CULOTTE.principal.pct, F.CULOTTE.principal.remise_eur], [10, 1.44]);
  eq("promo sans prix public : pas de remise négative", [F.VASELINE.principal.pct, F.VASELINE.principal.remise_eur], [0, null]);
  eq("produit hors menu : Saisie, prix et paliers du GET, 1 boîte", [F.DUPIXENT.principal.menu.key, F.DUPIXENT.principal.lot], ["saisie", { qte: 1, pu: 1055.25, total: 1055.25 }]);
  eq("ligne Saisie : 2 boîtes au palier, comme le panier", r2(factureDuPanier(catalogue, F.DUPIXENT.principal, 2).total), 2100);
}

// ── 2. Retraits ──
{
  const sl = R.construireDiapos(donnees, ctx({ stockData: { [C(1)]: { dispo: 0 } } }));
  eq("dosage principal en rupture : l'autre dosage devient principal, sans variantes", [sl[0].famille, sl[0].principal.cip, sl[0].variantes.length], ["MOUNJARO", C(2), 0]);
  const sansCamp = R.construireDiapos(donnees, ctx({ estCampagne: () => false })).map(s => s.famille);
  eq("campagne écartée seulement par estCampagne", [sansCamp.includes("CAMPAGNE"), R.construireDiapos(donnees, ctx()).map(s => s.famille).includes("CAMPAGNE")], [true, false]);
  eq("produit de menu en rupture retiré, la réserve suivante entre", R.construireDiapos(donnees, ctx({ stockData: { [C(4)]: { dispo: 0 } } })).map(s => s.famille).slice(-2), ["RESERVE1", "RESERVE2"]);
}

// ── 3. Exclusions de l'admin : toute la famille ──
{
  const ex = (cips) => R.construireDiapos(donnees, ctx({ exclus: new Set(cips) })).map(s => s.famille);
  eq("principal exclu : toute la famille (plus de Mounjaro en 2,5 mg), la réserve suivante entre", [ex([C(1)]).includes("MOUNJARO"), ex([C(1)]).at(-1)], [false, "RESERVE2"]);
  eq("dosage exclu (ancien principal) : toute la famille aussi", ex([C(2)]).includes("MOUNJARO"), false);
  eq("rien d'exclu : Mounjaro présent", ex([]).includes("MOUNJARO"), true);
}

// ── 4. Catalogue pas encore chargé, photo de l'admin ──
{
  const sl = R.construireDiapos(donnees, ctx({ catalogueCharge: false }));
  eq("catalogue pas chargé : prix et règle du GET (ajout désactivé dans l'interface)", [sl[0].principal.pn, sl[0].principal.regle, sl[0].principal.lot], [98, { step: 1, min: 1, multiple: 1 }, { qte: 1, pu: 98, total: 98 }]);
  const avecPhoto = R.construireDiapos(donnees, ctx({ photos: { [C(13)]: "https://images.test/eylea.png" } }));
  eq("photo choisie dans l'admin pour un produit sans photo", parFamille(avecPhoto).EYLEA.principal.image_url, "https://images.test/eylea.png");
}

// ── 5. Nombres, offres en cours, produit actif ──
eq("nombres saisis", ["-10%", "38%", "12,96", 4.5, "", null, "abc"].map(R.nombre), [-10, 38, 12.96, 4.5, null, null, null]);
{
  const promos = [{ id: 1, active: true, endDate: "2026-09-25" }, { id: 2, active: true, endDate: "2026-10-20" }, { id: 3, active: true }, { id: 4, active: false }];
  eq("offres du moment : actives et pas échues (jour de fin compris)", R.promosEnCours(promos, "2026-10-20").map(p => p.id), [2, 3]);
  eq("jour de Paris", R.jourParis(Date.parse("2026-10-19T22:30:00Z")), "2026-10-20");
}
{
  const dix = Array.from({ length: 10 }, (_, i) => ({ famille: `F${i}` }));
  const neuf = dix.filter(s => s.famille !== "F3");
  eq("produit actif suivi par sa famille quand la liste raccourcit avant lui", R.indexActif(neuf, "F9", 9), 8);
  eq("liste raccourcie sous le produit actif (n°10 affiché, 9 restants) : dernier produit, jamais hors liste", R.indexActif(dix.slice(0, 9), "F9", 9), 8);
  eq("famille disparue au milieu : la place qu'elle occupait", R.indexActif(neuf, "F3", 3), 3);
  eq("liste de 3 après 10 : borné", R.indexActif(dix.slice(0, 3), "F7", 7), 2);
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
