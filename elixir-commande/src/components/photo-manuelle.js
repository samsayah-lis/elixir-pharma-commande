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
// « Bucket not found », carte de devant blanche sur l'accueil malgré « ✓ Photo ajoutée ») : l'adresse renvoyée doit
// s'afficher dans le navigateur (new Image(), sans CORS) AVANT tout message de réussite ; sinon rien n'est mis dans le
// brouillon ni publié, et le message dit pourquoi (réglage du stockage, docs/accueil.md). Photos déjà choisies : contrôlées
// de même, notées illisibles (accueil/illisibles.js, partagé avec l'aperçu) : « Photo illisible » dans l'admin.

import { estIllisible, illisibles, noterIllisible, oublierIllisible } from "./accueil/illisibles.js";

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
// n'est pas modifié) et nouvelle à chaque envoi (la version en ligne garde son fichier jusqu'à « Publier »)
export function cleMiseEnAvant(it, t = Date.now()) {
  const objet = it?.type === "menu" ? `menu-${String(it.menu_id ?? "").replace(/[^\w-]/g, "").slice(0, 40)}` : String(it?.cip ?? "").replace(/\D/g, "").slice(0, 14);
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
// Pourquoi une photo ne s'affiche pas (court, après « Photo illisible : »)
export const raisonIllisible = (url) => (auStockage(url)
  ? `le stockage des photos (Supabase, « elixir-images ») n'est pas public — réglage à faire une seule fois dans Supabase, voir ${DOC_STOCKAGE}`
  : "l'adresse ne donne plus d'image (photo retirée par son hébergeur, ou adresse erronée)");

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

// Message après un envoi dont l'adresse ne s'affiche pas (verdict de verifierAffichage) ; null si elle s'affiche.
// catalogue : produit du catalogue, dont la fiche a déjà reçu l'adresse (product-upload-image l'y range d'office).
export function messageNonAffichee(verdict, { url, catalogue = false } = {}) {
  if (verdict === "ok" || verdict === "inconnu") return null;
  const rien = " Rien n'a changé sur l'accueil.";
  if (verdict === "delai") {
    return `Photo reçue, mais elle ne s'est pas affichée en ${DELAI_AFFICHAGE / 1000} secondes (connexion lente ?) : ajoutez-la de nouveau.${rien}`
      + (catalogue ? " La fiche du produit au catalogue, elle, a déjà reçu cette photo." : "");
  }
  if (!auStockage(url)) return `Photo reçue, mais l'adresse renvoyée ne donne pas d'image : ajoutez-la de nouveau.${rien}`;
  return "Photo reçue, mais le site ne peut pas l'afficher : le stockage des photos (Supabase, « elixir-images ») n'est pas public. "
    + `C'est un réglage à faire une seule fois dans Supabase (voir ${DOC_STOCKAGE}) ; une fois fait, ajoutez de nouveau la photo.${rien}`
    + (catalogue ? " La fiche du produit au catalogue a déjà reçu cette adresse (la fonction d'envoi l'y range d'office) : la photo y apparaîtra d'elle-même une fois le réglage fait." : "");
}

// Photos déjà choisies (brouillon, version en ligne, réglages de l'accueil) : contrôlées une fois par adresse ; illisible
// → notée (illisibles.js : « Photo illisible » dans l'admin, aperçu sans elle, avertissement à « Publier »).
// variante : adresse réellement chargée (miniature de la banque d'images : photo(url, "thumbnail")), l'adresse elle-même sinon.
const controles = new Map();   // adresse → Promise<verdict>
export function controlerAffichage(url, { variante = url, ...opts } = {}) {
  if (!url) return Promise.resolve("inconnu");
  if (!controles.has(url)) {
    controles.set(url, verifierAffichage(variante, opts).then(v => { if (v === "illisible") noterIllisible(url); return v; }));
  }
  return controles.get(url);
}
// Nouvel essai des photos notées illisibles (après le réglage du stockage, sans recharger la page) : une adresse du stockage
// est redemandée avec un ?v= neuf (jamais une réponse d'erreur gardée en cache) ; affichée → oubliée, elle se montre de
// nouveau partout. → nombre d'adresses redevenues lisibles.
export async function reverifierIllisibles(urls = [...illisibles()], opts = {}) {
  const t = opts.t ?? Date.now();
  const verdicts = await Promise.all(urls.filter(estIllisible).map(async (u) => {
    const v = await verifierAffichage(auStockage(u) ? avecVersion(u, t) : u, opts);
    if (v === "ok") { oublierIllisible(u); controles.delete(u); return 1; }
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

// Avant d'envoyer la photo d'un produit du CATALOGUE (product-upload-image écrit son adresse dans la fiche du produit
// avant toute vérification possible) : le stockage est-il lisible ? Sonde = une photo du stockage qui existe (dernier envoi
// non affiché de cette session, photos envoyées d'ici et publiées), redemandée avec un ?v= neuf.
// → "public" | "prive" | "inconnu" (aucune photo du stockage connue : l'envoi se fait, vérifié ensuite).
let dernierEchec = null;
export const noterEchecStockage = (url) => { if (auStockage(url)) dernierEchec = url; };
export async function sonderStockage(candidats = [], opts = {}) {
  const sonde = [dernierEchec, ...candidats].find(auStockage);
  if (!sonde) return "inconnu";
  const v = await verifierAffichage(avecVersion(sonde, opts.t ?? Date.now()), opts);
  if (v === "ok") { if (sonde === dernierEchec) dernierEchec = null; oublierIllisible(sonde); controles.delete(sonde); return "public"; }
  return v === "illisible" ? "prive" : "inconnu";
}
export const MESSAGE_STOCKAGE_PRIVE = "Rien n'a été envoyé : le stockage des photos (Supabase, « elixir-images ») n'est pas public, et cette photo deviendrait "
  + `aussi celle du produit au catalogue sans pouvoir s'y afficher. Faites d'abord le réglage dans Supabase (voir ${DOC_STOCKAGE}), puis ajoutez la photo.`;
