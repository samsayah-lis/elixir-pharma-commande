// Tests de la jauge des paliers de quantité (src/tiers.jsx : jaugePaliers, vuesJauge, positionJauge, texteJauge ; rendu :
// src/components/JaugePaliers.jsx ; placements : src/App.jsx, src/components/OrderEntry.jsx) : node scripts/test-paliers.mjs
// Demande de Zineb (22/10/2026), capture d'un autre site de commande : « est ce que tu peux presenter la partie des paliers comme ça ».
// Hors ligne, rien n'est lu ni écrit ailleurs qu'en mémoire. Contrôles (corrigés après la revue du 22/10/2026) :
//  • étapes : quantité commandable (au pas du colis, au minimum), prix d'applyTiers À CETTE quantité ; palier atteint dès la
//    première quantité commandable (colis Stratège) : pas de jauge, le petit badge reste ; paliers à rebours, plafond ;
//  • prix : la jauge contre la VRAIE formule du panier (branche catalogue de cartItems, lue dans src/App.jsx) pour chaque produit
//    à paliers des données figées du banc et chaque quantité ; Saisie : ligne de destination (panierSaisie, lue dans src/App.jsx),
//    quantité déjà au panier, campagne ;
//  • incitation : « Dès N : prix HT l'unité (−X %) » à 0, « Plus que N pour … », « Prix palier appliqué : … » ; cartes : jamais
//    « Plus que N » seul ;
//  • curseur, pointillés, étapes montrées (mini 1, compacte 2, complète 3), accessibilité (annonce aux changements d'état
//    seulement, légende du tableau, palier nommé « Mettre la quantité à N : … »), détail ;
//  • clic sur un palier → quantité que les vraies fonctions de quantité (setQty, arrondiSaisie, applyQty des cartes) laissent telle
//    quelle ; Saisie : quantité qui manque quand une partie est déjà au panier ;
//  • placements (texte des sources) : prix unitaire des tableaux = prix du panier, modes ligne / complète, rupture, panier, frappe.
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = new URL("..", import.meta.url).pathname;
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };
const espaces = (t) => String(t).replace(/[  ]/g, " ").replace(/&#x27;/g, "'");   // espaces insécables, apostrophe du HTML

// ── Module de la jauge : avec React (rendu HTML) et avec un React d'essai (arbre d'éléments, clics appelés à la main) ──
const charge = async (entree, plugins = []) => {
  const lot = await build({ stdin: { contents: entree, resolveDir: join(RACINE, "src"), loader: "jsx" }, bundle: true, write: false, format: "esm",
    platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins });
  return import(`data:text/javascript;base64,${Buffer.from(lot.outputFiles[0].text).toString("base64")}`);
};
const M = await charge(`import React from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import JaugePaliers from "./components/JaugePaliers.jsx";
export * from "./tiers.jsx";
export { estPeremption, idSpecial, champsPeremption, COULEUR_PEREMPTION } from "./peremption-panier.js";
export const rendre = (props) => renderToStaticMarkup(React.createElement(JaugePaliers, props));`);
const E = await charge(`export { default as JaugePaliers } from "./components/JaugePaliers.jsx";`, [{ name: "react-essai", setup(b) {
  b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "essai" }));
  b.onLoad({ filter: /.*/, namespace: "essai" }, () => ({ loader: "js", contents: `
    const el = (type, props) => ({ type, props: props || {} });
    export const jsx = el, jsxs = el, Fragment = "fragment";
    export default { useState: (v) => [typeof v === "function" ? v() : v, () => {}], useId: () => "id-essai" };` }));
} }]);
const { applyTiers, jaugePaliers, vuesJauge, positionJauge, texteJauge, rendre } = M;
const elements = (n, out = []) => {
  if (Array.isArray(n)) { n.forEach(x => elements(x, out)); return out; }
  if (!n || typeof n !== "object") return out;
  out.push(n); elements(n.props?.children, out); return out;
};
// clics sur les paliers (boutons ex-jauge__etape, ou « Passer à N » de la variante ligne) → quantités reçues par onChoisir
const clics = (props, cls = "ex-jauge__etape") => {
  const recus = [];
  const arbre = E.JaugePaliers({ ...props, onChoisir: (q) => recus.push(q) });
  elements(arbre).filter(e => e.type === "button" && new RegExp(cls).test(e.props.className)).forEach(b => b.props.onClick());
  return recus;
};

