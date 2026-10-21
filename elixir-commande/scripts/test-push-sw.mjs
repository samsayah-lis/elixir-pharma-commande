// Tests du service worker des notifications (public/sw.js) : node scripts/test-push-sw.mjs
// Le fichier est exécuté tel quel dans un bac à sable node:vm, avec un faux « self » (clients, registration, fetch) :
//  • aucun gestionnaire « fetch », aucun accès à Cache Storage (vérifié dans le texte ET à l'exécution) ;
//  • install → skipWaiting ; activate → clients.claim ;
//  • push : charge valide (titre, texte, étiquette, icône, badge, lien) ; charge illisible, vide ou texte brut → notification
//    générique (jamais aucune : exigence d'iOS) ; textes coupés ; lien d'une autre origine ou javascript: → accueil ;
//  • notificationclick : fenêtre ouverte → focus puis navigate ; navigate absent ou refusé → message à la page ; aucune
//    fenêtre → openWindow ;
//  • pushsubscriptionchange : ancien abonnement → POST renouveler avec la preuve ; sans nouvel abonnement → subscribe avec
//    la clé publique du GET ; sans ancien → aucun appel ;
//  • messages de l'admin et outil entrepôt : catégories « commandes » et « infos », lien /?commandes=1.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import webpush from "web-push";

