// Tests des mises en avant « Un outil du site » (docs/accueil.md § 7.8) : node scripts/test-accueil-outils.mjs
// Hors ligne, sans navigateur ni réseau : Supabase, kv_store et Odoo simulés (dépendances injectées) ; le code du
// navigateur (src/components/accueil/rubriques.js, vedettes.js, vedettes-regles.js) est assemblé par esbuild (React
// remplacé par un module vide), comme scripts/test-vedettes.mjs. Données du 20/10/2026 simplifiées (aucune donnée client).
//  1. registre : même liste au serveur et au navigateur, incluse dans OUTILS_LIEN d'App.jsx, ni U-Labs ni l'accueil ;
//     FAUTEUILS = LINES ; textes par défaut dans les limites (titre 60, accroche 140 avec 9 labos, badge 24) ;
//  2. validation (serveur = navigateur) : outil valide, « Outil inconnu », cip et menu_id nuls, doublon, troncature ;
//  3. Péremption : fenêtre (UTC, aussi lancée avec TZ=Europe/Paris et TZ=UTC), bornes incluses ; règle du 21/10/2026 :
//     « dès » et « jusqu'à » sur les prix AFFICHÉS par la page (−50 %, −20 % dès 500 €, remise affichée de l'admin, 0 =
//     aucune, prix habituel plus bas, règle Odoo facturée), produits des menus compris (ligne à part au panier) ; 2 lectures
//     (6 colonnes du catalogue, expiry_discounts) ; vide / illisible / ancienne, mémoire de 5 min ;
//  4. fauteuils : correspondance du 20/10 (le 43 cm compte grâce au nouveau CIP), transfert, rupture, repli, fuite ;
//  5. justificatif : labo hors site écarté, médicaments = marques, vide, recalcul du navigateur identique ;
//  6. Saisie : sans comptes ou comptes anciens → visible, sans chiffres ;
//  7. Commandes groupées : selon la pharmacie (serveur), écartées sans accès ou sans opération ouverte, la réserve entre ;
//  8. outil masqué ; 9. ordre des statuts, outils programmés ou terminés non lus ;
// 10. GET : sans outil, mêmes lectures qu'avant ; Péremption seule ; outils_etat et remises_facturees réservés à l'admin ; aucune
//     écriture ; une lecture en échec n'écarte que son outil ;
// 11. fonction planifiée : écriture d'accueil:outils, Odoo en panne, échecs indépendants du classement ;
// 12. navigateur : bouton, teinte, compositions, médaillon (« jusqu'à −50 % » de la Péremption), titre « Péremption
//     courte, petits prix », badge « Petits prix » (retiré seulement sans remise affichée), texte lu, type inconnu ignoré ;
// 13. correctifs de la revue : kv illisible (fauteuils : jamais le repli), correspondance signalée à l'admin, sections
//     ajoutées dans l'admin (sans effet au lot 0), valeur précédente illisible (fonction planifiée), lecture lente (délai),
//     ?verifier= sans lecture d'outil, admin : outil masqué lu quand même, lj:config lue une fois, date de mise à jour
//     des comptes, typographie (insécables), accord outilsAEvaluer / evaluerVedettes (propriété).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
process.env.ODOO_URL = "https://odoo.test";
globalThis.fetch = async (url) => { throw new Error(`réseau interdit dans les tests : ${url}`); };

const RACINE = new URL("..", import.meta.url).pathname;
const sortie = await build({
  stdin: { contents: 'export * from "./src/components/accueil/rubriques.js"; export * from "./src/components/accueil/vedettes.js"; export * from "./src/components/accueil/vedettes-regles.js";', resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false, loader: { ".jsx": "jsx", ".js": "jsx" }, jsx: "transform", logLevel: "silent",
  plugins: [{ name: "sans-react", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "vide" }));
    b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: "export default {}; export const useEffect = () => {}; export const useState = (v) => [v, () => {}];", loader: "js" }));
  } }],
});
const dossier = mkdtempSync(join(tmpdir(), "test-outils-"));
writeFileSync(join(dossier, "c.mjs"), sortie.outputFiles[0].text);
const C = await import(pathToFileURL(join(dossier, "c.mjs")).href);
rmSync(dossier, { recursive: true, force: true });
const O = await import("../netlify/functions/_accueil-outils.js");
const V = await import("../netlify/functions/_accueil-vedettes.js");
const { contexteMenus } = await import("../netlify/functions/_accueil-selection.js");
const { creerSources } = await import("../netlify/functions/_accueil-donnees.js");
const { creerHandler } = await import("../netlify/functions/accueil-offres.js");
const { creerHandler: creerRefresh } = await import("../netlify/functions/accueil-offres-refresh.js");
const { LINES } = await import("../src/wheelchair-logic.js");

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);
const esp = (s) => String(s ?? "").replace(/[  ]/g, " ");   // espaces insécables → espaces (comparaison des textes)
const MAINTENANT = Date.parse("2026-10-20T09:00:00Z");                 // 20/10/2026, 11 h à Paris
let n = 0;
const objet = (type, cle, emplacement, extra = {}) => ({ id: `mea_outil_${String(++n).padStart(3, "0")}`, type, cip: type === "produit" ? cle : null, menu_id: type === "menu" ? cle : null,
  ...(type === "outil" ? { outil: cle } : {}), emplacement, titre: "", accroche: "", badge: "", date_debut: null, date_fin: null, ordre: n * 10, image: null, couleur: null,
  couleur_auto: null, actif: true, maj: "2026-10-20T05:00:00.000Z", ...extra });

// ── données du 20/10/2026 (simplifiées) ──
const MAJ = "2026-10-20T06:38:26.232Z";
const ligne = (cip, list_price, discounted_price, discount_pct, earliest_expiry, extra = {}) => ({ cip, list_price, discounted_price, discount_pct, earliest_expiry, updated_at: MAJ, ...extra });
// lignes du catalogue telles que la base les a (règle du 21/10/2026 : la carte lit de nouveau les prix et les remises affichées
// de l'admin, comme avant le 20/10 ; les produits des menus comptent aussi, leur ajout depuis la page étant une ligne à part)
const PER = [
  ligne("3400930000101", 0.875, 0.83, 5.1, "2026-11-19"),   // borne basse incluse : −50 % → « dès 0,44 € »
  ligne("3400930000102", 2000, 1910, 4.5, "2027-02-28"),     // borne haute incluse : −20 % dès 500 € → 1 600 €
  ligne("3400930000103", 499.99, 477.49, 4.5, "2027-01-15"), // 499,99 € : −50 % → 250 €
  ligne("3400930000104", 19.52, 18.64, 4.5, "2027-01-20"),   // rangé dans la Centrale OTC (curaté) : compte (ligne à part au panier)
  ligne("3400930000105", 4, 3.82, 4.5, "2027-01-21"),        // dans un menu promo actif : compte aussi
  ligne("3400930000106", 6, 2.99, 50.2, "2027-02-01"),       // FFP2 : prix habituel (2,99 €) sous 6 × 0,5 → aucune remise affichée
  ligne("3400930000107", 10, 9.55, 4.5, "2027-02-02"),       // remise affichée de l'admin (30 %, expiry_discounts) : 7 €
  ligne("3400930000108", 10, 9.55, 4.5, "2027-02-03"),
  ligne("3400930000109", 8, 7.64, 4.5, "2027-02-04"),        // produit d'une campagne active
  ligne("3400930000110", 8, 7.64, 4.5, "2026-11-18"),        // hors fenêtre (J+29)
  ligne("3400930000111", 8, 7.64, 4.5, "2027-03-01"),        // hors fenêtre (au-delà du 4e mois)
];
const CUREES = [{ cip: "3400930000104", section: "otc" }, { cip: "3400930000109", section: "camp1" }];
const PROMOS = [{ id: 1792060000000, name: "Précommande Vaseline", active: true, endDate: "", sansStock: true, products: [{ cip: "3400930000105", name: "X", pn: 2, pv: 4 }] },
  { id: 1792040000000, name: "Culottes Claripharm", active: true, endDate: "", color: "#be185d", products: [{ cip: "3701271303933", name: "Culotte", pn: 12.96, pv: 14.4, pct: "-10%" }] }];
const DISPLAY = { hiddenTabs: ["ulabs"] };
const MENUS = contexteMenus({ displayConfig: DISPLAY, promos: PROMOS, campagnes: [{ id: "camp1", active: true }] });
// fauteuils : correspondance (code fournisseur → CIP, plus ancien d'abord) et lignes du catalogue relevées le 20/10
const CORRESPONDANCE = { BR1538205: ["3662050045614", "3662050045577"], BR1538206: ["3662050045638", "3662050045584"], BR1538207: ["3662050045652", "3662050045591"],
  BR1538212: ["3662050045676"], BR1685838: ["3662050469175"], BR1685839: ["3662050469182"] };
const fcat = (cip, list_price, discounted_price, in_stock) => ({ cip, list_price, discounted_price, discount_pct: 4.5, in_stock });
const FAUT_CAT = [fcat("3662050045614", 220, 210.08, true), fcat("3662050045577", 220, 210.08, true), fcat("3662050045638", 220, 210.08, false), fcat("3662050045584", 220, 210.08, true),
  fcat("3662050045652", 220, 210.08, false), fcat("3662050045591", 220, 210.08, true), fcat("3662050045676", 220, 210.08, true), fcat("3662050469175", 188, 179.52, true), fcat("3662050469182", 184, 175.7, true)];
