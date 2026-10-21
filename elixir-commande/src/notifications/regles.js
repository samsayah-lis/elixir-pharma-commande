// ── Notifications de l'appli Elixir (Web Push) : règles partagées navigateur + serveur (docs/notifications.md) ──
// JS pur, sans dépendance, importé par le site (carte, panneau, admin) et par les fonctions Netlify (_push.js), comme
// src/gp-pricing.js. Repère du lot « notifications » pour scripts/verifie-zones.mjs (LOTS).
// Contenu d'une notification : jamais de donnée patient (ordonnances, justificatifs), jamais de montant de facture ni de
// solde (l'écran verrouillé d'un téléphone est lisible par tous).

// Catégories qu'une pharmacie choisit (interrupteurs du panneau). Libellés et aides affichés tels quels.
// Identifiants stables (enregistrés dans push_abonnements.categories) : « commandes » garde son identifiant depuis qu'il
// s'appelle « Mes commandes et réclamations » (aucune donnée à migrer) ; « infos » est nouvelle (sql/push-messages.sql,
// docs/notifications.md § 4).
export const CATEGORIES = [
  // « stock » : envoyée après l'e-mail « De retour en stock » des alertes retour (netlify/functions/_restock.js,
  // docs/notifications.md § 9.1)
  { id: "stock", libelle: "Retour en stock",
    aide: "Les produits pour lesquels vous avez cliqué «\u00a0M’avertir du retour\u00a0», dès leur retour en stock." },
  // « commandes » : messages « Réclamation / SAV » et « Commande » de l'admin, et l'outil entrepôt (push-evenement.js)
  { id: "commandes", libelle: "Mes commandes et réclamations",
    aide: "Le suivi de vos commandes et de vos réclamations\u00a0: expédition, reliquat, retour, avoir." },
  // « infos » : messages « Communication » de l'admin (plafonnés comme les offres)
  { id: "infos", libelle: "Informations Elixir",
    aide: "Fermetures exceptionnelles, changements de service, nouveautés du site\u00a0: 2 par semaine au plus." },
  { id: "offres", libelle: "Offres et nouveautés",
    aide: "Nos offres et nouveaux produits, 2 par semaine au plus." },
];
export const IDS_CATEGORIES = CATEGORIES.map((c) => c.id);
// à l'activation : toutes (offres et informations plafonnées par le serveur, par 7 jours glissants)
export const CATEGORIES_DEFAUT = ["stock", "commandes", "infos", "offres"];
// catégories reçues → liste propre (inconnues retirées, sans doublon, dans l'ordre de CATEGORIES) ; null si illisible
export function filtrerCategories(v) {
  if (!Array.isArray(v)) return null;
  const vues = new Set(v.map(String));
  return IDS_CATEGORIES.filter((id) => vues.has(id));
}
const parSemaine = (n) => (n === 1 ? "1 par semaine" : `${n} par semaine`);
// aide des catégories plafonnées selon le plafond réglé dans l'admin (0 à PLAFOND_MAX par 7 jours glissants)
export const aideOffres = (plafond = PLAFOND_DEFAUT) => plafond > 0
  ? `Nos offres et nouveaux produits, ${parSemaine(plafond)} au plus.`
  : "Nos offres et nouveaux produits (aucun envoi en ce moment).";
export const aideInfos = (plafond = PLAFOND_INFOS_DEFAUT) => plafond > 0
  ? `Fermetures exceptionnelles, changements de service, nouveautés du site\u00a0: ${parSemaine(plafond)} au plus.`
  : "Fermetures exceptionnelles, changements de service, nouveautés du site (aucun envoi en ce moment).";
export const categoriesAffichees = (plafond = PLAFOND_DEFAUT, plafondInfos = PLAFOND_INFOS_DEFAUT) =>
  CATEGORIES.map((c) => (c.id === "offres" ? { ...c, aide: aideOffres(plafond) } : c.id === "infos" ? { ...c, aide: aideInfos(plafondInfos) } : c));