const RACINE = new URL("..", import.meta.url).pathname;
const SOURCE = readFileSync(`${RACINE}public/sw.js`, "utf8");
const ORIGINE = "https://elixir-commande.expepharma.com";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── Texte ──
const code = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
eq("texte : aucun écouteur fetch", /addEventListener\(\s*["'`]fetch/.test(code), false);
eq("texte : aucun Cache Storage (caches, cache.put, cache.match)", /\bcaches\b|\.put\(|\.match\(/.test(code), false);
eq("texte : aucun import de script (importScripts)", /importScripts/.test(code), false);

// ── Bac à sable ──
function bac({ fenetres = [], fetchReponses = {}, abonnementNouveau = null } = {}) {
  const t = { ecouteurs: {}, notifications: [], ouvertes: [], appels: [], skip: 0, claim: 0, caches: 0, abonnements: [] };
  const self = {
    location: { origin: ORIGINE, href: `${ORIGINE}/sw.js` },
    addEventListener: (type, fn) => { (t.ecouteurs[type] ||= []).push(fn); },
    skipWaiting: () => { t.skip++; return Promise.resolve(); },
    clients: {
      claim: () => { t.claim++; return Promise.resolve(); },
      matchAll: async () => fenetres,
      openWindow: async (u) => { t.ouvertes.push(u); return null; },
    },
    registration: {
      showNotification: async (titre, options) => { t.notifications.push({ titre, options: JSON.parse(JSON.stringify(options)) }); },
      pushManager: { subscribe: async (o) => { t.abonnements.push({ userVisibleOnly: o.userVisibleOnly, cle: o.applicationServerKey.length, premier: o.applicationServerKey[0] }); return abonnementNouveau; } },
    },
    fetch: async (u, init = {}) => {
      t.appels.push({ u, methode: init.method || "GET", corps: init.body ? JSON.parse(init.body) : null, credentials: init.credentials });
      return { json: async () => fetchReponses[init.method || "GET"] ?? {} };
    },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    URL, Date, Number, String, Uint8Array, JSON, Promise, Error, console,
  };
  self.self = self;
  Object.defineProperty(self, "caches", { get() { t.caches++; return {}; } });
  vm.createContext(self);
  vm.runInContext(SOURCE, self, { filename: "sw.js" });
  const evenement = (type, champs = {}) => {
    const attentes = [];
    const e = { ...champs, waitUntil: (p) => attentes.push(p) };
    for (const fn of t.ecouteurs[type] || []) fn(e);
    return Promise.all(attentes);
  };
  return { t, evenement };
}
const donnees = (valeur) => ({ json: () => { if (typeof valeur === "string") return JSON.parse(valeur); return valeur; } });

{
  const { t, evenement } = bac();
  eq("écouteurs : install, activate, push, notificationclick, pushsubscriptionchange — pas fetch", Object.keys(t.ecouteurs).sort(),
    ["activate", "install", "notificationclick", "push", "pushsubscriptionchange"]);
  await evenement("install");
  await evenement("activate");
  eq("install → skipWaiting ; activate → clients.claim", [t.skip, t.claim], [1, 1]);
  // push valide
  await evenement("push", { data: donnees(JSON.stringify({ v: 1, categorie: "stock", titre: "De retour en stock", corps: "Doliprane est disponible.",
    url: "/?cip=3400930000000", tag: "stock-3400930000000", id: "a1", ts: 1760950000000 })) });
  const n = t.notifications[0];
  eq("push : titre, texte, étiquette (renotify), icône, badge, langue", [n.titre, n.options.body, n.options.tag, n.options.renotify, n.options.icon, n.options.badge, n.options.lang],
    ["De retour en stock", "Doliprane est disponible.", "stock-3400930000000", true, "/icones/elixir-192.png", "/icones/badge-96.png", "fr"]);
  eq("push : lien complet du site, catégorie, horodatage", [n.options.data.url, n.options.data.categorie, n.options.timestamp], [`${ORIGINE}/?cip=3400930000000`, "stock", 1760950000000]);
  // charges illisibles : notification générique, jamais aucune
  const avant = t.notifications.length;
  await evenement("push", { data: { json: () => { throw new SyntaxError("pas du JSON"); } } });
  await evenement("push", { data: null });
  await evenement("push", { data: donnees("null") });
  await evenement("push", { data: donnees("[1,2]") });
  eq("charges illisibles, vides, nulles ou tableau → 4 notifications génériques", t.notifications.slice(avant).map((x) => [x.titre, x.options.body, x.options.data.url, x.options.tag ?? null]),
    Array(4).fill(["Elixir Pharma", "Nouvelle information dans votre espace Elixir.", `${ORIGINE}/`, null]));
  await evenement("push", { data: donnees({ titre: "T".repeat(200), corps: "C".repeat(500), tag: "x".repeat(100) }) });
  const longue = t.notifications.at(-1);
  eq("textes coupés : titre 80, texte 240, étiquette 64", [longue.titre.length, longue.options.body.length, longue.options.tag.length], [80, 240, 64]);
  for (const [u, attendu] of [["https://evil.fr/x", `${ORIGINE}/`], ["javascript:alert(1)", `${ORIGINE}/`], ["//evil.fr/x", `${ORIGINE}/`], ["/?menu=promo_1", `${ORIGINE}/?menu=promo_1`], [42, `${ORIGINE}/`]]) {
    await evenement("push", { data: donnees({ titre: "t", url: u }) });
    eq(`lien ${JSON.stringify(u)} → ${attendu}`, t.notifications.at(-1).options.data.url, attendu);
  }
  // messages de l'admin et outil entrepôt (docs/notifications.md § 4 à 6) : « Mes commandes et réclamations » (commandes),
  // « Informations Elixir » (infos) ; le service worker les affiche comme les autres, lien « Mes commandes » compris
  await evenement("push", { data: donnees({ v: 1, categorie: "commandes", titre: "Réclamation traitée", corps: "Votre réclamation EN-601-2026-12 est traitée.",
    url: "/?commandes=1", tag: "evt-AbCdEf0123456789", id: "m1", ts: 1760950000001 }) });
  const c = t.notifications.at(-1);
  eq("push « commandes » : titre, lien Mes commandes, catégorie, étiquette (remplace le statut précédent)", [c.titre, c.options.data.url, c.options.data.categorie, c.options.tag, c.options.renotify],
    ["Réclamation traitée", `${ORIGINE}/?commandes=1`, "commandes", "evt-AbCdEf0123456789", true]);
  await evenement("push", { data: donnees({ v: 1, categorie: "infos", titre: "Fermeture exceptionnelle", corps: "Elixir Pharma sera fermé le 1er novembre.", url: "/", tag: "msg-1a2b3c4d" }) });
  eq("push « infos » : catégorie gardée, lien accueil", [t.notifications.at(-1).options.data.categorie, t.notifications.at(-1).options.data.url], ["infos", `${ORIGINE}/`]);
  eq("aucun accès à Cache Storage pendant l'exécution", t.caches, 0);
}

// ── notificationclick ──
const notif = (url) => { const n = { fermee: false, data: { url }, close() { n.fermee = true; } }; return n; };
{
  const journal = [];
  const fen = { url: `${ORIGINE}/?menu=otc`, focus: async () => { journal.push("focus"); }, navigate: async (u) => { journal.push(`navigate ${u}`); }, postMessage: (m) => journal.push(`message ${m.url}`) };
  const autre = { url: "https://autre.fr/", focus: async () => journal.push("autre-focus") };
  const { t, evenement } = bac({ fenetres: [autre, fen] });
  const n = notif(`${ORIGINE}/?menu=promo_1`);
  await evenement("notificationclick", { notification: n });
  eq("fenêtre du site ouverte : fermeture, focus puis navigate (jamais une autre origine)", [n.fermee, journal, t.ouvertes], [true, ["focus", `navigate ${ORIGINE}/?menu=promo_1`], []]);
}
{
  const journal = [];
  const fen = { url: `${ORIGINE}/`, focus: async () => { journal.push("focus"); }, postMessage: (m) => journal.push(`message ${m.type} ${m.url}`) };
  const { evenement } = bac({ fenetres: [fen] });
  await evenement("notificationclick", { notification: notif(`${ORIGINE}/?outil=saisie`) });
  eq("navigate absent (Safari) → message à la page", journal, ["focus", `message elixir-notification ${ORIGINE}/?outil=saisie`]);
}
{
  const journal = [];
  const fen = { url: `${ORIGINE}/?menu=otc`, focus: async () => { journal.push("focus"); }, navigate: async (u) => { journal.push(`navigate ${u}`); } };
  const { evenement } = bac({ fenetres: [fen] });
  await evenement("notificationclick", { notification: { tag: "evt-x", data: { url: `${ORIGINE}/?commandes=1`, categorie: "commandes" }, close() {} } });
  eq("notification « Mes commandes et réclamations » : la fenêtre va sur /?commandes=1 (App ouvre « Mes commandes »)", journal, ["focus", `navigate ${ORIGINE}/?commandes=1`]);
}
{
  const journal = [];
  const fen = { url: `${ORIGINE}/`, focus: async () => { throw new Error("déjà au premier plan"); }, navigate: async () => { throw new TypeError("non contrôlée"); }, postMessage: (m) => journal.push(m.url) };
  const { evenement } = bac({ fenetres: [fen] });
  await evenement("notificationclick", { notification: notif(`${ORIGINE}/?menu=otc`) });
  eq("focus et navigate refusés → message à la page", journal, [`${ORIGINE}/?menu=otc`]);
}
{
  // fenêtre au premier plan préférée ; test → premier plan seulement ; même adresse → premier plan seulement
  const journal = [];
  const fenetre = (nom, url, extra = {}) => ({ url, ...extra, focus: async () => journal.push(`focus ${nom}`), navigate: async (u) => journal.push(`navigate ${nom} ${u}`),
    postMessage: () => journal.push(`message ${nom}`) });
  const { t, evenement } = bac({ fenetres: [fenetre("cachee", `${ORIGINE}/`, { visibilityState: "hidden" }), fenetre("active", `${ORIGINE}/?menu=otc`, { focused: true, visibilityState: "visible" })] });
  await evenement("notificationclick", { notification: notif(`${ORIGINE}/?menu=promo_1`) });
  eq("fenêtre au premier plan choisie (pas la première de la liste)", journal.splice(0), ["focus active", `navigate active ${ORIGINE}/?menu=promo_1`]);
  await evenement("notificationclick", { notification: { tag: "test", data: { url: `${ORIGINE}/?notifications=1`, categorie: "test" }, close() {} } });
  eq("notification de test : premier plan seulement (saisies en cours gardées)", [journal.splice(0), t.ouvertes], [["focus active"], []]);
  await evenement("notificationclick", { notification: notif(`${ORIGINE}/?menu=otc`) });
  eq("fenêtre déjà sur l'adresse : premier plan seulement, aucun rechargement", journal.splice(0), ["focus active"]);
}
{
  // admin : fenêtre sur #admin, ou aperçu d'une annonce → nouvelle fenêtre (annonce en rédaction jamais perdue)
  const journal = [];
  const admin = { url: `${ORIGINE}/?banc=1#admin`, focused: true, focus: async () => journal.push("focus"), navigate: async (u) => journal.push(`navigate ${u}`), postMessage: () => journal.push("message") };
  const { t, evenement } = bac({ fenetres: [admin] });
  await evenement("notificationclick", { notification: notif(`${ORIGINE}/?menu=promo_1`) });
  eq("fenêtre sur #admin : lien ouvert dans une nouvelle fenêtre, l'admin n'est pas rechargé", [journal.splice(0), t.ouvertes.splice(0)], [[], [`${ORIGINE}/?menu=promo_1`]]);
  const pharmacie = { url: `${ORIGINE}/?menu=otc`, focused: true, focus: async () => journal.push("focus"), navigate: async (u) => journal.push(`navigate ${u}`) };
  const b2 = bac({ fenetres: [pharmacie] });
  await b2.evenement("notificationclick", { notification: { tag: "apercu", data: { url: `${ORIGINE}/?menu=promo_2`, categorie: "offres" }, close() {} } });
  eq("aperçu d'une annonce : nouvelle fenêtre, jamais la fenêtre en cours", [journal, b2.t.ouvertes], [[], [`${ORIGINE}/?menu=promo_2`]]);
}
{
  const { t, evenement } = bac({ fenetres: [] });
  await evenement("notificationclick", { notification: notif("https://evil.fr/") });
  await evenement("notificationclick", { notification: { data: null, close() {} } });
  eq("aucune fenêtre → openWindow (lien étranger ou absent → accueil)", t.ouvertes, [`${ORIGINE}/`, `${ORIGINE}/`]);
}

// ── pushsubscriptionchange ──
const cle = webpush.generateVAPIDKeys().publicKey;   // clé publique d'essai, en mémoire
const sub = (endpoint, auth) => ({ toJSON: () => ({ endpoint, keys: { p256dh: "BPxx", auth } }) });
{
  const { t, evenement } = bac();
  await evenement("pushsubscriptionchange", { oldSubscription: sub("https://fcm.googleapis.com/fcm/send/ancien", "secret-ancien"), newSubscription: sub("https://fcm.googleapis.com/fcm/send/nouveau", "s2") });
  eq("ancien + nouveau → POST renouveler avec la preuve, sans cookie", t.appels.map((a) => [a.methode, a.u, a.corps?.action, a.corps?.ancien, a.corps?.abonnement?.endpoint, a.credentials]),
    [["POST", "/.netlify/functions/push-abonnement", "renouveler", { endpoint: "https://fcm.googleapis.com/fcm/send/ancien", auth: "secret-ancien" }, "https://fcm.googleapis.com/fcm/send/nouveau", "omit"]]);
}
{
  const { t, evenement } = bac({ fetchReponses: { GET: { disponible: true, cle_publique: cle } }, abonnementNouveau: sub("https://fcm.googleapis.com/fcm/send/re", "s3") });
  await evenement("pushsubscriptionchange", { oldSubscription: sub("https://fcm.googleapis.com/fcm/send/ancien", "secret-ancien"), newSubscription: null });
  eq("sans nouvel abonnement → GET de la clé, subscribe (65 octets, 0x04, userVisibleOnly), puis renouveler",
    [t.appels.map((a) => a.methode), t.abonnements, t.appels[1]?.corps?.abonnement?.endpoint], [["GET", "POST"], [{ userVisibleOnly: true, cle: 65, premier: 4 }], "https://fcm.googleapis.com/fcm/send/re"]);
}
{
  const { t, evenement } = bac({ fetchReponses: { GET: { disponible: false, cle_publique: null } } });
  await evenement("pushsubscriptionchange", { oldSubscription: sub("https://fcm.googleapis.com/fcm/send/ancien", "secret-ancien"), newSubscription: null });
  eq("service indisponible → aucun abonnement, aucun POST", [t.abonnements.length, t.appels.map((a) => a.methode)], [0, ["GET"]]);
}
{
  const { t, evenement } = bac();
  await evenement("pushsubscriptionchange", { oldSubscription: null, newSubscription: sub("https://fcm.googleapis.com/fcm/send/n", "x") });
  await evenement("pushsubscriptionchange", {});
  eq("sans ancien abonnement (aucune preuve) → aucun appel", t.appels.length, 0);
}
{
  const { evenement } = bac();
  let erreur = null;
  try { await evenement("pushsubscriptionchange", { oldSubscription: { toJSON: () => { throw new Error("x"); } } }); } catch (e) { erreur = e; }
  eq("erreur pendant le renouvellement : jamais d'exception", erreur, null);
}

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
