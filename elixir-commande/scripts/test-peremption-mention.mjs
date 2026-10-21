// Tests de la page « Péremption courte » et de la mention « Pér. » (règle du 21/10/2026, docs/peremption.md) :
// node scripts/test-peremption-mention.mjs
// Décision de Zineb : « par défaut le −50 s'affiche et c'est la règle panier qui s'applique ; si le travail manuel côté admin
// n'est pas fait, on rectifiera les écarts depuis l'affichage des écarts ».
// Hors ligne, sans navigateur ni réseau, aucune écriture (ni Odoo, ni Supabase, ni PharmaML : doublures). Le VRAI code est
// exécuté : prixAffiche et handleAdd de ShortExpiry.jsx (page), handleAdd d'OrderEntry.jsx (Saisie de commande), addItemToCart,
// le panier calculé (cartItems) et sendOrder d'App.jsx, extraits des fichiers et exécutés avec des doublures.
// src/peremption-panier.js, applyTiers (src/tiers.jsx), lab-justif-client.js et les parties pures de l'onglet Péremptions de
// l'admin (src/components/PeremptionsAdmin.jsx) sont assemblés par esbuild (React vide). La règle panier elle-même (ligne à
// part, commande à part, relais, contrôle du panier enregistré) : scripts/test-peremption-panier.mjs.
//  • page : −50 % (−20 % dès 500 €) comme avant le 20/10 (commit d840631), remise affichée de l'admin (0 = aucune : prix de
//    la Saisie et ses paliers), règle Odoo facturée (V1, « remise sur facture ») ; pas d'ajout sans prix ;
//  • mention « Pér. <date> · −X % » : panier, commande enregistrée, e-mail à Elixir, admin, « Mes commandes » ; lignes
//    enregistrées par la production (lot 0, V1) toujours lues ;
//  • admin : remise saisie, journal (remise affichée, écarts), export CSV et totaux du Contrôle des écarts, statuts ;
//  • ce que la règle ne touche pas (envoi PharmaML, enregistrement, catalogue, restock-alert ; _relais.js : une ligne).
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
    + ' export { remiseSaisie, prixVise, ETATS, habituelDe, economie, detailJournal, csvEcarts, csvCellule, totauxEcarts, actionEcart, remiseRegleDepuisPage, texteFinLot, texteDecision, FACTURATION, TYPES_ECART, STATUTS_ECART, ACTIONS_JOURNAL, RESULTATS_JOURNAL, MODES_JOURNAL, DEBUT_REGLE_PANIER } from "./src/components/PeremptionsAdmin.jsx";', resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false,
  loader: { ".jsx": "jsx", ".js": "jsx" }, jsx: "automatic", logLevel: "silent",
  // React vide (les composants ne sont pas rendus ici) ; JSX automatique (src/icons.jsx n'importe pas React)
  plugins: [{ name: "sans-react", setup(b) {
    b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "export default {}; export const useState = (v) => [v, () => {}];"
      + " export const useEffect = () => {}; export const useCallback = (f) => f; export const useMemo = (f) => f(); export const useRef = (v) => ({ current: v });"
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
// page d'avant le 20/10/2026 (−50 % d'office), par son commit (d840631) ; production du 21/10/2026 (lot 0 et V1 : page au prix
// habituel), par son commit (b1dbd3e) : pas origin/master, qui avance à chaque mise en ligne
const PROD_REF = "d8406310969dec4eb2206751275b5f7bc621b32b";
const LOT0_REF = "b1dbd3e7d3bf77c256d60ab6e4f8f997c9e3137d";
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

// page Péremption courte (prixAffiche et handleAdd de ShortExpiry.jsx) et Saisie de commande (handleAdd d'OrderEntry.jsx)
function ajoutPage(produit, qty, remises = null) {
  let envoye = null;
  const ctx = { ...M, remises, quantities: { [produit.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; } };
  ctx.prixAffiche = charge(expr(bloc(SHORT, /^  const prixAffiche = /)), ctx);
  ctx.handleAdd = charge(expr(bloc(SHORT, /^  const handleAdd = /)), ctx);
  ctx.handleAdd(produit);
  return envoye;
}
function prixAffichePage(produit, remises = null) {
  return charge(expr(bloc(SHORT, /^  const prixAffiche = /)), { ...M, remises })(produit);
}
function ajoutSaisie(produit, qty) {
  let envoye = null;
  const ctx = { quantities: { [produit.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; }, retourDe: () => null, masquerRetour: () => {},
    query: "", pharmacyCip: "1234567", results: [], fetch: () => Promise.resolve() };
  ctx.handleAdd = charge(expr(bloc(SAISIE, /^  const handleAdd = /)), ctx);
  ctx.handleAdd(produit);
  return envoye;
}
// page d'avant le 20/10/2026 (getDiscount, getDiscountedPrice, handleAdd)
function ajoutAvant(produit, qty, discounts = {}) {
  const t = enProd("src/components/ShortExpiry.jsx");
  if (!t) return null;
  let envoye = null;
  const ctx = { discounts, quantities: { [produit.cip]: qty }, setQuantities: () => {}, onAddToCart: (o) => { envoye = o; } };
  for (const nom of ["getDiscount", "getDiscountedPrice", "handleAdd"]) ctx[nom] = charge(expr(bloc(t, new RegExp(`^  const ${nom} = `))), ctx);
  ctx.handleAdd(produit);
  return envoye;
}

const HEC = "3400930470312", EUPHY = "3534510001778", ZADI = "3400932448951";
const CATALOGUE = { otc: { label: "Centrale OTC", accent: "#0f766e", products: [{ cip: HEC, name: "HEC POM NACU T/25G", pn: 9.76, pv: 10.32 }] } };
// produits de la page (peremption?action=page, relevé du 20/10/2026 simplifié)
const PAGE_HEC = { cip: HEC, name: "HEC POM NACU T/25G", list_price: 10.32, discounted_price: 9.76, discount_pct: 5.4, price_tiers: null, earliest_expiry: "2026-12-31", remise_admin: null };
const PAGE_EUPHY = { cip: EUPHY, name: "EUPHYTOSE NUIT MYRTILLE GOMME 30", list_price: 12.31, discounted_price: 9.85, discount_pct: 20, price_tiers: null, earliest_expiry: "2027-01-31T00:00:00+00:00", remise_admin: null };
const PAGE_ZADI = { cip: ZADI, name: "ZADITEN 1 mg/5 ml", list_price: 3.83, discounted_price: 3.6, discount_pct: 6, earliest_expiry: "2026-12-31", price_tiers: [{ min_qty: 6, price: 3.4 }], remise_admin: null };
const PAGE_CHER = { cip: "3400930000102", name: "PRODUIT À 2 000 €", list_price: 2000, discounted_price: 1910, discount_pct: 4.5, earliest_expiry: "2027-02-28", remise_admin: null };
const PAGE_SANS_REMISE = { cip: "3400930000103", name: "SANS REMISE LISTE 5", list_price: 8, discounted_price: null, discount_pct: 0, earliest_expiry: "2027-01-15", remise_admin: null };

// ── 1. Parties pures (src/peremption-panier.js) ──
eq("date française", M.datePeremption("2026-12-31"), "31/12/2026");
eq("mention", M.notePeremption("2026-12-31"), "Pér. 31/12/2026");
eq("jour du lot : heure retirée, vide → « date inconnue », autre texte gardé", [M.jourPeremption("2027-01-31T00:00:00+00:00"), M.jourPeremption(null), M.jourPeremption("  "), M.jourPeremption("lot sans date")],
  ["2027-01-31", "date inconnue", "date inconnue", "lot sans date"]);
eq("ligne péremption : peremption non vide seulement", [M.estPeremption({ peremption: "2026-12-31" }), M.estPeremption({ peremption: "" }), M.estPeremption({}), M.estPeremption(null)], [true, false, false, false]);
eq("prix habituel : liste n° 5 si remise, sinon prix catalogue ; paliers d'Odoo", [M.prixPage(PAGE_HEC).pn, M.prixPage(PAGE_CHER).pn, M.prixPage(PAGE_SANS_REMISE).pn, M.prixPage(PAGE_ZADI).tiers],
  [9.76, 1910, 8, [{ min_qty: 6, price: 3.4 }]]);
eq("remise par défaut : 50 %, 20 % dès 500 € de prix de base", [M.remiseDefaut(10.32), M.remiseDefaut(499.99), M.remiseDefaut(500), M.remiseDefaut(null)], [50, 50, 20, 50]);

// ── 2. Page : remise affichée (comme avant le 20/10), remise de l'admin, règle facturée ──
{
  const hec = ajoutPage(PAGE_HEC, 2);
  eq("page : objet ajouté (−50 % du prix de base, date, mention, remise, non facturée par Odoo)", hec,
    { cip: HEC, name: "HEC POM NACU T/25G", qty: 2, pn: 5.16, pv: 10.32, discount: 50, tiers: null, note: "Pér. 31/12/2026", peremption: "2026-12-31", remise: 50, facture_odoo: false, plafond: null });
  for (const [p, rem] of [[PAGE_HEC, {}], [PAGE_EUPHY, {}], [PAGE_ZADI, {}], [PAGE_CHER, {}], [PAGE_SANS_REMISE, {}], [{ ...PAGE_HEC, remise_admin: undefined }, { [HEC]: 30 }]]) {
    const avant = ajoutAvant(p, 3, rem);
    if (!avant) break;
    const n = ajoutPage(p, 3, rem);
    eq(`page = page d'avant le 20/10 (${p.name}${rem[HEC] ? ", remise admin 30 %" : ""}) : même prix, même remise, même prix de base`, [n.pn, n.discount, n.pv], [avant.pn, avant.discount, avant.pv]);
  }
  eq("page : −20 % dès 500 € (2 000 € → 1 600 €)", [ajoutPage(PAGE_CHER, 1).pn, ajoutPage(PAGE_CHER, 1).remise], [1600, 20]);
  eq("page : lot avec heure → jour seul", ajoutPage(PAGE_EUPHY, 1).peremption, "2027-01-31");
  eq("page : quantité 0, rien d'ajouté ; produit sans prix, rien d'ajouté", [ajoutPage(PAGE_HEC, 0), ajoutPage({ ...PAGE_SANS_REMISE, list_price: null }, 2)], [null, null]);
  // remise de l'admin à 0 : prix de la Saisie (liste n° 5), paliers compris
  for (const p of [PAGE_HEC, PAGE_ZADI, PAGE_CHER, PAGE_SANS_REMISE]) {
    const { note, peremption, remise, facture_odoo, discount, plafond, ...page } = ajoutPage({ ...p, remise_admin: 0 }, 3);   // eslint-disable-line no-unused-vars
    const { discount: d2, ...saisie } = ajoutSaisie(p, 3);   // eslint-disable-line no-unused-vars
    eq(`remise de l'admin à 0 (${p.name}) : prix, prix de base et paliers de la Saisie de commande`, page, saisie);
  }
  eq("page : prix affiché = offre (prix de base barré, remise) ; FFP2 au prix habituel plus bas", [prixAffichePage(PAGE_HEC).base, prixAffichePage(PAGE_HEC).remise, prixAffichePage({ cip: "1", list_price: 5.99, discounted_price: 2.99, discount_pct: 50.1 }).pn],
    [10.32, 50, 2.99]);
  // V1 : règle facturée par Odoo (peremption?action=page : facturee, remise_pct, prix du site repris)
  const ZIN = { cip: "3400933121549", name: "ZINNAT 125 mg B/8", list_price: 3.74, discounted_price: 3.29, discount_pct: 12, price_tiers: null, earliest_expiry: "2027-02-28",
    facturee: true, prix: 3.29, prix_base: 3.74, prix_barre: 3.74, remise_pct: 12, prix_habituel: 3.51, remise_admin: null };
  const z = ajoutPage(ZIN, 2);
  eq("V1 : règle facturée par Odoo → prix facturé, remise de la facture, facture_odoo (pas −50 %)", [z.pn, z.remise, z.facture_odoo, z.pv], [3.29, 12, true, 3.74]);
  eq("V1 : produit plus facturé → offre par défaut (−50 %)", [ajoutPage({ ...ZIN, facturee: false, discounted_price: 3.51, discount_pct: 6.1 }, 1).pn, ajoutPage({ ...ZIN, facturee: false, discounted_price: 3.51 }, 1).facture_odoo], [1.87, false]);
  vrai("page : « remise sur facture » pour une règle Odoo ; « Péremption courte · lot au … » sans remise ; « Ajouter » désactivé sans prix",
    SHORT.includes("remise sur facture") && SHORT.includes("Péremption courte · lot au") && /sansPrix \? \(\s*<button className="ex-peremption-ajouter" disabled/.test(SHORT));
  vrai("page : encart « la remise péremption est déjà déduite du prix affiché : c'est le prix de votre commande » (ligne à part, prix de la page du moment, boîtes à date courte)",
    SHORT.includes("La remise péremption est déjà déduite du prix affiché : c'est le prix de votre commande") && SHORT.includes("ligne à part de votre panier, au prix de la page du moment")
    && SHORT.includes("pour les boîtes à date courte seulement") && !SHORT.includes("figure aussi sur votre facture") && !SHORT.includes("garde ce prix"));
  vrai("page : lit peremption?action=page ; repli odoo-catalog et remises de l'admin (lecture publique) ; ni jeton admin ni prix du menu",
    /fetch\("\/\.netlify\/functions\/peremption\?action=page"\)/.test(SHORT) && /odoo-catalog\?expiry_months=4/.test(SHORT) && /restock-alert\?action=expiry_discounts/.test(SHORT)
    && !/admin_token|set_expiry_discount|prixPanier|prixDuMenu/.test(SHORT));
}

// ── 3. Mention jusqu'à la commande (panier, commande, e-mail, admin, « Mes commandes ») ──
function application(src, { quantities = {}, specialItems = [] } = {}) {
  const S = { quantities, specialItems, justifInfo: {}, cartOpen: false, flashes: [], statut: [], minuteries: [] };
  const maj = (k) => (v) => { S[k] = typeof v === "function" ? v(S[k]) : v; };
  const ctx = {
    ...M, CATALOG_WITH_ADMIN: CATALOGUE,
    get quantities() { return S.quantities; }, get specialItems() { return S.specialItems; }, get justifInfo() { return S.justifInfo; },
    setQuantities: maj("quantities"), setSpecialItems: maj("specialItems"), setJustifInfo: maj("justifInfo"), setCartOpen: maj("cartOpen"),
    flash: (m) => { S.flashes.push(m); }, getCampaign: () => null, buildGroupes: () => [], campGetGroupe: () => null, campGratuite: () => ({ livrées: 0 }),
  };
  for (const nom of ["getStepMin", "getStep", "setQty", "setItemQty", "addItemToCart"]) ctx[nom] = charge(expr(bloc(src, new RegExp(`^  const ${nom} = `))), ctx);
  const calcul = charge(bloc(src, /^  const cartItems = useMemo\(\(\) => \{$/).replace(/^\s*const cartItems = useMemo\(/, "").replace(/, \[[^\]]*\]\);\s*$/, ""), ctx);
  Object.defineProperty(ctx, "cartItems", { get: () => calcul() });
  Object.defineProperty(ctx, "cartTotal", { get: () => ctx.cartItems.reduce((s, i) => s + i.total, 0) });
  Object.defineProperty(ctx, "cartCount", { get: () => ctx.cartItems.reduce((s, i) => s + i.qty, 0) });
  return { S, ctx };
}
async function envoyer(etat) {
  const { S, ctx } = application(APP, etat);
  const appels = [];
  Object.assign(ctx, {
    justifProducts: {}, setJustifProducts: () => {}, actingFor: null, pharmacyName: "PHARMACIE DU BANC", pharmacyEmail: "banc@exemple.fr", pharmacyCip: "1234567",
    isClient: true, DEFAULT_RECIPIENT: "pharmacien@elixirpharma.fr", MESSAGE_ENVOI_BLOQUE: { reconnexion: "r", admin: "a", fiche: "f", erreur: "e" },
    idsEnvoi: { current: {} }, setSendStatus: (v) => S.statut.push(v), setEnvoiBloque: () => {},
    sessionPourEnvoi: async () => true, loadJustifProducts: async () => ({}), loadQuota: async () => null,
    loadGroups: async () => null, codeOfCip: () => ({}), allocate: () => ({ lines: [], missing: 0 }),
    delai: () => ({}), freshPharmacyToken: async () => "jeton", submitJustif: async () => {}, localStorage: { getItem: () => null },
    console: { log: () => {}, warn: () => {}, error: () => {} }, setTimeout: (f) => S.minuteries.push(f),
    appelAuthentifie: async (url, o) => { const corps = JSON.parse(o.body); appels.push({ fn: url.split("/").pop(), corps }); return { ok: true, status: 200, json: async () => ({ success: true, id: corps.id }) }; },
    fetch: async (url, o) => { appels.push({ fn: url.split("/").pop(), corps: JSON.parse(o.body) }); return { json: async () => ({ queued: true, lignes: 1, reference: "r" }) }; },
  });
  ctx.quotaOver = charge(expr(bloc(APP, /^const quotaOver = /)), ctx);
  ctx.expandSupplierGroups = charge(expr(bloc(APP, /^  const expandSupplierGroups = /)), ctx);
  const retour = await charge(expr(bloc(APP, /^  const sendOrder = async \(\) => \{$/)), ctx)();
  for (let k = 0; k < 20; k++) await new Promise(r => setImmediate(r));
  for (const f of S.minuteries.splice(0)) f();
  return { retour, appels, S };
}
{
  const { S, ctx } = application(APP);
  ctx.addItemToCart(ajoutPage(PAGE_EUPHY, 2));
  eq("panier : ligne à part, mention et remise", [ctx.cartItems[0].note, ctx.cartItems[0].remise, ctx.cartItems[0].pn, ctx.cartItems[0].cat], ["Pér. 31/01/2027", 50, 6.16, "Péremption courte"]);
  const r = await envoyer({ specialItems: S.specialItems });
  eq("commande enregistrée : prix de la page, mention, date, remise, facturation par Odoo", r.appels[0].corps.items,
    [{ cip: EUPHY, name: PAGE_EUPHY.name, qty: 2, pn: 6.16, total: 12.32, note: "Pér. 31/01/2027", peremption: "2027-01-31", remise: 50, facture_odoo: false }]);
  vrai("e-mail à Elixir : « PÉREMPTION COURTE (Pér. 31/01/2027, −50 %, prix de la page) » et boîtes à corriger", r.appels[1].corps.template_params.order_lines.startsWith(
    `• ${PAGE_EUPHY.name} — PÉREMPTION COURTE (Pér. 31/01/2027, −50 %, prix de la page)\n  ⚠ prix de la page Péremption courte (−50 %) non repris par Odoo`));
  eq("admin et « Mes commandes » : badge", [M.badgePeremption(r.appels[0].corps.items[0])], ["Pér. 31/01/2027 · −50 %"]);
  // lignes enregistrées par la production (lot 0 : mention seule ; V1 : peremption_remise) : toujours lues
  eq("ligne du lot 0 (mention, prix habituel) : badge, e-mail, aucune consigne", [M.badgePeremption({ peremption: "2026-12-31" }), M.consigneOdoo({ peremption: "2026-12-31", qty: 1, pn: 9.76 }), M.remiseLigne({ peremption: "2026-12-31" })],
    ["Pér. 31/12/2026", "", { remise: null, facture_odoo: false }]);
  eq("ligne V1 (remise facturée par Odoo) : badge, facturée, aucune consigne", [M.badgePeremption({ peremption: "2027-02-28", peremption_remise: 12 }), M.remiseLigne({ peremption_remise: 12 }), M.consigneOdoo({ peremption: "2027-02-28", peremption_remise: 12, qty: 2, pn: 3.29 })],
    ["Pér. 28/02/2027 · −12 %", { remise: 12, facture_odoo: true }, ""]);
  const ADMIN = lire("src/AdminPanel.jsx"), MES = lire("src/components/MyOrdersPanel.jsx");
  vrai("admin (Commandes) : badge, « facturée par Odoo » ou boîtes à corriger ; « Mes commandes » : badge", ADMIN.includes("{badgePeremption(item)}") && ADMIN.includes('" · facturée par Odoo"') && MES.includes("{badgePeremption(it)}"));
}

// ── 4. Admin : onglet Péremptions (parties pures) ──
{
  eq("remise saisie (admin) : entier de 0 à 90, sinon refusée", ["30", "0", "90", "91", "-5", "12.5", "abc", "", " 15 ", "20,0"].map(M.remiseSaisie), [30, 0, 90, null, null, null, null, null, 15, 20]);
  eq("admin (V1) : prix visé du tableau (% du prix de base, ou du prix habituel selon le réglage)", [M.prixVise({ list_price: 3.74, prix_listes: { 5: 3.51 } }, 12), M.prixVise({ list_price: 3.74, prix_listes: { 5: 3.51 } }, 10, "prix_liste5"), M.prixVise({}, 10)],
    [3.29, 3.16, null]);
  eq("admin (V1) : états affichés", Object.keys(M.ETATS).slice(0, 4), ["facture", "en_cours", "simule", "a_remiser"]);
  eq("admin : prix habituel L5 figé à la décision, sinon celui des faits ; économie", [M.habituelDe({ decision: { prix_habituel: { 5: 3.51 } }, faits: { prix_listes: { 5: 3.29 } } }), M.habituelDe({}), M.economie(3.29, 3.51)], [3.51, null, 6.3]);
  const esp = (t) => String(t).replace(/\s/g, " ");
  eq("admin : journal en français (règle Odoo, remise affichée, écart)", [M.ACTIONS_JOURNAL.controler, M.ACTIONS_JOURNAL.remise_affichee, M.ACTIONS_JOURNAL.ecart, M.MODES_JOURNAL.site, M.RESULTATS_JOURNAL.simule,
    esp(M.detailJournal({ action: "creer", apres: { pricelist_id: 25, compute_price: "percentage", percent_price: 40, date_start: "2026-10-21 09:12:07", date_end: "2026-12-01 22:59:59" } }))],
    ["Contrôle du prix facturé", "Remise affichée (page)", "Écart (rectification)", "site (sans Odoo)", "simulé", "Liste n° 25 : remise 40 % sur le prix de base, du 21/10/2026 au 01/12/2026"]);
  eq("admin : début de la règle panier", M.DEBUT_REGLE_PANIER, "2026-10-21");
  const lignes = [
    { cle: "1792600000000:3400932448951", type: "peremption", date: "2026-10-21T16:26:40Z", pharmacie: "Pharmacie; d'essai", commande: "1792600000000", odoo: "S400001", liste: 5, cip: "3400932448951", nom: "ZADITEN", qte: 2, pn: 1.92, net: 3.6, ecart: 3.36, peremption: "2026-12-31", remise: 50, coherent: true, facturation: "to invoice", statut: "a_rectifier" },
    { cle: "1792600000002:3400930470312", type: "peremption", date: "2026-10-21T16:26:40Z", pharmacie: "Pharmacie; d'essai", commande: "1792600000002", odoo: "S400001", liste: 5, cip: "3400930470312", nom: "HEC", qte: 2, pn: 5.16, net: 9.76, ecart: 9.2, peremption: "2026-12-31", remise: 50, coherent: false, facturation: "invoiced", statut: "rectifie", reference: "AV-118", par: "zineb@elixir.test", le: "2026-10-22T08:00:00Z" },
    { cle: "1792800000000:3400933121549", type: "probable", date: "2026-10-24T00:00:00Z", pharmacie: "Pharmacie Trois", commande: "1792800000000", odoo: "S400003", liste: 15, cip: "3400933121549", nom: "ZINNAT", qte: 4, pn: 1.87, net: 3.51, ecart: 6.56, peremption: null, remise: null, facturation: "to invoice", statut: "a_rectifier" }];
  const csv = M.csvEcarts(lignes).split("\r\n");
  eq("admin : export CSV des écarts (24 colonnes, « ; », décimales à virgule, type, statut, référence, qui, quand, CIP de la pharmacie, complément, avoirs, règle absente)", [csv[0].split(";").length, csv[1], csv[2].split(";").slice(12, 20)],
    [24, '21/10/2026;"Pharmacie; d\'essai";1792600000000;S400001;5;3400932448951;ZADITEN;2;1,92;3,6;3,36;page Péremption (« Pér. »);31/12/2026;50 %;;à facturer;à rectifier;;;;;;;',
      ["page Péremption (« Pér. »)", "31/12/2026", "50 %", "oui", "facturée", "rectifié", "AV-118", "zineb@elixir.test"]]);
  // revue du 21/10/2026 : injection de formule (nom venu du navigateur), retours chariot
  eq("admin : CSV protégé contre les formules (= + - @, tabulation, retour) ; retour chariot entre guillemets",
    ['=HYPERLINK("http://x";"HEC")', "+1", "-2", "@SUM(A1)", "\tx", "a\rb", "Zaditen"].map(M.csvCellule), ['"\'=HYPERLINK(""http://x"";""HEC"")"', "'+1", "'-2", "'@SUM(A1)", "'\tx", '"a\rb"', "Zaditen"]);
  const tot = M.totauxEcarts(lignes);
  eq("admin : totaux (lignes « Pér. » cohérentes seulement ; « à vérifier » et autres types à part)", [tot.a_rectifier, tot.rectifie, tot.a_verifier, tot.autres, tot.nbPharmaciesARectifier, tot.pharmacies.map(p => [p.pharmacie, p.a_rectifier.montant, p.rectifie.montant, p.cles.length])],
    [{ montant: 3.36, lignes: 1 }, { montant: 0, lignes: 0 }, { montant: 0, lignes: 0 }, { montant: 6.56, lignes: 1 }, 1, [["Pharmacie; d'essai", 3.36, 0, 1]]]);
  // pharmacies homonymes (CIP différents) : deux pharmacies ; complément d'une ligne rectifiée ; ligne à vérifier hors total
  const homonymes = [{ cle: "1:1", type: "peremption", pharmacie: "PHARMACIE CENTRALE", pharmacy_cip: "2222222", ecart: 9.2, coherent: true, statut: "a_rectifier" },
    { cle: "2:1", type: "peremption", pharmacie: "PHARMACIE CENTRALE", pharmacy_cip: "3333333", ecart: 4.6, coherent: true, statut: "rectifie", ecart_rectifie: 3, complement: 1.6 },
    { cle: "3:1", type: "peremption", pharmacie: "PHARMACIE CENTRALE", pharmacy_cip: "3333333", ecart: 400, coherent: false, statut: "a_rectifier" }];
  const t2 = M.totauxEcarts(homonymes);
  eq("admin : homonymes par CIP, complément compté, « Tout marquer » sans la ligne rectifiée ni la ligne à vérifier",
    [t2.nbPharmaciesARectifier, t2.pharmacies.map(p => [p.pharmacy_cip, p.a_rectifier.montant, p.rectifie.montant, p.cles]), t2.a_rectifier.montant, t2.a_verifier],
    [2, [["2222222", 9.2, 0, ["1:1"]], ["3333333", 1.6, 3, []]], 10.8, { montant: 400, lignes: 1 }]);
  eq("admin : action d'une ligne (à facturer → corriger la commande ; facturée ou avoir → avoir)", [M.actionEcart({ facturation: "to invoice" }), M.actionEcart({ facturation: "invoiced" }), M.actionEcart({ facturation: "to invoice", avoirs: [{}] })], ["corriger", "avoir", "avoir"]);
  eq("admin : « Appliquer dans Odoo » prérempli : remise affichée ; base « % du prix habituel » → le % qui donne le prix de la page",
    [M.remiseRegleDepuisPage({ affichage: { remise: 50, pn: 5.16, source: "defaut" } }, { base_remise: "prix_base" }), M.remiseRegleDepuisPage({ affichage: { remise: 50, pn: 5.16, source: "defaut" }, faits: { prix_listes: { 5: 9.76 } } }, { base_remise: "prix_liste5" }),
      M.remiseRegleDepuisPage({ affichage: { remise: 0, pn: 9.76, source: "habituel" } }, {})], [50, 47, null]);
  eq("admin : libellés des types et statuts", [M.TYPES_ECART.peremption, M.STATUTS_ECART.rectifie, M.FACTURATION["to invoice"]], ["page Péremption (« Pér. »)", "rectifié", "à facturer"]);
  eq("admin : message de fin de lot avec les noms", M.texteFinLot({ resultats: [{ item: { cip: "1" }, statut: "facturee" }], refus: [{ cip: "3", raisons: [{ texte: "lot long" }] }] }, (c) => ({ 1: "Zinnat", 3: "Surgam" }[c])),
    "Zinnat : facturé par Odoo · refusé : Surgam (lot long)");
  const PER_ADMIN = lire("src/components/PeremptionsAdmin.jsx"), ADMIN = lire("src/AdminPanel.jsx");
  vrai("admin : tout passe par peremption.js et adminFetch (remise affichée : POST remise_affichee ; écarts : ecarts, ecarts_resume, ecart_statut) ; aucun stockage",
    /const API = "\/\.netlify\/functions\/peremption"/.test(PER_ADMIN) && PER_ADMIN.includes('action: "remise_affichee"') && PER_ADMIN.includes('action: "ecart_statut"')
    && PER_ADMIN.includes("?action=ecarts_resume") && PER_ADMIN.includes("?action=ecarts&depuis=") && !/localStorage|restock-alert/.test(PER_ADMIN));
  vrai("admin : « Appliquer dans Odoo » prérempli avec la remise affichée (sans décision)", PER_ADMIN.includes('p.affichage?.remise >= 1 && p.affichage.source !== "odoo" ? String(remiseRegleDepuisPage(p, R0)) : ""'));
  vrai("admin : retirer une règle Odoo dit que la page revient à la remise affichée, avec « revenir aussi au prix habituel » (0 %) coché par défaut",
    PER_ADMIN.includes("la page revient aussitôt à la remise affichée") && PER_ADMIN.includes("aussiPage: true") && PER_ADMIN.includes('action: "remise_affichee", cip, remise_pct: 0')
    && !PER_ADMIN.includes("La page cesse aussitôt d'annoncer") && !PER_ADMIN.includes("page sans remise, prix habituel"));
  vrai("onglet admin hors du bundle des pharmacies : chargé à la demande par AdminPanel (lui-même chargé à la demande)",
    /React\.lazy\(\(\) => import\("\.\/components\/PeremptionsAdmin\.jsx"\)\)/.test(ADMIN) && /<PeremptionsAdmin adminFetch=\{adminFetch\} \/>/.test(ADMIN)
    && !/import[^\n]*PeremptionsAdmin/.test(SHORT) && !/import[^\n]*PeremptionsAdmin/.test(APP) && /React\.lazy\(\(\) => import\("\.\/AdminPanel"\)/.test(APP));
}

// ── 5. Ce que la règle ne touche pas ──
{
  const diff = (f) => { try { return execFileSync("git", ["diff", "--name-only", LOT0_REF, "--", f], { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "?"; } };
  if (PROD) eq("envoi PharmaML, enregistrement, catalogue, restock-alert, RPC Odoo : fichiers inchangés depuis la production", ["netlify/functions/submit-order.js", "netlify/functions/order-save.js",
    "netlify/functions/odoo-catalog.js", "netlify/functions/restock-alert.js", "netlify/functions/_odoo-rpc.js", "netlify/functions/odoo.js", "netlify/functions/pml-relais.js"].map(diff).filter(Boolean), []);
  if (PROD) {
    const d = execFileSync("git", ["diff", "-U0", LOT0_REF, "--", "netlify/functions/_relais.js"], { cwd: RACINE, encoding: "utf8" }).split("\n").filter(l => /^[+-][^+-]/.test(l));
    eq("_relais.js : seule la ligne d'empreinte change (« :per »), avec son commentaire", [d.filter(l => l.startsWith("-")).length, d.filter(l => l.startsWith("+") && l.includes("const sig = ")).length, d.some(l => l.includes(':per"'))], [2, 1, true]);
  }
  vrai("aucun appel d'écriture Odoo dans le code du site touché par la règle", ![APP, SHORT, lire("src/peremption-panier.js"), lire("netlify/functions/_accueil-outils.js"), lire("src/components/PeremptionsAdmin.jsx")]
    .some(t => /pricelist\.item|\bunlink\b|"create"|"write"/.test(t)));
}

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
