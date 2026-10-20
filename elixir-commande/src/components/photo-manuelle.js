// ── Admin, page d'accueil : photo ajoutée à la main (« Ajouter une photo », demande de Zineb du 20/10/2026) ──
// Une photo choisie sur l'ordinateur (JPG, PNG ou WebP, 15 Mo au plus) est réduite dans le navigateur (900 px au plus sur
// le grand côté, qualité 0,85 ; PNG ou WebP : transparence gardée) et toujours réencodée : ses métadonnées (EXIF, XMP, lieu
// de prise de vue) ne partent jamais. Elle est envoyée par product-upload-image, la fonction de l'admin du catalogue
// (inchangée) : Storage elixir-images/products/<clé>.<ext> (écrasé s'il existe), puis image_url des lignes du catalogue
// (elixir_products) dont le CIP est cette clé, s'il y en a. Clé = CIP du dosage montré seulement pour un produit rangé dans
// un menu du catalogue (la photo y devient aussi la sienne, après confirmation) ; sinon « accueil-<CIP>-<instant> » : le
// catalogue n'est pas touché. L'adresse renvoyée reçoit ?v=<instant> : une photo remplacée (même fichier) se montre tout
// de suite ; pour un produit du catalogue, un second appel (image_url, sans fichier) y range aussi cette adresse.
// Parties pures (contrôle du fichier, dimensions, adresse, clés, dosages visés, menus) : scripts/test-photo-manuelle.mjs.
// Affichage vérifié (incident du 20/10/2026 : stockage elixir-images privé, toute adresse /object/public/ répondait 400
// « Bucket not found », carte de devant blanche sur l'accueil malgré « ✓ Photo ajoutée ») : envoyerEtVerifier (les deux
// éditeurs) — produit du catalogue : stockage sondé AVANT l'envoi ; puis l'adresse renvoyée doit s'afficher dans le
// navigateur (new Image(), sans CORS) AVANT tout message de réussite ; sinon rien n'est mis dans le brouillon ni publié, et
// le message dit pourquoi d'après la réponse du stockage (bucket privé, fichier absent, panne, connexion), jamais deviné.
// Photos déjà choisies : contrôlées de même, notées illisibles avec leur motif (accueil/illisibles.js, partagé avec
// l'aperçu) : « Photo illisible » dans l'admin.

import { estIllisible, illisibles, motifIllisible, noterIllisible, oublierIllisible, preciserMotif } from "./accueil/illisibles.js";

export const TYPES = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP" };
export const MAX_OCTETS = 15e6;   // 15 Mo comme le Finder les compte (Mo décimaux)
export const COTE_MAX = 900;
export const QUALITE = 0.85;
export const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const AIDE = "JPG, PNG ou WebP de votre ordinateur, 15 Mo au plus ; réduite avant l'envoi";

// Menus du catalogue (sections d'elixir_products, ORDRE_MENUS de netlify/functions/_accueil-selection.js) : un produit
// qui y est rangé a sa ligne au catalogue, et product-upload-image y met la photo. Ceux qui montrent les photos : grilles
// du site (GRID_SECTIONS d'App.jsx) ; Expert, Stratège et Master sont des tableaux, sans photo.
export const MENUS_CATALOGUE = ["expert", "stratege", "master", "obeso", "nr", "molnlycke", "blanche", "covid", "otc", "ulabs"];
export const MENUS_AVEC_PHOTOS = ["otc", "molnlycke", "obeso", "covid", "blanche", "nr", "ulabs"];
export const auCatalogue = (o) => MENUS_CATALOGUE.includes(o?.menu?.key);