const parCip = (rows) => Object.fromEntries(rows.map(r => [r.cip, r]));
const COMPTES = { references: 27871, en_stock: 4526, maj: "2026-10-20T06:38:46.916+00:00" };
// laboratoires sur justificatif (configuration lj:config simplifiée)
const P = (cip, nom, court) => ({ cip, nom, court });
const CONFIG_LJ = { labs: {
  takeda: { key: "takeda", nom: "Takeda", produits: [P("1", "NINLARO 2,3 mg", "Ninlaro"), P("2", "NINLARO 3 mg", "Ninlaro"), P("3", "NINLARO 4 mg", "Ninlaro"), P("4", "ALUNBRIG 30 mg", "Alunbrig"),
    P("5", "ALUNBRIG 90 mg", "Alunbrig"), P("6", "ALUNBRIG 180 mg", "Alunbrig"), P("7", "ALUNBRIG kit", "Alunbrig"), P("8", "ELAPRASE", "Elaprase"), P("9", "LIVTENCITY", "Livtencity")] },
  pfizer: { key: "pfizer", nom: "Pfizer", produits: [P("10", "LORVIQUA 25 mg", "Lorviqua 25 mg"), P("11", "LORVIQUA 100 mg", "Lorviqua 100 mg"), P("12", "SOMAVERT 10 mg", "Somavert 10 mg"),
    P("13", "SOMAVERT 15 mg", "Somavert 15 mg"), P("14", "SOMAVERT 20 mg", "Somavert 20 mg"), P("15", "SOMAVERT 25 mg", "Somavert 25 mg"), P("16", "SOMAVERT 30 mg", "Somavert 30 mg"),
    P("17", "SOMAVERT 30 mg bis", "Somavert")] },
  sanofi: { key: "sanofi", nom: "Sanofi", site: false, produits: [P("18", "PRODUIT HORS SITE", "Hors")] },
} };
const JUSTIF_PRODUITS = Object.fromEntries(Object.values(CONFIG_LJ.labs).filter(l => l.site !== false)
  .flatMap(l => l.produits.map(p => [p.cip, { lab: l.key, labNom: l.nom, nom: p.nom, court: p.court }])));

// ── 1. Registre ──
{
  eq("liste des outils : serveur = navigateur", O.OUTILS_MEA, C.OUTILS_MEA);
  const app = readFileSync(join(RACINE, "src/App.jsx"), "utf8");
  const lien = JSON.parse(`[${(app.match(/^const OUTILS_LIEN = \[(.*)\];$/m) || [])[1] || ""}]`);
  vrai(`outils mis en avant ⊆ OUTILS_LIEN (${lien.join(", ")})`, lien.length && C.OUTILS_MEA.every(k => lien.includes(k)));
  eq("ni U-Labs ni l'accueil", ["ulabs", "accueil", "assistant"].filter(k => C.OUTILS_MEA.includes(k)), []);
  eq("registre complet, dans l'ordre", Object.keys(C.OUTILS), C.OUTILS_MEA);
  vrai("outils exclus des « Accès rapides »", C.OUTILS_MEA.every(k => C.RUBRIQUES_HORS_CATALOGUE.includes(k)));
  for (const k of ["fauteuil", "transfert"]) eq(`FAUTEUILS.${k} = LINES (tailles, codes, repli, modèle)`, O.FAUTEUILS[k],
    { model: LINES[k].model, sizes: LINES[k].sizes, codes: LINES[k].codes, fallback: LINES[k].fallback });
  const neufLabos = { labos: Array.from({ length: 9 }, (_, i) => ({ nom: ["Takeda", "Pfizer", "Boehringer Ingelheim", "Sanofi", "Novartis", "Roche", "AstraZeneca", "Bristol-Myers Squibb", "Janssen"][i], medicaments: 1 })) };
  const trop = Object.entries(C.OUTILS).flatMap(([k, d]) => [[k, "titre", d.titre, 60], [k, "badge", d.badge, 24], [k, "accroche", d.accroche(null), 140], [k, "accroche 9 labos", d.accroche(neufLabos), 140]])
    .filter(([, , t, max]) => !t || t.length > max).map(([k, c]) => `${k}.${c}`);
  eq("textes par défaut dans les limites (titre 60, accroche 140 avec 9 labos, badge 24)", trop, []);
  eq("accroches calculées : labos, modèle et tailles", [C.OUTILS.justificatif.accroche({ labos: [{ nom: "Takeda" }, { nom: "Pfizer" }] }).split(" : ")[0],
    C.OUTILS.justificatif.accroche({ labos: [{ nom: "A" }, { nom: "B" }, { nom: "C" }] }).split(" : ")[0], C.OUTILS.justificatif.accroche(neufLabos).split(" : ")[0],
    C.OUTILS.transfert.accroche().split(" : ")[0], C.OUTILS.fauteuil.accroche().split(" : ")[0]],
    ["Takeda et Pfizer", "A, B et C", "Takeda, Pfizer et 7 autres laboratoires", "Invacare Transit Lite, en 43 ou 45,5 cm", "Invacare Action 2NG"]);
  vrai("jamais « temps réel » dans les textes par défaut", !/temps r[ée]el/i.test(JSON.stringify(Object.values(C.OUTILS).map(d => [d.titre, d.accroche(null), d.badge]))));
}

// ── 2. Validation : serveur = navigateur ──
{
  const valeur = { items: [objet("outil", "peremption", "vitrine", { cip: "3400930000101", menu_id: "x" }), objet("outil", "ulabs", "grille"), objet("outil", "assistant", "grille"),
    objet("outil", "peremption", "grille"), objet("outil", "saisie", "grille", { titre: "x".repeat(61) }), objet("produit", "3400934438738", "grille")] };
  const s = V.validerVedettes(valeur), c = C.validerVedettes(valeur);
  eq("validation : serveur et navigateur identiques", JSON.stringify(c), JSON.stringify(s));
  eq("outil valide : cip et menu_id mis à null", [s.conf.items[0].type, s.conf.items[0].outil, s.conf.items[0].cip, s.conf.items[0].menu_id], ["outil", "peremption", null, null]);
  eq("objets gardés : péremption (vitrine), saisie, produit", s.conf.items.map(i => i.outil || i.cip), ["peremption", "saisie", "3400934438738"]);
  eq("« Outil inconnu » (U-Labs, assistant) et doublon", s.ignores.map(x => x.erreurs.map(e => e.message).join()), ["Outil inconnu", "Outil inconnu", "Déjà mis en avant"]);
  eq("titre tronqué à 60 au serveur", s.conf.items[1].titre.length, 60);
  const e = C.erreursBrouillon(valeur);
  eq("éditeur : outil inconnu bloquant, doublon « en vitrine », titre trop long", [...new Set(e.map(x => x.message))], ["Outil inconnu", "Déjà mis en avant en vitrine", "60 caractères au plus"]);
  eq("éditeur : brouillon correct", C.erreursBrouillon({ items: [objet("outil", "fauteuil", "vitrine"), objet("outil", "transfert", "grille")] }), []);
}

