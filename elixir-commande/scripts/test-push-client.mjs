// Tests des notifications côté site (navigateur simulé) : node scripts/test-push-client.mjs
// Hors ligne, sans navigateur : src/notifications/{plateforme,client,demarrage,memo}.js assemblés par esbuild (import.meta.env.DEV
// = false, comme le build de production), puis importés avec un faux navigateur (installerNavigateur) et un faux localStorage.
//  • parcours sur une matrice d'user-agents (iPhone iOS 15.7 / 16.4 / 17 / 26, appli installée, Gmail et Google iOS, Chrome iOS,
//    iPadOS en mode bureau, Android Chrome, Samsung Internet, Firefox, macOS Safari, Chrome, Edge, Firefox de bureau,
//    autorisation refusée, sans service worker) et libellés d'appareil ;
//  • activer : subscribe appelé AVANT toute requête dans le clic (exigence de Safari) ; préparation pas finie →
//    requestPermission d'abord ; refus, absence de réponse, 409 (autre pharmacie), corps envoyé à « abonner » ;
//  • désactiver, oublier (preuve sans jeton, appareil admin gardé, serveur injoignable → désinscription quand même),
//    renouvellement après changement de clés VAPID ;
//  • démarrage : saisie Elixir (aucun statut, aucun abonnement), ouverture fermée, service indisponible, 401, carte,
//    « Plus tard » (30 jours) ; messages du service worker (même origine seulement) ;
//  • App.jsx : points d'insertion attendus (déconnexion, carte jamais en saisie Elixir, panneau, entrée du menu, lien
//    ?commandes=1 des messages « Mes commandes et réclamations »).
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import webpush from "web-push";

const RACINE = new URL("..", import.meta.url).pathname;
const sortie = await build({
  stdin: { contents: ['export * from "./src/notifications/plateforme.js";', 'export * from "./src/notifications/client.js";',
    'export { demarrer } from "./src/notifications/demarrage.js";', 'export { masquee, masquer, empreinteIdentite } from "./src/notifications/memo.js";'].join("\n"),
  resolveDir: RACINE, loader: "js" },
  bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent", define: { "import.meta.env.DEV": "false" },
});
const dossier = mkdtempSync(join(tmpdir(), "test-push-client-"));
const fichier = join(dossier, "client.mjs");
writeFileSync(fichier, sortie.outputFiles[0].text);
const N = await import(pathToFileURL(fichier).href);
rmSync(dossier, { recursive: true, force: true });

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── 1. Parcours et libellés ──
const UA = {
  ios157: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Mobile/15E148 Safari/604.1",
  ios164: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
  ios163: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  ios17app: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ios18gsa: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.687157963 Mobile/15E148 Safari/604.1",
  ios18gmail: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ios26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  crios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  ipadBureau: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
};
const complet = { sw: true, pushManager: true, notification: true, permission: "default", secure: true };
const iosSafari = { sw: true, pushManager: false, notification: false, permission: "default", secure: true, maxTouchPoints: 5 };
const cas = [
  ["iPhone iOS 15.7 Safari", { ...iosSafari, ua: UA.ios157 }, "maj_ios", "iPhone · Safari"],
  ["iPhone iOS 16.3 Safari", { ...iosSafari, ua: UA.ios163 }, "maj_ios", "iPhone · Safari"],
  ["iPhone iOS 16.4 Safari, non installée", { ...iosSafari, ua: UA.ios164 }, "installer_ios", "iPhone · Safari"],
  ["iPhone iOS 17, application installée", { ...complet, ua: UA.ios17app, maxTouchPoints: 5, standalone: true, displayStandalone: true }, "activer", "iPhone · application"],
  ["iPhone iOS 17 installée mais sans PushManager", { ...complet, pushManager: false, ua: UA.ios17app, standalone: true }, "maj_ios", "iPhone · application"],
  ["iPhone appli Google (GSA)", { ...iosSafari, ua: UA.ios18gsa }, "ouvrir_safari", "iPhone · Safari"],
  ["iPhone appli Gmail (WebView sans Safari/)", { ...iosSafari, ua: UA.ios18gmail }, "ouvrir_safari", "iPhone · navigateur"],
  ["iPhone iOS 26 (OS 18_6 + Version/26)", { ...iosSafari, ua: UA.ios26 }, "installer_ios", "iPhone · Safari"],
  ["Chrome sur iPhone", { ...iosSafari, ua: UA.crios }, "installer_ios", "iPhone · Chrome"],
  ["iPadOS en mode bureau (tactile)", { ...iosSafari, ua: UA.ipadBureau, plateformeNav: "MacIntel" }, "installer_ios", "iPad · Safari"],
  ["Android Chrome", { ...complet, ua: UA.android }, "activer", "Android · Chrome"],
  ["Android Chrome, application installée", { ...complet, ua: UA.android, displayStandalone: true }, "activer", "Android · application"],
  ["Samsung Internet", { ...complet, ua: UA.samsung }, "activer", "Android · Samsung Internet"],
  ["Firefox Android", { ...complet, ua: UA.firefoxAndroid }, "activer", "Android · Firefox"],
  ["macOS Safari 17", { ...complet, ua: UA.macSafari }, "activer", "Ordinateur · Safari"],
  ["Chrome Windows", { ...complet, ua: UA.chrome }, "activer", "Ordinateur · Chrome"],
  ["Edge Windows", { ...complet, ua: UA.edge }, "activer", "Ordinateur · Edge"],
  ["Firefox Linux", { ...complet, ua: UA.firefox }, "activer", "Ordinateur · Firefox"],
  ["autorisation refusée", { ...complet, ua: UA.chrome, permission: "denied" }, "refuse", "Ordinateur · Chrome"],
  ["sans service worker", { ...complet, ua: UA.chrome, sw: false }, "non_supporte", "Ordinateur · Chrome"],
  ["page non sécurisée", { ...complet, ua: UA.chrome, secure: false }, "non_supporte", "Ordinateur · Chrome"],
];
for (const [nom, env, parcours, libelle] of cas) eq(`${nom} → ${parcours} · ${libelle}`, [N.parcours(env), N.libelleAppareil(env)], [parcours, libelle]);
eq("déjà abonné → abonne", N.parcours({ ...complet, ua: UA.chrome }, true), "abonne");
eq("versions iOS lisibles", [N.versionIosTexte({ ua: UA.ios157 }), N.versionIosTexte({ ua: UA.ios26 }), N.versionIosTexte({ ua: UA.ios164 })], ["15.7", "26.0", "16.4"]);
eq("plateformes", [N.plateformeDe({ ua: UA.ios164 }), N.plateformeDe({ ua: UA.samsung }), N.plateformeDe({ ua: UA.edge }), N.plateformeDe({ ua: UA.ipadBureau, maxTouchPoints: 5 })],
  ["ios", "android", "ordinateur", "ios"]);
