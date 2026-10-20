// ── Banc d'essai local : plugin Vite, actif seulement en développement (« npm run dev ») ──
// Répond lui-même à /.netlify/functions/* : rien n'est jamais relayé vers la production.
//  • GET  : données figées de dev-fixtures/get/ (npm run banc:capture), sinon données calculées à partir
//           d'elles (recherche locale, « Mes commandes » et suggestions de la pharmacie du banc), sinon 404.
//           Page d'accueil (accueil-offres) : dev-fixtures/accueil-offres.json (scripts/banc/fixture-accueil.mjs) ;
//           ?verifier=cip,cip (éditeur des mises en avant) : règle du serveur (_accueil-vedettes.js) sur les données figées.
//  • autres méthodes : réponse « succès » (src/dev/reponses-fictives.js, ou dev-fixtures/post/<fn>[.<action>].json
//           si présent) ; le corps reçu est journalisé dans dev-fixtures/_envois/<jour>/ (jetons jamais écrits).
//  • Assistant Elixir (fonctions chat et chat-fichier) : réponses écrites d'avance (src/dev/reponses-fictives.js, cas
//           « chat »), attente de la réponse rejouée (GET ?tour=, étape puis réponse), PDF et Excel d'essai ; « #401 »,
//           « #409 », « #429 », « #503 » ou « #erreur » dans un message essaient les écrans d'erreur.
//  • product-upload-image (photo de l'admin : catalogue, « Ajouter une photo » de l'accueil) : la photo reçue est rangée
//           dans dev-fixtures/_photos/ (jamais Supabase) et servie par le banc à /banc-photos/elixir-images/products/<clé>.<ext>,
//           avec le même cache public d'une heure que le Storage (l'anti-cache ?v= se vérifie ici). Mises en avant : cette
//           adresse locale n'est pas en https, la règle des mises en avant la refuse à la publication (aperçu seulement).
//  • config-get (POST de l'admin : affichage, menus promo, mises en avant) : la valeur publiée est gardée en mémoire et
//           relue par les GET suivants jusqu'au redémarrage du banc (le site voit ce que l'admin publie, comme en ligne ;
//           jamais de 409 ici), sans toucher aux données figées.
//  • Notifications de l'appli (push-abonnement, push-admin) : GET → clé « BANC-FICTIVE » (navigateur simulé côté page,
//           src/notifications/banc.js, ?banc_push=<scénario>) ; appareils, réglages et annonces gardés en mémoire jusqu'au
//           redémarrage, deux appareils d'exemple pour la pharmacie du banc ; rien n'est envoyé. BANC_PUSH=reconnexion :
//           statut et actions répondent 401 (écran « Se reconnecter » du panneau).
// Variables : BANC=0 (désactive), BANC_AUTH=legacy|otp (mode d'identification), BANC_LATENCE=<ms>,
// BANC_JOURNAL=<nom> (dossier du journal des envois, sinon la date du jour), BANC_CHAT=reconnexion (session sans jeton
// valide, assistant ouvert à toutes les pharmacies : « etat » répond reconnexion + ouvert, l'ouverture 401 : encart
// « Me reconnecter »).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { DOSSIER_FIXTURES, DOSSIER_GET, DOSSIER_POST, DOSSIER_ENVOIS, decoupe, nomFixture } from "./commun.mjs";
import { reponseFictive, FICHIERS_FICTIFS, accueilFictif } from "../../src/dev/reponses-fictives.js";
import { contexteMenus } from "../../netlify/functions/_accueil-selection.js";
import { cipsAVerifier, verification } from "../../netlify/functions/_accueil-vedettes.js";
import { categoriesAffichees, filtrerCategories, verifierAnnonce, verifierReglages, fusionnerReglages, CATEGORIES_DEFAUT } from "../../src/notifications/regles.js";

// Photos envoyées à product-upload-image sur le banc (hors git, comme toutes les données du banc)
const DOSSIER_PHOTOS = resolve(DOSSIER_FIXTURES, "_photos", "products");
const TYPES_PHOTO = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

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
// Configurations publiées par l'admin sur le banc depuis son démarrage : clé → { value, updated_at }
const configsDuBanc = new Map();

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
      if (q.source) return { orders: [] };
      if (q.pharmacy_cip && q.pharmacy_cip === banc.cip) return { orders: commandesFictives(banc.cip) };
      return { orders: commandesDuBanc.slice().reverse() };
    case "restock-alert": return [];
    case "group-order": return [];
    case "lab-justif": return { products: {} };
    case "supplier-code-refs": return { refs: {}, byCip: {} };
    // notifications : clé fictive → la page simule le navigateur (aucun vrai abonnement)
    case "push-abonnement": return { disponible: true, cle_publique: "BANC-FICTIVE", ouverture: pushBanc.reglages.ouverture };
    // page d'accueil : vrai classement des 15 jours figé (dev-fixtures/accueil-offres.json, écrit par
    // scripts/banc/fixture-accueil.mjs depuis la fixture produit de l'étude), sinon le classement fictif des aperçus
    case "accueil-offres": {
      const base = litJson(resolve(DOSSIER_FIXTURES, "accueil-offres.json")) ?? accueilFictif();
      return q.verifier ? { ...base, verification: verificationBanc(q.verifier) } : base;
    }
    default: return undefined;
  }
}

