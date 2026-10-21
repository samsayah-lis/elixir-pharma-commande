// ── Notifications de l'appli Elixir : abonnement de cet appareil (docs/notifications.md) ──
// Chargé à la demande (carte, panneau, démarrage, onglet admin) : jamais dans le bundle des pharmacies.
// La demande d'autorisation n'apparaît QUE sur un clic (« Activer les notifications ») : dans ce clic, le premier appel
// asynchrone est pushManager.subscribe (ou Notification.requestPermission), sans attente réseau avant — exigence de Safari.
// Le service worker (/sw.js, sans cache) est enregistré quand la carte ou le panneau s'affiche (preparer), jamais avant.
// api : { role, appeler(action, corps) → { statut, corps } } — pharmacie : push-abonnement par appelAuthentifie (jeton
// pharmacie) ; admin : push-admin par adminFetch (abonner_admin, retirer_admin).
// Abonnement local que le serveur ne connaît plus (404/410 du service push, retiré par un autre appareil, ménage) : le
// navigateur le rendrait tel quel à subscribe() (même clé) ; il est donc désinscrit localement (oublierLocal) avant toute
// nouvelle activation — sinon « Réactiver » réenregistrerait sans fin une adresse morte.
import { lireEnv, libelleAppareil, plateformeDe, estInstalle } from "./plateforme.js";
import { hotePushConnu } from "./regles.js";
import { surAdresseAdmin } from "../adresse-admin.js";

export const API = "/.netlify/functions/push-abonnement";
export const API_ADMIN = "/.netlify/functions/push-admin";
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ── Navigateur (remplacé par une doublure sur le banc d'essai et dans les tests) ──
function navigateurReel(w = window) {
  const sw = w.navigator.serviceWorker;
  return {
    env: () => lireEnv(w),
    enregistrement: () => (sw ? sw.getRegistration("/") : Promise.resolve(null)),
    enregistrer: () => sw.register("/sw.js", { scope: "/", updateViaCache: "none" }),
    pret: (ms = 5000) => Promise.race([sw.ready, attendre(ms).then(() => null)]),
    permission: () => ("Notification" in w ? w.Notification.permission : "default"),
    demanderPermission: () => w.Notification.requestPermission(),
    fetch: (...a) => w.fetch(...a),
    ecouterMessages: (fn) => { if (!sw) return; sw.addEventListener("message", fn); sw.startMessages?.(); },
    aller: (url) => w.location.assign(url),
    origine: () => w.location.origin,
    surAdmin: () => surAdresseAdmin(w.location.href),   // /admin#admin (appli « Elixir Admin »), ancienne /#admin
  };
}
let nav = null;
export const navigateur = () => (nav ||= navigateurReel());
export function installerNavigateur(n) { nav = n; preparation = null; prete = null; configGardee = null; ecoute = false; }

// ── API ──
const repondre = async (res) => ({ statut: res.status, corps: await res.json().catch(() => ({})) });
export function apiPharmacie(appel) {
  return { role: "pharmacie", appeler: async (action, corps = {}) => repondre(await appel(API, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...corps }) })) };
}
const ACTIONS_ADMIN = { abonner: "abonner_admin", retirer: "retirer_admin" };
export function apiAdmin(adminFetch) {
  return { role: "admin", appeler: async (action, corps = {}) => repondre(await adminFetch(API_ADMIN, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: ACTIONS_ADMIN[action] || action, ...corps }) })) };
}

// Configuration publique (GET, sans jeton) gardée 60 s : { disponible, cle_publique, ouverture }
let configGardee = null;
export async function lireConfig({ frais = false } = {}) {
  if (!frais && configGardee && configGardee.fin > Date.now()) return configGardee.valeur;
  let valeur = { disponible: false, cle_publique: null, ouverture: "fermee" };
  try {
    const r = await navigateur().fetch(API, { credentials: "omit" });
    if (r.ok) valeur = await r.json();
  } catch { /* réseau : indisponible pour cette fois */ }
  configGardee = { valeur, fin: Date.now() + 60_000 };
  return valeur;
}

