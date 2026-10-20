// ── Notifications de l'appli Elixir (Web Push) : règles partagées navigateur + serveur (docs/notifications.md) ──
// JS pur, sans dépendance, importé par le site (carte, panneau, admin) et par les fonctions Netlify (_push.js), comme
// src/gp-pricing.js. Repère du lot « notifications » pour scripts/verifie-zones.mjs (LOTS).
// Contenu d'une notification : jamais de donnée patient (ordonnances, justificatifs), jamais de montant de facture ni de
// solde (l'écran verrouillé d'un téléphone est lisible par tous).

// Catégories qu'une pharmacie choisit (interrupteurs du panneau). Libellés et aides affichés tels quels.
export const CATEGORIES = [
  // « stock » : envoyée après l'e-mail « De retour en stock » des alertes retour (netlify/functions/_restock.js,
  // docs/notifications.md § 9.1) ; « commandes » : « bientôt » tant que la sortie d'entrepôt n'est pas branchée (§ 9.2)
  { id: "stock", libelle: "Retour en stock",
    aide: "Les produits pour lesquels vous avez cliqué «\u00a0M’avertir du retour\u00a0», dès leur retour en stock." },
  { id: "commandes", libelle: "Mes commandes",
    aide: "La sortie d'entrepôt de vos commandes (bientôt)." },
  { id: "offres", libelle: "Offres et nouveautés",
    aide: "Nos offres et nouveaux produits, 2 par semaine au plus." },
];
export const IDS_CATEGORIES = CATEGORIES.map((c) => c.id);
// à l'activation : les trois (les offres sont plafonnées par le serveur, PLAFOND_DEFAUT par 7 jours glissants)
export const CATEGORIES_DEFAUT = ["stock", "commandes", "offres"];
// catégories reçues → liste propre (inconnues retirées, sans doublon, dans l'ordre de CATEGORIES) ; null si illisible
export function filtrerCategories(v) {
  if (!Array.isArray(v)) return null;
  const vues = new Set(v.map(String));
  return IDS_CATEGORIES.filter((id) => vues.has(id));
}
// aide de la catégorie « offres » selon le plafond réglé dans l'admin (0 à PLAFOND_MAX par 7 jours glissants)
export const aideOffres = (plafond = PLAFOND_DEFAUT) => plafond > 0
  ? `Nos offres et nouveaux produits, ${plafond === 1 ? "1 par semaine" : `${plafond} par semaine`} au plus.`
  : "Nos offres et nouveaux produits (aucun envoi en ce moment).";
export const categoriesAffichees = (plafond = PLAFOND_DEFAUT) =>
  CATEGORIES.map((c) => (c.id === "offres" ? { ...c, aide: aideOffres(plafond) } : c));

// Annonces « Offres et nouveautés » de l'admin : bornes en caractères (points de code, comme char_length de Postgres)
export const LIMITES = { titre: 60, corps: 160 };
// au-delà, le titre peut être coupé sur Android (avertissement de l'admin)
export const TITRE_CONSEILLE = 40;
export const PLAFOND_DEFAUT = 2, PLAFOND_MAX = 7;
// ouverture aux pharmacies, décidée par Zineb dans l'admin : « fermee » (défaut : admins seulement), « pilote »
// (CIP choisis), « toutes »
export const OUVERTURES = ["fermee", "pilote", "toutes"];
export const REGLAGES_DEFAUT = { ouverture: "fermee", pilote_cips: [], plafond_offres_7j: PLAFOND_DEFAUT };
export const RE_CIP = /^\d{7,14}$/;
// CIP d'une pharmacie, nettoyé (espaces) ; null si absent ou illisible (« 0 », « false », lignes manuelles sans CIP…)
export const cipPropre = (v) => { const s = String(v ?? "").trim(); return RE_CIP.test(s) ? s : null; };

// Services push admis (anti-SSRF côté serveur, abonnement local périmé côté site) : https, hôtes de Google (FCM), Mozilla,
// Apple et Microsoft (WNS) seulement. Un hôte refusé est noté (admin → État du service) pour élargir la liste à bon escient.
export const HOTES_PUSH = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
// adresse d'abonnement (endpoint) chez un service push admis ? (https, sans port ni identifiants)
export function hotePushConnu(endpoint) {
  let u; try { u = new URL(String(endpoint || "")); } catch { return false; }
  return u.protocol === "https:" && !u.port && !u.username && !u.password && HOTES_PUSH.some((re) => re.test(u.hostname));
}

// Outils ouvrables par un lien (= OUTILS_LIEN d'App.jsx : ?outil=)
export const OUTILS_LIEN = ["saisie", "peremption", "fauteuil", "transfert", "groupees", "justificatif"];
export const LIBELLES_OUTILS = {
  saisie: "Saisie de commande", peremption: "Péremption courte", fauteuil: "Fauteuil roulant", transfert: "Fauteuil de transfert",
  groupees: "Commandes groupées", justificatif: "Commande labo sur justificatif",
};