// ── Vraies fonctions, lues dans src/App.jsx : quantités (zones protégées), panier (cartItems), destination de la Saisie ──
const app = readFileSync(join(RACINE, "src/App.jsx"), "utf8");
const saisie = readFileSync(join(RACINE, "src/components/OrderEntry.jsx"), "utf8");
const extrait = (re, nom) => { const m = app.match(re); if (!m) throw new Error(`${nom} introuvable dans src/App.jsx`); return m[0]; };
const setQty = (() => {
  const src = extrait(/ {2}const setQty = \(key, val, step = 1, min = 0, multiple = 1\) => \{[\s\S]*?\n {2}\};/, "setQty");
  return (val, step, min, multiple) => { let q = null; new Function("setQuantities", `${src}; return setQty;`)((f) => { q = f({}).k; })("k", val, step, min, multiple); return q; };
})();
const arrondiSaisie = new Function(`${extrait(/ {2}const arrondiSaisie = \(qty, r\) => \{[\s\S]*?\n {2}\};/, "arrondiSaisie")}; return arrondiSaisie;`)();
const applyQtyCarte = (() => {
  const src = extrait(/ {28}const applyQty = \(raw\) => \{[\s\S]*?\n {28}\};/, "applyQty (cartes)");
  return (raw, m, stepMin) => { let q = null; new Function("m", "stepMin", "key", "setQuantities", "syncGroup", `${src}; return applyQty;`)(m, stepMin, "k", (f) => { q = f({}).k; }, () => {})(raw); return q; };
})();
// monde d'essai : catalogue { menu: { products } }, campagnes ; groupes de campagne vides (gratuités hors sujet : le prix seul compte)
const monde = (CATALOG, campagnes = {}) => {
  const getCampaign = (k) => campagnes[k] || null, buildGroupes = () => [], campGetGroupe = () => null, campGratuite = () => ({ livrées: 0 });
  const getStepMin = new Function("getCampaign", "buildGroupes", "campGetGroupe", `${extrait(/ {2}const getStepMin = \(catKey, p\) => \{[\s\S]*?\n {2}\};/, "getStepMin")}; return getStepMin;`)(getCampaign, buildGroupes, campGetGroupe);
  const getStep = (k, p) => getStepMin(k, p).step;
  const corps = extrait(/ {2}const cartItems = useMemo\(\(\) => \{[\s\S]*?\n {2}\}, \[quantities, CATALOG_WITH_ADMIN, specialItems\]\);/, "cartItems")
    .replace(/^ {2}const cartItems = useMemo\(\(\) => \{/, "").replace(/\n {2}\}, \[quantities, CATALOG_WITH_ADMIN, specialItems\]\);$/, "");
  const cartItems = new Function("CATALOG_WITH_ADMIN", "quantities", "specialItems", "getCampaign", "buildGroupes", "campGratuite", "applyTiers", "getStep",
    "estPeremption", "idSpecial", "champsPeremption", "COULEUR_PEREMPTION", corps);
  const panierSaisie = new Function("CATALOG_WITH_ADMIN", "quantities", "specialItems", "getCampaign", "idSpecial",
    `${extrait(/ {2}const panierSaisie = \(cip\) => \{[\s\S]*?\n {2}\};/, "panierSaisie")}; return panierSaisie;`);
  return {
    getStepMin, getStep,
    panier: (quantities, special = []) => cartItems(CATALOG, quantities, special, getCampaign, buildGroupes, campGratuite, applyTiers, getStep, M.estPeremption, M.idSpecial, M.champsPeremption, M.COULEUR_PEREMPTION),
    destination: (cip, quantities = {}, special = []) => panierSaisie(CATALOG, quantities, special, getCampaign, M.idSpecial)(cip),
  };
};
// réglage de la jauge de la Saisie, comme OrderEntry (dest, deja, arrondi au colis, tarif de la ligne du panier)
const reglageSaisie = (dest, p, qty, regle) => {
  const deja = dest?.deja || 0, qAjout = regle ? arrondiSaisie(qty, regle) : qty;
  const tarif = dest || { base: p.discounted_price || p.list_price, pv: p.list_price, tiers: p.price_tiers };
  return { deja, qAjout, tarif, reglage: { base: tarif.base, pv: tarif.pv, tiers: tarif.tiers, qte: deja + qAjout, pas: regle?.multiple || 1, min: regle?.min || 0 } };
};

// ── Données : paliers réels (relevés du banc, Odoo liste n° 5) et cas construits ──
const DAFALGAN = { base: 0.83, pv: 1.06, tiers: [{ pct: 23.6, price: 0.81, min_qty: 20 }] };                 // Sélection Master
const DAFALGAN_160 = { base: 0.83, pv: 1.06, tiers: [{ pct: 24.5, price: 0.8, min_qty: 160 }], pas: 160 };   // Stratège, colis 160
const BETADINE = { base: 1.43, pv: 1.66, tiers: [{ pct: 15.1, price: 1.41, min_qty: 60 }], pas: 60 };
const DOLIPRANE_EFF = { base: 0.83, pv: 1.06, tiers: [{ pct: 24.5, price: 0.8, min_qty: 128 }], pas: 144 };
const MONOPROST = { base: 7.28, pv: 7.62, tiers: [{ pct: 5, price: 7.24, min_qty: 20 }, { pct: 5, price: 7.24, min_qty: 32 }], pas: 32 };
const DIFFUK = { base: 1.56, pv: 1.79, tiers: [{ pct: 13.4, price: 1.55, min_qty: 30 }] };
const QUATRE = { base: 10, pv: 12, tiers: [{ min_qty: 120, price: 8 }, { min_qty: 6, price: 9.5 }, { min_qty: 12, price: 9 }, { min_qty: 48, price: 8.5 }] };
const REBOURS = { base: 7.28, pv: 7.62, tiers: [{ min_qty: 20, price: 7.0 }, { min_qty: 32, price: 7.24 }] };

