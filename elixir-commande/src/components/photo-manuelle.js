// ── Admin, page d'accueil : photo ajoutée à la main (« Ajouter une photo », demande de Zineb du 20/10/2026) ──
// Une photo choisie sur l'ordinateur (JPG, PNG ou WebP, 15 Mo au plus) est réduite dans le navigateur (900 px au plus sur
// le grand côté, qualité 0,85 ; PNG ou WebP : transparence gardée ; JPG toujours réencodé : ses métadonnées, lieu de prise
// de vue compris, ne partent pas), puis envoyée par product-upload-image, la fonction de l'admin du catalogue (inchangée) :
// Storage elixir-images/products/<clé>.<ext> (écrasé s'il existe), puis image_url des lignes du catalogue
// (elixir_products) dont le CIP est cette clé, s'il y en a. L'adresse renvoyée reçoit ?v=<instant> : une photo remplacée
// (même fichier) se montre tout de suite, sans attendre la fin du cache des navigateurs ; pour un produit du catalogue,
// un second appel (image_url, sans fichier) y range aussi cette adresse (le site préfère la photo du catalogue).
// Parties pures (contrôle du fichier, dimensions, adresse, clés, dosages visés, menus) : scripts/test-photo-manuelle.mjs.

export const TYPES = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP" };
export const MAX_OCTETS = 15 * 1024 * 1024;
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
const RE_HTTPS = /^https:\/\/[^\s"'()<>\\]+$/;
// banc d'essai local (npm run dev) seulement : la fausse fonction range la photo sur le banc et renvoie une adresse locale
// (scripts/banc/plugin.mjs) ; jamais en production
const RE_LOCALE = /^\/banc-photos\/[^\s"'()<>\\]+$/;
const DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
const mo = (n) => `${(n / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

// Type du fichier : type déclaré par le navigateur, sinon (type vide) l'extension ; null : pas une photo prise en charge
export function typeDuFichier(f) {
  const t = String(f?.type || "").toLowerCase();
  if (TYPES[t]) return t;
  if (t && t !== "application/octet-stream") return null;
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
const sansRequete = (url) => String(url || "").split(/[?#]/)[0];
// Photo du catalogue posée d'ici : même fichier que la photo envoyée de l'accueil (display_config.accueil.photos)
export const poseeIci = (urlCatalogue, urlIci) => !!urlCatalogue && estPhotoEnvoyee(urlIci) && sansRequete(urlCatalogue) === sansRequete(urlIci);

// Clé d'une mise en avant (éditeur) : « accueil-… », jamais un CIP (le catalogue n'est pas modifié) et nouvelle à chaque
// envoi (la version en ligne garde son fichier jusqu'à « Publier »)
export function cleMiseEnAvant(it, t = Date.now()) {
  const objet = it?.type === "menu" ? `menu-${String(it.menu_id ?? "").replace(/[^\w-]/g, "").slice(0, 40)}` : String(it?.cip ?? "").replace(/\D/g, "").slice(0, 14);
  return `accueil-${objet}-${t.toString(36)}`;
}

// Dosages d'une ligne des plus commandés qui reçoivent la photo : le dosage montré, toujours ; chaque autre dosage sans
// photo au catalogue, sauf s'il a ici sa propre photo de la banque d'images ; chaque dosage dont la photo du catalogue a
// été posée d'ici (remplacée avec la famille). Une photo du catalogue venue d'ailleurs (fiche produit) est gardée.
export function ciblesFamille(s, photos = {}) {
  const vus = new Set(), out = [];
  for (const o of [s, ...(s?.variantes || [])]) {
    if (!o?.cip || vus.has(o.cip)) continue;
    vus.add(o.cip);
    const ici = photos[o.cip];
    if (o.cip === s.cip || (o.image_url ? poseeIci(o.image_url, ici) : !ici || estPhotoEnvoyee(ici))) out.push(o.cip);
  }
  return out;
}

// Où la photo envoyée se voit, pour le message : menus du catalogue concernés (avec ou sans photos)
// membres : dosages visés (objets du GET accueil-offres, avec leur menu)
export function portee(membres) {
  const cat = (membres || []).filter(auCatalogue);
  return {
    catalogue: cat.length > 0,
    menus: [...new Set(cat.filter(o => MENUS_AVEC_PHOTOS.includes(o.menu.key)).map(o => o.menu.label).filter(Boolean))],
  };
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
    const { largeur, hauteur, reduite } = dimensions(d.largeur, d.hauteur);
    const canvas = document.createElement("canvas");
    canvas.width = largeur; canvas.height = hauteur;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(d.source, 0, 0, largeur, hauteur);
    // JPG → JPG ; PNG ou WebP (transparence possible) → WebP, ou PNG si le navigateur ne sait pas écrire le WebP
    let blob = null;
    if (type === "image/jpeg") blob = await versBlob(canvas, "image/jpeg", QUALITE);
    else {
      blob = await versBlob(canvas, "image/webp", QUALITE);
      if (!blob || blob.type !== "image/webp") blob = await versBlob(canvas, "image/png");
    }
    if (!blob || !TYPES[blob.type]) throw new Error("Réduction de la photo impossible dans ce navigateur : essayez avec Chrome.");
    // PNG ou WebP déjà assez petit et plus léger tel quel : envoyé sans changement (JPG : toujours réencodé, sans métadonnées)
    const final = !reduite && type !== "image/jpeg" && fichier.size <= blob.size ? fichier : blob;
    return { base64: await enBase64(final), mimeType: final === fichier ? type : blob.type, largeur, hauteur, octets: final.size };
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
