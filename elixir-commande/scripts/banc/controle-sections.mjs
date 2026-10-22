// ── Banc d'essai : ajout et retrait de produits d'une section (admin, onglet ✏️ Modifier), dans un vrai navigateur ──
// node scripts/banc/controle-sections.mjs [adresse du banc, défaut http://127.0.0.1:5173/]
// Le banc doit tourner (npm run dev, données figées) et venir d'être (re)démarré : ses changements sont en mémoire
// (scripts/banc/sections-banc.mjs). Chrome sans tête piloté par le protocole DevTools (CHROME=<chemin> sinon l'application
// Google Chrome de macOS), profil jetable, jeton admin d'essai ; rien n'est envoyé ailleurs qu'au banc local.
// CAPTURES=<dossier> : captures d'écran (iPhone 375 px, puis bureau). Parcours :
//  1. section « Diagnostic & Covid » : barre de la section, cases et « Retirer » sur les cartes, rien ne dépasse à 375 px ;
//  2. « ＋ Ajouter des produits » : recherche d'un produit absent du site (« Choisir ») et d'un produit d'une autre section
//     (« Déplacer ici », section actuelle nommée), confirmation (groupes, mention du chargement du site), bilan ;
//     le produit nouveau et le produit déplacé sont dans la liste, le déplacé n'est plus dans sa section d'origine ;
//  3. « Retirer » d'une carte : confirmation nommant le produit et la section, bilan, produit sorti de la liste ;
//  4. cases + « Retirer la sélection » : confirmation listant les produits, bilan ;
//  5. « Produits retirés de cette section » : les retirés, « Remettre » ;
//  6. sections exclues : U-Labs (campagne) et menu promo — explication, ni bouton d'ajout ni case ni « Retirer » ;
//  7. écritures : products-upsert seulement (aucune publication de la configuration), une par produit concerné ;
//  8. site des pharmacies (375 px) : la section montre le produit ajouté au chargement suivant ;
//  9. bureau (1280 px) : panneau d'ajout ouvert.
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
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
const clic = (texte, dans = "document") => js(`(() => { const b = [...${dans}.querySelectorAll("button")].find((x) => !x.disabled && (x.textContent + " " + (x.getAttribute("aria-label") || "")).replace(/\\u00a0/g, " ").includes(${T(texte)})); if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; })()`);
const lu = (expr) => js(`(${expr}).replace(/\\u00a0/g, " ")`);
const valeur = (selecteur, v) => js(`(() => { const el = document.querySelector(${T(selecteur)}); if (!el) return false; const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${T(v)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`);
const texte = () => js(`document.body.innerText.replace(/\\u00a0/g, " ")`);
const contenu = ".ex-admin-contenu";
const fenetre = `document.querySelector('[role="dialog"]')`;
const cartes = () => js(`[...document.querySelectorAll(".ex-admin-contenu input[type=checkbox][aria-label^='Sélectionner ']")].map(c => c.getAttribute("aria-label").slice(13))`);
const sansDebord = () => js(`(() => { const c = document.querySelector(${T(contenu)}); return document.documentElement.scrollWidth <= innerWidth && (!c || c.scrollWidth <= c.clientWidth + 1); })()`);
const choisirSection = async (cle) => { await valeur(`${contenu} select`, cle); await pause(400); };

