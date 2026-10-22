// ── Banc d'essai : contrôles de mise en page de la jauge des paliers (docs/paliers.md), dans un vrai navigateur ──
// node scripts/banc/controle-paliers.mjs [adresse du banc, défaut http://localhost:5173/]
// Le banc doit tourner (npm run dev, données figées : dev-fixtures/get/products-get.json). Chrome sans tête piloté par le
// protocole DevTools (CHROME=<chemin> sinon l'application Google Chrome de macOS), profil jetable ; session de la pharmacie du
// banc (valeurs d'essai). Rien n'est envoyé ailleurs qu'au banc local. Revue du 22/10/2026 :
//  1. Saisie, DAFALGAN 1000 effervescent (palier 20) : hauteur de la ligne identique à 0, 8 et 20 (1 440, 375 et 320 px), aucun
//     défilement horizontal de la page, tableau du détail dans la jauge (375 et 320 px) ;
//  2. Saisie, colis Stratège (palier atteint dès le premier colis) : pas de jauge, petit badge ;
//  3. Saisie, quantité déjà au panier : 15 ajoutés, la jauge dit « Plus que 5 », le palier pose 5, le panier passe à 20 ;
//  4. tableau Master : une ligne à 0, la jauge complète une fois 8 validé, une ligne au palier ; prix unitaire × quantité =
//     sous-total ; frappe 25, « + », « − » sans quitter le champ : la jauge ne garde pas 25 ;
//  5. paliers multiples injectés dans les réponses (navigateur seulement : 4 paliers sur DAFALGAN et DIFFU-K) : aucune
//     étiquette d'étape sur une autre (Saisie 1 440 / 375 / 320, tableau 1 280, tiroir du panier, cartes 1 440 / 375, liste
//     mobile) ; tableau du détail dans la jauge (tiroir du panier, liste mobile).
// Produits repérés par leur CIP dans la Saisie et dans les réponses (paliers injectés) : avec dev-fixtures/_capture.json,
// la recherche du banc (catalogueLocal de plugin.mjs) donne les noms Odoo capturés (« DAFALGAN 1000 mg (paracétamol),
// comprimés effervescents (B/8) ») et non ceux de products-get ; les menus, le tiroir du panier et la liste mobile lisent
// products-get (noms inchangés, sans CIP affiché) et restent repérés par le nom. Le contrôle passe avec ou sans la capture.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANC = (process.argv[2] || "http://localhost:5173/").replace(/\/?$/, "/");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/$/.test(BANC)) { console.error("Banc local seulement (http://localhost:<port>/)"); process.exit(2); }
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 400);
const profil = mkdtempSync(join(tmpdir(), "controle-paliers-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--lang=fr-FR", "about:blank"], { stdio: "ignore" });
const pause = (ms) => new Promise(r => setTimeout(r, ms));
let ok = 0, ko = 0;
const vrai = (label, v, detail = "") => { if (v) { ok++; if (process.env.DETAIL) console.log("✓", label, detail); } else { ko++; console.log("✗", label, detail); } };

