// Tests de la jauge des paliers de quantité (src/tiers.jsx : jaugePaliers, positionJauge, texteJauge ; rendu :
// src/components/JaugePaliers.jsx) : node scripts/test-paliers.mjs
// Demande de Zineb (22/10/2026), capture d'un autre site de commande : « est ce que tu peux presenter la partie des paliers comme ça ».
// Hors ligne, rien n'est lu ni écrit ailleurs qu'en mémoire. Contrôles :
//  • étapes : seuils utiles seulement (prix sous le prix de la ligne, min_qty ≥ 2), deux paliers au même prix = une étape ;
//  • prix : pour CHAQUE quantité, le prix montré est celui d'applyTiers (celui que le panier facture) — paliers des données
//    figées du banc (dev-fixtures, si présentes) et cas construits (paliers non ordonnés, prix au-dessus de la ligne) ;
//  • remise : sur le prix de base de la ligne (pv / list_price), égale au pct des paliers en base (odoo-price-sync) ;
//  • incitation « Plus que N pour bénéficier de −X % », « Meilleur prix atteint : −X % » au dernier palier ;
//  • curseur de la quantité en cours, pointillés jusqu'au palier suivant, tableau du détail, accessibilité ;
//  • clic sur un palier → quantité au pas du colis et au minimum, que les VRAIES fonctions de quantité (setQty, arrondiSaisie,
//    applyQty des cartes, lues dans src/App.jsx) laissent telle quelle et qui atteint bien le palier ; plafond respecté ;
//  • placement : sous-total des tableaux et total des cartes au prix d'applyTiers (comme cartItems), badge gardé ailleurs.
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = new URL("..", import.meta.url).pathname;
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };
const espaces = (t) => String(t).replace(/[\u00a0\u202f]/g, " ").replace(/&#x27;/g, "'");   // espaces insécables, apostrophe du HTML

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
export const rendre = (props) => renderToStaticMarkup(React.createElement(JaugePaliers, props));`);
const E = await charge(`export { default as JaugePaliers } from "./components/JaugePaliers.jsx";`, [{ name: "react-essai", setup(b) {
  b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "essai" }));
  b.onLoad({ filter: /.*/, namespace: "essai" }, () => ({ loader: "js", contents: `
    const el = (type, props) => ({ type, props: props || {} });
    export const jsx = el, jsxs = el, Fragment = "fragment";
    export default { useState: (v) => [typeof v === "function" ? v() : v, () => {}], useId: () => "id-essai" };` }));
} }]);
const { applyTiers, jaugePaliers, positionJauge, texteJauge, rendre } = M;
// éléments d'un arbre du React d'essai
const elements = (n, out = []) => {
  if (Array.isArray(n)) { n.forEach(x => elements(x, out)); return out; }
  if (!n || typeof n !== "object") return out;
  out.push(n); elements(n.props?.children, out); return out;
};
const clics = (props) => {
  const recus = [];
  const arbre = E.JaugePaliers({ ...props, onChoisir: (q) => recus.push(q) });
  elements(arbre).filter(e => e.type === "button" && /ex-jauge__etape/.test(e.props.className)).forEach(b => b.props.onClick());
  return recus;
};

// ── Vraies fonctions de quantité, lues dans src/App.jsx (zones protégées : setQty, arrondiSaisie ; cartes : applyQty) ──
const app = readFileSync(join(RACINE, "src/App.jsx"), "utf8");
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

// ── Données : paliers réels (relevés du banc, Odoo liste n° 5) et cas construits ──
const DAFALGAN = { base: 0.83, pv: 1.06, tiers: [{ pct: 23.6, price: 0.81, min_qty: 20 }] };                 // Sélection Master
const DAFALGAN_160 = { base: 0.83, pv: 1.06, tiers: [{ pct: 24.5, price: 0.8, min_qty: 160 }], pas: 160 };   // Stratège, colis 160
const MONOPROST = { base: 7.28, pv: 7.62, tiers: [{ pct: 5, price: 7.24, min_qty: 20 }, { pct: 5, price: 7.24, min_qty: 32 }], pas: 32 };
const QUATRE = { base: 10, pv: 12, tiers: [{ min_qty: 120, price: 8 }, { min_qty: 6, price: 9.5 }, { min_qty: 12, price: 9 }, { min_qty: 48, price: 8.5 }] };

// 1. Étapes
{
  const j = jaugePaliers({ ...DAFALGAN, qte: 0 });
  eq("une étape : seuil, quantité, prix, remise, économie", j.etapes, [{ seuil: 20, qte: 20, prix: 0.81, pct: 23.6, economie: 0.4 }]);
  eq("remise sur le prix de base de la ligne = pct du palier en base (odoo-price-sync)", j.etapes[0].pct, DAFALGAN.tiers[0].pct);
  eq("Stratège colis 160 : pct 24,5 comme en base", jaugePaliers({ ...DAFALGAN_160, qte: 0 }).etapes.map(e => [e.seuil, e.qte, e.pct, e.economie]), [[160, 160, 24.5, 4.8]]);
  eq("deux paliers au même prix (MONOPROST 20 et 32) : une seule étape", jaugePaliers({ ...MONOPROST, qte: 0 }).etapes.map(e => [e.seuil, e.qte]), [[20, 32]]);
  eq("paliers non triés : étapes dans l'ordre des seuils", jaugePaliers({ ...QUATRE, qte: 0 }).etapes.map(e => e.seuil), [6, 12, 48, 120]);
  eq("sans prix de base plus élevé : remise sur le prix sans palier", jaugePaliers({ base: 2, tiers: [{ min_qty: 10, price: 1.8 }], qte: 0 }).etapes[0].pct, 10);
}

// 2. Paliers ignorés : prix au-dessus (ou égal) du prix de la ligne, min_qty < 2, prix nul
{
  const t = [{ min_qty: 10, price: 0.9 }, { min_qty: 15, price: 0.83 }, { min_qty: 1, price: 0.5 }, { min_qty: 30, price: 0 }, { min_qty: 20, price: 0.81 }];
  eq("palier au-dessus du prix, égal, min_qty 1, prix nul : ignorés", jaugePaliers({ base: 0.83, pv: 1.06, tiers: t, qte: 0 }).etapes.map(e => e.seuil), [20]);
  eq("tous les paliers au-dessus du prix : pas de jauge", jaugePaliers({ base: 0.83, tiers: [{ min_qty: 10, price: 0.9 }], qte: 5 }), null);
  eq("sans palier ni prix : pas de jauge", [jaugePaliers({ base: 0.83, tiers: null, qte: 1 }), jaugePaliers({ base: null, tiers: DAFALGAN.tiers, qte: 1 })], [null, null]);
  eq("rien n'est rendu sans palier utile", rendre({ base: 0.83, tiers: [{ min_qty: 10, price: 0.9 }], qte: 5 }), "");
}

// 3. Prix affiché = applyTiers pour chaque quantité (cas construits, paliers réels du banc)
const controlePrix = (nom, c, jusqua) => {
  let ecarts = 0;
  for (let q = 0; q <= jusqua; q++) {
    const j = jaugePaliers({ ...c, qte: q });
    const attendu = applyTiers(c.base, c.tiers, q).pn;
    if (j.prix !== attendu) ecarts++;
    if (j.atteinte && j.atteinte.prix !== attendu) ecarts++;                        // palier atteint montré = prix facturé
    if (!j.atteinte && attendu !== c.base) ecarts++;
    for (const e of j.etapes) if (e.prix !== applyTiers(c.base, c.tiers, e.seuil).pn) ecarts++;
    if (j.prochaine && applyTiers(c.base, c.tiers, j.prochaine.qte).pn !== j.prochaine.prix) ecarts++;   // la quantité du clic donne ce prix
    const t = applyTiers(c.base, c.tiers, q);
    if ((t.next == null) !== (j.prochaine == null)) ecarts++;                       // même « prochain palier » que le panier
  }
  eq(`${nom} : prix montré = applyTiers de 0 à ${jusqua}`, ecarts, 0);
};
controlePrix("DAFALGAN (Master)", DAFALGAN, 60);
controlePrix("DAFALGAN (Stratège, colis 160)", DAFALGAN_160, 400);
controlePrix("MONOPROST (deux paliers au même prix)", MONOPROST, 80);
controlePrix("quatre paliers non triés", QUATRE, 300);
// paliers « à rebours » (prix plus élevé au seuil supérieur) : la jauge montre ce que le panier facture, même moins bon
{
  const c = { base: 7.28, pv: 7.62, tiers: [{ min_qty: 20, price: 7.0 }, { min_qty: 32, price: 7.24 }] };
  controlePrix("paliers à rebours", c, 80);
  eq("paliers à rebours : à 40, prix facturé 7,24 (palier 32) et non 7,00", jaugePaliers({ ...c, qte: 40 }).prix, 7.24);
}
// paliers réels des données figées du banc (products-get : 28 produits à paliers relevés en production)
{
  const f = join(RACINE, "dev-fixtures/get/products-get.json");
  if (!existsSync(f)) console.log("· dev-fixtures absent : contrôle des paliers réels du banc sauté");
  else {
    const produits = (JSON.parse(readFileSync(f, "utf8")).products || []).filter(p => Array.isArray(p.price_tiers) && p.price_tiers.length && p.pn != null);
    let n = 0, ecarts = 0, pct = 0;
    for (const p of produits) {
      const pas = ["stratege", "blanche"].includes(p.section) ? (p.colis || 1) : p.section === "master" ? (p.palier || 1) : 1;
      const max = Math.max(...p.price_tiers.map(t => t.min_qty)) * 2;
      const j0 = jaugePaliers({ base: p.pn, pv: p.pv, tiers: p.price_tiers, qte: 0, pas });
      if (!j0) continue;
      n++;
      for (const e of j0.etapes) { const t = p.price_tiers.find(x => x.min_qty === e.seuil); if (t && Math.abs(t.pct - e.pct) > 0.05) pct++; }
      for (let q = 0; q <= max; q++) if (jaugePaliers({ base: p.pn, pv: p.pv, tiers: p.price_tiers, qte: q, pas }).prix !== applyTiers(p.pn, p.price_tiers, q).pn) ecarts++;
    }
    vrai(`banc : au moins 20 produits à paliers (${n})`, n >= 20);
    eq(`banc : ${n} produits, prix montré = applyTiers à chaque quantité`, ecarts, 0);
    eq(`banc : remise de chaque étape = pct du palier en base (à 0,05 près)`, pct, 0);
  }
}

// 4. Incitation et dernier palier
{
  eq("à 8 : « Plus que 12 pour bénéficier de −23,6 % »", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 8 }))), "Plus que 12 pour bénéficier de −23,6 %");
  eq("à 0 : « Plus que 20 … »", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 0 }))), "Plus que 20 pour bénéficier de −23,6 %");
  eq("à 20 : « Meilleur prix atteint : −23,6 % »", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 20 }))), "Meilleur prix atteint : −23,6 %");
  eq("à 50 : toujours le meilleur prix", espaces(texteJauge(jaugePaliers({ ...DAFALGAN, qte: 50 }))), "Meilleur prix atteint : −23,6 %");
  const j = jaugePaliers({ ...QUATRE, qte: 10 });
  eq("quatre paliers, à 10 : palier 6 atteint, prochain 12, manque 2", [j.atteinte.seuil, j.prochaine.seuil, j.manque, j.prix], [6, 12, 2, 9.5]);
  eq("quatre paliers, à 130 : dernier palier, meilleur prix", [jaugePaliers({ ...QUATRE, qte: 130 }).prochaine, espaces(texteJauge(jaugePaliers({ ...QUATRE, qte: 130 })))], [null, "Meilleur prix atteint : −33,3 %"]);
  eq("colis 25, palier 60 : à 25, « Plus que 50 » (75 est la quantité commandable)", jaugePaliers({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 25, pas: 25 }).manque, 50);
  const h = espaces(rendre({ ...DAFALGAN, qte: 8, nom: "DAFALGAN" }));
  vrai("incitation rendue : nombre en pastille, remise en pastille or", /Plus que <b class="ex-jauge__n">12<\/b> pour bénéficier de <b class="ex-jauge__pct">−23,6 %<\/b>/.test(h), h.slice(0, 600));
  const h20 = espaces(rendre({ ...DAFALGAN, qte: 20 }));
  vrai("dernier palier rendu : « Meilleur prix atteint : » et data-atteint", /Meilleur prix atteint : <b class="ex-jauge__pct">−23,6 %<\/b>/.test(h20) && /data-atteint=""/.test(h20));
  vrai("dernier palier : plus de pointillés", !/ex-jauge__tirets/.test(h20) && /ex-jauge__tirets/.test(h));
}

// 5. Curseur de la quantité, pointillés, états des étapes
{
  eq("positions : 0 → 0 %, seuil unique → 84 %, moitié → 42 %, 1,5 × seuil → 100 %", [0, 20, 10, 30, 99].map(q => positionJauge([{ seuil: 20 }], q)), [0, 84, 42, 100, 100]);
  eq("positions régulières entre étapes (6, 12, 48, 120)", [6, 9, 12, 48, 120].map(q => Math.round(positionJauge([{ seuil: 6 }, { seuil: 12 }, { seuil: 48 }, { seuil: 120 }], q) * 10) / 10), [21, 31.5, 42, 63, 84]);
  const h = rendre({ ...DAFALGAN, qte: 10 });
  vrai("curseur à 42 % pour 10 sur un palier de 20", /class="ex-jauge__curseur" style="left:42%"/.test(h), h.match(/ex-jauge__curseur[^>]*/)?.[0]);
  vrai("remplissage jusqu'au curseur", /class="ex-jauge__plein" style="width:42%"/.test(h));
  vrai("pointillés du curseur au palier suivant (42 % → 84 %)", /class="ex-jauge__tirets" style="left:42%;width:42%"/.test(h));
  const q = rendre({ ...QUATRE, qte: 10 });
  eq("états des étapes à 10 : atteinte, prochaine, suite, suite", [...q.matchAll(/data-etat="(\w+)"/g)].map(m => m[1]), ["atteinte", "prochaine", "suite", "suite"]);
  eq("compacte : palier atteint et deux suivants seulement", [...rendre({ ...QUATRE, qte: 10, variante: "compacte" }).matchAll(/class="ex-jauge__q">(\d+)</g)].map(m => m[1]), ["6", "12", "48"]);
  eq("compacte sans palier atteint : les deux suivants", [...rendre({ ...QUATRE, qte: 0, variante: "compacte" }).matchAll(/class="ex-jauge__q">(\d+)</g)].map(m => m[1]), ["6", "12"]);
  eq("complète : toutes les étapes", [...q.matchAll(/class="ex-jauge__q">(\d+)</g)].map(m => m[1]), ["6", "12", "48", "120"]);
}

// 6. Accessibilité et détail
{
  const h = espaces(rendre({ ...DAFALGAN, qte: 8, nom: "DAFALGAN 1000MG", onChoisir: () => {} }));
  vrai("groupe nommé avec le produit", /role="group" aria-label="Prix par quantité : DAFALGAN 1000MG"/.test(h));
  vrai("incitation en zone aria-live", /class="ex-jauge__incitation" aria-live="polite"/.test(h));
  vrai("palier : bouton nommé (seuil, prix HT, remise, quantité commandée)", /<button type="button" class="ex-jauge__etape" data-etat="prochaine"[^>]*aria-label="20 unités : 0,81 € HT l'unité \(−23,6 %\)\. Commander 20"/.test(h), h.match(/<button type="button" class="ex-jauge__etape[^>]*>/)?.[0]);
  vrai("piste décorative (aria-hidden), quantité lue par un texte masqué", /class="ex-jauge__piste" aria-hidden="true"/.test(h) && /Quantité 8, prix appliqué 0,83 € HT l'unité\./.test(h));
  const id = h.match(/aria-controls="([^"]+)"/)?.[1];
  vrai("« Voir le détail » : aria-expanded, aria-controls vers le tableau (masqué)", /aria-expanded="false"/.test(h) && !!id && h.includes(`<div id="${id}" hidden="">`));
  const lignes = [...h.matchAll(/<tr( data-actuel="")?><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map(m => [!!m[1], m[2], m[3], m[4], m[5]]);
  eq("détail : quantité, prix unitaire HT, remise, économie (ligne en cours marquée)", lignes, [[true, "1 à 19", "0,83 €", "−21,7 %", "–"], [false, "Dès 20", "0,81 €", "−23,6 %", "0,40 €"]]);
  vrai("détail : note sur la référence de la remise et de l'économie", /Remise sur le prix de base de 1,06 € HT ; économie par rapport au prix sans palier \(0,83 € HT\)/.test(h));
  const mini = espaces(rendre({ ...DAFALGAN, qte: 8, variante: "mini" }));
  vrai("mini (cartes) : ni titre ni détail", !/ex-jauge__detail|ex-jauge__titre|<table/.test(mini));
  vrai("mini : « Plus que 12 » à l'écran, phrase entière pour les lecteurs d'écran", /<span class="ex-lecteur">Plus que 12 pour bénéficier de −23,6 %<\/span><span aria-hidden="true"[^>]*>Plus que <b class="ex-jauge__n">12<\/b><\/span>/.test(mini), mini.slice(0, 500));
  vrai("compacte : « Détail » à droite de la piste (pas dans l'en-tête)", /<div class="ex-jauge__corps">[\s\S]*ex-jauge__detail/.test(rendre({ ...DAFALGAN, qte: 8, variante: "compacte" })) && !/ex-jauge__tete">(?:(?!ex-jauge__corps).)*ex-jauge__detail/.test(rendre({ ...DAFALGAN, qte: 8, variante: "compacte" })));
  vrai("sans onChoisir : étapes non cliquables, nommées (role img)", /<span class="ex-jauge__etape" data-etat="prochaine"[^>]*role="img" aria-label="20 unités/.test(rendre({ ...DAFALGAN, qte: 8 })));
  const s = rendre({ ...DAFALGAN, qte: 8, style: { gridColumn: "1 / -1" } });
  vrai("style de placement posé sur le bloc", /class="ex-jauge" style="grid-column:1 \/ -1"/.test(s));
}

// 7. Clic sur un palier → quantité au pas du colis, que les vraies fonctions de quantité laissent telle quelle
{
  eq("clic DAFALGAN (pas 1) → 20", clics({ ...DAFALGAN, qte: 3 }), [20]);
  eq("clic Stratège colis 160 → 160", clics({ ...DAFALGAN_160, qte: 0 }), [160]);
  eq("clic MONOPROST colis 32 (palier 20) → 32", clics({ ...MONOPROST, qte: 0 }), [32]);
  eq("clic colis 25, palier 60 → 75 (et non 50, sous le palier)", clics({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 0, pas: 25 }), [75]);
  eq("clic minimum 100, palier 50 → 100", clics({ base: 5, tiers: [{ min_qty: 50, price: 4.5 }], qte: 0, min: 100 }), [100]);
  eq("plafond 40 (péremption) : palier 60 retiré, palier 30 gardé", clics({ base: 5, tiers: [{ min_qty: 30, price: 4.6 }, { min_qty: 60, price: 4.5 }], qte: 0, max: 40 }), [30]);
  eq("plafond sous le premier palier : pas de jauge", jaugePaliers({ base: 5, tiers: [{ min_qty: 60, price: 4.5 }], qte: 0, max: 40 }), null);
  eq("quatre paliers, clics dans l'ordre", clics({ ...QUATRE, qte: 0 }), [6, 12, 48, 120]);
  // vraies règles : setQty (tableaux, panier), arrondiSaisie (Saisie), applyQty (cartes)
  const cas = [[DAFALGAN, 1, 0], [DAFALGAN_160, 160, 160], [MONOPROST, 32, 32], [{ base: 5, tiers: [{ min_qty: 60, price: 4.5 }] }, 25, 25], [{ base: 5, tiers: [{ min_qty: 50, price: 4.5 }] }, 1, 100], [QUATRE, 6, 6]];
  let ecarts = 0, sous = 0;
  for (const [c, pas, min] of cas) for (const q of clics({ ...c, qte: 0, pas, min })) {
    if (setQty(q, pas) !== q || setQty(q, pas, min, pas) !== q) ecarts++;
    if (arrondiSaisie(q, { multiple: pas, min }) !== q) ecarts++;
    if (applyQtyCarte(q, pas > 1 ? pas : 1, min) !== q) ecarts++;
    if (applyTiers(c.base, c.tiers, q).pn >= c.base) sous++;                       // la quantité choisie obtient bien un prix palier
  }
  eq("quantité du clic inchangée par setQty, arrondiSaisie et applyQty (cartes)", ecarts, 0);
  eq("quantité du clic : prix palier obtenu au panier", sous, 0);
  // contre-épreuve : sans arrondi au pas, setQty aurait ramené 60 à 50 (colis 25), sous le palier
  eq("contre-épreuve : setQty(60, colis 25) = 50", setQty(60, 25), 50);
}

// 8. Placement (texte de src/App.jsx et de la Saisie) : prix du panier, badge gardé là où la jauge n'est pas
{
  vrai("tableaux : sous-total au prix d'applyTiers (comme cartItems), campagne exclue",
    app.includes("const avecPaliers = !getCampaign(activeTab) && p.pn != null;") && app.includes("const subtotal = p.pn != null ? (avecPaliers ? applyTiers(p.pn, p.price_tiers, qty).pn : p.pn) * qty : null;"));
  vrai("cartes : total au prix d'applyTiers hors campagne", app.includes("= {fmt((getCampaign(activeTab) ? (pnAffiche ?? p.pn) : applyTiers(p.pn, p.price_tiers, qty).pn) * qty)}"));
  vrai("cartItems inchangé : applyTiers(basePn, p.price_tiers, qty) hors campagne", app.includes("const tiered = camp ? { pn: basePn, tier: null, next: null } : applyTiers(basePn, p.price_tiers, qty);"));
  eq("tableaux : badge seulement sans jauge (10 menus)", (app.match(/\{!jauge && <TierBadge tiers=\{p\.price_tiers\} pn=\{p\.pn\} compact bloc \/>\}/g) || []).length, 10);
  vrai("panier : jauge compacte sur basePn, clic par setItemQty, plafond", /<JaugePaliers variante="compacte"[^\n]*\{\.\.\.reglage\}[^\n]*onChoisir=\{\(n\) => setItemQty\(item, n\)\}/.test(app) && app.includes("max: item.plafond ?? null"));
  const saisie = readFileSync(join(RACINE, "src/components/OrderEntry.jsx"), "utf8");
  vrai("Saisie : jauge sur displayPrice (prix ajouté au panier), règle du catalogue, maximum du justificatif",
    /<JaugePaliers style=\{\{ gridColumn: "1 \/ -1" \}\} base=\{displayPrice\} pv=\{p\.list_price\} tiers=\{p\.price_tiers\} qte=\{qty\} pas=\{pas\}\s+min=\{regle\?\.min \|\| 0\} max=\{jr\?\.maxCommande \|\| null\}/.test(saisie));
  vrai("Saisie : prix ajouté au panier inchangé (displayPrice, paliers transmis)", saisie.includes("onAddToCart?.({ cip: product.cip, name: product.name, qty, pn: price, pv: product.list_price, discount: hasDiscount ? product.discount_pct : 0, tiers: product.price_tiers || null,"));
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
