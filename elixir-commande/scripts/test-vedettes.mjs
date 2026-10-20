// Tests des mises en avant de l'accueil (vitrine cinéma, grille à la une) : node scripts/test-vedettes.mjs
// Hors ligne, sans navigateur ni réseau : Supabase, kv_store et jetons simulés (dépendances injectées) ; le code du
// navigateur (src/components/accueil/vedettes.js, vedettes-regles.js, resolution.js, applyTiers de src/tiers.jsx, src/components/teinte-photo.js)
// est assemblé par esbuild (React remplacé par un module vide), comme scripts/test-accueil-client.mjs.
//  • validation : mêmes résultats au serveur et au navigateur (règles recopiées), textes tronqués, objets invalides
//    ignorés, doublons, 20 objets au plus ; erreurs bloquantes de l'éditeur ;
//  • dates (heure de Paris, jours inclus) : fin d'offre à minuit, début demain, fin effective = la plus proche ;
//    compte à rebours selon le tableau (date, jours, puces, secondes) ;
//  • visibilité au serveur : rupture, justificatif, campagne, introuvable, prix, menu masqué, précommande et PV absent
//    permis, menus inactif / échu / masqué / vide, 5 par emplacement ;
//  • GET accueil-offres : vedettes pour tous (même périmé), vedettes_etat et ?verifier= pour l'admin seulement, une seule
//    lecture de la configuration, aucune écriture ;
//  • navigateur : repli automatique sur la fixture du 20/10 (vitrine Vaseline, grille Claripharm puis Seringues Covid),
//    repli coupé, rupture, menu désactivé, fin passée ; montant du bouton = ce que le panier facture (Ventoline au carton,
//    culotte Claripharm, pot Vaseline sans PV, Dupixent hors menu) ;
//  • teintes : contrastes du texte de la salle sur 5 teintes extrêmes ; teinte dominante d'une photo (pixels) ;
//  • compte à rebours sur la fin du PRIX seulement (fin_offre / finOffre : menu promo daté), jamais sur la date de fin
//    d'une mise en avant (produit d'un menu permanent) ; 3 mises en avant en réserve au-delà de 5 ; justificatifs lus en
//    parallèle du contexte ; photos réduites (banque d'images, Shopify, Open Beauty Facts) ;
//  • photo illisible (incident du 20/10/2026 : stockage des photos privé, carte de devant blanche) : traitée exactement
//    comme une photo absente — éventail refait (photos restantes, cartes texte), produit → photo du catalogue, de la
//    banque, puis boîte générée ; halo jamais sur une photo illisible ; chaque carte photo a un texte d'attente ;
//  • taille réduite en erreur (miniature, .400, 2x) : l'original d'abord, notée seulement s'il échoue aussi ; préchargement
//    de l'offre suivante : de même, et jamais noté hors ligne.
// Mises en avant d'outils du site (type « outil », docs/accueil.md § 7.8) : scripts/test-accueil-outils.mjs (registre,
// validation, chiffres vivants, GET, fonction planifiée, navigateur) ; aucun contrôle de ce fichier n'est retiré.
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ODOO_URL = "https://odoo.test";
globalThis.fetch = async (url) => { throw new Error(`réseau interdit dans les tests : ${url}`); };

const RACINE = new URL("..", import.meta.url).pathname;
const sortie = await build({
  stdin: { contents: 'export * from "./src/components/accueil/vedettes.js"; export * from "./src/components/accueil/vedettes-regles.js"; export { resoudreOffre } from "./src/components/accueil/resolution.js"; export { applyTiers } from "./src/tiers.jsx"; export { teinteDePixels } from "./src/components/teinte-photo.js"; export { photo, photoReconnue, surErreurPhoto, prechargerPhoto } from "./src/components/accueil/outils.js"; export { estIllisible, reglerIllisibles } from "./src/components/accueil/illisibles.js";', resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false, loader: { ".jsx": "jsx", ".js": "jsx" }, jsx: "transform", logLevel: "silent",
  plugins: [{ name: "sans-react", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "export default {}; export const useEffect = () => {}; export const useState = (v) => [v, () => {}];", loader: "js" }));
  } }],
});
const dossier = mkdtempSync(join(tmpdir(), "test-vedettes-"));
writeFileSync(join(dossier, "v.mjs"), sortie.outputFiles[0].text);
const C = await import(pathToFileURL(join(dossier, "v.mjs")).href);
rmSync(dossier, { recursive: true, force: true });
const S = await import("../netlify/functions/_accueil-vedettes.js");
const { contexteMenus } = await import("../netlify/functions/_accueil-selection.js");
const { creerHandler } = await import("../netlify/functions/accueil-offres.js");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const paris = (jour, h = "12:00") => Date.parse(new Date(`${jour}T${h}:00Z`).toISOString()) - (new Date(`${jour}T${h}:00Z`).getTime() - C.minuitParis(jour) - (Number(h.slice(0, 2)) * 3600e3 + Number(h.slice(3)) * 60e3));

// ── données du 20/10/2026 (menus promo réels, produits simplifiés ; aucune donnée client) ──
const VASELINE = "1792060000000", CLARI = "1792040000000", SERINGUES = "1791954262696", BIODANCE = "1790245367017";
const PROMOS = [
  { id: 1778841908301, name: "Pré-commande FFP2", color: "#7c3aed", active: false, endDate: "2026-05-20", products: [{ cip: "3401111111111", name: "FFP2", pn: 5, pv: 9, pct: "-44%" }] },
  { id: Number(BIODANCE), name: "Precommande Masques BIODANCE", color: "#7c3aed", active: true, endDate: "2026-09-25", products: [{ cip: "8809937361718", name: "BIODANCE Rose", pn: 14, pv: 28, pct: "-50%" }] },
  { id: Number(SERINGUES), name: "Seringues Covid", color: "#7c3aed", active: true, endDate: "", products: [{ cip: "4022495251879", name: "Seringues Covid 23G B/100", pn: 11.99, pv: 20, pct: null }, { cip: "3389360009005", name: "EUROMEDIS Seringue 25G B/100", pn: 11.99, pv: 20, pct: null }] },
  { id: Number(CLARI), name: "Culottes et Cup menstruelles remboursées - Claripharm", icon: "🌸", color: "#be185d", active: true, endDate: "", description: "Coton bio, remboursées LPP",
    products: [{ cip: "3701271303933", name: "Culotte menstruelle flux régulier coton bio — XXS (34)", pv: 14.4, pn: 12.96, pct: "-10%", image_url: "https://cdn.shopify.com/s/files/1/x/culotte-xxs.png" },
      { cip: "3701271303858", name: "Coupe menstruelle Claricup — T0", pv: 12, pn: 10.2, pct: "-15%", image_url: "https://cdn.shopify.com/s/files/1/x/claricup-t0.png" }] },
  { id: Number(VASELINE), name: "Précommande Vaseline", icon: "🧴", color: "#1d4f91", active: true, endDate: "", sansStock: true, description: "Précommande · Petroleum Jelly",
    products: [{ cip: "0000042182627", name: "Vaseline Original Petroleum Jelly – pot 50 ml", pv: null, pn: 1.59, pct: null, image_url: "https://images.openbeautyfacts.org/images/products/000/004/218/2627/front_nl.128.full.jpg" },
      { cip: "0000042182658", name: "Vaseline Original Petroleum Jelly – pot 250 ml", pv: null, pn: 3.39, pct: null, image_url: "https://images.openbeautyfacts.org/images/products/000/004/218/2658/front_nl.34.full.jpg" }] },
  { id: 1792070000000, name: "Menu vide", color: "#7c3aed", active: true, endDate: "", products: [{ cip: "3402222222222", name: "Sans prix", pn: null }] },
];
const CIP = { ventoline: "3400934438738", rupture: "3400930000001", justif: "3400930000002", inconnu: "3400930000003", vaseline: "0000042182627", culotte: "3701271303933",
  dupixent: "3400930199190", anormal: "3400930000004", masque: "3400930000005", campagne: "3400930000006", autre: "3400930000007" };