eq("Mac (non tactile) ≠ iPad", N.analyser({ ua: UA.macSafari, maxTouchPoints: 0 }).ios, false);
eq("Android tactile sur une plateforme « MacIntel » (émulation) ≠ iPad", [N.analyser({ ua: UA.android, plateformeNav: "MacIntel", maxTouchPoints: 5 }).ios,
  N.libelleAppareil({ ua: UA.android, plateformeNav: "MacIntel", maxTouchPoints: 5 })], [false, "Android · Chrome"]);
eq("parcours qui montrent la carte", N.PARCOURS_CARTE, ["activer", "installer_ios", "ouvrir_safari"]);

// ── 2. Faux navigateur ──
const ORIGINE = "https://elixir-commande.expepharma.com";
const CLE = webpush.generateVAPIDKeys().publicKey;   // clé publique d'essai, en mémoire
const AUTRE_CLE = webpush.generateVAPIDKeys().publicKey;
eq("clé publique VAPID → 65 octets commençant par 0x04", [N.cleBinaire(CLE).length, N.cleBinaire(CLE)[0]], [65, 4]);
function fauxNavigateur({ permission = "default", reponseConfig = { disponible: true, cle_publique: CLE, ouverture: "toutes" }, sub = null, env = { ...complet, ua: UA.android },
  refusSubscribe = null, reponseOublier = { success: true, role: "pharmacie" }, oublierEnPanne = false, cleSub = CLE, enregistre = true } = {}) {
  const journal = [];
  const etat = { permission, sub, enregistre, messages: null, aller: [] };
  const fabriqueSub = (endpoint, cle) => ({
    endpoint, options: { applicationServerKey: N.cleBinaire(cle).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "BP", auth: `auth-${endpoint.slice(-4)}` } }),
    unsubscribe: async () => { journal.push(`unsubscribe ${endpoint.slice(-4)}`); if (etat.sub?.endpoint === endpoint) etat.sub = null; if (etat.unsubscribeEnPanne) throw new Error("x"); return true; },
  });
  if (sub) etat.sub = fabriqueSub(sub, cleSub);
  const reg = {
    pushManager: {
      getSubscription: async () => etat.sub,
      subscribe: async (o) => {
        journal.push(`subscribe ${o.userVisibleOnly} ${o.applicationServerKey.length}`);
        if (refusSubscribe) { if (refusSubscribe.permission) etat.permission = refusSubscribe.permission; throw Object.assign(new Error("x"), { name: refusSubscribe.nom }); }
        etat.permission = "granted";
        etat.sub ||= fabriqueSub(`https://fcm.googleapis.com/fcm/send/n${journal.length}`, CLE);
        return etat.sub;
      },
    },
    update: async () => { journal.push("update"); },
  };
  return {
    journal, etat, fabriqueSub,
    nav: {
      env: () => ({ ...env, permission: etat.permission }),
      enregistrement: async () => { journal.push("getRegistration"); return etat.enregistre ? reg : null; },
      enregistrer: async () => { journal.push("register"); etat.enregistre = true; return reg; },
      pret: async () => reg,
      permission: () => etat.permission,
      demanderPermission: async () => { journal.push("requestPermission"); etat.permission = "granted"; return "granted"; },
      fetch: async (u, init = {}) => {
        const corps = init.body ? JSON.parse(init.body) : null;
        journal.push(`fetch ${init.method || "GET"}${corps?.action ? ` ${corps.action}` : ""}`);
        if (corps?.action === "oublier") {
          etat.oublier = { corps, init };
          if (oublierEnPanne) throw new TypeError("réseau");
          return new Response(JSON.stringify(reponseOublier), { status: 200 });
        }
        if (corps?.action === "renouveler") { etat.renouveler = corps; return new Response("{}", { status: 200 }); }
        return new Response(JSON.stringify(reponseConfig), { status: 200 });
      },
      ecouterMessages: (fn) => { etat.messages = fn; },
      aller: (u) => etat.aller.push(u),
      origine: () => ORIGINE,
      surAdmin: () => !!etat.surAdmin,
    },
  };
}
// api de la pharmacie : réponses programmées par action
function fausseApi(reponses = {}, journal = []) {
  const recus = [];
  return { recus, role: "pharmacie", appeler: async (action, corps = {}) => {
    journal.push(`api ${action}`); recus.push({ action, corps });
    const r = typeof reponses[action] === "function" ? reponses[action](corps) : reponses[action];
    return r || { statut: 200, corps: { success: true } };
  } };
}

