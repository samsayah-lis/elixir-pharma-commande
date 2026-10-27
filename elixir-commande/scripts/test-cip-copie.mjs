// Tests de la copie des CIP (27/10/2026, docs/cip-copie.md) : node scripts/test-cip-copie.mjs
// Hors ligne, rien n'est lu ni écrit ailleurs qu'en mémoire (presse-papiers, document et stockage simulés). Contrôles :
//  1. formats de collage (src/cip-copie.js) : un CIP par ligne, CIP;quantité, CIP ⇥ quantité ; lignes sans CIP écartées ;
//     quantité servie préférée quand elle est connue (servi), sinon commandée (qty, quantite, commande) ; format inconnu → un par ligne ;
//  2. presse-papiers (copierTexte) : navigator.clipboard, repli textarea + execCommand quand il est refusé ou absent (champ retiré
//     après coup), échec sans exception ; copierCip signale « CIP … copié » (événement ex-copie) ;
//  3. format mémorisé (localStorage simulé) : relu, valeur inconnue ignorée, stockage refusé sans exception ;
//  4. CipCell (rendu HTML) : tout l'élément est un bouton (titre « Cliquer pour copier le CIP », libellé, Entrée/Espace natifs),
//     le numéro n'est JAMAIS sélectionnable (aucun ex-selectionnable avant un refus), tabulable={false} → tabindex -1, tiret sans CIP ;
//     clics (React d'essai) : copie réussie → état « copie » ; refusée → état « echec » puis CIP sélectionnable (manuel) ;
//  5. CopieCips (rendu HTML et clics) : désactivé sans CIP, format mémorisé → copie immédiate au bon format, sans format → menu ouvert,
//     menu des formats (3 choix, coché = format courant, choix → onChoisir), ToastCopie : région annoncée vide au départ ;
//  6. anti-copie intact : .ex-app en user-select: none, règle .ex-cip présente, src/anticopie.js identique à la référence ;
//  7. chaque écran de la pharmacie qui montre un CIP rend CipCell (texte des sources) : panier, Saisie (hors tabulation), recherche
//     globale et menus (App), Mes commandes, Péremption courte, fauteuils, justificatif labo, commandes groupées, cartes de
//     l'assistant (lignes et retour) ; « Copier les CIP » au panier, dans Mes commandes et sur la carte commande ; le bon de commande
//     copié passe par copierTexte ; ToastCopie montée dans App ; clé de stockage déclarée dans scripts/verifie-zones.mjs.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const RACINE = new URL("..", import.meta.url).pathname;
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v, detail = "") => { if (v) ok++; else { ko++; console.log("✗", label, detail); } };
const tick = () => new Promise((r) => setTimeout(r, 0));
const lire = (f) => readFileSync(join(RACINE, f), "utf8");

// ── Monde simulé : presse-papiers, document (textarea + execCommand), stockage, événements ──
const monde = { ecrits: [], refuser: false, sansClipboard: false, execOk: true, exec: 0, stockage: {}, stockageRefuse: false, evenements: [] };
const cible = new EventTarget();
Object.defineProperty(globalThis, "dispatchEvent", { value: (e) => cible.dispatchEvent(e), configurable: true, writable: true });
Object.defineProperty(globalThis, "addEventListener", { value: (...a) => cible.addEventListener(...a), configurable: true, writable: true });
Object.defineProperty(globalThis, "removeEventListener", { value: (...a) => cible.removeEventListener(...a), configurable: true, writable: true });
cible.addEventListener("ex-copie", (e) => monde.evenements.push(e.detail));
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => monde.sansClipboard ? {} : ({
  clipboard: { writeText: (t) => monde.refuser ? Promise.reject(new Error("refusé")) : (monde.ecrits.push(t), Promise.resolve()) } }) });
const faitElement = () => { const el = { value: "", attrs: {}, style: {}, parent: null, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, select() { el.selectionne = true; }, remove() { if (el.parent) el.parent.enfants = el.parent.enfants.filter((x) => x !== el); } }; return el; };
const doc = { body: { enfants: [], appendChild(el) { el.parent = this; this.enfants.push(el); } }, createElement: () => faitElement(),
  execCommand: (c) => { monde.exec++; return c === "copy" && monde.execOk; }, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, "document", { configurable: true, get: () => doc });
Object.defineProperty(globalThis, "window", { configurable: true, get: () => globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => ({
  getItem: (k) => { if (monde.stockageRefuse) throw new Error("refusé"); return monde.stockage[k] ?? null; },
  setItem: (k, v) => { if (monde.stockageRefuse) throw new Error("refusé"); monde.stockage[k] = String(v); } }) });

