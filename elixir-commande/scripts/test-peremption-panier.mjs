// Tests de la règle panier de la Péremption courte (21/10/2026, docs/peremption.md) : node scripts/test-peremption-panier.mjs
// Décision de Zineb : « par défaut le −50 s'affiche et c'est la règle panier qui s'applique ; si le travail manuel côté admin
// n'est pas fait, on rectifiera les écarts depuis l'affichage des écarts ».
// Hors ligne, sans navigateur ni réseau, aucune écriture (ni Odoo, ni Supabase, ni PharmaML : doublures). Le VRAI code est
// exécuté : prixAffiche et handleAdd de ShortExpiry.jsx (page), getStepMin, setQty, setItemQty, addItemToCart, le panier
// calculé (cartItems), handleCopy, qteAccueil, modifierQte, readCart, lirePagePeremption et controlerPrixPanier,
// expandSupplierGroups, sendOrder et « Recommander » (onReorder) d'App.jsx, extraits des fichiers et exécutés avec des
// doublures (état React, order-save, send-email, submit-order, horloge). La doublure de submit-order applique l'anti-doublon
// du relais avec la VRAIE ligne d'empreinte de netlify/functions/_relais.js (envoiAuto). src/peremption-panier.js, applyTiers
// (src/tiers.jsx) et lab-justif-client.js sont assemblés par esbuild (React vide). Comparaisons : production du 21/10/2026
// (b1dbd3e : lot 0 et V1, page au prix habituel) et page d'avant le 20/10 (d840631 : −50 % d'office), par leur commit.
//  • page : −50 % (−20 % dès 500 €), remise de l'admin (0 = aucune), prix habituel plus bas, règle Odoo facturée ; mêmes prix
//    que la page d'avant le 20/10 pour la remise par défaut ;
//  • panier : ligne à part « Péremption courte » au prix de la page (« Pér. <date> · −X % »), jamais la ligne d'un menu ou de
//    la Saisie du même CIP ; ajout deux fois, quantité, retrait, justificatif gardé pour l'autre ligne ; sans règle de colis ;
//  • accueil : la carte ne compte pas la ligne péremption, « − » ne la touche jamais ; bon copié ; paniers enregistrés ;
//  • envoi : mention, date, remise et facture_odoo dans les lignes enregistrées ; e-mail (boîtes à corriger dans Odoo, sinon
//    Contrôle des écarts) ; même CIP sur une autre ligne → commande à part (separeDe), relayée après l'autre, « Commande
//    envoyée » après ses deux relais ; même produit, même quantité : pas un doublon pour le relais (un vrai double, si) ;
//    commande à part refusée → gardée au panier ; panier sans péremption : envois identiques à la production ;
//  • panier enregistré (controlerPrixPanier) : ligne remise à l'offre ACTUELLE de la page (hausse ou baisse), au prix habituel
//    si le produit a quitté la page (ligne du menu), ligne de l'ancienne page (−50 % sans mention) devenue ligne péremption,
//    ligne du lot 0 mise au prix de la page, rien si le panier change pendant la lecture ;
//  • « Recommander » : ligne péremption non reprise.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("..", import.meta.url).pathname;
const sortie = await build({
  stdin: { contents: 'export * from "./src/peremption-panier.js"; export { applyTiers } from "./src/tiers.jsx";'
    + ' export { qtyByCip, needsJustif, justifIssues, rxFrais } from "./src/lab-justif-client.js";', resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false,
  loader: { ".jsx": "jsx", ".js": "jsx" }, jsx: "transform", logLevel: "silent",
  plugins: [{ name: "sans-react", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "export default {};", loader: "js" }));
  } }],
});
const dossier = mkdtempSync(join(tmpdir(), "test-peremption-panier-"));
writeFileSync(join(dossier, "m.mjs"), sortie.outputFiles[0].text);
const M = await import(pathToFileURL(join(dossier, "m.mjs")).href);
rmSync(dossier, { recursive: true, force: true });

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