// ── 3. Activation ──
{
  const f = fauxNavigateur({ enregistre: false });
  N.installerNavigateur(f.nav);
  const api = fausseApi({ abonner: { statut: 200, corps: { success: true, appareil: { appareil: "Android · Chrome" } } } }, f.journal);
  await N.preparer();
  eq("préparation : config, service worker enregistré", f.journal.filter((x) => /fetch GET|register/.test(x)), ["fetch GET", "register"]);
  f.journal.length = 0;
  const r = await N.activer({ api });
  eq("clic préparé : subscribe EN PREMIER (aucune requête avant), puis abonner", f.journal, ["subscribe true 65", "api abonner"]);
  eq("résultat : abonné", r.etat, "abonne");
  eq("corps envoyé : abonnement, libellé, plateforme, sans catégories (défaut serveur)", [Object.keys(api.recus[0].corps).sort(), api.recus[0].corps.appareil],
    [["abonnement", "appareil"], { libelle: "Android · Chrome", plateforme: "android", installe: false }]);
}
{
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  const api = fausseApi({}, f.journal);
  const r = await N.activer({ api });
  eq("clic sans préparation : requestPermission d'abord (dans le geste), puis le reste", [f.journal[0], f.journal.includes("subscribe true 65"), r.etat], ["requestPermission", true, "abonne"]);
}
{
  const f = fauxNavigateur({ refusSubscribe: { nom: "NotAllowedError", permission: "denied" } });
  N.installerNavigateur(f.nav);
  await N.preparer();
  eq("refus → refuse (rien envoyé)", [(await N.activer({ api: fausseApi({}, f.journal) })).etat, f.journal.includes("api abonner")], ["refuse", false]);
}
{
  const f = fauxNavigateur({ refusSubscribe: { nom: "NotAllowedError" } });
  N.installerNavigateur(f.nav);
  await N.preparer();
  eq("demande fermée sans choix → sans_reponse", (await N.activer({ api: fausseApi() })).etat, "sans_reponse");
}
{
  const f = fauxNavigateur({ refusSubscribe: { nom: "AbortError" }, env: { ...complet, ua: UA.chrome, brave: true } });
  N.installerNavigateur(f.nav);
  await N.preparer();
  eq("échec du service push (Brave) → echec + brave", await N.activer({ api: fausseApi() }), { etat: "echec", brave: true });
}
{
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  const api = fausseApi({ abonner: (c) => (c.remplacer ? { statut: 200, corps: { success: true } } : { statut: 409, corps: { error: "autre_identite", de: "une autre pharmacie" } }) });
  await N.preparer();
  eq("409 autre_identite → confirmation demandée", await N.activer({ api }), { etat: "autre_identite", de: "une autre pharmacie" });
  eq("« Oui, pour ma pharmacie » → remplacer: true, sans nouvelle demande", [(await N.reactiver({ api, remplacer: true })).etat, api.recus.at(-1).corps.remplacer, f.journal.filter((x) => x === "requestPermission").length],
    ["abonne", true, 0]);
  eq("401 → reconnexion ; 403 fermée ; 503 → indisponible", [
    (await N.enregistrer({ api: fausseApi({ abonner: { statut: 401, corps: {} } }), sub: f.etat.sub })).etat,
    (await N.enregistrer({ api: fausseApi({ abonner: { statut: 403, corps: { error: "fermee" } } }), sub: f.etat.sub })).etat,
    (await N.enregistrer({ api: fausseApi({ abonner: { statut: 503, corps: {} } }), sub: f.etat.sub })).etat], ["reconnexion", "fermee", "indisponible"]);
}
{
  const f = fauxNavigateur({ reponseConfig: { disponible: false, cle_publique: null, ouverture: "fermee" } });
  N.installerNavigateur(f.nav);
  let erreur = null;
  try { await N.preparer(); } catch (e) { erreur = e.code; }
  eq("service indisponible : préparation refusée, aucun service worker", [erreur, f.journal.includes("register")], ["indisponible", false]);
}