const CATALOGUE_ODOO = {
  [CIP.ventoline]: { cip: CIP.ventoline, name: "VENTOLINE 100µG/DOSE SUSP 120 DOSES", list_price: 3.24, discounted_price: 3.01, discount_pct: 7.1, price_tiers: [], in_stock: true, available: 5000 },
  [CIP.rupture]: { cip: CIP.rupture, name: "PRODUIT EN RUPTURE", list_price: 5, discounted_price: 4.5, discount_pct: 10, in_stock: false, available: 0 },
  [CIP.justif]: { cip: CIP.justif, name: "PRODUIT SUR JUSTIFICATIF", list_price: 50, discounted_price: 48, discount_pct: 4, in_stock: true, available: 50 },
  [CIP.culotte]: { cip: CIP.culotte, name: "CULOTTE CLARIPHARM XXS", list_price: 14.4, discounted_price: 14.4, discount_pct: 0, in_stock: true, available: 40 },
  [CIP.dupixent]: { cip: CIP.dupixent, name: "DUPIXENT 300 mg (dupilumab), solution injectable en stylo prérempli (B/2)", list_price: 1080.35, discounted_price: 1055.25, discount_pct: 2.3, in_stock: true, available: 30 },
  [CIP.anormal]: { cip: CIP.anormal, name: "PRIX ANORMAL", list_price: 0, discounted_price: 0, in_stock: true, available: 10 },
  [CIP.masque]: { cip: CIP.masque, name: "PRODUIT D'UN MENU MASQUÉ", list_price: 6, discounted_price: 5, discount_pct: 16, in_stock: true, available: 10 },
  [CIP.campagne]: { cip: CIP.campagne, name: "PRODUIT DE CAMPAGNE", list_price: 6, discounted_price: 5, discount_pct: 16, in_stock: true, available: 10 },
  [CIP.autre]: { cip: CIP.autre, name: "AUTRE PRODUIT 10 mg", list_price: 6, discounted_price: 5, discount_pct: 16, in_stock: true, available: 10 },
};
const CUREES = [
  { cip: CIP.ventoline, section: "stratege", name: "VENTOLINE 100µG/DOSE SUSP 120 DOSES", pv: 3.24, pn: 3.01, pct: 7.1, colis: 120, image_url: "https://assets.medipim.fr/media/medium/ccca.png" },
  { cip: CIP.rupture, section: "master", name: "PRODUIT EN RUPTURE", pv: 5, pn: 4.5, pct: 10 },
  { cip: CIP.anormal, section: "otc", name: "PRIX ANORMAL", pv: 2, pn: 3, pct: 0 },
  { cip: CIP.masque, section: "nr", name: "PRODUIT D'UN MENU MASQUÉ", pv: 6, pn: 5, pct: 16 },
  { cip: CIP.campagne, section: "camp1", name: "PRODUIT DE CAMPAGNE", pv: 6, pn: 5, pct: 16 },
];
const DISPLAY = { hiddenTabs: ["nr"] };
const ctxServeur = (promos = PROMOS) => ({ catalogue: CATALOGUE_ODOO, curees: CUREES, promos, justifs: new Set([CIP.justif]),
  menus: contexteMenus({ displayConfig: DISPLAY, promos, campagnes: [{ id: "camp1", active: true }] }) });
let n = 0;
const objet = (type, cle, emplacement, extra = {}) => ({ id: `mea_test_${String(++n).padStart(3, "0")}`, type, cip: type === "produit" ? cle : null, menu_id: type === "menu" ? cle : null,
  emplacement, titre: "", accroche: "", badge: "", date_debut: null, date_fin: null, ordre: n * 10, image: null, couleur: null, couleur_auto: null, actif: true, maj: "2026-10-20T05:00:00.000Z", ...extra });
const MIDI_20 = paris("2026-10-20");

// ── 1. Validation : serveur = navigateur ──
{
  const long = "x".repeat(61);
  const valeur = { repli: false, items: [
    objet("produit", CIP.ventoline, "grille", { titre: long, ordre: 20 }),
    objet("menu", VASELINE, "vitrine", { ordre: 10 }),
    objet("produit", CIP.ventoline, "vitrine", { ordre: 30 }),                 // même produit : la vitrine passe avant la grille
    { ...objet("produit", "12AB", "grille"), cip: "12AB" },                    // CIP invalide
    objet("menu", CLARI, "grille", { image: "http://pas-https.test/a.png" }),  // image non https
    objet("menu", SERINGUES, "grille", { date_debut: "2026-10-22", date_fin: "2026-10-21" }),
    objet("menu", BIODANCE, "grille", { couleur: "rouge" }),
    { ...objet("produit", CIP.dupixent, "ailleurs") },
    { id: "pas-un-id", type: "menu", menu_id: CLARI, emplacement: "grille" },
    null, "texte",
  ] };
  const s = S.validerVedettes(valeur), c = C.validerVedettes(valeur);
  eq("validation : serveur et navigateur identiques", JSON.stringify(c), JSON.stringify(s));
  eq("objets gardés (vitrine d'abord, doublon écarté)", s.conf.items.map(i => `${i.emplacement}:${i.type}:${i.cip || i.menu_id}`), [`vitrine:menu:${VASELINE}`, `vitrine:produit:${CIP.ventoline}`]);
  eq("titre trop long tronqué à 60 (serveur, page)", S.validerVedettes({ items: [objet("produit", CIP.dupixent, "grille", { titre: long })] }).conf.items[0].titre.length, 60);
  eq("réglages : repli lu, défilement par défaut", [s.conf.repli, s.conf.defilement], [false, true]);
  eq("motifs des objets ignorés", s.ignores.map(x => x.erreurs[0].champ), ["emplacement", "id", "doublon", "cip", "image", "date_fin", "couleur"]);
  const vingtEtUn = { items: Array.from({ length: 21 }, (_, i) => objet("produit", String(3400930100000 + i), "grille")) };
  eq("20 objets au plus", [S.validerVedettes(vingtEtUn).conf.items.length, C.validerVedettes(vingtEtUn).conf.items.length], [20, 20]);
  eq("valeur en texte JSON lue, valeur illisible → vide", [S.validerVedettes(JSON.stringify(valeur)).conf.items.length, S.validerVedettes("{x").conf.items.length], [2, 0]);
  // éditeur : erreurs bloquantes
  const e = C.erreursBrouillon({ items: [objet("menu", VASELINE, "vitrine", { titre: long }), objet("menu", VASELINE, "grille"),
    objet("produit", CIP.ventoline, "grille", { date_debut: "2026-10-22", date_fin: "2026-10-21" })] });
  eq("éditeur : titre trop long, doublon, fin avant début", e.map(x => x.message), ["60 caractères au plus", "Déjà mis en avant en vitrine", "La fin précède le début"]);
  eq("éditeur : plus de 20", C.erreursBrouillon(vingtEtUn)[0].message, "20 mises en avant au plus : supprimez les terminées");
  eq("éditeur : brouillon correct → aucune erreur", C.erreursBrouillon({ items: [objet("menu", VASELINE, "vitrine")] }), []);
}