// ── Extraction du code ──
const lire = (f) => readFileSync(join(RACINE, f), "utf8");
const APP = lire("src/App.jsx"), SHORT = lire("src/components/ShortExpiry.jsx"), RELAIS = lire("netlify/functions/_relais.js");
const PROD_REF = "b1dbd3e7d3bf77c256d60ab6e4f8f997c9e3137d";   // production du 21/10/2026 (lot 0 et V1), commit figé
const AVANT_REF = "d8406310969dec4eb2206751275b5f7bc621b32b";  // page d'avant le 20/10/2026 (−50 % d'office)
const enRef = (ref, f) => { try { return execFileSync("git", ["show", `${ref}:./${f}`], { cwd: RACINE, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const PROD = enRef(PROD_REF, "src/App.jsx"), RELAIS_PROD = enRef(PROD_REF, "netlify/functions/_relais.js"), SHORT_AVANT = enRef(AVANT_REF, "src/components/ShortExpiry.jsx");
if (!PROD) console.log(`· production ${PROD_REF} absente de git : comparaisons avec la production sautées`);
// module de la production (src/peremption-panier.js du lot 0 et de la V1, pur) pour exécuter son App.jsx
let MP = {};
{
  const t = enRef(PROD_REF, "src/peremption-panier.js");
  if (t) { const d = mkdtempSync(join(tmpdir(), "test-peremption-panier-prod-")); writeFileSync(join(d, "p.mjs"), t); MP = await import(pathToFileURL(join(d, "p.mjs")).href); rmSync(d, { recursive: true, force: true }); }
}
const indent = (l) => l.match(/^\s*/)[0].length;
// bloc commençant à la ligne « debut » : jusqu'à la ligne fermante de même indentation (ligne seule si rien n'est ouvert)
const bloc = (texte, debut) => {
  const l = texte.split("\n");
  const i = l.findIndex(x => debut.test(x));
  if (i < 0) throw new Error(`introuvable : ${debut}`);
  if (!/[{([]\s*(\/\/.*)?$/.test(l[i]) && !/=>\s*$/.test(l[i])) return l[i];
  const n = indent(l[i]);
  const j = l.findIndex((x, k) => k > i && x.trim() && indent(x) === n && /^\s*[)}\]]/.test(x));
  return l.slice(i, j + 1).join("\n");
};
const expr = (code) => code.replace(/^\s*const \w+ = /, "").replace(/;\s*$/, "");
// exécute l'expression dans un contexte de doublures (identifiants inconnus : ceux de Node, sinon ReferenceError)
const charge = (code, ctx) => new Function("__ctx", `with (__ctx) { return (${code}); }`)(new Proxy(ctx, { has: (t, k) => k in t }));
// empreinte anti-doublon d'envoiAuto : la ligne « const sig = createHash… » du fichier, exécutée telle quelle
const { createHash } = await import("node:crypto");
const empreinteDe = (src) => {
  const l = src.split("\n").find(x => x.includes("const sig = createHash"));
  if (!l) throw new Error("ligne d'empreinte introuvable dans _relais.js");
  return (its) => charge(expr(l), { createHash, its });
};
const empreinte = empreinteDe(RELAIS);
// page Péremption courte (prixAffiche et handleAdd de ShortExpiry.jsx) → objet envoyé à onAddToCart ; remises : repli
// (expiry_discounts lue par la page quand peremption?action=page ne répond pas)
function ajoutPage(produit, qty, remises = null) {
  let envoye = null;
  const ctx = { ...M, remises, quantities: { [produit.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; } };
  ctx.prixAffiche = charge(expr(bloc(SHORT, /^  const prixAffiche = /)), ctx);
  ctx.handleAdd = charge(expr(bloc(SHORT, /^  const handleAdd = /)), ctx);
  ctx.handleAdd(produit);
  return envoye;
}

const HEC = "3400930470312", EUPHY = "3534510001778", DOLI = "3400935955838", COLIS = "3400000000001", ZADI = "3400932448951";
const CATALOGUE = {
  otc: { label: "Centrale OTC", accent: "#0f766e", products: [
    { cip: HEC, name: "HEC POM NACU T/25G", pn: 9.76, pv: 10.32 },
    { cip: DOLI, name: "DOLIPRANE 1000 mg", pn: 1.5, pv: 2.1, price_tiers: [{ min_qty: 10, price: 1.4 }] },
  ] },
  stratege: { label: "Sélection Stratège", accent: "#334155", products: [{ cip: COLIS, name: "Produit au colis", pn: 2, colis: 6 }] },
};
// produits de la page (peremption?action=page, relevé du 20/10/2026 simplifié)
const PAGE_HEC = { cip: HEC, name: "HEC POM NACU T/25G", list_price: 10.32, discounted_price: 9.76, discount_pct: 5.4, price_tiers: null, earliest_expiry: "2026-12-31T00:00:00+00:00", remise_admin: null };
const PAGE_EUPHY = { cip: EUPHY, name: "EUPHYTOSE NUIT MYRTILLE GOMME 30", list_price: 12.31, discounted_price: 9.85, discount_pct: 20, price_tiers: null, earliest_expiry: "2027-01-31", remise_admin: null };
const PAGE_ZADI = { cip: ZADI, name: "ZADITEN 1 mg/5 ml", list_price: 3.83, discounted_price: 3.6, discount_pct: 6, price_tiers: [{ min_qty: 6, price: 3.4 }], earliest_expiry: "2026-12-31", remise_admin: null };
const PER_HEC = ajoutPage(PAGE_HEC, 2);
const PER_EUPHY = ajoutPage(PAGE_EUPHY, 1);

// application minimale : état React (mises à jour appliquées tout de suite), fonctions du panier d'App.jsx
function application(src, { quantities = {}, specialItems = [], justifInfo = {}, catalogue = CATALOGUE } = {}) {
  const S = { quantities, specialItems, justifInfo, cartOpen: false, flashes: [], durees: [], statut: [], minuteries: [] };
  const maj = (k) => (v) => { S[k] = typeof v === "function" ? v(S[k]) : v; };
  const ctx = {
    ...M, ...(src === PROD ? MP : {}), CATALOG_WITH_ADMIN: catalogue,
    get quantities() { return S.quantities; }, get specialItems() { return S.specialItems; }, get justifInfo() { return S.justifInfo; },
    setQuantities: maj("quantities"), setSpecialItems: maj("specialItems"), setJustifInfo: maj("justifInfo"), setCartOpen: maj("cartOpen"),
    flash: (m, d) => { S.flashes.push(m); S.durees.push(d); },
    getCampaign: () => null, buildGroupes: () => [], campGetGroupe: () => null, campGratuite: () => ({ livrées: 0 }),
  };
  for (const nom of ["getStepMin", "getStep", "setQty", "setItemQty", "addItemToCart"]) ctx[nom] = charge(expr(bloc(src, new RegExp(`^  const ${nom} = `))), ctx);
  const calcul = charge(bloc(src, /^  const cartItems = useMemo\(\(\) => \{$/).replace(/^\s*const cartItems = useMemo\(/, "").replace(/, \[[^\]]*\]\);\s*$/, ""), ctx);
  Object.defineProperty(ctx, "cartItems", { get: () => calcul() });
  Object.defineProperty(ctx, "cartTotal", { get: () => ctx.cartItems.reduce((s, i) => s + i.total, 0) });
  Object.defineProperty(ctx, "cartCount", { get: () => ctx.cartItems.reduce((s, i) => s + i.qty, 0) });
  if (/^  const modifierQte = /m.test(src)) ctx.modifierQte = charge(expr(bloc(src, /^  const modifierQte = /)), ctx);
  if (/^  const qteAccueil = /m.test(src)) {
    const f = charge(bloc(src, /^  const qteAccueil = /).replace(/^\s*const qteAccueil = useMemo\(/, "").replace(/, \[cartItems\]\);\s*$/, ""), ctx);
    Object.defineProperty(ctx, "qteAccueil", { get: () => f() });
  }
  return { S, ctx };
}
const sansNouveaux = (items) => items.map(({ specialId, ...i }) => i);   // eslint-disable-line no-unused-vars
const ligne = (ctx, cle) => ctx.cartItems.find(i => i.key === cle);
const arrondi = (n) => Math.round(n * 100) / 100;

// ── 1. Parties pures (src/peremption-panier.js) ──
eq("date française, mention", [M.datePeremption("2026-12-31"), M.datePeremption("2026-12-31T00:00:00Z"), M.notePeremption("2026-12-31")], ["31/12/2026", "31/12/2026", "Pér. 31/12/2026"]);
eq("identités : CIP, nom, ligne péremption", [M.idSpecial({ cip: HEC, name: "x" }), M.idSpecial({ cip: null, name: "Produit libre" }), M.idSpecial({ cip: HEC, peremption: "2026-12-31" })], [HEC, "Produit libre", `per:${HEC}`]);
eq("ligne ordinaire : rien d'ajouté (panier, commande, e-mail, consigne)", [M.champsPeremption({ cip: HEC, qty: 1 }), M.mentionCommande({ cip: HEC, qty: 1 }), M.mentionMail({ cip: HEC }), M.consigneOdoo({ cip: HEC, qty: 1, pn: 9.76 })], [{}, {}, "", ""]);
eq("peremption vide : pas une ligne péremption", M.estPeremption({ peremption: "" }), false);
eq("date inconnue : gardée entière ; date avec heure : jour seul", [M.ajouterPeremption([], { cip: HEC, name: "x", qty: 1, pn: 1, peremption: "date inconnue" })[0].peremption,
  M.ajouterPeremption([], { cip: HEC, name: "x", qty: 1, pn: 1, peremption: "2026-12-31T10:00:00Z" })[0].peremption], ["date inconnue", "2026-12-31"]);
// offre de la page
{
  const o = (p, r) => { const x = M.offreAffichee(p, r); return [x.pn, x.base, x.remise, x.source, x.facture_odoo, x.motif]; };
  eq("offre par défaut : −50 % du prix de base (Hec 10,32 → 5,16 €)", o(PAGE_HEC), [5.16, 10.32, 50, "defaut", false, null]);
  eq("offre dès 500 € de prix de base : −20 % (2 000 → 1 600 €) ; 499,99 € : −50 %", [o({ ...PAGE_HEC, list_price: 2000, discounted_price: 1910 })[0], o({ ...PAGE_HEC, list_price: 2000, discounted_price: 1910 })[2], o({ ...PAGE_HEC, list_price: 499.99, discounted_price: 477.49 })[0]], [1600, 20, 250]);
  eq("offre de l'admin (serveur : remise_admin ; repli : remises) : 30 % → 7,22 €", [o({ ...PAGE_HEC, remise_admin: 30 }), o({ cip: HEC, list_price: 10.32, discounted_price: 9.76, discount_pct: 5.4 }, { [HEC]: 30 })],
    [[7.22, 10.32, 30, "admin", false, null], [7.22, 10.32, 30, "admin", false, null]]);
  eq("offre de l'admin à 0 % : aucune remise, prix habituel et ses paliers", [o({ ...PAGE_ZADI, remise_admin: 0 }), M.offreAffichee({ ...PAGE_ZADI, remise_admin: 0 }).tiers], [[3.6, 3.83, 0, "habituel", false, "admin_zero"], [{ min_qty: 6, price: 3.4 }]]);
  eq("offre : prix habituel déjà plus bas (FFP2 5,99 € → 3,00 € ; habituel 2,99 €) → prix habituel", o({ cip: "1", list_price: 5.99, discounted_price: 2.99, discount_pct: 50.1 }), [2.99, 5.99, 0, "habituel", false, "habituel_plus_bas"]);
  eq("offre : règle facturée par Odoo (V1) prioritaire : remise de la facture, prix du site", o({ ...PAGE_ZADI, facturee: true, remise_pct: 12, discounted_price: 3.37, discount_pct: 12, prix_base: 3.83, remise_admin: 30 }),
    [3.37, 3.83, 12, "odoo", true, null]);
  eq("offre : sans prix de base → prix habituel ; rien → pas de prix", [o({ cip: "1", list_price: null, discounted_price: null }), o({ cip: "1" })[0]], [[null, null, 0, "habituel", false, "sans_base"], null]);
  eq("remise de l'admin : 0 à 90, sinon défaut", [0, 30, 90, 91, -1, null, "", "12,5"].map(M.remiseAdmin), [0, 30, 90, null, null, null, null, 12.5]);
  eq("libellés de l'admin", [M.libelleOffre(M.offreAffichee(PAGE_HEC)), M.libelleOffre(M.offreAffichee({ ...PAGE_HEC, remise_admin: 30 })), M.libelleOffre(M.offreAffichee({ ...PAGE_HEC, remise_admin: 0 }))],
    ["−50 % (défaut)", "−30 % (admin)", "aucune (admin)"]);
}
// mentions, consigne, séparation
eq("consigne Odoo : ligne au prix de la page", M.consigneOdoo({ qty: 2, pn: 5.16, peremption: "2026-12-31", remise: 50 }),
  "prix de la page Péremption courte (−50 %) non repris par Odoo, qui facture le tarif de la liste du client : corriger 2 boîtes à 5,16 € (sinon : Contrôle des écarts, onglet Péremptions)");
eq("consigne Odoo : commande à part, une boîte", M.consigneOdoo({ qty: 1, pn: 5.16, peremption: "2026-12-31", remise: 50, separeDe: "1792" }),
  "prix de la page Péremption courte (−50 %) non repris par Odoo, qui facture le tarif de la liste du client : corriger 1 boîte à 5,16 € ; dans Odoo, elle peut être additionnée à la ligne du même produit de la commande n° 1792 : corriger 1 boîte seulement, pas toute la ligne (sinon : Contrôle des écarts, onglet Péremptions)");
eq("consigne Odoo : facturée par Odoo, ou au prix habituel → rien", [M.consigneOdoo({ qty: 1, pn: 3.37, peremption: "2026-12-31", remise: 12, facture_odoo: true }), M.consigneOdoo({ qty: 1, pn: 9.76, peremption: "2026-12-31", remise: 0 })], ["", ""]);
eq("e-mail : facturée par Odoo / prix habituel / ligne du lot 0", [M.mentionMail({ peremption: "2026-12-31", remise: 12, facture_odoo: true }), M.mentionMail({ peremption: "2026-12-31", remise: 0 }), M.mentionMail({ peremption: "2026-12-31" })],
  [" — PÉREMPTION COURTE (Pér. 31/12/2026, remise −12 % facturée par Odoo)", " — PÉREMPTION COURTE (Pér. 31/12/2026, au prix habituel)", " — PÉREMPTION COURTE (Pér. 31/12/2026, au prix habituel)"]);
eq("badge : « Pér. 31/12/2026 · −50 % » ; V1 (peremption_remise) ; sans remise", [M.badgePeremption({ peremption: "2026-12-31", remise: 50 }), M.badgePeremption({ peremption: "2026-12-31", peremption_remise: 12 }), M.badgePeremption({ peremption: "2026-12-31" })],
  ["Pér. 31/12/2026 · −50 %", "Pér. 31/12/2026 · −12 %", "Pér. 31/12/2026"]);
eq("commande : mention, date, remise et facturation par Odoo", [M.mentionCommande({ peremption: "2026-12-31", remise: 50, facture_odoo: false }), M.mentionCommande({ peremption: "2026-12-31", peremption_remise: 12 }), M.mentionCommande({ peremption: "2026-12-31" })],
  [{ note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false }, { note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 12, facture_odoo: true }, { note: "Pér. 31/12/2026", peremption: "2026-12-31", facture_odoo: false }]);
{
  const a = { cip: HEC, qty: 3 }, b = { cip: HEC, qty: 2, peremption: "2026-12-31" }, c = { cip: EUPHY, qty: 1, peremption: "2027-01-31" };
  const r = M.separerPeremption([a, b, c]);
  eq("séparation : la ligne péremption d'un CIP aussi au menu part à part ; le reste dans la commande normale (ordre gardé)", [r.separe, r.principal], [[b], [a, c]]);
  const r2 = M.separerPeremption([a, c]);
  eq("séparation : rien à séparer → aucune ligne à part", [r2.principal, r2.separe], [[a, c], []]);
  eq("explication du panier : produit aussi sur une autre ligne / seul", [M.partiraAPart(b, [a, b, c]), M.partiraAPart(c, [a, b, c])], [true, false]);
}

// ── 1 bis. Page Péremption courte : objet envoyé au panier par handleAdd (ShortExpiry.jsx) ──
eq("page : objet ajouté (−50 %, prix de base, date du lot sans l'heure, mention, remise, non facturée par Odoo)", PER_HEC,
  { cip: HEC, name: "HEC POM NACU T/25G", qty: 2, pn: 5.16, pv: 10.32, discount: 50, tiers: null, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false, plafond: null });
eq("page : remise de l'admin (repli : expiry_discounts)", [ajoutPage({ ...PAGE_HEC, remise_admin: undefined }, 1, { [HEC]: 30 }).pn, ajoutPage({ ...PAGE_HEC, remise_admin: 30 }, 1).remise], [7.22, 30]);
eq("page : −20 % à partir de 500 €", [ajoutPage({ ...PAGE_HEC, list_price: 600, discounted_price: 573 }, 1).pn, ajoutPage({ ...PAGE_HEC, list_price: 600, discounted_price: 573 }, 1).discount], [480, 20]);
eq("page : quantité 0, ou produit sans prix → rien d'ajouté", [ajoutPage(PAGE_HEC, 0), ajoutPage({ ...PAGE_HEC, list_price: null, discounted_price: null }, 2)], [null, null]);
if (SHORT_AVANT) {
  // page d'avant le 20/10/2026 : mêmes prix et remises pour la remise par défaut et la remise de l'admin
  const avant = (p, qty, discounts = {}) => {
    let envoye = null;
    const ctx = { discounts, quantities: { [p.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; } };
    for (const nom of ["getDiscount", "getDiscountedPrice", "handleAdd"]) ctx[nom] = charge(expr(bloc(SHORT_AVANT, new RegExp(`^  const ${nom} = `))), ctx);
    ctx.handleAdd(p);
    return envoye;
  };
  for (const [p, rem] of [[PAGE_HEC, {}], [PAGE_EUPHY, {}], [{ ...PAGE_HEC, list_price: 600, discounted_price: 590 }, {}], [{ ...PAGE_HEC, remise_admin: undefined }, { [HEC]: 30 }]]) {
    const a = avant(p, 3, rem), n = ajoutPage(p, 3, rem);
    eq(`page = page d'avant le 20/10 (${p.name}, ${p.list_price} €${rem[HEC] ? ", remise admin 30 %" : ""}) : même prix, même remise, même prix de base`, [n.pn, n.discount, n.pv], [a.pn, a.discount, a.pv]);
  }
}
{
  const sansDate = ajoutPage({ ...PAGE_EUPHY, earliest_expiry: null }, 1);
  eq("page : lot sans date → « date inconnue »", [sansDate.peremption, sansDate.note], ["date inconnue", "Pér. date inconnue"]);
  const { ctx } = application(APP);
  ctx.addItemToCart(sansDate);
  eq("page : lot sans date → ligne péremption « Pér. date inconnue » au panier", ctx.cartItems.map(i => [i.cat, i.note, i.pn]), [["Péremption courte", "Pér. date inconnue", 6.16]]);
}

// ── 2. Ajout depuis Péremption courte (addItemToCart) ──
{
  const { S, ctx } = application(APP);
  ctx.addItemToCart(PER_HEC);
  eq("péremption seule : aucune quantité au menu", S.quantities, {});
  const l = ctx.cartItems;
  eq("péremption seule : une ligne à part, prix de la page, mention, remise, prix de base", { n: l.length, key: l[0].key, cat: l[0].cat, pn: l[0].pn, qty: l[0].qty, total: l[0].total, note: l[0].note, peremption: l[0].peremption, remise: l[0].remise, facture_odoo: l[0].facture_odoo, pv: l[0].pv },
    { n: 1, key: `special-per-${HEC}`, cat: "Péremption courte", pn: 5.16, qty: 2, total: 10.32, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false, pv: 10.32 });
  eq("péremption seule : pastille orange, ligne hors catalogue", [l[0].color, l[0].isSpecial, l[0].catKey, l[0].step, l[0].specialId], [M.COULEUR_PEREMPTION, true, "special", 1, `per:${HEC}`]);
  eq("péremption seule : panier ouvert et message", [S.cartOpen, S.flashes.at(-1)], [true, "✓ 2× HEC POM NACU T/25G ajouté au panier"]);
  if (PROD) {   // production (lot 0) : la quantité allait sur la ligne du menu, au prix du menu, sans mention ni remise
    const p = application(PROD);
    p.ctx.addItemToCart(PER_HEC);
    eq("production (lot 0, corrigé) : ligne du menu à 9,76 €", p.ctx.cartItems.map(i => [i.key, i.pn, i.note ?? null]), [["otc-0", 9.76, null]]);
  }
}
{
  // même CIP au menu (3, ajouté par le tableau du menu) et en péremption (2)
  const { S, ctx } = application(APP);
  ctx.setQty("otc-0", 3);
  ctx.addItemToCart(PER_HEC);
  eq("menu + péremption : deux lignes, deux prix, clés distinctes", ctx.cartItems.map(i => [i.key, i.cat, i.qty, i.pn]), [["otc-0", "Centrale OTC", 3, 9.76], [`special-per-${HEC}`, "Péremption courte", 2, 5.16]]);
  eq("menu + péremption : la ligne du menu sans mention ; total 3 × 9,76 + 2 × 5,16 ; 5 unités", [ctx.cartItems[0].note, arrondi(ctx.cartTotal), ctx.cartCount], [undefined, 39.6, 5]);
  vrai("menu + péremption : la ligne péremption partira à part", M.partiraAPart(ctx.cartItems[1], ctx.cartItems));
  // ajout deux fois : une seule ligne péremption, quantité additionnée ; offre du moment (remise changée par l'admin)
  ctx.addItemToCart(ajoutPage({ ...PAGE_HEC, remise_admin: 30, earliest_expiry: "2027-01-15" }, 1));
  const per = ligne(ctx, `special-per-${HEC}`);
  eq("deux fois : une ligne, 3 unités, offre du moment (−30 %, 7,22 €, nouvelle date)", [ctx.cartItems.length, per.qty, per.pn, per.remise, per.note], [2, 3, 7.22, 30, "Pér. 15/01/2027"]);
  eq("deux fois : la ligne du menu ne bouge pas", S.quantities, { "otc-0": 3 });
  ctx.setItemQty(per, 5);
  eq("quantité modifiée : péremption 5, menu 3", ctx.cartItems.map(i => [i.key, i.qty]), [["otc-0", 3], [`special-per-${HEC}`, 5]]);
  ctx.setItemQty(ligne(ctx, "otc-0"), 0);
  eq("menu retiré : la ligne péremption reste", ctx.cartItems.map(i => [i.key, i.qty]), [[`special-per-${HEC}`, 5]]);
  ctx.setQty("otc-0", 3);
  ctx.setItemQty(ligne(ctx, `special-per-${HEC}`), 0);
  eq("péremption retirée : la ligne du menu reste, plus rien hors catalogue", [ctx.cartItems.map(i => [i.key, i.qty]), S.specialItems], [[["otc-0", 3]], []]);
}
{
  // justificatif (attestation, ordonnances) : gardé tant qu'une autre ligne du même CIP reste au panier
  const J = { [HEC]: { attestation: true, rx: [{ id: "x" }] } };
  const a = application(APP, { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], PER_HEC), justifInfo: J });
  a.ctx.setItemQty(ligne(a.ctx, `special-per-${HEC}`), 0);
  eq("justificatif : ligne péremption retirée, gardé pour la ligne du menu", a.S.justifInfo, J);
  a.ctx.setItemQty(ligne(a.ctx, "otc-0"), 0);
  eq("justificatif : dernière ligne du CIP retirée, effacé", a.S.justifInfo, {});
  const b = application(APP, { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], PER_HEC), justifInfo: J });
  b.ctx.setItemQty(ligne(b.ctx, "otc-0"), 0);
  eq("justificatif : ligne du menu retirée, gardé pour la ligne péremption", b.S.justifInfo, J);
}
{
  // produit hors menu ajouté par la Saisie (ligne hors catalogue ordinaire) ET depuis Péremption courte
  const { S, ctx } = application(APP);
  const saisie = { cip: EUPHY, name: PER_EUPHY.name, qty: 4, pn: 9.85, pv: 12.31, discount: 20, tiers: null };
  ctx.addItemToCart(saisie, { ouvrirPanier: false });
  ctx.addItemToCart(PER_EUPHY);
  ctx.addItemToCart({ ...saisie, qty: 2 }, { ouvrirPanier: false });
  eq("Saisie + péremption : deux lignes hors catalogue", ctx.cartItems.map(i => [i.key, i.cat, i.qty, i.pn, i.note ?? null]),
    [[`special-${EUPHY}`, "Hors catalogue", 6, 9.85, null], [`special-per-${EUPHY}`, "Péremption courte", 1, 6.16, "Pér. 31/01/2027"]]);
  ctx.setItemQty(ligne(ctx, `special-${EUPHY}`), 0);
  eq("ligne de la Saisie retirée : la ligne péremption reste (prix de base et remise gardés)", S.specialItems.map(s => [s.cip, s.qty, s.peremption, s.pv, s.remise]), [[EUPHY, 1, "2027-01-31", 12.31, 50]]);
}
{
  // Saisie seule (menu au colis, hors menu, multi-CIP) : comme la production
  const ajouts = [[{ cip: COLIS, name: "Produit au colis", qty: 12, pn: 2 }], [{ cip: DOLI, name: "DOLIPRANE 1000 mg", qty: 10, pn: 1.5 }],
    [{ cip: "3400000000099", name: "Produit Saisie", qty: 3, pn: 4.2, pv: 5, tiers: [{ min_qty: 3, price: 4 }] }, { ouvrirPanier: false }],
    [{ cip: "3400000000099", name: "Produit Saisie", qty: 1, pn: 4.2 }, { ouvrirPanier: false }],
    [{ cip: "3400000000088", name: "Fauteuil", qty: 1, pn: 300, supplier_code: "BR1" }]];
  const a = application(APP);
  for (const x of ajouts) a.ctx.addItemToCart(...x);
  eq("Saisie : quantités et lignes attendues", [a.S.quantities, a.S.specialItems.map(s => [s.cip, s.qty])], [{ "stratege-0": 12, "otc-1": 10 }, [["3400000000099", 4], ["3400000000088", 1]]]);
  if (PROD) {
    const p = application(PROD);
    for (const x of ajouts) p.ctx.addItemToCart(...x);
    eq("Saisie : même état que la production", [a.S.quantities, a.S.specialItems, a.S.flashes, a.S.cartOpen], [p.S.quantities, p.S.specialItems, p.S.flashes, p.S.cartOpen]);
    eq("Saisie : même panier calculé que la production (identité de ligne en plus)", sansNouveaux(a.ctx.cartItems), p.ctx.cartItems);
    eq("toute ligne hors catalogue : identité de ligne", a.ctx.cartItems.filter(i => i.isSpecial).map(i => i.specialId), ["3400000000099", "3400000000088"]);
  }
}
{
  // ajout depuis la page par ajouterDepuisSaisie : sans la règle de colis du menu (ligne à part, à son prix), panier ouvert
  const STRAT = COLIS;
  const a = application(APP);
  Object.assign(a.ctx, { SECTION_META: {}, justifProducts: {}, needsJustif: M.needsJustif, qtyByCip: M.qtyByCip, loadQuota: async () => null, quotaOver: () => ({ over: [] }), pagePeremption: { current: null } });
  for (const nom of ["regleSaisie", "arrondiSaisie", "ajouterDepuisSaisie"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
  a.ctx.ajouterDepuisSaisie(ajoutPage({ cip: STRAT, name: "Produit au colis", list_price: 3, discounted_price: 2, discount_pct: 33, earliest_expiry: "2026-12-31" }, 2), { ouvrirPanier: true });
  eq("page → produit au colis de 6 : 2 boîtes à part au prix de la page (pas d'arrondi au colis), panier ouvert", [a.S.quantities, a.S.specialItems.map(s => [s.cip, s.qty, s.pn]), a.S.cartOpen],
    [{}, [[STRAT, 2, 1.5]], true]);
  a.ctx.ajouterDepuisSaisie({ cip: STRAT, name: "Produit au colis", qty: 7, pn: 2 });
  eq("Saisie du même produit : arrondi au colis de 6, sur la ligne du menu", a.S.quantities, { "stratege-0": 6 });
}

// ── 2 bis. Bon copié (handleCopy) : mention sous la ligne péremption, rien d'autre ne change ──
async function copie(src, etat) {
  const { ctx } = application(src, etat);
  let texte = null;
  Object.assign(ctx, { pharmacyName: "PHARMACIE DU BANC", useState: (v) => [v, () => {}], setCopyStatus: () => {}, setTimeout: () => {},
    navigator: { clipboard: { writeText: async (t) => { texte = t; } } } });
  charge(expr(bloc(src, /^  const handleCopy = \(\) => \{$/)), ctx)();
  await new Promise(r => setImmediate(r));
  return texte.replace(/^Date : .*$/m, "Date : ‹masquée›");
}
{
  const t = await copie(APP, { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], PER_HEC) });
  const l = t.split("\n");
  const i = l.findIndex(x => x.startsWith(`${HEC}`) && x.includes("5.16€"));
  eq("bon copié : mention sous la ligne péremption", l[i + 1], `${" ".repeat(18)}Pér. 31/12/2026 · −50 % · péremption courte`);
  vrai("bon copié : total des deux lignes", t.includes("TOTAL : 39.60 €"));
  if (PROD) {
    const panier = { quantities: { "otc-0": 3, "otc-1": 12 }, specialItems: [{ cip: EUPHY, name: PER_EUPHY.name, qty: 2, pn: 9.85, pv: 12.31, tiers: null }] };
    eq("bon copié sans péremption : identique à la production", await copie(APP, panier), await copie(PROD, panier));
  }
}

// ── 3. Accueil : quantités des lignes des menus et de la Saisie (qteAccueil), « − » (modifierQte) ──
{
  const { S, ctx } = application(APP);
  ctx.setQty("otc-0", 3);
  ctx.addItemToCart(PER_HEC);
  eq("accueil : la carte compte la ligne du menu seulement (3, pas 5)", ctx.qteAccueil[HEC], 3);
  ctx.modifierQte(HEC, 2);
  eq("accueil « − » : menu 2, péremption 2 (jamais touchée)", [S.quantities["otc-0"], S.specialItems[0].qty, ctx.qteAccueil[HEC]], [2, 2, 2]);
  ctx.modifierQte(HEC, 0);
  eq("accueil « − » jusqu'à 0 : la ligne péremption reste ; plus rien pour la carte", [ctx.cartItems.map(i => [i.key, i.qty]), ctx.qteAccueil[HEC]], [[[`special-per-${HEC}`, 2]], undefined]);
  const c = application(APP, { quantities: { "stratege-0": 6 }, specialItems: M.ajouterPeremption([], { cip: COLIS, name: "Produit au colis", qty: 2, pn: 1, pv: 2, remise: 50, peremption: "2026-12-31" }) });
  c.ctx.modifierQte(COLIS, 0);
  eq("colis : « − » retire le colis du menu, pas la ligne péremption", c.ctx.cartItems.map(i => [i.key, i.qty]), [[`special-per-${COLIS}`, 2]]);
  const DEUX = { ...CATALOGUE, promo: { label: "Promo", accent: "#000", products: [{ cip: HEC, name: "HEC POM NACU T/25G", pn: 9.5 }] } };
  const J = { [HEC]: { attestation: true } };
  const d = application(APP, { catalogue: DEUX, quantities: { "otc-0": 3, "promo-0": 2 }, justifInfo: J });
  d.ctx.modifierQte(HEC, 4);
  eq("deux menus : « − » ramène le total à 4", M.qtyByCip(d.ctx.cartItems)[HEC], 4);
  d.ctx.modifierQte(HEC, 0);
  eq("deux menus : « − » jusqu'à 0, plus de ligne ni de justificatif", [d.ctx.cartItems.length, d.S.justifInfo], [0, {}]);
  const e = application(APP, { catalogue: DEUX, quantities: { "otc-0": 3, "promo-0": 2 }, specialItems: M.ajouterPeremption([], PER_HEC), justifInfo: J });
  e.ctx.modifierQte(HEC, 0);
  eq("deux menus + péremption : « − » jusqu'à 0, justificatif gardé pour la ligne péremption", [e.ctx.cartItems.map(i => i.key), e.S.justifInfo], [[`special-per-${HEC}`], J]);
  eq("baisse : n négatif traité comme 0", M.baisseParCip([{ qty: 2 }], -3).map(([, q]) => q), [0]);
}

// ── 4. Paniers enregistrés (localStorage) : chargés et calculés comme avant ──
{
  const memoire = { cart_quantities: JSON.stringify({ "otc-0": 3, "otc-1": 12 }),
    cart_special: JSON.stringify([{ cip: EUPHY, name: PER_EUPHY.name, qty: 2, pn: 9.85, pv: 12.31, tiers: null },
      { cip: "3400000000088", name: "Fauteuil", qty: 1, pn: 300, pv: 300, tiers: null, supplier_code: "BR1" }]),
    cart_justif: "{}" };
  const faux = { getItem: (k) => memoire[k] ?? null, setItem: (k, v) => { memoire[k] = v; } };
  const ctxL = { ...M, localStorage: faux, sessionStorage: faux };
  for (const nom of ["cartKeys", "cartStore", "readCart"]) ctxL[nom] = charge(expr(bloc(APP, new RegExp(`^const ${nom} = `))), ctxL);
  const [q, s] = ctxL.readCart(null);
  const a = application(APP, { quantities: q, specialItems: s });
  eq("panier enregistré : lignes chargées", a.ctx.cartItems.map(i => [i.key, i.cat, i.qty, i.pn]),
    [["otc-0", "Centrale OTC", 3, 9.76], ["otc-1", "Centrale OTC", 12, 1.4], [`special-${EUPHY}`, "Hors catalogue", 2, 9.85], ["special-3400000000088", "Hors catalogue", 1, 300]]);
  if (PROD) eq("panier enregistré : même calcul que la production", sansNouveaux(a.ctx.cartItems), application(PROD, { quantities: q, specialItems: s }).ctx.cartItems);
  a.ctx.addItemToCart(PER_EUPHY);
  eq("panier enregistré : nouvel ajout péremption = ligne à part", a.S.specialItems.map(x => [x.cip, x.qty, x.peremption ?? null]), [[EUPHY, 2, null], ["3400000000088", 1, null], [EUPHY, 1, "2027-01-31"]]);
  memoire.cart_special = JSON.stringify(a.S.specialItems);
  eq("panier avec ligne péremption : relu à l'identique", application(APP, { quantities: q, specialItems: ctxL.readCart(null)[1] }).ctx.cartItems, a.ctx.cartItems);
}

// ── 5. Envoi de la commande (sendOrder) : lignes enregistrées, e-mail, relais ──
// relais : doublure de submit-order avec l'anti-doublon d'envoiAuto (même pharmacie, même empreinte, autre commande →
// « double », pas d'envoi) ; relais partagé entre deux envois pour rejouer un vrai double envoi
const nouveauRelais = (sig = empreinte) => ({ sig, vues: new Map() });
// ids : numéros des envois (idsEnvoi) partagés entre deux envois ; serveur : commandes enregistrées partagées ; perdre(corps, n) :
// order-save enregistre puis la réponse se perd (coupure) ; justif : { produits, info } (produits sur justificatif labo)
async function envoyer(src, etat, { refuse = () => false, relais = nouveauRelais(), ids = { current: {} }, serveur = new Map(), perdre = () => false, justif = null } = {}) {
  const { S, ctx } = application(src, { ...etat, ...(justif?.info ? { justifInfo: justif.info } : {}) });
  const appels = [], journal = [], enregistrees = serveur;
  let n = 0;
  Object.assign(ctx, {
    justifProducts: justif?.produits || {}, setJustifProducts: () => {}, actingFor: null, pharmacyName: "PHARMACIE DU BANC", pharmacyEmail: "banc@exemple.fr", pharmacyCip: "1234567",
    isClient: true, DEFAULT_RECIPIENT: "pharmacien@elixirpharma.fr", MESSAGE_ENVOI_BLOQUE: { reconnexion: "r", admin: "a", fiche: "f", erreur: "e" },
    idsEnvoi: ids, setSendStatus: (v) => { S.statut.push(v); journal.push(`statut:${v}`); }, setEnvoiBloque: () => {},
    sessionPourEnvoi: async () => true, loadJustifProducts: async () => (justif?.produits || {}), loadQuota: async () => null,
    loadGroups: async () => null, codeOfCip: () => ({}), allocate: () => ({ lines: [], missing: 0 }),
    delai: () => ({}), freshPharmacyToken: async () => "jeton", submitJustif: async () => {},
    localStorage: { getItem: () => null },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (f) => S.minuteries.push(f),
    appelAuthentifie: async (url, o) => {
      const corps = JSON.parse(o.body), fn = url.split("/").pop();
      appels.push({ fn, corps }); journal.push(fn);
      if (fn === "order-save" && refuse(corps, ++n)) return { ok: false, status: 500, json: async () => ({ success: false, error: "panne" }) };
      if (fn === "order-save" && enregistrees.has(String(corps.id))) {   // order-save : même numéro → { deja } si même commande (CIP, quantités), 409 sinon
        const lignes = (its) => JSON.stringify(its.map(i => [String(i.cip ?? ""), Number(i.qty) || 0]));
        return lignes(enregistrees.get(String(corps.id))) === lignes(corps.items) ? { ok: true, status: 200, json: async () => ({ success: true, id: corps.id, deja: true }) }
          : { ok: false, status: 409, json: async () => ({ success: false, error: "numero" }) };
      }
      if (fn === "order-save") enregistrees.set(String(corps.id), corps.items);
      if (fn === "order-save" && perdre(corps, n)) throw new Error("réponse perdue (délai)");
      return { ok: true, status: 200, json: async () => ({ success: true, id: corps.id }) };
    },
    fetch: async (url, o) => {
      const corps = JSON.parse(o.body), fn = url.split("/").pop();
      appels.push({ fn, corps, keepalive: o.keepalive ?? null }); journal.push(fn);
      await new Promise(r => setImmediate(r));   // réponse du serveur (un tour plus tard)
      const sig = relais.sig(enregistrees.get(String(corps.orderId)) || []);
      const deja = relais.vues.get(sig);
      if (deja && deja !== String(corps.orderId)) return { json: async () => ({ queued: false, code: "double", error: `commande identique à la n° ${deja}` }) };
      relais.vues.set(sig, String(corps.orderId));
      return { json: async () => ({ queued: true, lignes: 1, reference: "r" }) };
    },
  });
  ctx.quotaOver = charge(expr(bloc(src, /^const quotaOver = /)), ctx);
  ctx.expandSupplierGroups = charge(expr(bloc(src, /^  const expandSupplierGroups = /)), ctx);
  const sendOrder = charge(expr(bloc(src, /^  const sendOrder = async \(\) => \{$/)), ctx);
  const retour = await sendOrder();
  for (let k = 0; k < 20; k++) await new Promise(r => setImmediate(r));   // relais lancé sans attendre
  for (const f of S.minuteries.splice(0)) f();                            // fin d'envoi (panier vidé ou gardé)
  return { retour, appels, journal, S, ctx, relais };
}
const fonctions = (appels) => appels.map(a => a.fn);
const etatRelais = (r) => [...r.relais.vues.values()];
{
  // menu HEC 3 + péremption HEC 2 + Doliprane 4
  const r = await envoyer(APP, { quantities: { "otc-0": 3, "otc-1": 4 }, specialItems: M.ajouterPeremption([], PER_HEC) });
  eq("même CIP : commande normale, commande à part, e-mail, relais de l'une puis de l'autre", [r.retour, fonctions(r.appels)], [true, ["order-save", "order-save", "send-email", "submit-order", "submit-order"]]);
  const [normale, aPart] = r.appels.filter(a => a.fn === "order-save").map(a => a.corps);
  eq("commande normale : lignes du menu seulement, total, CSV", [normale.items, arrondi(normale.totalHt), normale.nbLignes, normale.csv],
    [[{ cip: HEC, name: "HEC POM NACU T/25G", qty: 3, pn: 9.76, total: 29.28 }, { cip: DOLI, name: "DOLIPRANE 1000 mg", qty: 4, pn: 1.5, total: 6 }], 35.28, 2, `${HEC};3\n${DOLI};4`]);
  eq("commande à part : prix de la page, mention, date, remise, facturation par Odoo et n° de l'autre commande", aPart.items,
    [{ cip: HEC, name: "HEC POM NACU T/25G", qty: 2, pn: 5.16, total: 10.32, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false, separeDe: String(normale.id) }]);
  eq("commande à part : numéro voisin, même pharmacie, source catalogue (relayée)", [aPart.id - normale.id, aPart.pharmacyCip, aPart.source, arrondi(aPart.totalHt), aPart.csv], [2, "1234567", "catalogue", 10.32, `${HEC};2`]);
  eq("relais : commande normale puis commande à part, toutes deux en file, keepalive", [r.appels.filter(a => a.fn === "submit-order").map(a => [a.corps.orderId, a.keepalive]), etatRelais(r)],
    [[[normale.id, true], [aPart.id, true]], [String(normale.id), String(aPart.id)]]);
  eq("« Commande envoyée » après la demande des deux relais", r.journal, ["statut:sending", "order-save", "order-save", "send-email", "submit-order", "submit-order", "statut:success", "statut:null"]);
  const mail = r.appels.find(a => a.fn === "send-email").corps.template_params;
  eq("e-mail : toutes les lignes, total du panier", [mail.nb_lignes, mail.nb_unites, mail.total_ht], [3, 9, "45,60 €"]);
  vrai("e-mail : mention, commande à part (deux numéros), boîtes à corriger dans Odoo, sinon Contrôle des écarts", mail.order_lines.includes(
    `• HEC POM NACU T/25G — PÉREMPTION COURTE (Pér. 31/12/2026, −50 %, prix de la page)\n  Commande à part n° ${aPart.id} (même produit dans la commande n° ${normale.id})\n`
    + `  ⚠ prix de la page Péremption courte (−50 %) non repris par Odoo, qui facture le tarif de la liste du client : corriger 2 boîtes à 5,16 € ; dans Odoo, elles peuvent être additionnées à la ligne du même produit de la commande n° ${normale.id} : corriger 2 boîtes seulement, pas toute la ligne (sinon : Contrôle des écarts, onglet Péremptions)\n`
    + "  Qté : 2  |  PU : 5,16 €  |  Total : 10,32 €"));
  vrai("e-mail : la ligne du menu sans mention", mail.order_lines.startsWith("• HEC POM NACU T/25G\n  Qté : 3  |  PU : 9,76 €"));
  eq("fin d'envoi : panier vidé", [r.S.quantities, r.S.specialItems], [{}, []]);
}
{
  // même produit, même quantité : deux commandes que l'anti-doublon du relais ne confond pas
  const panier = { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], { ...PER_HEC, qty: 3 }) };
  const r = await envoyer(APP, panier);
  const [normale, aPart] = r.appels.filter(a => a.fn === "order-save").map(a => a.corps);
  vrai("même quantité : empreintes du relais différentes", empreinte(normale.items) !== empreinte(aPart.items));
  eq("même quantité : les deux commandes en file (aucun « double »)", etatRelais(r), [String(normale.id), String(aPart.id)]);
  if (RELAIS_PROD) {
    const ancienne = empreinteDe(RELAIS_PROD);
    vrai("relais de la production (corrigé) : même empreinte, la commande à part aurait été classée doublon", ancienne(normale.items) === ancienne(aPart.items));
    const sans = [{ cip: HEC, qty: 3 }, { cip: DOLI, qty: "4" }, { cip: null, qty: 1 }];
    eq("sans ligne péremption : même empreinte qu'en production", empreinte(sans), ancienne(sans));
  }
  const partage = nouveauRelais();
  const r1 = await envoyer(APP, panier, { relais: partage });
  await new Promise(r0 => setTimeout(r0, 5));
  const r2 = await envoyer(APP, panier, { relais: partage });
  const ids2 = r2.appels.filter(a => a.fn === "order-save").map(a => String(a.corps.id));
  eq("vrai double envoi : seules les commandes du premier envoi partent", [...partage.vues.values()], r1.appels.filter(a => a.fn === "order-save").map(a => String(a.corps.id)));
  vrai("vrai double envoi : aucune commande du second en file", ids2.every(id => ![...partage.vues.values()].includes(id)));
}
{
  // péremption seule (aucune autre ligne du même CIP) : dans la commande normale
  const r = await envoyer(APP, { quantities: { "otc-1": 4 }, specialItems: M.ajouterPeremption([], PER_EUPHY) });
  eq("péremption seule : une commande, e-mail, un relais", fonctions(r.appels), ["order-save", "send-email", "submit-order"]);
  eq("péremption seule : ligne enregistrée au prix de la page (sans separeDe)", r.appels[0].corps.items[1],
    { cip: EUPHY, name: PER_EUPHY.name, qty: 1, pn: 6.16, total: 6.16, note: "Pér. 31/01/2027", peremption: "2027-01-31", remise: 50, facture_odoo: false });
  const lignes = r.appels[1].corps.template_params.order_lines;
  vrai("péremption seule : e-mail sans « commande à part », boîte à corriger", !lignes.includes("Commande à part") && lignes.includes("corriger 1 boîte à 6,16 € (sinon : Contrôle des écarts, onglet Péremptions)\n  Qté : 1"));
  eq("sans commande à part : « Commande envoyée » avant le relais (comme la production)", r.journal, ["statut:sending", "order-save", "send-email", "statut:success", "submit-order", "statut:null"]);
}
{
  // ligne facturée par une règle Odoo (V1) : ni consigne ni écart
  const v1 = ajoutPage({ ...PAGE_ZADI, facturee: true, remise_pct: 12, discounted_price: 3.37, discount_pct: 12, prix_base: 3.83 }, 2);
  const r = await envoyer(APP, { specialItems: M.ajouterPeremption([], v1) });
  eq("règle Odoo facturée : ligne enregistrée facture_odoo, remise de la facture", r.appels[0].corps.items.map(i => [i.pn, i.remise, i.facture_odoo]), [[3.37, 12, true]]);
  vrai("règle Odoo facturée : e-mail « remise −12 % facturée par Odoo », sans boîtes à corriger", r.appels[1].corps.template_params.order_lines.includes("PÉREMPTION COURTE (Pér. 31/12/2026, remise −12 % facturée par Odoo)\n  Qté : 2"));
}
{
  // commande à part refusée (panne) : la commande normale part, la ligne péremption reste au panier
  const r = await envoyer(APP, { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], PER_HEC) }, { refuse: (c, n) => n === 2 });
  eq("à part refusée : commande normale enregistrée et relayée seule", [fonctions(r.appels), r.appels.filter(a => a.fn === "submit-order").length], [["order-save", "order-save", "send-email", "submit-order"], 1]);
  const mail = r.appels.find(a => a.fn === "send-email").corps.template_params;
  eq("à part refusée : e-mail sans la ligne refusée", [mail.nb_lignes, mail.nb_unites, mail.total_ht], [1, 3, "29,28 €"]);
  eq("à part refusée : ligne péremption gardée au panier, menu vidé", [r.S.quantities, r.S.specialItems.map(s => [s.cip, s.qty, s.peremption])], [{}, [[HEC, 2, "2026-12-31"]]]);
  vrai("à part refusée : message", r.S.flashes.some(m => m.startsWith("⚠ Ligne(s) péremption courte NON enregistrée(s) (panne)")));
}
{
  // revue du 21/10/2026 : commande à part enregistrée mais réponse perdue (délai, coupure) → ligne gardée au panier ; renvoyée
  // seule, elle reprend le numéro de la commande à part (clé sans separeDe) : order-save répond { deja }, un seul relais
  const ids = { current: {} }, serveur = new Map(), relais = nouveauRelais();
  const r1 = await envoyer(APP, { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], PER_HEC) }, { ids, serveur, relais, perdre: (c, n) => n === 2 });
  const aPart1 = r1.appels.filter(a => a.fn === "order-save")[1].corps;
  eq("réponse perdue : commande à part enregistrée par le serveur, ligne gardée au panier, relais de la commande normale seule",
    [serveur.has(String(aPart1.id)), r1.S.specialItems.map(x => [x.cip, x.qty]), r1.appels.filter(a => a.fn === "submit-order").length], [true, [[HEC, 2]], 1]);
  const r2 = await envoyer(APP, { specialItems: r1.S.specialItems }, { ids, serveur, relais });
  const save2 = r2.appels.find(a => a.fn === "order-save").corps;
  eq("nouvel envoi : même numéro que la commande à part perdue → reconnue ({ deja }), aucune nouvelle commande", [String(save2.id), serveur.size], [String(aPart1.id), 2]);
  eq("nouvel envoi : la commande à part relayée une seule fois en tout", [...relais.vues.values()].filter(v => v === String(aPart1.id)).length, 1);
  if (PROD) {
    // avant : clé avec separeDe → nouveau numéro, deuxième commande enregistrée
    const cle = (items) => JSON.stringify([null, "banc@exemple.fr", "catalogue", items]);
    vrai("avant (clé avec separeDe) : les deux envois n'avaient pas la même clé", cle(aPart1.items) !== cle(save2.items));
  }
}
{
  // revue du 21/10/2026 : produit sur justificatif labo (dispo 3) au menu ET en péremption : la ligne péremption (stock court
  // d'Elixir) n'est jamais « sur justificatif » ; le justificatif se compte hors ligne péremption
  const justif = { produits: { [HEC]: { dispo: 3, labNom: "Labo", ordonnance: "non" } }, info: { [HEC]: { attestation: true } } };
  const r = await envoyer(APP, { quantities: { "otc-0": 3 }, specialItems: M.ajouterPeremption([], PER_HEC) }, { justif });
  eq("justificatif : menu 3 (≤ dispo) en commande normale, péremption 2 à part, aucune commande justificatif",
    r.appels.filter(a => a.fn === "order-save").map(a => [a.corps.source, a.corps.items.map(i => [i.qty, i.pn])]), [["catalogue", [[3, 9.76]]], ["catalogue", [[2, 5.16]]]]);
  const r2 = await envoyer(APP, { quantities: { "otc-0": 4 }, specialItems: M.ajouterPeremption([], PER_HEC) }, { justif });
  eq("justificatif : menu 4 (> dispo) sur justificatif, péremption 2 en commande normale (jamais au labo)",
    r2.appels.filter(a => a.fn === "order-save").map(a => [a.corps.source, a.corps.items.map(i => [i.qty, i.pn, i.peremption ?? null])]),
    [["catalogue", [[2, 5.16, "2026-12-31"]]], ["justificatif", [[4, 9.76, null]]]]);
  vrai("justificatif : e-mail sans « SUR JUSTIFICATIF » sur la ligne péremption", !/PÉREMPTION COURTE[^\n]*\n[^\n]*SUR JUSTIFICATIF|SUR JUSTIFICATIF LABO \(Labo\) — PÉREMPTION/.test(r2.appels.find(a => a.fn === "send-email").corps.template_params.order_lines));
}
if (PROD) {
  // panier sans péremption : envois identiques à la production (numéros et dates masqués)
  const masque = (appels) => JSON.parse(JSON.stringify(appels.map(({ keepalive, ...a }) => a), (k, v) => ["id", "date", "orderId", "order_date"].includes(k) ? "‹masqué›" : v));   // eslint-disable-line no-unused-vars
  const panier = { quantities: { "otc-0": 3, "otc-1": 12, "stratege-0": 6 }, specialItems: [{ cip: "3400000000099", name: "Produit Saisie", qty: 3, pn: 4.2, pv: 5, tiers: null },
    { cip: EUPHY, name: PER_EUPHY.name, qty: 2, pn: 9.85, pv: 12.31, tiers: null }] };
  const a = await envoyer(APP, panier), p = await envoyer(PROD, panier);
  eq("sans péremption : mêmes envois que la production", masque(a.appels), masque(p.appels));
  eq("sans péremption : même enchaînement et même fin d'envoi que la production", [a.journal, a.S.quantities, a.S.specialItems, a.retour], [p.journal, p.S.quantities, p.S.specialItems, p.retour]);
}