try {
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 2, mobile: true });
  // données du banc (figées) : un produit de la Centrale OTC à déplacer, un produit absent du site à ajouter
  await cdp("Page.navigate", { url: ORIGINE + "/admin" }); await pause(300);
  const figes = await js(`fetch("/.netlify/functions/products-get").then(r => r.json())`);
  const otc = figes.products.filter((p) => p.section === "otc" && /^\d{13}$/.test(p.cip)).sort((a, b) => a.name.localeCompare(b.name))[3];
  const covid0 = figes.products.filter((p) => p.section === "covid").map((p) => p.name);
  vrai("0. données du banc : produits figés (covid et otc)", covid0.length > 2 && !!otc, `${covid0.length} covid`);

  // ── 1. section « Diagnostic & Covid » ──
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("admin_token", "essai-jeton-admin"); sessionStorage.setItem("admin_tab", "edit"); true`);
  await cdp("Page.navigate", { url: ORIGINE + "/admin" });
  vrai("1. onglet Modifier ouvert", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("produit(s) dans Supabase")`));
  await choisirSection("covid");
  vrai("1. barre de la section", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("Ajouter des produits à « Diagnostic & Covid »")`));
  eq("1. une case par carte de la section", (await cartes()).sort(), [...covid0].sort());
  vrai("1. « Retirer » sur chaque carte", await js(`[...document.querySelectorAll("${contenu} button")].filter(b => /^Retirer/.test(b.textContent.trim())).length`) === covid0.length);
  vrai("1. 375 px : rien ne dépasse", await sansDebord());
  vrai("1. 375 px : « de la section » masqué visuellement (libellé court « Retirer »)", await js(`(() => { const s = document.querySelector("${contenu} .ex-admin-libelle"); return !!s && s.getBoundingClientRect().width <= 1; })()`));
  await capture("01-section-covid-375", `${contenu}`);

  // ── 2. ajouter : un produit absent du site, un produit d'une autre section ──
  vrai("2. bouton d'ajout", await clic("Ajouter des produits à « Diagnostic & Covid »"));
  await attendreQue(`!!document.querySelector("#sections-recherche")`);
  await valeur("#sections-recherche", "autotest");
  vrai("2. résultats de recherche", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("Pas encore sur le site")`));
  const nouveau = await js(`(() => { const li = [...document.querySelectorAll("${contenu} li")].find(l => l.innerText.includes("Pas encore sur le site")); return li ? li.querySelector(":scope > div > div").textContent : null; })()`);
  vrai("2. résultat : prix net Odoo et stock", await js(`(() => { const li = [...document.querySelectorAll("${contenu} li")].find(l => l.innerText.includes("Pas encore sur le site")); return /€ net/.test(li.innerText) && /(En stock|Rupture)/.test(li.innerText); })()`));
  await capture("02-recherche-375", "#sections-recherche");
  vrai("2. « Choisir » un produit absent du site", await js(`(() => { const li = [...document.querySelectorAll("${contenu} li")].find(l => l.innerText.includes("Pas encore sur le site")); const b = li && [...li.querySelectorAll("button")].find(x => x.textContent.includes("Choisir")); if (!b) return false; b.click(); return true; })()`));
  await valeur("#sections-recherche", otc.cip);
  vrai("2. produit d'une autre section : section actuelle nommée", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("Dans « Centrale OTC / Para » : un produit n'est que dans une section")`));
  vrai("2. « Déplacer ici »", await clic("Déplacer ici"));
  vrai("2. 2 produits choisis", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("2 produits choisis")`));
  vrai("2. 375 px : rien ne dépasse (recherche)", await sansDebord());
  await capture("03-choix-375", "#sections-recherche");
  vrai("2. « Ajouter 2 produits… »", await clic("Ajouter 2 produits à « Diagnostic & Covid »"));
  vrai("2. confirmation", await attendreQue(`!!${fenetre}`));
  const conf = await lu(`${fenetre}.innerText`);
  vrai("2. confirmation : nouveau, déplacé (section d'origine nommée), chargement du site, panier", /Nouveaux sur le site \(1\)/.test(conf) && /Déplacés ici \(1\)/.test(conf)
    && conf.includes("« Centrale OTC / Para » → « Diagnostic & Covid »") && /prochain chargement du site/.test(conf) && /panier/.test(conf), conf);
  await capture("04-confirmation-ajout-375");
  const n0 = requetes.length;
  vrai("2. « Confirmer (2) »", await clic("Confirmer (2)", fenetre));
  vrai("2. bilan", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("1 ajouté, 1 déplacé ici")`, 20000), (await texte()).slice(0, 400));
  await attendreQue(`!${fenetre}`);
  const covid1 = await cartes();
  vrai("2. produit nouveau et produit déplacé dans la liste", covid1.includes(nouveau) && covid1.includes(otc.name), JSON.stringify({ nouveau, otc: otc.name, covid1 }));
  await capture("05-bilan-ajout-375", `${contenu}`);
  const ecritures2 = requetes.slice(n0).filter((r) => r.methode === "POST");
  eq("2. écritures : 2 products-upsert, aucune configuration", ecritures2.filter((r) => /products-upsert/.test(r.url)).map((r) => JSON.parse(r.corps).action).sort(), ["section_ajout", "section_deplacement"]);
  await choisirSection("otc");
  vrai("2. le produit déplacé n'est plus dans la Centrale OTC", !(await cartes()).includes(otc.name));
  await choisirSection("covid");

  // ── 3. retirer une carte ──
  const cible = covid0[0];
  vrai("3. « Retirer » de la carte", await js(`(() => { const c = document.querySelector('${contenu} input[aria-label=${T("Sélectionner " + cible)}]').closest("div"); const b = [...c.querySelectorAll("button")].find(x => /^Retirer/.test(x.textContent.trim())); b.click(); return true; })()`));
  vrai("3. confirmation", await attendreQue(`!!${fenetre}`));
  const c3 = await lu(`${fenetre}.innerText`);
  vrai("3. confirmation : produit et section nommés, réversible", c3.includes(`Retirer « ${cible} » de « Diagnostic & Covid » ?`) && /Remettre/.test(c3), c3);
  await capture("06-confirmation-retrait-375");
  vrai("3. « Retirer »", await js(`(() => { const b = [...${fenetre}.querySelectorAll("button")].find(x => x.textContent.trim() === "Retirer"); b.click(); return true; })()`));
  vrai("3. bilan", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("1 retiré")`, 20000));
  vrai("3. produit sorti de la liste", !(await cartes()).includes(cible));

  // ── 4. retrait groupé ──
  const deux = (await cartes()).filter((x) => x !== nouveau && x !== otc.name).slice(0, 2);
  for (const nom of deux) await js(`document.querySelector('${contenu} input[aria-label=${T("Sélectionner " + nom)}]').click(); true`);
  vrai("4. barre de la sélection", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("2 sélectionnés")`));
  vrai("4. 375 px : rien ne dépasse (barre)", await js(`(() => { const r = document.querySelector('[aria-label="Produits sélectionnés"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`));
  await pause(2700);   // message de l'étape précédente (2,5 s) disparu
  await capture("07-selection-375");
  vrai("4. « Retirer la sélection »", await clic("Retirer la sélection"));
  vrai("4. confirmation", await attendreQue(`!!${fenetre}`));
  const c4 = await lu(`${fenetre}.innerText`);
  vrai("4. confirmation : les 2 produits listés", deux.every((x) => c4.includes(x)) && c4.includes("Retirer 2 produits de « Diagnostic & Covid » ?"), c4);
  await capture("08-retrait-groupe-375");
  vrai("4. « Retirer 2 produits »", await clic("Retirer 2 produits", fenetre));
  vrai("4. bilan", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("2 retirés")`, 20000));
  vrai("4. produits sortis de la liste", (await cartes()).every((x) => !deux.includes(x)));

  // ── 5. produits retirés, « Remettre » ──
  await js(`document.querySelector("${contenu} details summary").click(); true`);
  vrai("5. liste des retirés : 3", await attendreQue(`document.querySelector("${contenu} details summary").textContent.includes("(3)")`));
  vrai("5. retirés nommés, date et auteur", await js(`(() => { const t = document.querySelector("${contenu} details").innerText; return ${T([cible, ...deux])}.every(x => t.includes(x)) && /Retiré le \\d\\d\\/\\d\\d\\/\\d{4} \\(admin\\)/.test(t); })()`));
  await capture("09-retires-375", `${contenu} details`);
  vrai("5. « Remettre »", await clic(`Remettre ${cible}`));
  vrai("5. bilan et retour dans la liste", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("1 remis")`, 20000) && (await cartes()).includes(cible));
  vrai("5. liste des retirés : 2", await attendreQue(`document.querySelector("${contenu} details summary").textContent.includes("(2)")`));

  // ── 6. sections exclues ──
  await choisirSection("ulabs");
  vrai("6. U-Labs : explication", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("est gérée par une campagne")`));
  eq("6. U-Labs : ni bouton d'ajout, ni case, ni « Retirer »", [await js(`document.body.innerText.replace(/\\u00a0/g, " ").includes("Ajouter des produits à")`), (await cartes()).length,
    await js(`[...document.querySelectorAll("${contenu} button")].filter(b => /^Retirer/.test(b.textContent.trim())).length`)], [false, 0, 0]);
  await capture("10-ulabs-375", `${contenu}`);
  const promo = await js(`[...document.querySelectorAll("${contenu} select option")].map(o => o.value).find(v => v.startsWith("promo_")) || null`);
  if (promo) {
    await choisirSection(promo);
    vrai("6. menu promo : renvoi à l'onglet Promos, pas de bouton d'ajout", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("est un menu promo") && !document.body.innerText.replace(/\\u00a0/g, " ").includes("Ajouter des produits à")`));
    await capture("11-menu-promo-375", `${contenu}`);
  }

  // ── 7. écritures de tout le parcours ──
  const posts = requetes.filter((r) => r.methode === "POST");
  eq("7. aucune publication de la configuration (config-get en POST)", posts.filter((r) => /config-get/.test(r.url)).length, 0);
  eq("7. écritures : products-upsert, une par produit concerné", posts.filter((r) => /products-upsert/.test(r.url)).map((r) => { const c = JSON.parse(r.corps); return `${c.action}:${c.product.cip}`; }).length, 2 + 1 + 2 + 1);
  vrai("7. jamais d'autre écriture que products-upsert (photos Medipim : lecture puis product-upload-image si trouvée)", posts.every((r) => /products-upsert|product-upload-image|search-track/.test(r.url)), JSON.stringify(posts.map((r) => r.url)));

  // ── 8. site des pharmacies : la section suit au chargement suivant ──
  await js(`localStorage.clear(); sessionStorage.clear(); ${Object.entries({ session_email: "banc@pharmacie.test", session_name: "PHARMACIE DU BANC D'ESSAI", session_cip: "9000001", pharmacy_token: "essai-jeton" })
    .map(([k, v]) => `localStorage.setItem(${T(k)}, ${T(v)});`).join(" ")} true`);
  await cdp("Page.navigate", { url: ORIGINE + "/?menu=covid" });
  vrai("8. site : produit ajouté visible dans « Diagnostic & Covid »", await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes(${T(nouveau.slice(0, 30))})`, 20000));
  vrai("8. site : produits retirés absents", await js(`${T(deux)}.every(x => !document.body.innerText.replace(/\\u00a0/g, " ").includes(x))`));
  await clic("Plus tard");   // présentation de l'Assistant Elixir (première visite)
  await pause(300);
  await js(`(() => { const el = [...document.querySelectorAll("main *")].find(x => x.children.length === 0 && x.textContent.includes(${T(nouveau.slice(0, 30))})); el?.scrollIntoView({ block: "center" }); return true; })()`);
  await capture("12-site-covid-375");

  // ── 9. bureau ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("admin_token", "essai-jeton-admin"); sessionStorage.setItem("admin_tab", "edit"); true`);
  await cdp("Page.navigate", { url: ORIGINE + "/admin" });
  await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("produit(s) dans Supabase")`);
  await choisirSection("covid");
  await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("Ajouter des produits à")`);
  await clic("Ajouter des produits à « Diagnostic & Covid »");
  await attendreQue(`!!document.querySelector("#sections-recherche")`);
  await valeur("#sections-recherche", "spray");
  await attendreQue(`document.body.innerText.replace(/\\u00a0/g, " ").includes("Pas encore sur le site") || document.body.innerText.replace(/\\u00a0/g, " ").includes("Aucun produit trouvé")`);
  vrai("9. bureau : « Retirer de la section » en toutes lettres", await js(`[...document.querySelectorAll("${contenu} button")].some(b => b.innerText.trim() === "Retirer de la section")`));
  await capture("13-bureau", `${contenu}`);
} catch (e) {
  ko++; console.log("✗ erreur :", e.message);
} finally {
  ws.close(); chrome.kill();
  await pause(200);
  try { rmSync(profil, { recursive: true, force: true }); } catch { /* profil encore verrouillé */ }
}
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