// ── 4. Test, catégories, désactivation ──
{
  const f = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/abcd", permission: "granted" });
  N.installerNavigateur(f.nav);
  const api = fausseApi({ test: { statut: 200, corps: { success: true } }, categories: { statut: 200, corps: { success: true, categories: ["stock"] } } }, f.journal);
  eq("test → ok", (await N.envoyerTest({ api })).etat, "ok");
  eq("test : endpoint de CET appareil", api.recus[0].corps, { endpoint: "https://fcm.googleapis.com/fcm/send/abcd" });
  eq("catégories → endpoint + liste", [await N.changerCategories({ api, categories: ["stock"] }), api.recus[1].corps], [{ ok: true, categories: ["stock"] }, { endpoint: "https://fcm.googleapis.com/fcm/send/abcd", categories: ["stock"] }]);
  f.etat.unsubscribeEnPanne = true;
  const d = await N.desactiver({ api });
  eq("désactiver : désinscription locale puis retrait (même si la désinscription échoue)", [d.ok, f.journal.filter((x) => /unsubscribe|api retirer/.test(x)), api.recus.at(-1).corps],
    [true, ["unsubscribe abcd", "api retirer"], { endpoint: "https://fcm.googleapis.com/fcm/send/abcd" }]);
}
{
  const api = { role: "admin", appeler: async () => ({ statut: 200, corps: { envoyes: 2, echecs: 0, retires: 0 } }) };
  eq("test admin : bilan de ses appareils", await N.envoyerTest({ api }), { etat: "ok", bilan: { envoyes: 2, echecs: 0, retires: 0 } });
  const appels = [];
  const adminApi = N.apiAdmin(async (url, init) => { appels.push([url, JSON.parse(init.body).action]); return new Response("{}", { status: 200 }); });
  await adminApi.appeler("abonner", {}); await adminApi.appeler("retirer", { id: "x" }); await adminApi.appeler("etat");
  eq("api admin : abonner_admin, retirer_admin, push-admin", appels, [["/.netlify/functions/push-admin", "abonner_admin"], ["/.netlify/functions/push-admin", "retirer_admin"], ["/.netlify/functions/push-admin", "etat"]]);
}

// ── 5. Déconnexion (oublier) ──
for (const [nom, opts, attendu] of [
  ["pharmacie → désinscription", {}, true],
  ["appareil admin (rôle admin) → gardé", { reponseOublier: { success: true, role: "admin" } }, false],
  ["serveur injoignable → désinscription quand même", { oublierEnPanne: true }, true],
  ["abonnement inconnu du serveur (role null) → désinscription", { reponseOublier: { success: true, role: null } }, true],
]) {
  const f = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/wxyz", permission: "granted", ...opts });
  N.installerNavigateur(f.nav);
  const { reg } = await N.abonnementLocal();
  await N.oublier(reg);
  eq(`oublier, ${nom}`, f.journal.includes("unsubscribe wxyz"), attendu);
  if (!opts.reponseOublier && !opts.oublierEnPanne) {
    eq("oublier : preuve (endpoint + auth), sans jeton ni cookie, keepalive", [f.etat.oublier.corps, f.etat.oublier.init.headers.Authorization ?? null, f.etat.oublier.init.credentials, f.etat.oublier.init.keepalive],
      [{ action: "oublier", endpoint: "https://fcm.googleapis.com/fcm/send/wxyz", auth: "auth-wxyz" }, null, "omit", true]);
  }
}
{
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  await N.oublier(null);
  eq("oublier sans service worker : rien", f.journal.length, 0);
}

