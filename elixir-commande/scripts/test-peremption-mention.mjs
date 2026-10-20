// Tests du lot 0 de la Péremption courte (« Odoo facture la remise », 20/10/2026, docs/peremption.md) :
// node scripts/test-peremption-mention.mjs
// Hors ligne, sans navigateur ni réseau, aucune écriture (ni Odoo, ni Supabase, ni PharmaML : doublures). Le VRAI code est
// exécuté : handleAdd de ShortExpiry.jsx et d'OrderEntry.jsx (Saisie de commande), setQty, setItemQty, addItemToCart,
// le panier calculé (cartItems), readCart, expandSupplierGroups et sendOrder d'App.jsx, extraits des fichiers et exécutés
// avec des doublures (état React, order-save, send-email, submit-order). src/peremption-panier.js, applyTiers
// (src/tiers.jsx) et lab-justif-client.js sont assemblés par esbuild (React vide). Comparaison avec la production d'avant
// le lot (origin/master, d840631) quand git l'a. Parties admin de l'onglet Péremptions (src/components/PeremptionsAdmin.jsx) :
// saisie de la remise notée, chargées avec l'admin seulement.
//  • page : prix facturé = celui de la Saisie (prix remisé de la liste n° 5, sinon prix catalogue ; paliers), jamais −50 %
//    ni −20 % d'office ni la remise notée par l'admin ; mention « Pér. <date> » et date du lot ;
//  • panier : la mention suit la ligne hors catalogue (nouvelle, ou déjà là par la Saisie) ; prix, clé, identité et rayon
//    inchangés ; produit rangé dans un menu : ligne du menu, au prix du menu, sans mention (comme avant) ; panier sans
//    péremption et paniers enregistrés : identiques à la production ;
//  • envoi : UNE commande (ni ligne ni commande à part), mention et date dans la ligne enregistrée, e-mail à Elixir ;
//    lignes lues par le relais (cip, name, qty, pn), total, CSV et relais identiques à la production ; _relais.js inchangé ;
//  • revue du lot 0 : panier enregistré par l'ancienne page (−50 %) remonté au prix de la page (controlerPrixPanier d'App.jsx,
//    jamais baissé) ; ajout depuis la page par les règles de la Saisie (ajouterDepuisSaisie : colis, panier ouvert) ; prix
//    du menu affiché pour un CIP rangé dans un menu ou une campagne (prixDuMenu = prix du panier calculé) ; paliers ; pas
//    d'ajout sans prix ; remise notée de l'admin en lecture seule (plus aucune écriture de expiry_discounts).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("..", import.meta.url).pathname;
const sortie = await build({
  stdin: { contents: 'export * from "./src/peremption-panier.js"; export { applyTiers } from "./src/tiers.jsx";'
    + ' export { qtyByCip, needsJustif, justifIssues, rxFrais } from "./src/lab-justif-client.js";'
    + ' export { remiseSaisie, PEREMPTIONS_ADMIN } from "./src/components/PeremptionsAdmin.jsx";', resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false,
  loader: { ".jsx": "jsx", ".js": "jsx" }, jsx: "automatic", logLevel: "silent",
  // React vide (les composants ne sont pas rendus ici) ; JSX automatique (src/icons.jsx n'importe pas React)
  plugins: [{ name: "sans-react", setup(b) {
    b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "export default {}; export const useState = (v) => [v, () => {}];"
      + " export const jsx = (t, p) => ({ t, p }); export const jsxs = jsx; export const Fragment = {};", loader: "js" }));
  } }],
});
const dossier = mkdtempSync(join(tmpdir(), "test-peremption-mention-"));
writeFileSync(join(dossier, "m.mjs"), sortie.outputFiles[0].text);
const M = await import(pathToFileURL(join(dossier, "m.mjs")).href);
rmSync(dossier, { recursive: true, force: true });

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