// 1. Étapes : quantité commandable, prix à cette quantité, paliers inévitables
{
  const j = jaugePaliers({ ...DAFALGAN, qte: 0 });
  eq("une étape : seuil, quantité, prix, remise, économie", j.etapes, [{ seuil: 20, qte: 20, prix: 0.81, pct: 23.6, economie: 0.4 }]);
  eq("remise sur le prix catalogue de la ligne = pct du palier en base (odoo-price-sync)", j.etapes[0].pct, DAFALGAN.tiers[0].pct);
  eq("départ : 1 unité au prix sans palier", j.depart, { qte: 1, prix: 0.83, pct: 21.7 });
  // revue : palier atteint dès le premier colis commandable → pas de jauge (le petit badge reste)
  eq("Stratège colis 160, palier 160 : pas de jauge", jaugePaliers({ ...DAFALGAN_160, qte: 0 }), null);
  eq("BETADINE colis 60, palier 60 : pas de jauge", jaugePaliers({ ...BETADINE, qte: 0 }), null);
  eq("DOLIPRANE EFF colis 144, palier 128 : pas de jauge", jaugePaliers({ ...DOLIPRANE_EFF, qte: 8 }), null);
  eq("MONOPROST colis 32, paliers 20 et 32 : pas de jauge", jaugePaliers({ ...MONOPROST, qte: 0 }), null);
  eq("DAFALGAN EFFV (pas 1) : jauge gardée", !!jaugePaliers({ ...DAFALGAN, qte: 0, pas: 1 }), true);
  eq("minimum 100, palier 50 : pas de jauge", jaugePaliers({ base: 5, tiers: [{ min_qty: 50, price: 4.5 }], qte: 0, min: 100 }), null);
  eq("MONOPROST sans colis : deux paliers au même prix = une étape", jaugePaliers({ ...MONOPROST, pas: 1, qte: 0 }).etapes.map(e => [e.seuil, e.qte]), [[20, 20]]);
  eq("paliers non triés : étapes dans l'ordre des seuils", jaugePaliers({ ...QUATRE, qte: 0 }).etapes.map(e => e.seuil), [6, 12, 48, 120]);
  eq("sans prix catalogue plus élevé : remise sur le prix sans palier", jaugePaliers({ base: 2, tiers: [{ min_qty: 10, price: 1.8 }], qte: 0 }).etapes[0].pct, 10);
  // colis 25, palier 60 : quantité commandable 75 ; premier colis (25) sous le palier : départ au prix sans palier
  const c = jaugePaliers({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 0, pas: 25 });
  eq("colis 25, palier 60 : étape à 75, départ 25 au prix sans palier", [c.etapes.map(e => [e.seuil, e.qte]), c.depart.qte, c.depart.prix], [[[60, 75]], 25, 5]);
  // premier colis déjà au premier palier : les suivants partent de ce prix (économie comprise)
  const d = jaugePaliers({ base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 100, price: 0.78 }], qte: 0, pas: 25 });
  eq("colis 25, paliers 20 et 100 : seule l'étape 100 reste, économie depuis 0,81", [d.depart.prix, d.etapes.map(e => [e.seuil, e.qte, e.prix, e.economie])], [0.81, [[100, 100, 0.78, 3]]]);
  // revue (exactitude) : un arrondi au colis qui saute un autre palier — prix de l'étape = prix à sa quantité commandable
  const s = jaugePaliers({ base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }, { min_qty: 60, price: 0.75 }], qte: 0, pas: 10 });
  eq("colis 10, paliers 20 / 24 / 60 : 24 → 30 au prix de 30", s.etapes.map(e => [e.seuil, e.qte, e.prix]), [[20, 20, 0.81], [24, 30, 0.79], [60, 60, 0.75]]);
  eq("colis 15, paliers 20 → 0,81 et 24 → 0,79 : une étape, 30 au prix de 30 (0,79, et non 0,81 du seuil 20)",
    jaugePaliers({ base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }], qte: 0, pas: 15 }).etapes.map(e => [e.seuil, e.qte, e.prix]), [[20, 30, 0.79]]);
  eq("colis 25, paliers 20 → 0,81 et 24 → 0,79 : 25 donne déjà 0,79, pas de jauge", jaugePaliers({ base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }], qte: 0, pas: 25 }), null);
  eq("colis 25, paliers à rebours (20 → 7,00 ; 24 → 7,24) : pas de jauge (25 donne 7,24)", jaugePaliers({ base: 7.28, tiers: [{ min_qty: 20, price: 7 }, { min_qty: 24, price: 7.24 }], qte: 0, pas: 25 }), null);
}

// 2. Paliers ignorés : prix au-dessus (ou égal) du prix de la ligne, min_qty < 2, prix nul
{
  const t = [{ min_qty: 10, price: 0.9 }, { min_qty: 15, price: 0.83 }, { min_qty: 1, price: 0.5 }, { min_qty: 30, price: 0 }, { min_qty: 20, price: 0.81 }];
  eq("palier au-dessus du prix, égal, min_qty 1, prix nul : ignorés", jaugePaliers({ base: 0.83, pv: 1.06, tiers: t, qte: 0 }).etapes.map(e => e.seuil), [20]);
  eq("tous les paliers au-dessus du prix : pas de jauge", jaugePaliers({ base: 0.83, tiers: [{ min_qty: 10, price: 0.9 }], qte: 5 }), null);
  eq("sans palier ni prix : pas de jauge", [jaugePaliers({ base: 0.83, tiers: null, qte: 1 }), jaugePaliers({ base: null, tiers: DAFALGAN.tiers, qte: 1 })], [null, null]);
  eq("rien n'est rendu sans étape", [rendre({ base: 0.83, tiers: [{ min_qty: 10, price: 0.9 }], qte: 5 }), rendre({ ...DAFALGAN_160, qte: 0 })], ["", ""]);
}

