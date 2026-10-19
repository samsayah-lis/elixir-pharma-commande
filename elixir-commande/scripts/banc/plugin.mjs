// ── Banc d'essai local : plugin Vite, actif seulement en développement (« npm run dev ») ──
// Répond lui-même à /.netlify/functions/* : rien n'est jamais relayé vers la production.
//  • GET  : données figées de dev-fixtures/get/ (npm run banc:capture), sinon données calculées à partir
//           d'elles (recherche locale, « Mes commandes » et suggestions de la pharmacie du banc), sinon 404.
//  • autres méthodes : réponse « succès » (src/dev/reponses-fictives.js, ou dev-fixtures/post/<fn>[.<action>].json
//           si présent) ; le corps reçu est journalisé dans dev-fixtures/_envois/<jour>/ (jetons jamais écrits).
//  • Assistant Elixir (fonctions chat et chat-fichier) : réponses écrites d'avance (src/dev/reponses-fictives.js, cas
//           « chat »), attente de la réponse rejouée (GET ?tour=, étape puis réponse), PDF et Excel d'essai ; « #401 »,
//           « #409 », « #429 », « #503 » ou « #erreur » dans un message essaient les écrans d'erreur.
// Variables : BANC=0 (désactive), BANC_AUTH=legacy|otp (mode d'identification), BANC_LATENCE=<ms>,
// BANC_JOURNAL=<nom> (dossier du journal des envois, sinon la date du jour), BANC_CHAT=reconnexion (session sans jeton
// valide, assistant ouvert à toutes les pharmacies : « etat » répond reconnexion + ouvert, l'ouverture 401 : encart
// « Me reconnecter »).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOSSIER_GET, DOSSIER_POST, DOSSIER_ENVOIS, decoupe, nomFixture } from "./commun.mjs";
import { reponseFictive, FICHIERS_FICTIFS } from "../../src/dev/reponses-fictives.js";

// Pharmacie du banc (identité renvoyée à l'identification) ; remplaçable par dev-fixtures/pharmacie.json
const PHARMACIE_BANC = { name: "PHARMACIE DU BANC D'ESSAI", cip: "9999999", email: "" };

// ── lecture des données figées (gardées en mémoire tant que le fichier ne change pas) ──
const cache = new Map();
function litJson(fichier) {
  if (!existsSync(fichier)) return undefined;
  const t = statSync(fichier).mtimeMs;
  const c = cache.get(fichier);
  if (c && c.t === t) return c.v;
  const v = JSON.parse(readFileSync(fichier, "utf8"));
  cache.set(fichier, { t, v });
  return v;
}
const fige = (chemin) => litJson(resolve(DOSSIER_GET, nomFixture(chemin)));
const pharmacieBanc = () => ({ ...PHARMACIE_BANC, ...(litJson(resolve(DOSSIER_GET, "../pharmacie.json")) || {}) });
const produits = () => fige("products-get")?.products || [];
const stocks = () => fige("stock-get")?.stocks || {};

// Catalogue Odoo pour la recherche locale : résultats de recherche capturés + catalogue curaté
function catalogueLocal() {
  const parCip = new Map();
  const st = stocks();
  for (const p of produits()) if (p.cip) parCip.set(p.cip, {
    cip: p.cip, barcode: p.cip, name: p.name, list_price: p.pv ?? null, discounted_price: p.pn ?? null,
    discount_pct: p.pct ?? null, price_tiers: p.price_tiers || null, in_stock: st[p.cip] ? st[p.cip].dispo > 0 : true,
    available: st[p.cip]?.stock ?? null, earliest_expiry: null,
  });
  const fichiers = Object.values(litJson(resolve(DOSSIER_GET, "../_capture.json"))?.entrees || {}).map(e => e.fichier);
  for (const f of fichiers) if (f.startsWith("odoo-catalog__")) for (const p of litJson(resolve(DOSSIER_GET, f))?.products || []) if (p.cip) parCip.set(p.cip, p);
  return [...parCip.values()];
}

