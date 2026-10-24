// Tests de l'appli « Elixir Admin » (adresse /admin) : node scripts/test-appli-admin.mjs
// Hors ligne, sans navigateur (le contrôle dans Chrome : scripts/banc/controle-appli-admin.mjs) :
//  • script en ligne d'index.html (et de dist/index.html après npm run build) exécuté dans node:vm, avec un faux document,
//    pour chaque adresse : UNE seule balise manifeste ajoutée pendant la lecture de la page (aucune balise fixe), celle de
//    l'admin sur /admin, /admin/, /#admin (→ /admin#admin, avant le démarrage du site), celle des pharmacies partout ailleurs,
//    adresse des pharmacies jamais touchée ; nom de l'icône (apple-mobile-web-app-title) ;
//  • manifestes : identifiants distincts (deux applis sur Android), start_url de l'admin sans fragment, portée « / » ;
//  • routage Netlify : /admin servi par index.html (règle /* non forcée, aucun fichier ni règle « admin ») ;
//  • src/adresse-admin.js (quitter l'admin : page rechargée dans un navigateur, même page dans l'appli ; revenir à l'admin ;
//    appli installée, clé appli_admin) et accord avec index.html et public/sw.js ;
//  • App.jsx, client.js, Notifications.jsx, AdminNotifications.jsx et docs/notifications.md : branchements (lien et cadenas
//    de retour à l'admin), textes « Session admin expirée » et textes d'installation.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { CHEMIN_ADMIN, cheminAdmin, surAdresseAdmin, adresseHorsAdmin, quitterAdresseAdmin, enAppli, OUVERT_EN_APPLI_ADMIN, appliAdmin, APPLI_ADMIN } from "../src/adresse-admin.js";

const RACINE = new URL("..", import.meta.url).pathname;
const lire = (f) => readFileSync(join(RACINE, f), "utf8");
const ORIGINE = "https://elixir-commande.expepharma.com";
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };

// ── 1. Script en ligne d'index.html ──
// Faux document : balises <meta name> écrites AVANT le script (seules visibles au moment où il s'exécute), tête qui reçoit
// les balises ajoutées ; faux location / history (replaceState change l'adresse).
function pageDe(html) {
  const tete = html.slice(0, html.indexOf("</head>"));
  const scripts = [...tete.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=|type="module"/.test(m[1] || ""));
  return { tete, scripts, enLigne: scripts[0] };
}
function executer(html, adresse, { replaceStateEchoue = false } = {}) {
  const { tete, enLigne } = pageDe(html);
  const avant = tete.slice(0, enLigne.index);
  const metas = [...avant.matchAll(/<meta name="([^"]+)" content="([^"]*)"\s*\/?>/g)].map((m) => ({ name: m[1], content: m[2] }));
  const ajoutees = [];
  let cur = new URL(adresse, ORIGINE);
  const remplacements = [];
  const contexte = {
    location: { get pathname() { return cur.pathname; }, get search() { return cur.search; }, get hash() { return cur.hash; }, get href() { return cur.href; } },
    history: { state: { garde: 1 }, replaceState(etat, titre, url) { if (replaceStateEchoue) throw new Error("SecurityError"); remplacements.push({ etat, url }); cur = new URL(url, cur); } },
    document: {
      head: { appendChild: (n) => { ajoutees.push(n); return n; } },
      createElement: (tag) => ({ tag, rel: "", href: "" }),
      querySelector: (sel) => { const m = /^meta\[name="([^"]+)"\]$/.exec(sel); return m ? metas.find((x) => x.name === m[1]) || null : null; },
    },
  };
  let erreur = null;
  try { vm.runInNewContext(enLigne[2], contexte); } catch (e) { erreur = e.message; }
  const manifestes = ajoutees.filter((n) => n.tag === "link" && n.rel === "manifest").map((n) => n.href);
  return { erreur, adresse: cur.href.slice(ORIGINE.length), manifestes, titre: metas.find((m) => m.name === "apple-mobile-web-app-title")?.content,
    remplacements: remplacements.length, etatGarde: remplacements.every((r) => r.etat?.garde === 1) };
}