// ── 2. Dates (heure de Paris, jours inclus) et compte à rebours ──
{
  eq("fin effective : la plus proche", [C.finEffective("2026-10-31", "2026-10-25"), C.finEffective(null, "2026-10-25T00:00:00Z"), C.finEffective("2026-10-31", ""), C.finEffective(null, null)],
    ["2026-10-25", "2026-10-25", "2026-10-31", null]);
  eq("fin effective : serveur = navigateur", S.finEffective("2026-10-31", "2026-10-25"), "2026-10-25");
  const it = objet("menu", VASELINE, "vitrine", { date_fin: "2026-10-31" });
  const statut = (t) => S.evaluerVedettes({ items: [it] }, null, ctxServeur(), t).etats[0].statut;
  eq("fin le 31/10 : visible à 23:59:59 (Paris, heure d'hiver)", statut(Date.parse("2026-10-31T22:59:59Z")), "visible");
  eq("fin le 31/10 : terminée à 00:00 le 1/11", statut(Date.parse("2026-10-31T23:00:00Z")), "terminee");
  const demain = objet("menu", VASELINE, "vitrine", { date_debut: "2026-10-21" });
  eq("début demain : programmée aujourd'hui, visible demain", [S.evaluerVedettes({ items: [demain] }, null, ctxServeur(), MIDI_20).etats[0].statut,
    S.evaluerVedettes({ items: [demain] }, null, ctxServeur(), Date.parse("2026-10-20T22:00:00Z")).etats[0].statut], ["programmee", "visible"]);
  eq("masquée", S.evaluerVedettes({ items: [{ ...it, actif: false }] }, null, ctxServeur(), MIDI_20).etats[0].statut, "masquee");
  // produit d'un menu promo daté : sa fin effective est celle du menu
  const promosDatees = PROMOS.map(p => (String(p.id) === CLARI ? { ...p, endDate: "2026-10-25" } : p));
  eq("produit d'un menu daté : fin = fin du menu", S.evaluerVedettes({ items: [objet("produit", CIP.culotte, "grille", { date_fin: "2026-10-31" })] }, null, ctxServeur(promosDatees), MIDI_20).publiques.items[0].fin, "2026-10-25");
  // compte à rebours : > 7 jours → date ; 2 à 7 jours → jours ; < 48 h → puces ; < 1 h → minutes et secondes ; 0 → fini
  const t = (iso) => Date.parse(iso);
  eq("rebours > 7 jours : date", C.rebours("2026-10-31", t("2026-10-20T10:00:00Z")).mode, "date");
  eq("rebours 2 à 7 jours : jours restants", [C.rebours("2026-10-25", t("2026-10-20T10:00:00Z")).mode, C.rebours("2026-10-25", t("2026-10-20T10:00:00Z")).n], ["jours", 6]);
  eq("rebours < 48 h : j h min", C.rebours("2026-10-21", t("2026-10-20T06:00:00Z")).puces, [[1, "j"], [16, "h"], ["00", "min"]]);
  eq("rebours < 1 h : min s (vitrine) ; min (grille)", [C.rebours("2026-10-20", t("2026-10-20T21:17:50Z")).puces, C.rebours("2026-10-20", t("2026-10-20T21:17:50Z"), false).puces],
    [[["42", "min"], ["10", "s"]], [["42", "min"]]]);
  eq("rebours à minuit : fini", C.rebours("2026-10-20", t("2026-10-20T22:00:00Z")).mode, "fini");
  eq("dates lisibles", [C.dateTexte("2026-10-31"), C.dateTexte("2026-10-31", { semaine: true }), C.dateTexte("2026-09-25", { court: true })], ["31 octobre", "samedi 31 octobre", "25 sept."]);
}

// ── 3. Visibilité au serveur ──
{
  const items = [
    objet("produit", CIP.ventoline, "vitrine"), objet("menu", VASELINE, "vitrine"),
    objet("produit", CIP.rupture, "grille"), objet("produit", CIP.justif, "grille"), objet("produit", CIP.inconnu, "grille"),
    objet("produit", CIP.anormal, "grille"), objet("produit", CIP.masque, "grille"), objet("produit", CIP.campagne, "grille"),
    objet("produit", CIP.vaseline, "grille"), objet("produit", CIP.culotte, "grille"), objet("produit", CIP.dupixent, "grille"),
    objet("menu", "1778841908301", "grille"), objet("menu", BIODANCE, "grille"), objet("menu", "1792070000000", "grille"), objet("menu", "999", "grille"),
    objet("menu", CLARI, "grille"), objet("menu", SERINGUES, "grille"), objet("produit", "3400930000099", "grille"), objet("produit", CIP.autre, "grille"),
  ];
  const { publiques, etats } = S.evaluerVedettes({ items }, "2026-10-20T05:00:00Z", ctxServeur(), MIDI_20);
  eq("statuts", etats.map(e => e.statut), ["visible", "visible", "rupture", "justificatif", "introuvable", "prix_anormal", "menu_masque", "campagne", "visible", "visible", "visible",
    "menu_inactif", "menu_echu", "menu_vide", "introuvable", "visible", "visible", "introuvable", "au_dela_de_5"]);
  eq("publiques : 2 en vitrine, 5 dans la grille + 1 en réserve (au-delà de 5)", [publiques.items.filter(i => i.emplacement === "vitrine").length, publiques.items.filter(i => i.emplacement === "grille").length,
    publiques.items.at(-1).offre?.cip], [2, 6, CIP.autre]);
  const v = publiques.items.find(i => i.offre?.cip === CIP.vaseline);
  eq("précommande permise, PV absent permis", [v.offre.menu.key, v.offre.pv, v.offre.pn], [`promo_${VASELINE}`, null, 1.59]);
  const ven = publiques.items[0];
  eq("Ventoline : prix Odoo n° 5, carton de 120", [ven.offre.menu.key, ven.offre.pn, ven.offre.lot], ["stratege", 3.01, { qte: 120, pu: 3.01, total: 361.2 }]);
  eq("pas de popularité ni de champ interne dans les vedettes", /popularite|_cmd|_rythme|available/.test(JSON.stringify(publiques)), false);
  eq("vérification d'un brouillon", Object.entries(S.verification([CIP.justif, CIP.dupixent], ctxServeur())).map(([c, x]) => [c, x.raisons, x.offre.menu.key]),
    [[CIP.justif, ["justificatif"], "saisie"], [CIP.dupixent, [], "saisie"]]);
  eq("CIP à vérifier : chiffres seulement, 20 au plus", [S.cipsAVerifier("3400934438738,abc,12,3400934438738"), S.cipsAVerifier(Array.from({ length: 30 }, (_, i) => 3400930100000 + i).join(",")).length], [["3400934438738"], 20]);
}