// Commandes enregistrées sur le banc depuis son démarrage (pour « Mes commandes »)
const commandesDuBanc = [];

// Échantillon stable de produits (avec prix) d'une ou plusieurs sections
const echantillon = (sections, n, decalage = 0) => produits().filter(p => sections.includes(p.section) && p.pn != null).slice(decalage, decalage + n);

function commandesFictives(cip) {
  const jour = 86400e3, maintenant = Date.now();
  const ligne = (p, q) => ({ cip: p.cip, name: p.name, qty: q, pn: p.pn, total: Math.round(p.pn * q * 100) / 100 });
  const commande = (n, il_y_a, lignes, extra = {}) => ({
    id: 1700000000000 + n, date: new Date(maintenant - il_y_a * jour).toISOString(), pharmacyName: pharmacieBanc().name,
    pharmacyCip: cip, isClient: true, items: lignes, totalHt: Math.round(lignes.reduce((t, l) => t + l.total, 0) * 100) / 100,
    nbLignes: lignes.length, processed: true, source: "catalogue", ...extra,
  });
  return [
    ...commandesDuBanc.filter(o => !o.pharmacyCip || o.pharmacyCip === cip).slice().reverse(),
    commande(3, 2, echantillon(["otc"], 4, 10).map((p, i) => ligne(p, 6 * (i + 1))), { processed: false }),
    commande(2, 9, echantillon(["expert", "stratege"], 3).map((p, i) => ligne(p, i + 1))),
    commande(1, 23, echantillon(["master", "molnlycke"], 5).map(p => ligne(p, 12))),
  ];
}

// GET sans donnée figée exacte : réponses calculées
function getCalcule(fn, q) {
  const banc = pharmacieBanc();
  switch (fn) {
    case "products-get": return { products: [] };
    case "config-get": return { key: q.key, value: null };
    case "campaign-get": return [];
    case "stock-get": {
      if (!q.cips) return { stocks: {}, updatedAt: null };
      const st = stocks(), out = {};
      for (const c of q.cips.split(",")) if (st[c]) out[c] = st[c];
      return { stocks: out, updatedAt: fige("stock-get")?.updatedAt || null };
    }
    case "odoo-catalog": {
      if (q.count === "1") { const c = catalogueLocal(); return { total: c.length, in_stock: c.filter(p => p.in_stock).length, updated_at: null }; }
      if (q.expiry_months) return { products: [], total: 0 };
      const terme = String(q.q || "").trim().toLowerCase();
      if (terme.length < 2) return { products: [], total: 0 };
      const limite = Math.min(parseInt(q.limit) || 50, 200);
      const chiffres = /^\d+$/.test(terme);
      const trouves = catalogueLocal()
        .filter(p => chiffres ? (String(p.cip || "").startsWith(terme) || String(p.barcode || "").startsWith(terme)) : String(p.name || "").toLowerCase().includes(terme))
        .filter(p => q.stock_only !== "1" || p.in_stock)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .slice(0, limite);
      return { products: trouves, total: trouves.length };
    }
    case "ml-recommend": {
      if (q.mode === "reorder") {
        if (q.pharmacy_cip !== banc.cip) return { suggestions: [] };
        return { suggestions: echantillon(["otc", "master"], 6, 3).map((p, i) => ({ cip: p.cip, name: p.name, section: p.section, pn: p.pn,
          suggested_qty: 6, avg_interval_days: 21, days_since_last: 20 + i, should_reorder: true, confidence: 0.8, order_count: 5 })) };
      }
      if (q.cip) {   // ventes croisées : d'autres produits de la même section
        const p0 = produits().find(p => p.cip === q.cip);
        const recs = p0 ? produits().filter(p => p.section === p0.section && p.cip !== p0.cip && p.pn != null).slice(0, parseInt(q.limit) || 3) : [];
        return { recommendations: recs.map(p => ({ cip: p.cip, lift: 1.8, confidence: 0.4, name: p.name, section: p.section, pn: p.pn, image_url: p.image_url || null })) };
      }
      if (q.mode === "ruptures") return { predictions: [] };
      if (q.mode === "segments") return { segments: [] };
      return { status: "ok" };
    }
    case "order-list":
      if (q.agrege) return { cips: [] };   // barre de campagne : références validées, toutes pharmacies
      if (q.source) return { orders: [] };
      if (q.pharmacy_cip && q.pharmacy_cip === banc.cip) return { orders: commandesFictives(banc.cip) };
      return { orders: commandesDuBanc.slice().reverse() };
    case "restock-alert": return [];
    case "group-order": return [];
    case "lab-justif": return { products: {} };
    case "supplier-code-refs": return { refs: {}, byCip: {} };
    default: return undefined;
  }
}