// ── 6. Démarrage ──
const stockage = new Map();
globalThis.localStorage = { getItem: (k) => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
globalThis.window = { location: { search: "" } };
const appelStatut = (corps, statut = 200) => { const recus = []; const appel = async (url, init) => { recus.push({ url, corps: JSON.parse(init.body) }); return new Response(JSON.stringify(corps), { status: statut }); }; return { appel, recus }; };
const STATUT = { disponible: true, raison: null, cle_publique: CLE, plafond_offres_7j: 2, appareil: null, autre_identite: false, appareils: [] };
{
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  const { appel, recus } = appelStatut(STATUT);
  const e = await N.demarrer({ appel, identite: "a595", acting: true });
  eq("saisie Elixir : entrée visible, pas de carte, aucun statut ni abonnement", [e, recus.length, f.journal.some((x) => /subscribe|register|requestPermission/.test(x))],
    [{ visible: true, acting: true, carte: false }, 0, false]);
}
{
  const f = fauxNavigateur({ reponseConfig: { disponible: true, cle_publique: CLE, ouverture: "fermee" } });
  N.installerNavigateur(f.nav);
  const { appel, recus } = appelStatut(STATUT);
  eq("ouverture fermée : invisible, aucun statut", [await N.demarrer({ appel, identite: "pa@x.fr" }), recus.length], [{ visible: false }, 0]);
}
{
  const f = fauxNavigateur({ reponseConfig: { disponible: false, cle_publique: null, ouverture: "fermee" } });
  N.installerNavigateur(f.nav);
  eq("service indisponible (clés absentes, tables non créées) : invisible", await N.demarrer({ appel: appelStatut(STATUT).appel, identite: "pa@x.fr" }), { visible: false });
}
{
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  eq("statut 401 : invisible, silencieux", await N.demarrer({ appel: appelStatut({ error: "reconnexion" }, 401).appel, identite: "pa@x.fr" }), { visible: false });
  N.installerNavigateur(fauxNavigateur().nav);
  eq("statut hors pilote : invisible", (await N.demarrer({ appel: appelStatut({ ...STATUT, disponible: false, raison: "hors_pilote" }).appel, identite: "pa@x.fr" })).visible, false);
}
{
  const f = fauxNavigateur({ env: { ...complet, ua: UA.android } });
  N.installerNavigateur(f.nav);
  const { appel, recus } = appelStatut(STATUT);
  const e = await N.demarrer({ appel, identite: "ppa@x.fr" });
  eq("Android non abonné : visible, carte « activer », aucun abonnement au démarrage", [e.visible, e.carte, e.parcours, recus[0].corps, f.journal.some((x) => /subscribe|requestPermission|register/.test(x))],
    [true, true, "activer", { action: "statut" }, false]);
  N.masquer("ppa@x.fr");
  eq("« Plus tard » : clé notif_carte_<empreinte> (aucune adresse e-mail en clair)", [...stockage.keys()].map((k) => [/^notif_carte_[0-9a-f]{16}$/.test(k), k.includes("@")]), [[true, false]]);
  eq("empreinte stable et propre à chaque identité", [N.empreinteIdentite("ppa@x.fr") === N.empreinteIdentite("ppa@x.fr"), N.empreinteIdentite("ppa@x.fr") === N.empreinteIdentite("ppb@x.fr")], [true, false]);
  N.installerNavigateur(fauxNavigateur().nav);
  eq("« Plus tard » : carte masquée", (await N.demarrer({ appel: appelStatut(STATUT).appel, identite: "ppa@x.fr" })).carte, false);
  stockage.set(`notif_carte_${N.empreinteIdentite("ppa@x.fr")}`, String(Date.now() - 31 * 86400e3));
  N.installerNavigateur(fauxNavigateur().nav);
  eq("31 jours plus tard : carte de retour", (await N.demarrer({ appel: appelStatut(STATUT).appel, identite: "ppa@x.fr" })).carte, true);
  eq("masquée 29 jours", N.masquee("x", Date.now()) || (N.masquer("y", Date.now() - 29 * 86400e3), N.masquee("y")), true);
}
{
  const f = fauxNavigateur({ env: { ...iosSafari, ua: UA.ios164 } });
  N.installerNavigateur(f.nav);
  const e = await N.demarrer({ appel: appelStatut(STATUT).appel, identite: "pi@x.fr" });
  eq("iPhone Safari : carte « installer l'application »", [e.carte, e.parcours], [true, "installer_ios"]);
  N.installerNavigateur(fauxNavigateur({ env: { ...complet, ua: UA.chrome, permission: "denied" }, permission: "denied" }).nav);
  const r = await N.demarrer({ appel: appelStatut(STATUT).appel, identite: "pr@x.fr" });
  eq("autorisation refusée : entrée visible, pas de carte (le panneau explique)", [r.visible, r.carte, r.parcours], [true, false, "refuse"]);
}
{
  // appareil abonné : statut avec l'endpoint local, service worker mis à jour ; clés VAPID changées → renouvellement prouvé
  const f = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/old1", permission: "granted", cleSub: AUTRE_CLE });
  N.installerNavigateur(f.nav);
  const { appel, recus } = appelStatut({ ...STATUT, appareil: { id: "x", categories: ["stock"] } });
  const e = await N.demarrer({ appel, identite: "pa@x.fr" });
  await new Promise((r) => setTimeout(r, 20));
  eq("abonné : statut avec l'endpoint de cet appareil, pas de carte", [recus[0].corps, e.carte, e.parcours], [{ action: "statut", endpoint: "https://fcm.googleapis.com/fcm/send/old1" }, false, "abonne"]);
  eq("clés changées : désinscription, nouvel abonnement sans demande, renouveler avec la preuve de l'ancien",
    [f.journal.includes("update"), f.journal.includes("unsubscribe old1"), f.journal.includes("requestPermission"), f.etat.renouveler?.ancien],
    [true, true, false, { endpoint: "https://fcm.googleapis.com/fcm/send/old1", auth: "auth-old1" }]);
  // messages du service worker (Safari ne peut pas changer l'adresse de la fenêtre)
  f.etat.messages({ data: { type: "elixir-notification", url: `${ORIGINE}/?menu=otc` } });
  f.etat.messages({ data: { type: "elixir-notification", url: "https://evil.fr/" } });
  f.etat.messages({ data: { type: "autre", url: `${ORIGINE}/` } });
  eq("message du service worker : même origine seulement", f.etat.aller, [`${ORIGINE}/?menu=otc`]);
}
{
  globalThis.localStorage = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("bloqué"); } };
  let erreur = null;
  try { N.masquer("z"); } catch (e) { erreur = e; }
  eq("stockage bloqué (navigation privée) : carte affichée, aucune exception", [N.masquee("z"), erreur], [false, null]);
}
{
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  await N.lireConfig(); await N.lireConfig();
  eq("configuration gardée 60 s (un seul GET)", f.journal.filter((x) => x === "fetch GET").length, 1);
}

