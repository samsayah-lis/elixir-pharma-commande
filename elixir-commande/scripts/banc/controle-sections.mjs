// ── Banc d'essai : ajout et retrait de produits d'une section (admin, onglet ✏️ Modifier), dans un vrai navigateur ──
// node scripts/banc/controle-sections.mjs [adresse du banc, défaut http://127.0.0.1:5173/]
// Le banc doit tourner (npm run dev, données figées) et venir d'être (re)démarré : ses changements sont en mémoire
// (scripts/banc/sections-banc.mjs). Chrome sans tête piloté par le protocole DevTools (CHROME=<chemin> sinon l'application
// Google Chrome de macOS), profil jetable, jeton admin d'essai ; rien n'est envoyé ailleurs qu'au banc local.
// CAPTURES=<dossier> : captures d'écran (iPhone 375 px, puis bureau). Parcours :
//  1. section « Diagnostic & Covid » : barre de la section, cases (cible de 44 px) et « Retirer » sur les cartes, rien ne
//     dépasse à 375 px ; « Toutes sections » : phrase d'aide ;
//  2. « ＋ Ajouter des produits » : recherche à plusieurs mots, « ＋ Ajouter ici » d'un produit absent du site et
//     « Déplacer ici » d'un produit d'une autre section, barre « 2 à ajouter » visible en bas de l'écran, confirmation
//     (groupes accordés, deux sections dans l'avertissement panier), bilan ;
//  3. « Retirer » d'une carte : confirmation, bilan nommant produit et section, « Annuler ce retrait » ;
//  4. cases + « Retirer la sélection » : barre au-dessus du message de l'admin, espace en fin de liste, confirmation, bilan ;
//  5. « Produits retirés de cette section » : groupes, « Remettre » → fenêtre (prix montré), bilan ;
//  6. échec partiel (une écriture en erreur 500) : la fenêtre reste ouverte, raison du produit, « Réessayer pour 1 produit » ;
//  7. Sélection Stratège : colis demandé dans la confirmation, prix carton, corps envoyé avec colis et carton ;
//  8. recherche de l'onglet → « Chercher « … » dans le catalogue Odoo » (panneau ouvert, recherche reprise) ;
//  9. sections exclues : U-Labs (campagne, texte court) et menu promo — explication, ni bouton d'ajout ni case ni « Retirer » ;
// 10. écritures : products-upsert seulement (aucune publication de la configuration), une par produit concerné ;
// 11. site des pharmacies (375 px) : la section montre le produit ajouté au chargement suivant ;
// 12. bureau (1280 px) : panneau d'ajout ouvert.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANC = (process.argv[2] || "http://127.0.0.1:5173/").replace(/\/?$/, "/");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/$/.test(BANC)) { console.error("Banc local seulement (http://localhost:<port>/)"); process.exit(2); }
const ORIGINE = BANC.slice(0, -1);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 400);
const profil = mkdtempSync(join(tmpdir(), "controle-sections-"));
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
const requetes = [];
// fenêtres window.confirm (changement de section avec des produits choisis) : réponse réglée par le parcours
let reponseDialogue = false;
const dialogues = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Page.javascriptDialogOpening") { dialogues.push(m.params.message.replace(/[\u00a0\u202f]/g, " ")); ws.send(JSON.stringify({ id: ++n, method: "Page.handleJavaScriptDialog", params: { accept: reponseDialogue } })); }
  if (m.method === "Network.requestWillBeSent" && /\/\.netlify\/functions\//.test(m.params.request.url)) requetes.push({ methode: m.params.request.method, url: m.params.request.url.slice(ORIGINE.length), corps: m.params.request.postData || null });
  if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); }
};
const cdp = (method, params = {}) => new Promise((r, x) => { const i = ++n; attente.set(i, (m) => (m.error ? x(new Error(`${method} : ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const attendreQue = async (expr, ms = 15000) => { for (let t = 0; t < ms / 50; t++) { try { if (await js(expr)) return true; } catch { /* page en cours de chargement */ } await pause(50); } return false; };
const capture = async (nom, selecteur = null, bloc = "start") => {
  if (!process.env.CAPTURES) return;
  if (selecteur) await js(`document.querySelector(${JSON.stringify(selecteur)})?.scrollIntoView({ block: ${JSON.stringify(bloc)} }); true`);
  await pause(250);
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.CAPTURES, `${nom}.png`), Buffer.from(data, "base64"));
};
const T = JSON.stringify;
// bouton par texte (contenu ou aria-label), dans un conteneur facultatif
// (espaces insécables des guillemets français lues comme des espaces)
const clic = (texte, dans = "document") => js(`(() => { const b = [...${dans}.querySelectorAll("button")].find((x) => !x.disabled && (x.textContent + " " + (x.getAttribute("aria-label") || "")).replace(/[\\u00a0\\u202f]/g, " ").includes(${T(texte)})); if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; })()`);
const lu = (expr) => js(`(${expr}).replace(/[\\u00a0\\u202f]/g, " ")`);
const valeur = (selecteur, v) => js(`(() => { const el = document.querySelector(${T(selecteur)}); if (!el) return false; const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${T(v)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`);
const TXT = `document.body.innerText.replace(/[\\u00a0\\u202f]/g, " ")`;
const contient = (t) => `${TXT}.includes(${T(t)})`;
const texte = () => js(TXT);
const contenu = ".ex-admin-contenu";
const fenetre = `document.querySelector('[role="dialog"]')`;
const cartes = () => js(`[...document.querySelectorAll(".ex-admin-contenu input[type=checkbox][aria-label^='Sélectionner ']")].map(c => c.getAttribute("aria-label").slice(13))`);
const sansDebord = () => js(`(() => { const c = document.querySelector(${T(contenu)}); return document.documentElement.scrollWidth <= innerWidth && (!c || c.scrollWidth <= c.clientWidth + 1); })()`);
const choisirSection = async (cle) => { await valeur(`${contenu} select`, cle); await pause(400); };
const rect = (sel) => js(`(() => { const r = document.querySelector(${T(sel)})?.getBoundingClientRect(); return r ? { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) } : null; })()`);
const resultat = (contientTexte) => `[...document.querySelectorAll("${contenu} li")].find(l => l.innerText.replace(/[\\u00a0\\u202f]/g, " ").includes(${T(contientTexte)}))`;

try {
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  // données du banc (figées) : un produit de la Centrale OTC à déplacer, un produit absent du site à ajouter
  await cdp("Page.navigate", { url: ORIGINE + "/admin" }); await pause(300);
  const figes = await js(`fetch("/.netlify/functions/products-get").then(r => r.json())`);
  const otc = figes.products.filter((p) => p.section === "otc" && /^\d{13}$/.test(p.cip)).sort((a, b) => a.name.localeCompare(b.name))[3];
  const covid0 = figes.products.filter((p) => p.section === "covid").map((p) => p.name);
  vrai("0. données du banc : produits figés (covid et otc)", covid0.length > 2 && !!otc, `${covid0.length} covid`);

  // ── 1. section « Diagnostic & Covid » ──
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("admin_token", "essai-jeton-admin"); sessionStorage.setItem("admin_tab", "edit"); true`);
  await cdp("Page.navigate", { url: ORIGINE + "/admin" });
  vrai("1. onglet Modifier ouvert", await attendreQue(contient("produit(s) dans Supabase")));
  vrai("1. « Toutes sections » : phrase d'aide", await attendreQue(contient("Choisissez une section pour y ajouter des produits ou en retirer plusieurs à la fois.")));
  await choisirSection("covid");
  vrai("1. barre de la section", await attendreQue(contient("Ajouter des produits à « Diagnostic & Covid »")));
  eq("1. une case par carte de la section", (await cartes()).sort(), [...covid0].sort());
  vrai("1. « Retirer » sur chaque carte", await js(`[...document.querySelectorAll("${contenu} button")].filter(b => /^Retirer/.test(b.textContent.trim())).length`) === covid0.length);
  const cible44 = await js(`(() => { const l = document.querySelector("${contenu} input[aria-label^='Sélectionner ']").closest("label").getBoundingClientRect(); return [Math.round(l.width), Math.round(l.height)]; })()`);
  vrai("1. case à cocher : cible de 44 px au doigt", cible44[0] >= 44 && cible44[1] >= 44, JSON.stringify(cible44));
  vrai("1. 375 px : rien ne dépasse", await sansDebord());
  vrai("1. 375 px : « de la section » masqué visuellement (libellé court « Retirer »)", await js(`(() => { const s = document.querySelector("${contenu} .ex-admin-libelle"); return !!s && s.getBoundingClientRect().width <= 1; })()`));
  await capture("01-section-covid-375", `${contenu}`);

  // ── 2. ajouter : un produit absent du site, un produit d'une autre section ──
  vrai("2. bouton d'ajout", await clic("Ajouter des produits à « Diagnostic & Covid »"));
  await attendreQue(`!!document.querySelector("#sections-recherche")`);
  vrai("2. curseur dans le champ de recherche à l'ouverture", await js(`document.activeElement?.id === "sections-recherche"`));
  await valeur("#sections-recherche", "covid autotest");
  vrai("2. recherche à plusieurs mots, ordre inversé : résultats", await attendreQue(contient("Pas encore sur le site")), (await texte()).slice(0, 300));
  const nouveau = await js(`(() => { const li = ${resultat("Pas encore sur le site")}; return li ? li.querySelector(":scope > div > div").textContent : null; })()`);
  vrai("2. résultat : prix net Odoo et stock", await js(`(() => { const li = ${resultat("Pas encore sur le site")}; return /€ net/.test(li.innerText) && /(En stock|Rupture)/.test(li.innerText); })()`));
  await capture("02-recherche-375", "#sections-recherche");
  vrai("2. « ＋ Ajouter ici » un produit absent du site", await js(`(() => { const li = ${resultat("Pas encore sur le site")}; const b = li && [...li.querySelectorAll("button")].find(x => x.textContent.includes("Ajouter ici")); if (!b) return false; b.click(); return true; })()`));
  vrai("2. bouton du résultat : « ✓ À ajouter »", await attendreQue(`[...document.querySelectorAll("${contenu} li button")].some(b => b.textContent.includes("✓ À ajouter"))`));
  await valeur("#sections-recherche", otc.cip);
  vrai("2. produit d'une autre section : section actuelle nommée", await attendreQue(contient("Actuellement dans « Centrale OTC / Para ». « Déplacer ici » l'enlève de « Centrale OTC / Para »")));
  vrai("2. « Déplacer ici »", await clic("Déplacer ici"));
  vrai("2. barre « 2 à ajouter » en bas de l'écran", await attendreQue(`!!document.querySelector('[aria-label="Produits à ajouter"]') && document.querySelector('[aria-label="Produits à ajouter"]').innerText.includes("2 à ajouter")`));
  const barre = await rect('[aria-label="Produits à ajouter"]');
  vrai("2. barre visible à l'écran, au-dessus de la zone du message (≥ 80 px du bas)", barre && barre.t >= 0 && barre.b <= 812 - 80 && barre.l >= 0 && barre.r <= 375, JSON.stringify(barre));
  vrai("2. puces « Nouveau · » et « Déplacé · »", await js(`(() => { const t = ${TXT}; return t.includes("Nouveau · ") && t.includes("Déplacé · "); })()`));
  vrai("2. 375 px : rien ne dépasse (recherche)", await sansDebord());
  // changement de section avec des produits choisis : confirmation ; « Annuler » garde la section et les choix
  reponseDialogue = false;
  await valeur(`${contenu} select`, "otc"); await pause(400);
  vrai("2. changement de section : confirmation demandée", dialogues.at(-1) === "2 produits choisis ne sont pas encore ajoutés : les abandonner ?", JSON.stringify(dialogues));
  vrai("2. confirmation refusée : section et choix gardés", await js(`document.querySelector("${contenu} select").value === "covid"`) && await js(`document.querySelector('[aria-label="Produits à ajouter"]')?.innerText.includes("2 à ajouter") === true`));
  // le dernier résultat à l'écran : la barre reste visible (finding : bouton de validation hors de l'écran)
  await js(`document.querySelector("${contenu} li:last-of-type")?.scrollIntoView({ block: "end" }); true`);
  await capture("03-choix-barre-375");
  vrai("2. barre → « Ajouter à « Diagnostic & Covid » »", await clic("Ajouter à « Diagnostic & Covid »", `document.querySelector('[aria-label="Produits à ajouter"]')`));
  vrai("2. confirmation", await attendreQue(`!!${fenetre}`));
  const conf = await lu(`${fenetre}.innerText`);
  vrai("2. confirmation : groupes accordés, section d'origine, deux sections dans l'avertissement panier", /Nouveau sur le site \(1\)/.test(conf) && /Déplacé ici \(1\)/.test(conf) && /il quitte sa section actuelle/.test(conf)
    && conf.includes("« Centrale OTC / Para » → « Diagnostic & Covid »") && /prochain chargement du site/.test(conf) && conf.includes("de « Diagnostic & Covid » ou de « Centrale OTC / Para » dans son panier"), conf);
  vrai("2. espace fine insécable avant « ; »", await js(`${fenetre}.innerText.includes("\\u202f;")`));
  await capture("04-confirmation-ajout-375");
  const n0 = requetes.length;
  vrai("2. « Ajouter 2 produits »", await clic("Ajouter 2 produits", fenetre));
  vrai("2. bilan", await attendreQue(contient("« Diagnostic & Covid » : 1 ajouté, 1 déplacé ici"), 20000), (await texte()).slice(0, 400));
  await attendreQue(`!${fenetre}`);
  const covid1 = await cartes();
  vrai("2. produit nouveau et produit déplacé dans la liste", covid1.includes(nouveau) && covid1.includes(otc.name), JSON.stringify({ nouveau, otc: otc.name, covid1 }));
  vrai("2. barre « à ajouter » partie", !(await js(`!!document.querySelector('[aria-label="Produits à ajouter"]')`)));
  await capture("05-bilan-ajout-375", `${contenu}`);
  const ecritures2 = requetes.slice(n0).filter((r) => r.methode === "POST");
  eq("2. écritures : 2 products-upsert, aucune configuration", ecritures2.filter((r) => /products-upsert/.test(r.url)).map((r) => JSON.parse(r.corps).action).sort(), ["section_ajout", "section_deplacement"]);
  await choisirSection("otc");
  vrai("2. le produit déplacé n'est plus dans la Centrale OTC", !(await cartes()).includes(otc.name));
  await choisirSection("covid");

  // ── 3. retirer une carte, puis « Annuler ce retrait » ──
  const cible = covid0[0];
  const retirerCarte = (nom) => js(`(() => { const c = document.querySelector('${contenu} input[aria-label=${T("Sélectionner " + nom)}]').closest("div"); const b = [...c.querySelectorAll("button")].find(x => /^Retirer/.test(x.textContent.trim())); b.click(); return true; })()`);
  vrai("3. « Retirer » de la carte", await retirerCarte(cible));
  vrai("3. confirmation", await attendreQue(`!!${fenetre}`));
  const c3 = await lu(`${fenetre}.innerText`);
  vrai("3. confirmation : produit et section nommés, réversible", c3.includes(`Retirer « ${cible} » de « Diagnostic & Covid » ?`) && /Remettre/.test(c3), c3);
  await capture("06-confirmation-retrait-375");
  vrai("3. « Retirer »", await js(`(() => { const b = [...${fenetre}.querySelectorAll("button")].find(x => x.textContent.trim() === "Retirer"); b.click(); return true; })()`));
  vrai("3. bilan : produit et section nommés", await attendreQue(contient(`« ${cible} » retiré de « Diagnostic & Covid »`), 20000));
  vrai("3. produit sorti de la liste", !(await cartes()).includes(cible));
  await capture("06b-bilan-retrait-annuler-375", `${contenu}`);
  vrai("3. « Annuler ce retrait »", await clic("Annuler ce retrait"));
  vrai("3. annulation : produit remis dans la section", await attendreQue(contient(`« ${cible} » remis dans « Diagnostic & Covid »`), 20000) && (await attendreQue(`(${T(cible)}) && [...document.querySelectorAll(".ex-admin-contenu input[aria-label^='Sélectionner ']")].some(c => c.getAttribute("aria-label") === ${T("Sélectionner " + cible)})`)));

  // ── 4. retrait groupé ──
  const deux = (await cartes()).filter((x) => x !== nouveau && x !== otc.name && x !== cible).slice(0, 2);
  for (const nom of deux) await js(`document.querySelector('${contenu} input[aria-label=${T("Sélectionner " + nom)}]').click(); true`);
  vrai("4. barre de la sélection", await attendreQue(contient("2 sélectionnés")));
  const b4 = await rect('[aria-label="Produits sélectionnés"]');
  vrai("4. 375 px : barre dans l'écran, au-dessus de la zone du message (bottom 24)", b4 && b4.l >= 0 && b4.r <= 375 && b4.b <= 812 - 80, JSON.stringify(b4));
  vrai("4. espace en fin de liste tant que la barre est là", await js(`[...document.querySelectorAll("${contenu} div[aria-hidden='true']")].some(d => d.getBoundingClientRect().height >= 140)`));
  await pause(2700);   // message de l'étape précédente (2,5 s) disparu
  await js(`window.scrollTo(0, document.scrollingElement.scrollHeight); document.querySelector("${contenu}")?.scrollTo?.(0, 1e6); true`);
  await pause(300);
  const photos = await js(`(() => { const b = [...document.querySelectorAll("${contenu} button")].find(x => x.textContent.includes("Importer photos Medipim")); if (!b) return null; const r = b.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom) }; })()`);
  const b4b = await rect('[aria-label="Produits sélectionnés"]');
  vrai("4. bas de liste : « Importer photos Medipim » au-dessus de la barre", photos && b4b && photos.b <= b4b.t, JSON.stringify({ photos, barre: b4b }));
  await capture("07-selection-bas-de-liste-375");
  vrai("4. « Retirer la sélection »", await clic("Retirer la sélection"));
  vrai("4. confirmation", await attendreQue(`!!${fenetre}`));
  const c4 = await lu(`${fenetre}.innerText`);
  vrai("4. confirmation : les 2 produits listés", deux.every((x) => c4.includes(x)) && c4.includes("Retirer 2 produits de « Diagnostic & Covid » ?"), c4);
  await capture("08-retrait-groupe-375");
  vrai("4. « Retirer 2 produits »", await clic("Retirer 2 produits", fenetre));
  vrai("4. bilan", await attendreQue(contient("« Diagnostic & Covid » : 2 retirés"), 20000));
  vrai("4. produits sortis de la liste", (await cartes()).every((x) => !deux.includes(x)));

  // ── 5. produits retirés, « Remettre » (fenêtre de confirmation) ──
  await js(`document.querySelector("${contenu} details summary").click(); true`);
  vrai("5. liste des retirés : 2", await attendreQue(`document.querySelector("${contenu} details summary").textContent.includes("(2)")`));
  vrai("5. groupe « Retirés depuis l'admin », date, pas d'auteur « (admin) »", await js(`(() => { const t = document.querySelector("${contenu} details").innerText; return ${T(deux)}.every(x => t.includes(x)) && t.includes("Retirés depuis l'admin (2)") && /Retiré le \\d\\d\\/\\d\\d\\/\\d{4}/.test(t) && !t.includes("(admin)"); })()`));
  await capture("09-retires-375", `${contenu} details`);
  const remis = deux[0];
  vrai("5. « Remettre » → fenêtre", await clic(`Remettre ${remis}`) && await attendreQue(`!!${fenetre}`));
  const c5 = await lu(`${fenetre}.innerText`);
  vrai("5. fenêtre : produit, section, prix montré aux pharmacies et sa source", c5.includes(`Remettre « ${remis} » dans « Diagnostic & Covid » ?`) && /Prix montré aux pharmacies : [\d,]+ € net/.test(c5) && /panier/.test(c5), c5);
  await capture("10-confirmation-remise-375");
  vrai("5. « Remettre »", await js(`(() => { const b = [...${fenetre}.querySelectorAll("button")].find(x => x.textContent.trim() === "Remettre"); if (!b || b.disabled) return false; b.click(); return true; })()`));
  vrai("5. bilan et retour dans la liste", await attendreQue(contient(`« ${remis} » remis dans « Diagnostic & Covid »`), 20000) && (await cartes()).includes(remis));
  vrai("5. liste des retirés : 1", await attendreQue(`document.querySelector("${contenu} details summary").textContent.includes("(1)")`));

  // ── 6. échec partiel : une écriture en erreur 500, la fenêtre reste ouverte ──
  const deux6 = (await cartes()).filter((x) => x !== nouveau && x !== otc.name).slice(0, 2);
  for (const nom of deux6) await js(`document.querySelector('${contenu} input[aria-label=${T("Sélectionner " + nom)}]').click(); true`);
  await attendreQue(contient("2 sélectionnés"));
  await js(`(() => { const f0 = window.fetch; window.__f0 = f0; let k = 0; window.fetch = async (u, o) => { if (String(u).includes("products-upsert") && k++ === 0) return new Response(JSON.stringify({ error: "Supabase 500 : délai dépassé" }), { status: 500, headers: { "Content-Type": "application/json" } }); return f0(u, o); }; return true; })()`);
  await clic("Retirer la sélection");
  await attendreQue(`!!${fenetre}`);
  await clic("Retirer 2 produits", fenetre);
  vrai("6. échec partiel : fenêtre ouverte, ⚠, raison du produit, « Réessayer pour 1 produit »", await attendreQue(`!!${fenetre} && ${fenetre}.innerText.includes("Supabase 500") && ${fenetre}.innerText.includes("Réessayer pour 1 produit") && ${fenetre}.innerText.includes("⚠")`, 20000), await lu(`(${fenetre}?.innerText || "")`));
  await capture("11-echec-partiel-375");
  await js(`window.fetch = window.__f0; true`);
  vrai("6. « Réessayer pour 1 produit » → fait, fenêtre fermée", await clic("Réessayer pour 1 produit", fenetre) && await attendreQue(`!${fenetre}`, 20000));
  vrai("6. les deux produits retirés", await attendreQue(`(() => { const c = [...document.querySelectorAll(".ex-admin-contenu input[aria-label^='Sélectionner ']")].map(x => x.getAttribute("aria-label").slice(13)); return ${T(deux6)}.every(x => !c.includes(x)); })()`));

  // ── 7. Sélection Stratège : colis demandé, prix carton ──
  const dernier7 = (await cartes()).filter((x) => x !== nouveau && x !== otc.name).at(-1);
  const aDeplacer = figes.products.find((p) => p.name === dernier7);
  await choisirSection("stratege");
  vrai("7. Stratège : vendue au colis (mention)", await attendreQue(contient("« Sélection Stratège » se vend au colis")));
  await clic("Ajouter des produits à « Sélection Stratège »");
  await attendreQue(`!!document.querySelector("#sections-recherche")`);
  await valeur("#sections-recherche", aDeplacer.cip);
  vrai("7. résultat à déplacer (Diagnostic & Covid)", await attendreQue(contient("Actuellement dans « Diagnostic & Covid »")), (await texte()).slice(0, 300));
  await clic("Déplacer ici");
  await attendreQue(`!!document.querySelector('[aria-label="Produits à ajouter"]')`);
  await clic("Ajouter à « Sélection Stratège »", `document.querySelector('[aria-label="Produits à ajouter"]')`);
  await attendreQue(`!!${fenetre}`);
  const btn7 = `[...${fenetre}.querySelectorAll("button")].find(x => /^Déplacer 1 produit$/.test(x.textContent.trim()))`;
  vrai("7. confirmation : champ Colis vide, bouton inactif", await js(`!!${fenetre}.querySelector("input[id^='colis-']") && ${fenetre}.querySelector("input[id^='colis-']").value === "" && ${btn7}?.disabled === true`), await lu(`${fenetre}.innerText`));
  await capture("12-stratege-colis-vide-375");
  await valeur(`[role="dialog"] input[id^='colis-']`, "12");
  vrai("7. colis 12 : prix carton affiché, bouton actif", await attendreQue(`${fenetre}.innerText.includes("Prix carton") && ${btn7}?.disabled === false`));
  await capture("13-stratege-colis-375");
  const n7 = requetes.length;
  await js(`${btn7}.click(); true`);
  vrai("7. bilan", await attendreQue(contient("déplacé dans « Sélection Stratège »"), 20000));
  const corps7 = requetes.slice(n7).filter((r) => r.methode === "POST" && /products-upsert/.test(r.url)).map((r) => JSON.parse(r.corps).product);
  vrai("7. corps envoyé : section, colis 12, carton = 12 × prix net", corps7.length === 1 && corps7[0].section === "stratege" && corps7[0].colis === 12 && corps7[0].carton > 0 && corps7[0]._changes?.colis?.apres === 12, JSON.stringify(corps7));

  // ── 8. recherche de l'onglet → catalogue Odoo ──
  await choisirSection("covid");
  await valeur(`${contenu} input:not([type])`, "spray");
  vrai("8. « Chercher « spray » dans le catalogue Odoo pour l'ajouter à « Diagnostic & Covid » »", await attendreQue(contient("Chercher « spray » dans le catalogue Odoo pour l'ajouter à « Diagnostic & Covid »")));
  await capture("14-recherche-haut-375", null);
  await clic("Chercher « spray » dans le catalogue Odoo");
  vrai("8. panneau d'ajout ouvert, recherche reprise", await attendreQue(`document.querySelector("#sections-recherche")?.value === "spray"`));
  await valeur(`${contenu} input:not([type])`, "");

  // ── 9. sections exclues ──
  await choisirSection("ulabs");
  vrai("9. U-Labs : explication courte", await attendreQue(contient("est une campagne : ses produits ne s'ajoutent ni ne se retirent ici") + ` && ${contient("✏️ Modifier.")}`));
  eq("9. U-Labs : ni bouton d'ajout, ni case, ni « Retirer »", [await js(contient("Ajouter des produits à")), (await cartes()).length,
    await js(`[...document.querySelectorAll("${contenu} button")].filter(b => /^Retirer/.test(b.textContent.trim())).length`)], [false, 0, 0]);
  await capture("15-ulabs-375", `${contenu}`);
  const promo = await js(`[...document.querySelectorAll("${contenu} select option")].map(o => o.value).find(v => v.startsWith("promo_")) || null`);
  if (promo) {
    await choisirSection(promo);
    vrai("9. menu promo : renvoi à l'onglet Promos, pas de bouton d'ajout", await attendreQue(`${contient("est un menu promo")} && !${contient("Ajouter des produits à")}`));
    await capture("16-menu-promo-375", `${contenu}`);
  }

  // ── 10. écritures de tout le parcours ──
  const posts = requetes.filter((r) => r.methode === "POST");
  eq("10. aucune publication de la configuration (config-get en POST)", posts.filter((r) => /config-get/.test(r.url)).length, 0);
  // 2 (ajout) + 1 (retrait) + 1 (annulation) + 2 (groupe) + 1 (remise) + 1 (échec partiel : le 2e produit ; le 1er, refusé par
  // le faux fetch, n'est jamais parti) + 1 (réessai) + 1 (Stratège)
  eq("10. écritures : products-upsert, une par produit concerné", posts.filter((r) => /products-upsert/.test(r.url)).length, 2 + 1 + 1 + 2 + 1 + 1 + 1 + 1);
  vrai("10. jamais d'autre écriture que products-upsert (photos Medipim : lecture puis product-upload-image si trouvée)", posts.every((r) => /products-upsert|product-upload-image|search-track/.test(r.url)), JSON.stringify(posts.map((r) => r.url)));

  // ── 11. site des pharmacies : la section suit au chargement suivant ──
  await js(`localStorage.clear(); sessionStorage.clear(); ${Object.entries({ session_email: "banc@pharmacie.test", session_name: "PHARMACIE DU BANC D'ESSAI", session_cip: "9000001", pharmacy_token: "essai-jeton" })
    .map(([k, v]) => `localStorage.setItem(${T(k)}, ${T(v)});`).join(" ")} true`);
  await cdp("Page.navigate", { url: ORIGINE + "/?menu=covid" });
  vrai("11. site : produit ajouté visible dans « Diagnostic & Covid »", await attendreQue(contient(nouveau.slice(0, 30)), 20000));
  vrai("11. site : produits retirés absents", await js(`${T(deux6)}.every(x => !${TXT}.includes(x))`));
  await clic("Plus tard");   // présentation de l'Assistant Elixir (première visite)
  await pause(300);
  await js(`(() => { const el = [...document.querySelectorAll("main *")].find(x => x.children.length === 0 && x.textContent.includes(${T(nouveau.slice(0, 30))})); el?.scrollIntoView({ block: "center" }); return true; })()`);
  await capture("17-site-covid-375");

  // ── 12. bureau ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("admin_token", "essai-jeton-admin"); sessionStorage.setItem("admin_tab", "edit"); true`);
  await cdp("Page.navigate", { url: ORIGINE + "/admin" });
  await attendreQue(contient("produit(s) dans Supabase"));
  await choisirSection("covid");
  await attendreQue(contient("Ajouter des produits à"));
  await clic("Ajouter des produits à « Diagnostic & Covid »");
  await attendreQue(`!!document.querySelector("#sections-recherche")`);
  await valeur("#sections-recherche", "spray");
  await attendreQue(`${contient("Pas encore sur le site")} || ${contient("Aucun produit Odoo")}`);
  vrai("12. bureau : « Retirer de la section » en toutes lettres", await js(`[...document.querySelectorAll("${contenu} button")].some(b => b.innerText.trim() === "Retirer de la section")`));
  await capture("18-bureau", `${contenu}`);
} catch (e) {
  ko++; console.log("✗ erreur :", e.message);
} finally {
  ws.close(); chrome.kill();
  await pause(200);
  try { rmSync(profil, { recursive: true, force: true }); } catch { /* profil encore verrouillé */ }
}
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