// GET : priorité à la configuration du banc, puis donnée figée, puis calcul
function reponseGet(url) {
  const { fn, query } = decoupe(url);
  const banc = pharmacieBanc();
  if (fn === "config-get" && query.key === "pharmacy_auth_mode" && process.env.BANC_AUTH)
    return { statut: 200, corps: { key: "pharmacy_auth_mode", value: process.env.BANC_AUTH === "legacy" ? "legacy" : "otp" }, source: "banc" };
  if ((fn === "order-list" || fn === "ml-recommend") && query.pharmacy_cip === banc.cip) return { statut: 200, corps: getCalcule(fn, query), source: "calculé" };
  const f = fige(url);
  if (f !== undefined) return { statut: 200, corps: f, source: "figé" };
  const c = getCalcule(fn, query);
  if (c !== undefined) return { statut: 200, corps: c, source: "calculé" };
  return { statut: 404, corps: { error: `Banc d'essai : aucune donnée figée pour ${fn} (npm run banc:capture, ou dev-fixtures/get/${nomFixture(url)})` }, source: "absent" };
}

// ── journal des envois : jamais de jeton ; les très longs textes (ordonnances en base64) résumés ──
const resume = (x) => {
  if (typeof x === "string" && x.length > 2000) return `«${x.length} caractères, sha256 ${createHash("sha256").update(x).digest("hex").slice(0, 16)}»`;
  if (Array.isArray(x)) return x.map(resume);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, resume(v)]));
  return x;
};
let numero = 0;
function journalise({ methode, url, fn, corps, entetes }) {
  const d = new Date();
  // un dossier par jour, ou par série nommée (BANC_JOURNAL=avant / apres) pour compare-envois.mjs
  const jour = String(process.env.BANC_JOURNAL || "").replace(/[^\w.-]/g, "") || d.toISOString().slice(0, 10);
  const dossier = resolve(DOSSIER_ENVOIS, jour);
  mkdirSync(dossier, { recursive: true });
  const action = corps && typeof corps === "object" && typeof corps.action === "string" ? `-${corps.action.replace(/[^\w-]/g, "")}` : "";
  const nom = `${d.toTimeString().slice(0, 8).replace(/:/g, "")}-${String(d.getMilliseconds()).padStart(3, "0")}-${String(++numero).padStart(4, "0")}-${fn}${action}.json`;
  writeFileSync(resolve(dossier, nom), JSON.stringify({ date: d.toISOString(), methode, url, fonction: fn,
    autorisation: entetes.authorization ? "présente" : "absente", corps: resume(corps) }, null, 2));
  return `${jour}/${nom}`;
}

const litCorps = (req) => new Promise((ok, ko) => {
  const morceaux = [];
  req.on("data", (m) => morceaux.push(m));
  req.on("end", () => ok(Buffer.concat(morceaux).toString("utf8")));
  req.on("error", ko);
});

function reponsePost({ fn, methode, corps }) {
  const action = corps && typeof corps === "object" && typeof corps.action === "string" ? corps.action : "";
  const perso = (action ? litJson(resolve(DOSSIER_POST, `${fn}.${action}.json`)) : undefined) ?? litJson(resolve(DOSSIER_POST, `${fn}.json`));
  if (perso !== undefined) return { corps: perso, source: "post personnalisé" };
  if (fn === "chat") return reponseChatBanc(corps && typeof corps === "object" ? corps : {});
  const r = reponseFictive({ fn, methode, corps, pharmacie: pharmacieBanc(), admin: true });
  // « Mes commandes » montre les commandes passées sur le banc
  if (fn === "order-save" && corps && typeof corps === "object" && Array.isArray(corps.items)) commandesDuBanc.push({ ...corps, date: corps.date || new Date().toISOString() });
  return { corps: r, source: "fictif" };
}

