// ── Assistant Elixir : règles de la fenêtre de présentation et du lanceur flottant ──
// Demande de Zineb Moulatif (19/10/2026), mot pour mot : « Mets une fenetre de dialogue qui s'affiche sur le site et pas
// seulement un onglet Assistant Elixir : la pharmacie ne sait pas de quoi il s'agit ».
// JS pur, sans dépendance (testé par scripts/banc/test-assistant-interface.mjs) ; chargé avec Aide.jsx, hors du bundle
// des pharmacies. Mémoire par compte (identite d'App : « p » + adresse de connexion ; jamais en saisie Elixir) :
//  • localStorage, clé assistant_presentation_<identite> : { vues, fini } — fini dès que l'assistant a été ouvert (par la
//    fenêtre ou par une autre entrée) ou sur « Ne plus afficher » ; vues : affichages déjà faits, VUES_MAX au plus (la
//    première fois, puis 2 retours à des sessions suivantes après « Plus tard ») ;
//  • sessionStorage, même clé : « 1 » dès l'affichage dans l'onglet (« Plus tard », Échap, page rechargée : plus rien
//    jusqu'à la prochaine session).
// Stockage illisible (cookies bloqués, navigation privée stricte) : pas de fenêtre, sinon elle reviendrait à chaque page.

export const VUES_MAX = 3;
// la fenêtre attend ce délai de calme (catalogue affiché, aucune autre fenêtre ouverte, ni frappe ni clic), en ms
export const DELAI_PRESENTATION = 2500;
export const clePresentation = (identite) => `assistant_presentation_${identite}`;

// → { vues, fini, session } ; null si le stockage est illisible
export function litPresentation(identite) {
  try {
    const v = JSON.parse(localStorage.getItem(clePresentation(identite)) || "{}") || {};
    return { vues: Math.max(0, Math.floor(Number(v.vues)) || 0), fini: v.fini === true,
      session: sessionStorage.getItem(clePresentation(identite)) === "1" };
  } catch { return null; }
}
function ecrit(identite, { vues, fini }) {
  try { localStorage.setItem(clePresentation(identite), JSON.stringify({ vues, fini })); } catch { /* stockage plein ou bloqué */ }
}

// fenêtre à présenter dans cet onglet ?
export function aPresenter(identite) {
  const e = identite ? litPresentation(identite) : null;
  return !!e && !e.fini && !e.session && e.vues < VUES_MAX;
}

// fenêtre affichée : une vue de plus, et plus rien pour le reste de la session
export function noterVue(identite) {
  const e = litPresentation(identite);
  if (!e) return;
  ecrit(identite, { ...e, vues: e.vues + 1 });
  try { sessionStorage.setItem(clePresentation(identite), "1"); } catch { /* rien */ }
}

// assistant ouvert, ou « Ne plus afficher » : plus jamais de fenêtre pour ce compte
export function noterFini(identite) {
  const e = identite ? litPresentation(identite) : null;
  if (e && !e.fini) ecrit(identite, { ...e, fini: true });
}

// Champ qui ouvre le clavier d'un écran tactile (Saisie de commande, recherche, quantités) : le lanceur s'efface tant
// qu'il a le focus, pour ne recouvrir ni la saisie ni les boutons de quantité
const NON_TEXTE = /^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i;
export const champSaisie = (el) => !!el && (el.isContentEditable === true || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
  || (el.tagName === "INPUT" && !NON_TEXTE.test(el.type || "")));

// Tab gardé dans une fenêtre : élément qui doit prendre le focus (boucle aux deux bouts), null si Tab suit son cours.
// els : éléments focusables de la fenêtre dans l'ordre ; actif : élément qui a le focus ; arriere : Maj+Tab
export function focusSuivant(els, actif, arriere) {
  if (!els.length) return null;
  const i = els.indexOf(actif);
  if (i < 0) return arriere ? els[els.length - 1] : els[0];   // focus sur la fenêtre elle-même ou hors d'elle
  if (arriere && i === 0) return els[els.length - 1];
  if (!arriere && i === els.length - 1) return els[0];
  return null;
}
