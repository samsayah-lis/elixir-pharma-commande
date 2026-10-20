// ── Photos qui ne s'affichent pas (page d'accueil, aperçu et éditeur de l'admin) — JS pur, sans React ──
// Une photo dont le chargement échoue (onError d'une <img>, après l'essai de l'original pour une taille réduite :
// outils.js, surErreurPhoto ; stockage des photos pas public — « Bucket not found » du 20/10/2026 —, photo retirée par son
// hébergeur, adresse erronée, coupure réseau, hébergeur en panne) est notée ICI, une fois par adresse. La construction des
// vitrines (vedettes.js, resolution.js : ctx.illisibles) la traite alors exactement comme une photo absente : éventail refait
// avec les photos restantes du menu puis les cartes texte, produit → photo du catalogue ou de la banque d'images, puis boîte
// générée. Jamais de carte blanche ni d'icône d'image cassée ; jamais de boucle : une adresse notée n'est plus demandée par
// la page, et une adresse déjà notée ne prévient plus personne.
// Erreur passagère (Wi-Fi qui décroche, hébergeur qui répond 502 une fois, stockage rendu public pendant que la page est
// ouverte) : nouvel essai HORS de la page (new Image(), sans toucher au DOM, donc sans clignotement) 3 s, 30 s, 5 min puis
// 15 min après ; affichée → oubliée, la photo revient (déjà en cache). 4 essais au plus par adresse pour toute la vie de la
// page (aucune boucle même si elle échoue de nouveau dans la page) ; hors ligne, rien n'est tenté : le retour du réseau
// (« online ») relance aussitôt, le retour sur l'onglet aussi (une fois par minute au plus et par adresse).
// Notifications regroupées : la liste est à jour tout de suite (estIllisible, lu au rendu), les abonnés sont prévenus une
// fois par image affichée (requestAnimationFrame ; onglet caché : setTimeout), quel que soit le nombre d'adresses notées.
// Abonnement côté React : useIllisibles (outils.js). Adresse = celle des données (avant photo() et sa taille réduite).

const notees = new Set();
const motifs = new Map();    // adresse notée → motif (admin : diagnostic du stockage, photo-manuelle.js)
const essais = new Map();    // adresse → { n, minuteur, dernier, enCours } ; n jamais remis à zéro (aucune boucle)
const abonnes = new Set();
let version = 0, prevu = false, ecoute = false;

export const DELAIS_ESSAIS = [3e3, 30e3, 300e3, 900e3];   // 4 essais au plus
const RELANCE_MIN = 60e3;    // retour sur l'onglet : un essai de plus au plus par minute et par adresse
const GARDE = 20e3;          // essai sans réponse : compté comme un échec

// environnement (remplacé par les tests : fausse Image, faux minuteurs, faux réseau)
const defaut = () => ({
  Img: () => globalThis.Image,
  enLigne: () => typeof navigator === "undefined" || navigator.onLine !== false,
  maintenant: () => Date.now(),
  minuteur: (f, ms) => setTimeout(f, ms),
  arret: (t) => clearTimeout(t),
  planifier: (f) => {
    const visible = typeof document === "undefined" || !document.hidden;
    if (visible && typeof requestAnimationFrame === "function") requestAnimationFrame(f); else setTimeout(f, 0);
  },
});
let env = defaut();
export function reglerIllisibles(o = null) { env = o ? { ...defaut(), ...o } : defaut(); }

export const estIllisible = (url) => !!url && notees.has(url);
// l'adresse si elle peut s'afficher, sinon null (absente ou notée illisible)
export const lisible = (url) => (url && !notees.has(url) ? url : null);
export const versionIllisibles = () => version;
// ensemble en lecture (contexte des constructions : ctx.illisibles)
export const illisibles = () => notees;
export const motifIllisible = (url) => motifs.get(url) || null;
export function abonnerIllisibles(f) { abonnes.add(f); return () => { abonnes.delete(f); }; }

function prevenir() {
  if (prevu) return;
  prevu = true;
  env.planifier(() => {
    prevu = false;
    version++;
    abonnes.forEach(f => { try { f(version); } catch { /* abonné démonté */ } });
  });
}

export function noterIllisible(url, motif = null) {
  if (!url || notees.has(url)) return false;
  notees.add(url);
  if (motif) motifs.set(url, motif);
  ecouter();
  planifierEssai(url);
  prevenir();
  return true;
}
// Motif précisé après coup (diagnostic de l'admin) : redessine seulement s'il change
export function preciserMotif(url, motif) {
  if (!notees.has(url) || !motif || motifs.get(url) === motif) return false;
  motifs.set(url, motif);
  prevenir();
  return true;
}
// Adresse redevenue lisible (nouvel essai réussi, « Vérifier de nouveau » de l'admin) : elle peut se montrer de nouveau
export function oublierIllisible(url) {
  if (!url || !notees.delete(url)) return false;
  motifs.delete(url);
  const e = essais.get(url);
  if (e?.minuteur) { env.arret(e.minuteur); e.minuteur = 0; }
  prevenir();
  return true;
}

// ── nouveaux essais ──
function planifierEssai(url) {
  const e = essais.get(url) || { n: 0, minuteur: 0, dernier: 0, enCours: false };
  essais.set(url, e);
  if (e.minuteur || e.enCours || e.n >= DELAIS_ESSAIS.length || typeof env.Img() !== "function" || !env.enLigne()) return;
  e.minuteur = env.minuteur(() => { e.minuteur = 0; essayer(url); }, DELAIS_ESSAIS[e.n]);
}
function essayer(url) {
  const e = essais.get(url), Img = env.Img();
  if (!e || e.enCours || !notees.has(url) || typeof Img !== "function") return;
  e.n++; e.dernier = env.maintenant(); e.enCours = true;
  let img = null, garde = 0;
  const fin = (ok) => {
    if (!e.enCours) return;
    e.enCours = false; env.arret(garde);
    if (img) { img.onload = null; img.onerror = null; }
    if (ok) oublierIllisible(url); else planifierEssai(url);
  };
  try {
    img = new Img();
    garde = env.minuteur(() => fin(false), GARDE);
    img.onload = () => fin(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => fin(false);
    img.src = url;
  } catch { fin(false); }
}
// Réseau revenu (« online ») : essai immédiat de chaque adresse notée ; retour sur l'onglet (« visible ») : de même, sauf
// celles essayées il y a moins d'une minute. Une adresse dont les 4 essais ont échoué reçoit cet essai de plus, sans suite.
export function relancerIllisibles(raison = "online") {
  const t = env.maintenant();
  for (const url of [...notees]) {
    const e = essais.get(url);
    if (!e || e.enCours || (raison !== "online" && e.dernier && t - e.dernier < RELANCE_MIN)) continue;
    if (e.minuteur) { env.arret(e.minuteur); e.minuteur = 0; }
    essayer(url);
  }
}
function ecouter() {
  if (ecoute || typeof window === "undefined" || typeof document === "undefined") return;
  ecoute = true;
  window.addEventListener("online", () => relancerIllisibles("online"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) relancerIllisibles("visible"); });
}
