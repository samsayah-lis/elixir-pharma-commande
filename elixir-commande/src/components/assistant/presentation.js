// ── Assistant Elixir : règles de la fenêtre de présentation et du lanceur flottant ──
// Demande de Zineb Moulatif (19/10/2026), mot pour mot : « Mets une fenetre de dialogue qui s'affiche sur le site et pas
// seulement un onglet Assistant Elixir : la pharmacie ne sait pas de quoi il s'agit ».
// JS pur, sans dépendance (testé par scripts/banc/test-assistant-interface.mjs) ; chargé avec Aide.jsx, hors du bundle
// des pharmacies. Mémoire par compte (identite d'App : « p » + adresse de connexion ; jamais en saisie Elixir) :
//  • localStorage, clé assistant_presentation_<identite> : { vues, fini, derniere } — fini dès que l'assistant a été
//    ouvert (par la fenêtre ou par une autre entrée) ou sur « Ne plus afficher » ; vues : affichages déjà faits, VUES_MAX
//    au plus (la première fois, puis 2 retours à des sessions suivantes après « Plus tard ») ; derniere : heure du dernier
//    affichage (ms) — un retour attend ECART_RETOUR (20 h) : les liens des mailings ouvrent chacun un nouvel onglet, donc
//    une nouvelle « session » au sens du navigateur, et la fenêtre ne doit pas y revenir trois fois en quelques minutes ;
//  • sessionStorage, même clé : « 1 » dès l'affichage dans l'onglet (« Plus tard », Échap, page rechargée : plus rien
//    jusqu'à la prochaine session).
// Stockage illisible (cookies bloqués, navigation privée stricte) : pas de fenêtre, sinon elle reviendrait à chaque page.

export const VUES_MAX = 3;
// délai minimal entre deux affichages (« une session suivante » = un autre jour, en pratique)
export const ECART_RETOUR = 20 * 3600e3;
// la fenêtre attend ce délai de calme (catalogue affiché, aucune autre fenêtre ouverte, ni frappe, ni clic, ni
// défilement, aucun champ rempli en cours de saisie), en ms ; la boucle d'attente avance par PAS_ATTENTE
export const DELAI_PRESENTATION = 2500;
export const PAS_ATTENTE = 500;
export const clePresentation = (identite) => `assistant_presentation_${identite}`;

// → { vues, fini, derniere, session } ; null si le stockage est illisible
export function litPresentation(identite) {
  try {
    const v = JSON.parse(localStorage.getItem(clePresentation(identite)) || "{}") || {};
    return { vues: Math.max(0, Math.floor(Number(v.vues)) || 0), fini: v.fini === true, derniere: Math.max(0, Number(v.derniere) || 0),
      session: sessionStorage.getItem(clePresentation(identite)) === "1" };
  } catch { return null; }
}
function ecrit(identite, { vues, fini, derniere }) {
  try { localStorage.setItem(clePresentation(identite), JSON.stringify({ vues, fini, derniere })); } catch { /* stockage plein ou bloqué */ }
}

// fenêtre à présenter dans cet onglet ? (maintenant : ms, remplaçable pour les tests)
export function aPresenter(identite, maintenant = Date.now()) {
  const e = identite ? litPresentation(identite) : null;
  if (!e || e.fini || e.session || e.vues >= VUES_MAX) return false;
  const ecoule = maintenant - e.derniere;
  return ecoule >= ECART_RETOUR || ecoule < 0;   // ecoule < 0 : horloge du poste reculée, on ne bloque pas pour autant
}

// fenêtre affichée : une vue de plus, son heure, et plus rien pour le reste de la session
export function noterVue(identite, maintenant = Date.now()) {
  const e = litPresentation(identite);
  if (!e) return;
  ecrit(identite, { ...e, vues: e.vues + 1, derniere: maintenant });
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
// champ en cours de saisie (rempli) : la fenêtre ne lui prend pas le focus (sur téléphone, le clavier se fermerait)
export const champRempli = (el) => champSaisie(el) && el.tagName !== "SELECT" && !!(el.isContentEditable ? el.textContent : el.value);

// Un pas de la boucle d'attente de la fenêtre → { calme, suite } ; suite : "attendre", "afficher" ou "abandonner".
// occupe : autre fenêtre ouverte, onglet caché, activité récente ou champ rempli (le calme repart de zéro) ;
// charge / echec : morceau Presentation préchargé, ou introuvable (nouvelle version du site mise en ligne pendant que la
// page était ouverte, connexion coupée) — dans ce cas pas de fenêtre et aucun affichage compté : le lanceur reste là.
export function pasAttente({ calme, occupe, charge, echec }) {
  if (echec) return { calme: 0, suite: "abandonner" };
  const c = occupe ? 0 : calme + PAS_ATTENTE;
  return { calme: c, suite: c >= DELAI_PRESENTATION && charge ? "afficher" : "attendre" };
}

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

// ── Place du lanceur au repos : il ne se pose jamais sur un bouton ou un champ de la page ──
// Revue du 19/10/2026 : la pastille de 271 px recouvrait la colonne « − / quantité / + » sur ordinateur, la bulle les
// « + » sur téléphone. Au repos (défilement arrêté, page modifiée, fenêtre redimensionnée), on sonde la page sous le
// lanceur (elementsFromPoint) : pastille si sa place est libre (haut de page, ordinateur et tablette), sinon bulle de
// 52 px sur l'axe du panier flottant si la sienne l'est, sinon masqué jusqu'au prochain repos. Le bouton de l'en-tête,
// lui, reste toujours visible.
// Points sondés dans un rectangle { left, top, right, bottom } élargi de marge, tous les pas px (bords compris)
export function pointsSonde(r, marge = 4, pas = 8) {
  const axe = (a, b) => {
    const v = [];
    for (let x = a; x < b; x += pas) v.push(x);
    v.push(b);
    return v;
  };
  const xs = axe(r.left - marge, r.right + marge), ys = axe(r.top - marge, r.bottom + marge), points = [];
  for (const y of ys) for (const x of xs) points.push([x, y]);
  return points;
}
// Le rectangle recouvre-t-il un contrôle ? aPoint(x, y) → éléments sous le point, du dessus vers le dessous
// (document.elementsFromPoint) ; ignorer(el) : le lanceur lui-même, le panier flottant ; estControle(el) : bouton, champ,
// lien, élément cliquable. Seul l'élément le plus haut sous chaque point compte (ce qu'un toucher atteindrait).
export function recouvre(r, { aPoint, ignorer, estControle, marge, pas }) {
  for (const [x, y] of pointsSonde(r, marge, pas)) {
    const dessus = aPoint(x, y).find((el) => !ignorer(el));
    if (dessus && estControle(dessus)) return true;
  }
  return false;
}
// Place au repos → "pastille", "bulle" ou "masque". libre(forme) : la place de cette forme est-elle libre ?
// pastilleVoulue : ordinateur ou tablette, en haut de page ; garde : focus clavier ou pointeur de la souris sur le lanceur
// (jamais masqué sous eux)
export function placeLanceur({ pastilleVoulue, libre, garde }) {
  if (pastilleVoulue && libre("pastille")) return "pastille";
  return garde || libre("bulle") ? "bulle" : "masque";
}
