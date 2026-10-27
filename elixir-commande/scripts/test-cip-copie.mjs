// Tests de la copie des CIP (27/10/2026, docs/cip-copie.md) : node scripts/test-cip-copie.mjs
// Hors ligne, rien n'est lu ni écrit ailleurs qu'en mémoire (presse-papiers, document et stockage simulés). Contrôles :
//  1. formats de collage (src/cip-copie.js) : un CIP par ligne, CIP;quantité, CIP ⇥ quantité ; lignes sans CIP écartées ;
//     quantité servie préférée quand elle est connue (servi), sinon commandée (qty, quantite, commande) ; format inconnu → un par ligne ;
//     un même CIP sur deux lignes (ligne normale + péremption courte) → une ligne, quantités additionnées ;
//  2. presse-papiers (copierTexte) : navigator.clipboard, repli textarea + execCommand quand il est refusé ou absent (champ retiré
//     après coup, focus rendu à l'élément actif, repli synchrone quand le presse-papiers est absent), échec sans exception ;
//     copierCip signale « CIP … copié » (événement ex-copie, ton ok) ou « Copie impossible… » (ton danger) ;
//  3. format mémorisé (localStorage simulé) : relu, valeur inconnue ignorée, stockage refusé sans exception ;
//  4. CipCell (rendu HTML) : tout l'élément est un bouton (titre « Cliquer pour copier le CIP », libellé, Entrée/Espace natifs),
//     le numéro n'est JAMAIS sélectionnable (aucun ex-selectionnable avant un refus), tabulable={false} → tabindex -1, tiret sans CIP ;
//     clics (React d'essai) : le clic ne remonte pas au conteneur ; copie réussie → état « copie » ; refusée → « Copie impossible »
//     rendu sur le bouton entier (état echec, pas encore sélectionnable), PUIS après 2,5 s CIP sélectionnable avec « à sélectionner » ;
//  5. CopieCips (rendu HTML et clics) : désactivé sans CIP, format mémorisé → copie immédiate au bon format, sans format → menu ouvert
//     (bouton principal aria-haspopup / aria-expanded), menu des formats (3 choix, coché = format courant, choix → onChoisir, flèches),
//     libellé court sous 768 px et ligne d'aide, marges extérieures sur la racine, ToastCopie : région annoncée vide au départ ;
//  6. anti-copie intact : .ex-app en user-select: none, règle .ex-cip présente, message en bas positionné en CSS (calé à gauche sur
//     mobile), src/anticopie.js identique à la référence ;
//  7. chaque écran de la pharmacie qui montre un CIP rend CipCell (texte des sources) : panier, Saisie (hors tabulation), recherche
//     globale et menus, suggestions de recommande (App), Mes commandes, Péremption courte, fauteuils, justificatif labo, commandes
//     groupées, cartes de l'assistant (lignes de la carte commande et récapitulatif de retour) ; « Copier les CIP » au panier, dans
//     Mes commandes et sur la carte commande ; le bon de commande copié passe par copierTexte et s'appelle « Copier le bon » ;
//     ToastCopie montée dans App ; fenêtre d'attente de Mes commandes fermable ; clé de stockage déclarée dans scripts/verifie-zones.mjs.
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

// ── Monde simulé : presse-papiers, document (textarea + execCommand, élément actif), stockage, événements ──
const monde = { ecrits: [], refuser: false, sansClipboard: false, execOk: true, exec: 0, stockage: {}, stockageRefuse: false, evenements: [], tons: [], focusRendu: 0 };
const cible = new EventTarget();
Object.defineProperty(globalThis, "dispatchEvent", { value: (e) => cible.dispatchEvent(e), configurable: true, writable: true });
Object.defineProperty(globalThis, "addEventListener", { value: (...a) => cible.addEventListener(...a), configurable: true, writable: true });
Object.defineProperty(globalThis, "removeEventListener", { value: (...a) => cible.removeEventListener(...a), configurable: true, writable: true });
cible.addEventListener("ex-copie", (e) => { monde.evenements.push(e.detail?.message ?? e.detail); monde.tons.push(e.detail?.ton); });
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => monde.sansClipboard ? {} : ({
  clipboard: { writeText: (t) => monde.refuser ? Promise.reject(new Error("refusé")) : (monde.ecrits.push(t), Promise.resolve()) } }) });
