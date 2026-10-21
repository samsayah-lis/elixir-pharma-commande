// ── Banc d'essai : appli « Elixir Admin » à l'adresse /admin, dans un vrai navigateur (docs/notifications.md § 10) ──
// node scripts/banc/controle-appli-admin.mjs [adresse du banc, défaut http://localhost:5173/] [construit]
// Le banc doit tourner : npm run dev (données figées), ou « construit » pour la page de production servie par vite preview
// (dist/, sans fonctions : contrôles 1 à 4 seulement). Chrome sans tête piloté par le protocole
// DevTools (CHROME=<chemin> sinon l'application Google Chrome de macOS), profil jetable ; jetons d'essai seulement.
// Rien n'est envoyé ailleurs qu'au banc local.
//  1. « / » : manifeste des pharmacies (une seule balise, celui que Chrome lit, identifiant d'appli « / »), nom « Elixir »,
//     adresse inchangée, connexion des pharmacies ; aussi « /?menu=accueil » avec une session de pharmacie ;
//  2. « /admin » : adresse /admin#admin, manifeste de l'admin (identifiant d'appli « /admin », start_url /admin), nom
//     « Elixir Admin », connexion de l'admin ; « /admin/ » et l'ancienne « /#admin » aussi ;
//  3. la page de départ de l'appli (start_url du manifeste lu par Chrome) affiche l'admin ;
//  4. fermer l'admin (croix), navigateur → page RECHARGÉE sur « / » : manifeste et nom des pharmacies (celui que Chrome lit,
//     identifiant d'appli « / »), connexion des pharmacies ; retour arrière → l'admin (manifeste de l'admin) ; avancer → « / » ;
//  5. jeton admin : « Ouvrir l'administration Elixir » sur la connexion des pharmacies → admin ; « Retour au catalogue » → « / »
//     rechargée (manifeste des pharmacies) ; catalogue d'une pharmacie avec jeton admin, 375 px : cadenas « Administration
//     Elixir » → admin, rien ne dépasse ;
//  6. appli « Elixir Admin » simulée (navigator.standalone, sans jeton) : croix → connexion des pharmacies avec le lien de
//     retour (même page) → admin ; page ouverte plus tard dans l'appli sur « / » (clé appli_admin) : lien gardé ; session de
//     pharmacie dans l'appli : cadenas → admin ; appli des pharmacies simulée sur « / » : aucun lien ni cadenas ;
//  7. onglet 📲 Notifications, iPhone dans Safari simulé (?banc_push=ios-safari), 375 px : consigne « …/admin », sans débord.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANC = (process.argv[2] || "http://localhost:5173/").replace(/\/?$/, "/");
const CONSTRUIT = process.argv[3] === "construit";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/$/.test(BANC)) { console.error("Banc local seulement (http://localhost:<port>/)"); process.exit(2); }
const ORIGINE = BANC.slice(0, -1);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 400);
const profil = mkdtempSync(join(tmpdir(), "controle-appli-admin-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--lang=fr-FR", "about:blank"], { stdio: "ignore" });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const vrai = (label, v, detail = "") => { if (v) { ok++; if (process.env.DETAIL) console.log("✓", label); } else { ko++; console.log("✗", label, detail); } };
const eq = (label, got, exp) => vrai(label, JSON.stringify(got) === JSON.stringify(exp), `→ ${JSON.stringify(got)} attendu ${JSON.stringify(exp)}`);