// 3. Prix : chaque étape au prix d'applyTiers à SA quantité (celle du clic) ; prix montré = applyTiers à chaque quantité
const controlePrix = (nom, c, jusqua) => {
  let ecarts = 0, n = 0;
  for (let q = 0; q <= jusqua; q++) {
    const j = jaugePaliers({ ...c, qte: q });
    if (!j) continue;
    n++;
    if (j.prix !== applyTiers(c.base, c.tiers, q).pn) ecarts++;
    for (const e of j.etapes) if (applyTiers(c.base, c.tiers, e.qte).pn !== e.prix) ecarts++;   // le clic donne ce prix
    if (j.prochaine && !(j.prochaine.prix < j.prix)) ecarts++;                                   // la prochaine est un gain
  }
  vrai(`${nom} : prix montrés = applyTiers de 0 à ${jusqua} (${n} quantités)`, ecarts === 0 && n > 0, `${ecarts} écart(s)`);
};
controlePrix("DAFALGAN (Master)", DAFALGAN, 60);
controlePrix("DIFFU-K (OTC)", DIFFUK, 90);
controlePrix("quatre paliers non triés", QUATRE, 300);
controlePrix("quatre paliers, colis 5", { ...QUATRE, pas: 5 }, 300);
controlePrix("colis 10, paliers 20 / 24 / 60", { base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }, { min_qty: 60, price: 0.75 }], pas: 10 }, 120);
controlePrix("colis 15, paliers 20 / 24 (arrondi qui saute un palier)", { base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }], pas: 15 }, 90);
controlePrix("colis 15, paliers à rebours 20 / 24", { base: 7.28, tiers: [{ min_qty: 20, price: 7 }, { min_qty: 24, price: 7.24 }], pas: 15 }, 90);
controlePrix("paliers à rebours", REBOURS, 80);
eq("paliers à rebours : à 40, prix facturé 7,24 (palier 32) et non 7,00", jaugePaliers({ ...REBOURS, qte: 40 }).prix, 7.24);
eq("paliers à rebours : à 20, plus de prochaine (32 est moins bon)", jaugePaliers({ ...REBOURS, qte: 20 }).prochaine, null);

// 3 bis. Contre la VRAIE formule du panier (cartItems de src/App.jsx) : données figées du banc, chaque produit et chaque quantité
{
  const f = join(RACINE, "dev-fixtures/get/products-get.json");
  if (!existsSync(f)) console.log("· dev-fixtures absent : contrôle des paliers réels du banc sauté");
  else {
    const tous = JSON.parse(readFileSync(f, "utf8")).products || [];
    const CATALOG = {};
    for (const p of tous) (CATALOG[p.section] ||= { products: [] }).products.push(p);
    const W = monde(CATALOG);
    let n = 0, ecarts = 0, sansJauge = 0, saisieEcarts = 0, cles = 0;
    for (const [k, c] of Object.entries(CATALOG)) c.products.forEach((p, i) => {
      if (!Array.isArray(p.price_tiers) || !p.price_tiers.length || p.pn == null) return;
      n++;
      const pas = W.getStep(k, p), regle = (() => { const r = W.getStepMin(k, p), m = r.multiple > 1 ? r.multiple : (r.step > 1 ? r.step : 1); return m > 1 || r.min > 1 ? { min: r.min, multiple: m } : null; })();
      const max = Math.max(...p.price_tiers.map(t => t.min_qty)) * 2;
      if (!jaugePaliers({ base: p.pn, pv: p.pv, tiers: p.price_tiers, qte: 0, pas })) sansJauge++;
      for (let q = 0; q <= max; q += pas > 1 ? pas : 1) {
        const ligne = W.panier({ [`${k}-${i}`]: q }).find(x => x.key === `${k}-${i}`);
        const j = jaugePaliers({ base: p.pn, pv: p.pv, tiers: p.price_tiers, qte: q, pas });
        if (ligne && j && j.prix !== ligne.pn) ecarts++;
        if (ligne && applyTiers(p.pn, p.price_tiers, q).pn !== ligne.pn) ecarts++;   // prix unitaire des tableaux (prixUnitaire)
        // Saisie : destination (ce menu), quantité déjà au panier = q, saisie 0 → même prix que la ligne du panier
        const dest = W.destination(p.cip, { [`${k}-${i}`]: q });
        if (dest?.deja !== q) cles++;
        const { reglage, tarif } = reglageSaisie(dest, p, 0, regle);
        const js = jaugePaliers(reglage);
        if (ligne && (applyTiers(tarif.base, tarif.tiers, q).pn !== ligne.pn || (js && js.prix !== ligne.pn))) saisieEcarts++;
      }
    });
    vrai(`banc : au moins 20 produits à paliers (${n})`, n >= 20);
    eq(`banc : ${n} produits, prix de la jauge et des tableaux = prix de la ligne de cartItems à chaque quantité`, ecarts, 0);
    eq("banc : Saisie (destination, déjà au panier) = prix de la ligne de cartItems", [saisieEcarts, cles], [0, 0]);
    eq("banc : paliers atteints dès le premier colis (Stratège, 19 produits) : sans jauge", sansJauge, 19);
  }
}