// ── 6 bis. Correctifs de la revue : abonnement mort, carte utile, navigation ──
{
  // F1 : le navigateur rend l'abonnement EXISTANT à subscribe() (même clé) ; le test répond 410 → désinscrit localement,
  // la réactivation enregistre un NOUVEL abonnement (plus jamais la même adresse morte)
  const f = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/mort", permission: "granted" });
  N.installerNavigateur(f.nav);
  const enregistres = [];
  const api = fausseApi({ test: { statut: 410, corps: { error: "expire" } }, abonner: (c) => { enregistres.push(c.abonnement.endpoint); return { statut: 200, corps: { success: true } }; } }, f.journal);
  eq("test 410 → expire, abonnement local désinscrit", [(await N.envoyerTest({ api })).etat, f.journal.includes("unsubscribe mort"), f.etat.sub], ["expire", true, null]);
  await N.preparer();
  const r = await N.activer({ api });
  eq("réactivation : nouvel abonnement, jamais l'adresse morte", [r.etat, enregistres.length, enregistres[0] !== "https://fcm.googleapis.com/fcm/send/mort"], ["abonne", 1, true]);
}
{
  // F1 : au démarrage, abonnement local inconnu du serveur (aucun appareil à ce nom, adresse inconnue ailleurs) → désinscrit
  const f = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/oubl", permission: "granted" });
  N.installerNavigateur(f.nav);
  const e = await N.demarrer({ appel: appelStatut(STATUT).appel, identite: "pf@x.fr" });
  eq("démarrage : abonnement inconnu du serveur désinscrit, carte « activer »", [f.journal.includes("unsubscribe oubl"), e.parcours, e.carte], [true, "activer", true]);
  const g = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/autr", permission: "granted" });
  N.installerNavigateur(g.nav);
  await N.demarrer({ appel: appelStatut({ ...STATUT, autre_identite: true }).appel, identite: "pg@x.fr" });
  eq("démarrage : adresse connue d'une autre identité → jamais désinscrite (confirmation dans le panneau)", g.journal.includes("unsubscribe autr"), false);
  eq("nettoyerSiInconnu : appareil connu → gardé", (await N.nettoyerSiInconnu({ sub: g.etat.sub, statut: { appareil: { id: "x" } } })).nettoye, false);
}
{
  // F1 : 400 « abonnement » → désinscription, nouvel abonnement, UNE seule nouvelle tentative
  const f = fauxNavigateur({ sub: "https://fcm.googleapis.com/fcm/send/v400", permission: "granted" });
  N.installerNavigateur(f.nav);
  await N.preparer();
  let n = 0;
  const api = fausseApi({ abonner: () => (++n === 1 ? { statut: 400, corps: { error: "abonnement" } } : { statut: 200, corps: { success: true } }) }, f.journal);
  eq("400 abonnement : désinscription, nouvel abonnement, 2e envoi accepté", [(await N.reactiver({ api })).etat, n, f.journal.includes("unsubscribe v400")], ["abonne", 2, true]);
  let m = 0;
  const api2 = fausseApi({ abonner: () => { m++; return { statut: 400, corps: { error: "abonnement" } }; } });
  eq("400 répété : une seule nouvelle tentative, puis échec", [(await N.reactiver({ api: api2 })).etat, m], ["echec", 2]);
  // adresse hors des services push connus : désinscrite dès la préparation
  const h = fauxNavigateur({ sub: "https://push.inconnu.example/x/hors", permission: "granted" });
  N.installerNavigateur(h.nav);
  await N.preparer();
  eq("préparation : abonnement chez un service push inconnu désinscrit", h.journal.includes("unsubscribe hors"), true);
}
{
  // U2 : carte seulement si elle sert encore
  const tel = (plateforme, installe = false, extra = {}) => ({ id: plateforme + installe, plateforme, installe, en_echec: false, actuel: false, ...extra });
  const env = (ua, extra = {}) => ({ ...complet, ua, ...extra });
  eq("ordinateur : un téléphone de la pharmacie reçoit déjà → pas de carte", N.carteUtile("activer", env(UA.chrome), { appareils: [tel("android")] }), false);
  eq("ordinateur : seul un autre ordinateur reçoit → carte", N.carteUtile("activer", env(UA.chrome), { appareils: [tel("ordinateur")] }), true);
  eq("ordinateur : téléphone « ne répond plus » → carte", N.carteUtile("activer", env(UA.chrome), { appareils: [tel("ios", true, { en_echec: true })] }), true);
  eq("iPhone dans Safari : application déjà installée et abonnée → pas de carte", N.carteUtile("installer_ios", { ...iosSafari, ua: UA.ios164 }, { appareils: [tel("ios", true)] }), false);
  eq("iPhone dans Safari : aucun iPhone installé → carte", N.carteUtile("installer_ios", { ...iosSafari, ua: UA.ios164 }, { appareils: [tel("android")] }), true);
  eq("2e téléphone Android : carte gardée (texte « N appareils reçoivent déjà… »)", [N.carteUtile("activer", env(UA.android), { appareils: [tel("android")] }), N.joignables({ appareils: [tel("android"), tel("ordinateur")] }).total], [true, 2]);
  const f = fauxNavigateur({ env: env(UA.chrome) });
  N.installerNavigateur(f.nav);
  eq("démarrage sur ordinateur, téléphone déjà joignable : menu visible, pas de carte",
    await N.demarrer({ appel: appelStatut({ ...STATUT, appareils: [tel("ios", true)] }).appel, identite: "pu@x.fr" }).then((e) => [e.visible, e.carte]), [true, false]);
}
{
  // F3 : écoute des messages du service worker branchée dès l'activation ; jamais de navigation sur l'admin (#admin)
  const f = fauxNavigateur();
  N.installerNavigateur(f.nav);
  await N.preparer();
  await N.activer({ api: fausseApi() });
  eq("activation réussie : messages du service worker écoutés dans la même visite", typeof f.etat.messages, "function");
  f.etat.surAdmin = true;
  f.etat.messages({ data: { type: "elixir-notification", url: `${ORIGINE}/?menu=promo_1` } });
  eq("admin ouvert dans la fenêtre : aucune navigation", f.etat.aller, []);
}