const faitElement = () => { const el = { value: "", attrs: {}, style: {}, parent: null, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, select() { el.selectionne = true; }, setSelectionRange() {}, remove() { if (el.parent) el.parent.enfants = el.parent.enfants.filter((x) => x !== el); } }; return el; };
const actif = { focus(o) { monde.focusRendu++; monde.focusOptions = o; } };   // champ de quantité de la Saisie, bouton de Mes commandes…
const doc = { body: { enfants: [], appendChild(el) { el.parent = this; this.enfants.push(el); } }, createElement: () => faitElement(), activeElement: actif,
  execCommand: (c) => { monde.exec++; return c === "copy" && monde.execOk; }, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, "document", { configurable: true, get: () => doc });
Object.defineProperty(globalThis, "window", { configurable: true, get: () => globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => ({
  getItem: (k) => { if (monde.stockageRefuse) throw new Error("refusé"); return monde.stockage[k] ?? null; },
  setItem: (k, v) => { if (monde.stockageRefuse) throw new Error("refusé"); monde.stockage[k] = String(v); } }) });

// ── Modules : avec React (rendu HTML) et avec un React d'essai (arbre d'éléments, clics appelés à la main, setters observés,
// états initiaux imposables par globalThis.__etats pour rendre un état donné) ──
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
    const useState = (v) => { const seeds = globalThis.__etats; const val = seeds && seeds.length ? seeds.shift() : (typeof v === "function" ? v() : v); return [val, (nv) => globalThis.__setters.push(typeof nv === "function" ? nv(val) : nv)]; };
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
const textes = (n, out = []) => {
  if (Array.isArray(n)) { n.forEach((x) => textes(x, out)); return out; }
  if (typeof n === "string" || typeof n === "number") { out.push(String(n)); return out; }
  if (n && typeof n === "object") textes(n.props?.children, out);
  return out;
};
const boutons = (arbre) => elements(arbre).filter((e) => e.type === "button");
const classes = (arbre) => elements(arbre).map((e) => String(e.props?.className || "")).join(" ");
const rendu = (Comp, props, etats) => { globalThis.__etats = [...etats]; const a = Comp(props); globalThis.__etats = null; return a; };
// minuteries longues (≥ 1 s : messages « copié » / « impossible ») capturées pour être déclenchées à la main
const minuteries = [];
const vraiSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? (minuteries.push({ fn, ms }), 0) : vraiSetTimeout(fn, ms, ...a));

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
// un même CIP sur deux lignes (ligne normale + ligne « péremption courte » à part) : une ligne, quantités additionnées, ordre de la première
eq("même CIP sur deux lignes → une ligne, quantités additionnées", C.texteCips([{ cip: "3400999000011", qty: 3 }, { cip: "3400999000028", qty: 1 }, { cip: "3400999000011", qty: 2, peremption: "2026-12-31" }], "pv"), "3400999000011;5\n3400999000028;1");
eq("même CIP : un seul dans la liste « un par ligne »", C.texteCips([{ cip: "1", qty: 3 }, { cip: "1", qty: 2 }], "lignes"), "1");