// ── 3. Péremption ──
const REMISES_ADMIN = [{ cip: "3400930000107", discount_pct: 30 }];
const sbPeremption = (compte, { echec = false, remises = REMISES_ADMIN } = {}) => async (path) => {
  compte.push(path.split("?")[0]);
  if (echec) throw new Error("Supabase en panne");
  if (path.startsWith("odoo_catalog?select=cip,list_price,discounted_price,discount_pct,earliest_expiry,updated_at&")) return PER;
  if (path === "expiry_discounts?select=cip,discount_pct") return remises;
  throw new Error(`lecture inattendue ${path}`);   // ni elixir_products ni lots ni stock
};
{
  eq("fenêtre au 20/10/2026 11 h : J+30 → dernier jour du 4e mois (UTC)", O.fenetrePeremption(MAINTENANT), { min: "2026-11-19", max: "2027-02-28" });
  const code = `import("${pathToFileURL(join(RACINE, "netlify/functions/_accueil-outils.js")).href}").then(m => process.stdout.write(JSON.stringify([m.fenetrePeremption(${MAINTENANT}), m.fenetrePeremption(${Date.parse("2026-10-31T23:30:00Z")})])))`;
  const fuseaux = ["Europe/Paris", "UTC"].map(TZ => execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TZ }, encoding: "utf8" }));
  eq("fenêtre identique avec TZ=Europe/Paris et TZ=UTC (et le 31/10 à 23 h 30 UTC : encore octobre en UTC, comme Netlify)", fuseaux[0], fuseaux[1]);
  eq("… valeurs", JSON.parse(fuseaux[1]), [{ min: "2026-11-19", max: "2027-02-28" }, { min: "2026-11-30", max: "2027-02-28" }]);
  eq("règle du 21/10/2026 : « jusqu'à » rapporté au prix de base barré de la page (REMISE_REFERENCE « page ») ; remise calculée par le code de la page (src/peremption-panier.js), pas de copie",
    [O.REMISE_REFERENCE, ["remisePeremption", "prixPeremption"].filter(k => k in O)], ["page", []]);
  O.oublierMemo();
  const lus = [];
  const src = { sb: sbPeremption(lus), maintenant: () => MAINTENANT };
  const lecture = await O.lirePeremption(src);
  const ev = O.evaluerOutil("peremption", { outils: { peremption: lecture }, menus: MENUS }, MAINTENANT);
  eq("bornes incluses, hors fenêtre exclus : nb compte tout le reste", ev.chiffres.nb, 9);
  eq("« dès » = plus bas prix affiché (0,875 × 0,5 = 0,44 €) ; « jusqu'à −50 % » (comme avant le 20/10/2026)", [ev.chiffres.des, ev.chiffres.jusqua], [0.44, 50]);
  eq("mois et mise à jour", [ev.chiffres.mois, ev.chiffres.maj], [["2026-11", "2027-02"], MAJ]);
  eq("admin : 8 produits remisés sur la page (FFP2 au prix habituel), aucun facturé par Odoo", ev.admin, { remises_affichees: 8, remises_facturees: 0 });
  eq("champ public : nb, des, jusqua, mois, maj seulement", Object.keys(ev.chiffres), ["nb", "des", "jusqua", "mois", "maj"]);
  vrai("aucun CIP, stock ni lot dans les chiffres publics", !/\d{13}|available|lot|in_stock/.test(JSON.stringify(ev.chiffres)));
  eq("lectures : le catalogue et les remises affichées (ni produits curatés, ni lots)", lus, ["odoo_catalog", "expiry_discounts"]);
  const chemin = [];
  O.oublierMemo();
  await O.lirePeremption({ sb: async (p) => { chemin.push(p); return p.startsWith("odoo_catalog") ? PER : []; }, maintenant: () => MAINTENANT });
  eq("lecture : 6 colonnes (prix, péremption ; ni lots, ni stock), fenêtre de la page ; remises de l'admin", chemin,
    ["odoo_catalog?select=cip,list_price,discounted_price,discount_pct,earliest_expiry,updated_at&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=gte.2026-11-19&earliest_expiry=lte.2027-02-28&order=earliest_expiry.asc&limit=1000",
      "expiry_discounts?select=cip,discount_pct"]);
  // remises affichées de l'admin : 0 = aucune (le produit ne compte plus) ; remise propre au produit (30 % : 7 €)
  O.oublierMemo();
  const seule = await O.lirePeremption({ sb: sbPeremption([], { remises: [{ cip: "3400930000101", discount_pct: 0 }, { cip: "3400930000102", discount_pct: 10 }] }), maintenant: () => MAINTENANT });
  const sans101 = O.evaluerOutil("peremption", { outils: { peremption: seule }, menus: MENUS }, MAINTENANT);
  eq("admin à 0 % sur le moins cher : « dès » suivant (2 € = 4 × 0,5) ; −10 % de l'admin sur 2 000 € → 1 800 € (pas −20 %)",
    [sans101.chiffres.des, sans101.chiffres.jusqua, seule.rows.find(r => r.cip === "3400930000102").prix], [2, 50, 1800]);
  O.oublierMemo();
  const aucun = O.evaluerOutil("peremption", { outils: { peremption: { ...lecture, rows: lecture.rows.filter(r => r.cip === "3400930000106") } }, menus: MENUS }, MAINTENANT);
  eq("un seul produit sans remise affichée (FFP2, prix habituel plus bas) : visible, sans « dès » ni médaillon", [aucun.raisons, aucun.chiffres.nb, aucun.chiffres.des, aucun.chiffres.jusqua], [[], 1, null, null]);
  eq("liste vide → outil_vide", O.evaluerOutil("peremption", { outils: { peremption: { ...lecture, rows: [] } }, menus: MENUS }, MAINTENANT).raisons, ["outil_vide"]);
  eq("lecture en échec → donnees_indisponibles", O.evaluerOutil("peremption", { outils: { peremption: { erreur: "panne" } }, menus: MENUS }, MAINTENANT).raisons, ["donnees_indisponibles"]);
  const vieux = { ...lecture, rows: lecture.rows.map(r => ({ ...r, updated_at: "2026-10-18T20:00:00Z" })) };
  eq("mise à jour de plus de 36 h → donnees_anciennes", O.evaluerOutil("peremption", { outils: { peremption: vieux }, menus: MENUS }, MAINTENANT).raisons, ["donnees_anciennes"]);
  // mémoire de 5 min, clé : jour de Paris et fenêtre
  O.oublierMemo();
  const c2 = [], t = { v: MAINTENANT };
  const s2 = { sb: sbPeremption(c2), maintenant: () => t.v };
  const lectures = () => c2.filter(x => x === "odoo_catalog").length;
  await O.lirePeremption(s2); t.v += 4 * 60e3; await O.lirePeremption(s2);
  eq("2 appels en moins de 5 min → 1 lecture", lectures(), 1);
  t.v = MAINTENANT + 5 * 60e3 + 1000; await O.lirePeremption(s2);
  eq("à 5 min 01 s → 2 lectures", lectures(), 2);
  t.v = Date.parse("2026-10-20T22:00:30Z"); await O.lirePeremption(s2);   // minuit passé à Paris
  t.v += 60e3; await O.lirePeremption(s2);
  eq("changement de jour → nouvelle lecture (puis gardée)", lectures(), 3);
  O.oublierMemo();
  await O.lirePeremption({ sb: sbPeremption([], { echec: true }), maintenant: () => MAINTENANT }).catch(() => null);
  const apresEchec = [];
  await O.lirePeremption({ sb: sbPeremption(apresEchec), maintenant: () => MAINTENANT });
  eq("lecture en échec : jamais gardée en mémoire", apresEchec.includes("odoo_catalog"), true);
  O.oublierMemo();
}
// ── 3 bis. Péremption en ligne : page des pharmacies (etatPublic) — remise de l'admin et règle Odoo facturée (V1) par produit ──
{
  O.oublierMemo();
  const page = { seuil_annonce_pct: 5, produits: PER.filter(r => r.cip !== "3400930000110" && r.cip !== "3400930000111")
    .map(r => ({ ...r, remise_admin: r.cip === "3400930000107" ? 30 : null, prix_base: r.list_price, cout: 1 })) };
  // règle facturée : discounted_price = prix facturé (prix du site repris), prix habituel figé à la décision
  const fact = (cip, prix, remise, habituel) => Object.assign(page.produits.find(p => p.cip === cip), { facturee: true, discounted_price: prix, discount_pct: 50, prix, remise_pct: remise, prix_habituel: habituel });
  fact("3400930000108", 5, 50, 9.55);       // facturée : −50 % sur le prix de base, 5 € contre 9,55 € habituels
  fact("3400930000103", 455, 9, 477.49);    // facturée, économie de 4,7 % < seuil de 5 % : pas annoncée
  fact("3400930000104", 15.6, 20, 18.64);   // facturée : 15,60 € contre 18,64 €
  let appels = 0;
  const src = { sb: async () => { throw new Error("en ligne : le catalogue n'est pas relu directement"); }, peremption: async () => { appels++; return page; }, maintenant: () => MAINTENANT };
  const lecture = await O.lirePeremption(src);
  const ev = O.evaluerOutil("peremption", { outils: { peremption: lecture }, menus: MENUS }, MAINTENANT);
  eq("en ligne : nb = produits de la page ; « dès » = plus bas prix affiché ; « jusqu'à » = plus forte remise affichée ; dont 2 facturées par Odoo",
    [ev.chiffres.nb, ev.chiffres.des, ev.chiffres.jusqua, ev.admin], [9, 0.44, 50, { remises_affichees: 7, remises_facturees: 2 }]);
  eq("en ligne : remise facturée (Odoo) prioritaire sur le −50 % par défaut ; remise de l'admin (30 %)", ["3400930000104", "3400930000107", "3400930000103"].map(c => { const r = lecture.rows.find(x => x.cip === c); return [r.prix, r.remise, r.facture_odoo]; }),
    [[15.6, 20, true], [7, 30, false], [455, 9, true]]);
  eq("en ligne : champs publics inchangés, sans CIP, coût ni prix habituel", [Object.keys(ev.chiffres), /\d{13}|cout|habituel|prix_base/.test(JSON.stringify(ev.chiffres))], [["nb", "des", "jusqua", "mois", "maj"], false]);
  vrai("en ligne : la lecture ne garde que les champs de la carte (ni coût ni prix de base)", lecture.rows.every(r => !("cout" in r) && !("prix_base" in r)));
  await O.lirePeremption(src);
  eq("en ligne : lecture gardée 5 min", appels, 1);
  O.oublierMemo();
  const toutAZero = { ...page, produits: page.produits.map(({ facturee, prix, remise_pct, prix_habituel, ...r }) => ({ ...r, remise_admin: 0 })) };   // eslint-disable-line no-unused-vars
  const ev2 = O.evaluerOutil("peremption", { outils: { peremption: await O.lirePeremption({ ...src, peremption: async () => toutAZero }) }, menus: MENUS }, MAINTENANT);
  eq("toutes les remises affichées à 0 par l'admin, aucune facturée : ni « dès » ni « jusqu'à »", [ev2.chiffres.nb, ev2.chiffres.des, ev2.chiffres.jusqua, ev2.admin], [9, null, null, { remises_affichees: 0, remises_facturees: 0 }]);
  O.oublierMemo();
  const D = await import(pathToFileURL(join(RACINE, "netlify/functions/_accueil-donnees.js")).href);
  eq("sources : en ligne (sans sb injecté), la carte lit la page des pharmacies (etatPublic) ; tests et banc (sb injecté) : lecture directe",
    [typeof D.creerSources({}).peremption, D.creerSources({ sb: async () => [] }).peremption], ["function", null]);
}