// ── 7. App.jsx : points d'insertion ──
const APP = readFileSync(join(RACINE, "src/App.jsx"), "utf8");
const LIGNES = [
  'import { CarteNotifications, PanneauNotifications, EntreeMenuNotifications, demarrerNotifications, oublierAppareilNotifications } from "./notifications/entree.jsx";',
  "    oublierAppareilNotifications();   // cet appareil ne reçoit plus les notifications de la pharmacie (preuve, sans jeton)",
  "alertes={notif?.carte && !actingFor ? <CarteNotifications",
  "{notif?.visible && <EntreeMenuNotifications isDesktop={isDesktop} onOuvrir={() => ouvrirNotifications()} />}",
  "{isDesktop && notif?.visible && <button",
  "<PanneauNotifications appel={appelAuthentifie} acting={actingFor}",
  "demarrerNotifications({ appel: appelAuthentifie, identite: identiteNotif, acting: !!actingFor })",
];
eq("App.jsx : insertions présentes", LIGNES.filter((l) => !APP.includes(l)), []);
const deconnexion = APP.slice(APP.indexOf("const handleLogout = () => {"), APP.indexOf("const handleLogout = () => {") + 200);
eq("déconnexion : oubli de l'appareil AVANT l'effacement des jetons", deconnexion.indexOf("oublierAppareilNotifications") < deconnexion.indexOf('removeItem("pharmacy_token")') || !deconnexion.includes('removeItem("pharmacy_token")'), true);
const ENTREE = readFileSync(join(RACINE, "src/notifications/entree.jsx"), "utf8");
const ACCUEIL = readFileSync(join(RACINE, "src/components/accueil/Accueil.jsx"), "utf8");
eq("accueil : carte des alertes APRÈS les accès rapides (aucun décalage des tuiles)", ACCUEIL.indexOf("{alertes}") > ACCUEIL.indexOf('aria-labelledby="acc-acces-titre"'), true);
eq("bundle principal : aucun import statique de client.js ni de Notifications.jsx", /^import .*(client\.js|Notifications\.jsx)/m.test(ENTREE), false);
// fusion avec origin/master (alertes retour, outils de l'accueil) : rien de perdu d'un côté ni de l'autre
eq("accueil : outils (gp) ET carte des alertes passés par App et reçus par l'accueil",
  [APP.includes("gp={{ autorise: gpAllowed === true && !actingFor"), /suggestions = null, gp = null, alertes = null \}\) \{/.test(ACCUEIL)], [true, true]);