let page = null;
for (let i = 0; i < 50 && !page; i++) { await pause(200); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === "page"); } catch { /* démarrage */ } }
if (!page) { console.error("Chrome injoignable"); chrome.kill(); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let n = 0; const attente = new Map();
// produits du contrôle (CIP de dev-fixtures/get/products-get.json ; noms de products-get pour les menus et le panier)
const CIP_DAFALGAN_EFFV = "3400935291035";     // DAFALGAN 1000MG CPR EFFV TB 8 (Master, palier 20)
const CIP_DAFALGAN_GELU = "3400930186947";     // DAFALGAN 1000MG GELU BT 8 (Stratège, colis 160, palier 160)
const CIP_DIFFU_K = "3400932905997";           // DIFFU-K 600MG BTE 40 CAPS (OTC)
// paliers injectés (contrôle 5), par CIP : réécrits dans la réponse de products-get et de la recherche de la Saisie
const INJ = {
  [CIP_DAFALGAN_EFFV]: [{ min_qty: 6, price: 0.82 }, { min_qty: 12, price: 0.81 }, { min_qty: 24, price: 0.79 }, { min_qty: 48, price: 0.77 }],
  [CIP_DIFFU_K]: [{ min_qty: 6, price: 1.53 }, { min_qty: 12, price: 1.5 }, { min_qty: 30, price: 1.45 }, { min_qty: 60, price: 1.4 }],
};
let injecter = false;
ws.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); return; }
  if (m.method !== "Fetch.requestPaused") return;
  const { requestId } = m.params;
  try {
    if (!injecter) throw new Error("tel quel");
    const b = await cdp("Fetch.getResponseBody", { requestId });
    const j = JSON.parse(b.base64Encoded ? Buffer.from(b.body, "base64").toString("utf8") : b.body);
    for (const p of j.products || []) if (INJ[p.cip]) p.price_tiers = INJ[p.cip].map(t => ({ ...t, pct: Math.round((1 - t.price / (p.pv || p.list_price)) * 1000) / 10 }));
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(j)).toString("base64") });
  } catch { cdp("Fetch.continueRequest", { requestId }).catch(() => {}); }
};
const cdp = (method, params = {}) => new Promise((r, x) => { const i = ++n; attente.set(i, m => (m.error ? x(new Error(`${method} : ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const attendre = async (expr) => { for (let t = 0; t < 300; t++) { if (await js(`!!(${expr})`)) return; await pause(50); } throw new Error(`introuvable : ${expr}`); };

async function ouvrir(chemin, l, h, mobile = false) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: l, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await cdp("Emulation.setTouchEmulationEnabled", mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp("Page.navigate", { url: BANC }); await pause(900);
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("session_email", "banc@pharmacie.test"); localStorage.setItem("session_name", "PHARMACIE DU BANC D'ESSAI");
    localStorage.setItem("session_cip", "9000001"); localStorage.setItem("pharmacy_token", "essai-jeton");
    localStorage.setItem("assistant_presentation_pbanc@pharmacie.test", JSON.stringify({ vues: 3, fini: true, derniere: Date.now() })); true`);
  await cdp("Page.navigate", { url: BANC + chemin }); await pause(2200);
  await js(`(() => { const b = [...document.querySelectorAll("[role=dialog] button")].find(b => /Fermer|Plus tard|Continuer/.test(b.getAttribute("aria-label") || b.textContent)); b?.click(); return true; })()`);
  await pause(250);
}
// frappe dans un champ (setter natif + événement input), validation par Entrée
const taper = (sel, v) => js(`(() => { const i = ${sel}; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; i.focus(); s.call(i, ${JSON.stringify(String(v))}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const valider = (sel) => js(`(() => { ${sel}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
// ligne de la Saisie par son CIP (écrit en clair par CipCell dans .ex-saisie-info), quel que soit le nom affiché
const ligneSaisie = (cip) => `[...document.querySelectorAll(".ex-saisie-ligne")].find(l => [...l.querySelectorAll(".ex-saisie-info span")].some(s => s.textContent === ${JSON.stringify(cip)}))`;
const rangee = (re) => `[...document.querySelectorAll("tr.ex-tr")].find(t => ${re}.test(t.textContent))`;
const defile = () => js(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
// chevauchement (px) le plus fort entre étiquettes visibles d'une même jauge : prix des étapes, quantités (et le 0)
const chevauchement = (sel) => js(`(() => { let pire = -Infinity; for (const g of document.querySelectorAll(${JSON.stringify(sel)})) {
  for (const cls of [".ex-jauge__remise", ".ex-jauge__q, .ex-jauge__zero"]) {
    const b = [...g.querySelectorAll(cls)].filter(e => e.offsetParent && getComputedStyle(e).visibility !== "hidden").map(e => e.getBoundingClientRect()).sort((a, c) => a.left - c.left);
    for (let i = 1; i < b.length; i++) pire = Math.max(pire, b[i - 1].right - b[i].left); } }
  return Math.round(pire * 10) / 10; })()`);
// débordement (px) du tableau du détail hors du cadre intérieur de sa jauge (≤ 0 : dedans)
const tableHors = (jauge) => js(`(() => { const g = ${jauge}, t = g.querySelector(".ex-jauge__table"), cs = getComputedStyle(g);
  return Math.round((t.getBoundingClientRect().right - (g.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth))) * 10) / 10; })()`);
const ouvrirPanier = async () => { await js(`[...document.querySelectorAll("button")].find(b => /panier/i.test(b.getAttribute("aria-label") || ""))?.click()`); await pause(700); };

await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/.netlify/functions/products-get*", requestStage: "Response" }, { urlPattern: "*/.netlify/functions/odoo-catalog?q=*", requestStage: "Response" }] });
try {
  // 1. Saisie : hauteur stable, pas de défilement, détail dans la jauge
  const D = ligneSaisie(CIP_DAFALGAN_EFFV);
  for (const [l, h, mob] of [[1440, 900, false], [375, 812, true], [320, 700, true]]) {
    await ouvrir("?cip=dafalgan", l, h, mob);
    await attendre(`${D}?.querySelector(".ex-jauge")`);
    const hauteurs = [];
    for (const q of [0, 8, 20]) { await taper(`${D}.querySelector("input")`, q); await pause(200); hauteurs.push(Math.round(await js(`${D}.getBoundingClientRect().height`))); }
    vrai(`Saisie ${l} px : hauteur de la ligne identique à 0, 8 et 20`, new Set(hauteurs).size === 1, hauteurs.join(" / "));
    await taper(`${D}.querySelector("input")`, 8); await pause(150);
    await js(`${D}.querySelector(".ex-jauge__detail").click()`); await pause(200);
    if (mob) vrai(`Saisie ${l} px : tableau du détail dans la jauge`, await tableHors(`${D}.querySelector(".ex-jauge")`) <= 0.5, `${await tableHors(`${D}.querySelector(".ex-jauge")`)} px`);
    vrai(`Saisie ${l} px : aucun défilement horizontal`, await defile() <= 0, `${await defile()} px`);
    // 2. colis Stratège : badge, pas de jauge
    const S = ligneSaisie(CIP_DAFALGAN_GELU);
    if (l === 1440) vrai("Saisie, colis 160 et palier 160 : petit badge, pas de jauge", await js(`!${S}.querySelector(".ex-jauge") && /0,80\\s€ dès 160/.test(${S}.textContent)`));
  }
  // 3. Saisie, quantité déjà au panier
  await ouvrir("?cip=dafalgan", 1440, 900);
  await attendre(`${D}?.querySelector(".ex-jauge")`);
  const panier = () => js(`JSON.parse(localStorage.getItem("cart_quantities") || "{}")`);
  await taper(`${D}.querySelector("input")`, 15); await pause(150);
  await js(`${D}.querySelector(".ex-saisie-ajouter").click()`); await pause(500);
  const incit = await js(`${D}.querySelector(".ex-jauge__incitation").textContent.replace(/\\s+/g, " ")`);
  vrai("Saisie, 15 au panier : « Plus que 5 » et « dont 15 déjà au panier »", /^Plus que 5 pour/.test(incit) && /dont 15 déjà au panier/.test(await js(`${D}.querySelector(".ex-jauge").textContent`)), incit);
  await js(`${D}.querySelector("button.ex-jauge__etape").click()`); await pause(200);
  vrai("Saisie, 15 au panier : le palier pose 5", await js(`${D}.querySelector("input").value`) === "5");
  await js(`${D}.querySelector(".ex-saisie-ajouter").click()`); await pause(500);
  vrai("Saisie : 15 + 5 = 20 au panier", Object.values(await panier()).includes(20), JSON.stringify(await panier()));

  // 4. tableau Master : modes, prix × quantité = sous-total, frappe périmée
  await ouvrir("?menu=master", 1440, 900);
  const R = rangee(/DAFALGAN 1000MG CPR EFFV TB 8/);
  await attendre(`${R}?.nextElementSibling?.querySelector(".ex-jauge")`);
  const variante = () => js(`${R}.nextElementSibling.querySelector(".ex-jauge").dataset.variante`);
  vrai("tableau à 0 : une ligne", await variante() === "ligne");
  await taper(`${R}.querySelector("input")`, 8); await pause(150);
  vrai("tableau, frappe 8 : toujours une ligne (rien ne bouge pendant la frappe), texte à jour", await variante() === "ligne" && /Plus que 12/.test(await js(`${R}.nextElementSibling.textContent`)));
  await valider(`${R}.querySelector("input")`); await pause(200);
  vrai("tableau, 8 validé : jauge complète", await variante() === "complete");
  for (const q of [8, 24]) {
    await taper(`${R}.querySelector("input")`, q); await valider(`${R}.querySelector("input")`); await pause(200);
    const [prix, st] = await js(`(() => { const c = [...${R}.children].map(td => td.textContent); return [c[c.length - 3], c[c.length - 1]]; })()`);
    const num = (t) => parseFloat(String(t).replace(/[^\d,]/g, "").replace(",", "."));
    vrai(`tableau à ${q} : prix unitaire × quantité = sous-total`, Math.abs(num(prix) * q - num(st)) < 0.005, `${prix} × ${q} → ${st}`);
  }
  vrai("tableau à 24 (dernier palier) : une ligne « Prix palier appliqué … au lieu de »", await variante() === "ligne" && /au lieu de 0,83/.test(await js(`${R}.nextElementSibling.textContent`)));
  const R2 = rangee(/DAFALGAN 500MG GELU TB 16/);
  await taper(`${R2}.querySelector("input")`, 25); await pause(120);
  await js(`${R2}.querySelector(".ex-qte-plus").click()`); await pause(120);
  await js(`${R2}.querySelector(".ex-qte-moins").click()`); await pause(200);
  vrai("tableau : frappe 25, « + », « − » sans quitter le champ → la jauge revient à 0", /^Dès 20/.test(await js(`${R2}.nextElementSibling.querySelector(".ex-jauge__incitation").textContent`)),
    await js(`${R2}.nextElementSibling.textContent`));

  // 5. paliers multiples injectés : étiquettes sans chevauchement, détail dans la jauge
  injecter = true;
  for (const [l, h, mob] of [[1440, 900, false], [375, 812, true], [320, 700, true]]) {
    await ouvrir("?cip=dafalgan", l, h, mob);
    await attendre(`${D}?.querySelectorAll(".ex-jauge__etape").length >= 3`);
    let pire = -Infinity;
    for (const q of [0, 8, 20, 30, 60]) { await taper(`${D}.querySelector("input")`, q); await pause(150); pire = Math.max(pire, await chevauchement(".ex-saisie-ligne .ex-jauge")); }
    vrai(`4 paliers, Saisie ${l} px : aucune étiquette sur une autre`, pire <= 0, `${pire} px`);
  }
  await ouvrir("?menu=master", 1280, 900);
  await attendre(R);
  let pire = -Infinity;
  for (const q of [8, 20, 30]) { await taper(`${R}.querySelector("input")`, q); await valider(`${R}.querySelector("input")`); await pause(150); pire = Math.max(pire, await chevauchement("tr.ex-tr-palier .ex-jauge")); }
  vrai("4 paliers, tableau 1 280 px : aucune étiquette sur une autre", pire <= 0, `${pire} px`);
  await taper(`${R}.querySelector("input")`, 8); await valider(`${R}.querySelector("input")`); await pause(150);
  await ouvrirPanier();
  const LI = `[...document.querySelectorAll("aside[aria-label=Panier] li")].find(li => /DAFALGAN 1000MG CPR EFFV TB 8/.test(li.textContent))`;
  await attendre(`${LI}?.querySelector(".ex-jauge")`);
  vrai("4 paliers, tiroir du panier : aucune étiquette sur une autre", await chevauchement("aside[aria-label=Panier] .ex-jauge") <= 0);
  await js(`${LI}.querySelector(".ex-jauge__detail").click()`); await pause(200);
  vrai("tiroir du panier : tableau du détail dans la jauge", await tableHors(`${LI}.querySelector(".ex-jauge")`) <= 0.5, `${await tableHors(`${LI}.querySelector(".ex-jauge")`)} px`);
  for (const [l, h, mob] of [[1440, 900, false], [375, 812, true]]) {
    await ouvrir("?menu=otc", l, h, mob);
    const C = `[...document.querySelectorAll(".ex-carte")].find(c => /DIFFU-K/.test(c.textContent))`;
    await attendre(`${C}?.querySelector(".ex-jauge")`);
    let p = -Infinity;
    for (const q of [0, 8, 20, 40, 70]) { await taper(`${C}.querySelector("input")`, q); await pause(150); p = Math.max(p, await chevauchement(".ex-carte .ex-jauge")); }
    vrai(`4 paliers, carte ${l} px : aucune étiquette sur une autre`, p <= 0, `${p} px`);
    vrai(`carte ${l} px : jamais « Plus que » seul`, !/Plus que/.test(await js(`${C}.querySelector(".ex-jauge").textContent`)));
  }
  await ouvrir("?menu=master", 375, 812, true);
  const LM = `[...document.querySelectorAll(".ex-tr")].find(t => /DAFALGAN 1000MG CPR EFFV TB 8/.test(t.textContent))`;
  await attendre(LM);
  for (let i = 0; i < 8; i++) { await js(`${LM}.querySelector(".ex-qte-plus").click()`); await pause(30); }
  await pause(200);
  vrai("4 paliers, liste mobile : aucune étiquette sur une autre", await chevauchement(".ex-tr .ex-jauge") <= 0);
  await js(`${LM}.querySelector(".ex-jauge__detail").click()`); await pause(200);
  vrai("liste mobile : tableau du détail dans la jauge, pas de défilement", await tableHors(`${LM}.querySelector(".ex-jauge")`) <= 0.5 && await defile() <= 0);
} catch (e) { ko++; console.log("✗ ERREUR", e.message); }
finally { ws.close(); chrome.kill(); try { rmSync(profil, { recursive: true, force: true }); } catch { /* profil jetable */ } }
console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