// ── Types de message de l'admin (docs/notifications.md § 4) : chacun arrive dans une catégorie que la pharmacie choisit ──
//  • promotion, communication : plafonnés par pharmacie (7 jours glissants), une, plusieurs ou toutes les pharmacies ;
//  • reclamation, commande (transactionnels) : hors plafonds marketing, plafond de sécurité par pharmacie sur 24 h, une ou
//    quelques pharmacies choisies seulement (jamais « toutes »), aucun montant (écran verrouillé).
export const TYPES_MESSAGE = {
  promotion: { libelle: "Promotion", categorie: "offres", transactionnel: false },
  communication: { libelle: "Communication", categorie: "infos", transactionnel: false },
  reclamation: { libelle: "Réclamation / SAV", categorie: "commandes", transactionnel: true },
  commande: { libelle: "Commande", categorie: "commandes", transactionnel: true },
};
export const IDS_TYPES = Object.keys(TYPES_MESSAGE);
export const categorieDuType = (type) => TYPES_MESSAGE[type]?.categorie || null;
export const estTransactionnel = (type) => !!TYPES_MESSAGE[type]?.transactionnel;
// destinataires : « une » pharmacie, une « liste » (plusieurs), « toutes » les pharmacies abonnées
export const AUDIENCES = ["une", "liste", "toutes"];
export const MAX_LISTE = 500, MAX_LISTE_TRANSACTIONNEL = 20;
// programmation : au plus tôt dans 5 minutes, au plus tard dans 60 jours ; un message dû depuis plus de 3 h n'est plus envoyé
export const PROGRAMME_MIN_MS = 5 * 60e3, PROGRAMME_MAX_JOURS = 60, PROGRAMME_RETARD_MAX_MS = 3 * 3600e3;

// Annonces « Offres et nouveautés » de l'admin : bornes en caractères (points de code, comme char_length de Postgres)
export const LIMITES = { titre: 60, corps: 160 };
// au-delà, le titre peut être coupé sur Android (avertissement de l'admin)
export const TITRE_CONSEILLE = 40;
export const PLAFOND_DEFAUT = 2, PLAFOND_MAX = 7;
// « Informations Elixir » : plafond à part (même échelle que les offres)
export const PLAFOND_INFOS_DEFAUT = 2;
// « Mes commandes et réclamations » : plafond de SÉCURITÉ par pharmacie sur 24 h glissantes (outil entrepôt emballé,
// double saisie…), hors plafonds marketing
export const PLAFOND_COMMANDES_DEFAUT = 10, PLAFOND_COMMANDES_MAX = 50;
// ouverture aux pharmacies, décidée par Zineb dans l'admin : « fermee » (défaut : admins seulement), « pilote »
// (CIP choisis), « toutes »
export const OUVERTURES = ["fermee", "pilote", "toutes"];
export const REGLAGES_DEFAUT = { ouverture: "fermee", pilote_cips: [], plafond_offres_7j: PLAFOND_DEFAUT, plafond_infos_7j: PLAFOND_INFOS_DEFAUT,
  plafond_commandes_jour: PLAFOND_COMMANDES_DEFAUT };
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
//   /   ·   /?menu=<clé>   ·   /?outil=<outil>   ·   /?cip=<7 à 14 chiffres>   ·   /?notifications=1   ·   /?commandes=1
//   (« Mes commandes » de la pharmacie, App.jsx)
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
  if (cle === "commandes" && valeur === "1") return "/?commandes=1";
  return null;
}

// texte d'une notification : une ligne, sans caractère de contrôle, espaces resserrés
export const texteNet = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
export const longueur = (s) => [...String(s ?? "")].length;
export const couper = (s, n) => { const t = [...String(s ?? "")]; return t.length > n ? t.slice(0, n).join("") : String(s ?? ""); };

