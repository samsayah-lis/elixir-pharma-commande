// ── Adresse de l'admin et appli « Elixir Admin » (docs/notifications.md § 3 f et § 10) ──
// L'admin s'ouvre à l'adresse https://elixir-commande.expepharma.com/admin. Le script en tête d'index.html, avant le
// démarrage du site : choisit LE manifeste (admin.webmanifest : appli « Elixir Admin », start_url "/admin") et complète
// l'adresse en /admin#admin (aussi /admin/ et l'ancienne /#admin) ; le site affiche l'admin sur #admin, comme avant.
// Pourquoi un chemin : l'appli de l'iPhone installée depuis /#admin s'ouvrait sur l'accueil des pharmacies (« #admin »
// perdu par l'écran d'accueil, ou manifeste des pharmacies gardé par Safari). Un chemin, lui, est toujours conservé.
// Ces fonctions servent le site (fermer, quitter, revenir à l'admin) ; la même règle est écrite dans index.html (script
// en ligne) et dans public/sw.js (sans import possible) : scripts/test-appli-admin.mjs vérifie qu'elles s'accordent.

export const CHEMIN_ADMIN = "/admin";
const RE_CHEMIN = /^\/admin\/?$/;

// chemin de l'admin : /admin ou /admin/
export const cheminAdmin = (chemin) => RE_CHEMIN.test(String(chemin || ""));

// fenêtre ouverte sur l'admin (adresse complète) : « #admin » (comme App.jsx), ou chemin /admin
export function surAdresseAdmin(url) {
  try { const u = new URL(String(url)); return u.hash === "#admin" || cheminAdmin(u.pathname); } catch { return false; }
}

// adresse à prendre en quittant l'admin : sans « #admin » ; /admin → « / » (sinon l'admin se rouvrirait au rechargement) ;
// paramètres (?menu=…) gardés
export const adresseHorsAdmin = (loc) => (cheminAdmin(loc.pathname) ? "/" : loc.pathname) + (loc.search || "");

// Quitter l'admin dans la même page (« Retour au catalogue », croix de la connexion, Ctrl+Maj+A) :
//  • sur /admin : nouvelle entrée d'historique « / » (le retour arrière rouvre l'admin), puis rappel() — aucun hashchange
//    entre deux chemins différents ;
//  • ailleurs (/#admin ouvert par Ctrl+Maj+A) : « # » vidé comme avant (hashchange).
export function quitterAdresseAdmin(rappel, w = window) {
  if (!cheminAdmin(w.location.pathname)) { w.location.hash = ""; return; }
  try { w.history.pushState(null, "", adresseHorsAdmin(w.location)); } catch { /* historique indisponible : affichage seulement */ }
  rappel();
}

// Appli « Elixir Admin » ouverte depuis l'écran d'accueil (ou installée) : fenêtre sans barre d'adresse, démarrée sur
// l'admin. Lu une fois, au chargement du site (le script d'index.html a déjà complété l'adresse en /admin#admin). Sert à
// toujours proposer le retour à l'admin depuis l'écran de connexion des pharmacies : sans barre d'adresse, pas d'autre
// chemin pour y revenir.
export function enAppli(w) {
  const media = (q) => { try { return !!w.matchMedia?.(q).matches; } catch { return false; } };
  return w?.navigator?.standalone === true || media("(display-mode: standalone)") || media("(display-mode: fullscreen)");
}
export const OUVERT_EN_APPLI_ADMIN = typeof window !== "undefined" && window.location?.hash === "#admin" && enAppli(window);