// ── Assistant Elixir : conversation du banc (docs/assistant-contrat.md, « API HTTP ») ──
// POST chat : réponse écrite d'avance ; pour « message », seul le tour_id part tout de suite et la réponse est servie
// par l'attente (GET ?tour=) : une étape d'abord (texte du serveur, d'après la carte), puis la réponse.
const ETAPES_FICTIVES = {
  document: "Je recherche vos factures…", documents: "Je recherche vos factures…", releve: "Je prépare votre relevé…",
  commande: "Je consulte vos commandes…", recap_retour: "Je prépare le récapitulatif de votre demande…",
  transmission: "Je transmets votre demande à l'équipe Elixir…",
};
const toursDuBanc = new Map();   // tour_id → { message, erreur, etape, appels }
const ERREURS_CHAT = {
  "#401": [401, { error: "reconnexion" }], "#409": [409, { error: "tour_en_cours" }],
  "#410": [410, { error: "conversation_fermee", message: "Banc d'essai : conversation fermée ailleurs (exemple) : une nouvelle conversation s'ouvre." }],
  "#429": [429, { error: "quota", message: "Banc d'essai : quota de messages atteint (exemple), réessayez dans une heure." }],
  "#503": [503, { error: "indisponible", message: "Banc d'essai : l'assistant est momentanément indisponible (exemple)." }],
};
function reponseChatBanc(corps) {
  if (process.env.BANC_CHAT === "reconnexion") {   // le vrai parcours : etat → bouton + encart, ouverture → 401
    return corps.action === "etat" ? { statut: 200, corps: { disponible: false, mode: null, raison: "reconnexion", ouvert: true }, source: "fictif" }
      : { statut: 401, corps: { error: "reconnexion" }, source: "fictif" };
  }
  const texte = String(corps.texte || "");
  const essai = corps.action === "message" && Object.keys(ERREURS_CHAT).find((k) => texte.includes(k));
  if (essai) { const [statut, c] = ERREURS_CHAT[essai]; return { statut, corps: c, source: "fictif" }; }
  const r = reponseFictive({ fn: "chat", corps, pharmacie: pharmacieBanc(), admin: true });
  if (corps.action !== "message" || !r.tour_id) return { corps: r, source: "fictif" };
  const type = r.message?.ui_actions?.[0]?.type;
  if (toursDuBanc.size > 200) toursDuBanc.delete(toursDuBanc.keys().next().value);
  toursDuBanc.set(r.tour_id, { message: r.message, erreur: texte.includes("#erreur"), etape: ETAPES_FICTIVES[type] || null, appels: 0 });
  return { statut: 202, corps: { tour_id: r.tour_id }, source: "fictif" };
}
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function attenteFictive(q) {
  const t = toursDuBanc.get(q.tour);
  if (!t) return { statut: 404, corps: { error: "tour_inconnu" }, source: "fictif" };
  t.appels++;
  await pause(t.appels === 1 ? 700 : 1200);
  if (t.appels === 1) return { statut: 200, corps: { statut: "en_cours", etape: t.etape, message: null }, source: "fictif" };
  return { statut: 200, corps: t.erreur ? { statut: "erreur", etape: null, message: null } : { statut: "termine", etape: null, message: t.message }, source: "fictif" };
}