const ADMIN = "/admin.webmanifest", PHARMA = "/manifest.webmanifest";
// [adresse ouverte, adresse attendue, manifeste, nom de l'icône]
const CAS = [
  ["/", "/", PHARMA, "Elixir"],
  ["/?menu=otc", "/?menu=otc", PHARMA, "Elixir"],
  ["/?notifications=1", "/?notifications=1", PHARMA, "Elixir"],
  ["/?cip=3400930000001&menu=saisie", "/?cip=3400930000001&menu=saisie", PHARMA, "Elixir"],
  ["/#autre", "/#autre", PHARMA, "Elixir"],
  ["/#adminx", "/#adminx", PHARMA, "Elixir"],
  ["/administration", "/administration", PHARMA, "Elixir"],
  ["/admin-x", "/admin-x", PHARMA, "Elixir"],
  ["/admin/x", "/admin/x", PHARMA, "Elixir"],
  ["/admin", "/admin#admin", ADMIN, "Elixir Admin"],
  ["/admin/", "/admin#admin", ADMIN, "Elixir Admin"],
  ["/admin?menu=otc", "/admin?menu=otc#admin", ADMIN, "Elixir Admin"],
  ["/admin#admin", "/admin#admin", ADMIN, "Elixir Admin"],
  ["/admin#", "/admin#admin", ADMIN, "Elixir Admin"],          // après « Réinitialiser » de l'ancienne version (« # » vidé)
  ["/admin#autre", "/admin#admin", ADMIN, "Elixir Admin"],
  ["/#admin", "/admin#admin", ADMIN, "Elixir Admin"],          // anciens liens (e-mails gp-reminders, demandes de l'assistant)
  ["/?banc=1#admin", "/admin?banc=1#admin", ADMIN, "Elixir Admin"],
  ["/autre#admin", "/autre#admin", ADMIN, "Elixir Admin"],     // chemin inconnu : manifeste de l'admin, adresse laissée
];