// 3 ter. Saisie : ligne de destination (panierSaisie de src/App.jsx) — déjà au panier, campagne, ligne hors catalogue
{
  const p = { cip: "3400935291035", name: "DAFALGAN", pn: 0.83, pv: 1.06, price_tiers: DAFALGAN.tiers };
  const W = monde({ master: { products: [{ cip: "1" }, p] }, ulabs: { products: [{ ...p, cip: "3400000000002" }] } }, { ulabs: { id: "ulabs", palier_remise: 33 } });
  const d = W.destination(p.cip, { "master-1": 15 });
  eq("destination : premier menu qui contient le CIP, 15 déjà au panier", d, { deja: 15, base: 0.83, pv: 1.06, tiers: DAFALGAN.tiers });
  const r = reglageSaisie(d, { list_price: 1.06, discounted_price: 0.83, price_tiers: DAFALGAN.tiers }, 0, null);
  const j = jaugePaliers(r.reglage);
  eq("15 déjà au panier, palier 20 : « Plus que 5 pour 0,81 € HT l'unité (−23,6 %) »", espaces(texteJauge(j)), "Plus que 5 pour 0,81 € HT l'unité (−23,6 %)");
  const recus = clics({ ...r.reglage, deja: 15 });
  eq("clic sur le palier : 20 au total, la Saisie pose 20 − 15 = 5", [recus, recus.map(n => Math.max(0, n - 15))], [[20], [5]]);
  vrai("OrderEntry : clic → quantité qui manque (n − deja)", saisie.includes("onChoisir={(n) => setQuantities(prev => ({ ...prev, [p.cip]: Math.max(0, n - deja) }))}"));
  // 15 + 5 au panier : cartItems facture 0,81 sur 20
  eq("15 + 5 au panier : cartItems facture 0,81 sur la ligne", W.panier({ "master-1": 20 }).find(x => x.key === "master-1").pn, 0.81);
  const camp = W.destination("3400000000002", {});
  eq("campagne : ni palier ni prix (le panier n'applique pas les paliers) → pas de jauge", [camp.tiers, camp.base, jaugePaliers(reglageSaisie(camp, p, 30, null).reglage)], [null, null, null]);
  eq("campagne : prix de la Saisie inchangé (displayPrice)", applyTiers(camp.base, camp.tiers, 30).pn ?? 0.83, 0.83);
  const s = W.destination("999", {}, [{ cip: "999", qty: 12, pn: 2, pv: 2.5, tiers: [{ min_qty: 20, price: 1.9 }] }, { cip: "999", qty: 3, pn: 1, peremption: "2026-12-01" }]);
  eq("hors catalogue : ligne du CIP (jamais la ligne péremption), ses prix et paliers", s, { deja: 12, base: 2, pv: 2.5, tiers: [{ min_qty: 20, price: 1.9 }] });
  eq("nouveau produit hors catalogue : null (prix de la Saisie)", W.destination("888", {}), null);
  // Saisie, colis 160 : frappe 80 → 160 partira (arrondiSaisie), au prix palier
  const strat = reglageSaisie(null, { list_price: 1.06, discounted_price: 0.83, price_tiers: DAFALGAN_160.tiers }, 80, { multiple: 160, min: 160 });
  eq("Saisie colis 160, frappe 80 : 160 partira, prix 0,80 (badge, pas de jauge)", [strat.qAjout, applyTiers(0.83, DAFALGAN_160.tiers, strat.reglage.qte).pn, jaugePaliers(strat.reglage)], [160, 0.8, null]);
}

// 4. Incitation : prix unitaire toujours écrit, « Dès N » à 0, « Prix palier appliqué » au meilleur prix
{
  eq("à 0 : « Dès 20 : 0,81 € HT l'unité (−23,6 %) »", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 0 }))), "Dès 20 : 0,81 € HT l'unité (−23,6 %)");
  eq("à 8 : « Plus que 12 pour 0,81 € HT l'unité (−23,6 %) »", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 8 }))), "Plus que 12 pour 0,81 € HT l'unité (−23,6 %)");
  eq("à 20 : « Prix palier appliqué : 0,81 € HT l'unité (−23,6 %) »", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 20 }))), "Prix palier appliqué : 0,81 € HT l'unité (−23,6 %)");
  eq("à 50 : toujours le prix palier", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 50 }))), "Prix palier appliqué : 0,81 € HT l'unité (−23,6 %)");
  const j = jaugePaliers({ ...QUATRE, qte: 10 });
  eq("quatre paliers, à 10 : palier 6 atteint, prochain 12, manque 2", [j.atteinte.seuil, j.prochaine.seuil, j.manque, j.prix], [6, 12, 2, 9.5]);
  eq("quatre paliers, à 130 : dernier palier", [jaugePaliers({ ...QUATRE, qte: 130 }).prochaine, espaces(texteJauge(jaugePaliers({ ...QUATRE, qte: 130 })))], [null, "Prix palier appliqué : 8,00 € HT l'unité (−33,3 %)"]);
  eq("colis 25, palier 60 : à 25, « Plus que 50 » (75 est la quantité commandable)", jaugePaliers({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 25, pas: 25 }).manque, 50);
  const h = espaces(rendre({ ...DAFALGAN, qte: 8, nom: "DAFALGAN" }));
  vrai("rendu : nombre en pastille, prix en pastille or, remise à côté", /Plus que <b class="ex-jauge__n">12<\/b> pour<span class="ex-jauge__br"><\/span> <b class="ex-jauge__prix">0,81 € HT<\/b> <span class="ex-jauge__u">l'unité <\/span>\(−23,6 %\)/.test(h), h.slice(0, 700));
  const h0 = espaces(rendre({ ...DAFALGAN, qte: 0 }));
  vrai("rendu à 0 : « Dès 20 : »", /Dès <b class="ex-jauge__n">20<\/b> :<span class="ex-jauge__br"><\/span> <b class="ex-jauge__prix">0,81 € HT<\/b>/.test(h0));
  const h20 = espaces(rendre({ ...DAFALGAN, qte: 20 }));
  vrai("rendu au dernier palier : « Prix palier appliqué : » et data-atteint, plus de pointillés", /Prix palier appliqué :<span class="ex-jauge__br"><\/span> <b class="ex-jauge__prix">0,81 € HT<\/b>/.test(h20) && /data-atteint=""/.test(h20) && !/ex-jauge__tirets/.test(h20) && /ex-jauge__tirets/.test(h));
  // cartes (mini) : jamais « Plus que N » seul (se lisait « plus que N en stock »)
  const mini = (q) => espaces(rendre({ ...DIFFUK, qte: q, variante: "mini" })).match(/<span class="ex-jauge__incitation">(.*?)<\/span><\/div>/)?.[1].replace(/<[^>]+>/g, "");
  eq("mini : « Dès 30 : 1,55 € », « Encore 18 pour 1,55 € », « Prix palier 1,55 € »", [mini(0), mini(12), mini(30)], ["Dès 30 : 1,55 €", "Encore 18 pour 1,55 €", "Prix palier 1,55 €"]);
  vrai("mini : jamais « Plus que »", ![0, 12, 30].some(q => /Plus que/.test(espaces(rendre({ ...DIFFUK, qte: q, variante: "mini" })))));
  // ligne (tableaux à 0 ou au meilleur prix) : « Passer à N », « au lieu de » au meilleur prix
  const l0 = espaces(rendre({ ...DAFALGAN, qte: 0, variante: "ligne", onChoisir: () => {} }));
  vrai("ligne à 0 : texte, bouton « Passer à 20 » nommé", /Dès <b class="ex-jauge__n">20<\/b> :/.test(l0) && /<button type="button" class="ex-jauge__passer" aria-label="Mettre la quantité à 20 : 0,81 € HT l'unité, −23,6 %">Passer à 20<\/button>/.test(l0), l0);
  const l20 = espaces(rendre({ ...DAFALGAN, qte: 24, variante: "ligne", onChoisir: () => {} }));
  vrai("ligne au meilleur prix : « au lieu de 0,83 € », sans bouton", /\(−23,6 %\), au lieu de 0,83 €/.test(l20) && !/ex-jauge__passer/.test(l20));
  eq("ligne : « Passer à N » → quantité du palier", clics({ ...DAFALGAN, qte: 8, variante: "ligne" }, "ex-jauge__passer"), [20]);
}