// GET chat-fichier : PDF d'une page ou classeur Excel d'essai, servis comme les vrais (attachment, no-store, nosniff)
function pdfFictif(lignes) {
  const texte = (l) => `(${l.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&")}) '`;
  const flux = ["BT", "/F1 13 Tf", "72 790 Td", "20 TL", ...lignes.map(texte), "ET"].join("\n");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(flux, "latin1")} >>\nstream\n${flux}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const positions = objets.map((o, i) => { const p = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
async function fichierFictif(q) {
  const id = String(q.id || "");
  const mention = ["Elixir Pharma - banc d'essai de l'Assistant Elixir", "Document fictif : aucune donnee reelle."];
  if (id === FICHIERS_FICTIFS.releve_xlsx) {
    const X = await import("xlsx");
    const XLSX = X.utils ? X : X.default;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[mention[0]], [mention[1]], [], ["Document", "Date", "Total TTC"],
      ["INV/2026/90412", "fictif", 1234.56], ["INV/2026/90388", "fictif", 487.2], ["RINV/2026/09021", "fictif", -86.4]]), "Relevé");
    return { corps: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", nom: "Releve_banc_essai.xlsx" };
  }
  if (id === FICHIERS_FICTIFS.releve_pdf) return { corps: pdfFictif([...mention, "Releve des factures et avoirs emis (fictif)"]), type: "application/pdf", nom: "Releve_banc_essai.pdf" };
  if (id === FICHIERS_FICTIFS.facture) return { corps: pdfFictif([...mention, "Duplicata de facture INV/2026/90412 (fictif)"]), type: "application/pdf", nom: "Duplicata_INV_2026_90412.pdf" };
  return null;
}
function envoieFichier(res, f, log) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Banc", encodeURIComponent("fictif"));
  if (!f) { res.statusCode = 404; res.setHeader("Content-Type", "application/json; charset=utf-8"); return res.end(JSON.stringify({ error: "introuvable" })); }
  log(`GET chat-fichier → fichier d'essai ${f.nom}`);
  res.statusCode = 200;
  res.setHeader("Content-Type", f.type);
  res.setHeader("Content-Disposition", `attachment; filename="${f.nom}"`);
  return res.end(f.corps);
}

export default function bancEssai() {
  return {
    name: "elixir-banc-essai",
    apply: "serve",   // jamais dans « vite build »
    configureServer(server) {
      if (process.env.BANC === "0") return;
      const log = (m) => server.config.logger.info(`[banc] ${m}`, { timestamp: true });
      const latence = Math.max(0, parseInt(process.env.BANC_LATENCE) || 0);
      if (!existsSync(DOSSIER_GET)) server.config.logger.warn("[banc] aucune donnée figée : lancez « npm run banc:capture » (lectures GET de la production, une fois)");
      server.middlewares.use("/.netlify/functions", async (req, res) => {
        const methode = String(req.method || "GET").toUpperCase();
        const url = req.url || "/";
        const envoie = (statut, corps, source) => {
          res.statusCode = statut;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Banc", encodeURIComponent(source));
          res.end(JSON.stringify(corps));
        };
        try {
          if (latence) await new Promise(r => setTimeout(r, latence));
          if (methode === "OPTIONS") { res.statusCode = 204; return res.end(); }
          if (methode === "GET" || methode === "HEAD") {
            const { fn: f, query: q } = decoupe(url);
            if (f === "chat-fichier") return envoieFichier(res, await fichierFictif(q), log);
            const r = f === "chat" && q.tour ? await attenteFictive(q) : reponseGet(url);
            if (r.statut !== 200) log(`GET ${url.slice(0, 120)} → ${r.statut} (${r.source})`);
            return envoie(r.statut, r.corps, r.source);
          }
          const { fn } = decoupe(url);
          const brut = await litCorps(req);
          let corps; try { corps = brut ? JSON.parse(brut) : null; } catch { corps = brut; }
          const fichier = journalise({ methode, url, fn, corps, entetes: req.headers });
          const r = reponsePost({ fn, methode, corps });
          log(`${methode} ${fn}${corps?.action ? ` (${corps.action})` : ""} → rien n'est parti, journal ${fichier}`);
          return envoie(r.statut || 200, r.corps, r.source);
        } catch (e) {
          server.config.logger.error(`[banc] ${methode} ${url} : ${e.message}`);
          return envoie(500, { error: `Banc d'essai : ${e.message}` }, "erreur");
        }
      });
    },
  };
}