const EXTENSIONS = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
// types déclarés hors norme (Windows, glisser-déposer depuis certaines applications)
const ALIAS = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "image/x-png": "image/png" };
const RE_HTTPS = /^https:\/\/[^\s"'()<>\\]+$/;
// banc d'essai local (npm run dev) seulement : la fausse fonction range la photo sur le banc et renvoie une adresse locale
// (scripts/banc/plugin.mjs) ; jamais en production
const RE_LOCALE = /^\/banc-photos\/[^\s"'()<>\\]+$/;
const DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
// poids en Mo décimaux, arrondi au dixième supérieur : le chiffre du Finder, jamais « 15 Mo » pour un fichier refusé
const mo = (n) => `${(Math.ceil(n / 1e5) / 10).toLocaleString("fr-FR")} Mo`;

// Type du fichier : type déclaré par le navigateur (alias hors norme compris) ; type vide, générique ou image d'un type
// inconnu (sauf HEIC/HEIF) : l'extension ; null : pas une photo prise en charge (le décodage écarte ensuite un faux)
export function typeDuFichier(f) {
  const declare = String(f?.type || "").trim().toLowerCase();
  const t = ALIAS[declare] || declare;
  if (TYPES[t]) return t;
  if (t && t !== "application/octet-stream" && !(t.startsWith("image/") && !/hei[cf]/.test(t))) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(String(f?.name || ""))?.[1]?.toLowerCase();
  return EXTENSIONS[ext] || null;
}

// Fichier choisi → message de refus (français, à montrer tel quel) ou null s'il est accepté
export function controlerFichier(f) {
  if (!f) return "Aucun fichier choisi.";
  if (!typeDuFichier(f)) {
    if (/hei[cf]/i.test(`${f.type || ""} ${f.name || ""}`)) return "Photo HEIC (iPhone) non prise en charge : enregistrez-la en JPG, puis réessayez.";
    return `« ${f.name || "Ce fichier"} » n'est pas une photo JPG, PNG ou WebP : choisissez une photo.`;
  }
  if (!(f.size > 0)) return "Fichier vide : choisissez une autre photo.";
  if (f.size > MAX_OCTETS) return `Photo trop lourde (${mo(f.size)}) : 15 Mo au plus.`;
  return null;
}

// Taille d'arrivée : grand côté ramené à COTE_MAX, jamais agrandi
export function dimensions(largeur, hauteur, max = COTE_MAX) {
  const k = Math.min(1, max / Math.max(largeur, hauteur));
  return { largeur: Math.max(1, Math.round(largeur * k)), hauteur: Math.max(1, Math.round(hauteur * k)), reduite: k < 1 };
}

// Adresse avec ?v=<instant> (un ancien v= est remplacé)
export function avecVersion(url, t = Date.now()) {
  const [chemin, requete = ""] = String(url).split("#")[0].split("?");
  const params = requete.split("&").filter(p => p && !/^v=/.test(p));
  return `${chemin}?${[...params, `v=${t}`].join("&")}`;
}

// Adresse renvoyée par la fonction : https (production) ; sur le banc local, adresse du banc ; sinon null
export function adresseRecue(url, dev = DEV) {
  const u = typeof url === "string" ? url.trim() : "";
  return u.length <= 450 && (RE_HTTPS.test(u) || (dev && RE_LOCALE.test(u))) ? u : null;
}

// Photo envoyée par « Ajouter une photo » (rangée dans elixir-images/products/), par opposition à une photo de la banque
export const estPhotoEnvoyee = (url) => /\/elixir-images\/products\//.test(String(url || ""));
// Clé du fichier d'une photo envoyée (products/<clé>.<ext>) ; null pour une autre adresse
export const cleDuFichier = (url) => /\/elixir-images\/products\/([\w-]{1,80})\.(?:jpg|png|webp)(?:[?#]|$)/.exec(String(url || ""))?.[1] || null;
// Dosage dont la photo envoyée d'ici est aussi celle du catalogue : produit d'un menu du catalogue dont la photo de l'accueil
// (display_config.accueil.photos, stable) est le fichier rangé sous son propre CIP. Ne dépend pas d'image_url du GET (qui
// peut être en retard) : elle se remplace d'ici, elle ne s'en retire pas.
export const liee = (o, photos = {}) => !!o?.cip && auCatalogue(o) && cleDuFichier(photos[o.cip]) === String(o.cip);

// Clé d'une photo de l'accueil seul (mise en avant, produit hors catalogue) : « accueil-… », jamais un CIP (le catalogue
// n'est pas modifié) et nouvelle à chaque envoi (la version en ligne garde son fichier jusqu'à « Publier ») ; outil du site :
// « accueil-outil-peremption-… » (aucune ligne du catalogue n'a ce CIP)
export function cleMiseEnAvant(it, t = Date.now()) {
  const objet = it?.type === "menu" ? `menu-${String(it.menu_id ?? "").replace(/[^\w-]/g, "").slice(0, 40)}`
    : it?.type === "outil" ? `outil-${String(it.outil ?? "").replace(/[^a-z]/g, "").slice(0, 20)}` : String(it?.cip ?? "").replace(/\D/g, "").slice(0, 14);
  return `accueil-${objet}-${t.toString(36)}`;
}
// Clé d'envoi d'une ligne des plus commandés : CIP du dosage montré s'il est au catalogue (photo du produit), sinon accueil seul
export const cleEnvoi = (s, t = Date.now()) => (auCatalogue(s) ? String(s.cip) : cleMiseEnAvant({ type: "produit", cip: s.cip }, t));

// Même forme de boîte (« Stylo prérempli » ≠ « Seringue préremplie ») ; forme inconnue d'un côté : même famille, acceptée
const forme = (o) => String(o?.boite?.forme || "").trim().toLowerCase();
export const memeForme = (a, b) => !forme(a) || !forme(b) || forme(a) === forme(b);

// Dosages d'une ligne des plus commandés et la photo envoyée pour le dosage montré :
//  • cibles : le dosage montré, toujours ; chaque autre dosage de même forme sans photo, ou dont la photo a été envoyée
//    d'ici pour l'accueil seul (remplacée avec la famille). Les autres dosages ne la reçoivent que sur l'accueil : seul le
//    dosage montré est écrit au catalogue (jamais la boîte du 5 mg sur la ligne du 2,5 mg dans un menu).
//  • gardees : { cip, libelle, raison } — "catalogue" (photo du catalogue, venue d'ailleurs ou posée d'ici quand ce dosage
//    était montré), "forme" (autre forme de boîte), "banque" (sa propre photo de la banque d'images).
export function repartitionFamille(s, photos = {}) {
  const vus = new Set(), cibles = [], gardees = [];
  for (const o of [s, ...(s?.variantes || [])]) {
    if (!o?.cip || vus.has(o.cip)) continue;
    vus.add(o.cip);
    const ici = photos[o.cip], garder = (raison) => gardees.push({ cip: o.cip, libelle: o.libelle || o.nom_court || o.cip, raison });
    if (o.cip === s.cip) cibles.push(o.cip);
    else if (liee(o, photos) || o.image_url) garder("catalogue");
    else if (!memeForme(o, s)) garder("forme");
    else if (ici && !estPhotoEnvoyee(ici)) garder("banque");
    else cibles.push(o.cip);
  }
  return { cibles, gardees };
}
export const ciblesFamille = (s, photos = {}) => repartitionFamille(s, photos).cibles;

// Où la photo envoyée se voit, pour le message : menus du catalogue concernés (avec ou sans photos)
// membres : dosages visés (objets du GET accueil-offres, avec leur menu)
export function portee(membres) {
  const cat = (membres || []).filter(auCatalogue);
  return {
    catalogue: cat.length > 0,
    menus: [...new Set(cat.filter(o => MENUS_AVEC_PHOTOS.includes(o.menu.key)).map(o => o.menu.label).filter(Boolean))],
  };
}

// Question posée avant le premier envoi d'un produit du catalogue (la photo y devient la sienne, sans retour possible d'ici)
export function questionCatalogue(s, nbAutres = 0) {
  const nom = s?.nom_court || s?.nom || "ce produit", menu = s?.menu?.label;
  const ou = MENUS_AVEC_PHOTOS.includes(s?.menu?.key) && menu ? `dans le menu « ${menu} » du catalogue` : "au catalogue (fiche du produit)";
  return `Cette photo deviendra aussi celle de « ${nom} » ${ou} et ne pourra plus en être retirée d'ici (seulement remplacée).`
    + (nbAutres ? `\n\n${nbAutres > 1 ? `Les ${nbAutres} autres dosages la reçoivent` : "L'autre dosage la reçoit"} seulement sur l'accueil.` : "")
    + "\n\nContinuer ?";
}

// ── envois et recherches en cours, hors des composants ──
// Un onglet quitté puis rouvert (ou l'écran de connexion après expiration du jeton) montre toujours « Envoi… » et ses
// boutons restent désactivés : pas de second envoi croisé sur la même famille. Un envoi en cours fait aussi demander
// confirmation avant de fermer ou recharger la page (beforeunload) et de quitter l'admin (AdminPanel).
const lignes = new Map();   // CIP du dosage montré → { occupe: "recherche" | "envoi" | null, message, ton, n }
const abonnes = new Set();
let enCours = 0, numero = 0;
const avantDeQuitter = (e) => { e.preventDefault(); e.returnValue = ""; };
export const etatLigne = (cip) => lignes.get(cip) || null;
export function noterLigne(cip, e = {}) {
  lignes.set(cip, { occupe: null, message: "", ton: "neutral", ...e, n: ++numero });   // n : un refus répété est relu
  abonnes.forEach(f => f());
}
export function abonnerLignes(f) { abonnes.add(f); return () => { abonnes.delete(f); }; }
export const envoisEnCours = () => enCours > 0;
export async function suivre(promesse) {
  if (enCours++ === 0 && typeof window !== "undefined") window.addEventListener("beforeunload", avantDeQuitter);
  try { return await promesse; } finally {
    if (--enCours === 0 && typeof window !== "undefined") window.removeEventListener("beforeunload", avantDeQuitter);
  }
}

// ── navigateur : décodage, réduction, envoi ──
async function decoder(fichier) {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(fichier, { imageOrientation: "from-image" });
      return { source: b, largeur: b.width, hauteur: b.height, fermer: () => b.close?.() };
    } catch { /* navigateur sans cette option, ou format qu'il ne décode pas ainsi : essai par une image */ }
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
    return { source: img, largeur: img.naturalWidth, hauteur: img.naturalHeight, fermer: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}
const versBlob = (canvas, type, qualite) => new Promise(ok => { try { canvas.toBlob(ok, type, qualite); } catch { ok(null); } });
const enBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => ko(new Error("Lecture de la photo impossible : réessayez."));
  r.readAsDataURL(blob);
});

// Fichier accepté par controlerFichier → { base64, mimeType, largeur, hauteur, octets } ; erreur : message français
export async function preparerPhoto(fichier) {
  const type = typeDuFichier(fichier);
  let d;
  try { d = await decoder(fichier); } catch { throw new Error("Photo illisible : le fichier est peut-être abîmé. Essayez-en une autre."); }
  try {
    if (!(d.largeur > 0 && d.hauteur > 0)) throw new Error("Photo illisible : dimensions inconnues. Essayez-en une autre.");
    const { largeur, hauteur } = dimensions(d.largeur, d.hauteur);
    const canvas = document.createElement("canvas");
    canvas.width = largeur; canvas.height = hauteur;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(d.source, 0, 0, largeur, hauteur);
    // JPG → JPG ; PNG ou WebP (transparence possible) → WebP, ou PNG si le navigateur ne sait pas écrire le WebP.
    // Toujours le fichier réencodé, même un peu plus lourd que l'original : rien de ses métadonnées ne part.
    let blob = null;
    if (type === "image/jpeg") blob = await versBlob(canvas, "image/jpeg", QUALITE);
    else {
      blob = await versBlob(canvas, "image/webp", QUALITE);
      if (!blob || blob.type !== "image/webp") blob = await versBlob(canvas, "image/png");
    }
    if (!blob || !TYPES[blob.type]) throw new Error("Réduction de la photo impossible dans ce navigateur : essayez avec Chrome.");
    return { base64: await enBase64(blob), mimeType: blob.type, largeur, hauteur, octets: blob.size };
  } finally { d.fermer(); }
}

// Envoi par product-upload-image (jeton admin) → adresse de la photo avec ?v= ; erreur : message français
export async function envoyerPhoto(adminFetch, cle, photo, t = Date.now()) {
  let r;
  try {
    r = await adminFetch("/.netlify/functions/product-upload-image", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cip: cle, imageBase64: photo.base64, mimeType: photo.mimeType }),
    });
  } catch { throw new Error("Envoi impossible : connexion perdue. Réessayez."); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error("Session admin expirée : reconnectez-vous, puis recommencez.");
  if (r.status === 413) throw new Error("Photo trop lourde pour l'envoi : choisissez-en une plus petite.");
  if (!r.ok || !j.success) throw new Error(`Envoi refusé (${String(j.error || `erreur ${r.status}`).slice(0, 120)}) : réessayez.`);
  const url = adresseRecue(j.image_url);
  if (!url) throw new Error("Envoi non confirmé : le serveur n'a pas renvoyé d'adresse de photo.");
  return avecVersion(url, t);
}