// ── 4. Fauteuils ──
{
  const ctx = (plan, rows = FAUT_CAT) => ({ outils: { plan, fauteuilsCat: { parCip: parCip(rows) } }, menus: MENUS });
  const f = O.evaluerOutil("fauteuil", ctx({ fauteuils: CORRESPONDANCE }), MAINTENANT);
  eq("Action 2NG au 20/10 : 4 largeurs (le 43 cm par le nouveau CIP), 210,08 €", f.chiffres, { tailles: ["40,5 cm", "43 cm", "45,5 cm", "48 cm"], des: 210.08, a: 210.08, modele: "Invacare Action 2NG" });
  const tr = O.evaluerOutil("transfert", ctx({ fauteuils: CORRESPONDANCE }), MAINTENANT);
  eq("Transit Lite : dès 175,70, jusqu'à 179,52", [tr.chiffres.tailles, tr.chiffres.des, tr.chiffres.a], [["43 cm", "45,5 cm"], 175.7, 179.52]);
  eq("toutes les tailles à 0 → rupture", O.evaluerOutil("transfert", ctx({ fauteuils: CORRESPONDANCE }, FAUT_CAT.map(r => ({ ...r, in_stock: false }))), MAINTENANT).raisons, ["rupture"]);
  eq("sans correspondance (avant le 1er passage) → CIP de repli : 2 largeurs", O.evaluerOutil("fauteuil", ctx(null), MAINTENANT).chiffres.tailles, ["40,5 cm", "48 cm"]);
  eq("CIP à relire : correspondance et repli (9 + 0, sans doublon)", O.cipsFauteuils(["fauteuil", "transfert"], { fauteuils: CORRESPONDANCE }).length, 9);
  vrai("aucun available ni CIP dans les chiffres publics", !/available|\d{13}/.test(JSON.stringify([f.chiffres, tr.chiffres])));
  eq("lecture en échec → donnees_indisponibles", O.evaluerOutil("fauteuil", { outils: { fauteuilsCat: { erreur: "x" } } }, MAINTENANT).raisons, ["donnees_indisponibles"]);
}

// ── 5. Justificatif ──
{
  const labos = O.labosDeConfig(CONFIG_LJ);
  eq("labo hors site (site: false) écarté ; médicaments = marques distinctes", labos, [{ nom: "Takeda", medicaments: 4, presentations: 9 }, { nom: "Pfizer", medicaments: 2, presentations: 8 }]);
  const ev = O.evaluerOutil("justificatif", { outils: { labos } }, MAINTENANT);
  eq("6 médicaments, 17 présentations, 2 labos", ev.chiffres, { labos: [{ nom: "Takeda", medicaments: 4 }, { nom: "Pfizer", medicaments: 2 }], medicaments: 6, presentations: 17 });
  eq("aucun produit → outil_vide", O.evaluerOutil("justificatif", { outils: { labos: [] } }, MAINTENANT).raisons, ["outil_vide"]);
  eq("navigateur : recalcul depuis justifProducts identique au serveur", C.chiffresJustif(JUSTIF_PRODUITS), ev.chiffres);
  eq("navigateur : liste vide → rien (pas encore chargée)", C.chiffresJustif({}), null);
}

// ── 6. Saisie ──
{
  const sans = O.evaluerOutil("saisie", { outils: { plan: null } }, MAINTENANT);
  eq("sans accueil:outils → visible, sans chiffres (admin : comptes absents)", [sans.raisons, sans.chiffres, sans.admin.comptes], [[], null, "absents"]);
  const vieux = O.evaluerOutil("saisie", { outils: { plan: { saisie: { ...COMPTES, maj: "2026-10-18T20:00:00Z" } } } }, MAINTENANT);
  eq("comptes de plus de 36 h → visible, sans chiffres (admin : anciens, 37 h)", [vieux.raisons, vieux.chiffres, vieux.admin], [[], null, { comptes: "anciens", age_h: 37 }]);
  eq("kv illisible → texte seul (admin : illisibles)", O.evaluerOutil("saisie", { outils: { plan: { erreur: "panne" } } }, MAINTENANT).admin.comptes, "illisibles");
  eq("comptes récents → chiffres", O.evaluerOutil("saisie", { outils: { plan: { saisie: COMPTES } } }, MAINTENANT).chiffres, COMPTES);
}

// ── 7-9. Commandes groupées, outil masqué, statuts ──
const ctxPage = (extra = {}) => ({ catalogue: { saisie: { label: "Saisie de commande", accent: "#2d9cbc", products: [] }, peremption: { label: "Péremption courte", accent: "#ea580c" },
  fauteuil: { label: "Fauteuil roulant", accent: "#3b82f6" }, transfert: { label: "Fauteuil de transfert", accent: "#3b82f6" },
  justificatif: { label: "📑 Commande labo sur justificatif", accent: "#7c3aed" }, groupees: { label: "Commandes groupées", accent: "#2d9cbc" } },
  catalogueCharge: true, stockData: {}, justifProducts: {}, menuOuvrable: () => true, regleSaisie: () => null, estCampagne: () => false, photos: {},
  teinte: () => "#2d9cbc", promos: PROMOS, aujourdhui: "2026-10-20", illisibles: new Set(), gp: { autorise: true, ouvertes: 2 }, ...extra });
const OUTILS_LUS = { plan: { saisie: COMPTES, fauteuils: CORRESPONDANCE }, fauteuilsCat: { parCip: parCip(FAUT_CAT) }, labos: O.labosDeConfig(CONFIG_LJ) };
{
  O.oublierMemo();
  const peremption = await O.lirePeremption({ sb: sbPeremption([]), maintenant: () => MAINTENANT });
  const ctxS = { catalogue: {}, curees: [], promos: PROMOS, justifs: new Set(), menus: MENUS, outils: { ...OUTILS_LUS, peremption } };
  const conf = { items: [objet("outil", "groupees", "vitrine"), objet("outil", "peremption", "vitrine", { date_fin: "2026-10-31" }), objet("outil", "fauteuil", "vitrine"),
    objet("outil", "saisie", "vitrine"), objet("outil", "justificatif", "vitrine"), objet("outil", "transfert", "vitrine")] };
  const r = V.evaluerVedettes(conf, null, ctxS, MAINTENANT);
  eq("serveur : groupées visibles « selon la pharmacie »", r.etats[0], { id: conf.items[0].id, statut: "visible", selon_pharmacie: true });
  eq("serveur : 5 visibles + la 6e en réserve", r.etats.map(e => e.statut), ["visible", "visible", "visible", "visible", "visible", "au_dela_de_5"]);
  eq("objet public d'un outil", Object.keys(r.publiques.items[1]), ["id", "type", "outil", "emplacement", "titre", "accroche", "badge", "fin", "fin_offre", "image", "couleur", "couleur_auto", "chiffres"]);
  eq("fin = date de fin ; jamais de fin d'offre", [r.publiques.items[1].fin, r.publiques.items[1].fin_offre], ["2026-10-31", null]);
  vrai("remises_affichees / remises_facturees (admin) absents de la réponse publique", !/remises_facturees|remises_affichees|en_menu|honnetes/.test(JSON.stringify(r.publiques)));
  // navigateur : groupées écartées sans accès, en reconnexion, en saisie Elixir (App : autorise faux) ou sans opération ouverte
  const vitrine = (gp) => C.construireMisesEnAvant(r.publiques, ctxPage({ gp })).vitrine.map(e => e.cle);
  eq("pharmacie inscrite, 2 opérations : groupées en 1re place", vitrine({ autorise: true, ouvertes: 2 })[0], "o:groupees");
  for (const [label, gp] of [["sans accès", { autorise: false, ouvertes: 2 }], ["reconnexion", { autorise: "reconnexion", ouvertes: null }], ["saisie Elixir", { autorise: false, ouvertes: 3 }], ["aucune opération ouverte", { autorise: true, ouvertes: 0 }]])
    eq(`groupées écartées (${label}), la réserve n° 6 entre`, vitrine(gp), ["o:peremption", "o:fauteuil", "o:saisie", "o:justificatif", "o:transfert"]);
  // outil masqué dans le menu (hiddenTabs)
  const caches = contexteMenus({ displayConfig: { hiddenTabs: ["peremption"] }, promos: PROMOS });
  eq("serveur : outil masqué → outil_masque", V.evaluerVedettes({ items: [objet("outil", "peremption", "vitrine")] }, null, { ...ctxS, menus: caches }, MAINTENANT).etats[0].statut, "outil_masque");
  eq("navigateur : rubrique non ouvrable → écarté", C.construireMisesEnAvant(r.publiques, ctxPage({ menuOuvrable: (k) => k !== "fauteuil" })).vitrine.map(e => e.cle).includes("o:fauteuil"), false);
  const rienLu = await O.lireOutils({ sb: async () => { throw new Error("rien à lire"); }, kvGet: async () => { throw new Error("rien"); }, maintenant: () => MAINTENANT },
    ["peremption"], { displayConfig: { hiddenTabs: ["peremption"] } });
  eq("lireOutils : outil masqué, rien n'est lu", [rienLu.plan, rienLu.fauteuilsCat, rienLu.peremption, rienLu.labos].filter(Boolean).length, 0);
  // ordre des statuts : masquée, programmée, terminée passent avant le motif de l'outil ; non demandés à lireOutils
  const dates = { items: [objet("outil", "peremption", "grille", { actif: false }), objet("outil", "fauteuil", "grille", { date_debut: "2026-10-21" }),
    objet("outil", "transfert", "grille", { date_fin: "2026-10-19" }), objet("outil", "justificatif", "grille", { date_debut: "2026-10-01", date_fin: "2026-10-20" })] };
  eq("statuts de date avant le motif (aucune lecture : outils absents)", V.evaluerVedettes(dates, null, { menus: MENUS, outils: null }, MAINTENANT).etats.map(e => e.statut),
    ["masquee", "programmee", "terminee", "donnees_indisponibles"]);
  eq("outils à lire : ni masqué, ni programmé, ni terminé (fin incluse)", O.outilsAEvaluer(dates, "2026-10-20"), ["justificatif"]);
  eq("outils à lire : objet invalide ignoré", O.outilsAEvaluer({ items: [{ ...objet("outil", "saisie", "grille"), id: "x" }, objet("outil", "ulabs", "grille")] }, "2026-10-20"), []);
}