// clé publique VAPID (base64url) → octets
export function cleBinaire(b64u) {
  const b64 = String(b64u).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(b64u).length + 3) % 4);
  const brut = atob(b64);
  const out = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) out[i] = brut.charCodeAt(i);
  return out;
}
// l'abonnement a-t-il été pris avec cette clé publique ? (clés VAPID changées : abonnement à refaire)
export function memeCle(sub, cle) {
  const k = sub?.options?.applicationServerKey;
  if (!k || !cle) return true;   // inconnu : on ne touche à rien
  const a = new Uint8Array(k), b = cleBinaire(cle);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Abonnement de cet appareil (sans rien demander à l'utilisateur) → { reg, sub }
export async function abonnementLocal() {
  const reg = await navigateur().enregistrement().catch(() => null);
  if (!reg?.pushManager) return { reg: reg || null, sub: null };
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return { reg, sub };
}

// ── Préparation (à l'affichage de la carte ou du panneau) : service worker enregistré et prêt, clé publique lue ──
// Un abonnement pris avec d'anciennes clés VAPID est retiré ici (jamais dans le clic) : subscribe le refuserait.
let preparation = null, prete = null;
export function preparer() {
  preparation ||= (async () => {
    const n = navigateur();
    const conf = await lireConfig();
    if (!conf.disponible || !conf.cle_publique) throw Object.assign(new Error("indisponible"), { code: "indisponible" });
    let reg = await n.enregistrement().catch(() => null);
    if (!reg) reg = await n.enregistrer();
    reg = (await n.pret(5000)) || reg;
    const sub = await reg.pushManager?.getSubscription().catch(() => null);
    // adresse hors des services push connus : inutilisable (le serveur la refuse), désinscrite localement
    if (sub && !hotePushConnu(sub.endpoint)) await oublierLocal(sub);
    else if (sub && !memeCle(sub, conf.cle_publique) && n.permission() === "granted") await renouvelerCle({ sub, reg, cle: conf.cle_publique }).catch(() => {});
    prete = { reg, cle: conf.cle_publique };
    return prete;
  })().catch((e) => { preparation = null; throw e; });
  return preparation;
}
export const estPret = () => !!prete;

// ── Activation (dans le clic) ──
// → { etat: "abonne" | "refuse" | "sans_reponse" | "echec" | "autre_identite" | "trop_d_appareils" | "reconnexion" |
//     "indisponible" | "fermee" | "hors_pilote" | "erreur", appareil?, de?, brave? }
export async function activer({ api, categories = null, remplacer = false } = {}) {
  const n = navigateur();
  let sub;
  try {
    if (prete?.reg?.pushManager) {
      // premier appel asynchrone du clic : la demande d'autorisation s'affiche dans le geste de l'utilisateur
      sub = await prete.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBinaire(prete.cle) });
    } else {
      // préparation pas finie (réseau lent) : l'autorisation d'abord (dans le geste), puis le reste
      const p = n.permission() === "granted" ? "granted" : await n.demanderPermission();
      if (p !== "granted") return { etat: p === "denied" ? "refuse" : "sans_reponse" };
      const { reg, cle } = await preparer();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBinaire(cle) });
    }
  } catch (e) {
    const p = n.permission();
    if (p === "denied") return { etat: "refuse" };
    if (p === "default" && e?.name === "NotAllowedError") return { etat: "sans_reponse" };
    if (e?.code === "indisponible") return { etat: "indisponible" };
    return { etat: "echec", brave: !!n.env().brave };
  }
  return enregistrer({ api, sub, categories, remplacer });
}

