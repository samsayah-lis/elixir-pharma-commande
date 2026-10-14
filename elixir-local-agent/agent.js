// ── Agent PharmaML v3 (Mac du bureau) : relais site de commande → PharmaML ──
// PharmaML (InfoSoft) n'accepte les envois de commandes que depuis l'adresse du bureau : le site met chaque
// envoi en file, cet agent interroge le site (requêtes signées), envoie à PharmaML depuis le bureau, puis
// rend la réponse BRUTE (le site la classe : envoyée / refusée / à vérifier).
// Garde-fous anti-doublon :
//   - une tâche n'est envoyée qu'après sa réservation par le site (jeton) ;
//   - journal local (relais-journal.jsonl) écrit AVANT chaque envoi : une référence déjà tentée n'est jamais
//     renvoyée (sauf refus certain 4xx, ou reprise confirmée par un humain côté site) ;
//   - comptes rendus réessayés jusqu'à accusé de réception, même après un redémarrage (relais-a-rendre.jsonl).
// Le port 3001 (ancienne synchro directe depuis la page admin) ne fait plus aucun envoi.
// Clé de signature : relais-cle.pem (privée, jamais copiée) ; relais-cle.pub est déclarée dans le site
// (netlify/functions/_relais.js, AGENTS).
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = 3;
const DIR = process.env.AGENT_DIR || dirname(fileURLToPath(import.meta.url));
// ── .env ──
try {
  for (const line of fs.readFileSync(resolve(DIR, ".env"), "utf8").split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k && k.trim() && !k.trim().startsWith("#") && process.env[k.trim()] === undefined) process.env[k.trim()] = rest.join("=").trim();
  }
} catch { /* pas de .env : variables d'environnement */ }
const PHARMAML_URL = (process.env.PHARMAML_URL || "https://pharmaml.elixirpharma.fr").replace(/\/$/, "");
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "";
const SITE_URL = (process.env.SITE_URL || "https://elixir-commande.expepharma.com").replace(/\/$/, "");
const PORT = parseInt(process.env.PORT || "3001");
const AGENT_ID = process.env.AGENT_ID || "mac-bureau";
const INSTANCE = crypto.randomBytes(4).toString("hex");
const JOURNAL = resolve(DIR, "relais-journal.jsonl");
const A_RENDRE = resolve(DIR, "relais-a-rendre.jsonl");
const CLE = resolve(DIR, "relais-cle.pem");

const ts = () => new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
const log = (...a) => console.log(`[${ts()}]`, ...a);
if (!PHARMAML_PASS) { log("✗ PHARMAML_PASS absent du fichier .env : l'agent ne peut pas envoyer. Arrêt."); process.exit(1); }

// ── clé de signature (créée au premier lancement ; la clé publique est à déclarer dans le site) ──
if (!fs.existsSync(CLE)) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(CLE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  fs.writeFileSync(resolve(DIR, "relais-cle.pub"), pub + "\n");
  log(`Nouvelle clé de signature. Clé publique à déclarer dans _relais.js (AGENTS) : ${pub}`);
}
const clePrivee = crypto.createPrivateKey(fs.readFileSync(CLE));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const empreinte = (v) => sha256(JSON.stringify(v));
const masque = (t) => String(t || "").split(PHARMAML_PASS).join("***").split(encodeURIComponent(PHARMAML_PASS)).join("***");