// ════════════════════════ 2. presse-papiers ════════════════════════
eq("navigator.clipboard : écrit, vrai", [await C.copierTexte("abc"), monde.ecrits], [true, ["abc"]]);
monde.refuser = true; monde.focusRendu = 0;
eq("refusé → repli textarea + execCommand : vrai, champ retiré, focus rendu à l'élément actif (sans défilement)", [await C.copierTexte("def"), monde.exec, doc.body.enfants.length, monde.focusRendu, monde.focusOptions], [true, 1, 0, 1, { preventScroll: true }]);
monde.execOk = false;
eq("refusé et repli en échec → faux, sans exception", [await C.copierTexte("ghi"), doc.body.enfants.length], [false, 0]);
monde.refuser = false; monde.execOk = true; monde.sansClipboard = true;
const execAvant = monde.exec;
const promesse = C.copierTexte("jkl");
vrai("navigator.clipboard absent → repli synchrone, dans le geste (execCommand déjà appelé)", monde.exec - execAvant === 1);
eq("navigator.clipboard absent → repli : vrai", await promesse, true);
eq("ni presse-papiers ni document → faux", await C.copierTexte("x", { doc: null, nav: null }), false);
monde.sansClipboard = false;
monde.evenements.length = 0; monde.tons.length = 0;
eq("copierCip : CIP écrit et « CIP … copié » signalé (ton ok)", [await C.copierCip("3400999000011"), monde.ecrits.at(-1), monde.evenements, monde.tons], [true, "3400999000011", ["CIP 3400999000011 copié"], ["ok"]]);
monde.refuser = true; monde.execOk = false; monde.evenements.length = 0; monde.tons.length = 0;
eq("copierCip refusé : faux, « Copie impossible… » signalé en ton danger", [await C.copierCip("3400999000011"), monde.evenements, monde.tons], [false, ["Copie impossible : sélectionnez le numéro pour le copier"], ["danger"]]);
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
setters.length = 0; monde.ecrits.length = 0; minuteries.length = 0;
let propage = 0;
boutons(E.CipCell({ cip: "3400999000028" }))[0].props.onClick({ currentTarget: { offsetWidth: 96 }, stopPropagation: () => propage++ });
await tick(); await tick();
eq("clic sur le numéro : propagation arrêtée (carte cliquable non déclenchée), CIP copié, largeur gardée, état « copie »", [propage, monde.ecrits, setters.includes(96), setters.includes("copie"), setters.includes("echec")], [1, ["3400999000028"], true, true, false]);
eq("« CIP copié » : retour au numéro après 1,5 s", minuteries.map((m) => m.ms), [1500]);
setters.length = 0; minuteries.length = 0; monde.refuser = true; monde.execOk = false;
boutons(E.CipCell({ cip: "3400999000028" }))[0].props.onClick({ currentTarget: { offsetWidth: 96 } });
await tick(); await tick();
eq("copie refusée : état « echec » posé, PAS encore sélectionnable (manuel non posé dans le même rendu)", [setters.includes("echec"), setters.includes(true), setters.includes("copie"), minuteries.map((m) => m.ms)], [true, false, false, [2500]]);
setters.length = 0; minuteries.shift().fn();
eq("après 2,5 s : message retiré puis CIP sélectionnable (manuel = true)", [setters.includes(null), setters.includes(true)], [true, true]);
monde.refuser = false; monde.execOk = true;
// rendu des états : « Copie impossible » sur le bouton entier (echec, non sélectionnable), puis le repli sélectionnable avec sa mention
const echec = rendu(E.CipCell, { cip: "3400999000028" }, ["echec", false, 96]);
vrai("état echec : « Copie impossible » rendu sur le bouton entier (ex-cip--echec), aucun ex-selectionnable", textes(echec).includes("Copie impossible") && classes(echec).includes("ex-cip--echec") && !classes(echec).includes("ex-selectionnable"), JSON.stringify(textes(echec)));
const manuel = rendu(E.CipCell, { cip: "3400999000028" }, [null, true, 0]);
vrai("repli : numéro sélectionnable, mention « à sélectionner », bouton « Réessayer »", classes(manuel).includes("ex-selectionnable") && textes(manuel).includes("à sélectionner") && boutons(manuel)[0].props.title === "Réessayer la copie", JSON.stringify(textes(manuel)));
const T2 = M.toast();
vrai("ToastCopie : région annoncée (status, polite) présente et vide au départ, positionnée par la classe ex-toast-copie", /role="status"/.test(T2) && /aria-live="polite"/.test(T2) && /class="ex-toast-copie"/.test(T2) && !/copié/.test(T2), T2);

