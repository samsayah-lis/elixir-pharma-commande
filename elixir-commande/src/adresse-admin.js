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

// Appli installée ou ouverte depuis l'écran d'accueil : fenêtre sans barre d'adresse
export function enAppli(w) {
  const media = (q) => { try { return !!w.matchMedia?.(q).matches; } catch { return false; } };
  return w?.navigator?.standalone === true || media("(display-mode: standalone)") || media("(display-mode: fullscreen)");
}

// Quitter l'admin (« Retour au catalogue », croix de la connexion, Ctrl+Maj+A) :
//  • sur /admin, dans un navigateur : VRAIE navigation vers « / » (paramètres gardés). La page des pharmacies est rechargée
//    avec SON manifeste et son nom (« Elixir ») : « Sur l'écran d'accueil » ou « Installer l'application » depuis ce
//    catalogue donne l'appli des pharmacies, jamais une icône « Elixir Admin » ouverte sur « / » (la confusion d'origine).
//    Le retour arrière rouvre /admin (nouveau chargement). Une saisie non enregistrée de l'admin peut faire demander
//    confirmation par le navigateur, en plus de celle de l'admin : quitter la page l'abandonne (le rappel n'est pas appelé,
//    l'admin reste affiché si la navigation est refusée) ;
//  • sur /admin, dans l'appli « Elixir Admin » (sans barre d'adresse, manifeste de l'admin voulu) : nouvelle entrée
//    d'historique « / » (le retour arrière rouvre l'admin, popstate), puis rappel() — aucun hashchange entre deux chemins ;
//  • ailleurs (#admin ajouté par Ctrl+Maj+A sur une page des pharmacies, manifeste des pharmacies) : « # » vidé comme
//    avant (hashchange).
export function quitterAdresseAdmin(rappel, w = window) {
  if (!cheminAdmin(w.location.pathname)) { w.location.hash = ""; return; }
  if (!enAppli(w)) { w.location.assign(adresseHorsAdmin(w.location)); return; }
  try { w.history.pushState(null, "", adresseHorsAdmin(w.location)); } catch { /* historique indisponible : affichage seulement */ }
  rappel();
}

// Appli « Elixir Admin » : fenêtre sans barre d'adresse, démarrée sur l'admin (le script d'index.html a déjà complété
// l'adresse en /admin#admin). Lu une fois, au chargement du site. Sert à toujours proposer le retour à l'admin (lien de la
// connexion des pharmacies, cadenas de l'en-tête du catalogue) : sans barre d'adresse, pas d'autre chemin pour y revenir.
export const OUVERT_EN_APPLI_ADMIN = typeof window !== "undefined" && window.location?.hash === "#admin" && enAppli(window);
// Mémorisé (clé appli_admin = "1") pour les pages ouvertes plus tard dans la même appli sur une autre adresse (aperçu d'une
// annonce ouvert par une notification, appli fermée) : APPLI_ADMIN reste vrai dans l'appli, même sans jeton admin valide.
// Stockage propre à l'appli sur l'iPhone ; sur Android, partagé avec Chrome et les autres applis du site, mais posé
// seulement par un appareil qui a ouvert l'admin dans une fenêtre d'appli (équipe Elixir). Jamais vrai dans un navigateur.
export function appliAdmin(w, ouvertEnAppliAdmin) {
  if (!enAppli(w)) return false;
  try {
    if (ouvertEnAppliAdmin) { w.localStorage.setItem("appli_admin", "1"); return true; }
    return w.localStorage.getItem("appli_admin") === "1";
  } catch { return !!ouvertEnAppliAdmin; }   // stockage refusé : seulement la page ouverte sur l'admin
}
export const APPLI_ADMIN = typeof window !== "undefined" && appliAdmin(window, OUVERT_EN_APPLI_ADMIN);