// ── 4. GET accueil-offres ──
{
  const conf = { items: [objet("produit", CIP.ventoline, "vitrine"), objet("menu", VASELINE, "vitrine"), objet("produit", CIP.justif, "grille")] };
  const lectures = [];
  const listeCips = (p) => decodeURIComponent((p.match(/cip=in\.([^&]*)/) || [])[1] || "").replace(/[()"]/g, "").split(",").filter(Boolean);
  const sb = async (path, opts) => {
    lectures.push(path.split("?")[0]);
    if (opts?.method && opts.method !== "GET") throw new Error("écriture interdite");
    if (path.startsWith("elixir_pharmacies")) return [{ email: "compte@pharmacie-a.test" }];
    if (path.startsWith("ec_config")) return [{ key: "display_config", value: DISPLAY, updated_at: "x" }, { key: "admin_promos", value: PROMOS, updated_at: "y" },
      { key: "accueil_vedettes", value: JSON.stringify(conf), updated_at: "2026-10-20T05:00:00.000Z" }];
    if (path.startsWith("odoo_catalog")) return listeCips(path).map(c => CATALOGUE_ODOO[c]).filter(Boolean);
    if (path.startsWith("elixir_products")) return CUREES.filter(r => listeCips(path).includes(r.cip));
    if (path.startsWith("elixir_campaigns")) return [{ id: "camp1", active: true }];
    throw new Error(`table inattendue ${path}`);
  };
  const kv = new Map([["accueil:offres", { version: 1, genere_le: new Date(MIDI_20 - 3600e3).toISOString(), periode: null, slides: [], reserves: [] }]]);
  const deps = (extra = {}) => ({ sb, kvGet: async (k) => kv.get(k) ?? null, kvSet: async () => { throw new Error("écriture kv interdite"); }, rateLimit: () => null,
    justifs: async () => new Set([CIP.justif]), maintenant: () => MIDI_20, odoo: async () => { throw new Error("Odoo interdit"); },
    verifierJeton: async (t) => ({ "jeton-a": { id: "a", email: "compte@pharmacie-a.test" }, "jeton-admin": { id: "adm", email: "equipe@elixir.test", isAdmin: true } })[t] || null, ...extra });
  const appel = async (jeton, q = {}, extra) => { const r = await creerHandler(deps(extra))({ httpMethod: "GET", headers: { authorization: `Bearer ${jeton}` }, queryStringParameters: q });
    return { statut: r.statusCode, corps: JSON.parse(r.body) }; };
  let r = await appel("jeton-a", { verifier: CIP.justif });
  eq("pharmacie : vedettes visibles, ni états ni vérification (paramètre ignoré)", [r.statut, r.corps.vedettes.items.map(i => i.id), "vedettes_etat" in r.corps, "verification" in r.corps],
    [200, [conf.items[0].id, conf.items[1].id], false, false]);
  eq("une seule lecture de la configuration (ec_config)", lectures.filter(l => l === "ec_config").length, 1);
  eq("vedettes : maj et réglages", [r.corps.vedettes.maj, r.corps.vedettes.repli, r.corps.vedettes.defilement], ["2026-10-20T05:00:00.000Z", true, true]);
  r = await appel("jeton-admin", { verifier: `${CIP.dupixent},${CIP.justif}` });
  eq("admin : états de toutes les mises en avant", r.corps.vedettes_etat.map(e => e.statut), ["visible", "visible", "justificatif"]);
  eq("admin : vérification du brouillon", Object.keys(r.corps.verification), [CIP.dupixent, CIP.justif]);
  kv.clear();
  r = await appel("jeton-a", {}, { verrou: async () => ({ occupe: true }) });
  eq("classement absent (périmé) : vedettes quand même", [r.corps.perime, r.corps.vedettes.items.length], [true, 2]);
}

// ── 5. Navigateur : construction, repli automatique, recalage sur le catalogue ──
const CATALOGUE_SITE = {
  stratege: { label: "Sélection Stratège", accent: "#4a9e42", products: [{ cip: CIP.ventoline, name: "VENTOLINE 100µG/DOSE SUSP 120 DOSES", pv: 3.24, pn: 3.01, pct: 7.1, colis: 120, price_tiers: null, image_url: "https://assets.medipim.fr/media/medium/ccca.png" }] },
  [`promo_${CLARI}`]: { label: "Culottes Claripharm", products: PROMOS.find(p => String(p.id) === CLARI).products },
  [`promo_${VASELINE}`]: { label: "Précommande Vaseline", products: PROMOS.find(p => String(p.id) === VASELINE).products },
  [`promo_${SERINGUES}`]: { label: "Seringues Covid", products: PROMOS.find(p => String(p.id) === SERINGUES).products },
  saisie: { label: "Saisie de commande", accent: "#2d9cbc", products: [] },
};
const getStepMin = (k, p) => (k === "stratege" ? { step: p.colis || 1, min: p.colis || 1, multiple: p.colis || 1 } : { step: 1, min: 0, multiple: 1 });
const regleSaisie = (cip) => {
  for (const [k, c] of Object.entries(CATALOGUE_SITE)) {
    const p = (c.products || []).find(x => x.cip === cip);
    if (!p) continue;
    const r = getStepMin(k, p), m = r.multiple > 1 ? r.multiple : (r.step > 1 ? r.step : 1);
    return m > 1 || r.min > 1 ? { step: r.step, min: r.min, multiple: m, rayon: c.label } : null;
  }
  return null;
};
const ctxPage = (extra = {}) => ({ catalogue: CATALOGUE_SITE, catalogueCharge: true, stockData: {}, justifProducts: {}, menuOuvrable: () => true, regleSaisie, estCampagne: () => false,
  photos: {}, teinte: (k) => CATALOGUE_SITE[k]?.accent || "#2d9cbc", promos: PROMOS, aujourdhui: "2026-10-20", ...extra });
// ce que le panier facture (ajouterDepuisSaisie → addItemToCart → cartItems d'App.jsx)
function factureDuPanier(offre, qty) {
  const r = regleSaisie(offre.cip);
  const q = r ? (() => { const a = Math.round(qty / r.multiple) * r.multiple; return a > 0 && r.min > 0 ? Math.max(r.min, a) : a; })() : qty;
  for (const c of Object.values(CATALOGUE_SITE)) { const p = (c.products || []).find(x => x.cip === offre.cip); if (p) return Math.round(C.applyTiers(Number(p.pn), p.price_tiers, q).pn * q * 100) / 100; }
  return Math.round((C.applyTiers(offre.pn ?? null, offre.price_tiers || null, q).pn || 0) * q * 100) / 100;
}
{
  // repli : clé absente, menus du 20/10 (BIODANCE échu, FFP2 inactif, menu vide) → Vaseline en vitrine, Claripharm puis Seringues
  const m = C.construireMisesEnAvant(null, ctxPage());
  eq("repli : vitrine Vaseline, grille Claripharm puis Seringues Covid", [m.vitrine.map(e => e.menu.id), m.grille.map(e => e.menu.id), m.auto], [[VASELINE], [CLARI, SERINGUES], { vitrine: true, grille: true }]);
  eq("repli : textes et résumé du menu", [m.vitrine[0].titre, m.vitrine[0].rayon, m.vitrine[0].menu.nb, m.vitrine[0].menu.des, m.vitrine[0].menu.jusqua, m.grille[0].menu.jusqua],
    ["Précommande Vaseline", "Précommande", 2, 1.59, null, 15]);
  eq("couleur du menu (violet par défaut ignoré)", [m.vitrine[0].couleur, m.grille[1].couleur, m.grille[1].source], ["#1d4f91", "#3c7782", "elixir"]);
  eq("repli coupé, rien de configuré : ni vitrine ni grille", C.construireMisesEnAvant({ repli: false, items: [] }, ctxPage()).vitrine.length + C.construireMisesEnAvant({ repli: false, items: [] }, ctxPage()).grille.length, 0);
  eq("menu non ouvrable : écarté du repli", C.construireMisesEnAvant(null, ctxPage({ menuOuvrable: (k) => k !== `promo_${VASELINE}` })).vitrine[0].menu.id, CLARI);
  // vedettes du serveur, recalées sur le catalogue chargé
  const conf = { items: [objet("produit", CIP.ventoline, "vitrine", { titre: "Ventoline au carton" }), objet("menu", VASELINE, "vitrine", { date_fin: "2026-10-31" }),
    objet("produit", CIP.culotte, "grille"), objet("produit", CIP.vaseline, "grille"), objet("produit", CIP.dupixent, "grille")] };
  const ved = S.evaluerVedettes(conf, null, ctxServeur(), MIDI_20).publiques;
  const p = C.construireMisesEnAvant(ved, ctxPage());
  eq("vitrine et grille configurées (pas de repli)", [p.vitrine.map(e => e.type), p.grille.map(e => e.type), p.auto], [["produit", "menu"], ["produit", "produit", "produit"], { vitrine: false, grille: false }]);
  eq("titres par défaut : marque (jamais les capitales d'Odoo) ou nom du menu en minuscules", p.grille.map(e => e.titre),
    ["Culotte menstruelle flux régulier coton bio — XXS (34)", "Vaseline Original Petroleum Jelly – pot 50 ml", "Dupixent"]);
  eq("rayons", [p.vitrine[0].rayon, ...p.grille.map(e => e.rayon)], ["Sélection Stratège", "Culottes Claripharm", "Précommande Vaseline", "Saisie de commande"]);
  eq("Ventoline : teinte du rayon Stratège", [p.vitrine[0].couleur, p.vitrine[0].source], ["#4a9e42", "rayon"]);
  for (const e of [p.vitrine[0], ...p.grille]) eq(`montant du bouton = panier : ${e.titre}`, e.offre.lot.total, factureDuPanier(e.offre, e.offre.lot.qte));
  eq("lots : carton de 120, 1 culotte, 1 pot, 1 boîte", [p.vitrine[0], ...p.grille].map(e => e.offre.lot.qte), [120, 1, 1, 1]);
  // rupture d'un produit de menu (stock du site) : écarté ; précommande : gardée ; menu désactivé : écarté ; fin passée : écartée
  const st = { [CIP.ventoline]: { dispo: 0 }, [CIP.vaseline]: { dispo: 0 } };
  const r2 = C.construireMisesEnAvant(ved, ctxPage({ stockData: st }));
  eq("rupture : Ventoline écartée, pot Vaseline (précommande) gardé", [r2.vitrine.map(e => e.type), r2.grille.map(e => e.offre.cip)], [["menu"], [CIP.culotte, CIP.vaseline, CIP.dupixent]]);
  const inactifs = PROMOS.map(x => (String(x.id) === VASELINE ? { ...x, active: false } : x));
  eq("menu désactivé depuis : écarté de la vitrine", C.construireMisesEnAvant(ved, ctxPage({ promos: inactifs })).vitrine.map(e => e.type), ["produit"]);
  eq("fin passée (page restée ouverte) : écartée", C.construireMisesEnAvant(ved, ctxPage({ aujourdhui: "2026-11-01" })).vitrine.map(e => e.type), ["produit"]);
  eq("justificatif (navigateur) : écarté", C.construireMisesEnAvant(ved, ctxPage({ justifProducts: { [CIP.dupixent]: true } })).grille.map(e => e.offre.cip), [CIP.culotte, CIP.vaseline]);
  // catalogue pas encore chargé : prix du serveur, règle de quantité du serveur
  eq("catalogue pas chargé : lot du serveur", C.construireMisesEnAvant(ved, ctxPage({ catalogueCharge: false })).vitrine[0].offre.lot.total, 361.2);
  // éventail : photos du menu, carte de devant choisie, cartes texte pour compléter
  eq("éventail : carte de devant, photos, cartes texte jusqu'à 3", C.resumeMenu(PROMOS.find(x => String(x.id) === VASELINE), { image: "https://exemple.test/devant.png" }).cartes.map(c => c.url ? "photo" : "texte"),
    ["photo", "photo", "photo"]);
  eq("éventail : menu sans photo → cartes texte", C.resumeMenu(PROMOS.find(x => String(x.id) === SERINGUES)).cartes.map(c => [c.url, c.pn]), [[null, 11.99], [null, 11.99]]);
  eq("prix lu", C.prixLu({ pn: 12.96, pv: 14.4, pct: 10 }), "12,96 € HT, remise de 10 %, prix de vente 14,40 € HT");
}

// ── 6. Teintes : contrastes du texte de la salle (5 teintes extrêmes) ; teinte dominante d'une photo ──
{
  const rgb = (s) => (s.startsWith("#") ? [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)) : s.match(/\d+/g).map(Number));
  const sur = (fond, c, a) => fond.map((v, i) => v * (1 - a) + c[i] * a);
  const lum = (c) => { const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const PAPER = rgb("#fbf8f2"), PETROL = rgb("#0f2d3d"), DEEP = rgb("#0a1d22"), OR_CLAIR = rgb("#d7bb7f"), BLANC = [255, 255, 255];
  // points les plus exposés du texte (valeurs prudentes) : bord droit du texte sur ordinateur, début du texte sur mobile
  const POINTS = { "ordinateur, bord du texte": { sombre: 0.2, photo: 0.15, voile: 0.75 }, "ordinateur, milieu du texte": { sombre: 0.1, photo: 0.05, voile: 0.82 },
    "téléphone, sous l'écran": { sombre: 0.3, photo: 0.25, voile: 0.86 } };
  let pire = { paper: 99, mute: 99, or: 99 };
  for (const hex of ["#ffffff", "#ffe600", "#000000", "#ff00ff", "#808080"]) {
    const t = C.teintes(hex);
    for (const p of Object.values(POINTS)) {
      const fond = sur(sur(sur(PETROL, rgb(t.sombre), p.sombre), BLANC, p.photo), DEEP, p.voile);
      pire = { paper: Math.min(pire.paper, contraste(PAPER, fond)), mute: Math.min(pire.mute, contraste(sur(fond, PAPER, 0.72), fond)), or: Math.min(pire.or, contraste(OR_CLAIR, fond)) };
    }
  }
  vrai(`texte sur la salle : paper ≥ 7:1 (${pire.paper.toFixed(2)}), secondaire ≥ 4,5:1 (${pire.mute.toFixed(2)}), or clair ≥ 4,5:1 (${pire.or.toFixed(2)})`, pire.paper >= 7 && pire.mute >= 4.5 && pire.or >= 4.5);
  const t = C.teintes("#be185d");
  eq("teintes bornées (rgb validé)", [/^rgb\(\d+, \d+, \d+\)$/.test(t.sombre), /^rgb\(\d+, \d+, \d+\)$/.test(t.claire), /^rgb\(\d+, \d+, \d+\)$/.test(t.trait)], [true, true, true]);
  eq("teinte invalide → Elixir", C.teintes("rouge"), C.teintes("#3c7782"));
  // teinte dominante : 24 × 24 pixels
  const pixels = (f) => { const d = new Uint8ClampedArray(24 * 24 * 4); for (let i = 0; i < 576; i++) { const [r, g, b, a] = f(i); d.set([r, g, b, a], i * 4); } return d; };
  eq("photo rose sur fond blanc → rose", C.teinteDePixels(pixels(i => (i % 3 ? [190, 24, 93, 255] : [255, 255, 255, 255]))), "#be185d");
  eq("photo transparente et grise → pas de couleur", C.teinteDePixels(pixels(i => (i % 2 ? [128, 128, 128, 255] : [200, 30, 30, 0]))), null);
  eq("dominante pondérée par la saturation", C.teinteDePixels(pixels(i => (i < 200 ? [30, 80, 200, 255] : i < 300 ? [200, 60, 60, 255] : [250, 250, 250, 255]))), "#1e50c8");
}

// ── 7. Compte à rebours : fin du prix seulement ; réserve au-delà de 5 ; photos réduites ──
{
  const promosDatees = PROMOS.map(p => (String(p.id) === CLARI ? { ...p, endDate: "2026-10-25" } : p));
  const conf = { items: [
    objet("produit", CIP.ventoline, "vitrine", { date_fin: "2026-10-21" }),                 // Stratège (menu permanent) : fin d'affichage seulement
    objet("menu", CLARI, "vitrine", { date_fin: "2026-10-22" }),                             // menu daté au 25 : affiché jusqu'au 22, prix jusqu'au 25
    objet("produit", CIP.culotte, "grille"),                                                 // produit du menu daté : prix jusqu'au 25
    objet("menu", VASELINE, "grille", { date_fin: "2026-10-31" }),                           // menu sans fin : aucun compte à rebours
  ] };
  const ved = S.evaluerVedettes(conf, null, ctxServeur(promosDatees), MIDI_20).publiques;
  eq("serveur : fin (affichage) et fin_offre (prix)", ved.items.map(i => [i.fin, i.fin_offre]),
    [["2026-10-21", null], ["2026-10-22", "2026-10-25"], ["2026-10-25", "2026-10-25"], ["2026-10-31", null]]);
  const p = C.construireMisesEnAvant(ved, ctxPage({ promos: promosDatees }));
  eq("navigateur : produit Stratège avec date de fin → aucun compte à rebours (finOffre nulle), retiré quand même le 22",
    [p.vitrine[0].fin, p.vitrine[0].finOffre, C.construireMisesEnAvant(ved, ctxPage({ promos: promosDatees, aujourdhui: "2026-10-22" })).vitrine[0].type], ["2026-10-21", null, "menu"]);
  eq("navigateur : menu daté → compte à rebours sur sa fin (25), affichage arrêté le 22", [p.vitrine[1].fin, p.vitrine[1].finOffre], ["2026-10-22", "2026-10-25"]);
  eq("navigateur : produit d'un menu daté → fin du menu ; menu sans fin → rien", [p.grille[0].finOffre, p.grille[1].finOffre], ["2026-10-25", null]);
  // réserve : le navigateur écarte une mise en avant (justificatif relu), la 6e de la grille prend sa place ; jamais plus de 5
  const six = { items: [CIP.ventoline, CIP.culotte, CIP.vaseline, CIP.dupixent, CIP.autre].map(c => objet("produit", c, "grille")).concat([objet("menu", SERINGUES, "grille"), objet("menu", CLARI, "grille")]) };
  const v6 = S.evaluerVedettes(six, null, ctxServeur(), MIDI_20);
  eq("serveur : 5 visibles + 2 en réserve envoyées, états « au-delà de 5 » gardés", [v6.publiques.items.length, v6.etats.filter(e => e.statut === "au_dela_de_5").length], [7, 2]);
  eq("navigateur : 5 tuiles au plus", C.construireMisesEnAvant(v6.publiques, ctxPage()).grille.length, 5);
  eq("navigateur : une tuile écartée (justificatif) → la réserve entre", C.construireMisesEnAvant(v6.publiques, ctxPage({ justifProducts: { [CIP.dupixent]: true } })).grille.map(e => e.cle),
    [`p:${CIP.ventoline}`, `p:${CIP.culotte}`, `p:${CIP.vaseline}`, `p:${CIP.autre}`, `m:${SERINGUES}`]);
  // photos : variante réduite chez les hébergeurs connus, sinon l'adresse telle quelle
  const shop = "https://cdn.shopify.com/s/files/1/0999/8050/9531/files/drb-culotte-v8-regulier-xxs.png?v=1791387621";
  eq("photo : banque d'images", C.photo("https://assets.medipim.fr/media/medium/ccca.png", "thumbnail"), "https://assets.medipim.fr/media/thumbnail/ccca.png");
  eq("photo : Shopify (width 200 / 480 / 960, version gardée)", ["thumbnail", "medium", "large"].map(t => C.photo(shop, t)), [`${shop}&width=200`, `${shop}&width=480`, `${shop}&width=960`]);
  eq("photo : boutique Shopify (/cdn/shop/)", C.photo("https://taminaonline.com/cdn/shop/files/284144.png?v=1731479991", "medium"), "https://taminaonline.com/cdn/shop/files/284144.png?v=1731479991&width=480");
  eq("photo : Open Beauty Facts (.200 / .400 / .full)", ["thumbnail", "medium", "large"].map(t => C.photo("https://images.openbeautyfacts.org/images/products/000/004/218/2627/front_nl.128.full.jpg", t).split("/").at(-1)),
    ["front_nl.128.200.jpg", "front_nl.128.400.jpg", "front_nl.128.full.jpg"]);
  eq("photo : autre hébergeur tel quel, sans srcset ; adresse vide", [C.photo("https://cdn.redcare-pharmacie.fr/images/BE0.jpg", "thumbnail"), C.photoReconnue("https://cdn.redcare-pharmacie.fr/images/BE0.jpg"),
    C.photoReconnue(shop), C.photo(null, "medium")], ["https://cdn.redcare-pharmacie.fr/images/BE0.jpg", false, true, null]);
}
// ── 8. GET : justificatifs lus en parallèle du contexte (pas un aller-retour Supabase de plus en série) ──
{
  const ordre = [];
  const sb = async (path) => {
    const t = path.split("?")[0];
    ordre.push(t);
    await new Promise(r => setTimeout(r, 5));
    if (t === "elixir_pharmacies") return [{ email: "compte@pharmacie-a.test" }];
    if (t === "ec_config") return [{ key: "accueil_vedettes", value: { items: [objet("produit", CIP.ventoline, "vitrine")] }, updated_at: "x" }];
    return [];
  };
  const r = await creerHandler({ sb, kvGet: async () => null, kvSet: async () => {}, rateLimit: () => null, verrou: async () => ({ occupe: true }),
    justifs: async () => { ordre.push("justifs"); return new Set(); }, maintenant: () => MIDI_20, odoo: async () => { throw new Error("Odoo interdit"); },
    verifierJeton: async () => ({ id: "a", email: "compte@pharmacie-a.test" }) })({ httpMethod: "GET", headers: { authorization: "Bearer x" }, queryStringParameters: {} });
  eq("GET : réponse 200", r.statusCode, 200);
  vrai(`GET : justificatifs demandés avant la fin du contexte (${ordre.join(" → ")})`, ordre.indexOf("justifs") >= 0 && ordre.indexOf("justifs") < ordre.indexOf("elixir_campaigns"));
}

// ── 9. Photo illisible = photo absente (incident du 20/10/2026 : stockage des photos privé) ──
{
  const DEVANT = "https://jwhbmnytrcrflavqtihj.supabase.co/storage/v1/object/public/elixir-images/products/accueil-menu-1792060000000-mvgg7ayo.jpg?v=1792486536000";
  const vaseline = PROMOS.find(x => String(x.id) === VASELINE), clari = PROMOS.find(x => String(x.id) === CLARI);
  const [pot50, pot250] = vaseline.products.map(p => p.image_url);
  const ill = (...u) => new Set(u);
  // la carte de devant de l'incident : en erreur, l'éventail est celui du menu sans carte de devant (jamais une carte blanche)
  eq("carte de devant illisible : éventail identique au cas sans photo choisie", C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill(DEVANT) }), C.resumeMenu(vaseline));
  eq("carte de devant lisible : en tête de l'éventail", C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill() }).cartes.map(c => c.url), [DEVANT, pot50, pot250]);
  eq("aucune carte vide de texte et sans photo", C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill(DEVANT, pot50, pot250) }).cartes.every(c => c.url || c.nom), true);
  eq("une photo du menu illisible : retirée, l'éventail se complète par une carte texte (jusqu'à 3)",
    C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill(DEVANT, pot50) }).cartes.map(c => c.url || `texte:${c.nom}`),
    [pot250, "texte:Vaseline Original Petroleum Jelly – pot 50 ml"]);
  eq("toutes illisibles : cartes texte, comme un menu sans photo", C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill(DEVANT, pot50, pot250) }).cartes.map(c => [c.url, c.pn]),
    [[null, 1.59], [null, 3.39]]);
  // photo du produit illisible, celle du catalogue du site lisible : elle prend la place
  const catAutre = { m: { products: [{ cip: vaseline.products[0].cip, image_url: "https://exemple.test/catalogue-pot50.jpg" }] } };
  eq("photo du menu illisible → photo du catalogue pour ce CIP", C.resumeMenu({ ...vaseline, products: [{ ...vaseline.products[0] }] }, { catalogue: catAutre, illisibles: ill(pot50) }).cartes.map(c => c.url),
    ["https://exemple.test/catalogue-pot50.jpg"]);
  eq("photo du catalogue illisible aussi → carte texte", C.resumeMenu({ ...vaseline, products: [{ ...vaseline.products[0] }] }, { catalogue: catAutre, illisibles: ill(pot50, "https://exemple.test/catalogue-pot50.jpg") }).cartes.map(c => c.url || "texte"),
    ["texte"]);
  // vitrine : menu mis en avant avec la carte de devant de l'incident
  const conf = { items: [objet("menu", VASELINE, "vitrine", { image: DEVANT, badge: "Exclusivité Elixir" }), objet("produit", CIP.ventoline, "grille", { image: DEVANT }), objet("menu", CLARI, "grille")] };
  const ved = S.evaluerVedettes(conf, null, ctxServeur(), MIDI_20).publiques;
  const sain = C.construireMisesEnAvant(ved, ctxPage()), casse = C.construireMisesEnAvant(ved, ctxPage({ illisibles: ill(DEVANT) }));
  const sansImage = C.construireMisesEnAvant({ ...ved, items: ved.items.map(i => ({ ...i, image: null })) }, ctxPage());
  eq("photo lisible : carte de devant en tête, halo sur elle", [sain.vitrine[0].menu.cartes[0].url, sain.vitrine[0].halo], [DEVANT, DEVANT]);
  eq("carte de devant illisible : vitrine identique au cas sans photo choisie (cartes, halo)", [casse.vitrine[0].menu.cartes, casse.vitrine[0].halo], [sansImage.vitrine[0].menu.cartes, sansImage.vitrine[0].halo]);
  eq("… halo sur la première photo lisible du menu", casse.vitrine[0].halo, pot50);
  eq("produit : photo choisie illisible → photo du catalogue (banque d'images)", [sain.grille[0].offre.image_url, casse.grille[0].offre.image_url, casse.grille[0].halo],
    [DEVANT, "https://assets.medipim.fr/media/medium/ccca.png", "https://assets.medipim.fr/media/medium/ccca.png"]);
  const plusRien = C.construireMisesEnAvant(ved, ctxPage({ illisibles: ill(DEVANT, "https://assets.medipim.fr/media/medium/ccca.png") }));
  eq("produit : photo du catalogue illisible aussi → boîte générée (aucune photo, aucun halo)", [plusRien.grille[0].offre.image_url, plusRien.grille[0].halo], [null, null]);
  eq("illisibles sans rapport : rien ne change", C.construireMisesEnAvant(ved, ctxPage({ illisibles: ill("https://x.test/autre.jpg") })), sain);
  eq("menu Claripharm intact", casse.grille[1].menu.cartes.map(c => c.url), clari.products.map(p => p.image_url));
  // plus commandés (resoudreOffre) : catalogue, puis photo du GET, puis photo choisie dans l'admin ; illisible = absente
  const o = { cip: CIP.dupixent, image_url: "https://x.test/get.jpg", menu: { key: "saisie" }, boite: {} };
  const ctxR = (illisibles) => ({ ...ctxPage({ photos: { [CIP.dupixent]: "https://x.test/admin.jpg" } }), illisibles });
  eq("plus commandés : photo du GET d'abord", C.resoudreOffre(o, ctxR(ill())).image_url, "https://x.test/get.jpg");
  eq("plus commandés : photo du GET illisible → photo choisie dans l'admin", C.resoudreOffre(o, ctxR(ill("https://x.test/get.jpg"))).image_url, "https://x.test/admin.jpg");
  eq("plus commandés : toutes illisibles → boîte générée", C.resoudreOffre(o, ctxR(ill("https://x.test/get.jpg", "https://x.test/admin.jpg"))).image_url, null);
  eq("plus commandés : photo du catalogue du site illisible → celle du GET", C.resoudreOffre({ cip: CIP.ventoline, image_url: "https://x.test/get.jpg", boite: {} },
    ctxR(ill("https://assets.medipim.fr/media/medium/ccca.png"))).image_url, "https://x.test/get.jpg");
  eq("plus commandés : catalogue pas chargé, photo du GET illisible → photo de l'admin", C.resoudreOffre(o, { ...ctxR(ill("https://x.test/get.jpg")), catalogueCharge: false }).image_url, "https://x.test/admin.jpg");
  eq("photoLisible", [C.photoLisible(DEVANT, ill(DEVANT)), C.photoLisible(DEVANT, ill()), C.photoLisible(DEVANT), C.photoLisible("", ill())], [null, DEVANT, DEVANT, null]);
  // photo lente : chaque carte photo a un texte, montré tant qu'elle charge (jamais une carte blanche)
  eq("carte de devant : le nom du menu comme texte d'attente", C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill() }).cartes[0].nom, C.titreMenu(vaseline));
  vrai("toutes les cartes photo ont un texte d'attente", C.resumeMenu(vaseline, { image: DEVANT, illisibles: ill() }).cartes.every(c => c.nom));
}