const ADMIN = readFileSync(join(RACINE, "src/AdminPanel.jsx"), "utf8");
eq("admin : onglets « Alertes retour » et « Notifications » distincts, chacun son composant",
  [ADMIN.includes('{k:"alertes",   label:"🔔 Alertes retour"'), ADMIN.includes('{k:"notifications",label:"📲 Notifications",icon:"📲"}'), /tab==="alertes"&&\(\s*<AdminAlertesRetour/.test(ADMIN), /tab==="notifications"&&\(\s*<AdminNotifications/.test(ADMIN)],
  [true, true, true, true]);
const NOTIF = readFileSync(join(RACINE, "src/notifications/Notifications.jsx"), "utf8");
eq("carte : retour en stock branché (plus de « bientôt »)", [/bientôt/.test(NOTIF), NOTIF.includes("Vos produits attendus dès leur retour en stock")], [false, true]);
// messages de l'admin et outil entrepôt (docs/notifications.md § 4 à 6) : lien /?commandes=1 → « Mes commandes » ouvert une fois
// la pharmacie connue, paramètre retiré ; panneau : plafond des informations lu du statut ; admin : bloc de la fiche pharmacie
eq("App.jsx : lien ?commandes=1 (Mes commandes ouvert, paramètre retiré)", [APP.includes('new URLSearchParams(window.location.search).get("commandes") === "1"'),
  APP.includes('u.searchParams.delete("commandes")'), /if \(!lienCommandes\.current \|\| !onboardingDone \|\| !pharmacyCip \|\| pharmacyCip === "0"\) return;/.test(APP)], [true, true, true]);
eq("panneau : catégories avec le plafond des informations", [NOTIF.includes("plafond_infos_7j"), NOTIF.includes("categoriesAffichees(plafond, vue.statut?.plafond_infos_7j ?? PLAFOND_INFOS_DEFAUT)")], [true, true]);
eq("admin : bloc « Notifications envoyées » dans la fiche pharmacie, messages dans un module à part",
  [ADMIN.includes("<NotificationsEnvoyees adminFetch={adminFetch} cip={pharmManual.cip} />"), readFileSync(join(RACINE, "src/components/AdminNotifications.jsx"), "utf8").includes("<Messages etat={etat}")], [true, true]);
eq("aucun module chargé à la demande nommé index.*", /import\(["'][^"']*\/index(\.jsx?)?["']\)/.test(ENTREE + readFileSync(join(RACINE, "src/notifications/demarrage.js"), "utf8")), false);

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