// Lien d'une notification : chemin du site SEULEMENT (jamais une autre adresse). Admis :
//   /   ·   /?menu=<clé>   ·   /?outil=<outil>   ·   /?cip=<7 à 14 chiffres>   ·   /?notifications=1
// → chemin normalisé, ou null (refusé)
export function lienValide(url) {
  const s = String(url ?? "").trim();
  if (s === "/") return "/";
  const m = /^\/\?([a-z]+)=([^&#\s]*)$/.exec(s);
  if (!m) return null;
  const [, cle, valeur] = m;
  if (cle === "menu" && /^[A-Za-z0-9_-]{1,60}$/.test(valeur)) return `/?menu=${valeur}`;
  if (cle === "outil" && OUTILS_LIEN.includes(valeur)) return `/?outil=${valeur}`;
  if (cle === "cip" && RE_CIP.test(valeur)) return `/?cip=${valeur}`;
  if (cle === "notifications" && valeur === "1") return "/?notifications=1";
  return null;
}

// texte d'une notification : une ligne, sans caractère de contrôle, espaces resserrés
export const texteNet = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
export const longueur = (s) => [...String(s ?? "")].length;
export const couper = (s, n) => { const t = [...String(s ?? "")]; return t.length > n ? t.slice(0, n).join("") : String(s ?? ""); };

// Annonce de l'admin → { ok, erreurs: [texte], annonce: { titre, corps, url, audience, cips } }
export function verifierAnnonce(a = {}) {
  const erreurs = [];
  const titre = texteNet(a.titre), corps = texteNet(a.corps);
  if (!titre) erreurs.push("Le titre est vide.");
  else if (longueur(titre) > LIMITES.titre) erreurs.push(`Le titre dépasse ${LIMITES.titre} caractères.`);
  if (!corps) erreurs.push("Le texte est vide.");
  else if (longueur(corps) > LIMITES.corps) erreurs.push(`Le texte dépasse ${LIMITES.corps} caractères.`);
  const url = lienValide(a.url);
  if (!url) erreurs.push("Le lien n'est pas une page du site (accueil, menu, outil, produit).");
  const audience = a.audience === "liste" ? "liste" : a.audience === "toutes" || a.audience == null ? "toutes" : null;
  if (!audience) erreurs.push("Destinataires inconnus.");
  let cips = null;
  if (audience === "liste") {
    cips = [...new Set((Array.isArray(a.cips) ? a.cips : []).map((c) => String(c).trim()))];
    if (!cips.length) erreurs.push("Choisissez au moins une pharmacie.");
    else if (cips.some((c) => !RE_CIP.test(c))) erreurs.push("Un CIP de la liste est illisible (7 à 14 chiffres).");
    else if (cips.length > 500) erreurs.push("500 pharmacies au plus par annonce.");
  }
  return { ok: !erreurs.length, erreurs, annonce: { titre, corps, url, audience, cips } };
}

// Réglages de l'admin → { ok, erreurs, reglages } (validation stricte, côté serveur)
export function verifierReglages(r = {}) {
  const erreurs = [];
  const ouverture = OUVERTURES.includes(r.ouverture) ? r.ouverture : null;
  if (!ouverture) erreurs.push("Ouverture inconnue.");
  const cips = [...new Set((Array.isArray(r.pilote_cips) ? r.pilote_cips : []).map((c) => String(c).trim()).filter(Boolean))];
  if (cips.some((c) => !RE_CIP.test(c))) erreurs.push("Un CIP du pilote est illisible (7 à 14 chiffres).");
  if (cips.length > 200) erreurs.push("200 pharmacies au plus dans le pilote.");
  const plafond = Number(r.plafond_offres_7j);
  if (!Number.isInteger(plafond) || plafond < 0 || plafond > PLAFOND_MAX) erreurs.push(`Plafond des offres : un nombre entier de 0 à ${PLAFOND_MAX}.`);
  return { ok: !erreurs.length, erreurs, reglages: { ouverture, pilote_cips: cips, plafond_offres_7j: plafond } };
}

// Réglages lus en base (texte JSON) → valeurs sûres (défauts pour tout ce qui est illisible)
export function fusionnerReglages(v) {
  let o = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = {}; } }
  if (!o || typeof o !== "object") o = {};
  const plafond = Number(o.plafond_offres_7j);
  return {
    ouverture: OUVERTURES.includes(o.ouverture) ? o.ouverture : REGLAGES_DEFAUT.ouverture,
    pilote_cips: Array.isArray(o.pilote_cips) ? [...new Set(o.pilote_cips.map(String).filter((c) => RE_CIP.test(c)))] : [],
    plafond_offres_7j: Number.isInteger(plafond) && plafond >= 0 && plafond <= PLAFOND_MAX ? plafond : PLAFOND_DEFAUT,
  };
}

// La pharmacie (CIP du jeton) peut-elle s'abonner ? → null (oui) | "fermee" | "hors_pilote"
export function raisonOuverture(reglages, cip) {
  if (reglages.ouverture === "toutes") return null;
  if (reglages.ouverture === "pilote") return reglages.pilote_cips.includes(String(cip)) ? null : "hors_pilote";
  return "fermee";
}