// ════════════════════════ 5. CopieCips ════════════════════════
const lignes = [{ cip: "3400999000011", qty: 6 }, { cip: "3400999000028", qty: 3 }, { cip: null, qty: 1 }];
const l0 = M.lot({ lignes: [{ cip: null, qty: 1 }] });
vrai("sans CIP : boutons désactivés", (l0.match(/disabled=""/g) || []).length === 2, l0);
const l1 = M.lot({ lignes });
vrai("« Copier les CIP » + « Format » (menu fermé), menu non rendu", l1.includes("Copier les CIP") && l1.includes('aria-haspopup="menu"') && l1.includes('aria-expanded="false"') && !l1.includes('role="menu"'), l1);
vrai("sans format mémorisé : le bouton principal annonce son menu (aria-haspopup, aria-expanded)", (l1.match(/aria-haspopup="menu"/g) || []).length === 2, l1);
monde.stockage.cip_copie_format = "pv";
vrai("format mémorisé : seul « Format » annonce un menu, title du principal nomme le format", (M.lot({ lignes }).match(/aria-haspopup="menu"/g) || []).length === 1 && M.lot({ lignes }).includes("Copier les CIP — CIP ; quantité"));
delete monde.stockage.cip_copie_format;
const lc = M.lot({ lignes, libelle: "Copier les CIP de cette commande", libelleCourt: "Copier les CIP" });
vrai("libellé long (ordinateur) et court (mobile) rendus, title et aria-label gardent le long", lc.includes('class="ex-copie-cips__long"') && lc.includes('class="ex-copie-cips__court"') && lc.includes('aria-label="Copier les CIP de cette commande"'), lc);
const la = M.lot({ lignes, libelle: "Copier les CIP", aide: "quantités servies" });
vrai("ligne d'aide sous le bouton, reprise dans title / aria-label", la.includes(">Quantités servies<") && la.includes('aria-label="Copier les CIP (quantités servies)"'), la);
const lm = M.lot({ lignes, style: { marginTop: 8, height: 40 } });
vrai("marges extérieures du style sur la racine (pas sur le seul bouton principal) ; hauteur reprise par « Format »", /class="ex-copie-cips" style="[^"]*margin-top:8px/.test(lm) && (lm.match(/height:40px/g) || []).length === 2, lm);
vrai("racine bornée par son conteneur (max-width 100 %, min-width 0)", /class="ex-copie-cips" style="[^"]*max-width:100%[^"]*min-width:0/.test(lm), lm);
const mn = M.menu({ format: "pv", onChoisir: () => {}, id: "m" });
eq("menu : 3 choix, le format courant coché", [(mn.match(/role="menuitemradio"/g) || []).length, (mn.match(/aria-checked="true"/g) || []).length, mn.includes("Un CIP par ligne") && mn.includes("CIP ; quantité") && mn.includes("tabulation")], [3, 1, true]);
const choisis = [];
const arbreMenu = E.MenuFormats({ format: null, onChoisir: (id) => choisis.push(id), id: "m" });
boutons(arbreMenu).forEach((b) => b.props.onClick());
eq("menu : chaque choix appelle onChoisir avec son format", choisis, ["lignes", "pv", "tab"]);
vrai("menu : navigation au clavier (flèches, Début, Fin) sur le menu", typeof arbreMenu.props.onKeyDown === "function");
// bouton principal : format mémorisé → copie immédiate au bon format, mémoire inchangée
monde.stockage.cip_copie_format = "pv"; setters.length = 0; monde.ecrits.length = 0; monde.evenements.length = 0;
const [principal, format] = boutons(E.CopieCips({ lignes }));
principal.props.onClick();
await tick(); await tick();
eq("format mémorisé : copie immédiate en CIP;quantité, « 2 CIP copiés » signalé", [monde.ecrits, monde.evenements, monde.stockage.cip_copie_format], [["3400999000011;6\n3400999000028;3"], ["2 CIP copiés"], "pv"]);
vrai("état « ok » posé sur le bouton", setters.some((s) => s && s.ok === true && s.n === 2));
format.props.onClick({ currentTarget: {} });
vrai("« Format » ouvre le menu", setters.includes(true));
// sans format mémorisé : le bouton principal ouvre le menu, rien n'est copié
delete monde.stockage.cip_copie_format; setters.length = 0; monde.ecrits.length = 0;
boutons(E.CopieCips({ lignes }))[0].props.onClick({ currentTarget: {} });
await tick();
eq("sans format mémorisé : menu ouvert, rien copié", [setters.includes(true), monde.ecrits], [true, []]);
// copie refusée : état { ok: false, texte } → champ à copier à la main, message en bas en ton danger
monde.stockage.cip_copie_format = "tab"; setters.length = 0; monde.refuser = true; monde.execOk = false; monde.tons.length = 0;
boutons(E.CopieCips({ lignes }))[0].props.onClick();
await tick(); await tick();
vrai("copie refusée : texte proposé à la main (état ok=false, texte au format), message en ton danger", setters.some((s) => s && s.ok === false && s.texte === "3400999000011\t6\n3400999000028\t3") && monde.tons.includes("danger"));
monde.refuser = false; monde.execOk = true; delete monde.stockage.cip_copie_format;
vrai("quantité servie (carte commande de l'assistant) dans le texte", C.texteCips([{ cip: "1", commande: 10, servi: 6 }], "pv") === "1;6");
globalThis.setTimeout = vraiSetTimeout;

// ════════════════════════ 6. anti-copie intact ════════════════════════
const css = lire("src/styles/tokens.css");
vrai("tokens.css : .ex-app toujours non sélectionnable", /\.ex-app \{ -webkit-user-select: none; user-select: none;/.test(css));
vrai("tokens.css : règle .ex-cip (bouton entier, icône à droite, tons copie / échec)", /\.ex-cip \{[^}]*flex-direction: row-reverse/.test(css) && css.includes(".ex-cip--copie") && css.includes(".ex-cip--echec"));
vrai("tokens.css : message en bas positionné en CSS, calé à gauche sous 768 px (colonne du panier flottant libre)", /\.ex-toast-copie \{ position: fixed; left: 50%;[^}]*pointer-events: none/.test(css) && /@media \(max-width: 767px\) \{ \.ex-toast-copie \{ left: 16px; transform: none; max-width: calc\(100vw - 16px - 96px\); \} \}/.test(css));
vrai("tokens.css : libellé long masqué sous 768 px, court masqué au-dessus", css.includes("@media (max-width: 767px) { .ex-copie-cips__long { display: none; } }") && css.includes("@media (min-width: 768px) { .ex-copie-cips__court { display: none; } }"));
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
rend("src/App.jsx", "CIP <CipCell cip={s.cip} />", "suggestions de recommande (carte cliquable : le clic sur le CIP n'ajoute pas au panier)");
vrai("src/App.jsx : plus aucun CIP en texte brut dans les suggestions", !/CIP \{s\.cip\}/.test(src("src/App.jsx")));
vrai("src/App.jsx : menus en tableau (≥ 10 cellules CipCell) et grille", (src("src/App.jsx").match(/<td style=\{tdStyle\}><CipCell cip=\{p\.cip\} \/><\/td>/g) || []).length >= 10 && src("src/App.jsx").includes("EAN : <CipCell cip={p.cip}/>"));
rend("src/components/OrderEntry.jsx", "<CipCell cip={p.cip} tabulable={false} />", "Saisie : hors tabulation (enchaînement − / quantité / + gardé)");
rend("src/components/MyOrdersPanel.jsx", "CIP <CipCell cip={it.cip} />", "lignes de Mes commandes");
rend("src/components/ShortExpiry.jsx", /<td className="ex-per-cip"[^>]*><CipCell cip=\{p\.cip\} \/><\/td>/, "Péremption courte : cellule CIP");
rend("src/components/WheelchairOrder.jsx", "CIP <CipCell cip={product.cip} />", "fauteuil choisi");
rend("src/components/LabJustifOrder.jsx", "CIP <CipCell cip={p.cip} />", "produits sur justificatif");
rend("src/components/GroupOrders.jsx", "CIP <CipCell cip={l.cip} />", "lignes d'une commande groupée");
rend("src/components/assistant/Cartes.jsx", "<CipCell cip={l.cip} />", "cartes de l'assistant : lignes de la carte commande et récapitulatif de retour");
vrai("src/components/assistant/Cartes.jsx : CipCell dans les lignes de la carte commande ET le récapitulatif de retour", (src("src/components/assistant/Cartes.jsx").match(/<CipCell cip=\{l\.cip\} \/>/g) || []).length === 2);
rend("src/App.jsx", "<CopieCips lignes={cartItems}", "panier : « Copier les CIP »");
rend("src/components/MyOrdersPanel.jsx", '<CopieCips lignes={items} libelle="Copier les CIP de cette commande" libelleCourt="Copier les CIP"', "Mes commandes : « Copier les CIP de cette commande », court sur mobile");
rend("src/components/assistant/Cartes.jsx", '<CopieCips lignes={lignes} libelle="Copier les CIP" aide="quantités servies"', "carte commande : « Copier les CIP », précision « quantités servies » en aide");
rend("src/App.jsx", "copierTexte(lines).then((ok) =>", "bon de commande copié par copierTexte (repli presse-papiers)");
vrai("src/App.jsx : plus aucun navigator.clipboard.writeText sans garde côté pharmacie", !/navigator\.clipboard\.writeText\(lines\)/.test(src("src/App.jsx")));
rend("src/App.jsx", 'taille={18} />Copier le bon</>', "panier : le bouton du bon dit « Copier le bon » (deux « Copier » superposés sinon)");
rend("src/App.jsx", "<ToastCopie />", "message « CIP … copié » monté une fois");
vrai("src/App.jsx : fenêtre d'attente de Mes commandes fermable (clic dehors, « Fermer » avec focus initial) et morceau préchargé",
  /function MesCommandesAttente\(\{ onClose \}\)[\s\S]*?onClick=\{onClose\}[\s\S]*?data-focus-initial onClick=\{onClose\}/.test(src("src/App.jsx")) && src("src/App.jsx").includes("fallback={<MesCommandesAttente onClose={() => setShowMyOrders(false)} />}") && src("src/App.jsx").includes("ric(prechargerMesCommandes"));
const zones = src("scripts/verifie-zones.mjs");
vrai("verifie-zones : clé cip_copie_format déclarée (CLES_AUTORISEES.cipCopie) et lot cipCopie", /cipCopie: \{ "localStorage\.getItem\(CLE_FORMAT": 1, "localStorage\.setItem\(CLE_FORMAT, id": 1 \}/.test(zones) && /cipCopie: \{ nom:/.test(zones));
vrai("verifie-zones : écart autorisé de handleCopy (copierTexte) déclaré", zones.includes('zone: "copie du bon de commande", lot: "copie des CIP (27/10/2026)", attente: "cipCopie"'));
vrai("src/cip-copie.js : une seule clé de stockage, cip_copie_format", (src("src/cip-copie.js").match(/localStorage\./g) || []).length === 2 && src("src/cip-copie.js").includes('const CLE_FORMAT = "cip_copie_format"'));

console.log(`\n${ok} OK${ko ? `, ${ko} KO` : ""}`);
process.exit(ko ? 1 : 0);