// Abonnement local → serveur (abonner) ; aussi pour « Réactiver » (autorisation déjà donnée) et « Oui, pour {pharmacie} »
// 400 « abonnement » (adresse ou clés refusées) : désinscription locale, nouvel abonnement (sans nouvelle demande :
// l'autorisation vient d'être donnée), une seule nouvelle tentative.
export async function enregistrer({ api, sub, categories = null, remplacer = false, retente = false }) {
  const env = navigateur().env();
  const corps = { abonnement: sub.toJSON(), appareil: { libelle: libelleAppareil(env), plateforme: plateformeDe(env), installe: estInstalle(env) },
    ...(categories ? { categories } : {}), ...(remplacer ? { remplacer: true } : {}) };
  let r;
  try { r = await api.appeler("abonner", corps); } catch { return { etat: "indisponible" }; }
  if (r.statut === 200 && r.corps.success) { ecouterNavigation(); return { etat: "abonne", appareil: r.corps.appareil || null }; }
  if (r.statut === 400 && r.corps?.error === "abonnement" && !retente) {
    try {
      await oublierLocal(sub);
      const { reg, cle } = prete || await preparer();
      const neuf = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBinaire(cle) });
      return enregistrer({ api, sub: neuf, categories, remplacer, retente: true });
    } catch { return { etat: "echec" }; }
  }
  if (r.statut === 409) return { etat: r.corps.error === "autre_identite" ? "autre_identite" : r.corps.error === "trop_d_appareils" ? "trop_d_appareils" : "erreur", de: r.corps.de || null };
  if (r.statut === 401) return { etat: "reconnexion" };
  if (r.statut === 403) return { etat: ["fermee", "hors_pilote", "admin", "fiche"].includes(r.corps.error) ? r.corps.error : "erreur" };
  if (r.statut === 400) return { etat: "echec" };
  return { etat: "indisponible" };
}

// Désinscription locale seulement (le serveur ne connaît plus cet abonnement, ou l'a déclaré expiré) : jamais d'exception
export async function oublierLocal(sub) {
  try { await sub?.unsubscribe(); } catch { /* déjà désinscrit */ }
}
// Abonnement local inconnu du serveur (statut : aucun appareil à ce nom ET adresse inconnue de toute autre identité) :
// désinscrit localement → { sub: null } ; sinon inchangé. Jamais quand l'adresse appartient à une autre identité (409).
export async function nettoyerSiInconnu({ sub, statut }) {
  if (sub && statut && !statut.appareil && !statut.autre_identite) { await oublierLocal(sub); return { sub: null, nettoye: true }; }
  return { sub, nettoye: false };
}

// Réactiver : abonnement local (ou nouveau, sans nouvelle demande : autorisation déjà donnée) renvoyé au serveur
export async function reactiver({ api, remplacer = false } = {}) {
  let { sub } = await abonnementLocal();
  try {
    if (!sub) { const { reg, cle } = await preparer(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBinaire(cle) }); }
  } catch { return { etat: navigateur().permission() === "denied" ? "refuse" : "echec" }; }
  return enregistrer({ api, sub, remplacer });
}

// Notification de test à cet appareil (pharmacie) ou aux appareils de l'admin → { etat: "ok" | "expire" | "quota" | "envoi" |
//   "reconnexion" | "indisponible" | "aucun", detail?, bilan? }
export async function envoyerTest({ api } = {}) {
  let r;
  try {
    if (api.role === "admin") r = await api.appeler("test");
    else { const { sub } = await abonnementLocal(); if (!sub) return { etat: "expire" }; r = await api.appeler("test", { endpoint: sub.endpoint }); }
  } catch { return { etat: "indisponible" }; }
  if (r.statut === 200) return api.role === "admin" ? { etat: r.corps.aucun ? "aucun" : r.corps.envoyes ? "ok" : "envoi", bilan: r.corps } : { etat: "ok", apercu: !!r.corps.apercu };
  if (r.statut === 410 || r.statut === 404) {
    // abonnement mort (retiré par le serveur) : désinscrit ici aussi, la prochaine activation en prend un NOUVEAU
    const { sub } = await abonnementLocal();
    await oublierLocal(sub);
    return { etat: "expire" };
  }
  if (r.statut === 429) return { etat: "quota" };
  if (r.statut === 401) return { etat: "reconnexion" };
  if (r.statut === 502) return { etat: "envoi", detail: r.corps.detail || null };
  return { etat: "indisponible" };
}