// ── 6. Panier enregistré : contrôle des lignes péremption (controlerPrixPanier d'App.jsx, vrai code) ──
// page : { produits, retirees, masques } de peremption?action=page ; prix : réponse de peremption?action=prix ; v1 = false :
// fonction absente → repli odoo-catalog + expiry_discounts ; pendant : modification du panier pendant la lecture
async function controle(etat, { produits = [PAGE_HEC, PAGE_EUPHY, PAGE_ZADI], retirees = [], masques = [], prix = [], echec = false, v1 = true, remises = [], pendant = null, cache = { current: null }, frais = false, catalogue = CATALOGUE } = {}) {
  const a = application(APP, { ...etat, catalogue });
  const urls = [];
  Object.assign(a.ctx, { pagePeremption: cache, panierCourant: { get current() { return a.S.specialItems; } }, prixRemontes: {}, setPrixRemontes: (f) => { a.ctx.prixRemontes = f(a.ctx.prixRemontes); },
    fetch: async (url) => { urls.push(url);
      if (pendant && urls.length === 1) pendant(a.ctx);
      if (url === "/.netlify/functions/peremption?action=page") return echec || !v1 ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ produits, retirees, masques }) };
      if (url.startsWith("/.netlify/functions/peremption?action=prix&cips=")) return { ok: true, json: async () => ({ produits: prix.filter(p => url.includes(p.cip)) }) };
      if (url === "/.netlify/functions/odoo-catalog?expiry_months=4") return echec ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ products: produits.map(({ remise_admin, ...p }) => p) }) };   // eslint-disable-line no-unused-vars
      if (url === "/.netlify/functions/restock-alert?action=expiry_discounts") return { ok: true, json: async () => remises };
      throw new Error(url); } });
  a.ctx.SECTION_META = {};
  for (const nom of ["regleSaisie", "arrondiSaisie", "rayonDe"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
  a.ctx.lirePagePeremption = charge(expr(bloc(APP, /^  const lirePagePeremption = \(\) => \{$/)), a.ctx);
  a.ctx.controlerPrixPanier = charge(expr(bloc(APP, /^  const controlerPrixPanier = async \(lignes, \{ frais = false \} = \{\}\) => \{$/)), a.ctx);
  const retour = await a.ctx.controlerPrixPanier(a.S.specialItems, { frais });
  return { ...a, urls, retour };
}
{
  // offre changée par l'admin (−50 % → −30 %) : ligne remise au prix actuel de la page, à la hausse
  const c1 = await controle({ specialItems: M.ajouterPeremption([], PER_HEC) }, { produits: [{ ...PAGE_HEC, remise_admin: 30 }] });
  eq("contrôle : remise passée à −30 % → ligne à 7,22 € (prix actuel de la page), remise gardée sur la ligne", c1.S.specialItems.map(s => [s.pn, s.remise, s.facture_odoo, s.peremption, s.qty]), [[7.22, 30, false, "2026-12-31", 2]]);
  eq("contrôle : message et encart de la ligne", [c1.S.flashes[0], M.detailControle(c1.ctx.prixRemontes[`per:${HEC}`])],
    ["⚠ Péremption courte : prix de la page mis à jour (HEC POM NACU T/25G : 7,22 €, −30 %)", "7,22 € au lieu de 5,16 € : prix actuel de la page (−30 %)"]);
  // à la baisse aussi (offre plus forte), et règle Odoo posée entre-temps
  const c2 = await controle({ specialItems: M.ajouterPeremption([], ajoutPage({ ...PAGE_HEC, remise_admin: 30 }, 1)) });
  eq("contrôle : remise revenue à −50 % → ligne à 5,16 € (en faveur de la pharmacie)", c2.S.specialItems.map(s => [s.pn, s.remise]), [[5.16, 50]]);
  const c3 = await controle({ specialItems: M.ajouterPeremption([], ajoutPage(PAGE_ZADI, 2)) }, { produits: [{ ...PAGE_ZADI, facturee: true, remise_pct: 12, discounted_price: 3.37, discount_pct: 12, prix_base: 3.83 }] });
  eq("contrôle : règle Odoo posée → ligne facturée par Odoo à 3,37 €, −12 %", c3.S.specialItems.map(s => [s.pn, s.remise, s.facture_odoo]), [[3.37, 12, true]]);
  // rien à faire : aucun message, même tableau ; date seule changée : mise à jour sans message
  const c4 = await controle({ specialItems: M.ajouterPeremption([], PER_HEC) });
  eq("contrôle : offre inchangée → rien, aucun message", [c4.S.flashes.length, c4.S.specialItems.length], [0, 1]);
  const c5 = await controle({ specialItems: M.ajouterPeremption([], PER_HEC) }, { produits: [{ ...PAGE_HEC, earliest_expiry: "2027-01-15" }] });
  eq("contrôle : lot de la page changé → date de la ligne mise à jour, sans message", [c5.S.specialItems[0].peremption, c5.S.flashes.length], ["2027-01-15", 0]);
}
{
  // produit sorti de la page : ligne remise au prix habituel, rajoutée comme un ajout ordinaire (ligne du menu)
  const MASQUE = { cip: HEC, name: "HEC POM NACU T/25G", list_price: 10.32, discounted_price: 9.76, discount_pct: 5.4, price_tiers: null };
  const s1 = await controle({ quantities: { "otc-0": 1 }, specialItems: M.ajouterPeremption([], PER_HEC) }, { produits: [PAGE_EUPHY], masques: [MASQUE] });
  eq("sortie (produit « fantôme ») : la ligne péremption disparaît, ses boîtes vont sur la ligne du menu au prix du menu", [s1.S.specialItems, s1.S.quantities, s1.ctx.cartItems.map(i => [i.key, i.qty, i.pn])],
    [[], { "otc-0": 3 }, [["otc-0", 3, 9.76]]]);
  eq("sortie : message « plus en péremption courte », prix réellement pris (ligne du menu)", s1.S.flashes.at(-1), "⚠ Plus en péremption courte, ligne remise au prix habituel (HEC POM NACU T/25G : ligne du menu « Centrale OTC », à son prix)");
  // produit hors menu, absent de toutes les listes de la page : prix habituel demandé au serveur (peremption?action=prix)
  const EUPHY_HAB = { cip: EUPHY, name: PAGE_EUPHY.name, list_price: 12.31, discounted_price: 9.85, discount_pct: 20, price_tiers: null };
  const s2 = await controle({ specialItems: M.ajouterPeremption([], PER_EUPHY) }, { produits: [PAGE_HEC], prix: [EUPHY_HAB] });
  eq("sortie hors menu : prix habituel demandé (action=prix), ligne hors catalogue ordinaire à 9,85 €", [s2.urls.at(-1), s2.S.specialItems.map(s => [s.cip, s.qty, s.pn, s.peremption ?? null])],
    [`/.netlify/functions/peremption?action=prix&cips=${EUPHY}`, [[EUPHY, 1, 9.85, null]]]);
  const s3 = await controle({ specialItems: M.ajouterPeremption([], PER_EUPHY) }, { produits: [PAGE_HEC], prix: [] });
  eq("sortie, prix introuvable : ligne inchangée (contrôle suivant)", [s3.S.specialItems[0].pn, s3.S.flashes.length], [6.16, 0]);
}
{
  // panier de l'ancienne page (avant le 20/10 : −50 % sans mention) → ligne péremption ; ligne du lot 0 (mention au prix
  // habituel) → prix de la page ; ligne de la Saisie au prix habituel : jamais touchée
  const ancien = [{ cip: ZADI, name: PAGE_ZADI.name, qty: 2, pn: 1.92, pv: 3.83, tiers: null }];
  const a1 = await controle({ specialItems: ancien });
  eq("ancienne page : Zaditen 1,92 € (3,83 × 0,5) devenu ligne péremption au prix de la page", a1.S.specialItems.map(s => [s.cip, s.qty, s.pn, s.remise, s.peremption]), [[ZADI, 2, 1.92, 50, "2026-12-31"]]);
  // ligne du lot 0 : en production (b1dbd3e), un ajout de la Saisie et un ajout de la page du même CIP allaient sur la même
  // ligne : 10 boîtes dont 8 de la Saisie. Jamais passée d'office au prix de la page (revue du 21/10/2026)
  const lot0 = [{ cip: EUPHY, name: PAGE_EUPHY.name, qty: 10, pn: 9.85, pv: 12.31, tiers: null, peremption: "2027-01-31" }];
  const a2 = await controle({ specialItems: lot0 });
  eq("ligne du lot 0 (mention sans remise) → ligne ordinaire au prix habituel (9,85 €), 10 boîtes, plus de mention", a2.S.specialItems.map(s => [s.cip, s.qty, s.pn, s.remise ?? null, s.peremption ?? null]), [[EUPHY, 10, 9.85, null, null]]);
  eq("ligne du lot 0 : message (ajoutez-la depuis la page pour le prix péremption)", a2.S.flashes.at(-1),
    "⚠ Ligne « Pér. » d'avant le 21/10 remise au prix habituel (EUPHYTOSE NUIT MYRTILLE GOMME 30 : 9,85 €) : pour le prix péremption, ajoutez-la depuis la page Péremption courte");
  const v1 = [{ cip: ZADI, name: PAGE_ZADI.name, qty: 1, pn: 3.29, pv: 3.83, tiers: null, peremption: "2026-12-31", peremption_remise: 12 }];
  const a3 = await controle({ specialItems: v1 });
  eq("ligne V1 dont la règle Odoo a pris fin → offre actuelle (−50 %), plus facturée par Odoo, champ V1 retiré", a3.S.specialItems.map(s => [s.pn, s.remise, s.facture_odoo, "peremption_remise" in s]), [[1.92, 50, false, false]]);
  const saisie = [{ cip: EUPHY, name: PAGE_EUPHY.name, qty: 3, pn: 9.85, pv: 12.31, tiers: null }, { cip: ZADI, name: "Multi-CIP", qty: 1, pn: 1.92, supplier_code: "Z1" }];
  const a4 = await controle({ specialItems: saisie });
  eq("ligne de la Saisie et article multi-CIP : jamais touchés", [a4.S.specialItems, a4.S.flashes.length], [saisie, 0]);
}
{
  // revue du 21/10/2026 : produit au colis (Stratège, colis de 6) qui quitte la page : rajouté par la règle de la Saisie
  const MASQUE_COLIS = { cip: COLIS, name: "Produit au colis", list_price: 3, discounted_price: 2.5, discount_pct: 16.7, price_tiers: null };
  const perColis = (q) => M.ajouterPeremption([], ajoutPage({ cip: COLIS, name: "Produit au colis", list_price: 3, discounted_price: 2.5, discount_pct: 16.7, earliest_expiry: "2026-12-31" }, q));
  const c1 = await controle({ specialItems: perColis(2) }, { produits: [PAGE_HEC], masques: [MASQUE_COLIS] });
  eq("colis : 2 boîtes sorties de la page → sous le colis de 6 : ligne retirée (jamais 2 boîtes au prix carton)", [c1.S.quantities, c1.S.specialItems], [{}, []]);
  eq("colis : message « se commande par 6 »", c1.S.flashes.at(-1), "⚠ Plus en péremption courte, ligne remise au prix habituel (Produit au colis : se commande par 6 dans « Sélection Stratège », ligne retirée)");
  const c2 = await controle({ specialItems: perColis(8) }, { produits: [PAGE_HEC], masques: [MASQUE_COLIS] });
  eq("colis : 8 boîtes → arrondi au colis (6) sur la ligne du menu", [c2.S.quantities, c2.S.specialItems, c2.S.flashes.at(-1)],
    [{ "stratege-0": 6 }, [], "⚠ Plus en péremption courte, ligne remise au prix habituel (Produit au colis : ligne du menu « Sélection Stratège », à son prix (arrondi au colis de 6 : 6))"]);
  if (PROD) {
    const ancien = application(PROD, { specialItems: perColis(2) });
    vrai("colis : la règle de la Saisie, celle de la production (regleSaisie)", bloc(PROD, /^  const regleSaisie = /) === bloc(APP, /^  const regleSaisie = /) && !!ancien);
  }
  // campagne (palier de 4) : même règle que son tableau, prix de la campagne
  const CAMP = { camp: { label: "Campagne Zaditen", accent: "#111", products: [{ cip: ZADI, name: "ZADITEN 1 mg/5 ml", pn: 3.6, pv: 3.83 }] } };
  const MASQUE_ZADI = { cip: ZADI, name: PAGE_ZADI.name, list_price: 3.83, discounted_price: 3.6, discount_pct: 6, price_tiers: null };
  const avecCampagne = async (q) => {
    const a = application(APP, { specialItems: M.ajouterPeremption([], ajoutPage(PAGE_ZADI, q)), catalogue: CAMP });
    Object.assign(a.ctx, { getCampaign: (k) => (k === "camp" ? { palier_remise: 33 } : null), buildGroupes: () => [{}], campGetGroupe: () => ({ step: 4, min_qty: 4, multiple: 4 }),
      SECTION_META: {}, pagePeremption: { current: null }, panierCourant: { get current() { return a.S.specialItems; } }, prixRemontes: {}, setPrixRemontes: () => {},
      fetch: async (url) => (url.includes("action=page") ? { ok: true, json: async () => ({ produits: [PAGE_HEC], masques: [MASQUE_ZADI], retirees: [] }) } : { ok: false, json: async () => ({}) }) });
    a.ctx.getStepMin = charge(expr(bloc(APP, /^  const getStepMin = /)), a.ctx);
    for (const nom of ["regleSaisie", "arrondiSaisie", "rayonDe", "lirePagePeremption", "controlerPrixPanier"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
    await a.ctx.controlerPrixPanier(a.S.specialItems);
    return a;
  };
  const k1 = await avecCampagne(5);
  eq("campagne (palier de 4) : 5 boîtes sorties de la page → 4 sur la ligne de la campagne, à son prix", [k1.S.quantities, k1.S.specialItems, k1.ctx.cartItems.map(i => [i.key, i.qty, i.pn])], [{ "camp-0": 4 }, [], [["camp-0", 4, 2.57]]]);
  vrai("campagne : message « ligne du menu « Campagne Zaditen », à son prix »", /Campagne Zaditen », à son prix \(arrondi au colis de 4 : 4\)/.test(k1.S.flashes.at(-1)));
}
{
  // revue du 21/10/2026 : plafond = boîtes à date courte (court_qte des faits frais ; sinon lots de la page dans la fenêtre)
  const AUJ = Date.parse("2026-10-21T10:00:00Z");
  eq("plafond : court_qte du serveur ; lots de la fenêtre ; lot long exclu ; rien de connu → sans plafond ; règle Odoo avec lot long forcé → sans plafond",
    [M.plafondCourt({ ...PAGE_HEC, court_qte: 3 }, AUJ), M.plafondCourt({ ...PAGE_HEC, lots: [{ lot_name: "A", qty: 2, expiry: "2026-12-31" }, { lot_name: "B", qty: 4, expiry: "2027-02-28" }, { lot_name: "C", qty: 50, expiry: "2028-06-30" }] }, AUJ),
      M.plafondCourt(PAGE_HEC, AUJ), M.plafondCourt({ ...PAGE_ZADI, court_qte: 3, facturee: true, remise_pct: 12, discounted_price: 3.37, discount_pct: 12, force_lot_long: true }, AUJ), M.finFenetre(AUJ)],
    [3, 6, null, null, "2027-02-28"]);
  const P3 = { ...PAGE_HEC, court_qte: 3 };
  const a = application(APP);
  Object.assign(a.ctx, { SECTION_META: {}, justifProducts: {}, needsJustif: M.needsJustif, qtyByCip: M.qtyByCip, loadQuota: async () => null, quotaOver: () => ({ over: [] }), pagePeremption: { current: null } });
  for (const nom of ["regleSaisie", "arrondiSaisie", "ajouterDepuisSaisie"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
  eq("page : quantité ramenée au plafond (5 saisies → 3 envoyées au panier)", [ajoutPage(P3, 5).qty, ajoutPage(P3, 5).plafond], [3, 3]);
  a.ctx.ajouterDepuisSaisie(M.offrePeremption(P3, 5), { ouvrirPanier: true });
  eq("plafond (App) : 5 demandées, 3 boîtes courtes → 3 au prix de la page, message", [a.S.specialItems.map(x => [x.qty, x.pn, x.plafond]), a.S.flashes.at(-1)],
    [[[3, 5.16, 3]], "✓ 3× HEC POM NACU T/25G ajouté au panier · 3 boîtes à date courte au plus à ce prix"]);
  a.ctx.ajouterDepuisSaisie(ajoutPage(P3, 1), { ouvrirPanier: true });
  eq("plafond atteint : rien ajouté, message", [a.S.specialItems.map(x => x.qty), a.S.flashes.at(-1)], [[3], "⚠ HEC POM NACU T/25G : 3 boîtes à date courte au plus à ce prix, déjà au panier"]);
  const l = ligne(a.ctx, `special-per-${HEC}`);
  eq("panier : plafond sur la ligne (le « + » s'arrête à 3)", [l.plafond, APP.includes("disabled={item.plafond != null && item.qty >= item.plafond}")], [3, true]);
  // panier enregistré : plafond baissé (2 boîtes courtes) → ligne à 2, l'excédent repart au prix habituel (ligne du menu)
  const c = await controle({ specialItems: a.S.specialItems }, { produits: [{ ...PAGE_HEC, court_qte: 2 }] });
  eq("plafond baissé : ligne péremption à 2, 1 boîte sur la ligne du menu au prix du menu", c.ctx.cartItems.map(i => [i.key, i.qty, i.pn]), [["otc-0", 1, 9.76], [`special-per-${HEC}`, 2, 5.16]]);
  eq("plafond baissé : message", c.S.flashes.at(-1), "⚠ Péremption courte : boîtes à date courte au plus à ce prix (HEC POM NACU T/25G : 2) ; le reste repart au prix habituel (HEC POM NACU T/25G : ligne du menu « Centrale OTC », à son prix)");
}
{
  // revue du 21/10/2026 : lecture gardée 5 min périmée par un ajout depuis la page (remise passée à 0 entre-temps)
  const PAGE50 = { produits: [PAGE_HEC], horsPage: [], remises: null, v1: true };
  const cache = { current: { t: Date.now(), promesse: Promise.resolve(PAGE50) } };
  const a = application(APP);
  const urls = [];
  Object.assign(a.ctx, { SECTION_META: {}, justifProducts: {}, needsJustif: M.needsJustif, qtyByCip: M.qtyByCip, loadQuota: async () => null, quotaOver: () => ({ over: [] }), pagePeremption: cache,
    panierCourant: { get current() { return a.S.specialItems; } }, prixRemontes: {}, setPrixRemontes: () => {},
    fetch: async (url) => { urls.push(url); return { ok: true, json: async () => ({ produits: [{ ...PAGE_HEC, remise_admin: 0 }], retirees: [], masques: [] }) }; } });
  for (const nom of ["regleSaisie", "arrondiSaisie", "rayonDe", "ajouterDepuisSaisie", "lirePagePeremption", "controlerPrixPanier"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
  a.ctx.ajouterDepuisSaisie(ajoutPage({ ...PAGE_HEC, remise_admin: 0 }, 1), { ouvrirPanier: true });
  await a.ctx.controlerPrixPanier(a.S.specialItems);
  eq("lecture gardée périmée par l'ajout : page relue, ligne à 0 % gardée (9,76 €), aucun message contradictoire", [urls, a.S.specialItems.map(x => [x.pn, x.remise])],
    [["/.netlify/functions/peremption?action=page"], [[9.76, 0]]]);
}
{
  // revue du 21/10/2026 : contrôle sans lecture gardée juste avant l'envoi ; panier changé → rien ne part
  const prepare = (lignes, pageProduits) => {
    const a = application(APP, { specialItems: lignes });
    let envois = 0;
    Object.assign(a.ctx, { SECTION_META: {}, sendingRef: { current: false }, controleEnvoi: { current: false }, handleSend: () => { envois++; },
      pagePeremption: { current: { t: Date.now(), promesse: Promise.resolve({ produits: [PAGE_HEC], horsPage: [], remises: null, v1: true }) } },
      panierCourant: { get current() { return a.S.specialItems; } }, prixRemontes: {}, setPrixRemontes: () => {},
      fetch: async () => ({ ok: true, json: async () => ({ produits: pageProduits, retirees: [], masques: [] }) }) });
    for (const nom of ["regleSaisie", "arrondiSaisie", "rayonDe", "lirePagePeremption", "controlerPrixPanier", "envoyerCommande"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
    return { a, envois: () => envois };
  };
  const x = prepare(M.ajouterPeremption([], PER_HEC), [{ ...PAGE_HEC, remise_admin: 0 }]);
  await x.a.ctx.envoyerCommande();
  eq("avant l'envoi : remise passée à 0 → ligne remise à 9,76 €, rien ne part, panier ouvert, message", [x.envois(), x.a.S.specialItems.map(l => l.pn), x.a.S.cartOpen, /renvoyez la commande$/.test(x.a.S.flashes.at(-1))], [0, [9.76], true, true]);
  const y = prepare(M.ajouterPeremption([], PER_HEC), [PAGE_HEC]);
  await y.a.ctx.envoyerCommande();
  eq("avant l'envoi : offre inchangée → envoi", [y.envois(), y.a.S.flashes.length], [1, 0]);
  const z = prepare([{ cip: EUPHY, name: "Saisie", qty: 1, pn: 9.85 }], [PAGE_HEC]);
  await z.a.ctx.envoyerCommande();
  eq("avant l'envoi : panier sans ligne péremption → envoi direct, aucune lecture", z.envois(), 1);
  vrai("bouton « Envoyer la commande » : envoyerCommande", /onClick=\{envoyerCommande\}/.test(APP));
}
{
  // panier changé pendant la lecture : rien n'est appliqué (le contrôle suivant reprend) ; page illisible : rien ne change
  const p1 = await controle({ specialItems: M.ajouterPeremption([], PER_HEC) }, { produits: [{ ...PAGE_HEC, remise_admin: 30 }], pendant: (ctx) => ctx.addItemToCart(PER_EUPHY) });
  eq("panier changé pendant la lecture : rien appliqué", p1.S.specialItems.map(s => [s.cip, s.pn]), [[HEC, 5.16], [EUPHY, 6.16]]);
  const cache = { current: null };
  const p2 = await controle({ specialItems: M.ajouterPeremption([], PER_HEC) }, { echec: true, cache });
  eq("page illisible : panier inchangé, nouvel essai au contrôle suivant", [p2.S.specialItems[0].pn, p2.S.flashes.length, cache.current], [5.16, 0, null]);
  const p3 = await controle({ specialItems: M.ajouterPeremption([], PER_HEC) }, { v1: false, produits: [PAGE_HEC], remises: [{ cip: HEC, discount_pct: 30 }] });
  eq("fonction peremption absente : repli odoo-catalog + expiry_discounts, même règle (−30 % de l'admin)", [p3.urls, p3.S.specialItems[0].pn],
    [["/.netlify/functions/peremption?action=page", "/.netlify/functions/odoo-catalog?expiry_months=4", "/.netlify/functions/restock-alert?action=expiry_discounts"], 7.22]);
  const p4 = await controle({ specialItems: [] });
  eq("panier sans ligne hors catalogue : aucune lecture", p4.urls.length, 0);
  vrai("contrôle lancé au chargement, à l'ouverture du panier, au changement de pharmacie et au retour sur l'onglet, hors des zones protégées",
    /useEffect\(\(\) => \{ controlerPrixPanier\(specialItems\); \}, \[cartOpen, actingFor\]\);/.test(APP) && /document\.addEventListener\("visibilitychange", auRetour\)/.test(APP));
}

// ── 7. « Recommander » (Mes commandes) : onReorder d'App.jsx ──
async function recommander(items) {
  const { S, ctx } = application(APP);
  S.mesCommandes = true;
  const code = bloc(APP, /^            onReorder=\{async \(items\) => \{$/).replace(/^\s*onReorder=\{/, "").replace(/\}\s*$/, "");
  Object.assign(ctx, { loadGroups: async () => null, allocate: () => ({ lines: [] }), setShowMyOrders: (v) => { S.mesCommandes = v; } });
  await charge(code, ctx)(items);
  return S;
}
{
  const aPart = [{ cip: HEC, name: "HEC POM NACU T/25G", qty: 2, pn: 5.16, total: 10.32, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false, separeDe: "1" }];
  const S1 = await recommander(aPart);
  eq("Recommander une commande à part : rien d'ajouté, panneau ouvert, message (6 s)", [S1.quantities, S1.specialItems, S1.mesCommandes, S1.flashes, S1.durees],
    [{}, [], true, ["Commande de péremption courte : son prix était lié à un lot, elle n'est pas reprise. Les offres du moment sont dans le menu Péremption courte."], [6000]]);
  const S2 = await recommander([{ cip: DOLI, name: "DOLIPRANE 1000 mg", qty: 4, pn: 1.5 }, ...aPart]);
  eq("Recommander une commande mixte : menu repris, péremption non, message (6 s)", [S2.quantities, S2.specialItems, S2.mesCommandes, S2.flashes, S2.durees],
    [{ "otc-1": 4 }, [], false, ["✓ 1 produit(s) ajoutés au panier · péremption courte non reprise (1) : voir le menu Péremption courte"], [6000]]);
  const S3 = await recommander([{ cip: DOLI, name: "DOLIPRANE 1000 mg", qty: 4, pn: 1.5 }]);
  eq("Recommander sans péremption : message habituel (durée par défaut)", [S3.flashes, S3.durees], [["✓ 1 produit(s) ajoutés au panier"], [undefined]]);
}

// ── 8. Affichage (texte des composants) ──
const ADMIN = lire("src/AdminPanel.jsx"), MESCDES = lire("src/components/MyOrdersPanel.jsx");
vrai("page : prix et ajout par l'offre de la page (offreAffichee, offrePeremption) ; prix de base barré, « −X % »", SHORT.includes("const prixAffiche = (p) => offreAffichee(p, remises);")
  && SHORT.includes("onAddToCart?.(offrePeremption(p, qty, remises));") && /<s style=\{\{[^}]*\}\}>\{fmt\(prix\.base\)\}<\/s>/.test(SHORT) && SHORT.includes("{fmtPct(remise)}"));
vrai("page : lecture de la page, repli catalogue + remises de l'admin (lecture publique) ; ni jeton ni stockage", /peremption\?action=page/.test(SHORT) && /restock-alert\?action=expiry_discounts/.test(SHORT) && !/localStorage|admin_token/.test(SHORT));
vrai("panier : mention, remise, explication de la commande à part ; justificatif une seule fois par CIP", APP.includes("<strong>{notePeremption(item.peremption)}</strong>{item.remise >= 1 ? <> · <strong>{fmtPct(item.remise)}</strong></> : null}")
  && APP.includes("partiraAPart(item, cartItems)") && APP.includes("cartItems.findIndex(j => j.cip === item.cip && !estPeremption(j)) === n"));
vrai("panier : lecteurs d'écran, ligne péremption distinguée (supprimer, diminuer, augmenter)", APP.includes('const suffixe = estPeremption(item) ? " (péremption courte)" : "";')
  && ["aria-label={`Supprimer ${item.name}${suffixe} du panier`}", "aria-label={`Diminuer la quantité de ${item.name}${suffixe}`}", "aria-label={`Augmenter la quantité de ${item.name}${suffixe}`}"].every(x => APP.includes(x)));
vrai("accueil : quantités sans la ligne péremption", APP.includes("qteAuPanier={qteAccueil}"));
vrai("page : ajout par ajouterDepuisSaisie (panier ouvert), sans prix du menu", /onAddToCart=\{\(o\) => ajouterDepuisSaisie\(o, \{ ouvrirPanier: true \}\)\}/.test(APP) && !/prixMenuPeremption|prixDuMenu/.test(APP));
vrai("admin, commandes : badge, facturée par Odoo ou boîtes à corriger, commande à part", ADMIN.includes("{badgePeremption(item)}") && ADMIN.includes("prix non repris par Odoo : corriger ${parseInt(item.qty)||0} × ")
  && ADMIN.includes('" · facturée par Odoo"') && ADMIN.includes("à part de la n° ${item.separeDe}"));
vrai("admin, export Excel : colonne Mention (badge, consigne)", ADMIN.includes('"Mention": estPeremption(it) ? [badgePeremption(it), remiseLigne(it).facture_odoo ? "facturée par Odoo" : consigneOdoo(it)'));
vrai("« Mes commandes » : badge avec la remise", MESCDES.includes("{badgePeremption(it)}"));
vrai("aucun appel d'écriture Odoo dans le code du site touché par la règle", ![APP, SHORT, lire("src/peremption-panier.js")].some(t => /pricelist\.item|\bunlink\b|"create"|"write"/.test(t)));

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
