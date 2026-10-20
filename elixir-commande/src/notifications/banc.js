// ── Banc d'essai local des notifications (npm run dev, docs/notifications.md) : navigateur simulé ──
// Chargé seulement en développement (import.meta.env.DEV, demarrage.js) quand le banc sert la clé « BANC-FICTIVE » :
// jamais dans le build de production. Aucun vrai service worker, aucun vrai abonnement, aucune requête vers un service push.
// ?banc_push=<scénario> : auto (appareil réel du navigateur, notifications simulées), android, bureau, ios-safari, ios-app,
// ios-ancien, ios-gmail, refuse, abonne, brave.
import { lireEnv } from "./plateforme.js";

const UA = {
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  bureau: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  iosApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iosAncien: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Mobile/15E148 Safari/604.1",
  iosGmail: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/330.0.0",
};
const SCENARIOS = {
  android: { ua: UA.android, maxTouchPoints: 5 },
  bureau: { ua: UA.bureau },
  "ios-safari": { ua: UA.iosSafari, maxTouchPoints: 5, pushManager: false, notification: false },
  "ios-app": { ua: UA.iosApp, maxTouchPoints: 5, standalone: true, displayStandalone: true },
  "ios-ancien": { ua: UA.iosAncien, maxTouchPoints: 5, pushManager: false, notification: false },
  "ios-gmail": { ua: UA.iosGmail, maxTouchPoints: 5, pushManager: false, notification: false },
  refuse: { ua: UA.bureau, permission: "denied" },
  abonne: { ua: UA.bureau, permission: "granted", abonne: true },
  brave: { ua: UA.bureau, brave: true, echec: true },
};
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// même scénario redemandé (onglet admin rechargé, nouvelle identité) : même navigateur simulé, abonnement compris
let dernier = null;
export function navigateurBanc(nom = "auto") {
  if (dernier?.nom === nom) return dernier.nav;
  const nav = creer(nom);
  dernier = { nom, nav };
  return nav;
}
function creer(nom) {
  const s = SCENARIOS[nom] || {};
  const reel = lireEnv(window);
  const etat = { permission: s.permission || "default", sub: null, n: 0 };
  const abonnement = (endpoint) => {
    const sub = {
      endpoint, expirationTime: null, options: { applicationServerKey: null, userVisibleOnly: true },
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "BANC", auth: "banc" } }),
      unsubscribe: async () => { if (etat.sub === sub) etat.sub = null; return true; },
    };
    return sub;
  };
  if (s.abonne) etat.sub = abonnement("https://fcm.googleapis.com/fcm/send/banc-abonne");
  const pushManager = {
    getSubscription: async () => etat.sub,
    subscribe: async () => {
      if (etat.permission === "default") { await pause(500); etat.permission = "granted"; }   // « Autoriser » simulé
      if (etat.permission === "denied") throw Object.assign(new Error("refusé"), { name: "NotAllowedError" });
      if (s.echec) throw Object.assign(new Error("service push indisponible"), { name: "AbortError" });
      etat.sub ||= abonnement(`https://fcm.googleapis.com/fcm/send/banc-${Date.now()}-${++etat.n}`);
      return etat.sub;
    },
  };
  const reg = { pushManager, update: async () => {}, scope: `${window.location.origin}/` };
  console.info(`[banc] notifications simulées (scénario « ${SCENARIOS[nom] ? nom : "auto"} ») : aucun vrai abonnement`);
  return {
    env: () => ({ ...reel, sw: true, pushManager: true, notification: true, secure: true, brave: false, ...s, permission: etat.permission }),
    enregistrement: async () => reg,
    enregistrer: async () => reg,
    pret: async () => reg,
    permission: () => etat.permission,
    demanderPermission: async () => { if (etat.permission === "default") { await pause(500); etat.permission = "granted"; } return etat.permission; },
    fetch: (...a) => window.fetch(...a),
    ecouterMessages: () => {},
    aller: (url) => window.location.assign(url),
    origine: () => window.location.origin,
  };
}