function verifierPage(nom, html) {
  const { scripts, tete } = pageDe(html);
  eq(`${nom} : aucune balise manifeste fixe`, /<link[^>]*rel=["']?manifest/i.test(html), false);
  eq(`${nom} : un seul script en ligne dans la tête`, scripts.length, 1);
  eq(`${nom} : le script en ligne passe avant le script du site`, tete.indexOf('type="module"') === -1 || scripts[0].index < tete.indexOf('type="module"'), true);
  eq(`${nom} : nom de l'icône déclaré avant le script (le script le lit)`, tete.indexOf('name="apple-mobile-web-app-title"') > -1 && tete.indexOf('name="apple-mobile-web-app-title"') < scripts[0].index, true);
  for (const [adresse, attendue, manifeste, titre] of CAS) {
    const r = executer(html, adresse);
    eq(`${nom} ${adresse} : manifeste, nom, adresse`, [r.erreur, r.manifestes, r.titre, r.adresse], [null, [manifeste], titre, attendue]);
    eq(`${nom} ${adresse} : adresse remplacée seulement si elle change (état d'historique gardé)`, [r.remplacements, r.etatGarde], [attendue === adresse ? 0 : 1, true]);
    // accord avec src/adresse-admin.js : la fenêtre obtenue est « sur l'admin » exactement quand le manifeste est celui de l'admin
    eq(`${nom} ${adresse} : accord avec surAdresseAdmin`, surAdresseAdmin(ORIGINE + r.adresse), manifeste === ADMIN);
  }
  const r = executer(html, "/admin", { replaceStateEchoue: true });
  eq(`${nom} : historique refusé → manifeste de l'admin quand même, aucune erreur`, [r.erreur, r.manifestes, r.adresse], [null, [ADMIN], "/admin"]);
}
verifierPage("index.html", lire("index.html"));
const DIST = join(RACINE, "dist/index.html");
if (existsSync(DIST)) verifierPage("dist/index.html", readFileSync(DIST, "utf8"));
else console.log("· dist/index.html absent : lancer npm run build pour vérifier aussi la page construite");

// ── 2. Manifestes ──
const MA = JSON.parse(lire("public/admin.webmanifest"));
const MP = JSON.parse(lire("public/manifest.webmanifest"));
const id = (m) => new URL(m.id, new URL(m.start_url, ORIGINE).origin).href;
eq("manifestes : identifiants distincts (deux applis séparées sur Android)", [id(MP), id(MA)], [`${ORIGINE}/`, `${ORIGINE}/admin`]);
eq("admin : start_url /admin, sans fragment", [MA.start_url, /#/.test(MA.start_url)], ["/admin", false]);
eq("admin : portée « / », affichage appli, nom « Elixir Admin »", [MA.scope, MA.display, MA.short_name], ["/", "standalone", "Elixir Admin"]);
eq("pharmacies : manifeste inchangé (id, start_url, portée, nom)", [MP.id, MP.start_url, MP.scope, MP.short_name, MP.display], ["/", "/", "/", "Elixir", "standalone"]);
for (const m of [MA, MP]) {
  eq(`${m.short_name} : start_url dans la portée`, new URL(m.start_url, ORIGINE).pathname.startsWith(new URL(m.scope, ORIGINE).pathname), true);
  eq(`${m.short_name} : icônes présentes dans public/`, m.icons.filter((i) => !existsSync(join(RACINE, "public", i.src))).map((i) => i.src), []);
}
eq("admin : la page de départ affiche l'admin (script d'index.html)", executer(lire("index.html"), MA.start_url).adresse, "/admin#admin");

// ── 3. Routage Netlify : /admin servi par index.html ──
const regles = lire("public/_redirects").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
// API des pharmacies (24/10/2026) : la route /api/v1/* (forcée vers sa fonction) passe AVANT /*, puis l'adresse courte de sa
// documentation (/api/docs → /api/, page statique public/api/index.html) ; /* reste la dernière règle, non forcée
eq("_redirects : /api/v1/* → api-v1 (forcée), /api/docs → /api/, puis /* → /index.html 200, non forcée (fichiers réels servis d'abord : sw.js, manifestes, assets, /api/)", regles.map((l) => l.split(/\s+/)),
  [["/api/v1/*", "/.netlify/functions/api-v1/:splat", "200!"], ["/api/docs", "/api/", "301"], ["/*", "/index.html", "200"]]);
const toml = lire("netlify.toml");
const redirections = [...toml.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[|$)/g)].map((m) => m[1]);
eq("netlify.toml : redirection /* → /index.html 200 non forcée, aucune autre", redirections.map((r) => [/from = "\/\*"/.test(r), /to = "\/index\.html"/.test(r), /status = 200/.test(r), /force/.test(r)]), [[true, true, true, false]]);
eq("aucune règle ni fichier « admin » qui masquerait /admin", [/\/admin/.test(regles.join("\n") + redirections.join("\n")),
  ["public/admin", "public/admin.html", "public/admin/index.html"].filter((f) => existsSync(join(RACINE, f)))], [false, []]);
if (existsSync(join(RACINE, "dist"))) {
  eq("dist : aucun fichier « admin » (seulement admin.webmanifest), sw.js et manifestes présents",
    [["dist/admin", "dist/admin.html", "dist/admin/index.html"].filter((f) => existsSync(join(RACINE, f))), ["dist/sw.js", "dist/admin.webmanifest", "dist/manifest.webmanifest", "dist/_redirects"].every((f) => existsSync(join(RACINE, f)))], [[], true]);
}
const RACINE_TOML = readFileSync(join(RACINE, "../netlify.toml"), "utf8");
eq("netlify.toml de la racine : aucune redirection (rien ne passe avant celle du site)", /\[\[redirects\]\]/.test(RACINE_TOML), false);

// ── 4. src/adresse-admin.js ──
eq("CHEMIN_ADMIN", CHEMIN_ADMIN, "/admin");
eq("cheminAdmin", ["/admin", "/admin/", "/admin/x", "/administration", "/", "", undefined, null].map(cheminAdmin), [true, true, false, false, false, false, false, false]);
eq("surAdresseAdmin", [`${ORIGINE}/admin#admin`, `${ORIGINE}/admin`, `${ORIGINE}/#admin`, `${ORIGINE}/?banc=1#admin`, `${ORIGINE}/`, `${ORIGINE}/?menu=otc`, `${ORIGINE}/administration`, "illisible", null].map(surAdresseAdmin),
  [true, true, true, true, false, false, false, false, false]);
eq("adresseHorsAdmin : /admin → « / », paramètres gardés, autre chemin gardé",
  [{ pathname: "/admin", search: "?menu=otc" }, { pathname: "/admin/", search: "" }, { pathname: "/", search: "?menu=otc" }, { pathname: "/", search: "" }].map(adresseHorsAdmin), ["/?menu=otc", "/", "/?menu=otc", "/"]);
// fausse fenêtre : navigateur (par défaut) ou appli installée / ouverte depuis l'écran d'accueil (appli: true)
function fenetre(adresse, { pushEchoue = false, appli = false } = {}) {
  const j = [];
  let cur = new URL(adresse, ORIGINE);
  const w = {
    location: { get pathname() { return cur.pathname; }, get search() { return cur.search; }, get hash() { return cur.hash; }, set hash(v) { j.push(`hash=${v}`); cur.hash = v; },
      assign: (u) => { j.push(`assign ${u}`); cur = new URL(u, cur); } },
    history: { pushState: (e, t, u) => { if (pushEchoue) throw new Error("refus"); j.push(`push ${u}`); cur = new URL(u, cur); } },
    navigator: { standalone: appli },
    matchMedia: () => ({ matches: false }),
  };
  return { w, j, adresse: () => cur.href.slice(ORIGINE.length) };
}
{
  // navigateur : vraie navigation (page des pharmacies rechargée avec SON manifeste), rien d'affiché par le rappel
  const f = fenetre("/admin?menu=otc#admin"); let rappels = 0;
  quitterAdresseAdmin(() => rappels++, f.w);
  eq("quitter l'admin sur /admin, navigateur : page rechargée sur « / » (menu gardé), sans pushState ni rappel", [f.j, rappels, f.adresse()], [["assign /?menu=otc"], 0, "/?menu=otc"]);
  const f2 = fenetre("/admin/#admin"); let r0 = 0;
  quitterAdresseAdmin(() => r0++, f2.w);
  eq("quitter l'admin sur /admin/, navigateur : page rechargée sur « / »", [f2.j, r0], [["assign /"], 0]);
  // appli « Elixir Admin » : même page, nouvelle entrée « / » (retour arrière → admin), affichage fermé par le rappel
  const a = fenetre("/admin?menu=otc#admin", { appli: true }); let ra = 0;
  quitterAdresseAdmin(() => ra++, a.w);
  eq("quitter l'admin sur /admin, appli « Elixir Admin » : nouvelle entrée « / » (menu gardé), affichage fermé par le rappel", [a.j, ra, a.adresse()], [["push /?menu=otc"], 1, "/?menu=otc"]);
  const g = fenetre("/#admin"); let r2 = 0;
  quitterAdresseAdmin(() => r2++, g.w);
  eq("quitter l'admin sur /#admin (Ctrl+Maj+A) : « # » vidé comme avant, fermeture par hashchange", [g.j, r2], [["hash="], 0]);
  const g2 = fenetre("/?menu=otc#admin", { appli: true }); let r4 = 0;
  quitterAdresseAdmin(() => r4++, g2.w);
  eq("quitter l'admin sur /?…#admin dans une appli : « # » vidé, aucune navigation", [g2.j, r4], [["hash="], 0]);
  const h = fenetre("/admin#admin", { pushEchoue: true, appli: true }); let r3 = 0;
  quitterAdresseAdmin(() => r3++, h.w);
  eq("appli, historique refusé : l'admin se ferme quand même", r3, 1);
}
const media = (vrais) => (q) => ({ matches: vrais.includes(q) });
eq("enAppli : iPhone écran d'accueil, appli installée, plein écran, navigateur, matchMedia en erreur",
  [enAppli({ navigator: { standalone: true }, matchMedia: media([]) }), enAppli({ navigator: {}, matchMedia: media(["(display-mode: standalone)"]) }),
    enAppli({ navigator: {}, matchMedia: media(["(display-mode: fullscreen)"]) }), enAppli({ navigator: { standalone: false }, matchMedia: media([]) }),
    enAppli({ navigator: {}, matchMedia: () => { throw new Error("x"); } }), enAppli(undefined)], [true, true, true, false, false, false]);
eq("OUVERT_EN_APPLI_ADMIN : faux hors navigateur", OUVERT_EN_APPLI_ADMIN, false);
eq("APPLI_ADMIN : faux hors navigateur", APPLI_ADMIN, false);
// appliAdmin : clé appli_admin posée par l'appli ouverte sur l'admin, relue par les pages ouvertes ensuite dans l'appli
function stockage({ refuse = false, depart = {} } = {}) {
  const m = new Map(Object.entries(depart)), j = [];
  return { j, m, api: { getItem: (k) => { if (refuse) throw new Error("refus"); j.push(`get ${k}`); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (refuse) throw new Error("refus"); j.push(`set ${k}=${v}`); m.set(k, String(v)); } } };
}
const fen = (appli, st) => ({ navigator: { standalone: appli }, matchMedia: () => ({ matches: false }), localStorage: st.api });
{
  const n = stockage();
  eq("appliAdmin, navigateur sur /admin : faux, rien d'écrit ni lu", [appliAdmin(fen(false, n), true), n.j], [false, []]);
  const s1 = stockage();
  eq("appliAdmin, appli ouverte sur l'admin : vrai, clé posée", [appliAdmin(fen(true, s1), true), s1.j], [true, ["set appli_admin=1"]]);
  eq("appliAdmin, même appli plus tard sur une autre adresse (aperçu d'annonce) : vrai par la clé", appliAdmin(fen(true, s1), false), true);
  eq("appliAdmin, appli des pharmacies (aucune clé) : faux", appliAdmin(fen(true, stockage()), false), false);
  eq("appliAdmin, clé présente mais navigateur : faux", appliAdmin(fen(false, stockage({ depart: { appli_admin: "1" } })), false), false);
  eq("appliAdmin, stockage refusé : vrai seulement sur la page ouverte sur l'admin", [appliAdmin(fen(true, stockage({ refuse: true })), true), appliAdmin(fen(true, stockage({ refuse: true })), false)], [true, false]);
}

// public/sw.js : même règle que surAdresseAdmin
{
  const SW = lire("public/sw.js");
  const ligne = /^const surAdmin = .*$/m.exec(SW)?.[0];
  const surAdminSw = vm.runInNewContext(`${ligne}; surAdmin`, { URL });
  const adresses = [`${ORIGINE}/admin#admin`, `${ORIGINE}/admin`, `${ORIGINE}/admin/`, `${ORIGINE}/#admin`, `${ORIGINE}/?menu=otc`, `${ORIGINE}/administration`, `${ORIGINE}/`, "illisible"];
  eq("sw.js : surAdmin d'accord avec surAdresseAdmin", adresses.map((u) => surAdminSw({ url: u })), adresses.map(surAdresseAdmin));
}

// ── 5. Branchements et textes ──
const APP = lire("src/App.jsx");
eq("App.jsx : plus aucun « # » vidé à la main (quitter l'admin passe par quitterAdresseAdmin)", APP.includes('window.location.hash = ""'), false);
eq("App.jsx : « Retour au catalogue » / croix et Ctrl+Maj+A → quitterAdresseAdmin", (APP.match(/quitterAdresseAdmin\(\(\) => setShowAdmin\(false\)\)/g) || []).length, 2);
eq("App.jsx : retour arrière vers /admin#admin (popstate) rouvre l'admin", APP.includes('window.addEventListener("popstate", onHash);') && APP.includes('window.removeEventListener("popstate", onHash);'), true);
eq("App.jsx : admin toujours affiché sur #admin", APP.includes('useState(() => window.location.hash === "#admin")'), true);
eq("App.jsx : « Commander pour une pharmacie » quitte /admin pour « / »", APP.includes('history.replaceState(null, "", adresseHorsAdmin(window.location))'), true);
eq("App.jsx : « Réinitialiser et recharger » → connexion de l'admin (/admin)", APP.includes('localStorage.removeItem("admin_token"); window.location.replace(CHEMIN_ADMIN);'), true);
eq("App.jsx : connexion des pharmacies → « Ouvrir l'administration Elixir » (jeton admin ou appli « Elixir Admin », APPLI_ADMIN)",
  APP.includes("{!reconnexion && (hasAdminToken || APPLI_ADMIN) && <button onClick={() => window.location.assign(CHEMIN_ADMIN)}"), true);
eq("App.jsx : en-tête du catalogue → cadenas « Administration Elixir » (jeton admin ou appli, aussi pendant une saisie)",
  APP.includes('{(hasAdminToken || APPLI_ADMIN) && <button className="ex-icone-entete ex-icone-pastille" onClick={() => window.location.assign(CHEMIN_ADMIN)} title="Ouvrir l\'administration Elixir" aria-label="Administration Elixir"'), true);
eq("App.jsx : déconnexion sans zone élargie quand le cadenas est voisin", APP.includes('className={hasAdminToken || APPLI_ADMIN ? "ex-icone-entete ex-icone-pastille" : "ex-icone-entete ex-icone-pastille ex-cible"} onClick={handleLogout}'), true);
eq("App.jsx : OUVERT_EN_APPLI_ADMIN n'est plus lu directement (APPLI_ADMIN le comprend)", APP.includes("OUVERT_EN_APPLI_ADMIN"), false);
// textes « Session admin expirée » : l'adresse /admin, plus « #admin » (impossible à taper dans l'appli sans barre d'adresse)
const NOTIF = lire("src/notifications/Notifications.jsx");
eq("« Session admin expirée » : plus aucun « ouvrez l'admin (#admin) » (App.jsx, Notifications.jsx)", [APP.includes("ouvrez l'admin (#admin)"), NOTIF.includes("ouvrez l'admin (#admin)")], [false, false]);
eq("« Session admin expirée » : « ouvrez l'administration (elixir-commande.expepharma.com/admin) » ×3",
  (APP.match(/ouvrez l'administration \(elixir-commande\.expepharma\.com\/admin\)/g) || []).length + (NOTIF.match(/ouvrez l'administration \(elixir-commande\.expepharma\.com\/admin\)/g) || []).length, 3);
const ADMIN_PANEL = lire("src/AdminPanel.jsx");
eq("AdminPanel : la croix de la connexion et « Retour au catalogue » appellent onClose", [ADMIN_PANEL.includes('<button onClick={onClose} aria-label="Fermer"'), /onClose\(\); \}\} title="Retour au catalogue"/.test(ADMIN_PANEL)], [true, true]);
eq("client.js : admin reconnu aussi sur /admin (jamais quitté sur un message du service worker)", lire("src/notifications/client.js").includes("surAdmin: () => surAdresseAdmin(w.location.href)"), true);
const AN = lire("src/components/AdminNotifications.jsx");
eq("AdminNotifications : installation depuis …/admin, icône ancienne à supprimer, plus « depuis cette page »",
  [(AN.match(/elixir-commande\.expepharma\.com<wbr \/>\/admin</g) || []).length, AN.includes("supprimez-la de l'écran d'accueil"), AN.includes("depuis cette page")], [2, true, false]);
eq("AdminNotifications : ancienne icône désignée par son adresse (/#admin), sans date ; interrupteur d'iOS 26",
  [AN.includes("(ajoutée depuis l'ancienne adresse en /#admin)"), /21\/10\/2026/.test(AN), AN.includes("sur iOS 26, laissez «&nbsp;Ouvrir en tant qu'app web&nbsp;» activé")], [true, false, true]);
const DOC = lire("docs/notifications.md");
eq("docs : ancienne icône sans date ni cause affirmée, étape 3 à confirmer, iOS 26, Android « Ouvrir dans Elixir », dépannage corrigé",
  [/avant le 21\/10\/2026/.test(DOC), DOC.includes("l'iPhone l'a enregistrée comme l'appli des pharmacies"), DOC.includes("jamais celui des pharmacies (à confirmer au premier essai)"),
    DOC.includes("laissez « Ouvrir en tant qu'app web » activé, puis touchez Ajouter"), DOC.includes("Chrome peut proposer « Ouvrir dans Elixir »"),
    DOC.includes("(ou directement l'administration si vous y êtes déjà connectée dans Safari)"), DOC.includes("« Commander pour une pharmacie ») |"),
    DOC.includes("ou « Terminer » une saisie pour une pharmacie) |"), DOC.includes("Touchez le cadenas en haut")],
  [false, false, true, true, true, true, false, true, true]);
eq("docs : installation iPhone et Android depuis …/admin, plus aucune installation depuis …/#admin, dépannage de l'icône",
  [DOC.includes("tapez** l'adresse `https://elixir-commande.expepharma.com/admin`"), DOC.includes("ouvrez Chrome à la même adresse `https://elixir-commande.expepharma.com/admin`"),
    /Ouvrez Safari à l'adresse `https:\/\/elixir-commande\.expepharma\.com\/#admin`/.test(DOC), DOC.includes("| L'icône « Elixir Admin » ouvre l'accueil des pharmacies |")], [true, true, false, true]);

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
