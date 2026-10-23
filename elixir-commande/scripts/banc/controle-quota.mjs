// ── Banc d'essai : contingentement dans la ligne de l'article (docs/contingentement-ligne.md), dans un vrai navigateur ──
// node scripts/banc/controle-quota.mjs [adresse du banc, défaut http://localhost:5173/]   (CAPTURES=<dossier> : captures PNG)
// Le banc doit tourner (npm run dev). Chrome sans tête piloté par le protocole DevTools (CHROME=<chemin> sinon l'application
// Google Chrome de macOS), profil jetable ; session de la pharmacie du banc (valeurs d'essai). Scénarios du contingentement
// basculés à chaud (/banc-quota?mode=…, scripts/banc/quota-banc.mjs) ; rien n'est envoyé ailleurs qu'au banc local.
// Règles FICTIVES du banc (quota-banc.mjs : produits non contingentés en réel) : CODOLIPRANE 500 « 12 par jour, déjà 4 »,
// CODOLIPRANE 400 « 2 par mois, déjà 2 », DOLIPRANE 500 effervescent « 12 par semaine » (palier dès 20), DAFALGAN 500 gélules
// « 100 par mois » (colis de 160), DOLIPRANELIQUIZ 1000 « 8 par semaine ».
//  1. aucun produit contingenté (liste vide) : ni pastille ni appel quota-status ; menu sans produit contingenté : liste lue
//     une fois, aucun appel quota-status (pas de lecture Odoo de plus) ;
//  2. tableau Master (1 440 px, forme moyenne : état court, détail dans la bulle) : une pastille par produit contingenté, un seul
//     quota-status pour la page ; CODOLIPRANE 400 « quota atteint » (nouveau quota dans la bulle), CODOLIPRANE 500 « reste 8 » ;
//     au-delà du reste : pastille rouge ET envoi refusé
//     par le panier (même règle), passage au rouge annoncé (role=status) ; paliers au-delà du reste retirés (DOLIPRANE 500 :
//     plus de « dès 20 » ni de « Passer à 20 » avec un reste de 12) ; Stratège : colis de 160 plus grand que le reste ;
//  3. Saisie (1 440 et 375 px) : reste, « 3 au panier : encore 5 possibles » après l'ajout, quantité saisie au-delà du reste en
//     rouge ; pastille sur sa propre rangée SOUS les boutons, le « + » ne bouge pas d'un clic à l'autre ; champ de quantité
//     décrit par la pastille (aria-describedby) ; détail ouvert au doigt (bouton, aria-expanded) ; cartes (version courte) et
//     liste mobile (rangée sous les boutons, « + » immobile) ; recherche globale ;
//  4. lecture Odoo lente (quota-status retardé de 3 s) : « vérification… » dès le premier rendu, rien ne saute à l'arrivée du
//     reste (tableau, Saisie 375 px) ;
//  5. quota atteint partout ; Odoo injoignable : « reste non vérifié », panier non bloqué ; pharmacie dispensée : rien ;
//  6. saisie Elixir pour une pharmacie : quota-status au nom de la pharmacie servie (odoo_id, jeton admin) ;
//  7. page d'accueil (règles fictives du banc) : pastille sur la vitrine, le cinéma et la grille, sans défilement à 375 px ;
//  8. commande envoyée : « mise à jour… » (jamais le reste d'avant), puis reste relu (commande du site comptée).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANC = (process.argv[2] || "http://localhost:5173/").replace(/\/?$/, "/");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/$/.test(BANC)) { console.error("Banc local seulement (http://localhost:<port>/)"); process.exit(2); }
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAPTURES = process.env.CAPTURES || "";
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });
const PORT = 9300 + Math.floor(Math.random() * 400);
const profil = mkdtempSync(join(tmpdir(), "controle-quota-"));
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
// appels du contingentement vus par le navigateur : { fn, methode, corps, auth }
let requetes = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent") {
    const { url, method, postData, headers } = m.params.request;
    const fn = (url.match(/\/\.netlify\/functions\/([\w-]+)/) || [])[1];
    if (fn) requetes.push({ fn, methode: method, corps: postData ? JSON.parse(postData) : null, auth: headers.Authorization || headers.authorization || "" });
  }
};
const cdp = (method, params = {}) => new Promise((r, x) => { const i = ++n; attente.set(i, m => (m.error ? x(new Error(`${method} : ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const attendre = async (expr, ms = 15000) => { for (let t = 0; t < ms / 50; t++) { try { if (await js(`!!(${expr})`)) return true; } catch { /* chargement */ } await pause(50); } throw new Error(`introuvable : ${expr}`); };
const scenario = async (mode, raz = false, retard = 0) => { const r = await (await fetch(`${BANC}banc-quota?mode=${mode}${raz ? "&raz=1" : ""}&retard=${retard}`)).json(); if (r.mode !== mode) throw new Error(`scénario ${mode} refusé`); };
const appelsDe = (fn) => requetes.filter(r => r.fn === fn);

async function ouvrir(chemin, l, h, { mobile = false, saisieElixir = null } = {}) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: l, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await cdp("Emulation.setTouchEmulationEnabled", mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp("Page.navigate", { url: BANC }); await pause(900);
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("session_email", "banc@pharmacie.test"); localStorage.setItem("session_name", "PHARMACIE DU BANC D'ESSAI");
    localStorage.setItem("session_cip", "9000001"); localStorage.setItem("pharmacy_token", "essai-jeton");
    localStorage.setItem("assistant_presentation_pbanc@pharmacie.test", JSON.stringify({ vues: 3, fini: true, derniere: Date.now() }));
    ${saisieElixir ? `localStorage.setItem("admin_token", "essai-jeton-admin"); sessionStorage.setItem("acting_for", ${JSON.stringify(JSON.stringify(saisieElixir))});` : ""} true`);
  await cdp("Network.clearBrowserCache");
  requetes = [];
  await cdp("Page.navigate", { url: BANC + chemin }); await pause(2200);
  await js(`(() => { const b = [...document.querySelectorAll("[role=dialog] button")].find(b => /Fermer|Plus tard|Continuer/.test(b.getAttribute("aria-label") || b.textContent)); b?.click(); return true; })()`);
  await pause(300);
}
const taper = (sel, v) => js(`(() => { const i = ${sel}; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; i.focus(); s.call(i, ${JSON.stringify(String(v))}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const valider = (sel) => js(`(() => { ${sel}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); ${sel}.blur(); return true; })()`);
const ligneSaisie = (cip) => `[...document.querySelectorAll(".ex-saisie-ligne")].find(l => [...l.querySelectorAll(".ex-saisie-info span")].some(s => s.textContent === ${JSON.stringify(cip)}))`;
const rangee = (re) => `[...document.querySelectorAll("tr.ex-tr")].find(t => ${re}.test(t.textContent))`;
const pastille = (dans) => `${dans}?.querySelector("[data-quota]")`;
// haut d'un élément dans la page (px)
const haut = (sel) => js(`(() => { const e = ${sel}; return e ? Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10 : null; })()`);
const bas = (sel) => js(`(() => { const e = ${sel}; return e ? Math.round((e.getBoundingClientRect().bottom + scrollY) * 10) / 10 : null; })()`);
const texte = (sel) => js(`(${sel})?.querySelector("button")?.textContent.replace(/[\\u00a0\\u202f]/g, " ").replace(/\\s+/g, " ").trim() ?? null`);
const ton = (sel) => js(`(${sel})?.dataset.quota ?? null`);
const defile = () => js(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const ouvrirPanier = async () => { await js(`[...document.querySelectorAll("button")].find(b => /panier/i.test(b.getAttribute("aria-label") || ""))?.click()`); await pause(900); };
const fermerPanier = async () => { await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); [...document.querySelectorAll("aside[aria-label=Panier] button")].find(b => /Fermer/i.test(b.getAttribute("aria-label") || ""))?.click(); true`); await pause(400); };
const PANIER = `document.querySelector("aside[aria-label=Panier]")`;
const boutonEnvoi = `[...(${PANIER}?.querySelectorAll("button") || [])].find(b => /Envoyer la commande|Commande envoyée|Envoi en cours/.test(b.textContent))`;
// capture d'une zone (élément, marge autour) ou de la fenêtre
async function capture(nom, sel = null, marge = 16) {
  if (!CAPTURES) return;
  let clip;
  if (sel) {
    await js(`(${sel})?.scrollIntoView({ block: "center" }); true`); await pause(350);
    const b = await js(`(() => { const r = (${sel}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, haut: r.top, hv: innerHeight }; })()`);
    const lv = await js(`document.documentElement.clientWidth`);
    const x = Math.max(0, b.x - marge), y = Math.max(0, b.y - marge);
    clip = { x, y, width: Math.min(lv - x, b.w + 2 * marge), height: b.h + 2 * marge, scale: 1 };
    // zone entière dans la fenêtre : capture de ce qui est affiché (au-delà de la fenêtre, Chrome agrandit la page et l'en-tête
    // collant se dessine par-dessus la zone)
    if (b.haut - marge >= 0 && b.haut + b.h + marge <= b.hv) clip.dans = true;
  } else await pause(300);
  const dans = clip?.dans; if (clip) delete clip.dans;
  const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: !dans } : {}) });
  writeFileSync(join(CAPTURES, `${nom}.png`), Buffer.from(data, "base64"));
}