// ── 10. GET accueil-offres ──
{
  O.oublierMemo();
  const confOutils = { items: [objet("produit", "3400934438738", "vitrine"), objet("outil", "peremption", "vitrine"), objet("outil", "saisie", "grille")] };
  let valeur = { items: [objet("produit", "3400934438738", "vitrine")] };
  const lectures = [], cles = [];
  const listeCips = (p) => decodeURIComponent((p.match(/cip=in\.([^&]*)/) || [])[1] || "").replace(/[()"]/g, "").split(",").filter(Boolean);
  let pannePeremption = false;
  const sb = async (path, opts) => {
    lectures.push(path.split("?")[0]);
    if (opts?.method && opts.method !== "GET") throw new Error("écriture interdite");
    if (path.startsWith("elixir_pharmacies")) return [{ email: "compte@pharmacie-a.test" }];
    if (path.startsWith("ec_config")) return [{ key: "display_config", value: DISPLAY }, { key: "admin_promos", value: PROMOS }, { key: "accueil_vedettes", value: JSON.stringify(valeur), updated_at: "x" }];
    if (path.startsWith("odoo_catalog?select=cip,list_price,discounted_price,discount_pct,earliest_expiry,updated_at&")) { lectures.push("péremption"); if (pannePeremption) throw new Error("table illisible"); return PER; }
    if (path.startsWith("odoo_catalog?cip=in.")) return path.includes("select=cip,list_price,discounted_price,discount_pct,in_stock") ? FAUT_CAT.filter(r => listeCips(path).includes(r.cip))
      : [{ cip: "3400934438738", name: "VENTOLINE", list_price: 3.24, discounted_price: 3.01, discount_pct: 7.1, in_stock: true, available: 5000 }].filter(r => listeCips(path).includes(r.cip));
    if (path.startsWith("expiry_discounts")) return [];
    if (path.startsWith("elixir_products")) return path.includes("select=cip,section") ? CUREES : [];
    if (path.startsWith("elixir_campaigns")) return [{ id: "camp1", active: true }];
    throw new Error(`table inattendue ${path}`);
  };
  const kv = new Map([["accueil:offres", { version: 1, genere_le: new Date(MAINTENANT - 3600e3).toISOString(), periode: null, slides: [], reserves: [] }], ["accueil:outils", { at: "x", saisie: COMPTES, fauteuils: CORRESPONDANCE }]]);
  const deps = { sb, kvGet: async (k) => { cles.push(k); return kv.get(k) ?? null; }, kvSet: async () => { throw new Error("écriture kv interdite"); }, rateLimit: () => null,
    justifs: async () => new Set(), labosJustif: async () => O.labosDeConfig(CONFIG_LJ), maintenant: () => MAINTENANT, odoo: async () => { throw new Error("Odoo interdit"); },
    compter: async () => { throw new Error("compte interdit au GET"); },
    verifierJeton: async (t) => ({ "jeton-a": { id: "a", email: "compte@pharmacie-a.test" }, "jeton-admin": { id: "adm", email: "equipe@elixir.test", isAdmin: true } })[t] || null };
  const appel = async (jeton) => { lectures.length = 0; cles.length = 0; const r = await creerHandler(deps)({ httpMethod: "GET", headers: { authorization: `Bearer ${jeton}` }, queryStringParameters: {} });
    return { statut: r.statusCode, corps: JSON.parse(r.body) }; };
  let r = await appel("jeton-a");
  eq("sans outil : mêmes lectures qu'en 0177110 (pharmacie, configuration, catalogue, produits, campagnes ; kv du classement)", [lectures, cles],
    [["elixir_pharmacies", "ec_config", "odoo_catalog", "elixir_products", "elixir_campaigns"], ["accueil:offres"]]);
  valeur = { items: [objet("outil", "peremption", "vitrine")] };
  r = await appel("jeton-a");
  eq("Péremption seule : péremptions lues (une lecture), pas de kv accueil:outils", [lectures.filter(x => x === "péremption").length, cles], [1, ["accueil:offres"]]);
  eq("… chiffres publics dans la vedette : « dès 0,44 € », « jusqu'à −50 % »", r.corps.vedettes.items[0].chiffres, { nb: 9, des: 0.44, jusqua: 50, mois: ["2026-11", "2027-02"], maj: MAJ });
  valeur = confOutils;
  r = await appel("jeton-a");
  eq("pharmacie : ni outils_etat ni remises_affichees / remises_facturees", ["outils_etat" in r.corps, /remises_facturees|remises_affichees|en_menu|honnetes/.test(JSON.stringify(r.corps))], [false, false]);
  eq("pharmacie : produit, péremption, saisie (avec ses comptes)", r.corps.vedettes.items.map(i => [i.type, i.outil || null, i.chiffres?.references ?? null]), [["produit", null, null], ["outil", "peremption", null], ["outil", "saisie", 27871]]);
  r = await appel("jeton-admin");
  eq("admin : outils_etat des 6 outils", Object.keys(r.corps.outils_etat), O.OUTILS_MEA);
  eq("admin : remises facturées, fauteuils, justificatif, groupées", [r.corps.outils_etat.peremption.admin, r.corps.outils_etat.fauteuil.chiffres.tailles.length, r.corps.outils_etat.justificatif.chiffres.presentations,
    r.corps.outils_etat.groupees.selon_pharmacie], [{ remises_affichees: 8, remises_facturees: 0 }, 4, 17, true]);
  O.oublierMemo(); pannePeremption = true;
  r = await appel("jeton-a");
  eq("lecture des péremptions en échec : les autres mises en avant sortent quand même", [r.statut, r.corps.vedettes.items.map(i => i.outil || i.type)], [200, ["produit", "saisie"]]);
  pannePeremption = false; O.oublierMemo();
}

// ── 11. Fonction planifiée ──
{
  const variantes = Object.entries(CORRESPONDANCE).flatMap(([code], i) => CORRESPONDANCE[code].map((cip, j) => ({ id: 100 * (i + 1) + j, default_code: cip, barcode: false, product_tmpl_id: [i + 1, code], create_date: `2025-0${j + 1}-01 10:00:00` })));
  const odooOk = async (model, method, args) => {
    if (!["search_read", "read", "read_group"].includes(method)) throw new Error(`écriture Odoo interdite : ${method}`);
    if (model === "product.supplierinfo") return Object.keys(CORRESPONDANCE).map((code, i) => ({ product_code: code, product_tmpl_id: [i + 1, code], product_id: false }));
    if (model === "product.product" && method === "search_read") return variantes.slice().reverse();
    if (model === "sale.order.line" && method === "read_group") return [];   // classement vide
    throw new Error(`appel inattendu ${model}.${method} ${JSON.stringify(args).slice(0, 40)}`);
  };
  const kv = new Map();
  const deps = (extra = {}) => ({ odoo: odooOk, kvGet: async (k) => (kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : null), kvSet: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); },
    compter: async (chemin) => (chemin.includes("in_stock") ? COMPTES.en_stock : COMPTES.references), sb: async (p) => (p.startsWith("odoo_catalog?select=updated_at") ? [{ updated_at: COMPTES.maj }] : []),
    quotaProducts: async () => [], justifs: async () => new Set(), maintenant: () => MAINTENANT, ...extra });
  await creerRefresh(deps())();
  eq("écrit accueil:outils (correspondance et comptes)", [kv.get("accueil:outils").fauteuils, kv.get("accueil:outils").saisie], [CORRESPONDANCE, COMPTES]);
  vrai("classement vide : outils écrits quand même, journal", kv.has("accueil:outils") && /outils : 6 codes → 9 CIP · catalogue 27.871 réf\., màj 8 h 38/.test(esp(kv.get("accueil:dernier_passage").journal.join(" | "))));
  eq("classement vide : cache du classement non écrit", kv.has("accueil:offres"), false);
  const avant = kv.get("accueil:outils");
  await creerRefresh(deps({ odoo: async () => { throw new Error("Odoo injoignable"); }, compter: async (c) => (c.includes("in_stock") ? 4500 : 27900), maintenant: () => MAINTENANT + 3 * 3600e3 }))();
  eq("Odoo en panne : correspondance précédente gardée, comptes mis à jour", [kv.get("accueil:outils").fauteuils, kv.get("accueil:outils").saisie.references, kv.get("accueil:outils").at !== avant.at], [CORRESPONDANCE, 27900, true]);
  vrai("… journal : correspondance gardée", /correspondance des fauteuils gardée/.test(kv.get("accueil:dernier_passage").journal.join(" ")));
  const at = kv.get("accueil:outils").at;
  await creerRefresh(deps({ odoo: async () => { throw new Error("Odoo injoignable"); }, compter: async () => { throw new Error("Supabase en panne"); } }))();
  eq("tout en échec : rien réécrit", kv.get("accueil:outils").at, at);
  // échec des outils (écriture refusée) : le classement est écrit quand même
  const classement = [{ product_id: [1, "x"], order_id: 40, order_partner_id: 20, product_uom_qty: 90 }];
  const odooClassement = async (model, method, args, kw) => {
    if (model === "sale.order.line" && method === "read_group") return args[1].length === 3 ? classement : [];
    if (model === "product.product" && method === "read") return [{ id: 1, default_code: "3400934438738", name: "VENTOLINE 100µG", manufacturer_id: [3, "GSK"], stup: false, active: true, sale_ok: true }];
    if (model === "sale.order.line" && method === "search_read") return kw.offset ? [] : [];
    return odooOk(model, method, args);
  };
  const kv2 = new Map();
  await creerRefresh(deps({ odoo: odooClassement, kvSet: async (k, v) => { if (k === "accueil:outils") throw new Error("écriture refusée"); kv2.set(k, v); },
    sb: async (p) => (p.startsWith("odoo_catalog?cip=in.") ? [{ cip: "3400934438738", name: "VENTOLINE", list_price: 3.24, discounted_price: 3.01, discount_pct: 7.1, in_stock: true, available: 5000 }]
      : p.startsWith("ec_config") ? [] : p.startsWith("odoo_catalog?select=updated_at") ? [{ updated_at: COMPTES.maj }] : []) }))();
  eq("outils en échec : classement écrit quand même, erreur au journal", [kv2.get("accueil:offres")?.slides?.length, /outils : erreur/.test(kv2.get("accueil:dernier_passage").journal.join(" "))], [1, true]);
  const s = creerSources({ compter: async () => 7, labosJustif: async () => ["x"] });
  eq("creerSources : compter et labosJustif injectables", [await s.compter("t"), await s.labosJustif()], [7, ["x"]]);
}

