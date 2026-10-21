// Tests de l'appli « Elixir Admin » (adresse /admin) : node scripts/test-appli-admin.mjs
// Hors ligne, sans navigateur (le contrôle dans Chrome : scripts/banc/controle-appli-admin.mjs) :
//  • script en ligne d'index.html (et de dist/index.html après npm run build) exécuté dans node:vm, avec un faux document,
//    pour chaque adresse : UNE seule balise manifeste ajoutée pendant la lecture de la page (aucune balise fixe), celle de
//    l'admin sur /admin, /admin/, /#admin (→ /admin#admin, avant le démarrage du site), celle des pharmacies partout ailleurs,
//    adresse des pharmacies jamais touchée ; nom de l'icône (apple-mobile-web-app-title) ;
//  • manifestes : identifiants distincts (deux applis sur Android), start_url de l'admin sans fragment, portée « / » ;
//  • routage Netlify : /admin servi par index.html (règle /* non forcée, aucun fichier ni règle « admin ») ;
//  • src/adresse-admin.js (quitter l'admin, revenir à l'admin, appli installée) et accord avec index.html et public/sw.js ;
//  • App.jsx, client.js, AdminNotifications.jsx et docs/notifications.md : branchements et textes d'installation.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { CHEMIN_ADMIN, cheminAdmin, surAdresseAdmin, adresseHorsAdmin, quitterAdresseAdmin, enAppli, OUVERT_EN_APPLI_ADMIN } from "../src/adresse-admin.js";

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
eq("_redirects : une seule règle, /* → /index.html 200, non forcée (fichiers réels servis d'abord : sw.js, manifestes, assets)", regles.map((l) => l.split(/\s+/)), [["/*", "/index.html", "200"]]);
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
function fenetre(adresse, { pushEchoue = false } = {}) {
  const j = [];
  let cur = new URL(adresse, ORIGINE);
  const w = {
    location: { get pathname() { return cur.pathname; }, get search() { return cur.search; }, get hash() { return cur.hash; }, set hash(v) { j.push(`hash=${v}`); cur.hash = v; } },
    history: { pushState: (e, t, u) => { if (pushEchoue) throw new Error("refus"); j.push(`push ${u}`); cur = new URL(u, cur); } },
  };
  return { w, j, adresse: () => cur.href.slice(ORIGINE.length) };
}
{
  const f = fenetre("/admin?menu=otc#admin"); let rappels = 0;
  quitterAdresseAdmin(() => rappels++, f.w);
  eq("quitter l'admin sur /admin : nouvelle entrée « / » (menu gardé), affichage fermé par le rappel", [f.j, rappels, f.adresse()], [["push /?menu=otc"], 1, "/?menu=otc"]);
  const g = fenetre("/#admin"); let r2 = 0;
  quitterAdresseAdmin(() => r2++, g.w);
  eq("quitter l'admin sur /#admin (Ctrl+Maj+A) : « # » vidé comme avant, fermeture par hashchange", [g.j, r2], [["hash="], 0]);
  const h = fenetre("/admin#admin", { pushEchoue: true }); let r3 = 0;
  quitterAdresseAdmin(() => r3++, h.w);
  eq("historique refusé : l'admin se ferme quand même", r3, 1);
}
const media = (vrais) => (q) => ({ matches: vrais.includes(q) });
eq("enAppli : iPhone écran d'accueil, appli installée, plein écran, navigateur, matchMedia en erreur",
  [enAppli({ navigator: { standalone: true }, matchMedia: media([]) }), enAppli({ navigator: {}, matchMedia: media(["(display-mode: standalone)"]) }),
    enAppli({ navigator: {}, matchMedia: media(["(display-mode: fullscreen)"]) }), enAppli({ navigator: { standalone: false }, matchMedia: media([]) }),
    enAppli({ navigator: {}, matchMedia: () => { throw new Error("x"); } }), enAppli(undefined)], [true, true, true, false, false, false]);
eq("OUVERT_EN_APPLI_ADMIN : faux hors navigateur", OUVERT_EN_APPLI_ADMIN, false);

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
eq("App.jsx : connexion des pharmacies → « Ouvrir l'administration Elixir » (jeton admin ou appli « Elixir Admin »)",
  APP.includes("{!reconnexion && (hasAdminToken || OUVERT_EN_APPLI_ADMIN) && <button onClick={() => window.location.assign(CHEMIN_ADMIN)}"), true);
const ADMIN_PANEL = lire("src/AdminPanel.jsx");
eq("AdminPanel : la croix de la connexion et « Retour au catalogue » appellent onClose", [ADMIN_PANEL.includes('<button onClick={onClose} aria-label="Fermer"'), /onClose\(\); \}\} title="Retour au catalogue"/.test(ADMIN_PANEL)], [true, true]);
eq("client.js : admin reconnu aussi sur /admin (jamais quitté sur un message du service worker)", lire("src/notifications/client.js").includes("surAdmin: () => surAdresseAdmin(w.location.href)"), true);
const AN = lire("src/components/AdminNotifications.jsx");
eq("AdminNotifications : installation depuis …/admin, icône ancienne à supprimer, plus « depuis cette page »",
  [(AN.match(/elixir-commande\.expepharma\.com<wbr \/>\/admin</g) || []).length, AN.includes("supprimez-la de l'écran d'accueil"), AN.includes("depuis cette page")], [2, true, false]);
const DOC = lire("docs/notifications.md");
eq("docs : installation iPhone et Android depuis …/admin, plus aucune installation depuis …/#admin, dépannage de l'icône",
  [DOC.includes("tapez** l'adresse `https://elixir-commande.expepharma.com/admin`"), DOC.includes("ouvrez Chrome à la même adresse `https://elixir-commande.expepharma.com/admin`"),
    /Ouvrez Safari à l'adresse `https:\/\/elixir-commande\.expepharma\.com\/#admin`/.test(DOC), DOC.includes("| L'icône « Elixir Admin » ouvre l'accueil des pharmacies |")], [true, true, false, true]);

console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