let page = null;
for (let i = 0; i < 50 && !page; i++) { await pause(200); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* démarrage */ } }
if (!page) { console.error("Chrome injoignable"); chrome.kill(); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let n = 0; const attente = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((r, x) => { const i = ++n; attente.set(i, (m) => (m.error ? x(new Error(`${method} : ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const attendreQue = async (expr, ms = 15000) => { for (let t = 0; t < ms / 50; t++) { try { if (await js(expr)) return true; } catch { /* page en cours de chargement */ } await pause(50); } return false; };

// état de la page : adresse (sans le ?menu= que le catalogue écrit lui-même derrière l'écran affiché), balises manifeste, nom
// de l'icône, écran affiché
const ETAT = `(() => ({
  adresse: (() => { const u = new URL(location.href); u.searchParams.delete("menu"); return u.pathname + u.search + u.hash; })(),
  manifestes: [...document.querySelectorAll('link[rel="manifest"]')].map((l) => l.getAttribute("href")),
  titre: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  admin: !!document.querySelector(".ex-admin"),
  connexionAdmin: document.body.innerText.includes("Espace Admin"),
  panneauAdmin: document.body.innerText.includes("Administration Elixir Pharma"),
  connexionPharmacie: !!document.querySelector("#ident-email"),
  lienAdmin: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Ouvrir l'administration Elixir")),
  cadenas: !!document.querySelector('button[aria-label="Administration Elixir"]'),
  catalogue: !!document.querySelector("[data-cible-panier]"),
}))()`;
const etat = () => js(ETAT);
const pret = () => attendreQue(`!!document.querySelector(".ex-admin, #ident-email, [data-cible-panier], .ex-panier-flottant, header")`);
async function ouvrir(chemin, { stockage = null } = {}) {
  await cdp("Page.navigate", { url: ORIGINE + chemin });
  await pause(300);
  if (stockage) {
    await js(`localStorage.clear(); sessionStorage.clear(); ${Object.entries(stockage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(" ")} true`);
    await cdp("Page.navigate", { url: ORIGINE + chemin });
  }
  await pret(); await pause(600);
  return etat();
}
// manifeste tel que Chrome le lit (adresse, start_url, identifiant d'appli calculé par Chrome)
async function manifesteChrome() {
  const m = await cdp("Page.getAppManifest");
  let data = {}; try { data = JSON.parse(m.data || "{}"); } catch { /* illisible */ }
  let appId = null; try { appId = (await cdp("Page.getAppId")).appId || null; } catch { /* Chrome sans Page.getAppId */ }
  return { url: (m.url || "").slice(ORIGINE.length), start_url: data.start_url, erreurs: (m.errors || []).filter((e) => e.critical).map((e) => e.message), appId };
}
const clic = (texte, dans = "document") => js(`(() => { const b = [...${dans}.querySelectorAll("button")].find((x) => (x.textContent + " " + (x.getAttribute("aria-label") || "")).includes(${JSON.stringify(texte)})); if (!b) return false; b.click(); return true; })()`);
const vierge = { };   // stockage vidé (aucune session, aucun jeton)
// CAPTURES=<dossier> : captures d'écran des écrans contrôlés (relecture à l'œil)
const capture = async (nom, selecteur = null) => {
  if (!process.env.CAPTURES) return;
  if (selecteur) await js(`document.querySelector(${JSON.stringify(selecteur)})?.scrollIntoView({ block: "center" }); true`);
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.CAPTURES, `${nom}.png`), Buffer.from(data, "base64"));
};

try {
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 1. accueil des pharmacies
  let e = await ouvrir("/", { stockage: vierge });
  eq("1. « / » : adresse inchangée, manifeste des pharmacies seul, nom « Elixir »", [e.adresse, e.manifestes, e.titre], ["/", ["/manifest.webmanifest"], "Elixir"]);
  let m = await manifesteChrome();
  eq("1. « / » : manifeste lu par Chrome (des pharmacies, start_url /, sans erreur)", [m.url, m.start_url, m.erreurs], ["/manifest.webmanifest", "/", []]);
  if (m.appId) eq("1. « / » : identifiant d'appli calculé par Chrome", m.appId, `${ORIGINE}/`);
  eq("1. « / » : connexion des pharmacies, pas d'admin, aucun lien vers l'admin (pas de jeton)", [e.connexionPharmacie, e.admin, e.lienAdmin], [true, false, false]);
  if (!CONSTRUIT) {
    e = await ouvrir("/?menu=accueil", { stockage: { session_email: "banc@pharmacie.test", session_name: "PHARMACIE DU BANC D'ESSAI", session_cip: "9000001", pharmacy_token: "essai-jeton" } });
    eq("1. session de pharmacie : adresse des pharmacies, manifeste des pharmacies, pas d'admin, pas de cadenas", [e.adresse, await js("location.search.includes('menu=')"), e.manifestes, e.admin, e.catalogue, e.cadenas],
      ["/", true, ["/manifest.webmanifest"], false, true, false]);
  }

  // 2. adresse de l'admin
  for (const chemin of ["/admin", "/admin/", "/#admin"]) {
    e = await ouvrir(chemin, { stockage: vierge });
    eq(`2. « ${chemin} » : /admin#admin, manifeste de l'admin seul, nom « Elixir Admin »`, [e.adresse, e.manifestes, e.titre], ["/admin#admin", ["/admin.webmanifest"], "Elixir Admin"]);
    eq(`2. « ${chemin} » : connexion de l'admin (jamais celle des pharmacies)`, [e.connexionAdmin, e.connexionPharmacie], [true, false]);
  }
  m = await manifesteChrome();
  eq("2. manifeste lu par Chrome sur /admin (admin, start_url /admin, sans erreur)", [m.url, m.start_url, m.erreurs], ["/admin.webmanifest", "/admin", []]);
  if (m.appId) eq("2. identifiant d'appli de l'admin calculé par Chrome (distinct de celui des pharmacies)", m.appId, `${ORIGINE}/admin`);

  // 3. page de départ de l'appli
  e = await ouvrir(m.start_url || "/admin", { stockage: vierge });
  eq("3. page de départ de l'appli « Elixir Admin » : admin", [e.adresse, e.connexionAdmin], ["/admin#admin", true]);

  // 4. fermer l'admin (navigateur : page rechargée sur « / »), retour arrière, avancer
  {
    await js("window.__memePage = 1; true");   // effacé par un rechargement
    vrai("4. croix de la connexion de l'admin trouvée", await clic("Fermer", 'document.querySelector(".ex-admin")'));
    await attendreQue(`!window.__memePage && !document.querySelector(".ex-admin") && !!document.querySelector("#ident-email")`); await pause(600);
    e = await etat();
    eq("4. croix : page rechargée sur « / », manifeste des pharmacies seul, nom « Elixir », connexion des pharmacies",
      [await js("!window.__memePage"), e.adresse, e.manifestes, e.titre, e.admin, e.connexionPharmacie], [true, "/", ["/manifest.webmanifest"], "Elixir", false, true]);
    m = await manifesteChrome();
    eq("4. croix : manifeste lu par Chrome = celui des pharmacies (installer depuis ce catalogue donne l'appli « Elixir »)", [m.url, m.start_url], ["/manifest.webmanifest", "/"]);
    if (m.appId) eq("4. croix : identifiant d'appli des pharmacies", m.appId, `${ORIGINE}/`);
    await js("history.back(); true"); await attendreQue(`!!document.querySelector(".ex-admin")`); await pause(600);
    e = await etat();
    eq("4. retour arrière : l'admin de nouveau, avec son manifeste", [e.adresse, e.connexionAdmin, e.manifestes, e.titre], ["/admin#admin", true, ["/admin.webmanifest"], "Elixir Admin"]);
    await js("history.forward(); true"); await attendreQue(`!document.querySelector(".ex-admin") && !!document.querySelector("#ident-email")`); await pause(600);
    e = await etat();
    eq("4. avancer : « / » de nouveau, manifeste des pharmacies", [e.adresse, e.admin, e.manifestes], ["/", false, ["/manifest.webmanifest"]]);
  }

  if (!CONSTRUIT) {
    // 5. jeton admin dans ce navigateur
    e = await ouvrir("/", { stockage: { admin_token: "essai-jeton-admin" } });
    eq("5. jeton admin : connexion des pharmacies avec « Ouvrir l'administration Elixir »", [e.connexionPharmacie, e.lienAdmin], [true, true]);
    await clic("Ouvrir l'administration Elixir");
    await attendreQue(`location.hash === "#admin" && !!document.querySelector(".ex-admin")`); await pause(800);
    e = await etat();
    eq("5. lien → /admin#admin, manifeste de l'admin (page rechargée), administration affichée", [e.adresse, e.manifestes, e.panneauAdmin], ["/admin#admin", ["/admin.webmanifest"], true]);
    await js("window.__memePage = 1; true");
    vrai("5. « Retour au catalogue » trouvé", await clic("Retour au catalogue", 'document.querySelector(".ex-admin")'));
    await attendreQue(`!window.__memePage && !document.querySelector(".ex-admin") && !!document.querySelector("#ident-email")`); await pause(600);
    e = await etat();
    eq("5. « Retour au catalogue » → « / » rechargée (manifeste et nom des pharmacies), connexion des pharmacies avec le lien de retour",
      [await js("!window.__memePage"), e.adresse, e.manifestes, e.titre, e.admin, e.lienAdmin], [true, "/", ["/manifest.webmanifest"], "Elixir", false, true]);
    await capture("connexion-pharmacies-lien-admin");

    // catalogue d'une pharmacie avec un jeton admin, téléphone 375 px : cadenas « Administration Elixir » dans l'en-tête
    await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    e = await ouvrir("/?menu=accueil", { stockage: { session_email: "banc@pharmacie.test", session_name: "PHARMACIE DU BANC D'ESSAI AU NOM TRÈS LONG", session_cip: "9000001", pharmacy_token: "essai-jeton", admin_token: "essai-jeton-admin" } });
    eq("5. catalogue avec jeton admin : cadenas « Administration Elixir » dans l'en-tête", [e.catalogue, e.cadenas, e.admin], [true, true, false]);
    vrai("5. en-tête à 375 px : aucun défilement horizontal, cadenas dans l'écran", await js(`(() => { const b = document.querySelector('button[aria-label="Administration Elixir"]'); const r = b?.getBoundingClientRect();
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth && !!r && r.left >= 0 && r.right <= innerWidth + 0.5; })()`));
    await capture("catalogue-cadenas-admin", "header");
    await clic("Administration Elixir");
    await attendreQue(`location.hash === "#admin" && !!document.querySelector(".ex-admin")`); await pause(800);
    e = await etat();
    eq("5. cadenas → /admin#admin rechargée, manifeste de l'admin, administration", [e.adresse, e.manifestes, e.panneauAdmin], ["/admin#admin", ["/admin.webmanifest"], true]);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    // 6. appli installée simulée (comme l'icône de l'iPhone : navigator.standalone)
    const { identifier } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });` });
    e = await ouvrir("/admin", { stockage: vierge });
    eq("6. appli « Elixir Admin » : connexion de l'admin à l'ouverture", [e.adresse, e.connexionAdmin, await js("navigator.standalone === true")], ["/admin#admin", true, true]);
    await capture("appli-admin-ouverture");
    await js("window.__memePage = 1; true");
    await clic("Fermer", 'document.querySelector(".ex-admin")');
    await attendreQue(`!document.querySelector(".ex-admin")`); await pause(300);
    e = await etat();
    eq("6. appli, croix sans jeton : même page, « / », connexion des pharmacies AVEC le lien de retour (pas d'autre chemin)",
      [await js("window.__memePage === 1"), e.adresse, e.connexionPharmacie, e.lienAdmin, await js("localStorage.getItem('appli_admin')")], [true, "/", true, true, "1"]);
    await clic("Ouvrir l'administration Elixir");
    await attendreQue(`!!document.querySelector(".ex-admin")`); await pause(500);
    e = await etat();
    eq("6. appli : le lien rouvre la connexion de l'admin", [e.adresse, e.connexionAdmin], ["/admin#admin", true]);
    // page ouverte plus tard dans l'appli sur une autre adresse (aperçu d'annonce, appli fermée), sans jeton admin
    e = await ouvrir("/?menu=accueil");
    eq("6. appli rouverte sur « / » (clé appli_admin), sans jeton : connexion des pharmacies avec le lien de retour", [e.adresse, e.connexionPharmacie, e.lienAdmin], ["/", true, true]);
    // session de pharmacie dans l'appli de l'admin : le cadenas de l'en-tête ramène à l'admin
    await js(`localStorage.setItem("session_email", "banc@pharmacie.test"); localStorage.setItem("session_name", "PHARMACIE DU BANC D'ESSAI"); localStorage.setItem("session_cip", "9000001"); localStorage.setItem("pharmacy_token", "essai-jeton"); true`);
    e = await ouvrir("/admin");
    await clic("Fermer", 'document.querySelector(".ex-admin")');
    await attendreQue(`!document.querySelector(".ex-admin") && !!document.querySelector("[data-cible-panier]")`); await pause(500);
    e = await etat();
    eq("6. appli avec session de pharmacie, croix : catalogue avec le cadenas « Administration Elixir »", [e.adresse, e.catalogue, e.cadenas, e.connexionPharmacie], ["/", true, true, false]);
    await clic("Administration Elixir");
    await attendreQue(`!!document.querySelector(".ex-admin")`); await pause(500);
    e = await etat();
    eq("6. appli : le cadenas rouvre l'admin", [e.adresse, e.connexionAdmin], ["/admin#admin", true]);
    e = await ouvrir("/", { stockage: vierge });
    eq("6. appli des pharmacies simulée sur « / » : aucun lien vers l'admin", [e.adresse, e.connexionPharmacie, e.lienAdmin, e.manifestes], ["/", true, false, ["/manifest.webmanifest"]]);
    e = await ouvrir("/?menu=accueil", { stockage: { session_email: "banc@pharmacie.test", session_name: "PHARMACIE DU BANC D'ESSAI", session_cip: "9000001", pharmacy_token: "essai-jeton" } });
    eq("6. appli des pharmacies simulée, catalogue : aucun cadenas", [e.catalogue, e.cadenas], [true, false]);
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });

    // 7. onglet 📲 Notifications, iPhone dans Safari simulé, 375 px
    await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    e = await ouvrir("/admin?banc_push=ios-safari", { stockage: { admin_token: "essai-jeton-admin" } });
    eq("7. /admin?banc_push=… : paramètres gardés, admin", [e.adresse, e.panneauAdmin], ["/admin?banc_push=ios-safari#admin", true]);
    vrai("7. onglet 📲 Notifications trouvé", await clic("📲", 'document.querySelector(".ex-admin")'));
    const vu = await attendreQue(`!!document.querySelector('section[aria-labelledby="notif-appareils"]') && document.querySelector('section[aria-labelledby="notif-appareils"]').innerText.includes("expepharma.com/admin")`, 10000);
    const encart = await js(`(() => { const s = document.querySelector('section[aria-labelledby="notif-appareils"]'); if (!s) return null; const t = s.innerText; return { texte: t.includes("elixir-commande.expepharma.com/admin") && t.includes("Sur l'écran d'accueil") && t.includes("supprimez-la"),
      ancien: t.replace("l'ancienne adresse en /#admin", "").includes("#admin") || t.includes("depuis cette page") || t.includes("21/10/2026"), deborde: [...s.querySelectorAll("*")].some((x) => x.getBoundingClientRect().right > innerWidth + 0.5), extrait: t.slice(0, 300) }; })()`);
    vrai("7. consigne d'installation affichée (adresse …/admin, icône ancienne à supprimer)", vu && encart?.texte === true, JSON.stringify(encart));
    eq("7. « #admin » seulement pour désigner l'ancienne icône, ni « depuis cette page » ni date, rien ne dépasse de l'écran à 375 px", [encart?.ancien, encart?.deborde], [false, false]);
    vrai("7. aucun défilement horizontal de la page", await js("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
    await capture("admin-notifications-consigne-iphone", 'section[aria-labelledby="notif-appareils"]');
  }
} catch (err) {
  ko++; console.log("✗ arrêt :", err.message);
} finally {
  try { ws.close(); } catch { /* fermé */ }
  chrome.kill();
  await pause(300);
  try { rmSync(profil, { recursive: true, force: true }); } catch { /* profil encore utilisé */ }
}
console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