// ── journal local : références déjà tentées ──
const tentatives = new Map();   // ref → { avantA, http, apresA }
function lireJournal() {
  try {
    for (const l of fs.readFileSync(JOURNAL, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const e = JSON.parse(l);
        const cur = tentatives.get(e.ref) || {};
        if (e.t === "avant") tentatives.set(e.ref, { avantA: e.at, http: null, apresA: null, forcer: !!e.forcer });
        else if (e.t === "apres") tentatives.set(e.ref, { ...cur, http: e.http ?? null, apresA: e.at });
      } catch { /* ligne abîmée : ignorée (la tentative reste « avant » donc bloquante) */ }
    }
  } catch { /* pas encore de journal */ }
}
function ecrireJournal(e) {
  const fd = fs.openSync(JOURNAL, "a");
  try { fs.writeSync(fd, JSON.stringify({ ...e, at: new Date().toISOString() }) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
lireJournal();

// ── comptes rendus en attente (réessayés jusqu'à accusé de réception) ──
let aRendre = [];
try { aRendre = fs.readFileSync(A_RENDRE, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { aRendre = []; }
// écriture atomique (fichier temporaire puis renommage) : un arrêt pendant l'écriture ne perd rien
const sauverARendre = () => { const tmp = `${A_RENDRE}.tmp`; fs.writeFileSync(tmp, aRendre.map(r => JSON.stringify(r)).join("\n") + (aRendre.length ? "\n" : "")); fs.renameSync(tmp, A_RENDRE); };

// ── appels signés au site ──
async function appel(corps) {
  const brut = JSON.stringify(corps);
  const t = Date.now();
  const sig = crypto.sign(null, Buffer.from(`${t}\nPOST /relais\n${sha256(brut)}`), clePrivee).toString("base64");
  const r = await fetch(`${SITE_URL}/.netlify/functions/pml-relais`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-relais-agent": AGENT_ID, "x-relais-ts": String(t), "x-relais-sig": sig },
    body: brut, signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function rendre(cr) {
  try {
    const { status, j } = await appel({ action: "rendre", ...cr });
    if (status === 200 || status === 404 || status === 409) return true;   // reçu (ou tâche inconnue / jeton périmé : rien à réessayer)
    log(`  compte rendu ${cr.ref} non reçu (HTTP ${status} ${j.error || ""}) : nouvel essai`);
  } catch (e) { log(`  compte rendu ${cr.ref} non reçu (${e.message}) : nouvel essai`); }
  return false;
}
async function viderARendre() {
  if (!aRendre.length) return;
  const reste = [];
  for (const cr of aRendre) if (!await rendre(cr)) reste.push(cr);
  aRendre = reste; sauverARendre();
}

// ── corps PharmaML attendu ──
function valider(t) {
  if (!Array.isArray(t.corps)) return "corps illisible";
  if (t.source === "test") return t.corps.length === 0 ? null : "essai non vide";
  if (t.corps.length !== 1) return "une seule commande par tâche";
  const c = t.corps[0];
  if (c.referenceCommande !== t.ref) return "référence du corps différente de la tâche";
  if (!/^\d{7}$/.test(String(c.identifiantPML || ""))) return "CIP de pharmacie invalide";
  if (!Array.isArray(c.lignes) || !c.lignes.length || c.lignes.length > 300) return "lignes invalides";
  for (const l of c.lignes) {
    if (typeof l.CIP !== "string" || l.CIP.length > 20) return "CIP de ligne invalide";
    if (!Number.isInteger(l.quantiteCommandee) || l.quantiteCommandee < 0 || l.quantiteCommandee > 9999) return "quantité invalide";
    if (typeof l.prix !== "number" || !Number.isFinite(l.prix) || l.prix < 0) return "prix invalide";
  }
  if (empreinte(t.corps) !== t.empreinte) return "empreinte différente";
  return null;
}

async function traiter(t, recuA = Date.now()) {
  const base = { ref: t.ref, jeton: t.jeton, empreinte: empreinte(t.corps) };
  // tâche reçue il y a plus d'une minute (Mac sorti de veille, processus suspendu) : jamais envoyée en retard,
  // le site a pu la déclarer « à vérifier » entre-temps (horloge murale : elle avance pendant la veille)
  if (Date.now() - recuA > 60e3) { log(`✗ ${t.ref} reçue il y a ${Math.round((Date.now() - recuA) / 1000)} s : périmée, rien envoyé`); return finir({ ...base, nonEnvoye: "tâche périmée côté agent (Mac en veille ?) : rien envoyé" }); }
  const refus = valider(t);
  if (refus) { log(`✗ ${t.ref} non envoyée : ${refus}`); return finir({ ...base, nonEnvoye: `refusée par l'agent : ${refus}` }); }
  const prev = tentatives.get(t.ref);
  const refusCertain = prev && prev.http >= 400 && prev.http < 500;
  if (prev && !refusCertain && !t.forcer) {
    log(`⚠ ${t.ref} déjà tentée le ${prev.avantA} (HTTP ${prev.http ?? "inconnu"}) : pas de nouvel envoi`);
    return finir({ ...base, dejaTente: prev.avantA });
  }
  ecrireJournal({ t: "avant", ref: t.ref, jeton: t.jeton, empreinte: base.empreinte, forcer: !!t.forcer });
  tentatives.set(t.ref, { avantA: new Date().toISOString(), http: null });
  const envoyeA = new Date().toISOString();
  const t0 = Date.now();
  let cr;
  try {
    const url = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(t.corps),
      redirect: "manual", signal: AbortSignal.timeout(30000) });
    const texte = masque(await r.text()).slice(0, 4000);
    cr = { ...base, http: r.status, texte, ms: Date.now() - t0, envoyeA };
    log(`→ ${t.ref} : PharmaML HTTP ${r.status} en ${cr.ms} ms — ${texte.slice(0, 160)}`);
  } catch (e) {
    cr = { ...base, erreur: masque(e.name === "TimeoutError" ? "délai de 30 s dépassé (PharmaML a peut-être reçu la commande)" : e.message).slice(0, 300), ms: Date.now() - t0, envoyeA };
    log(`⚠ ${t.ref} : ${cr.erreur}`);
  }
  ecrireJournal({ t: "apres", ref: t.ref, http: cr.http ?? null });
  tentatives.set(t.ref, { ...tentatives.get(t.ref), http: cr.http ?? null, apresA: new Date().toISOString() });
  return finir(cr);
}
async function finir(cr) {
  if (!await rendre(cr)) { aRendre.push(cr); sauverARendre(); }
}

// ── boucle : toutes les 20 s de 6 h à 22 h (heure de Paris), toutes les 60 s sinon ──
let dernierTour = null, dernierErreur = null, enCours = false;
const heureParis = () => Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(new Date()));
async function tour() {
  if (enCours) return;
  enCours = true;
  try {
    await viderARendre();
    // une tâche à la fois (un arrêt brutal laisse au plus un envoi en suspens), enchaînées tant qu'il y en a
    for (let n = 0; n < 20; n++) {
      const { status, j } = await appel({ action: "prendre", instance: INSTANCE, version: VERSION, max: 1 });
      const recuA = Date.now();
      if (status !== 200) { dernierErreur = `site : HTTP ${status} ${j.error || ""}`; log(`⚠ ${dernierErreur}`); return; }
      if (j.arret) { dernierErreur = j.arret; log(`⚠ ${j.arret}`); return; }
      if (j.pause && dernierErreur !== j.pause) log(`⛔ envois suspendus : ${j.pause}`);
      dernierErreur = j.pause || null;
      if (!(j.taches || []).length) break;
      for (const t of j.taches) { log(`📦 tâche ${t.ref} (${t.source})`); await traiter(t, recuA); }
    }
    dernierTour = new Date().toISOString();
  } catch (e) { dernierErreur = e.message; log(`⚠ site injoignable : ${e.message}`); }
  finally { enCours = false; }
}
function planifier() {
  const h = heureParis();
  setTimeout(async () => { await tour(); planifier(); }, h >= 6 && h < 22 ? 20e3 : 60e3);
}

// ── port 3001 : plus d'envoi direct (ancienne synchro de la page admin) ──
const serveur = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }
  if (req.method === "GET") { res.writeHead(200); return res.end(JSON.stringify({ agent: AGENT_ID, version: VERSION, instance: INSTANCE, dernierTour, dernierErreur, aRendre: aRendre.length })); }
  req.resume();
  res.writeHead(410);
  res.end(JSON.stringify({ success: false, error: "Agent v3 : la synchro passe désormais par le relais du site. Actualisez la page admin (Cmd+R) puis relancez la synchro." }));
});
serveur.on("error", (e) => log(`port ${PORT} indisponible (${e.code}) : le relais fonctionne quand même`));
serveur.listen(PORT, "127.0.0.1");

log(`Agent PharmaML v${VERSION} (${AGENT_ID}/${INSTANCE}) — site ${SITE_URL}, PharmaML ${PHARMAML_URL}, ${tentatives.size} référence(s) au journal, ${aRendre.length} compte(s) rendu(s) en attente`);
tour().then(planifier);