// ── 12. Navigateur ──
{
  O.oublierMemo();
  const peremption = await O.lirePeremption({ sb: sbPeremption([]), maintenant: () => MAINTENANT });
  const ctxS = { catalogue: {}, curees: [], promos: PROMOS, justifs: new Set(), menus: MENUS, outils: { ...OUTILS_LUS, peremption } };
  const conf = { items: [objet("outil", "peremption", "vitrine"), objet("outil", "fauteuil", "vitrine"), objet("outil", "justificatif", "vitrine"), objet("outil", "saisie", "grille"),
    objet("outil", "transfert", "grille", { image: "https://exemple.test/photo-zineb.jpg" }), objet("outil", "groupees", "grille")] };
  const pub = V.evaluerVedettes(conf, null, ctxS, MAINTENANT).publiques;
  const m = C.construireMisesEnAvant(pub, ctxPage({ justifProducts: JUSTIF_PRODUITS }));
  const [per, fau, jus] = m.vitrine, [sai, tra, grp] = m.grille;
  eq("péremption : bouton, sur-titre, titre « petits prix » (rétabli le 21/10/2026), badge de la mise en avant (vide)", [per.outil.cta, per.rayon, esp(per.titre), per.badge], ["Voir les 9 produits", "Péremption courte", "Péremption courte, petits prix", ""]);
  eq("péremption : textes des chiffres, « dès » le plus bas prix affiché", [esp(per.outil.meta), esp(per.outil.metaCourt), per.outil.meta2], ["9 références · dès 0,44 € HT", "9 réf. · dès 0,44 € HT", "Péremptions de nov. 2026 à févr. 2027"]);
  eq("péremption : plaque et 2 cartes-chiffres (références, plus bas prix), aucun nom ni photo de produit", per.outil.cartes.map(c => c.type || esp(c.chiffre)), ["plaque", "9", "0,44 €"]);
  eq("péremption : accroche « la remise est déjà dans le prix affiché »", esp(per.accroche), "Produits en stock à péremption entre J+30 et 4 mois : la remise est déjà dans le prix affiché.");
  vrai("… aucune carte avec un nom ou une photo", per.outil.cartes.every(c => !c.url && !c.nom));
  eq("médaillon : « jusqu'à −50 % » pour la Péremption seulement ; jamais de fin d'offre", [per.outil.jusqua, fau.outil.jusqua, jus.outil.jusqua, sai.outil.jusqua, ...m.vitrine.map(e => e.finOffre)], [50, null, null, null, null, null, null]);
  eq("texte lu exact", esp(C.resumeOutilLu(per)), "Péremption courte, petits prix, 9 références, dès 0,44 € HT, jusqu'à −50 %");
  // badge « Petits prix » : gardé avec une remise affichée (jusqua) ; retiré seulement si la page n'affiche aucune remise ; un
  // autre badge de Zineb : gardé
  const avecBadge = (badge, chiffres) => C.construireMisesEnAvant({ items: [{ ...pub.items[0], badge, ...(chiffres ? { chiffres } : {}) }] }, ctxPage()).vitrine[0].badge;
  eq("badge « Petits prix » : gardé avec une remise ; retiré sans aucune remise affichée ; autre badge : gardé",
    [avecBadge("Petits prix"), avecBadge("  petits PRIX ", { ...pub.items[0].chiffres, jusqua: null, des: null }), avecBadge("Nouveau", { ...pub.items[0].chiffres, jusqua: null, des: null }), avecBadge("Petits prix", { ...pub.items[0].chiffres, jusqua: 20, des: 3.1 })], ["Petits prix", "", "Nouveau", "Petits prix"]);
  eq("badge par défaut d'une nouvelle mise en avant Péremption", C.OUTILS.peremption.badge, "Petits prix");
  // revue du 21/10/2026 : sans remise affichée, le titre ne promet plus de « petits prix » (un titre saisi par Zineb est gardé)
  const titreSans = (titre) => C.construireMisesEnAvant({ items: [{ ...pub.items[0], titre, chiffres: { ...pub.items[0].chiffres, jusqua: null, des: null } }] }, ctxPage()).vitrine[0];
  eq("sans remise affichée : titre « Lots à date courte, en stock », texte lu sans « petits prix » ; titre de Zineb gardé",
    [esp(titreSans(undefined).titre), /petits prix/i.test(C.resumeOutilLu(titreSans(undefined))), esp(titreSans("Mon titre").titre)], ["Lots à date courte, en stock", false, "Mon titre"]);
  eq("sans remise affichée : accroche au prix habituel, sans remise annoncée", [esp(C.OUTILS.peremption.accroche({ nb: 3 })), /remise|petits prix|−|%/i.test(C.OUTILS.peremption.accroche({ nb: 3 }))],
    ["Produits en stock à péremption entre J+30 et 4 mois, à leur prix habituel, avec la date de chaque lot.", false]);
  eq("teintes : outil (justificatif : sarcelle, violet écarté)", [per.couleur, fau.couleur, jus.couleur, jus.source, sai.couleur], ["#ea580c", "#3b82f6", "#3c7782", "rayon", "#2d9cbc"]);
  eq("justificatif : rubrique sans emoji, chiffres recalculés, cartes des labos", [jus.rayon, esp(jus.outil.meta), jus.outil.cartes.map(c => c.type || `${c.chiffre}:${c.legende}`), jus.accroche.split(" : ")[0]],
    ["Commande labo sur justificatif", "6 médicaments · 17 présentations", ["plaque", "Takeda:4 médicaments", "Pfizer:2 médicaments"], "Takeda et Pfizer"]);
  eq("fauteuil sans photo : éventail de 3 photos du fabricant (fond blanc), halo sur la 1re", [fau.outil.photo, fau.outil.cartes.length, fau.outil.cartes.every(c => /^https:\/\/www\.dhcare\.fr\//.test(c.url) && c.nom === "Action 2NG"), fau.halo === fau.outil.cartes[0].url],
    [null, 3, true, true]);
  eq("fauteuil : textes (étendue des largeurs en seconde ligne)", [esp(fau.outil.meta), esp(fau.outil.meta2), esp(fau.outil.lu), fau.outil.cta, fau.accroche.split(" : ")[0]],
    ["4 largeurs en stock · 210,08 € HT", "Largeurs d'assise : de 40,5 à 48 cm", "Le bon fauteuil, à la bonne largeur, 4 largeurs en stock, de 40,5 à 48 cm, 210,08 € HT", "Choisir la largeur", "Invacare Action 2NG"]);
  eq("photo de Zineb → composition A (photo, halo)", [tra.outil.photo, tra.halo, esp(tra.outil.meta)], ["https://exemple.test/photo-zineb.jpg", "https://exemple.test/photo-zineb.jpg", "2 largeurs en stock · dès 175,70 € HT"]);
  const casse = C.construireMisesEnAvant(pub, ctxPage({ justifProducts: JUSTIF_PRODUITS, illisibles: new Set(["https://exemple.test/photo-zineb.jpg"]) })).grille[1];
  eq("photo de Zineb illisible → composition automatique", [casse.outil.photo, casse.outil.cartes[0].nom], [null, "Transit Lite"]);
  // photos du fabricant toutes illisibles (jeton du fabricant changé) : composition plaque et chiffres, prix exact (« dès »
  // pour le transfert : « le plus bas »), jamais une carte blanche presque vide (écart au § 6.6 de la spécification)
  const photosFab = (k) => new Set(C.cartesOutil(k, null).map(c => c.url));
  eq("photos du fabricant toutes illisibles → plaque, largeurs en stock, prix", C.cartesOutil("fauteuil", { tailles: ["40,5 cm", "43 cm", "45,5 cm", "48 cm"], des: 210.08, a: 210.08 }, { illisibles: photosFab("fauteuil") }).map(c => c.type || `${esp(c.chiffre)}:${c.legende}`),
    ["plaque", "4:largeurs en stock", "210,08 €:HT"]);
  eq("… transfert : 2 largeurs, prix le plus bas", C.cartesOutil("transfert", { tailles: ["43 cm", "45,5 cm"], des: 175.7, a: 179.52 }, { illisibles: photosFab("transfert") }).map(c => c.type || `${esp(c.chiffre)}:${c.legende}`),
    ["plaque", "2:largeurs en stock", "175,70 €:HT, le plus bas"]);
  const fauBloque = C.construireMisesEnAvant(pub, ctxPage({ justifProducts: JUSTIF_PRODUITS, illisibles: photosFab("fauteuil") })).vitrine[1];
  eq("… sur la page : éventail « outil » (plaque devant), aucun halo de photo cassée", [fauBloque.outil.cartes[0].type, fauBloque.halo ?? null], ["plaque", null]);
  eq("saisie : plaque avec champ, chiffres, mise à jour", [sai.outil.cartes[0], esp(sai.outil.meta), sai.outil.meta2, sai.outil.cta, sai.outil.ctaCourt],
    [{ type: "plaque", icone: "crayon", champ: true }, "27 871 références · 4 526 réf. en stock", "Stock mis à jour le 20 oct. à 8 h 38", "Ouvrir la Saisie de commande", "Ouvrir la Saisie"]);
  eq("saisie : cartes « références » et « réf. en stock » (un nombre de références, jamais une quantité)", sai.outil.cartes.slice(1).map(c => c.legende), ["références", "réf. en stock"]);
  eq("groupées : 2 opérations ouvertes", [esp(grp.outil.meta), grp.outil.cartes.map(c => c.chiffre || c.type)], ["2 opérations ouvertes", ["plaque", "2"]]);
  eq("pieds de tuile : court, et verbe seul (petite tuile sur téléphone), contenu dans le court", [per.outil.ctaCourt, per.outil.ctaMini, fau.outil.ctaMini, sai.outil.ctaMini, jus.outil.ctaMini, grp.outil.ctaMini],
    ["Voir les produits", "Voir", "Choisir", "Ouvrir", "Commander", "Voir"]);
  vrai("… verbe seul inclus dans le texte court (nom accessible)", Object.values(C.OUTILS).every(d => d.ctaCourt.startsWith(d.ctaMini)));
  eq("aperçu de l'admin : groupées montrées sans compte de la pharmacie", C.construireMisesEnAvant(pub, ctxPage({ apercu: true, gp: { autorise: true, ouvertes: null } })).grille[2].outil.meta, "Vos opérations ouvertes");
  const sansComptes = C.construireMisesEnAvant({ items: [{ ...pub.items.find(i => i.outil === "saisie"), chiffres: null }] }, ctxPage()).grille[0];
  eq("saisie sans chiffres : texte seul, plaque seule", [sansComptes.outil.meta, sansComptes.outil.cartes.length, sansComptes.accroche.length > 0], ["", 1, true]);
  eq("chiffres exigés absents → écarté (péremption sans chiffres)", C.construireMisesEnAvant({ repli: false, items: [{ ...pub.items[0], chiffres: null }] }, ctxPage()).vitrine.length, 0);
  eq("texte vide de Zineb → défaut ; texte saisi → gardé", [per.accroche.startsWith("Produits en stock"), C.construireMisesEnAvant({ items: [{ ...pub.items[0], titre: "Mon titre", accroche: "Mon texte" }] }, ctxPage()).vitrine[0].accroche], [true, "Mon texte"]);
  eq("une seule taille en stock", esp(C.chiffresTexte("transfert", { tailles: ["43 cm"], des: 179.52, a: 179.52 }).meta), "Largeur 43 cm en stock · 179,52 € HT");
  // typographie : un nombre ne quitte jamais son unité ; « dès » colle à son prix ; titres sans mot seul en fin de ligne
  const NB = "\u00a0", FN = "\u202f";
  const tx = (k, ch, o) => C.chiffresTexte(k, ch, o).meta;
  eq("insécables : nombre et unité, « dès » et prix", [tx("justificatif", { medicaments: 6, presentations: 17 }), tx("peremption", { nb: 167, des: 0.44 }, { court: true }), tx("transfert", { tailles: ["43 cm", "45,5 cm"], des: 175.7, a: 179.52 }),
    tx("saisie", { references: 27871, en_stock: 4526 }), tx("groupees", { ouvertes: 2 })],
    [`6${NB}médicaments · 17${NB}présentations`, `167${NB}réf. · dès${NB}0,44${NB}€${NB}HT`, `2${NB}largeurs en stock · dès${NB}175,70${NB}€${NB}HT`,
      `27${FN}871${NB}références · 4${FN}526${NB}réf.${NB}en${NB}stock`, `2${NB}opérations ouvertes`]);
  eq("titres et accroche : « à la », « Transit Lite », « en stock », « 4 mois » insécables", [C.OUTILS.fauteuil.titre, C.OUTILS.transfert.titre, C.OUTILS.peremption.titre, C.OUTILS.peremption.accroche().includes(`4${NB}mois`)],
    [`Le bon fauteuil, à${NB}la bonne${NB}largeur`, `Fauteuil de transfert Transit${NB}Lite`, "Péremption courte, petits prix", true]);
  eq("péremption sur un seul mois ; un seul produit", [C.chiffresTexte("peremption", { nb: 1, des: 2, mois: ["2027-01", "2027-01"] }).meta2, C.OUTILS.peremption.cta({ nb: 1 })], ["Péremption en janv. 2027", "Voir le produit"]);
  let erreur = null;
  try { eq("type inconnu (« assistant ») ignoré sans erreur, comme une page restée sur l'ancien code", C.construireMisesEnAvant({ items: [{ id: "mea_x_1234", type: "assistant", emplacement: "vitrine" }, pub.items[0]] }, ctxPage()).vitrine.map(e => e.cle), ["o:peremption"]); }
  catch (e) { erreur = e; }
  eq("… aucune exception", erreur, null);
  eq("outil inconnu du registre ignoré", C.construireMisesEnAvant({ repli: false, items: [{ ...pub.items[0], outil: "ulabs" }] }, ctxPage()).vitrine.length, 0);
}

// ── 13. Correctifs de la revue ──
{
  O.oublierMemo();
  // (a) kv « accueil:outils » illisible : fauteuils en donnees_indisponibles (jamais les anciens CIP : 2 largeurs à tort)
  const srcPanneKv = { kvGet: async () => { throw new Error("kv en panne"); }, sb: async (p) => (p.includes("select=cip,list_price,discounted_price,discount_pct,in_stock") ? FAUT_CAT : []),
    labosJustif: async () => [], maintenant: () => MAINTENANT };
  const lusKv = await O.lireOutils(srcPanneKv, ["fauteuil", "saisie"], { displayConfig: {} });
  eq("kv illisible : fauteuil → donnees_indisponibles (pas de repli)", O.evaluerOutil("fauteuil", { outils: lusKv, menus: MENUS }, MAINTENANT).raisons, ["donnees_indisponibles"]);
  eq("kv illisible : Saisie en texte seul", O.evaluerOutil("saisie", { outils: lusKv, menus: MENUS }, MAINTENANT).chiffres, null);
  const srcSansCle = { ...srcPanneKv, kvGet: async () => null };
  const lusSansCle = await O.lireOutils(srcSansCle, ["fauteuil"], { displayConfig: {} });
  const repli = O.evaluerOutil("fauteuil", { outils: lusSansCle, menus: MENUS }, MAINTENANT);
  eq("clé absente (avant le 1er passage) : CIP de repli, signalés à l'admin", [repli.chiffres.tailles.length, repli.admin.correspondance], [2, "repli"]);
  eq("correspondance sans fauteuils (Odoo toujours en échec) → admin « repli »",
    O.evaluerOutil("fauteuil", { outils: { plan: { at: "x", fauteuils: null, saisie: COMPTES }, fauteuilsCat: { parCip: parCip(FAUT_CAT) } } }, MAINTENANT).admin.correspondance, "repli");
  eq("correspondance complète → « odoo » (date du calcul) ; partielle → « partielle »", [
    O.evaluerOutil("fauteuil", { outils: { plan: { at: "2026-10-20T06:40:00Z", fauteuils: CORRESPONDANCE }, fauteuilsCat: { parCip: parCip(FAUT_CAT) } } }, MAINTENANT).admin,
    O.evaluerOutil("fauteuil", { outils: { plan: { fauteuils: { BR1538205: CORRESPONDANCE.BR1538205 } }, fauteuilsCat: { parCip: parCip(FAUT_CAT) } } }, MAINTENANT).admin.correspondance],
    [{ correspondance: "odoo", calculee_le: "2026-10-20T06:40:00Z" }, "partielle"]);
  vrai("admin des fauteuils absent de la réponse publique", !("admin" in (V.evaluerVedettes({ items: [objet("outil", "fauteuil", "vitrine")] }, null,
    { menus: MENUS, outils: { plan: { fauteuils: CORRESPONDANCE }, fauteuilsCat: { parCip: parCip(FAUT_CAT) } } }, MAINTENANT).publiques.items[0] || {})));

  // (b) section ajoutée dans l'admin (customSections) : sans effet (règle panier : un produit d'un menu ou d'une section compte
  // aussi, son ajout depuis la page est une ligne à part au prix de la page) ; lireOutils ne lit plus les sections perso
  O.oublierMemo();
  const peremption = await O.lirePeremption({ sb: sbPeremption([]), maintenant: () => MAINTENANT });
  const avecPerso = O.evaluerOutil("peremption", { outils: { peremption, perso: ["maSection"] }, menus: MENUS }, MAINTENANT);
  eq("section perso : sans effet sur « dès » et « jusqu'à »", [avecPerso.chiffres.nb, avecPerso.chiffres.des, avecPerso.chiffres.jusqua, avecPerso.admin], [9, 0.44, 50, { remises_affichees: 8, remises_facturees: 0 }]);
  eq("lireOutils : plus de clés des sections perso", "perso" in (await O.lireOutils({ sb: sbPeremption([]), maintenant: () => MAINTENANT }, ["peremption"], { displayConfig: { customSections: [{ key: "maSection" }] } })), false);

  // (c) fonction planifiée : valeur précédente illisible + Odoo en panne → accueil:outils inchangé
  const kv = new Map([["accueil:outils", { at: "2026-10-20T03:40:00.000Z", fauteuils: CORRESPONDANCE, saisie: COMPTES }]]);
  const ecrits = [];
  const depsR = (extra = {}) => ({ odoo: async () => { throw new Error("Odoo injoignable"); },
    kvGet: async (k) => { if (k === "accueil:outils") throw new Error("kv en panne"); return kv.get(k) ?? null; }, kvSet: async (k, v) => { ecrits.push(k); kv.set(k, v); },
    compter: async (c) => (c.includes("in_stock") ? 4500 : 27900), sb: async (p) => (p.startsWith("odoo_catalog?select=updated_at") ? [{ updated_at: COMPTES.maj }] : []),
    quotaProducts: async () => [], justifs: async () => new Set(), maintenant: () => MAINTENANT, ...extra });
  await creerRefresh(depsR())();
  eq("valeur précédente illisible, Odoo en panne : accueil:outils non réécrit (correspondance gardée)", [ecrits.includes("accueil:outils"), kv.get("accueil:outils").fauteuils], [false, CORRESPONDANCE]);
  vrai("… journal : rien réécrit", /valeur précédente illisible, rien réécrit/.test(kv.get("accueil:dernier_passage").journal.join(" ")));
  const variantes = Object.entries(CORRESPONDANCE).flatMap(([code], i) => CORRESPONDANCE[code].map((cip, j) => ({ id: 100 * (i + 1) + j, default_code: cip, barcode: false, product_tmpl_id: [i + 1, code], create_date: `2025-0${j + 1}-01 10:00:00` })));
  const odooOk = async (model, method) => (model === "product.supplierinfo" ? Object.keys(CORRESPONDANCE).map((code, i) => ({ product_code: code, product_tmpl_id: [i + 1, code], product_id: false }))
    : model === "product.product" ? variantes : []);
  ecrits.length = 0;
  await creerRefresh(depsR({ odoo: odooOk }))();
  eq("valeur précédente illisible, tout calculé : écrit (rien à perdre)", [ecrits.includes("accueil:outils"), kv.get("accueil:outils").saisie.references], [true, 27900]);
  // dernière mise à jour des comptes : lignes datées seulement ; sans date : signalé au journal
  const chemins = [];
  const j = [];
  const v = await O.calculerOutilsPlanifies({ odoo: odooOk, compter: async () => 10, sb: async (p) => { chemins.push(p); return [{ updated_at: null }]; }, maintenant: () => MAINTENANT }, null, j);
  eq("comptes : lecture de la date sans NULL en tête", chemins[0], "odoo_catalog?select=updated_at&updated_at=not.is.null&order=updated_at.desc.nullslast&limit=1");
  eq("comptes sans date : maj nulle, signalé au journal", [v.saisie.maj, /comptes sans date de mise à jour/.test(j.join(" "))], [null, true]);

  // (d) GET : lecture d'un outil lente, ?verifier= sans outils, admin : outil masqué lu quand même
  let valeur = { items: [objet("produit", "3400934438738", "vitrine"), objet("outil", "peremption", "vitrine"), objet("outil", "saisie", "grille")] };
  let display = DISPLAY, lente = false;
  const lectures = [], cles = [];
  const sb = async (path) => {
    lectures.push(path.split("?")[0]);
    if (path.startsWith("elixir_pharmacies")) return [{ email: "compte@pharmacie-a.test" }];
    if (path.startsWith("ec_config")) return [{ key: "display_config", value: display }, { key: "admin_promos", value: PROMOS }, { key: "accueil_vedettes", value: JSON.stringify(valeur), updated_at: "x" }];
    if (path.startsWith("odoo_catalog?select=cip,list_price,discounted_price,discount_pct,earliest_expiry,updated_at&")) { lectures.push("péremption"); return lente ? new Promise(() => {}) : PER; }
    if (path.startsWith("expiry_discounts")) return [];
    if (path.startsWith("odoo_catalog?cip=in.")) return path.includes("in_stock&") || path.endsWith("in_stock") ? FAUT_CAT
      : [{ cip: "3400934438738", name: "VENTOLINE", list_price: 3.24, discounted_price: 3.01, discount_pct: 7.1, in_stock: true, available: 5000 }];
    if (path.startsWith("elixir_products")) return path.includes("select=cip,section") ? CUREES : [];
    if (path.startsWith("elixir_campaigns")) return [{ id: "camp1", active: true }];
    throw new Error(`table inattendue ${path}`);
  };
  const kvG = new Map([["accueil:offres", { version: 1, genere_le: new Date(MAINTENANT - 3600e3).toISOString(), periode: null, slides: [], reserves: [] }], ["accueil:outils", { at: "x", saisie: COMPTES, fauteuils: CORRESPONDANCE }]]);
  const deps = { sb, kvGet: async (k) => { cles.push(k); return kvG.get(k) ?? null; }, kvSet: async () => { throw new Error("écriture kv interdite"); }, rateLimit: () => null,
    justifs: async () => new Set(), labosJustif: async () => O.labosDeConfig(CONFIG_LJ), maintenant: () => MAINTENANT, odoo: async () => { throw new Error("Odoo interdit"); },
    compter: async () => { throw new Error("compte interdit au GET"); }, delaiOutilsMs: 60,
    verifierJeton: async (t) => ({ "jeton-a": { id: "a", email: "compte@pharmacie-a.test" }, "jeton-admin": { id: "adm", email: "equipe@elixir.test", isAdmin: true } })[t] || null };
  const appel = async (jeton, q = {}) => { lectures.length = 0; cles.length = 0; const r = await creerHandler(deps)({ httpMethod: "GET", headers: { authorization: `Bearer ${jeton}` }, queryStringParameters: q });
    return { statut: r.statusCode, corps: JSON.parse(r.body) }; };
  O.oublierMemo(); lente = true;
  const t0 = Date.now();
  let r = await appel("jeton-a");
  eq("péremption qui ne répond jamais : 200, les autres mises en avant sortent (délai des outils)", [r.statut, r.corps.vedettes.items.map(i => i.outil || i.type)], [200, ["produit", "saisie"]]);
  vrai(`… sans attendre la lecture lente (${Date.now() - t0} ms)`, Date.now() - t0 < 1500);
  lente = false; O.oublierMemo();
  r = await appel("jeton-admin", { verifier: "3400934438738" });
  eq("admin ?verifier= : aucune lecture d'outil, ni outils_etat ; la vérification est là", [lectures.includes("péremption"), cles.includes("accueil:outils"), "outils_etat" in r.corps, Object.keys(r.corps.verification || {})],
    [false, false, false, ["3400934438738"]]);
  display = { hiddenTabs: ["ulabs", "peremption"] };
  r = await appel("jeton-admin");
  eq("admin, Péremption masquée : chiffres lus quand même, motif outil_masque (rien d'autre)", [r.corps.outils_etat.peremption.raisons, r.corps.outils_etat.peremption.chiffres?.nb], [["outil_masque"], 9]);
  eq("… et l'état de sa mise en avant reste « outil masqué »", r.corps.vedettes_etat.find(e => e.id === valeur.items[1].id).statut, "outil_masque");
  r = await appel("jeton-a");
  eq("pharmacie, Péremption masquée : rien lu pour elle, absente", [lectures.includes("péremption"), r.corps.vedettes.items.map(i => i.outil || i.type)], [false, ["produit", "saisie"]]);
  display = DISPLAY;

  // (e) configuration des justificatifs (kv « lj:config ») lue une fois pour justifs et labosJustif
  const fetchAvant = globalThis.fetch;
  let lecturesConfig = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("kv_store?key=eq.lj%3Aconfig")) { lecturesConfig++; return new Response(JSON.stringify([{ value: JSON.stringify(CONFIG_LJ) }]), { status: 200 }); }
    throw new Error(`réseau interdit dans les tests : ${url}`);
  };
  try {
    const src = creerSources({});
    const [js, labos] = await Promise.all([src.justifs(), src.labosJustif()]);
    eq("lj:config lue une seule fois (justifs : tous les labos ; labosJustif : ceux du site)", [lecturesConfig, js.size, labos.map(l => l.nom)], [1, 18, ["Takeda", "Pfizer"]]);
  } finally { globalThis.fetch = fetchAvant; }

  // (f) propriété : tout objet outil que evaluerVedettes évalue (aucun statut de date) a sa clé dans outilsAEvaluer
  let graine = 20261020;
  const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  const parmi = (l) => l[Math.floor(hasard() * l.length)];
  const JOURS = [null, "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-20T08:00:00Z", "2026-13-01", ""];
  let contreExemples = [], nEvalues = 0;
  for (let k = 0; k < 400; k++) {
    const items = Array.from({ length: 1 + Math.floor(hasard() * 8) }, () => objet(parmi(["outil", "outil", "outil", "produit"]), parmi([...O.OUTILS_MEA, " saisie ", "ulabs"]), parmi(["vitrine", "grille", "ailleurs"]),
      { actif: parmi([true, true, false, undefined]), date_debut: parmi(JOURS), date_fin: parmi(JOURS), ...(hasard() < 0.1 ? { id: "invalide" } : {}) }))
      .map(x => (x.type === "produit" ? { ...x, cip: "3400934438738", outil: undefined } : x));
    const valeur = { items };
    const demandes = new Set(O.outilsAEvaluer(valeur, "2026-10-20"));
    const evalues = [];
    const espion = { menus: MENUS, get outils() { return OUTILS_LUS; } };
    const etats = V.evaluerVedettes(valeur, null, espion, MAINTENANT).etats;
    for (const e of etats) {
      const it = items.find(i => i.id === e.id);
      if (it?.type === "outil" && !["masquee", "programmee", "terminee", "invalide"].includes(e.statut)) evalues.push(String(it.outil).trim());
    }
    nEvalues += evalues.length;
    const manquants = evalues.filter(x => !demandes.has(x));
    if (manquants.length) contreExemples.push({ items: items.map(i => [i.type, i.outil, i.emplacement, i.actif, i.date_debut, i.date_fin]), manquants });
  }
  eq("propriété (400 tirages) : outil évalué ⇒ demandé à lireOutils", contreExemples.slice(0, 2), []);
  vrai(`… tirages non vides (${nEvalues} outils évalués)`, nEvalues > 100);
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
