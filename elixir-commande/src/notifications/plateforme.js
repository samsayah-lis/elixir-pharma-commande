// ── Notifications de l'appli Elixir : appareil, navigateur et parcours d'activation (docs/notifications.md) ──
// JS pur : l'environnement (env) est lu dans window par lireEnv(), ou fourni par les tests et le banc d'essai.
// Parcours :
//  • "abonne"         cet appareil reçoit déjà les notifications de la pharmacie ;
//  • "activer"        notifications possibles ici (Android, ordinateur, iPhone/iPad dans l'application de l'écran d'accueil) ;
//  • "refuse"         l'utilisateur les a bloquées pour ce site (réglage du navigateur ou du téléphone) ;
//  • "installer_ios"  iPhone/iPad en iOS 16.4 ou plus, dans Safari (ou Chrome, Edge…) : il faut d'abord ajouter l'application
//                     à l'écran d'accueil — règle d'Apple, aucun navigateur iOS ne reçoit de notification web hors application ;
//  • "ouvrir_safari"  iPhone/iPad dans le navigateur intégré d'une autre application (Gmail, Google, Facebook, Outlook…) ;
//  • "maj_ios"        iOS plus ancien que 16.4 (iPhone 7 et avant, ou mise à jour à faire) ;
//  • "non_supporte"   navigateur sans service worker ni Push API, ou page non sécurisée.

// Environnement lu dans la fenêtre (navigateur réel)
export function lireEnv(w = typeof window !== "undefined" ? window : {}) {
  const nav = w.navigator || {};
  const media = (q) => { try { return !!w.matchMedia?.(q).matches; } catch { return false; } };
  return {
    ua: String(nav.userAgent || ""),
    plateformeNav: String(nav.platform || ""),
    maxTouchPoints: Number(nav.maxTouchPoints || 0),
    standalone: nav.standalone === true,                              // iOS : ouvert depuis l'écran d'accueil
    displayStandalone: media("(display-mode: standalone)") || media("(display-mode: fullscreen)"),
    sw: !!nav.serviceWorker,
    pushManager: "PushManager" in w,
    notification: "Notification" in w,
    permission: "Notification" in w ? String(w.Notification.permission || "default") : "default",
    secure: w.isSecureContext !== false,
    brave: !!nav.brave,
  };
}

// version d'iOS en nombre (16.4 → 1604) : « OS 16_4 » de l'user-agent, ou « Version/26.0 » de Safari (iOS 26 fige l'OS de
// l'user-agent à 18_6) ; iPad en mode « bureau » : l'OS de l'user-agent est celui d'un Mac (10_15_7), seul Version/ compte
function versionIos(ua, ipadBureau) {
  const os = ipadBureau ? null : /OS (\d+)[._](\d+)/.exec(ua);
  const v = os ? Number(os[1]) * 100 + Number(os[2]) : 0;
  const safari = /Version\/(\d+)(?:\.(\d+))?/.exec(ua);
  const s = safari ? Number(safari[1]) * 100 + Number(safari[2] || 0) : 0;
  return Math.max(v, s >= 1500 && s < 4000 ? s : 0) || null;   // inconnue : null (supposée récente)
}
const NAVIGATEURS_INTEGRES = /GSA\/|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Outlook|LinkedInApp|Snapchat|Twitter/;

// → { ios, ipad, versionIos, android, mobile, installe, navigateur, navigateurIntegre }
export function analyser(env = {}) {
  const ua = String(env.ua || "");
  // iPadOS en mode « bureau » : user-agent de Mac, mais écran tactile (un Mac n'a pas de points de contact)
  const ipadBureau = /Macintosh/.test(ua) && !/Android|Windows|Linux/.test(ua) && (env.maxTouchPoints || 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || ipadBureau;
  const ipad = /iPad/.test(ua) || ipadBureau;
  const android = /Android/.test(ua);
  const installe = !!(env.displayStandalone || env.standalone);
  const navigateur = /EdgA\/|EdgiOS\/|Edg\//.test(ua) ? "Edge" : /SamsungBrowser\//.test(ua) ? "Samsung Internet" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /OPR\/|OPT\//.test(ua) ? "Opera" : /CriOS\/|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navigateur";
  // iOS hors application : user-agent sans « Safari/ » (WKWebView d'une autre application) ou application connue
  const navigateurIntegre = ios && !installe && (!/Safari\//.test(ua) || NAVIGATEURS_INTEGRES.test(ua));
  return { ios, ipad, versionIos: ios ? versionIos(ua, ipadBureau) : null, android, mobile: ios || android || /Mobile/.test(ua), installe, navigateur, navigateurIntegre,
    brave: !!env.brave };
}

export const IOS_MINIMUM = 1604;   // iOS 16.4
// parcours de cet appareil (voir en-tête) ; abonne : le serveur connaît l'abonnement de cet appareil pour cette pharmacie
export function parcours(env = {}, abonne = false) {
  if (abonne) return "abonne";
  const a = analyser(env);
  if (a.ios) {
    if (a.versionIos && a.versionIos < IOS_MINIMUM) return "maj_ios";
    if (!a.installe) return a.navigateurIntegre ? "ouvrir_safari" : "installer_ios";
    if (!env.pushManager || !env.notification) return "maj_ios";   // installée, mais iOS sans notifications web
  }
  if (!env.secure || !env.sw || !env.pushManager || !env.notification) return "non_supporte";
  if (env.permission === "denied") return "refuse";
  return "activer";
}
// parcours qui montrent la carte de l'accueil (les autres s'expliquent dans le panneau)
export const PARCOURS_CARTE = ["activer", "installer_ios", "ouvrir_safari"];

// plateforme enregistrée avec l'abonnement (statistiques de l'admin)
export function plateformeDe(env = {}) {
  const a = analyser(env);
  return a.ios ? "ios" : a.android ? "android" : a.mobile ? "autre" : "ordinateur";
}
export const estInstalle = (env = {}) => analyser(env).installe;

// libellé lisible de l'appareil : « iPhone · application », « Android · Chrome », « Ordinateur · Edge »… (jamais l'user-agent)
export function libelleAppareil(env = {}) {
  const a = analyser(env);
  const appareil = a.ios ? (a.ipad ? "iPad" : "iPhone") : a.android ? "Android" : a.mobile ? "Mobile" : "Ordinateur";
  return `${appareil} · ${a.installe ? "application" : a.navigateur}`;
}
// version d'iOS lisible (« 15.7 ») pour le message « mettez à jour votre iPhone »
export const versionIosTexte = (env = {}) => { const v = analyser(env).versionIos; return v ? `${Math.floor(v / 100)}.${v % 100}` : null; };
