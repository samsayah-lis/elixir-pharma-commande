// ── Photos qui ne s'affichent pas (page d'accueil, aperçu et éditeur de l'admin) — JS pur, sans React ──
// Une photo dont le chargement échoue (onError d'une <img> : stockage des photos pas public — « Bucket not found » du
// 20/10/2026 —, photo retirée par son hébergeur, adresse erronée) est notée ICI, une fois par adresse et pour la vie de la
// page. La construction des vitrines (vedettes.js, resolution.js : ctx.illisibles) la traite alors exactement comme une
// photo absente : éventail refait avec les photos restantes du menu puis les cartes texte, produit → photo du catalogue
// ou de la banque d'images, puis boîte générée. Jamais de carte blanche ni d'icône d'image cassée ; jamais de boucle :
// une adresse notée n'est plus jamais demandée, et une adresse déjà notée ne prévient plus personne.
// Abonnement côté React : useIllisibles (outils.js). Adresse = celle des données (avant photo() et sa taille réduite).

const notees = new Set();
const abonnes = new Set();
let version = 0;

export const estIllisible = (url) => !!url && notees.has(url);
// l'adresse si elle peut s'afficher, sinon null (absente ou notée illisible)
export const lisible = (url) => (url && !notees.has(url) ? url : null);
export const versionIllisibles = () => version;
// ensemble en lecture (contexte des constructions : ctx.illisibles)
export const illisibles = () => notees;
export function noterIllisible(url) {
  if (!url || notees.has(url)) return false;
  notees.add(url);
  version++;
  abonnes.forEach(f => { try { f(version); } catch { /* abonné démonté */ } });
  return true;
}
export function abonnerIllisibles(f) { abonnes.add(f); return () => { abonnes.delete(f); }; }
// Adresse redevenue lisible (vérification de l'admin réussie après le réglage du stockage) : elle peut se montrer de nouveau
export function oublierIllisible(url) {
  if (!url || !notees.delete(url)) return false;
  version++;
  abonnes.forEach(f => { try { f(version); } catch { /* abonné démonté */ } });
  return true;
}