// Montant en euros (« 12,50 € », « 30 euros ») : interdit dans les messages transactionnels (avoir, réclamation, commande),
// lisibles sur l'écran verrouillé ; les prix d'une promotion restent admis
export const contientMontant = (s) => /€|\d\s*(?:[.,]\d{1,2})?\s*eur(?:os?)?\b/i.test(String(s ?? ""));
// Champ de modèle pas encore rempli : « [référence] », « [n° de commande] », « [date] » (minuscules entre crochets ;
// « [NOUVEAU] » reste admis)
export const champsACompleter = (s) => String(s ?? "").match(/\[[a-zà-ÿœæ°'’ .-]{2,40}\]/gu) || [];

// Message de l'admin → { ok, erreurs: [texte], message: { type, categorie, titre, corps, url, audience, cips, repli_email,
// programme_pour } } — programme_pour : contrôlé à part (verifierProgrammation, avec l'heure du serveur)
export function verifierMessage(m = {}) {
  const erreurs = [];
  const type = m.type == null ? "promotion" : TYPES_MESSAGE[m.type] ? m.type : null;
  if (!type) erreurs.push("Type de message inconnu.");
  const transactionnel = estTransactionnel(type);
  const titre = texteNet(m.titre), corps = texteNet(m.corps);
  if (!titre) erreurs.push("Le titre est vide.");
  else if (longueur(titre) > LIMITES.titre) erreurs.push(`Le titre dépasse ${LIMITES.titre} caractères.`);
  if (!corps) erreurs.push("Le texte est vide.");
  else if (longueur(corps) > LIMITES.corps) erreurs.push(`Le texte dépasse ${LIMITES.corps} caractères.`);
  const url = lienValide(m.url);
  if (!url) erreurs.push("Le lien n'est pas une page du site (accueil, menu, outil, produit, Mes commandes).");
  if (champsACompleter(`${titre} ${corps}`).length) erreurs.push(`Remplacez les champs entre crochets avant l'envoi\u00a0: ${champsACompleter(`${titre} ${corps}`).join(", ")}.`);
  if (transactionnel && contientMontant(`${titre} ${corps}`)) erreurs.push("Aucun montant dans un message «\u00a0Réclamation / SAV\u00a0» ou «\u00a0Commande\u00a0»\u00a0: il s'affiche sur l'écran verrouillé.");
  const audience = m.audience == null ? "toutes" : AUDIENCES.includes(m.audience) ? m.audience : null;
  if (!audience) erreurs.push("Destinataires inconnus.");
  else if (audience === "toutes" && transactionnel) erreurs.push("Réclamation / SAV et Commande\u00a0: une ou quelques pharmacies choisies, jamais toutes.");
  let cips = null;
  if (audience === "une" || audience === "liste") {
    cips = [...new Set((Array.isArray(m.cips) ? m.cips : []).map((c) => String(c).trim()))];
    const max = audience === "une" ? 1 : transactionnel ? MAX_LISTE_TRANSACTIONNEL : MAX_LISTE;
    if (!cips.length) erreurs.push("Choisissez au moins une pharmacie.");
    else if (cips.some((c) => !RE_CIP.test(c))) erreurs.push("Un CIP de la liste est illisible (7 à 14 chiffres).");
    else if (cips.length > max) erreurs.push(audience === "une" ? "Une seule pharmacie pour un message unitaire." : `${max} pharmacies au plus${transactionnel ? " pour ce type de message" : " par message"}.`);
  }
  // e-mail de secours : message unitaire seulement
  const repli_email = audience === "une" && m.repli_email === true;
  const programme_pour = m.programme_pour == null || m.programme_pour === "" ? null : String(m.programme_pour);
  return { ok: !erreurs.length, erreurs, message: { type, categorie: categorieDuType(type), titre, corps, url, audience, cips, repli_email, programme_pour } };
}

// Annonce « Offres et nouveautés » (forme d'avant les types) → { ok, erreurs, annonce: { titre, corps, url, audience, cips } }
export function verifierAnnonce(a = {}) {
  const v = verifierMessage({ ...a, type: "promotion", audience: a.audience === "liste" ? "liste" : a.audience == null || a.audience === "toutes" ? "toutes" : "inconnue" });
  const { titre, corps, url, audience, cips } = v.message;
  return { ok: v.ok, erreurs: v.erreurs, annonce: { titre, corps, url, audience, cips } };
}

// Date de programmation (ISO, UTC) → { ok, erreurs, iso } : au plus tôt dans 5 minutes, au plus tard dans 60 jours
export function verifierProgrammation(valeur, maintenant = Date.now()) {
  const t = Date.parse(String(valeur ?? ""));
  if (!Number.isFinite(t)) return { ok: false, erreurs: ["Date de programmation illisible."], iso: null };
  if (t < maintenant + PROGRAMME_MIN_MS - 30e3) return { ok: false, erreurs: ["Programmez au moins 5 minutes à l'avance (sinon, envoyez maintenant)."], iso: null };
  if (t > maintenant + PROGRAMME_MAX_JOURS * 86400e3) return { ok: false, erreurs: [`Programmez au plus ${PROGRAMME_MAX_JOURS} jours à l'avance.`], iso: null };
  return { ok: true, erreurs: [], iso: new Date(t).toISOString() };
}

// ── Heure de Paris (programmation, confirmations du soir et du dimanche) ──
const FORMAT_PARIS = (() => { try { return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" }); } catch { return null; } })();
// instant (ms ou Date) → { annee, mois, jour, heure, minute, jourSemaine } à Paris
export function partiesParis(t = Date.now()) {
  const p = Object.fromEntries(FORMAT_PARIS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { annee: Number(p.year), mois: Number(p.month), jour: Number(p.day), heure: Number(p.hour) % 24, minute: Number(p.minute), jourSemaine: p.weekday };
}
// « 2026-10-22T08:30 » (champ date et heure, heure de Paris) → ISO UTC ; null si illisible ou inexistante (passage à l'heure d'été)
export function parisVersIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local ?? ""));
  if (!m) return null;
  const [a, mo, j, h, mi] = m.slice(1).map(Number);
  const voulu = Date.UTC(a, mo - 1, j, h, mi);
  const decalage = (t) => { const p = partiesParis(t); return Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute) - t; };
  let t = voulu - decalage(voulu);
  t = voulu - decalage(t);
  const p = partiesParis(t);
  if (p.annee !== a || p.mois !== mo || p.jour !== j || p.heure !== h || p.minute !== mi) return null;
  return new Date(t).toISOString();
}
// ISO → « 2026-10-22T08:30 » (heure de Paris), pour un champ date et heure
export function isoVersParis(iso) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const p = partiesParis(t), d = (n) => String(n).padStart(2, "0");
  return `${p.annee}-${d(p.mois)}-${d(p.jour)}T${d(p.heure)}:${d(p.minute)}`;
}
// avant 8 h, après 20 h ou le dimanche (heure de Paris) : l'admin demande une confirmation de plus
export function horsHeures(t = Date.now()) {
  const p = partiesParis(t);
  return p.heure < 8 || p.heure >= 20 || p.jourSemaine === "dimanche";
}
export const texteHeureParis = (t = Date.now()) => { const p = partiesParis(t); return `${String(p.heure).padStart(2, "0")}\u00a0h\u00a0${String(p.minute).padStart(2, "0")}`; };

// Réglages de l'admin → { ok, erreurs, reglages } (validation stricte, côté serveur) ; plafonds des informations et de
// sécurité absents (page d'avant les types) : valeurs par défaut
export function verifierReglages(r = {}) {
  const erreurs = [];
  const ouverture = OUVERTURES.includes(r.ouverture) ? r.ouverture : null;
  if (!ouverture) erreurs.push("Ouverture inconnue.");
  const cips = [...new Set((Array.isArray(r.pilote_cips) ? r.pilote_cips : []).map((c) => String(c).trim()).filter(Boolean))];
  if (cips.some((c) => !RE_CIP.test(c))) erreurs.push("Un CIP du pilote est illisible (7 à 14 chiffres).");
  if (cips.length > 200) erreurs.push("200 pharmacies au plus dans le pilote.");
  const plafond = Number(r.plafond_offres_7j);
  if (!Number.isInteger(plafond) || plafond < 0 || plafond > PLAFOND_MAX) erreurs.push(`Plafond des offres : un nombre entier de 0 à ${PLAFOND_MAX}.`);
  const infos = r.plafond_infos_7j == null ? PLAFOND_INFOS_DEFAUT : Number(r.plafond_infos_7j);
  if (!Number.isInteger(infos) || infos < 0 || infos > PLAFOND_MAX) erreurs.push(`Plafond des informations : un nombre entier de 0 à ${PLAFOND_MAX}.`);
  const commandes = r.plafond_commandes_jour == null ? PLAFOND_COMMANDES_DEFAUT : Number(r.plafond_commandes_jour);
  if (!Number.isInteger(commandes) || commandes < 1 || commandes > PLAFOND_COMMANDES_MAX) erreurs.push(`Plafond de sécurité des commandes et réclamations : un nombre entier de 1 à ${PLAFOND_COMMANDES_MAX}.`);
  return { ok: !erreurs.length, erreurs, reglages: { ouverture, pilote_cips: cips, plafond_offres_7j: plafond, plafond_infos_7j: infos, plafond_commandes_jour: commandes } };
}

// Réglages lus en base (texte JSON) → valeurs sûres (défauts pour tout ce qui est illisible)
export function fusionnerReglages(v) {
  let o = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = {}; } }
  if (!o || typeof o !== "object") o = {};
  const entre = (x, min, max, defaut) => { const n = Number(x); return Number.isInteger(n) && n >= min && n <= max ? n : defaut; };
  return {
    ouverture: OUVERTURES.includes(o.ouverture) ? o.ouverture : REGLAGES_DEFAUT.ouverture,
    pilote_cips: Array.isArray(o.pilote_cips) ? [...new Set(o.pilote_cips.map(String).filter((c) => RE_CIP.test(c)))] : [],
    plafond_offres_7j: entre(o.plafond_offres_7j, 0, PLAFOND_MAX, PLAFOND_DEFAUT),
    plafond_infos_7j: entre(o.plafond_infos_7j, 0, PLAFOND_MAX, PLAFOND_INFOS_DEFAUT),
    plafond_commandes_jour: entre(o.plafond_commandes_jour, 1, PLAFOND_COMMANDES_MAX, PLAFOND_COMMANDES_DEFAUT),
  };
}

// Plafond d'une catégorie → { max, fenetreMs, libelle } ; null : pas de plafond (retour en stock)
export function plafondDe(categorie, reglages) {
  if (categorie === "offres") return { max: reglages.plafond_offres_7j, fenetreMs: 7 * 86400e3, libelle: "7 jours" };
  if (categorie === "infos") return { max: reglages.plafond_infos_7j, fenetreMs: 7 * 86400e3, libelle: "7 jours" };
  if (categorie === "commandes") return { max: reglages.plafond_commandes_jour, fenetreMs: 86400e3, libelle: "24 heures" };
  return null;
}

// La pharmacie (CIP du jeton) peut-elle s'abonner ? → null (oui) | "fermee" | "hors_pilote"
export function raisonOuverture(reglages, cip) {
  if (reglages.ouverture === "toutes") return null;
  if (reglages.ouverture === "pilote") return reglages.pilote_cips.includes(String(cip)) ? null : "hors_pilote";
  return "fermee";
}