const CODO500 = "3400927562396", CODO400 = "3400933220754";
const R5 = rangee(/CODOLIPRANE 500/), R4 = rangee(/CODOLIPRANE 400/), RD = rangee(/DOLIPRANE ADULTE 500MG EFF TUBE/);
const DATE = "\\S+ \\d{1,2} \\S+";   // « dim. 1 nov. » : format du panier
await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
try {
  // 1. aucun produit contingenté : rien, et aucune lecture du reste ; jauge des paliers de DOLIPRANE 500 (palier dès 20) présente
  await scenario("off", true);   // commandes d'un passage précédent oubliées
  await ouvrir("?menu=master", 1440, 900);
  await attendre(R4);
  vrai("liste vide : aucune pastille, aucun appel quota-status", await js(`document.querySelectorAll("[data-quota]").length`) === 0 && appelsDe("quota-status").length === 0,
    `${appelsDe("quota-status").length} appel(s)`);
  const jaugeSans = await js(`(() => { const r = ${RD}; return !!r && (r.nextElementSibling?.classList.contains("ex-tr-palier") || /dès 20/.test(r.textContent)); })()`);
  vrai("sans contingentement : DOLIPRANE 500 effervescent montre son palier dès 20 (référence du contrôle suivant)", jaugeSans);
  await scenario("normal");
  await ouvrir("?menu=expert", 1440, 900);   // Sélection Expert : aucun produit contingenté
  await attendre(`document.querySelector("tr.ex-tr")`); await pause(800);
  vrai("menu sans produit contingenté : liste lue une fois, aucun appel quota-status", appelsDe("quota-liste").length === 1 && appelsDe("quota-status").length === 0,
    `liste ${appelsDe("quota-liste").length}, quota-status ${appelsDe("quota-status").length}`);

  // 2. tableau Master
  await ouvrir("?menu=master", 1440, 900);
  await attendre(pastille(R4)); await attendre(`${pastille(R5)}?.dataset.quota === "info"`); await pause(400);
  vrai("tableau Master : un seul appel quota-status pour tous les produits contingentés de la page", appelsDe("quota-status").length === 1, `${appelsDe("quota-status").length}`);
  vrai("tableau Master : pastille sous la désignation (même cellule que le nom)", await js(`${pastille(R5)}.closest("td") === [...${R5}.children].find(td => /CODOLIPRANE/.test(td.firstChild?.textContent || td.textContent))`));
  const t4 = await texte(pastille(R4)), t5 = await texte(pastille(R5));
  const b4 = await js(`${pastille(R4)}.querySelector("button").title`);
  vrai("CODOLIPRANE 400 (2 par mois, déjà 2) : quota atteint, nouveau quota le 1er du mois suivant (bulle)", (await ton(pastille(R4))) === "warn" && t4 === "Contingenté : 2 par mois · quota atteint" && new RegExp(`Nouveau quota le ${DATE.replace("\\d{1,2}", "1")}`).test(b4), `${t4} | ${b4}`);
  vrai("CODOLIPRANE 500 (12 par jour, déjà 4) : reste 8", (await ton(pastille(R5))) === "info" && t5 === "Contingenté : 12 par jour · reste 8", t5);
  // paliers au-delà du reste : DOLIPRANE 500 effervescent (12 par semaine, palier dès 20) → ni jauge ni badge « dès 20 »
  const jaugeAvec = await js(`(() => { const r = ${RD}; return !!r && (r.nextElementSibling?.classList.contains("ex-tr-palier") || /dès 20|Passer à 20/.test(r.textContent)); })()`);
  vrai("DOLIPRANE 500 effervescent (reste 12) : plus de palier dès 20 proposé (jauge, badge, « Passer à 20 »)", !jaugeAvec && /reste 12/.test(await texte(pastille(RD)) || ""), await texte(pastille(RD)));
  await capture("menu-ligne-1440", R5, 48);                     // ligne CODOLIPRANE 500 et ses voisines
  await capture("menu-ligne-quota-atteint-1440", R4, 48);      // CODOLIPRANE 400 : quota atteint
  // au-delà du reste : pastille rouge, annoncée, et envoi refusé par le panier
  await taper(`${R5}.querySelector("input")`, 9); await valider(`${R5}.querySelector("input")`); await pause(400);
  const tTrop = await texte(pastille(R5));
  vrai("CODOLIPRANE 500, 9 au panier : pastille rouge « 1 de trop »", (await ton(pastille(R5))) === "danger" && tTrop === "Contingenté : 12 par jour · 1 de trop", tTrop);
  const annonce = await js(`[...document.querySelectorAll("[role=status]")].map(e => e.textContent).find(t => /de trop/.test(t)) || ""`);
  vrai("passage au rouge annoncé aux lecteurs d'écran (role=status)", /: 1 de trop, le panier refusera l'envoi\.$/.test(annonce), annonce);
  vrai("champ de quantité décrit par la pastille (aria-describedby)", await js(`(() => { const b = ${pastille(R5)}.querySelector("button"); return (${R5}.querySelector("input").getAttribute("aria-describedby") || "").split(" ").includes(b.id); })()`));
  await capture("quota-depasse-ligne", R5, 48);
  await ouvrirPanier();
  await attendre(boutonEnvoi);
  vrai("panier : même verdict (envoi refusé, « Contingentement dépassé »)", await js(`${boutonEnvoi}.disabled && /Contingentement dépassé/.test(${PANIER}.textContent)`));
  vrai("panier : période dite comme sur la ligne (« 12 par jour »)", await js(`/Contingenté : 12 par jour/.test(${PANIER}.textContent)`));
  await capture("quota-depasse-panier", PANIER, 0);
  await fermerPanier();
  await taper(`${R5}.querySelector("input")`, 8); await valider(`${R5}.querySelector("input")`); await pause(400);
  const tMax = await texte(pastille(R5));
  vrai("CODOLIPRANE 500, 8 au panier : « rien de plus »", (await ton(pastille(R5))) === "info" && tMax === "Contingenté : 12 par jour · rien de plus", tMax);
  await ouvrirPanier(); await attendre(boutonEnvoi);
  vrai("panier à 8 : envoi permis (même règle)", await js(`!${boutonEnvoi}.disabled`));
  await fermerPanier();
  // détail ouvert au doigt et au clavier (bouton, aria-expanded)
  await js(`${pastille(R5)}.querySelector("button").click()`); await pause(200);
  vrai("pastille : détail ouvert par le bouton (aria-expanded ; déjà commandé, reste, panier écrits)", await js(`${pastille(R5)}.querySelector("button").getAttribute("aria-expanded") === "true" && /Déjà commandé sur la période : 4 .*Reste : 8\\. Au panier : 8\\./.test(${pastille(R5)}.textContent)`));
  await capture("pastille-detail-1440", R5, 24);
  // Stratège : colis de 160, reste de 100 → aucun ajout possible, dit tel quel
  await ouvrir("?menu=stratege", 1440, 900);
  const RS = rangee(/DAFALGAN 500MG BTE 16 GELU/);
  await attendre(`${pastille(RS)}?.dataset.quota && ${pastille(RS)}.dataset.quota !== "neutral"`);
  const tS = await texte(pastille(RS));
  const bS = await js(`${pastille(RS)}.querySelector("button").title`);
  vrai("Stratège, colis de 160 et reste 100 : « reste 100 · par 160 » en avertissement (jamais un « reste 100 » en calme)", (await ton(pastille(RS))) === "warn" && tS === "Contingenté : 100 par mois · reste 100 · par 160" && /Se commande par 160\./.test(bS), `${tS} | ${bS}`);
  await capture("stratege-colis-1440", RS, 24);

  // 3. Saisie 1 440 et 375 px
  for (const [l, h, mobile] of [[1440, 900, false], [375, 812, true]]) {
    await ouvrir("?menu=saisie&cip=codoliprane", l, h, { mobile });
    const L = ligneSaisie(CODO500);
    await attendre(`${pastille(L)}?.dataset.quota === "info"`);
    vrai(`Saisie ${l} px : « reste 8 »`, await texte(pastille(L)) === "Contingenté : 12 par jour · reste 8", await texte(pastille(L)));
    vrai(`Saisie ${l} px : pastille sur sa rangée, sous les boutons`, (await haut(pastille(L))) >= (await bas(`${L}.querySelector(".ex-qte-plus")`)) - 0.5);
    await capture(`saisie-${l}`, L, 8);
    // « + » cliqué jusqu'au-delà du reste : il ne bouge pas (la pastille change de texte sous lui)
    const plus = `${L}.querySelector(".ex-qte-plus")`, positions = [];
    for (let k = 0; k < 9; k++) { positions.push(await haut(plus)); await js(`${plus}.click()`); await pause(120); }
    positions.push(await haut(plus));
    const ecart = Math.max(...positions) - Math.min(...positions);
    vrai(`Saisie ${l} px : « + » immobile de 0 à 9 (au-delà du reste, pastille rouge)`, ecart <= 0.5 && (await ton(pastille(L))) === "danger", `écart ${ecart} px : ${positions.join(", ")}`);
    await taper(`${L}.querySelector("input")`, 3); await pause(150);
    await js(`${L}.querySelector(".ex-saisie-ajouter").click()`); await pause(700);
    vrai(`Saisie ${l} px : après l'ajout de 3, « 3 au panier : encore 5 possibles »`, await texte(pastille(L)) === "Contingenté : 12 par jour · reste 8 · 3 au panier : encore 5 possibles", await texte(pastille(L)));
    await taper(`${L}.querySelector("input")`, 6); await pause(200);
    const t6 = await texte(pastille(L));
    vrai(`Saisie ${l} px : 6 saisis en plus → rouge « 3 au panier + 6 saisis : 1 de trop »`, (await ton(pastille(L))) === "danger" && t6 === "Contingenté : 12 par jour · reste 8 · 3 au panier + 6 saisis : 1 de trop", t6);
    const dedans = await js(`(() => { const p = ${pastille(L)}.getBoundingClientRect(), r = ${L}.getBoundingClientRect(); return p.left >= r.left && p.right <= r.right + 0.5; })()`);
    vrai(`Saisie ${l} px : pastille dans la ligne, aucun défilement horizontal`, dedans && await defile() <= 0, `${await defile()} px`);
    vrai(`Saisie ${l} px : champ de quantité décrit par la pastille`, await js(`(() => { const b = ${pastille(L)}.querySelector("button"); return (${L}.querySelector("input").getAttribute("aria-describedby") || "").split(" ").includes(b.id); })()`));
    if (mobile) await pause(3200);   // message « ajouté au panier » refermé (il couvre la ligne à 375 px)
    await capture(`saisie-${l}-depasse`, L, 8);
    await taper(`${L}.querySelector("input")`, 5); await pause(200);
    vrai(`Saisie ${l} px : 3 au panier + 5 saisis → « rien de plus possible »`, await texte(pastille(L)) === "Contingenté : 12 par jour · reste 8 · 3 au panier + 5 saisis : rien de plus possible", await texte(pastille(L)));
  }
  // cartes (OTC : DOLIPRANELIQUIZ 1000, version courte, sous les boutons) et liste mobile (Master)
  const CA = `[...document.querySelectorAll(".ex-carte")].find(c => /DOLIPRANELIQUIZ 1000/i.test(c.textContent))`;
  for (const [l, h, mobile] of [[1440, 900, false], [375, 812, true]]) {
    await ouvrir("?menu=otc", l, h, { mobile });
    try {
      await attendre(`${pastille(CA)}?.dataset.quota === "info"`, 8000);
      vrai(`carte OTC ${l} px : version courte « Quota 8/semaine · reste 8 », sous les boutons`, await texte(pastille(CA)) === "Quota 8/semaine · reste 8" && (await haut(pastille(CA))) >= (await bas(`${CA}.querySelector(".ex-qte-plus")`)) - 0.5, await texte(pastille(CA)));
      const dans = await js(`(() => { const p = ${pastille(CA)}.getBoundingClientRect(), c = ${CA}.getBoundingClientRect(); return p.left >= c.left && p.right <= c.right + 0.5; })()`);
      vrai(`carte OTC ${l} px : pastille dans la carte, aucun défilement`, dans && await defile() <= 0, `${await defile()} px`);
      if (mobile) {
        // « + » de la carte : de 1 à 9 (au-delà du reste), la hauteur de la pastille ne change pas
        const plus = `${CA}.querySelector(".ex-qte-plus")`;
        await js(`${plus}.click()`); await pause(150);
        const hp = [], pos = [];
        for (let k = 0; k < 8; k++) { hp.push(await js(`${pastille(CA)}.getBoundingClientRect().height`)); pos.push(await haut(plus)); await js(`${plus}.click()`); await pause(150); }
        vrai("carte OTC 375 px : de 1 à 9, pastille de hauteur constante et « + » immobile (au-delà du reste : « 1 de trop »)",
          Math.max(...hp) - Math.min(...hp) <= 0.5 && Math.max(...pos) - Math.min(...pos) <= 0.5 && /1 de trop$/.test(await texte(pastille(CA))), `hauteurs ${[...new Set(hp)].join("/")}, « + » ${[...new Set(pos)].join("/")} ; ${await texte(pastille(CA))}`);
        await capture("carte-otc-375", CA, 8);
      } else await capture("carte-otc-1440", CA, 8);
    } catch (e) { vrai(`carte OTC ${l} px affichée avec sa pastille`, false, e.message); }
  }
  await ouvrir("?menu=master", 375, 812, { mobile: true });
  const LM = `[...document.querySelectorAll(".ex-tr")].find(t => /CODOLIPRANE 500/.test(t.textContent))`;
  await attendre(`${pastille(LM)}?.dataset.quota === "info"`);
  vrai("liste mobile Master : pastille sous les boutons, aucun défilement", await texte(pastille(LM)) === "Contingenté : 12 par jour · reste 8" && (await haut(pastille(LM))) >= (await bas(`${LM}.querySelector(".ex-qte-plus")`)) - 0.5 && await defile() <= 0, await texte(pastille(LM)));
  {
    const plus = `${LM}.querySelector(".ex-qte-plus")`, pos = [];
    for (let k = 0; k < 10; k++) { pos.push(await haut(plus)); await js(`${plus}.click()`); await pause(120); }
    vrai("liste mobile Master : « + » immobile de 0 à 10 (pastille de « reste 8 » à « 2 de trop »)", Math.max(...pos) - Math.min(...pos) <= 0.5 && /2 de trop$/.test(await texte(pastille(LM))), `${[...new Set(pos)].join("/")} ; ${await texte(pastille(LM))}`);
    await capture("menu-liste-375-depasse", LM, 6);
    await js(`(() => { for (let k = 0; k < 10; k++) ${LM}.querySelector(".ex-qte-moins").click(); return true; })()`); await pause(300);
  }
  await capture("menu-liste-375", LM, 6);
  // recherche globale (« + Panier » ajoute directement) : pastille sous le statut
  await ouvrir("?menu=master", 1440, 900);
  await taper(`document.querySelector("input[aria-label='Rechercher un produit par CIP ou nom']")`, "codoliprane");
  const RG = `[...document.querySelectorAll(".ex-resultat")].find(r => /CODOLIPRANE 500/.test(r.textContent))`;
  try {
    await attendre(`${pastille(RG)}?.dataset.quota === "info"`, 8000);
    vrai("recherche globale : pastille sur le résultat (« + Panier » ajoute directement)", await texte(pastille(RG)) === "Contingenté : 12 par jour · reste 8", await texte(pastille(RG)));
    await capture("recherche-1440", RG, 8);
  } catch (e) { vrai("recherche globale : pastille sur le résultat", false, e.message); }

  // 4. lecture Odoo lente : place prise dès le premier rendu (« vérification… »), rien ne saute à l'arrivée du reste
  await scenario("normal", false, 3000);
  await ouvrir("?menu=master", 1440, 900);
  await attendre(`${pastille(R5)}?.dataset.quota === "neutral"`);
  const vAvant = await texte(pastille(R5)), hAvant = await js(`${R5}.getBoundingClientRect().height`), sAvant = await haut(`${R5}.nextElementSibling`);
  await attendre(`${pastille(R5)}?.dataset.quota === "info"`, 8000);
  const hApres = await js(`${R5}.getBoundingClientRect().height`), sApres = await haut(`${R5}.nextElementSibling`);
  vrai("lecture lente, tableau 1 440 px : « vérification… » puis « reste 8 », ligne de même hauteur, la suivante ne descend pas",
    vAvant === "Contingenté : 12 par jour · vérification…" && Math.abs(hApres - hAvant) <= 0.5 && Math.abs(sApres - sAvant) <= 0.5, `${vAvant} ; ${hAvant} → ${hApres} px ; suivante ${sAvant} → ${sApres}`);
  await ouvrir("?menu=saisie&cip=codoliprane", 375, 812, { mobile: true });
  const LL = ligneSaisie(CODO500);
  await attendre(`${pastille(LL)}?.dataset.quota === "neutral"`);
  const pAvant = await haut(`${LL}.querySelector(".ex-qte-plus")`);
  await capture("saisie-375-verification", LL, 8);
  await attendre(`${pastille(LL)}?.dataset.quota === "info"`, 8000);
  vrai("lecture lente, Saisie 375 px : le « + » ne bouge pas à l'arrivée du reste", Math.abs((await haut(`${LL}.querySelector(".ex-qte-plus")`)) - pAvant) <= 0.5);
  await scenario("normal", false, 0);

  // 5. quota atteint, Odoo injoignable, dispense
  await scenario("atteint");
  await ouvrir("?menu=master", 1440, 900);
  await attendre(`${pastille(R5)}?.dataset.quota === "warn"`);
  const tAtt = await texte(pastille(R5));
  const bAtt = await js(`${pastille(R5)}.querySelector("button").title`);
  vrai("quota atteint : « quota atteint », nouveau quota (demain) dans la bulle", tAtt === "Contingenté : 12 par jour · quota atteint" && new RegExp(`Nouveau quota le ${DATE}`).test(bAtt), `${tAtt} | ${bAtt}`);
  await capture("quota-atteint-tableau", R5, 48);
  await ouvrir("?menu=saisie&cip=codoliprane", 375, 812, { mobile: true });
  await attendre(`${pastille(ligneSaisie(CODO500))}?.dataset.quota === "warn"`);
  await taper(`${ligneSaisie(CODO500)}.querySelector("input")`, 1); await pause(200);
  vrai("quota atteint, Saisie 375 px : 1 saisi → « quota atteint · 1 saisi : 1 de trop · nouveau quota le … »", new RegExp(`^Contingenté : 12 par jour · quota atteint · 1 saisi : 1 de trop · nouveau quota le ${DATE}$`).test(await texte(pastille(ligneSaisie(CODO500)))), await texte(pastille(ligneSaisie(CODO500))));
  await capture("quota-atteint-saisie-375", ligneSaisie(CODO500), 8);

  await scenario("panne");
  await ouvrir("?menu=master", 1440, 900);
  await attendre(`/non.vérifié/.test(${pastille(R5)}?.textContent || "")`);
  vrai("Odoo injoignable : « reste non vérifié » (ton neutre)", (await ton(pastille(R5))) === "neutral" && await texte(pastille(R5)) === "Contingenté : 12 par jour · reste non vérifié", await texte(pastille(R5)));
  await taper(`${R5}.querySelector("input")`, 50); await valider(`${R5}.querySelector("input")`); await pause(300);
  await ouvrirPanier(); await attendre(boutonEnvoi);
  vrai("Odoo injoignable : panier non bloqué (comme avant), pastille toujours neutre", await js(`!${boutonEnvoi}.disabled && !/Contingentement dépassé/.test(${PANIER}.textContent)`) && (await ton(pastille(R5))) === "neutral");
  await fermerPanier();
  await capture("non-verifie", R5, 6);

  await scenario("dispense");
  await ouvrir("?menu=master", 1440, 900);
  await attendre(R5); await pause(1500);
  vrai("pharmacie dispensée : aucune pastille (reste lu une fois pour le savoir)", await js(`document.querySelectorAll("[data-quota]").length`) === 0 && appelsDe("quota-status").length === 1, `${appelsDe("quota-status").length}`);

  // 6. saisie Elixir pour une pharmacie
  await scenario("normal");
  await ouvrir("?menu=master", 1440, 900, { saisieElixir: { odoo_id: 4242, name: "PHARMACIE SERVIE DU BANC", cip: "9000042", email: "", city: "Banc" } });
  await attendre(`${pastille(R5)}?.dataset.quota === "info"`);
  const q = appelsDe("quota-status");
  vrai("saisie Elixir : quota-status au nom de la pharmacie servie (odoo_id, jeton admin)", q.length === 1 && q[0].corps?.odoo_id === 4242 && q[0].corps?.cip === "9000042" && q[0].auth === "Bearer essai-jeton-admin",
    JSON.stringify(q.map(x => ({ ...x.corps, auth: x.auth }))));
  vrai("saisie Elixir : quota-liste avec le jeton admin", appelsDe("quota-liste")[0]?.auth === "Bearer essai-jeton-admin");

  // 7. page d'accueil (règles fictives du banc sur MOUNJARO, VENTOLINE, SPASFON)
  await scenario("accueil");
  for (const [l, h, mobile] of [[1440, 900, false], [375, 812, true]]) {
    await ouvrir("?menu=accueil", l, h, { mobile });
    await attendre(`document.querySelectorAll("[data-quota]:not([data-quota=neutral])").length >= 2`, 12000).catch(() => {});
    const vues = await js(`[...document.querySelectorAll("[data-quota]")].filter(e => getComputedStyle(e).visibility !== "hidden" && e.offsetParent).map(e => e.querySelector("button").textContent.replace(/\\s+/g, " "))`);
    vrai(`accueil ${l} px : pastilles visibles (vitrine, cinéma, grille)`, vues.length >= 2, JSON.stringify(vues));
    // VENTOLINE (240 par mois, déjà 200, carton de 120) : toute pastille visible le dit (jamais un « reste 40 » en calme)
    const ventoline = await js(`[...document.querySelectorAll("[data-quota]")].filter(e => getComputedStyle(e).visibility !== "hidden" && e.offsetParent && /240( par |\\/)mois/.test(e.textContent)).map(e => [e.dataset.quota, e.querySelector("button").textContent.replace(/\\s+/g, " ")])`);
    vrai(`accueil ${l} px : VENTOLINE (carton de 120, reste 40) : avertissement « par 120 », jamais un « reste 40 » en calme`,
      ventoline.every(([t, v]) => t === "warn" && /par\u00a0120|par 120/.test(v)), JSON.stringify(ventoline));
    vrai(`accueil ${l} px : aucun défilement horizontal`, await defile() <= 0, `${await defile()} px`);
    if (l === 1440) {
      await capture("accueil-vitrine-1440", `[...document.querySelectorAll("[data-quota]")].find(e => e.closest(".acc-faits"))?.closest("section, article, div[class*=acc]")`, 8).catch(() => {});
      await capture("accueil-grille-1440", `[...document.querySelectorAll("[data-quota]")].find(e => e.closest("article"))?.closest("article")`, 8).catch(() => {});
      await capture("accueil-cinema-1440", `document.querySelector(".mea-cinema")`, 0).catch(() => {});
    } else await capture("accueil-grille-375", `[...document.querySelectorAll("[data-quota]")].find(e => e.closest("article"))?.closest("article")`, 8).catch(() => {});
  }

  // 8. commande envoyée : « mise à jour… », puis reste relu
  await scenario("normal");
  await ouvrir("?menu=master", 1440, 900);
  await attendre(`${pastille(R5)}?.dataset.quota === "info"`);
  await taper(`${R5}.querySelector("input")`, 3); await valider(`${R5}.querySelector("input")`); await pause(300);
  await ouvrirPanier(); await attendre(boutonEnvoi);
  const avant = appelsDe("quota-status").length;
  await js(`${boutonEnvoi}.click()`);
  const envoyee = await attendre(`/Commande envoyée/.test(${PANIER}?.textContent || document.body.textContent)`, 20000).then(() => true, () => false);
  vrai("commande envoyée sur le banc (rien ne part ailleurs)", envoyee, await js(`(${PANIER}?.textContent || "").slice(0, 200)`));
  const tEnvoi = await texte(pastille(R5));
  vrai("« Commande envoyée » : reste d'avant l'envoi remplacé par « mise à jour… » (la place reste prise)", tEnvoi === "Contingenté : 12 par jour · mise à jour…", tEnvoi);
  await pause(4500);   // panier vidé 3 s après « Commande envoyée », puis relecture
  vrai("panier vidé : quota-status relu", appelsDe("quota-status").length >= avant + 2, `${avant} → ${appelsDe("quota-status").length}`);
  await attendre(`${pastille(R5)}?.dataset.quota === "info"`);
  vrai("après l'envoi : la commande du site est comptée (« reste 5 »)", await texte(pastille(R5)) === "Contingenté : 12 par jour · reste 5", await texte(pastille(R5)));
} catch (e) { ko++; console.log("✗ ERREUR", e.message); }
finally { try { await scenario("normal"); } catch { /* banc arrêté */ } ws.close(); chrome.kill(); try { rmSync(profil, { recursive: true, force: true }); } catch { /* profil jetable */ } }
console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
