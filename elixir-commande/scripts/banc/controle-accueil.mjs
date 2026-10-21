// ── Banc d'essai : contrôles de mise en page de la page d'accueil (mises en avant), dans un vrai navigateur ──
// node scripts/banc/controle-accueil.mjs [adresse du banc, défaut http://localhost:5173/]
// Le banc doit tourner (npm run dev, données figées : dev-fixtures/accueil-offres.json avec des mises en avant). Chrome sans
// tête piloté par le protocole DevTools (CHROME=<chemin> sinon l'application Google Chrome de macOS), profil jetable ;
// session de la pharmacie du banc (valeurs d'essai). Rien n'est envoyé ailleurs qu'au banc local.
//  1. bouton d'ajout des tuiles de la grille, après l'ajout (« − n au panier + ») : texte jamais rogné à 375, 1024, 1280 px ;
//  2. aucune animation infinie au repos : 10 s après un clic sur « Ajouter » d'une tuile, souris hors de la page ;
//  3. entrée en cascade (375 × 812, grille sous la ligne de flottaison) : une tuile n'est jamais vue, puis effacée ;
//  4. aucun défilement horizontal de la page à 375 px.
// Mises en avant d'outils (docs/accueil.md § 7.8 ; banc : fixture-accueil.mjs --outils) :
//  5. une tuile outil est un seul bouton dont le nom contient le texte de son bouton ;
//  6. le bouton d'un outil dans la vitrine n'est pas rogné à 375, 1024 et 1280 px ;
//  7. aucune animation infinie 10 s après l'arrivée sur une Saisie (curseur du champ arrêté) ;
//  8. en mouvement réduit, les lettres du champ de la Saisie sont visibles d'emblée ;
//  9. un clic sur la Péremption (vitrine) ou sur une tuile outil mène à ?menu=<outil>, en haut de page.
// Variantes (réponse du GET réécrite dans le navigateur, outils_etat du banc ; aucun produit dans la grille, donc des
// rangées basses) :
// 10. grille de 2 à 5 outils à 1 024, 1 280 et 1 440 px : chaque carte d'un outil reste dans sa tuile (2 px près), le
//     haut de la plaque sous le haut de la tuile, aucune carte sur le texte ; pied de tuile sur une ligne (375 px aussi) ;
// 11. vitrine de 4 outils à 768, 820, 1 024, 1 080 et 1 280 px : chiffres et légendes des cartes dans l'écran, jamais
//     sous la plaque ; bouton d'un outil sur une ligne (texte court si le long ne tient pas).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANC = (process.argv[2] || "http://localhost:5173/").replace(/\/?$/, "/");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/$/.test(BANC)) { console.error("Banc local seulement (http://localhost:<port>/)"); process.exit(2); }
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 400);
const profil = mkdtempSync(join(tmpdir(), "controle-accueil-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--lang=fr-FR", "about:blank"], { stdio: "ignore" });
const pause = (ms) => new Promise(r => setTimeout(r, ms));
let ok = 0, ko = 0;
const vrai = (label, v, detail = "") => { if (v) { ok++; if (process.env.DETAIL) console.log("✓", label); } else { ko++; console.log("✗", label, detail); } };