// ── Modules : avec React (rendu HTML) et avec un React d'essai (arbre d'éléments, clics appelés à la main, setters observés) ──
const charge = async (entree, plugins = []) => {
  const lot = await build({ stdin: { contents: entree, resolveDir: join(RACINE, "src"), loader: "jsx" }, bundle: true, write: false, format: "esm",
    platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins });
  return import(`data:text/javascript;base64,${Buffer.from(lot.outputFiles[0].text).toString("base64")}`);
};
const C = await charge(`export * from "./cip-copie.js";`);
const M = await charge(`import React from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import CipCell, { ToastCopie } from "./components/ui/CipCell.jsx";
import CopieCips, { MenuFormats } from "./components/ui/CopieCips.jsx";
export const cip = (props) => renderToStaticMarkup(React.createElement(CipCell, props));
export const toast = () => renderToStaticMarkup(React.createElement(ToastCopie));
export const lot = (props) => renderToStaticMarkup(React.createElement(CopieCips, props));
export const menu = (props) => renderToStaticMarkup(React.createElement(MenuFormats, props));`);
const setters = [];
const E = await charge(`export { default as CipCell } from "./components/ui/CipCell.jsx";
export { default as CopieCips, MenuFormats } from "./components/ui/CopieCips.jsx";`, [{ name: "react-essai", setup(b) {
  b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "essai" }));
  b.onLoad({ filter: /.*/, namespace: "essai" }, () => ({ loader: "js", contents: `
    const el = (type, props) => ({ type, props: props || {} });
    export const jsx = el, jsxs = el, Fragment = "fragment";
    const useState = (v) => { const val = typeof v === "function" ? v() : v; return [val, (nv) => globalThis.__setters.push(typeof nv === "function" ? nv(val) : nv)]; };
    const React = { useState, useEffect: () => {}, useRef: (v) => ({ current: v }), useId: () => "id-essai", createElement: el };
    export { useState }; export const useEffect = React.useEffect, useRef = React.useRef, useId = React.useId;
    export default React;` }));
} }]);
globalThis.__setters = setters;
const elements = (n, out = []) => {
  if (Array.isArray(n)) { n.forEach((x) => elements(x, out)); return out; }
  if (!n || typeof n !== "object") return out;
  out.push(n); elements(n.props?.children, out); return out;
};
const boutons = (arbre) => elements(arbre).filter((e) => e.type === "button");

// ════════════════════════ 1. formats ════════════════════════
const L = [{ cip: "3400999000011", qty: 6 }, { cip: null, name: "hors catalogue", qty: 2 }, { cip: "3400999000028", qty: "3" }, { cip: "–", qty: 1 }];
eq("un CIP par ligne (lignes sans CIP écartées)", C.texteCips(L, "lignes"), "3400999000011\n3400999000028");
eq("CIP;quantité", C.texteCips(L, "pv"), "3400999000011;6\n3400999000028;3");
eq("CIP tabulation quantité", C.texteCips(L, "tab"), "3400999000011\t6\n3400999000028\t3");
eq("format inconnu → un par ligne", C.texteCips(L, "autre"), C.texteCips(L, "lignes"));
eq("quantité servie préférée (assistant), sinon commandée", C.lignesCip([{ cip: "1", commande: 10, servi: 6 }, { cip: "2", commande: 3 }, { cip: "3", quantite: 2 }, { cip: "4", qty: 5, servi: null }, { cip: "5", qty: -2 }, { cip: "6", servi: 0, qty: 9 }]).map((l) => l.qty), [6, 3, 2, 5, 0, 0]);
eq("rien : texte vide, lignes vides", [C.texteCips([], "pv"), C.texteCips(null, "pv"), C.lignesCip(undefined)], ["", "", []]);
eq("trois formats, identifiants stables", C.FORMATS_CIP.map((f) => f.id), ["lignes", "pv", "tab"]);
eq("CIP en texte, espaces retirés", C.lignesCip([{ cip: 3400999000011, qty: 1 }, { cip: " 3400999000028 ", qty: 1 }]).map((l) => l.cip), ["3400999000011", "3400999000028"]);