// Éditeur des mises en avant (?verifier=) : offre et motifs par la règle du serveur, avec le catalogue, les produits
// curatés, les menus promo, l'affichage et les justificatifs figés du banc
function verificationBanc(liste) {
  const valeur = (k) => { const v = fige(`config-get?key=${k}`)?.value; return typeof v === "string" ? JSON.parse(v) : v; };
  const promos = valeur("admin_promos") || [];
  const catalogue = Object.fromEntries(catalogueLocal().map(p => [p.cip, p]));
  const justifs = new Set(Object.keys(fige("lab-justif?action=products")?.products || {}));
  return verification(cipsAVerifier(liste), { catalogue, curees: produits().filter(p => p.active !== false), promos, justifs,
    menus: contexteMenus({ displayConfig: valeur("display_config") || {}, promos, campagnes: [] }) });
}

// GET : priorité à la configuration du banc, puis donnée figée, puis calcul
function reponseGet(url) {
  const { fn, query } = decoupe(url);
  const banc = pharmacieBanc();
  if (fn === "config-get" && query.key === "pharmacy_auth_mode" && process.env.BANC_AUTH)
    return { statut: 200, corps: { key: "pharmacy_auth_mode", value: process.env.BANC_AUTH === "legacy" ? "legacy" : "otp" }, source: "banc" };
  if (fn === "config-get" && configsDuBanc.has(query.key)) return { statut: 200, corps: { key: query.key, ...configsDuBanc.get(query.key) }, source: "publié sur le banc" };
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

// product-upload-image : mêmes contrôles et même réponse que la fonction ({ success, image_url }), fichier sur le banc
function photoBanc(corps) {
  const { cip, imageBase64, mimeType, image_url: distante } = corps && typeof corps === "object" ? corps : {};
  if (!cip) return { statut: 400, corps: { error: "cip requis" }, source: "fictif" };
  if (distante) return { corps: { success: true, image_url: distante }, source: "fictif" };
  if (!imageBase64) return { statut: 400, corps: { error: "image_url ou imageBase64 requis" }, source: "fictif" };
  const cle = String(cip);
  if (!/^[\w-]{1,80}$/.test(cle)) return { statut: 400, corps: { error: "Banc d'essai : clé de photo inattendue" }, source: "fictif" };
  const ext = TYPES_PHOTO[mimeType] || "jpg";
  mkdirSync(DOSSIER_PHOTOS, { recursive: true });
  writeFileSync(resolve(DOSSIER_PHOTOS, `${cle}.${ext}`), Buffer.from(String(imageBase64), "base64"));
  return { corps: { success: true, image_url: `/banc-photos/elixir-images/products/${cle}.${ext}` }, source: "fictif (photo rangée sur le banc)" };
}

function reponsePost({ fn, methode, corps }) {
  const action = corps && typeof corps === "object" && typeof corps.action === "string" ? corps.action : "";
  const perso = (action ? litJson(resolve(DOSSIER_POST, `${fn}.${action}.json`)) : undefined) ?? litJson(resolve(DOSSIER_POST, `${fn}.json`));
  if (perso !== undefined) return { corps: perso, source: "post personnalisé" };
  if (fn === "chat") return reponseChatBanc(corps && typeof corps === "object" ? corps : {});
  if (fn === "push-abonnement") return reponsePushBanc(corps && typeof corps === "object" ? corps : {});
  if (fn === "push-admin") return reponsePushAdminBanc(corps && typeof corps === "object" ? corps : {});
  if (fn === "product-upload-image") return photoBanc(corps);
  const r = reponseFictive({ fn, methode, corps, pharmacie: pharmacieBanc(), admin: true });
  if (fn === "config-get" && corps && typeof corps === "object" && typeof corps.key === "string" && r?.success)
    configsDuBanc.set(corps.key, { value: corps.value ?? null, updated_at: r.updated_at ?? null });
  // « Mes commandes » montre les commandes passées sur le banc
  if (fn === "order-save" && corps && typeof corps === "object" && Array.isArray(corps.items)) commandesDuBanc.push({ ...corps, date: corps.date || new Date().toISOString() });
  return { corps: r, source: "fictif" };
}

// ── Notifications de l'appli : appareils, réglages et annonces du banc (en mémoire, rien n'est envoyé) ──
const JOUR_MS = 86400e3;
const ilYa = (j) => new Date(Date.now() - j * JOUR_MS).toISOString();
const pushBanc = {
  reglages: fusionnerReglages({ ouverture: "toutes", pilote_cips: [], plafond_offres_7j: 2 }),
  appareils: null,   // id → appareil (créés au premier appel : la pharmacie du banc peut venir de dev-fixtures/pharmacie.json)
  admin: new Map(),
  annonces: [],
  n: 0,
};
function appareilsBanc() {
  if (pushBanc.appareils) return pushBanc.appareils;
  const cip = pharmacieBanc().cip;
  const a = (id, appareil, plateforme, installe, categories, jours, extra = {}) => [id, { id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, cip, appareil, plateforme,
    installe, categories, created_at: ilYa(jours), last_success_at: ilYa(1), failures: 0, ...extra }];
  pushBanc.appareils = new Map([
    a("banc-comptoir", "Ordinateur · Chrome", "ordinateur", false, ["stock", "commandes", "offres"], 12),
    a("banc-titulaire", "iPhone · application", "ios", true, ["stock", "offres"], 30, { failures: 4, last_success_at: ilYa(9) }),
    // scénario « abonne » de la page (?banc_push=abonne) : cet appareil est déjà connu du banc
    a("banc-abonne", "Ordinateur · Chrome", "ordinateur", false, ["stock", "commandes", "offres"], 3),
  ]);
  return pushBanc.appareils;
}
const publicBanc = (d, endpoint) => ({ id: d.id, appareil: d.appareil, plateforme: d.plateforme, installe: d.installe, categories: d.categories, created_at: d.created_at,
  last_success_at: d.last_success_at, en_echec: d.failures >= 3, ...(endpoint !== undefined ? { actuel: d.endpoint === endpoint } : {}) });
function reponsePushBanc(b) {
  if (process.env.BANC_PUSH === "reconnexion" && b.action !== "oublier") return { statut: 401, corps: { error: "reconnexion" }, source: "fictif (BANC_PUSH)" };
  const liste = appareilsBanc();
  const parEndpoint = (e) => [...liste.values()].find(d => d.endpoint === e) || null;
  const ok = (corps) => ({ corps, source: "fictif (notifications du banc)" });
  switch (b.action) {
    case "statut": {
      const actuel = b.endpoint ? parEndpoint(b.endpoint) : null;
      // l'appareil « abonne » n'apparaît que s'il est celui de la page (sinon : deux appareils d'exemple)
      const visibles = [...liste.values()].filter(d => d.id !== "banc-abonne" || (actuel && actuel.id === "banc-abonne"));
      return ok({ disponible: true, raison: null, cle_publique: "BANC-FICTIVE", plafond_offres_7j: pushBanc.reglages.plafond_offres_7j,
        categories_disponibles: categoriesAffichees(pushBanc.reglages.plafond_offres_7j), appareil: actuel ? publicBanc(actuel) : null, autre_identite: false,
        appareils: visibles.map(d => publicBanc(d, b.endpoint || null)) });
    }
    case "abonner": {
      const e = String(b.abonnement?.endpoint || "");
      if (!e) return { statut: 400, corps: { error: "abonnement" }, source: "fictif" };
      const ex = parEndpoint(e);
      const id = ex?.id || `banc-${++pushBanc.n}`;
      liste.set(id, { ...(ex || {}), id, endpoint: e, cip: pharmacieBanc().cip, appareil: b.appareil?.libelle || "Appareil", plateforme: b.appareil?.plateforme || "autre",
        installe: !!b.appareil?.installe, categories: filtrerCategories(b.categories) ?? ex?.categories ?? CATEGORIES_DEFAUT, created_at: ex?.created_at || new Date().toISOString(),
        last_success_at: ex?.last_success_at || null, failures: 0 });
      return ok({ success: true, appareil: publicBanc(liste.get(id)) });
    }
    case "categories": {
      const d = parEndpoint(b.endpoint);
      if (!d) return { statut: 404, corps: { error: "appareil" }, source: "fictif" };
      d.categories = filtrerCategories(b.categories) || [];
      return ok({ success: true, categories: d.categories });
    }
    case "test": { const d = parEndpoint(b.endpoint); if (d) d.last_success_at = new Date().toISOString(); return d ? ok({ success: true }) : { statut: 404, corps: { error: "appareil" }, source: "fictif" }; }
    case "retirer": {
      if (b.id) liste.delete(String(b.id)); else { const d = parEndpoint(b.endpoint); if (d) liste.delete(d.id); }
      return ok({ success: true });
    }
    case "oublier": { const d = parEndpoint(b.endpoint); if (d) liste.delete(d.id); return ok({ success: true, role: d ? "pharmacie" : null }); }
    default: return ok({ success: true });
  }
}
// Statistiques d'exemple de l'admin : pharmacies fictives (aucune donnée réelle) + appareils du banc
const PHARMACIES_EXEMPLE = [
  ["PHARMACIE DES ARCADES", "2000001", ["android"], ["stock", "commandes", "offres"]], ["PHARMACIE DU MARCHÉ", "2000002", ["ios", "ordinateur"], ["stock", "offres"]],
  ["PHARMACIE DE LA GARE", "2000003", ["ios"], ["stock", "commandes", "offres"]], ["GRANDE PHARMACIE CENTRALE", "2000004", ["android", "android", "ordinateur"], ["stock", "commandes"]],
  ["PHARMACIE DU PARC", "2000005", ["ordinateur"], ["offres"]], ["PHARMACIE SAINT-LOUIS", "2000006", ["ios"], ["stock", "commandes", "offres"]],
];
function etatAdminBanc(endpoint) {
  const pharmacies = PHARMACIES_EXEMPLE.map(([nom, cip, plateformes, categories]) => ({ cip, nom, appareils: plateformes.length, plateformes: [...new Set(plateformes)], categories, en_echec: 0 }));
  const banc = [...appareilsBanc().values()].filter(d => d.id !== "banc-abonne");
  if (banc.length) pharmacies.push({ cip: pharmacieBanc().cip, nom: pharmacieBanc().name, appareils: banc.length, plateformes: [...new Set(banc.map(d => d.plateforme))],
    categories: [...new Set(banc.flatMap(d => d.categories))], en_echec: banc.filter(d => d.failures >= 3).length });
  const plateformes = { ios: 0, android: 0, ordinateur: 0, autre: 0 };
  for (const p of PHARMACIES_EXEMPLE) for (const x of p[2]) plateformes[x]++;
  for (const d of banc) plateformes[d.plateforme] = (plateformes[d.plateforme] || 0) + 1;
  const parCat = { stock: 0, commandes: 0, offres: 0 };
  for (const p of pharmacies) for (const c of p.categories) parCat[c]++;
  pharmacies.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  return { disponible: true, service: { vapid_publique: true, vapid_privee: true, vapid_paire: true, sujet: true, sujet_defaut: false, cle_serveur: true, cron_secret: true,
    tables: true, defauts: [] }, sujet_affiche: "mailto:pharmacien@elixirpharma.fr", cle_publique: "BANC-FICTIVE", reglages: pushBanc.reglages,
    stats: { pharmacies: pharmacies.length, appareils: Object.values(plateformes).reduce((a, b) => a + b, 0), par_categorie: parCat, par_plateforme: plateformes,
      installes: 3, en_echec: banc.filter(d => d.failures >= 3).length, vus_30j: 9 },
    pharmacies, mes_appareils: [...pushBanc.admin.values()].map(d => publicBanc(d, endpoint || null)) };
}
function reponsePushAdminBanc(b) {
  const ok = (corps, statut = 200) => ({ statut, corps, source: "fictif (notifications du banc)" });
  switch (b.action) {
    case "etat": return ok(etatAdminBanc(b.endpoint));
    case "reglages": { const v = verifierReglages(b.reglages || {}); if (!v.ok) return ok({ erreurs: v.erreurs }, 400); pushBanc.reglages = v.reglages; return ok({ reglages: v.reglages }); }
    case "abonner_admin": {
      const e = String(b.abonnement?.endpoint || "");
      const ex = [...pushBanc.admin.values()].find(d => d.endpoint === e);
      const id = ex?.id || `banc-admin-${++pushBanc.n}`;
      pushBanc.admin.set(id, { id, endpoint: e, appareil: b.appareil?.libelle || "Appareil", plateforme: b.appareil?.plateforme || "autre", installe: !!b.appareil?.installe,
        categories: [], created_at: ex?.created_at || new Date().toISOString(), last_success_at: null, failures: 0 });
      return ok({ success: true, appareil: publicBanc(pushBanc.admin.get(id)) });
    }
    case "retirer_admin": { for (const [id, d] of pushBanc.admin) if (id === b.id || d.endpoint === b.endpoint) pushBanc.admin.delete(id); return ok({ success: true }); }
    case "test": return ok(pushBanc.admin.size ? { envoyes: pushBanc.admin.size, echecs: 0, retires: 0 } : { envoyes: 0, echecs: 0, retires: 0, aucun: true });
    case "apercu": { const v = verifierAnnonce({ ...(b.annonce || {}), audience: "toutes" }); if (!v.ok) return ok({ erreurs: v.erreurs }, 400);
      return ok(pushBanc.admin.size ? { envoyes: pushBanc.admin.size, echecs: 0, retires: 0 } : { envoyes: 0, echecs: 0, retires: 0, aucun: true }); }
    case "estimer": {
      const n = b.audience === "liste" ? (Array.isArray(b.cips) ? b.cips.length : 0) : 5;
      return ok({ visees: n, plafonnees: n > 1 ? 1 : 0, recevront: Math.max(0, n - (n > 1 ? 1 : 0)), appareils: Math.max(0, n - (n > 1 ? 1 : 0)) + 1, fermee: pushBanc.reglages.ouverture === "fermee",
        plafond_offres_7j: pushBanc.reglages.plafond_offres_7j });
    }
    case "envoyer": {
      const v = verifierAnnonce(b.annonce || {});
      if (!v.ok) return ok({ erreurs: v.erreurs }, 400);
      const deja = pushBanc.annonces.find(a => a.idem === b.idem);
      if (deja) return ok({ annonce: deja, deja: true });
      if (pushBanc.reglages.ouverture === "fermee") return ok({ error: "fermee" }, 409);
      const a = { id: `banc-${Date.now()}`, idem: b.idem, ...v.annonce, nb_cips: v.annonce.cips?.length || 0, admin_email: "pharmacien@elixirpharma.fr", statut: "envoyee", erreur: null,
        nb_visees: 5, nb_plafonnees: 1, nb_pharmacies: 4, nb_appareils: 5, nb_reussis: 5, nb_echecs: 0, nb_retires: 0, created_at: new Date().toISOString(), finished_at: new Date().toISOString() };
      pushBanc.annonces.unshift(a);
      return ok({ annonce: a }, 202);
    }
    case "relancer": return ok({ error: "statut" }, 409);
    case "historique": return ok({ annonces: [...pushBanc.annonces,
      { id: "banc-ex-2", titre: "Vaseline : précommande ouverte", corps: "13 références à prix net, livraison début novembre.", url: "/?menu=promo_1792060000000", audience: "toutes", cips: null, nb_cips: 0,
        admin_email: "pharmacien@elixirpharma.fr", statut: "envoyee", nb_visees: 6, nb_plafonnees: 0, nb_pharmacies: 6, nb_appareils: 9, nb_reussis: 8, nb_echecs: 1, nb_retires: 0,
        created_at: ilYa(3), finished_at: ilYa(3) },
      { id: "banc-ex-1", titre: "Culottes menstruelles remboursées", corps: "20 références Claripharm, remboursées sur prescription.", url: "/?outil=saisie", audience: "liste", cips: ["2000001", "2000003"], nb_cips: 2,
        admin_email: "pharmacien@elixirpharma.fr", statut: "envoyee", nb_visees: 2, nb_plafonnees: 0, nb_pharmacies: 2, nb_appareils: 2, nb_reussis: 2, nb_echecs: 0, nb_retires: 0,
        created_at: ilYa(9), finished_at: ilYa(9) }] });
    case "pharmacie": {
      const banc = b.cip === pharmacieBanc().cip ? [...appareilsBanc().values()].filter(d => d.id !== "banc-abonne").map(d => publicBanc(d)) : [];
      return ok({ appareils: banc, raison: null, disponible: true });
    }
    default: return ok({ success: true });
  }
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
      // photos envoyées sur le banc (product-upload-image) : cache public d'une heure, comme le Storage
      server.middlewares.use("/banc-photos/elixir-images/products", (req, res) => {
        const nom = basename(String(req.url || "").split("?")[0]);   // clé [\w-] : rien à décoder
        const ext = /^[\w-]{1,80}\.(jpg|png|webp)$/.exec(nom)?.[1];
        const fichier = resolve(DOSSIER_PHOTOS, nom);
        if (!ext || !existsSync(fichier)) { res.statusCode = 404; return res.end(); }
        res.setHeader("Content-Type", ext === "jpg" ? "image/jpeg" : `image/${ext}`);
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.end(readFileSync(fichier));
      });
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