let page = null;
for (let i = 0; i < 50 && !page; i++) { await pause(200); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === "page"); } catch { /* démarrage */ } }
if (!page) { console.error("Chrome injoignable"); chrome.kill(); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let n = 0; const attente = new Map();
// variante : réponse du GET accueil-offres servie à la place de celle du banc (null : celle du banc)
let variante = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); return; }
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params;
    if (variante && !request.url.includes("verifier=")) cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(variante)).toString("base64") }).catch(() => {});
    else cdp("Fetch.continueRequest", { requestId }).catch(() => {});
  }
};
const cdp = (method, params = {}) => new Promise((r, x) => { const i = ++n; attente.set(i, m => (m.error ? x(new Error(`${method} : ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const attendre = async (sel) => { for (let t = 0; t < 300; t++) { if (await js(`!!document.querySelector(${JSON.stringify(sel)})`)) return; await pause(50); } throw new Error(`introuvable : ${sel}`); };
const souris = (type, x, y) => cdp("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "mouse" });

async function ouvrir(l, h, mobile = false, reduit = false) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: l, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await cdp("Emulation.setTouchEmulationEnabled", mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduit ? "reduce" : "no-preference" }] });
  await cdp("Page.navigate", { url: BANC }); await pause(900);
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem("session_email", "banc@pharmacie.test"); localStorage.setItem("session_name", "PHARMACIE DU BANC D'ESSAI");
    localStorage.setItem("session_cip", "9000001"); localStorage.setItem("pharmacy_token", "essai-jeton"); true`);
  await cdp("Page.navigate", { url: `${BANC}?menu=accueil` });
  await attendre(".mea-cinema, .mea-grille-section");
  await pause(2500);
}

await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/.netlify/functions/accueil-offres*", requestStage: "Request" }] });
// variantes : mises en avant d'outils fabriquées depuis outils_etat du banc (chiffres de la règle du serveur)
const base = await fetch(`${BANC}.netlify/functions/accueil-offres`, { headers: { Authorization: "Bearer essai-jeton" } }).then(r => r.json()).catch(() => null);
const BADGES = { saisie: "Tout le catalogue", peremption: "Petits prix", fauteuil: "Aide au choix", transfert: "Aide au choix", justificatif: "Suivi pas à pas", groupees: "Conditions négociées" };
let nv = 0;
const outilVar = (cle, emplacement) => ({ id: `mea_ctrl_${cle}_${++nv}`, type: "outil", outil: cle, emplacement, titre: "", accroche: "", badge: BADGES[cle], fin: null, fin_offre: null,
  image: null, couleur: null, couleur_auto: null, chiffres: base.outils_etat[cle]?.chiffres ?? null });
const avec = (items) => ({ ...base, vedettes: { ...base.vedettes, repli: false, items } });
try {
  // 1. bouton d'ajout jamais rogné, après l'ajout
  for (const [l, h, m] of [[375, 812, true], [1024, 768, false], [1280, 800, false]]) {
    await ouvrir(l, h, m);
    await js(`document.querySelector(".mea-grille-section").scrollIntoView(); [...document.querySelectorAll(".mea-tuile .acc-lot-centre")].forEach(b => b.click()); true`);
    await pause(900);
    const boutons = await js(`[...document.querySelectorAll(".mea-tuile .acc-lot[data-plein] .acc-lot-centre")].map(b => { const s = b.querySelector("span"); return { texte: b.textContent, sw: s.scrollWidth, cw: s.clientWidth, bw: b.scrollWidth, bc: b.clientWidth }; })`);
    vrai(`${l} px : au moins une tuile produit ajoutée`, boutons.length > 0);
    for (const b of boutons) vrai(`${l} px : « ${b.texte} » entier`, b.sw <= b.cw + 0.5 && b.bw <= b.bc + 0.5, JSON.stringify(b));
    if (m) vrai(`${l} px : pas de défilement horizontal`, await js("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
  }
  // 2. aucune animation infinie au repos
  await ouvrir(1440, 900);
  await js("window.scrollTo(0, 560); true"); await pause(900);
  const p = await js(`(() => { const b = document.querySelector(".mea-tuile .acc-lot-centre").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await souris("mouseMoved", p.x, p.y); await souris("mousePressed", p.x, p.y); await souris("mouseReleased", p.x, p.y);
  await souris("mouseMoved", 1, 1);
  await pause(10000);
  const infinies = await js(`document.getAnimations().filter(a => a.playState === "running" && a.effect?.getComputedTiming?.().iterations === Infinity).map(a => a.animationName || "web")`);
  vrai("10 s après un ajout, souris hors de la page : aucune animation infinie", infinies.length === 0, infinies.join(", "));
  // 3. cascade : jamais vue puis effacée
  await ouvrir(375, 812, true);
  const vues = new Set(), rechutes = [];
  for (let y = 0; y <= 1100; y += 50) {
    await js(`window.scrollTo(0, ${y}); true`); await pause(45);
    const op = await js(`[...document.querySelectorAll(".mea-tuile")].map(t => Number(getComputedStyle(t).opacity))`);
    op.forEach((o, i) => { if (o >= 0.99) vues.add(i); else if (vues.has(i) && o < 0.5) rechutes.push(`tuile ${i + 1} à ${y} px`); });
  }
  vrai("cascade : aucune tuile vue puis effacée", rechutes.length === 0, rechutes.join(", "));
  // 5-9. mises en avant d'outils (seulement si le banc en montre)
  await ouvrir(1280, 800);
  const nbOutils = await js(`document.querySelectorAll(".mea-tuile--outil").length + document.querySelectorAll(".mea-actions--outil").length`);
  if (!nbOutils) console.log("  · aucune mise en avant d'outil sur le banc (fixture-accueil.mjs --outils) : contrôles 5 à 9 sautés");
  else {
    const tuiles = await js(`[...document.querySelectorAll(".mea-tuile--outil")].map(t => ({ bouton: t.tagName === "BUTTON", imbriques: t.querySelectorAll("button, a, input").length,
      nom: t.getAttribute("aria-label") || "", pied: t.querySelector(".mea-tuile-pied")?.textContent || "" }))`);
    vrai("au moins une tuile outil dans la grille", tuiles.length > 0);
    for (const t of tuiles) vrai(`tuile outil « ${t.pied} » : un seul bouton, nom avec le texte du bouton`, t.bouton && t.imbriques === 0 && !!t.pied && t.nom.includes(t.pied.trim()), JSON.stringify(t));
    for (const [l, h, m] of [[375, 812, true], [1024, 768, false], [1280, 800, false]]) {
      await ouvrir(l, h, m);
      // onglet de la vitrine par le titre de la Péremption (« Lots à date courte, en stock » depuis le lot 0 du 20/10/2026)
      const i = await js(`[...document.querySelectorAll(".mea-barre")].findIndex(b => /Péremption|Lots à date courte/.test(b.textContent))`);
      if (i > 0) { await js(`document.querySelectorAll(".mea-barre")[${i}].click(); true`); await pause(1200); }
      const b = await js(`(() => { const c = document.querySelector(".mea-diapo .mea-actions--outil .mea-cta"); if (!c) return null; const r = c.getBoundingClientRect(), s = document.querySelector(".mea-cinema").getBoundingClientRect();
        return { texte: c.innerText, sw: c.scrollWidth, cw: c.clientWidth, dedans: r.left >= s.left - 0.5 && r.right <= s.right + 0.5 }; })()`);
      vrai(`${l} px : bouton de l'outil dans la vitrine entier${b ? ` (« ${b.texte} »)` : ""}`, b && b.sw <= b.cw + 0.5 && b.dedans, JSON.stringify(b));
      if (m) vrai(`${l} px (outils) : pas de défilement horizontal`, await js("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
    }
    // Saisie : champ qui s'écrit, curseur arrêté (aucune animation infinie 10 s après l'arrivée)
    await ouvrir(1440, 900);
    const saisie = await js(`(() => { const p = document.querySelector(".mea-plaque-champ"); if (!p) return false; p.scrollIntoView({ block: "center" }); return true; })()`);
    vrai("une Saisie (champ de recherche) sur le banc", saisie);
    await souris("mouseMoved", 1, 1); await pause(10000);
    const restantes = await js(`document.getAnimations().filter(a => a.playState === "running" && (a.effect?.getComputedTiming?.().iterations === Infinity || a.effect?.target?.closest?.(".mea-plaque-champ"))).map(a => a.animationName || a.effect?.target?.className || "web")`);
    vrai("Saisie : 10 s après l'arrivée, aucune animation infinie, curseur arrêté", restantes.length === 0, restantes.join(", "));
    await ouvrir(1440, 900, false, true);
    await js(`document.querySelector(".mea-plaque-champ")?.scrollIntoView({ block: "center" }); true`); await pause(100);
    const lettres = await js(`[...document.querySelectorAll(".mea-plaque-lettre")].map(l => Number(getComputedStyle(l).opacity))`);
    vrai("mouvement réduit : lettres du champ visibles d'emblée", lettres.length > 0 && lettres.every(o => o >= 0.99), lettres.join(","));
    // clic sur la Péremption (bouton de la vitrine) puis sur une tuile outil : rubrique ouverte, en haut de page
    await ouvrir(1440, 900);
    const ip = await js(`[...document.querySelectorAll(".mea-barre")].findIndex(b => /Péremption|Lots à date courte/.test(b.textContent))`);
    if (ip >= 0) {
      if (ip > 0) { await js(`document.querySelectorAll(".mea-barre")[${ip}].click(); true`); await pause(1200); }
      await js("window.scrollTo(0, 120); true"); await pause(200);
      await js(`document.querySelector(".mea-diapo .mea-actions--outil .mea-cta").click(); true`); await pause(1200);
      const r = await js(`({ menu: new URLSearchParams(location.search).get("menu"), y: scrollY })`);
      vrai("clic sur la Péremption (vitrine) : ?menu=peremption, haut de page", r.menu === "peremption" && r.y === 0, JSON.stringify(r));
    }
    await ouvrir(1440, 900);
    const cle = await js(`(() => { const t = document.querySelector(".mea-tuile--outil"); t.scrollIntoView({ block: "center" }); return t.getAttribute("aria-label"); })()`);
    await pause(1200);
    await js(`document.querySelector(".mea-tuile--outil").click(); true`); await pause(1200);
    const r2 = await js(`({ menu: new URLSearchParams(location.search).get("menu"), y: scrollY })`);
    vrai(`clic sur la tuile outil « ${String(cle).split(",")[0]} » : rubrique ouverte, haut de page`, r2.menu && r2.menu !== "accueil" && r2.y === 0, JSON.stringify(r2));
  }
  // 10-11. variantes (seulement si le banc a des outils : outils_etat)
  if (!base?.outils_etat) console.log("  · banc sans outils_etat (fixture-accueil.mjs --outils) : variantes 10 et 11 sautées");
  else {
    const ORDRE = ["peremption", "saisie", "fauteuil", "groupees", "justificatif", "transfert"];
    const grille = `(() => { const out = [];
      document.querySelectorAll(".mea-tuile--outil").forEach(t => { const tr = t.getBoundingClientRect(), v = t.className.match(/--(grande|bandeau|petite|large)/)[1];
        const textes = [...t.querySelector(".mea-tuile-corps").children].flatMap(e => [...e.getClientRects()]);
        t.querySelectorAll(".mea-eventail .mea-carte").forEach((c, i) => { const r = c.getBoundingClientRect();
          if (r.left < tr.left - 2 || r.right > tr.right + 2 || r.top < tr.top - 2 || r.bottom > tr.bottom + 2) out.push(v + " : carte " + i + " hors de la tuile");
          if (c.classList.contains("mea-carte--plaque") && r.top <= tr.top) out.push(v + " : haut de la plaque rogné");
          if (textes.some(x => x.width && x.height && !(r.right <= x.left + 1 || r.left >= x.right - 1 || r.bottom <= x.top + 1 || r.top >= x.bottom - 1))) out.push(v + " : carte " + i + " sur le texte"); });
        const pied = t.querySelector(".mea-tuile-pied"), txt = pied && [...pied.childNodes].find(x => x.nodeType === 3);
        if (txt) { const rg = document.createRange(); rg.selectNodeContents(txt); if (new Set([...rg.getClientRects()].map(x => Math.round(x.top))).size > 1) out.push(v + " : pied « " + txt.textContent + " » sur plusieurs lignes"); } });
      return { n: document.querySelectorAll(".mea-tuile--outil").length, out }; })()`;
    for (const nb of [2, 3, 4, 5]) {
      variante = avec(ORDRE.slice(0, nb).map(k => outilVar(k, "grille")));
      for (const [l, h, m] of [[1024, 768], [1280, 800], [1440, 900], ...(nb === 3 ? [[375, 812, true]] : [])]) {
        await ouvrir(l, h, !!m);
        await js(`document.querySelector(".mea-grille-section").scrollIntoView(); true`); await pause(700);
        const r = await js(grille);
        vrai(`grille de ${nb} outils sans produit, ${l} px : cartes dans leur tuile, hors du texte, pieds sur une ligne`, r.n === nb && !r.out.length, `${r.n} tuile(s) ; ${r.out.join(" ; ")}`);
      }
    }
    const vitrine = `(() => { const e = document.querySelector(".mea-cinema .mea-ecran").getBoundingClientRect(), v = document.querySelector(".mea-cinema .mea-visuel:not(.mea-sortant)");
      const p = v.querySelector(".mea-carte--plaque")?.getBoundingClientRect(), out = [];
      v.querySelectorAll(".mea-carte-chiffre, .mea-carte-legende").forEach(el => { const rg = document.createRange(); rg.selectNodeContents(el); const t = rg.getBoundingClientRect();
        if (t.left < e.left - 1 || t.right > e.right + 1 || t.top < e.top - 1 || t.bottom > e.bottom + 1) out.push("« " + el.textContent + " » hors de l'écran");
        if (p && !(t.right <= p.left + 1 || t.left >= p.right - 1 || t.bottom <= p.top + 1 || t.top >= p.bottom - 1)) out.push("« " + el.textContent + " » sous la plaque"); });
      const c = document.querySelector(".mea-cinema .mea-diapo .mea-cta"), sp = c && [...c.querySelectorAll("span")].find(x => getComputedStyle(x).display !== "none");
      if (sp) { const rg = document.createRange(); rg.selectNodeContents(sp); if (new Set([...rg.getClientRects()].map(x => Math.round(x.top))).size > 1 || c.scrollWidth > c.clientWidth + 1) out.push("bouton « " + sp.textContent + " » sur plusieurs lignes ou rogné"); }
      return { titre: document.querySelector(".mea-cinema .mea-diapo h2 .acc-vh")?.textContent || "", out }; })()`;
    variante = avec(["saisie", "peremption", "justificatif", "groupees"].map(k => outilVar(k, "vitrine")));
    for (const [l, h] of [[768, 1024], [820, 1180], [1024, 768], [1080, 800], [1280, 800]]) {
      await ouvrir(l, h);
      const nbBarres = await js(`document.querySelectorAll(".mea-barre").length`);
      for (let i = 0; i < nbBarres; i++) {
        if (i > 0) { await js(`document.querySelectorAll(".mea-barre")[${i}].click(); true`); await pause(1300); }
        const r = await js(vitrine);
        vrai(`vitrine ${l} px, « ${r.titre} » : cartes dans l'écran, hors de la plaque, bouton sur une ligne`, !r.out.length, r.out.join(" ; "));
      }
    }
    variante = null;
  }
} catch (e) { ko++; console.log("✗", e.message); }
finally {
  ws.close();
  await new Promise(r => { chrome.once("exit", r); chrome.kill(); setTimeout(r, 3000); });
  try { rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* profil jetable : laissé dans le dossier temporaire */ }
}
console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