// ════════════════════════ 2. presse-papiers ════════════════════════
eq("navigator.clipboard : écrit, vrai", [await C.copierTexte("abc"), monde.ecrits], [true, ["abc"]]);
monde.refuser = true;
eq("refusé → repli textarea + execCommand : vrai, champ retiré", [await C.copierTexte("def"), monde.exec, doc.body.enfants.length], [true, 1, 0]);
monde.execOk = false;
eq("refusé et repli en échec → faux, sans exception", [await C.copierTexte("ghi"), doc.body.enfants.length], [false, 0]);
monde.refuser = false; monde.execOk = true; monde.sansClipboard = true;
const execAvant = monde.exec;
eq("navigator.clipboard absent → repli", [await C.copierTexte("jkl"), monde.exec - execAvant], [true, 1]);
eq("ni presse-papiers ni document → faux", await C.copierTexte("x", { doc: null, nav: null }), false);
monde.sansClipboard = false;
monde.evenements.length = 0;
eq("copierCip : CIP écrit et « CIP … copié » signalé", [await C.copierCip("3400999000011"), monde.ecrits.at(-1), monde.evenements], [true, "3400999000011", ["CIP 3400999000011 copié"]]);
monde.refuser = true; monde.execOk = false; monde.evenements.length = 0;
eq("copierCip refusé : faux, rien signalé", [await C.copierCip("3400999000011"), monde.evenements], [false, []]);
monde.refuser = false; monde.execOk = true;

// ════════════════════════ 3. format mémorisé ════════════════════════
eq("aucun format au départ", C.formatMemorise(), null);
C.memoriserFormat("pv");
eq("format mémorisé et relu", [C.formatMemorise(), monde.stockage.cip_copie_format], ["pv", "pv"]);
C.memoriserFormat("inconnu");
eq("format inconnu non mémorisé", C.formatMemorise(), "pv");
monde.stockage.cip_copie_format = "bidon";
eq("valeur inconnue en stockage ignorée", C.formatMemorise(), null);
monde.stockageRefuse = true;
eq("stockage refusé : aucun format, pas d'exception", (C.memoriserFormat("tab"), C.formatMemorise()), null);
monde.stockageRefuse = false; delete monde.stockage.cip_copie_format;

// ════════════════════════ 4. CipCell ════════════════════════
const h = M.cip({ cip: "3400999000011" });
vrai("tout l'élément est un bouton qui contient le numéro", /^<button[^>]*>.*3400999000011.*<\/button>$/.test(h), h);
vrai("titre « Cliquer pour copier le CIP », libellé « Copier le CIP … »", h.includes('title="Cliquer pour copier le CIP"') && h.includes('aria-label="Copier le CIP 3400999000011"'), h);
vrai("classes ex-cip (bouton), ex-cible (toucher 44 px), icône copier en CSS", /class="ex-cip ex-cible ex-ico ex-ico-copier"/.test(h), h);
vrai("numéro jamais sélectionnable avant un refus (anti-copie § 19)", !h.includes("ex-selectionnable"), h);
vrai("type=button (aucun envoi de formulaire), tabulable par défaut", h.includes('type="button"') && !h.includes("tabindex"), h);
vrai("tabulable={false} → hors tabulation", M.cip({ cip: "3400999000011", tabulable: false }).includes('tabindex="-1"'));
eq("sans CIP : tiret seul", [M.cip({ cip: null }).includes("–"), M.cip({ cip: "–" }).includes("<button")], [true, false]);
// clics : setters observés (React d'essai : useState ne met pas à jour, les appels des setters sont la trace)
setters.length = 0; monde.ecrits.length = 0;
boutons(E.CipCell({ cip: "3400999000028" }))[0].props.onClick({ currentTarget: { offsetWidth: 96 } });
await tick(); await tick();
eq("clic sur le numéro : CIP copié, largeur gardée, état « copie »", [monde.ecrits, setters.includes(96), setters.includes("copie"), setters.includes("echec")], [["3400999000028"], true, true, false]);
setters.length = 0; monde.refuser = true; monde.execOk = false;
boutons(E.CipCell({ cip: "3400999000028" }))[0].props.onClick({ currentTarget: { offsetWidth: 96 } });
await tick(); await tick();
eq("copie refusée : état « echec » puis CIP sélectionnable (manuel = true)", [setters.includes("echec"), setters.includes(true), setters.includes("copie")], [true, true, false]);
monde.refuser = false; monde.execOk = true;
const T2 = M.toast();
vrai("ToastCopie : région annoncée (status, polite) présente et vide au départ", /role="status"/.test(T2) && /aria-live="polite"/.test(T2) && !/copié/.test(T2), T2);