// 5. Curseur, pointillés, étapes montrées
{
  eq("positions : 0 → 0 %, palier → 84 %, moitié → 42 %, 1,5 × → 100 %", [0, 20, 10, 30, 99].map(q => positionJauge([{ qte: 20 }], q)), [0, 84, 42, 100, 100]);
  eq("positions régulières entre étapes (6, 12, 48)", [6, 9, 12, 48].map(q => Math.round(positionJauge([{ qte: 6 }, { qte: 12 }, { qte: 48 }], q) * 10) / 10), [28, 42, 56, 84]);
  const h = rendre({ ...DAFALGAN, qte: 10 });
  vrai("curseur à 42 % pour 10 sur un palier de 20", /class="ex-jauge__curseur" style="left:42%"/.test(h), h.match(/ex-jauge__curseur[^>]*/)?.[0]);
  vrai("remplissage jusqu'au curseur", /class="ex-jauge__plein" style="width:42%"/.test(h));
  vrai("pointillés du curseur au palier suivant (42 % → 84 %)", /class="ex-jauge__tirets" style="left:42%;width:42%"/.test(h));
  // revue : l'étape est posée et nommée à sa quantité commandable (colis 25, palier 60 → 75)
  const c = rendre({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 25, pas: 25, onChoisir: () => {} });
  vrai("colis 25, palier 60 : étape « 75 » à 84 %, curseur 25 à 28 %", /class="ex-jauge__etape" data-etat="prochaine" style="left:84%"[^>]*><span class="ex-jauge__q">75<\/span>/.test(c) && /ex-jauge__curseur" style="left:28%"/.test(c), c.slice(0, 900));
  const etapes = (props) => [...rendre(props).matchAll(/class="ex-jauge__q">(\d+)</g)].map(m => m[1]);
  eq("complète : 3 étapes au plus (atteinte, prochaine, suivante)", etapes({ ...QUATRE, qte: 10 }), ["6", "12", "48"]);
  eq("complète à 0 : les 3 premières", etapes({ ...QUATRE, qte: 0 }), ["6", "12", "48"]);
  eq("complète au meilleur prix : les 3 dernières", etapes({ ...QUATRE, qte: 130 }), ["12", "48", "120"]);
  eq("compacte : 2 étapes (atteinte + prochaine)", etapes({ ...QUATRE, qte: 50, variante: "compacte" }), ["48", "120"]);
  eq("compacte à 0 : prochaine + suivante", etapes({ ...QUATRE, qte: 0, variante: "compacte" }), ["6", "12"]);
  eq("mini : la prochaine seulement, la dernière au meilleur prix", [etapes({ ...QUATRE, qte: 10, variante: "mini" }), etapes({ ...QUATRE, qte: 200, variante: "mini" })], [["12"], ["120"]]);
  eq("vuesJauge : fenêtre bornée à la fin", vuesJauge(jaugePaliers({ ...QUATRE, qte: 60 }), 3).map(e => e.seuil), [12, 48, 120]);
  eq("états des étapes à 10 : atteinte, prochaine, suite", [...rendre({ ...QUATRE, qte: 10 }).matchAll(/data-etat="(\w+)"/g)].map(m => m[1]), ["atteinte", "prochaine", "suite"]);
  vrai("étiquette : prix, remise « · −X % » (montrée sur ordinateur seulement, CSS)", /<span class="ex-jauge__remise">0,81 €<span class="ex-jauge__rp"> · −23,6 %<\/span><\/span>/.test(espaces(h)));
}

// 6. Accessibilité et détail
{
  const h = espaces(rendre({ ...DAFALGAN, qte: 8, nom: "DAFALGAN 1000MG", onChoisir: () => {} }));
  vrai("groupe nommé avec le produit", /role="group" aria-label="Prix par quantité : DAFALGAN 1000MG"/.test(h));
  vrai("palier : bouton « Mettre la quantité à 20 : 0,81 € HT l'unité, −23,6 % »", /<button type="button" class="ex-jauge__etape" data-etat="prochaine"[^>]*aria-label="Mettre la quantité à 20 : 0,81 € HT l'unité, −23,6 %"/.test(h), h.match(/<button type="button" class="ex-jauge__etape[^>]*>/)?.[0]);
  vrai("incitation visible sans aria-live", /<span class="ex-jauge__incitation">/.test(h) && !/ex-jauge__incitation" aria-live/.test(h));
  const lu = (q) => espaces(rendre({ ...DAFALGAN, qte: q })).match(/<span class="ex-lecteur" aria-live="polite">([^<]*)<\/span>/)?.[1];
  eq("annonce : même texte de 0 à 19 (rien n'est relu à chaque touche), change au palier", [lu(0), lu(8), lu(19), lu(20), lu(35)],
    ["Prochain palier : 20 unités à 0,81 € HT l'unité", "Prochain palier : 20 unités à 0,81 € HT l'unité", "Prochain palier : 20 unités à 0,81 € HT l'unité",
     "Prix palier appliqué : 0,81 € HT l'unité", "Prix palier appliqué : 0,81 € HT l'unité"]);
  vrai("piste décorative (aria-hidden), quantité lue par un texte masqué", /class="ex-jauge__piste" aria-hidden="true"/.test(h) && /Quantité 8, prix appliqué 0,83 € HT l'unité\./.test(h));
  const id = h.match(/aria-controls="([^"]+)"/)?.[1];
  vrai("« Voir le détail » : aria-expanded, aria-controls vers le tableau (masqué)", /aria-expanded="false"/.test(h) && !!id && h.includes(`<div id="${id}" hidden="">`));
  vrai("détail : tableau dans un cadre qui défile, légende pour les lecteurs d'écran", /<div class="ex-jauge__defile"><table class="ex-jauge__table"><caption class="ex-lecteur">Prix par quantité : DAFALGAN 1000MG<\/caption>/.test(h));
  vrai("détail : en-têtes « Prix HT/u » et « Économie au palier »", /<th scope="col">Prix HT\/u<\/th><th scope="col">Remise<\/th><th scope="col">Économie au palier<\/th>/.test(h));
  const lignes = (html) => [...html.matchAll(/<tr( data-actuel="")?><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map(m => [!!m[1], m[2], m[3], m[4], m[5]]);
  eq("détail : quantité, prix unitaire HT, remise, économie (ligne en cours marquée)", lignes(h), [[true, "1 à 19", "0,83 €", "−21,7 %", "–"], [false, "Dès 20", "0,81 €", "−23,6 %", "0,40 €"]]);
  eq("détail colis 25, palier 60 : « Moins de 75 », « Dès 60 (commander 75) »", lignes(espaces(rendre({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 0, pas: 25 }))).map(l => l[1]), ["Moins de 75", "Dès 60 (commander 75)"]);
  vrai("détail : note en clair", /Remise calculée sur le prix catalogue \(1,06 € HT\)\. Économie : gain total au palier par rapport à 0,83 € HT l'unité\./.test(h));
  const mini = espaces(rendre({ ...DAFALGAN, qte: 8, variante: "mini" }));
  vrai("mini (cartes) : ni titre ni détail", !/ex-jauge__detail|ex-jauge__titre|<table/.test(mini));
  vrai("compacte : « Détail » à droite de la piste", /<div class="ex-jauge__corps">[\s\S]*ex-jauge__detail/.test(rendre({ ...DAFALGAN, qte: 8, variante: "compacte" })));
  vrai("sans onChoisir : étapes non cliquables, nommées (role img)", /<span class="ex-jauge__etape" data-etat="prochaine"[^>]*role="img" aria-label="20 unités : 0,81 € HT l'unité, −23,6 %"/.test(espaces(rendre({ ...DAFALGAN, qte: 8 }))));
  vrai("déjà au panier : « dont 15 déjà au panier »", /<span class="ex-jauge__deja">dont 15 déjà au panier<\/span>/.test(espaces(rendre({ ...DAFALGAN, qte: 15, deja: 15 }))));
  vrai("style de placement posé sur le bloc", /class="ex-jauge" style="grid-column:1 \/ -1"/.test(rendre({ ...DAFALGAN, qte: 8, style: { gridColumn: "1 / -1" } })));
}

// 7. Clic sur un palier → quantité au pas du colis, que les vraies fonctions de quantité laissent telle quelle
{
  eq("clic DAFALGAN (pas 1) → 20", clics({ ...DAFALGAN, qte: 3 }), [20]);
  eq("clic colis 25, palier 60 → 75 (et non 50, sous le palier)", clics({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 0, pas: 25 }), [75]);
  eq("plafond 40 (péremption) : palier 60 retiré, palier 30 gardé", clics({ base: 5, tiers: [{ min_qty: 30, price: 4.6 }, { min_qty: 60, price: 4.5 }], qte: 0, max: 40 }), [30]);
  eq("plafond sous le premier palier : pas de jauge", jaugePaliers({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 0, max: 40 }), null);
  eq("quatre paliers, clics dans l'ordre (3 étapes montrées)", clics({ ...QUATRE, qte: 0 }), [6, 12, 48]);
  eq("colis 10 : 24 → 30", clics({ base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }, { min_qty: 60, price: 0.75 }], qte: 0, pas: 10 }), [20, 30, 60]);
  const cas = [[DAFALGAN, 1, 0], [{ base: 5, tiers: [{ min_qty: 60, price: 4.5 }] }, 25, 25], [QUATRE, 6, 6], [QUATRE, 1, 0],
    [{ base: 0.83, tiers: [{ min_qty: 20, price: 0.81 }, { min_qty: 24, price: 0.79 }, { min_qty: 60, price: 0.75 }] }, 10, 10]];
  let ecarts = 0, prix = 0, n = 0;
  for (const [c, pas, min] of cas) {
    const j = jaugePaliers({ ...c, qte: 0, pas, min });
    for (const q of clics({ ...c, qte: 0, pas, min })) {
      n++;
      if (setQty(q, pas) !== q || setQty(q, pas, min, pas) !== q) ecarts++;
      if (arrondiSaisie(q, { multiple: pas, min }) !== q) ecarts++;
      if (applyQtyCarte(q, pas > 1 ? pas : 1, min) !== q) ecarts++;
      if (applyTiers(c.base, c.tiers, q).pn !== j.etapes.find(e => e.qte === q)?.prix) prix++;   // le prix montré est celui obtenu
    }
  }
  eq(`quantité du clic inchangée par setQty, arrondiSaisie et applyQty (${n} clics)`, ecarts, 0);
  eq("quantité du clic : prix obtenu = prix montré sur l'étape", prix, 0);
  eq("contre-épreuve : setQty(60, colis 25) = 50", setQty(60, 25), 50);
}

// 8. Placements (texte des sources)
{
  vrai("tableaux : prix unitaire et sous-total au prix du panier (applyTiers hors campagne)",
    app.includes("const pnLigne = avecPaliers ? applyTiers(p.pn, p.price_tiers, qty).pn : p.pn;") && app.includes("const subtotal = p.pn != null ? pnLigne * qty : null;"));
  eq("tableaux : cellule de prix commune aux 10 menus (prixNet : prix palier, badge sans jauge)", (app.match(/<td style=\{\{ \.\.\.tdStyle, textAlign: "right", fontWeight: 700 \}\}>\{prixNet\}<\/td>/g) || []).length, 10);
  // contingentement dans la ligne (23/10/2026) : badge et jauge aux paliers atteignables sans dépasser le reste (tiersQuota,
  // src/components/quota/entree.jsx, testé par test-quota.mjs) ; inchangés hors produit contingenté
  vrai("tableaux : badge seulement sans jauge (paliers atteignables : reglage.tiers)", app.includes("const prixNet = <>{prixUnitaire(pnLigne, p.pn)}{!jauge && <TierBadge tiers={reglage.tiers} pn={p.pn} compact bloc />}</>;")
    && app.includes("const reglage = { base: p.pn, pv: p.pv, tiers: tiersQuota(ctxQuota, p.cip, p.price_tiers, qty, pasLigne), pas: pasLigne };"));
  vrai("tableaux : complète une fois une quantité enregistrée avec un palier à viser, ligne sinon",
    app.includes(`variante={qty > 0 && jaugePaliers({ ...reglage, qte: qty })?.prochaine ? "complete" : "ligne"}`));
  vrai("tableaux : frappe arrondie au pas comme setQty", app.includes("(pasLigne > 1 ? Math.round(frappe.q / pasLigne) * pasLigne : frappe.q)"));
  vrai("tableaux et liste mobile : pas de jauge en rupture", app.includes("const jauge = avecPaliers && !isRupture && jaugePaliers(") && app.includes("const jl = !camp && !isRupture && jaugePaliers("));
  vrai("liste mobile : compacte avec une quantité et un palier à viser, ligne sinon", app.includes(`variante={qty > 0 && jl.prochaine ? "compacte" : "ligne"}`));
  vrai("cartes : total au prix du panier et prix unitaire « (x €/u) » au palier, pas de jauge en rupture",
    app.includes("const pnCarte = getCampaign(activeTab) ? (pnAffiche ?? p.pn) : applyTiers(p.pn, p.price_tiers, qty).pn;") &&
    app.includes("= {fmt(pnCarte * qty)}{pnCarte < p.pn && !getCampaign(activeTab) && <span") && app.includes("{!getCampaign(activeTab) && !isRupture && p.pn != null && ("));
  vrai("cartItems inchangé : applyTiers(basePn, p.price_tiers, qty) hors campagne", app.includes("const tiered = camp ? { pn: basePn, tier: null, next: null } : applyTiers(basePn, p.price_tiers, qty);"));
  vrai("panier : jauge seulement avec un palier à viser, jamais pour un article multi-CIP", app.includes("if (!item.isCampaign && item.basePn != null && !item.supplierCode) {") &&
    app.includes("if (jaugePaliers(reglage)?.prochaine) return <JaugePaliers variante=\"compacte\""));
  vrai("panier : encart sans palier suivant au-delà du plafond (péremption) ni du reste du contingentement", app.includes("const suivant = item.nextTier && !(item.plafond != null && item.nextTier.min_qty > item.plafond)\n                          && tiersQuota(ctxQuota, item.cip, [item.nextTier], item.qty, item.step).length ? item.nextTier : null;"));
  vrai("champ des tableaux : frappe retirée quand la quantité change de l'extérieur ou que le champ disparaît",
    app.includes("useEffect(() => { setBrouillon(null); fin(frappe.current); }, [valeur]);") && app.includes("useEffect(() => { const r = frappe.current; return () => fin(r); }, []);"));
  vrai("Saisie : jauge sur la ligne de destination, quantité déjà au panier + saisie arrondie, sans multi-CIP",
    saisie.includes("const dest = p.supplier_code ? null : panierSaisie?.(p.cip);") && saisie.includes("qte: deja + qAjout") && saisie.includes("const jauge = orderable && !p.supplier_code && jaugePaliers(reglage);"));
  vrai("Saisie : prix affiché et « Ajouter » au prix de la ligne du panier", saisie.includes("{fmt(palier ? pnPanier : displayPrice)}") && saisie.includes("Ajouter {fmt(pnPanier * (qAjout || qty))}"));
  vrai("Saisie : badge sans jauge (paliers atteignables)", saisie.includes("{!jauge && <TierBadge tiers={tiersQuota(cq, p.cip, p.price_tiers, deja, pas)} pn={displayPrice} bloc />}"));
  vrai("Saisie : prix ajouté au panier inchangé (displayPrice, paliers transmis)", saisie.includes("onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: price, pv: product.list_price, discount: hasDiscount ? product.discount_pct : 0, tiers: product.price_tiers || null,"));
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