// Catégories de cet appareil → { ok, categories? , etat? }
export async function changerCategories({ api, categories }) {
  const { sub } = await abonnementLocal();
  if (!sub) return { ok: false, etat: "expire" };
  try {
    const r = await api.appeler("categories", { endpoint: sub.endpoint, categories });
    if (r.statut === 200) return { ok: true, categories: r.corps.categories || categories };
    return { ok: false, etat: r.statut === 401 ? "reconnexion" : r.statut === 404 ? "expire" : "indisponible" };
  } catch { return { ok: false, etat: "indisponible" }; }
}

// Désactiver sur cet appareil : désinscription locale puis retrait côté serveur (retiré même si la désinscription échoue)
export async function desactiver({ api }) {
  const { sub } = await abonnementLocal();
  const endpoint = sub?.endpoint || null;
  if (sub) { try { await sub.unsubscribe(); } catch { /* le serveur retire quand même la ligne */ } }
  if (!endpoint) return { ok: true };
  try { const r = await api.appeler("retirer", { endpoint }); return { ok: r.statut === 200, etat: r.statut === 401 ? "reconnexion" : null }; }
  catch { return { ok: false, etat: "indisponible" }; }
}

// Retirer un autre appareil de la pharmacie (ou de l'admin)
export async function retirerAppareil({ api, id }) {
  try { const r = await api.appeler("retirer", { id }); return { ok: r.statut === 200 }; } catch { return { ok: false }; }
}

// ── Déconnexion : l'appareil ne reçoit plus les notifications de la pharmacie qui se déconnecte ──
// Sans jeton (il vient d'être effacé) : preuve de possession (endpoint + secret auth de l'abonnement). Appareil de l'admin
// (rôle admin) : gardé. Serveur injoignable : désinscription locale quand même (le serveur nettoiera au prochain envoi).
export async function oublier(reg) {
  try {
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    const j = sub.toJSON();
    let role = null;
    try {
      const r = await navigateur().fetch(API, { method: "POST", credentials: "omit", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "oublier", endpoint: j.endpoint, auth: j.keys?.auth }) });
      role = (await r.json().catch(() => ({}))).role || null;
    } catch { role = null; }
    if (role !== "admin") await sub.unsubscribe();
  } catch { /* rien à faire */ }
}

// ── Clés VAPID changées : nouvel abonnement prouvé par l'ancien (aucune demande à l'utilisateur) ──
export async function renouvelerCle({ sub, reg, cle }) {
  const ancien = sub.toJSON();
  await sub.unsubscribe();
  const nouveau = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBinaire(cle) });
  await navigateur().fetch(API, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "renouveler", ancien: { endpoint: ancien.endpoint, auth: ancien.keys?.auth }, abonnement: nouveau.toJSON() }) });
  return nouveau;
}

// Clic sur une notification quand le service worker ne peut pas changer l'adresse de la fenêtre (Safari) : message reçu ici
let ecoute = false;
export function ecouterNavigation() {
  if (ecoute) return;
  ecoute = true;
  const n = navigateur();
  n.ecouterMessages((e) => {
    const d = e?.data;
    if (d?.type !== "elixir-notification" || typeof d.url !== "string") return;
    if (n.surAdmin?.()) return;   // admin ouvert dans cette fenêtre : jamais quitté (annonce en rédaction)
    try { if (new URL(d.url).origin === n.origine()) n.aller(d.url); } catch { /* adresse illisible */ }
  });
}