// ════════════════════════ 5. CopieCips ════════════════════════
const lignes = [{ cip: "3400999000011", qty: 6 }, { cip: "3400999000028", qty: 3 }, { cip: null, qty: 1 }];
const l0 = M.lot({ lignes: [{ cip: null, qty: 1 }] });
vrai("sans CIP : boutons désactivés", (l0.match(/disabled=""/g) || []).length === 2, l0);
const l1 = M.lot({ lignes });
vrai("« Copier les CIP » + « Format » (menu fermé), menu non rendu", l1.includes("Copier les CIP") && l1.includes('aria-haspopup="menu"') && l1.includes('aria-expanded="false"') && !l1.includes('role="menu"'), l1);
vrai("libellé personnalisable", M.lot({ lignes, libelle: "Copier les CIP de cette commande" }).includes("Copier les CIP de cette commande"));
const mn = M.menu({ format: "pv", onChoisir: () => {}, id: "m" });
eq("menu : 3 choix, le format courant coché", [(mn.match(/role="menuitemradio"/g) || []).length, (mn.match(/aria-checked="true"/g) || []).length, mn.includes("Un CIP par ligne") && mn.includes("CIP ; quantité") && mn.includes("tabulation")], [3, 1, true]);
const choisis = [];
boutons(E.MenuFormats({ format: null, onChoisir: (id) => choisis.push(id), id: "m" })).forEach((b) => b.props.onClick());
eq("menu : chaque choix appelle onChoisir avec son format", choisis, ["lignes", "pv", "tab"]);
// bouton principal : format mémorisé → copie immédiate au bon format, mémoire inchangée
monde.stockage.cip_copie_format = "pv"; setters.length = 0; monde.ecrits.length = 0; monde.evenements.length = 0;
const [principal, format] = boutons(E.CopieCips({ lignes }));
principal.props.onClick();
await tick(); await tick();
eq("format mémorisé : copie immédiate en CIP;quantité, « 2 CIP copiés » signalé", [monde.ecrits, monde.evenements, monde.stockage.cip_copie_format], [["3400999000011;6\n3400999000028;3"], ["2 CIP copiés"], "pv"]);
vrai("état « ok » posé sur le bouton", setters.some((s) => s && s.ok === true && s.n === 2));
format.props.onClick();
vrai("« Format » ouvre le menu", setters.includes(true));
// sans format mémorisé : le bouton principal ouvre le menu, rien n'est copié
delete monde.stockage.cip_copie_format; setters.length = 0; monde.ecrits.length = 0;
boutons(E.CopieCips({ lignes }))[0].props.onClick();
await tick();
eq("sans format mémorisé : menu ouvert, rien copié", [setters.includes(true), monde.ecrits], [true, []]);
// copie refusée : état { ok: false, texte } → champ à copier à la main
monde.stockage.cip_copie_format = "tab"; setters.length = 0; monde.refuser = true; monde.execOk = false;
boutons(E.CopieCips({ lignes }))[0].props.onClick();
await tick(); await tick();
vrai("copie refusée : texte proposé à la main (état ok=false, texte au format)", setters.some((s) => s && s.ok === false && s.texte === "3400999000011\t6\n3400999000028\t3"));
monde.refuser = false; monde.execOk = true; delete monde.stockage.cip_copie_format;
vrai("quantité servie (carte commande de l'assistant) dans le texte", C.texteCips([{ cip: "1", commande: 10, servi: 6 }], "pv") === "1;6");