// ── 10. Taille réduite en erreur : l'original d'abord (jamais toute la photo retirée pour une miniature) ; préchargement ──
{
  C.reglerIllisibles({ Img: () => undefined, planifier: (f) => f() });   // aucun nouvel essai en arrière-plan ici
  // fausse <img> : currentSrc = taille demandée ; src remplacé → nouvelle demande de cette adresse
  const fausseImg = (demandee) => {
    const attrs = { src: demandee, srcset: `${demandee} 1x` };
    return { attrs, dataset: {}, currentSrc: demandee, getAttribute: (k) => attrs[k], removeAttribute: (k) => { delete attrs[k]; },
      get src() { return attrs.src; }, set src(v) { attrs.src = v; this.currentSrc = v; } };
  };
  const MED = "https://assets.medipim.fr/media/medium/spasfon.jpg";
  const vignette = fausseImg(C.photo(MED, "thumbnail"));
  eq("miniature en erreur : l'original demandé, srcset retiré, rien de noté", [C.surErreurPhoto(MED, { currentTarget: vignette }), vignette.attrs.src, "srcset" in vignette.attrs, C.estIllisible(MED)],
    [false, MED, false, false]);
  eq("l'original en erreur à son tour : notée (une seule bascule, aucune boucle)", [C.surErreurPhoto(MED, { currentTarget: vignette }), C.estIllisible(MED)], [true, true]);
  const L = "https://assets.medipim.fr/media/medium/ventoline.jpg", deuxX = fausseImg(C.photo(L, "large"));
  eq("2x « large » en erreur : la taille des données (medium) d'abord", [C.surErreurPhoto(L, { currentTarget: deuxX }), deuxX.attrs.src, C.estIllisible(L)], [false, L, false]);
  const STO = "https://jwhbmnytrcrflavqtihj.supabase.co/storage/v1/object/public/elixir-images/products/a.jpg?v=1";
  eq("photo sans taille réduite (stockage) : notée tout de suite", [C.surErreurPhoto(STO, { currentTarget: fausseImg(STO) }), C.estIllisible(STO)], [true, true]);
  // préchargement de l'offre suivante (vitrine cinéma) : taille demandée, puis l'original ; jamais noté hors ligne
  const demandes = [];
  const Img = (echoue) => class { set src(u) { demandes.push(u); setTimeout(() => (echoue(u) ? this.onerror?.() : this.onload?.()), 1); } };
  const attendre = () => new Promise(r => setTimeout(r, 15));
  const OBF = "https://images.openbeautyfacts.org/images/products/871/024/400/2627/front_nl.128.full.jpg";
  C.prechargerPhoto(OBF, "medium", Img(u => u.includes(".400.")));
  await attendre();
  eq("préchargement : .400 en erreur (502), l'original s'affiche → pas notée", [demandes, C.estIllisible(OBF)], [[OBF.replace(".full.", ".400."), OBF], false]);
  const KO = "https://images.openbeautyfacts.org/images/products/871/024/400/2658/front_fr.12.full.jpg";
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  C.prechargerPhoto(KO, "medium", Img(() => true));
  await attendre();
  eq("préchargement hors ligne : rien n'est noté (le réseau coupé n'est pas la photo)", C.estIllisible(KO), false);
  Object.defineProperty(globalThis, "navigator", nav);
  C.prechargerPhoto(KO, "medium", Img(() => true));
  await attendre();
  eq("préchargement en ligne, original en erreur aussi : notée (l'offre arrive sans elle)", C.estIllisible(KO), true);
  C.reglerIllisibles();
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
