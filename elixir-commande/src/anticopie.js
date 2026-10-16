// ── Anti-copie du site client (lot A : docs/refonte-charte.md § 19) ──
// Demande de la cliente (16/10/2026) : rendre la copie du catalogue, des prix et des conditions aussi malaisée que
// possible, sans gêner la commande ni l'accessibilité. Complète la règle CSS « Anti-copie » de src/styles/tokens.css
// (contenu non sélectionnable sous .ex-app, photos qu'on ne peut pas glisser) :
//  - copier / couper : sans effet hors des champs de saisie et des zones .ex-selectionnable ;
//  - menu contextuel (clic droit, toucher long) : bloqué sur les photos et sur le contenu ; permis dans les champs
//    (coller dans la recherche) et sur les liens ;
//  - glisser une photo ou un texte hors de la page : bloqué ;
//  - Ctrl/Cmd+A hors des champs, Ctrl/Cmd+S (enregistrer la page), Ctrl/Cmd+U (code source) : sans effet.
// Jamais bloqués : l'impression (Ctrl/Cmd+P, bouton Imprimer), la tabulation et les autres raccourcis, les lecteurs
// d'écran (ils lisent l'arbre d'accessibilité, pas la sélection), les boutons « Copier » (navigator.clipboard.writeText
// ne déclenche aucun événement copy). Rien dans l'admin (#admin, .ex-admin) : ses utilisateurs copient librement.
// Pas de détection des outils de développement. Une capture d'écran, le code source ou une impression en PDF restent
// possibles : c'est un frein à la copie facile, pas une protection absolue.

// champs de saisie : copier, couper, coller, tout sélectionner et menu contextuel y restent permis
const CHAMPS = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

// élément d'un nœud (un nœud texte renvoie son parent)
const elementDe = (n) => (n && n.nodeType === 1 ? n : n?.parentElement || null);

const dansChamp = (el) => !!el?.closest?.(CHAMPS);

// admin affiché (#admin, connexion ou back-office, rendus dans l'arbre d'App) : aucune protection
const enAdmin = () => window.location.hash === "#admin" || !!document.querySelector(".ex-admin");

// le nœud fait-il partie du contenu protégé du site client ? Hors champs, hors .ex-selectionnable, hors admin ;
// body, html et #root (ancêtres de .ex-app) comptent comme le site client. L'écran d'identification et l'écran
// d'erreur (sans .ex-app) restent libres : ils ne montrent ni catalogue ni prix.
function protege(n) {
  const el = elementDe(n);
  if (!el || dansChamp(el) || el.closest(".ex-admin, .ex-selectionnable")) return false;
  if (el.closest(".ex-app")) return true;
  const app = document.querySelector(".ex-app");
  return !!app && el.contains(app);
}

// lettre d'un raccourci selon la disposition du clavier (AZERTY : e.key) ; avec Cmd+Option (Mac), e.key donne un
// caractère composé (« ¨ »…) : on prend alors la position de la touche (U est au même endroit en AZERTY et QWERTY)
function lettre(e) {
  const k = (e.key || "").toLowerCase();
  if (/^[a-z]$/.test(k)) return k;
  if (e.metaKey && e.altKey && /^Key[A-Z]$/.test(e.code || "")) return e.code.slice(3).toLowerCase();
  return "";
}

function surCopie(e) {
  if (enAdmin() || dansChamp(document.activeElement)) return;
  const sel = window.getSelection?.();
  const noeuds = sel && !sel.isCollapsed ? [sel.anchorNode, sel.focusNode] : [e.target];
  if (noeuds.some(protege)) e.preventDefault();   // rien n'est écrit dans le presse-papiers
}

function surMenuContextuel(e) {
  if (enAdmin()) return;
  const el = elementDe(e.target);
  if (!protege(el)) return;
  // photos produit : jamais (« Enregistrer l'image », « Copier l'image »), même dans un lien
  if (el.tagName !== "IMG" && el.closest("a[href]")) return;
  e.preventDefault();
}

function surGlisser(e) {
  if (enAdmin()) return;
  const el = elementDe(e.target);
  if (el?.closest("[draggable='true']")) return;   // glisser-déposer voulu (aucun côté client aujourd'hui)
  if (protege(el)) e.preventDefault();
}

function surClavier(e) {
  if (!(e.ctrlKey || e.metaKey) || e.isComposing) return;
  if (e.ctrlKey && e.altKey) return;   // Ctrl+Alt = AltGr (Windows, Linux) : saisie d'un caractère, pas un raccourci
  const l = lettre(e);
  if (l === "a" && !e.shiftKey && !e.altKey) {
    if (!enAdmin() && protege(document.activeElement || document.body)) e.preventDefault();   // tout sélectionner
  } else if (l === "s" || (l === "u" && !e.shiftKey)) {
    if (!enAdmin()) e.preventDefault();   // enregistrer la page, afficher le code source
  }
}

let installe = false;
// Installé une fois par src/main.jsx ; écouteurs en phase de capture sur window : un stopPropagation d'un composant
// ne les contourne pas, et ils ne font qu'empêcher l'action par défaut (aucun stopPropagation, les gestionnaires de
// l'app s'exécutent comme avant).
export function installeAntiCopie() {
  if (installe) return;
  installe = true;
  window.addEventListener("copy", surCopie, true);
  window.addEventListener("cut", surCopie, true);
  window.addEventListener("contextmenu", surMenuContextuel, true);
  window.addEventListener("dragstart", surGlisser, true);
  window.addEventListener("keydown", surClavier, true);
}