// ── Extraction du code ──
const lire = (f) => readFileSync(join(RACINE, f), "utf8");
const APP = lire("src/App.jsx"), SHORT = lire("src/components/ShortExpiry.jsx"), SAISIE = lire("src/components/OrderEntry.jsx");
const PROD_REF = "origin/master";   // production d'avant le lot (d840631)
const enProd = (f) => { try { return execFileSync("git", ["show", `${PROD_REF}:./${f}`], { cwd: RACINE, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const PROD = enProd("src/App.jsx");
if (!PROD) console.log(`· production ${PROD_REF} absente de git : comparaisons avec la production sautées`);
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

// page Péremption courte (handleAdd de ShortExpiry.jsx) et Saisie de commande (handleAdd d'OrderEntry.jsx) → objet envoyé
function ajoutPage(produit, qty, { prixPanier, isAdmin = false } = {}) {
  let envoye = null;
  const ctx = { ...M, isAdmin, prixPanier, quantities: { [produit.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; } };
  ctx.prixAffiche = charge(expr(bloc(SHORT, /^  const prixAffiche = /)), ctx);
  ctx.handleAdd = charge(expr(bloc(SHORT, /^  const handleAdd = /)), ctx);
  ctx.handleAdd(produit);
  return envoye;
}
// prix affiché par la page (prixAffiche de ShortExpiry.jsx)
function prixAffichePage(produit, { prixPanier, isAdmin = false } = {}) {
  const ctx = { ...M, isAdmin, prixPanier };
  return charge(expr(bloc(SHORT, /^  const prixAffiche = /)), ctx)(produit);
}
function ajoutSaisie(produit, qty) {
  let envoye = null;
  const ctx = { quantities: { [produit.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; }, retourDe: () => null, masquerRetour: () => {},
    query: "", pharmacyCip: "1234567", results: [], fetch: () => Promise.resolve() };
  ctx.handleAdd = charge(expr(bloc(SAISIE, /^  const handleAdd = /)), ctx);
  ctx.handleAdd(produit);
  return envoye;
}

const HEC = "3400930470312", EUPHY = "3534510001778", DOLI = "3400935955838", ZADI = "3400932448951";
const CATALOGUE = {
  otc: { label: "Centrale OTC", accent: "#0f766e", products: [
    { cip: HEC, name: "HEC POM NACU T/25G", pn: 9.76, pv: 10.32 },
    { cip: DOLI, name: "DOLIPRANE 1000 mg", pn: 1.5, pv: 2.1, price_tiers: [{ min_qty: 10, price: 1.4 }] },
  ] },
};
// produits de la page (odoo_catalog, relevé du 20/10/2026 simplifié)
const PAGE_HEC = { cip: HEC, name: "HEC POM NACU T/25G", list_price: 10.32, discounted_price: 9.76, discount_pct: 5.4, price_tiers: null, earliest_expiry: "2026-12-31" };
const PAGE_EUPHY = { cip: EUPHY, name: "EUPHYTOSE NUIT MYRTILLE GOMME 30", list_price: 12.31, discounted_price: 9.85, discount_pct: 20, price_tiers: null, earliest_expiry: "2027-01-31T00:00:00+00:00" };
const PAGE_ZADI = { cip: ZADI, name: "ZADITEN 1 mg/5 ml", list_price: 3.83, discounted_price: 3.6, discount_pct: 6, earliest_expiry: "2026-12-31",
  price_tiers: [{ min_qty: 6, price: 3.4 }] };
const PAGE_CHER = { cip: "3400930000102", name: "PRODUIT À 2 000 €", list_price: 2000, discounted_price: 1910, discount_pct: 4.5, earliest_expiry: "2027-02-28" };
const PAGE_SANS_REMISE = { cip: "3400930000103", name: "SANS REMISE LISTE 5", list_price: 8, discounted_price: null, discount_pct: 0, earliest_expiry: "2027-01-15" };

// ── 1. Parties pures (src/peremption-panier.js) ──
eq("date française", M.datePeremption("2026-12-31"), "31/12/2026");
eq("mention", M.notePeremption("2026-12-31"), "Pér. 31/12/2026");
eq("jour du lot : heure retirée, vide → « date inconnue », autre texte gardé", [M.jourPeremption("2027-01-31T00:00:00+00:00"), M.jourPeremption(null), M.jourPeremption("  "), M.jourPeremption("lot sans date")],
  ["2027-01-31", "date inconnue", "date inconnue", "lot sans date"]);
eq("ligne péremption : peremption non vide seulement", [M.estPeremption({ peremption: "2026-12-31" }), M.estPeremption({ peremption: "" }), M.estPeremption({}), M.estPeremption(null)], [true, false, false, false]);
eq("ligne ordinaire : rien d'ajouté (panier, ligne du panier, commande, e-mail)", [M.champsMention({ cip: HEC }), M.champsPeremption({ cip: HEC }), M.mentionCommande({ cip: HEC }), M.mentionMail({ cip: HEC })], [{}, {}, {}, ""]);
eq("ligne péremption : champs ajoutés", [M.champsMention({ peremption: "2026-12-31T10:00:00Z" }), M.champsPeremption({ peremption: "2026-12-31" }), M.mentionCommande({ peremption: "2026-12-31", qty: 2 })],
  [{ peremption: "2026-12-31" }, { peremption: "2026-12-31", note: "Pér. 31/12/2026" }, { note: "Pér. 31/12/2026", peremption: "2026-12-31" }]);
eq("e-mail : mention sans remise péremption", M.mentionMail({ peremption: "2026-12-31" }), " — PÉREMPTION COURTE (Pér. 31/12/2026, sans remise péremption)");
eq("prix de la page : liste n° 5 si remise, sinon prix catalogue", [M.prixPage(PAGE_HEC).pn, M.prixPage(PAGE_CHER).pn, M.prixPage(PAGE_SANS_REMISE).pn, M.prixPage({ ...PAGE_HEC, discount_pct: 0 }).pn], [9.76, 1910, 8, 10.32]);
eq("prix de la page : paliers d'Odoo gardés", M.prixPage(PAGE_ZADI).tiers, [{ min_qty: 6, price: 3.4 }]);
eq("remise notée (admin) : entier de 0 à 90, sinon refusée", ["30", "0", "90", "91", "-5", "12.5", "abc", "", " 15 ", "20,0"].map(M.remiseSaisie), [30, 0, 90, null, null, null, null, null, 15, 20]);
eq("parties admin : encart et cellule « Remise notée »", Object.keys(M.PEREMPTIONS_ADMIN), ["Encart", "CelluleRemise"]);
{
  // revue du lot 0 : lignes d'un panier enregistré par l'ancienne page, remontées au prix de la page (jamais baissées)
  const page = [PAGE_ZADI, PAGE_EUPHY, PAGE_CHER, { ...PAGE_SANS_REMISE, cip: "3400930000104", list_price: null }];
  const lignes = [
    { cip: ZADI, name: "ZADITEN 1 mg/5 ml", qty: 2, pn: 1.92, pv: 3.83, tiers: null },          // ancienne page : 3,83 × 0,5
    { cip: PAGE_CHER.cip, name: PAGE_CHER.name, qty: 1, pn: 1600, pv: 2000, tiers: null },      // ancienne page : −20 % dès 500 €
    { cip: EUPHY, name: PAGE_EUPHY.name, qty: 1, pn: 11, pv: 12.31, tiers: null },               // plus cher que la page : gardé
    { cip: "3400000000077", name: "Hors page", qty: 1, pn: 1, pv: 2, tiers: null },              // absent de la page : gardé
    { cip: ZADI, name: "Article multi-CIP", qty: 1, pn: 1, pv: 2, tiers: null, supplier_code: "Z1" },   // multi-CIP : gardé
    { cip: "3400930000104", name: "Sans prix", qty: 1, pn: 0.5, pv: null, tiers: null },        // page sans prix : gardé
  ];
  const changes = M.prixARemonter(lignes, page);
  eq("remontée : ancienne ligne −50 % et −20 % seulement", changes.map(c => [c.cip, c.avant, c.apres, c.ancienneRemise]),
    [[ZADI, 1.92, 3.6, true], [PAGE_CHER.cip, 1600, 1910, true]]);
  const apres = M.remonterPrix(lignes, page);
  eq("remontée : prix, prix catalogue et paliers de la page ; autres lignes intactes", apres.map(x => [x.pn, x.pv, x.tiers]),
    [[3.6, 3.83, [{ min_qty: 6, price: 3.4 }]], [1910, 2000, null], [11, 12.31, null], [1, 2, null], [1, 2, null], [0.5, null, null]]);
  eq("remontée : quantités, noms et identité inchangés", apres.map(x => [x.cip, x.qty, x.name, x.supplier_code ?? null]), lignes.map(x => [x.cip, x.qty, x.name, x.supplier_code ?? null]));
  eq("remontée : rien à faire → même tableau (pas de rendu)", M.remonterPrix(apres, page) === apres, true);
  eq("remontée : ligne sans prix ou au centime près", M.prixARemonter([{ cip: ZADI, qty: 1, pn: null }, { cip: EUPHY, qty: 1, pn: 9.846 }], page).map(c => [c.cip, c.avant, c.apres]), [[ZADI, null, 3.6]]);
  eq("remontée : prix d'une autre origine (pas l'ancienne page)", M.prixARemonter([{ cip: EUPHY, qty: 1, pn: 9.5, pv: 12.31 }], page).map(c => c.ancienneRemise), [false]);
  eq("message : remise péremption non facturée", M.messageRemontee(changes),
    "Prix mis à jour : la remise péremption affichée auparavant n'était pas facturée par Odoo (ZADITEN 1 mg/5 ml : 3,60 €, PRODUIT À 2 000 € : 1910,00 €)");
  eq("message : autre origine", M.messageRemontee([{ name: "X", apres: 9.85, ancienneRemise: false }]), "Prix du panier mis à jour au prix actuel, celui de la Saisie de commande (X : 9,85 €)");
  eq("message : plus de deux lignes", M.messageRemontee([1, 2, 3, 4].map(i => ({ name: `P${i}`, apres: i, ancienneRemise: true }))).endsWith("(P1 : 1,00 €, P2 : 2,00 € et 2 autres)"), true);
  eq("encart de la ligne", M.detailRemontee(changes[0]), "3,60 € au lieu de 1,92 € : la remise péremption affichée auparavant n'était pas facturée par Odoo");
  eq("rien à remonter : message vide", [M.messageRemontee([]), M.prixARemonter(null, page), M.prixARemonter(lignes, null)], ["", [], []]);
}

// ── 2. Page : prix facturé, celui de la Saisie de commande ; mention ──
{
  const hec = ajoutPage(PAGE_HEC, 2);
  eq("page : objet ajouté (prix de la liste n° 5, date, mention)", hec,
    { cip: HEC, name: "HEC POM NACU T/25G", qty: 2, pn: 9.76, pv: 10.32, discount: 5.4, tiers: null, note: "Pér. 31/12/2026", peremption: "2026-12-31" });
  for (const p of [PAGE_HEC, PAGE_EUPHY, PAGE_ZADI, PAGE_CHER, PAGE_SANS_REMISE]) {
    const { note, peremption, ...page } = ajoutPage(p, 3);   // eslint-disable-line no-unused-vars
    eq(`page = Saisie de commande (${p.name}) : mêmes prix, remise et paliers`, page, ajoutSaisie(p, 3));
  }
  eq("page : plus de −20 % d'office dès 500 € (1 910 € facturés, pas 1 600 €)", ajoutPage(PAGE_CHER, 1).pn, 1910);
  eq("page : lot avec heure → jour seul", ajoutPage(PAGE_EUPHY, 1).peremption, "2027-01-31");
  eq("page : quantité 0, rien d'ajouté", ajoutPage(PAGE_HEC, 0), null);
  eq("page : produit sans prix, rien d'ajouté (l'envoi planterait sur un prix vide)", ajoutPage({ ...PAGE_SANS_REMISE, list_price: null }, 2), null);
  eq("page : prix du menu affiché si le CIP est rangé dans un menu (prixPanier), sinon prix de la Saisie ; admin : liste n° 5",
    [prixAffichePage(PAGE_HEC, { prixPanier: () => ({ pn: 6.54, rayon: "Campagne" }) }).pn, prixAffichePage(PAGE_HEC, { prixPanier: () => null }).pn,
      prixAffichePage(PAGE_HEC, { prixPanier: () => ({ pn: 6.54 }), isAdmin: true }).pn], [6.54, 9.76, 9.76]);
  eq("page : ligne de menu sans prix → pas d'ajout", ajoutPage(PAGE_HEC, 2, { prixPanier: () => ({ pn: null, rayon: "Menu" }) }), null);
  vrai("page : paliers d'Odoo affichés (TierBadge) et « Ajouter » désactivé sans prix", /<TierBadge tiers=\{prix\.tiers\} pn=\{prix\.pn\} bloc \/>/.test(SHORT) && /sansPrix \? \(\s*<button className="ex-peremption-ajouter" disabled/.test(SHORT));
  vrai("page : plus aucune remise d'office ni remise notée dans le calcul du prix (getDiscount, 50/20)", !/getDiscount|>= 500 \? 20 : 50/.test(SHORT));
  vrai("page : remises notées lues par l'admin seulement", /isAdmin \? fetch\("\/\.netlify\/functions\/restock-alert\?action=expiry_discounts"\) : null/.test(SHORT));
  const PER_ADMIN = lire("src/components/PeremptionsAdmin.jsx");
  vrai("admin : remise notée en lecture seule, plus aucune écriture de expiry_discounts (ancienne page des onglets non rechargés)",
    ![SHORT, PER_ADMIN].some(t => /set_expiry_discount|method: "POST"|onEnregistree/.test(t)));
  const cellule = M.PEREMPTIONS_ADMIN.CelluleRemise;
  eq("admin : cellule sans valeur → « — », avec valeur → « 30 % · notée, non reprise », sans bouton",
    [JSON.stringify(cellule({ notee: null })).includes("—"), JSON.stringify(cellule({ notee: 30 })).includes("notée, non reprise"), /onClick/.test(JSON.stringify(cellule({ notee: 30 })))], [true, true, false]);
  const ADMIN = lire("src/AdminPanel.jsx");
  vrai("parties admin hors du bundle des pharmacies : importées par AdminPanel seulement (chargé à la demande)",
    /from "\.\/components\/PeremptionsAdmin\.jsx"/.test(ADMIN) && /admin=\{PEREMPTIONS_ADMIN\}/.test(ADMIN) && !/^import[^\n]*PeremptionsAdmin/m.test(SHORT) && !/^import[^\n]*PeremptionsAdmin/m.test(APP)
    && /React\.lazy\(\(\) => import\("\.\/AdminPanel"\)/.test(APP));
  const prodShort = enProd("src/components/ShortExpiry.jsx");
  if (prodShort) {   // production : −50 % d'office (Hec 5,16 € affiché, 9,76 € facturé)
    let envoye = null;
    const ctx = { discounts: {}, quantities: { [HEC]: 2 }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; } };
    for (const nom of ["getDiscount", "getDiscountedPrice", "handleAdd"]) ctx[nom] = charge(expr(bloc(prodShort, new RegExp(`^  const ${nom} = `))), ctx);
    ctx.handleAdd(PAGE_HEC);
    eq("production (anomalie corrigée) : 5,16 € à −50 %, qu'Odoo ne facturait pas", [envoye.pn, envoye.discount, envoye.note], [5.16, 50, "Pér. 2026-12-31"]);
  }
}

// ── 3. Panier (addItemToCart, setItemQty, cartItems d'App.jsx) ──
function application(src, { quantities = {}, specialItems = [], justifInfo = {}, catalogue = CATALOGUE, campagnes = {} } = {}) {
  const S = { quantities, specialItems, justifInfo, cartOpen: false, flashes: [], durees: [], statut: [], minuteries: [] };
  const maj = (k) => (v) => { S[k] = typeof v === "function" ? v(S[k]) : v; };
  const ctx = {
    ...M, CATALOG_WITH_ADMIN: catalogue,
    get quantities() { return S.quantities; }, get specialItems() { return S.specialItems; }, get justifInfo() { return S.justifInfo; },
    setQuantities: maj("quantities"), setSpecialItems: maj("specialItems"), setJustifInfo: maj("justifInfo"), setCartOpen: maj("cartOpen"),
    flash: (m, d) => { S.flashes.push(m); S.durees.push(d); },
    getCampaign: (k) => campagnes[k] || null, buildGroupes: () => [], campGetGroupe: () => null, campGratuite: () => ({ livrées: 0 }),
  };
  for (const nom of ["getStepMin", "getStep", "setQty", "setItemQty", "addItemToCart"]) ctx[nom] = charge(expr(bloc(src, new RegExp(`^  const ${nom} = `))), ctx);
  const calcul = charge(bloc(src, /^  const cartItems = useMemo\(\(\) => \{$/).replace(/^\s*const cartItems = useMemo\(/, "").replace(/, \[[^\]]*\]\);\s*$/, ""), ctx);
  Object.defineProperty(ctx, "cartItems", { get: () => calcul() });
  Object.defineProperty(ctx, "cartTotal", { get: () => ctx.cartItems.reduce((s, i) => s + i.total, 0) });
  Object.defineProperty(ctx, "cartCount", { get: () => ctx.cartItems.reduce((s, i) => s + i.qty, 0) });
  return { S, ctx };
}
const sansMention = (x) => { const { peremption, note, ...r } = x; return r; };   // eslint-disable-line no-unused-vars
const arrondi = (n) => Math.round(n * 100) / 100;
const PER_EUPHY = ajoutPage(PAGE_EUPHY, 2), PER_HEC = ajoutPage(PAGE_HEC, 2), PER_ZADI = ajoutPage(PAGE_ZADI, 6);
const SAI_EUPHY = ajoutSaisie(PAGE_EUPHY, 3);
// contrôle des prix du panier (controlerPrixPanier d'App.jsx, vrai code) : lecture de la page simulée (aucun réseau)
const PAGE_PRODUITS = [PAGE_HEC, PAGE_EUPHY, PAGE_ZADI, PAGE_CHER, PAGE_SANS_REMISE];
async function controle(lignes, { page = PAGE_PRODUITS, echec = false, cache = { current: null } } = {}) {
  const S = { specialItems: lignes, prixRemontes: {}, flashes: [], lectures: 0 };
  const maj = (k) => (v) => { S[k] = typeof v === "function" ? v(S[k]) : v; };
  const ctx = { ...M, pagePeremption: cache, setSpecialItems: maj("specialItems"), setPrixRemontes: maj("prixRemontes"), flash: (m, d) => S.flashes.push([m, d]),
    fetch: async (url) => { S.lectures++; if (url !== "/.netlify/functions/odoo-catalog?expiry_months=4") throw new Error(url);
      return echec ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ products: page }) }; } };
  await charge(expr(bloc(APP, /^  const controlerPrixPanier = async \(lignes\) => \{$/)), ctx)(lignes);
  return S;
}
{
  // produit hors menu ajouté depuis la page : ligne hors catalogue avec la mention
  const { S, ctx } = application(APP);
  ctx.addItemToCart(PER_EUPHY);
  eq("hors menu : ligne hors catalogue avec la date du lot", S.specialItems, [{ cip: EUPHY, name: PAGE_EUPHY.name, qty: 2, pn: 9.85, pv: 12.31, tiers: null, peremption: "2027-01-31" }]);
  const l = ctx.cartItems[0];
  eq("hors menu : ligne du panier (clé, rayon, prix, total) et mention", [l.key, l.cat, l.pn, l.qty, l.total, l.note, l.peremption], [`special-${EUPHY}`, "Hors catalogue", 9.85, 2, 19.7, "Pér. 31/01/2027", "2027-01-31"]);
  eq("hors menu : panier ouvert et message, comme avant", [S.cartOpen, S.flashes.at(-1)], [true, `✓ 2× ${PAGE_EUPHY.name} ajouté au panier`]);
  // paliers d'Odoo : 6 Zaditen au palier, comme depuis la Saisie
  const z = application(APP);
  z.ctx.addItemToCart(PER_ZADI);
  eq("paliers : 6 boîtes au prix du palier (3,40 €), mention gardée", [z.ctx.cartItems[0].pn, z.ctx.cartItems[0].note], [3.4, "Pér. 31/12/2026"]);
  if (PROD) {
    const p = application(PROD);
    p.ctx.addItemToCart(PER_EUPHY);
    eq("hors menu : même ligne que la production, mention en plus", S.specialItems.map(sansMention), p.S.specialItems);
    eq("hors menu : même panier calculé que la production, mention en plus", ctx.cartItems.map(sansMention), p.ctx.cartItems);
  }
  // quantité modifiée puis ligne retirée (identité inchangée : le CIP)
  ctx.setItemQty(l, 5);
  eq("quantité modifiée : mention gardée", [S.specialItems[0].qty, ctx.cartItems[0].note], [5, "Pér. 31/01/2027"]);
  ctx.setItemQty(ctx.cartItems[0], 0);
  eq("ligne retirée", [S.specialItems, ctx.cartItems.length], [[], 0]);
}
{
  // produit rangé dans un menu : ligne du menu, au prix du menu (= prix facturé une fois la synchro faite), sans mention
  const { S, ctx } = application(APP);
  ctx.addItemToCart(PER_HEC);
  eq("produit d'un menu : ligne du menu, prix du menu, sans mention (choix de la conception, § 8.2)", [S.quantities, S.specialItems, ctx.cartItems.map(i => [i.key, i.pn, i.qty, i.note ?? null])],
    [{ "otc-0": 2 }, [], [["otc-0", 9.76, 2, null]]]);
  eq("produit d'un menu : prix de la page = prix de la ligne du menu", PER_HEC.pn, ctx.cartItems[0].pn);
  if (PROD) { const p = application(PROD); p.ctx.addItemToCart(PER_HEC); eq("produit d'un menu : comme la production", [S.quantities, ctx.cartItems], [p.S.quantities, p.ctx.cartItems]); }
}
{
  // même produit hors menu par la Saisie et par la page : UNE ligne (identité = CIP), quantités additionnées, prix de la
  // première ligne (comme avant), mention dès qu'un ajout vient de la page
  const a = application(APP);
  a.ctx.addItemToCart(SAI_EUPHY, { ouvrirPanier: false });
  a.ctx.addItemToCart(PER_EUPHY);
  eq("Saisie puis page : une ligne, 5 boîtes, mention", a.ctx.cartItems.map(i => [i.key, i.qty, i.pn, i.note ?? null]), [[`special-${EUPHY}`, 5, 9.85, "Pér. 31/01/2027"]]);
  const b = application(APP);
  b.ctx.addItemToCart(PER_EUPHY);
  b.ctx.addItemToCart(SAI_EUPHY, { ouvrirPanier: false });
  eq("page puis Saisie : une ligne, 5 boîtes, mention gardée", b.ctx.cartItems.map(i => [i.key, i.qty, i.pn, i.note ?? null]), [[`special-${EUPHY}`, 5, 9.85, "Pér. 31/01/2027"]]);
  // lot plus récent sur la page : la ligne prend la date du dernier ajout depuis la page
  b.ctx.addItemToCart({ ...PER_EUPHY, qty: 1, peremption: "2027-02-15", note: "Pér. 15/02/2027" });
  eq("nouvel ajout depuis la page : date du dernier lot", [b.ctx.cartItems[0].qty, b.ctx.cartItems[0].note], [6, "Pér. 15/02/2027"]);
  if (PROD) {
    const p = application(PROD);
    p.ctx.addItemToCart(SAI_EUPHY, { ouvrirPanier: false });
    p.ctx.addItemToCart(PER_EUPHY);
    eq("Saisie puis page : quantités et prix comme la production", a.ctx.cartItems.map(sansMention), p.ctx.cartItems);
  }
}
{
  // Saisie seule (menu au palier, hors menu, article multi-CIP) : état et panier identiques à la production
  const ajouts = [[{ cip: DOLI, name: "DOLIPRANE 1000 mg", qty: 10, pn: 1.5 }], [SAI_EUPHY, { ouvrirPanier: false }],
    [{ cip: "3400000000099", name: "Produit Saisie", qty: 3, pn: 4.2, pv: 5, tiers: [{ min_qty: 3, price: 4 }] }, { ouvrirPanier: false }],
    [{ cip: "3400000000088", name: "Fauteuil", qty: 1, pn: 300, supplier_code: "BR1" }]];
  const a = application(APP);
  for (const x of ajouts) a.ctx.addItemToCart(...x);
  vrai("Saisie seule : aucune mention", a.ctx.cartItems.every(i => !("note" in i) && !("peremption" in i)));
  if (PROD) {
    const p = application(PROD);
    for (const x of ajouts) p.ctx.addItemToCart(...x);
    eq("Saisie seule : même état que la production", [a.S.quantities, a.S.specialItems, a.S.flashes, a.S.cartOpen], [p.S.quantities, p.S.specialItems, p.S.flashes, p.S.cartOpen]);
    eq("Saisie seule : même panier calculé que la production", a.ctx.cartItems, p.ctx.cartItems);
  }
}
{
  // paniers enregistrés (localStorage) : celui de la production se charge à l'identique ; celui avec mention se relit tel quel
  const memoire = { cart_quantities: JSON.stringify({ "otc-0": 3, "otc-1": 12 }),
    cart_special: JSON.stringify([{ cip: EUPHY, name: PAGE_EUPHY.name, qty: 2, pn: 6.16, pv: 12.31, tiers: null },   // ancienne ligne de la page (−50 %)
      { cip: "3400000000088", name: "Fauteuil", qty: 1, pn: 300, pv: 300, tiers: null, supplier_code: "BR1" }]),
    cart_justif: "{}" };
  const faux = { getItem: (k) => memoire[k] ?? null, setItem: (k, v) => { memoire[k] = v; } };
  const ctxL = { ...M, localStorage: faux, sessionStorage: faux };
  for (const nom of ["cartKeys", "cartStore", "readCart"]) ctxL[nom] = charge(expr(bloc(APP, new RegExp(`^const ${nom} = `))), ctxL);
  const [q, s] = ctxL.readCart(null);
  const a = application(APP, { quantities: q, specialItems: s });
  eq("panier enregistré par la production : lignes et totaux", [a.ctx.cartItems.map(i => [i.key, i.qty, i.pn, i.note ?? null]), arrondi(a.ctx.cartTotal)],
    [[["otc-0", 3, 9.76, null], ["otc-1", 12, 1.4, null], [`special-${EUPHY}`, 2, 6.16, null], ["special-3400000000088", 1, 300, null]], arrondi(3 * 9.76 + 12 * 1.4 + 2 * 6.16 + 300)]);
  if (PROD) eq("panier enregistré par la production : même calcul", a.ctx.cartItems, application(PROD, { quantities: q, specialItems: s }).ctx.cartItems);
  // revue du lot 0 : au chargement, le contrôle des prix (controlerPrixPanier d'App.jsx) relit la page et remonte l'ancienne
  // ligne au prix de la Saisie (9,85 €, pas 6,16 €) ; puis l'ajout depuis la page s'additionne, avec la mention
  const c = await controle(a.S.specialItems);
  eq("ancienne ligne relue : remontée au prix de la Saisie, fauteuil inchangé, message", [c.specialItems.map(x => [x.cip, x.qty, x.pn]), c.flashes.length, c.lectures],
    [[[EUPHY, 2, 9.85], ["3400000000088", 1, 300]], 1, 1]);
  a.S.specialItems = c.specialItems;
  a.ctx.addItemToCart(PER_EUPHY);
  eq("ancienne ligne remontée + ajout depuis la page : une ligne, prix de la Saisie, mention", a.S.specialItems.map(x => [x.cip, x.qty, x.pn, x.peremption ?? null]),
    [[EUPHY, 4, 9.85, "2027-01-31"], ["3400000000088", 1, 300, null]]);
  eq("ancienne ligne remontée : total du panier", arrondi(a.ctx.cartTotal), arrondi(3 * 9.76 + 12 * 1.4 + 4 * 9.85 + 300));
  memoire.cart_special = JSON.stringify(a.S.specialItems);
  eq("panier avec mention : relu à l'identique", application(APP, { quantities: q, specialItems: ctxL.readCart(null)[1] }).ctx.cartItems, a.ctx.cartItems);
}
{
  // panier au format de la production (banc de la revue : Zaditen 3,83 × 0,5 = 1,92 €), relu puis complété depuis la page
  const ancien = [{ cip: ZADI, name: PAGE_ZADI.name, qty: 2, pn: 1.92, pv: 3.83, tiers: null }];
  const c = await controle(ancien);
  eq("production relue : Zaditen remonté à 3,60 € avec les paliers d'Odoo", c.specialItems, [{ cip: ZADI, name: PAGE_ZADI.name, qty: 2, pn: 3.6, pv: 3.83, tiers: [{ min_qty: 6, price: 3.4 }] }]);
  eq("production relue : message et encart de la ligne", [c.flashes[0], c.prixRemontes[ZADI]?.apres, c.prixRemontes[ZADI]?.avant],
    [[`⚠ Prix mis à jour : la remise péremption affichée auparavant n'était pas facturée par Odoo (${PAGE_ZADI.name} : 3,60 €)`, 9000], 3.6, 1.92]);
  const a = application(APP, { specialItems: c.specialItems });
  a.ctx.addItemToCart(ajoutPage(PAGE_ZADI, 1));
  eq("production relue + 1 boîte depuis la page : 3 × 3,60 €, mention", a.ctx.cartItems.map(i => [i.qty, i.pn, i.total, i.note]), [[3, 3.6, 10.8, "Pér. 31/12/2026"]]);
  const r = await envoyer(APP, { specialItems: a.S.specialItems });
  eq("production relue : order-save reçoit 3,60 €", r.appels[0].corps.items.map(i => [i.qty, i.pn]), [[3, 3.6]]);
  vrai("production relue : e-mail au prix de la Saisie", r.appels[1].corps.template_params.order_lines.includes("Qté : 3  |  PU : 3,60 €"));
  // contrôles suivants : rien à refaire, lecture partagée (5 min) ; jamais baissé
  const cache = { current: null };
  const c1 = await controle(c.specialItems, { cache }), c2 = await controle([{ ...ancien[0], pn: 4.2 }], { cache });
  eq("contrôle suivant : rien à remonter, aucun message ; lecture partagée ; prix plus haut gardé", [c1.flashes.length, c1.lectures + c2.lectures, c2.specialItems[0].pn, c2.flashes.length], [0, 1, 4.2, 0]);
  // page illisible : rien ne change, la lecture suivante est retentée ; panier sans ligne hors catalogue : aucune lecture
  const cacheEchec = { current: null };
  const e = await controle(ancien, { echec: true, cache: cacheEchec });
  eq("page illisible : panier inchangé, nouvel essai au contrôle suivant", [e.specialItems, e.flashes.length, cacheEchec.current], [ancien, 0, null]);
  eq("panier sans ligne hors catalogue (ou seulement multi-CIP) : aucune lecture", [(await controle([])).lectures, (await controle([{ cip: ZADI, qty: 1, pn: 1, supplier_code: "Z" }])).lectures], [0, 0]);
  vrai("contrôle lancé au chargement, à l'ouverture du panier et au changement de pharmacie, hors des zones protégées",
    /useEffect\(\(\) => \{ controlerPrixPanier\(specialItems\); \}, \[cartOpen, actingFor\]\);/.test(APP));
  vrai("encart « Prix mis à jour » sur la ligne remontée, tant qu'elle est à ce prix", /prixRemontes\[item\.cip\] && Math\.abs\(\(item\.basePn \?\? 0\) - prixRemontes\[item\.cip\]\.apres\) < 0\.005/.test(APP));
}
{
  // revue du lot 0 : l'ajout depuis la page passe par les règles de la Saisie (ajouterDepuisSaisie), panier ouvert
  vrai("page : onAddToCart = ajouterDepuisSaisie(o, { ouvrirPanier: true }), prix du menu par prixDuMenu",
    /<ShortExpiry[\s\S]{0,200}onAddToCart=\{\(o\) => ajouterDepuisSaisie\(o, \{ ouvrirPanier: true \}\)\}\s*prixPanier=\{prixMenuPeremption\}/.test(APP)
    && /const prixMenuPeremption = \(cip\) => prixDuMenu\(CATALOG_WITH_ADMIN, cip, getCampaign\);/.test(APP));
  const STRAT = "3400930000555";
  const catalogue = { ...CATALOGUE, stratege: { label: "Stratège", products: [{ cip: STRAT, name: "STRATÈGE COLIS 12", pn: 2, pv: 3, colis: 12 }] } };
  const saisie = (etat = {}) => {
    const a = application(APP, { catalogue, ...etat });
    Object.assign(a.ctx, { SECTION_META: {}, justifProducts: {}, needsJustif: M.needsJustif, qtyByCip: M.qtyByCip, loadQuota: async () => null, quotaOver: () => ({ over: [] }) });
    for (const nom of ["regleSaisie", "arrondiSaisie", "ajouterDepuisSaisie"]) a.ctx[nom] = charge(expr(bloc(APP, new RegExp(`^  const ${nom} = `))), a.ctx);
    return a;
  };
  const a = saisie();
  a.ctx.ajouterDepuisSaisie(ajoutPage({ cip: STRAT, name: "STRATÈGE COLIS 12", list_price: 3, discounted_price: 2, discount_pct: 33, earliest_expiry: "2026-12-31" }, 7), { ouvrirPanier: true });
  eq("page → produit au colis de 12 : 7 arrondi à 12, comme la Saisie, panier ouvert", [a.S.quantities, a.S.cartOpen, a.S.flashes.at(-1)], [{ "stratege-0": 12 }, true, "✓ 12× STRATÈGE COLIS 12 ajouté au panier · arrondi au colis de 12"]);
  const b = saisie();
  b.ctx.ajouterDepuisSaisie(PER_EUPHY, { ouvrirPanier: true });
  eq("page → hors menu : ligne hors catalogue avec mention, panier ouvert", [b.S.specialItems.map(x => [x.cip, x.qty, x.pn, x.peremption]), b.S.cartOpen], [[[EUPHY, 2, 9.85, "2027-01-31"]], true]);
  const s = saisie();
  s.ctx.ajouterDepuisSaisie(SAI_EUPHY);
  eq("Saisie : panier toujours fermé (option par défaut)", s.S.cartOpen, false);
  // prix du menu affiché = prix que prend le panier calculé (menu, paliers, campagne pv × (1 − 33 %), menu sans prix)
  const CAMP = "3400930000666";
  const cat2 = { ...catalogue, ulabs: { label: "Campagne U-Labs", products: [{ cip: CAMP, name: "CAMPAGNE", pn: 9, pv: 9.76 }, { cip: "3400930000777", name: "SANS PRIX", pn: null, pv: 5 }] } };
  const campagnes = { ulabs: { palier_remise: 33 } };
  for (const [cip, qty] of [[HEC, 2], [DOLI, 10], [CAMP, 3], [STRAT, 12]]) {
    const m = M.prixDuMenu(cat2, cip, (k) => campagnes[k] || null);
    const x = application(APP, { catalogue: cat2, campagnes });
    x.ctx.addItemToCart({ cip, name: "x", qty, pn: 99 });
    const l = x.ctx.cartItems[0];
    eq(`prix du menu = prix du panier calculé (${cip}, ${qty})`, [m.pn, M.applyTiers(m.pn, m.tiers, qty).pn], [l.basePn, l.pn]);
  }
  eq("prix du menu : campagne à 6,54 € (9,76 × 0,67), rayon ; hors menu → null ; menu sans prix → pn null",
    [M.prixDuMenu(cat2, CAMP, (k) => campagnes[k] || null), M.prixDuMenu(cat2, EUPHY), M.prixDuMenu(cat2, "3400930000777")?.pn],
    [{ pn: 6.54, pv: 9.76, pct: 0, tiers: null, rayon: "Campagne U-Labs", campagne: true }, null, null]);
}

// ── 4. Envoi (sendOrder) : une commande, mention dans la ligne enregistrée et l'e-mail ; relais inchangé ──
async function envoyer(src, etat) {
  const { S, ctx } = application(src, etat);
  const appels = [];
  Object.assign(ctx, {
    justifProducts: {}, setJustifProducts: () => {}, actingFor: null, pharmacyName: "PHARMACIE DU BANC", pharmacyEmail: "banc@exemple.fr", pharmacyCip: "1234567",
    isClient: true, DEFAULT_RECIPIENT: "pharmacien@elixirpharma.fr", MESSAGE_ENVOI_BLOQUE: { reconnexion: "r", admin: "a", fiche: "f", erreur: "e" },
    idsEnvoi: { current: {} }, setSendStatus: (v) => S.statut.push(v), setEnvoiBloque: () => {},
    sessionPourEnvoi: async () => true, loadJustifProducts: async () => ({}), loadQuota: async () => null,
    loadGroups: async () => null, codeOfCip: () => ({}), allocate: () => ({ lines: [], missing: 0 }),
    delai: () => ({}), freshPharmacyToken: async () => "jeton", submitJustif: async () => {},
    localStorage: { getItem: () => null },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (f) => S.minuteries.push(f),
    appelAuthentifie: async (url, o) => {
      const corps = JSON.parse(o.body), fn = url.split("/").pop();
      appels.push({ fn, corps });
      return { ok: true, status: 200, json: async () => ({ success: true, id: corps.id }) };
    },
    fetch: async (url, o) => { appels.push({ fn: url.split("/").pop(), corps: JSON.parse(o.body) }); return { json: async () => ({ queued: true, lignes: 1, reference: "r" }) }; },
  });
  ctx.quotaOver = charge(expr(bloc(src, /^const quotaOver = /)), ctx);
  ctx.expandSupplierGroups = charge(expr(bloc(src, /^  const expandSupplierGroups = /)), ctx);
  const sendOrder = charge(expr(bloc(src, /^  const sendOrder = async \(\) => \{$/)), ctx);
  const retour = await sendOrder();
  for (let k = 0; k < 20; k++) await new Promise(r => setImmediate(r));   // relais lancé sans attendre
  for (const f of S.minuteries.splice(0)) f();                            // fin d'envoi (panier vidé)
  return { retour, appels, S };
}
const fonctions = (appels) => appels.map(a => a.fn);
const sansId = (c) => { const { id, date, ...r } = c; return r; };   // eslint-disable-line no-unused-vars
{
  // menu Hec 3 (Centrale OTC), Euphytose 2 depuis la page (hors menu), Doliprane 4
  const panier = () => { const a = application(APP); a.ctx.setQty("otc-0", 3); a.ctx.setQty("otc-1", 4); a.ctx.addItemToCart(PER_EUPHY); return { quantities: a.S.quantities, specialItems: a.S.specialItems }; };
  const r = await envoyer(APP, panier());
  eq("envoi réussi : UNE commande, l'e-mail, UN relais (ni ligne ni commande à part)", [r.retour, fonctions(r.appels)], [true, ["order-save", "send-email", "submit-order"]]);
  const commande = r.appels[0].corps;
  eq("lignes enregistrées : mention et date sur la ligne de la page seulement", commande.items, [
    { cip: HEC, name: "HEC POM NACU T/25G", qty: 3, pn: 9.76, total: 29.28 }, { cip: DOLI, name: "DOLIPRANE 1000 mg", qty: 4, pn: 1.5, total: 6 },
    { cip: EUPHY, name: PAGE_EUPHY.name, qty: 2, pn: 9.85, total: 19.7, note: "Pér. 31/01/2027", peremption: "2027-01-31" }]);
  eq("commande : total, lignes, CSV, source", [arrondi(commande.totalHt), commande.nbLignes, commande.csv, commande.source], [54.98, 3, `${HEC};3\n${DOLI};4\n${EUPHY};2`, "catalogue"]);
  eq("relais : la commande enregistrée", r.appels[2].corps, { orderId: commande.id, pharmacyName: "PHARMACIE DU BANC", via: "auto" });
  const mail = r.appels[1].corps.template_params;
  vrai("e-mail : mention sur la ligne de la page", mail.order_lines.includes(`• ${PAGE_EUPHY.name} — PÉREMPTION COURTE (Pér. 31/01/2027, sans remise péremption)\n  Qté : 2  |  PU : 9,85 €  |  Total : 19,70 €`));
  vrai("e-mail : les autres lignes sans mention", mail.order_lines.startsWith("• HEC POM NACU T/25G\n  Qté : 3  |  PU : 9,76 €") && (mail.order_lines.match(/PÉREMPTION/g) || []).length === 1);
  eq("e-mail : total et unités", [mail.total_ht, mail.nb_lignes, mail.nb_unites], ["54,98 €", 3, 9]);
  eq("fin d'envoi : panier vidé, « Commande envoyée »", [r.S.quantities, r.S.specialItems, r.S.statut], [{}, [], ["sending", "success", null]]);
  if (PROD) {
    const p = await envoyer(PROD, panier());
    const champsRelais = (items) => items.map(({ cip, name, qty, pn }) => ({ cip, name, qty, pn }));
    eq("production : mêmes appels", fonctions(p.appels), fonctions(r.appels));
    eq("champs lus par le relais (cip, name, qty, pn) : identiques à la production", champsRelais(commande.items), champsRelais(p.appels[0].corps.items));
    eq("commande enregistrée : identique à la production, mention en plus", { ...sansId(commande), items: commande.items.map(sansMention) }, sansId(p.appels[0].corps));
    eq("e-mail : identique à la production, mention en plus", { ...r.appels[1].corps.template_params, order_date: "", order_lines: mail.order_lines.replace(M.mentionMail(PER_EUPHY), "") },
      { ...p.appels[1].corps.template_params, order_date: "" });
  }
  // panier sans ligne de la page : envoi identique à la production
  if (PROD) {
    const sans = { quantities: { "otc-0": 3 }, specialItems: [{ cip: EUPHY, name: PAGE_EUPHY.name, qty: 2, pn: 9.85, pv: 12.31, tiers: null }] };
    const [a, b] = [await envoyer(APP, sans), await envoyer(PROD, sans)];
    eq("sans ligne de la page : commande et e-mail identiques à la production", [sansId(a.appels[0].corps), { ...a.appels[1].corps.template_params, order_date: "" }],
      [sansId(b.appels[0].corps), { ...b.appels[1].corps.template_params, order_date: "" }]);
  }
}

// ── 5. Ce que le lot ne touche pas ──
{
  const diff = (f) => { try { return execFileSync("git", ["diff", "--name-only", PROD_REF, "--", f], { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "?"; } };
  if (PROD) eq("relais, envoi PharmaML, catalogue, restock-alert : fichiers inchangés", ["netlify/functions/_relais.js", "netlify/functions/submit-order.js", "netlify/functions/order-save.js",
    "netlify/functions/odoo-catalog.js", "netlify/functions/restock-alert.js", "netlify/functions/_odoo-rpc.js", "netlify/functions/odoo.js"].map(diff).filter(Boolean), []);
  vrai("aucun appel d'écriture Odoo dans le code touché par le lot", ![APP, SHORT, lire("src/peremption-panier.js"), lire("netlify/functions/_accueil-outils.js")]
    .some(t => /pricelist\.item|\bunlink\b|"create"|"write"/.test(t)));
}

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