// ════════════════════════ 6. anti-copie intact ════════════════════════
const css = lire("src/styles/tokens.css");
vrai("tokens.css : .ex-app toujours non sélectionnable", /\.ex-app \{ -webkit-user-select: none; user-select: none;/.test(css));
vrai("tokens.css : règle .ex-cip (bouton entier, icône à droite, tons copie / échec)", /\.ex-cip \{[^}]*flex-direction: row-reverse/.test(css) && css.includes(".ex-cip--copie") && css.includes(".ex-cip--echec"));
let refAnti = null;
try { refAnti = execFileSync("git", ["show", "origin/master:./src/anticopie.js"], { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { /* référence absente : contrôle sauté */ }
if (refAnti != null) vrai("src/anticopie.js identique à origin/master", refAnti === lire("src/anticopie.js"));

// ════════════════════════ 7. écrans de la pharmacie ════════════════════════
const src = (f) => lire(f);
const rend = (f, motif, label) => vrai(`${f} : ${label}`, (typeof motif === "string" ? src(f).includes(motif) : motif.test(src(f))), motif.toString());
const importe = (f) => vrai(`${f} importe CipCell`, /import CipCell(, \{[^}]*\})? from "\.{1,2}\/(components\/)?(ui\/)?CipCell\.jsx"/.test(src(f)));
for (const f of ["src/App.jsx", "src/components/OrderEntry.jsx", "src/components/MyOrdersPanel.jsx", "src/components/ShortExpiry.jsx", "src/components/WheelchairOrder.jsx",
  "src/components/LabJustifOrder.jsx", "src/components/GroupOrders.jsx", "src/components/assistant/Cartes.jsx"]) importe(f);
rend("src/App.jsx", "CIP <CipCell cip={item.cip} />", "ligne du panier : CIP copiable");
rend("src/App.jsx", "CIP <CipCell cip={p.cip} />", "recherche globale");
vrai("src/App.jsx : menus en tableau (≥ 10 cellules CipCell) et grille", (src("src/App.jsx").match(/<td style=\{tdStyle\}><CipCell cip=\{p\.cip\} \/><\/td>/g) || []).length >= 10 && src("src/App.jsx").includes("EAN : <CipCell cip={p.cip}/>"));
rend("src/components/OrderEntry.jsx", "<CipCell cip={p.cip} tabulable={false} />", "Saisie : hors tabulation (enchaînement − / quantité / + gardé)");
rend("src/components/MyOrdersPanel.jsx", "CIP <CipCell cip={it.cip} />", "lignes de Mes commandes");
rend("src/components/ShortExpiry.jsx", /<td className="ex-per-cip"[^>]*><CipCell cip=\{p\.cip\} \/><\/td>/, "Péremption courte : cellule CIP");
rend("src/components/WheelchairOrder.jsx", "CIP <CipCell cip={product.cip} />", "fauteuil choisi");
rend("src/components/LabJustifOrder.jsx", "CIP <CipCell cip={p.cip} />", "produits sur justificatif");
rend("src/components/GroupOrders.jsx", "CIP <CipCell cip={l.cip} />", "lignes d'une commande groupée");
rend("src/components/assistant/Cartes.jsx", "<CipCell cip={l.cip} />", "cartes de l'assistant (lignes de commande, facture, bon de livraison)");
vrai("src/components/assistant/Cartes.jsx : CipCell dans les lignes ET le récapitulatif de retour", (src("src/components/assistant/Cartes.jsx").match(/<CipCell cip=\{l\.cip\} \/>/g) || []).length === 2);
rend("src/App.jsx", "<CopieCips lignes={cartItems}", "panier : « Copier les CIP »");
rend("src/components/MyOrdersPanel.jsx", '<CopieCips lignes={items} libelle="Copier les CIP de cette commande"', "Mes commandes : « Copier les CIP de cette commande »");
rend("src/components/assistant/Cartes.jsx", "<CopieCips lignes={lignes}", "carte commande : « Copier les CIP » (quantités servies)");
rend("src/App.jsx", "copierTexte(lines).then((ok) =>", "bon de commande copié par copierTexte (repli presse-papiers)");
vrai("src/App.jsx : plus aucun navigator.clipboard.writeText sans garde côté pharmacie", !/navigator\.clipboard\.writeText\(lines\)/.test(src("src/App.jsx")));
rend("src/App.jsx", "<ToastCopie />", "message « CIP … copié » monté une fois");
rend("src/App.jsx", 'React.lazy(() => import("./components/MyOrdersPanel")', "Mes commandes chargée à la demande (budget du bundle)");
const zones = src("scripts/verifie-zones.mjs");
vrai("verifie-zones : clé cip_copie_format déclarée (CLES_AUTORISEES.cipCopie) et lot cipCopie", /cipCopie: \{ "localStorage\.getItem\(CLE_FORMAT": 1, "localStorage\.setItem\(CLE_FORMAT, id": 1 \}/.test(zones) && /cipCopie: \{ nom:/.test(zones));
vrai("verifie-zones : écart autorisé de handleCopy (copierTexte) déclaré", zones.includes('zone: "copie du bon de commande", lot: "copie des CIP (27/10/2026)", attente: "cipCopie"'));
vrai("src/cip-copie.js : une seule clé de stockage, cip_copie_format", (src("src/cip-copie.js").match(/localStorage\./g) || []).length === 2 && src("src/cip-copie.js").includes('const CLE_FORMAT = "cip_copie_format"'));

console.log(`\n${ok} OK${ko ? `, ${ko} KO` : ""}`);
process.exit(ko ? 1 : 0);