// Produit du catalogue : son image_url reçoit l'adresse avec ?v= (product-upload-image, adresse sans fichier : rien n'est
// renvoyé au Storage) ; sans ce second appel, le menu et l'accueil (photo du catalogue d'abord) pourraient montrer
// l'ancienne photo, gardée en cache. Échec sans gravité (la photo est rangée) : false, jamais d'erreur.
export async function versionnerAuCatalogue(adminFetch, cip, url) {
  try {
    const r = await adminFetch("/.netlify/functions/product-upload-image", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cip, image_url: url }),
    });
    const j = await r.json().catch(() => ({}));
    return !!(r.ok && j.success);
  } catch { return false; }
}

// ── affichage des photos : l'adresse donne-t-elle vraiment une image dans ce navigateur ? ──
export const DELAI_AFFICHAGE = 12000;   // une photo de 900 px au plus : largement assez, même en 4G
// Photo rangée dans le stockage des photos (Supabase elixir-images, ou sa copie du banc d'essai)
export const auStockage = (url) => /\/elixir-images\//.test(String(url || ""));
export const DOC_STOCKAGE = "docs/accueil.md, « Stockage des photos »";
const sansVersion = (url) => String(url || "").split(/[?#]/)[0];
// Base des adresses publiques du stockage (…supabase.co/storage/v1/object/public/elixir-images/ ; sur le banc local
// seulement : /banc-photos/elixir-images/) : jamais une autre adresse sondée
const RE_BASE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/elixir-images\//;
const RE_BASE_BANC = /^\/banc-photos\/elixir-images\//;
export const baseStockage = (url, dev = DEV) => (RE_BASE.exec(String(url || "")) || (dev ? RE_BASE_BANC.exec(String(url || "")) : null))?.[0] || null;
const enLigneParDefaut = () => typeof navigator === "undefined" || navigator.onLine !== false;

// adresse → Promise<"ok" | "illisible" | "delai" | "inconnu"> ; jamais d'erreur. new Image() sans crossOrigin : aucune
// lecture des pixels, aucun en-tête CORS nécessaire (la page la montre de la même façon). « inconnu » : pas de navigateur.
export function verifierAffichage(url, { delai = DELAI_AFFICHAGE, Img = globalThis.Image } = {}) {
  return new Promise((fini) => {
    if (!url || typeof Img !== "function") { fini("inconnu"); return; }
    let img = null, fait = false, minuteur = 0;
    const conclure = (v) => {
      if (fait) return;
      fait = true; clearTimeout(minuteur);
      if (img) { img.onload = null; img.onerror = null; }
      fini(v);
    };
    try {
      img = new Img();
      minuteur = setTimeout(() => conclure("delai"), delai);
      img.onload = () => conclure(img.naturalWidth > 0 && img.naturalHeight > 0 ? "ok" : "illisible");
      img.onerror = () => conclure("illisible");
      img.src = url;
    } catch { conclure("inconnu"); }
  });
}

// Pourquoi une adresse du stockage ne s'affiche pas : sa réponse, lue par fetch sans cache (le Storage répond
// « access-control-allow-origin: * », même en erreur ; relevé du 20/10/2026 : 400 { code: "NoSuchBucket" } pour un bucket
// privé ou absent, 400 { code: "NoSuchKey" } pour un fichier absent d'un bucket public). Un onerror seul ne dit pas
// pourquoi : bucket privé, fichier absent, panne, connexion coupée, proxy ou bloqueur donnent tous le même.
// → "prive" | "introuvable" | "panne" (5xx) | "connexion" (réseau coupé, hors ligne) | "lisible" (elle répond 200) | "inconnu"
export async function diagnostiquerStockage(url, { fetch: f = globalThis.fetch, enLigne = enLigneParDefaut } = {}) {
  if (!url) return "inconnu";
  if (!enLigne()) return "connexion";
  if (typeof f !== "function") return "inconnu";
  let r;
  try { r = await f(url, { cache: "no-store" }); } catch { return "connexion"; }
  if (r.ok) { try { r.body?.cancel?.(); } catch { /* corps déjà lu */ } return "lisible"; }
  if (r.status >= 500) return "panne";
  const j = await r.json().catch(() => null);
  const code = String(j?.code || ""), texte = `${j?.error || ""} ${j?.message || ""}`;
  if (code === "NoSuchBucket" || /bucket not found/i.test(texte)) return "prive";
  if (code === "NoSuchKey" || /object not found/i.test(texte)) return "introuvable";
  return "inconnu";
}

// Pourquoi une photo ne s'affiche pas (court, après « Photo illisible : ») : motif établi pour CETTE adresse
// (diagnostiquerStockage, gardé avec elle dans illisibles.js), jamais deviné d'après le seul fait qu'elle est au stockage
const RAISONS = {
  prive: `le stockage des photos (Supabase, « elixir-images ») n'est pas public — réglage à faire une seule fois dans Supabase, voir ${DOC_STOCKAGE}`,
  introuvable: "photo introuvable dans le stockage des photos (fichier retiré ou renommé) : ajoutez-la de nouveau",
  panne: "stockage des photos momentanément indisponible : « Vérifier de nouveau » dans quelques minutes",
  connexion: "connexion perdue pendant le contrôle : vérifiez Internet, puis « Vérifier de nouveau »",
};
export function raisonIllisible(url) {
  if (!auStockage(url)) return "l'adresse ne donne plus d'image (photo retirée par son hébergeur, ou adresse erronée)";
  const m = motifIllisible(url);
  return RAISONS[m] || (m ? "la photo ne s'affiche pas dans ce navigateur, sans motif reconnu : « Vérifier de nouveau »"
    : "la photo ne s'affiche pas dans ce navigateur (motif en cours de vérification)");
}
// Photo illisible parce que le stockage n'est pas public (bandeaux de l'admin : renvoi vers le réglage)
export const illisibleCarPrive = (url) => auStockage(url) && motifIllisible(url) === "prive";

// Message après un envoi dont l'adresse ne s'affiche pas (verdict de verifierAffichage, diagnostic de l'adresse) ; null si
// elle s'affiche. catalogue : produit du catalogue, dont la fiche a déjà reçu l'adresse (product-upload-image l'y range
// d'office, avant toute vérification) ; restauree : l'ancienne photo du produit y a été remise.
export function messageNonAffichee(verdict, { url, catalogue = false, diag = null, restauree = false } = {}) {
  if (verdict === "ok" || verdict === "inconnu") return null;
  const fiche = restauree ? " L'ancienne photo du produit a été remise au catalogue : rien n'a changé sur l'accueil."
    : " Elle est pourtant déjà la photo du produit au catalogue (la fonction d'envoi l'y range d'office) : le catalogue et l'accueil la montreront dès qu'elle s'affichera.";
  if (verdict === "delai") {
    return `Photo reçue, mais elle ne s'est pas affichée en ${DELAI_AFFICHAGE / 1000} secondes (connexion lente ?)`
      + (catalogue ? `.${fiche} Pour la publier aussi sur l'accueil (autres dosages compris), ajoutez-la de nouveau quand la connexion le permet.`
        : " : ajoutez-la de nouveau quand la connexion le permet. Rien n'a changé sur l'accueil.");
  }
  const cause = !auStockage(url) ? "l'adresse renvoyée ne donne pas d'image : ajoutez-la de nouveau."
    : diag === "prive" ? "le site ne peut pas l'afficher : le stockage des photos (Supabase, « elixir-images ») n'est pas public. "
      + `C'est un réglage à faire une seule fois dans Supabase (voir ${DOC_STOCKAGE}) ; une fois fait, ajoutez de nouveau la photo.`
    : diag === "introuvable" ? "elle est introuvable dans le stockage des photos : ajoutez-la de nouveau."
    : diag === "panne" ? "le stockage des photos est momentanément indisponible : ajoutez-la de nouveau dans quelques minutes."
    : diag === "connexion" ? "la connexion a été perdue avant qu'elle s'affiche : vérifiez Internet, puis ajoutez-la de nouveau."
    : "elle ne s'affiche pas dans ce navigateur : ajoutez-la de nouveau.";
  return `Photo reçue, mais ${cause}${catalogue ? fiche : " Rien n'a changé sur l'accueil."}`;
}

// Photos déjà choisies (brouillon, version en ligne, réglages de l'accueil) : contrôlées une fois par adresse ; illisible
// → notée avec son motif (illisibles.js : « Photo illisible » dans l'admin, aperçu sans elle, avertissement à « Publier »).
// variante : adresse réellement chargée (miniature de la banque d'images : photo(url, "thumbnail")), l'adresse elle-même sinon ;
// variante en erreur : l'adresse elle-même avant de conclure (une miniature manquante ne rend pas la photo illisible).
const controles = new Map();   // adresse → Promise<verdict>
export function controlerAffichage(url, { variante = url, ...opts } = {}) {
  if (!url) return Promise.resolve("inconnu");
  if (!controles.has(url)) {
    controles.set(url, verifierAffichage(variante, opts).then(async (v0) => {
      const v = v0 === "illisible" && variante !== url ? await verifierAffichage(url, opts) : v0;
      if (v !== "illisible") return v;
      noterIllisible(url);
      await expliquerIllisible(url, opts);
      return estIllisible(url) ? "illisible" : "ok";
    }));
  }
  return controles.get(url);
}
// Motif d'une photo du stockage notée illisible (par un contrôle ou par l'onError d'une miniature) : diagnostic une fois par
// adresse (refait si le motif a été effacé) ; elle répond 200 (erreur passagère) : nouvel essai, oubliée si elle s'affiche
const explications = new Map();   // adresse → { promesse, fini }
export function expliquerIllisible(url, opts = {}) {
  if (!auStockage(url) || !estIllisible(url)) return Promise.resolve(motifIllisible(url));
  const x = explications.get(url);
  if (x && (!x.fini || motifIllisible(url))) return x.promesse;
  const e = { fini: false };
  e.promesse = diagnostiquerStockage(url, opts).then(async (m) => {
    if (m === "lisible") await reverifierIllisibles([url], opts);
    else preciserMotif(url, m);
    e.fini = true;
    return m;
  });
  explications.set(url, e);
  return e.promesse;
}
// Nouvel essai des photos notées illisibles (« Vérifier de nouveau », réglage fait, sans recharger la page) : une adresse du
// stockage est redemandée avec un ?v= neuf (jamais une réponse d'erreur gardée en cache) ; affichée → oubliée, elle se
// montre de nouveau partout ; toujours illisible → motif relu. → nombre d'adresses redevenues lisibles.
export async function reverifierIllisibles(urls = [...illisibles()], opts = {}) {
  const t = opts.t ?? Date.now();
  const verdicts = await Promise.all(urls.filter(estIllisible).map(async (u) => {
    const v = await verifierAffichage(auStockage(u) ? avecVersion(u, t) : u, opts);
    if (v === "ok") { oublierIllisible(u); controles.delete(u); return 1; }
    if (auStockage(u)) { const m = await diagnostiquerStockage(u, opts); if (m !== "lisible") preciserMotif(u, m); }
    return 0;
  }));
  return verdicts.reduce((a, b) => a + b, 0);
}

// Photo du stockage qui vient de s'afficher : le stockage est public, les autres photos du stockage notées illisibles
// sont réessayées (elles réapparaissent sans recharger la page)
export function stockageLisible(url, opts = {}) {
  if (!auStockage(url)) return Promise.resolve(0);
  if (dernierEchec) dernierEchec = null;
  return reverifierIllisibles([...illisibles()].filter(auStockage), opts);
}

// ── avant d'envoyer la photo d'un produit du CATALOGUE : le stockage est-il public ? ──
// product-upload-image (protégée, inchangée) écrit l'adresse dans la fiche du produit (elixir_products) AVANT toute
// vérification possible : une photo qui ne s'afficherait pas y remplacerait la sienne. La sonde ne dépend d'aucune photo
// existante : adresse d'un fichier qui n'existe pas (products/__sonde-<instant>.jpg) sous la base du stockage, lue par
// fetch : NoSuchKey → public, NoSuchBucket → privé. Base connue d'une adresse du stockage (dernier envoi de la session,
// photos de l'accueil, du catalogue, des mises en avant) ; aucune : "aucune" (envoyerEtVerifier envoie alors une image
// témoin de 1 × 1 sous la clé fixe « accueil-sonde », sans ligne au catalogue, puis vérifie qu'elle s'affiche).
// → "public" | "prive" | "panne" | "connexion" | "inconnu" | "aucune"
let dernierEchec = null, derniereAdresse = null;
export const noterEchecStockage = (url) => { if (auStockage(url)) dernierEchec = url; };
// tests : session sans aucune adresse du stockage connue
export const oublierAdressesConnues = () => { dernierEchec = null; derniereAdresse = null; };
export async function sonderStockage(candidats = [], { t = Date.now(), dev = DEV, ...opts } = {}) {
  const base = [dernierEchec, derniereAdresse, ...candidats].map(u => baseStockage(u, dev)).find(Boolean);
  if (!base) return "aucune";
  const d = await diagnostiquerStockage(`${base}products/__sonde-${t.toString(36)}.jpg`, opts);
  return d === "introuvable" ? "public" : d === "lisible" ? "inconnu" : d;
}
export const CLE_SONDE = "accueil-sonde";   // aucune ligne du catalogue n'a ce CIP : le PATCH de la fonction est sans effet
const PHOTO_SONDE = { base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", mimeType: "image/png" };
async function sonderParEnvoi(adminFetch, { t, ...opts }) {
  const url = await envoyerPhoto(adminFetch, CLE_SONDE, PHOTO_SONDE, t);   // envoi refusé : erreur (message français)
  derniereAdresse = url;
  const v = await verifierAffichage(url, opts);
  if (v === "ok") return "public";
  if (v === "delai") return "delai";
  if (v === "inconnu" || !auStockage(url)) return "inconnu";
  const d = await diagnostiquerStockage(url, opts);
  return ["prive", "panne", "connexion"].includes(d) ? d : "inconnu";
}
export const MESSAGE_STOCKAGE_PRIVE = "Rien n'a été envoyé : le stockage des photos (Supabase, « elixir-images ») n'est pas public, et cette photo deviendrait "
  + `aussi celle du produit au catalogue sans pouvoir s'y afficher. Faites d'abord le réglage dans Supabase (voir ${DOC_STOCKAGE}), puis ajoutez la photo.`;
// Refus avant l'envoi (produit du catalogue) selon l'état du stockage
export function messageAvantEnvoi(etat) {
  if (etat === "prive") return MESSAGE_STOCKAGE_PRIVE;
  if (etat === "panne") return "Rien n'a été envoyé : le stockage des photos est momentanément indisponible, et cette photo deviendrait aussi celle du produit au catalogue sans pouvoir s'y afficher. Réessayez dans quelques minutes.";
  if (etat === "connexion") return "Rien n'a été envoyé : connexion perdue pendant la vérification du stockage des photos. Vérifiez Internet, puis réessayez.";
  if (etat === "delai") return "Rien n'a été envoyé : la vérification du stockage des photos a pris trop de temps (connexion lente ?). Réessayez.";
  return "Rien n'a été envoyé : le stockage des photos n'a pas pu être vérifié, et cette photo deviendrait aussi celle du produit au catalogue. Réessayez dans quelques minutes.";
}

// ── envoi complet, partagé par les plus commandés (AdminAccueil) et les mises en avant (AdminVedettes) ──
// 1. produit du catalogue : stockage sondé AVANT l'envoi (refus : rien n'est envoyé) ; 2. envoi (product-upload-image) ;
// 3. l'adresse doit s'afficher dans le navigateur ; sinon, motif lu (diagnostiquerStockage), rien n'est publié, et pour un
// produit du catalogue son ancienne photo (autre fichier) lui est remise ; 4. produit du catalogue : adresse avec ?v= rangée
// dans sa fiche ; 5. publier(url) (brouillon ou réglages de l'accueil), seulement maintenant.
// → { url, publication } (publication : résultat de publier) ou { message, ton } (rien n'est publié). Jamais d'erreur.
// catalogue : null, ou { cip, ancienne } (photo du produit avant l'envoi) ; candidats : adresses connues (base du stockage) ;
// etape(message) : progression ; Img, fetch, delai : navigateur (remplacés par les tests).
export async function envoyerEtVerifier({ adminFetch, cle, prete, t = Date.now(), catalogue = null, candidats = [], publier = null, etape = () => {}, ...nav } = {}) {
  const opts = { Img: nav.Img ?? globalThis.Image, fetch: nav.fetch ?? globalThis.fetch, delai: nav.delai, enLigne: nav.enLigne };
  if (opts.delai === undefined) delete opts.delai;
  if (opts.enLigne === undefined) delete opts.enLigne;
  try {
    if (catalogue) {
      etape("Vérification du stockage des photos…");
      let etat = await sonderStockage(candidats, { t, dev: nav.dev ?? DEV, ...opts });
      if (etat === "aucune") etat = await sonderParEnvoi(adminFetch, { t, ...opts });
      if (etat !== "public") return { message: messageAvantEnvoi(etat), ton: "danger", etat };
    }
    etape("Envoi de la photo…");
    const url = await envoyerPhoto(adminFetch, cle, prete, t);
    if (auStockage(url)) derniereAdresse = url;
    etape("Vérification de l'affichage de la photo…");
    let verdict = await verifierAffichage(url, opts), diag = null;
    if (verdict === "illisible" && auStockage(url)) {
      diag = await diagnostiquerStockage(url, opts);
      // elle répond (erreur passagère du navigateur) : nouvel essai avec un ?v= neuf
      if (diag === "lisible") verdict = await verifierAffichage(avecVersion(url, t + 1), opts);
    }
    if (verdict !== "ok" && verdict !== "inconnu") {
      if (diag === "prive") noterEchecStockage(url);
      let restauree = false;
      const ancienne = catalogue?.ancienne;
      if (verdict === "illisible" && ancienne && sansVersion(ancienne) !== sansVersion(url)) restauree = await versionnerAuCatalogue(adminFetch, catalogue.cip, ancienne);
      return { message: messageNonAffichee(verdict, { url, catalogue: !!catalogue, diag, restauree }), ton: "danger", verdict, diag };
    }
    stockageLisible(url, opts);
    if (catalogue) await versionnerAuCatalogue(adminFetch, catalogue.cip, url);
    return { url, publication: publier ? await publier(url) : null };
  } catch (e) { return { message: e?.message || "Envoi impossible : réessayez.", ton: "danger" }; }
}
