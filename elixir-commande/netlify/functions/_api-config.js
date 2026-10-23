// ── API des pharmacies : constantes, réglages, prérequis et conditions d'utilisation (projet) ──
// Partagé par api-v1.js (routeur public), api-admin.js (onglet 🔌 API) et api-compte.js (« Accès API » de la pharmacie).
// Décisions de Zineb (24/10/2026) : accès sur demande, ouvert par Elixir pharmacie par pharmacie ; la V1 comprend la
// COMMANDE ; pas de validation manuelle par défaut (envoi automatique après un délai d'annulation de 10 min, plafonds,
// commande gardée « à vérifier » seulement en cas d'anomalie nette) ; gratuit ; prix de la liste de chaque pharmacie.
// Le chemin d'écriture des commandes réelles est FERMÉ par l'interrupteur « Commandes par API » (réglage commandes_live)
// tant que les prérequis ne sont pas tous cochés : le serveur refuse de l'ouvrir avant (commandesOuvrables).
// Dépôt public : aucun secret, aucune donnée réelle ici.
import crypto from "node:crypto";

export const VERSION_API = "1.0.0";
export const DERNIERE_MODIFICATION = "2026-10-24";

export const PORTEES = ["lecture", "commande"];
export const LIBELLES_PORTEES = { lecture: "Lecture (catalogue, disponibilités, contingents, commandes, documents)", commande: "Commande (passer et annuler)" };
export const ENVIRONNEMENTS = ["live", "test"];
export const MODES = ["auto", "bloque"];
export const CLES_ACTIVES_MAX = 3;          // par environnement et par pharmacie
export const ROTATION_JOURS = 7;            // « Remplacer » : l'ancienne clé reste valide 7 jours
export const CORPS_MAX_OCTETS = 256 * 1024;
export const MENTION_PRIX = "Prix HT de votre liste, hors offres du site";

// Débits : fenêtres fixes, compteurs durables (api_compteurs). Avant authentification : par IP (IPv6 : /64).
export const LIMITES = {
  ip: { par_minute: 120 },
  refus_cle: { max: 20, fenetre_s: 600 },   // clés refusées depuis un même réseau
  lecture: { par_minute: 60, par_jour: 5000 },
  commande: { par_minute: 6, par_jour: 30 },
};

// Réglages d'un accès à l'ouverture (modifiables dans l'admin, pharmacie par pharmacie)
export const ACCES_DEFAUT = {
  portees: [...PORTEES], mode: "auto", delai_annulation_min: 10,
  plafond_lignes: 100, plafond_boites: 1000, plafond_montant_ht: 3000, plafond_commandes_jour: 10,
  anomalie_active: true, anomalie_facteur: 10, anomalie_doublon_min: 30,
};
// bornes des champs numériques (mêmes que les contraintes de sql/api-schema.sql)
export const BORNES = {
  delai_annulation_min: [0, 20], plafond_lignes: [1, 200], plafond_boites: [1, 100000], plafond_montant_ht: [1, 1000000],
  plafond_commandes_jour: [1, 200], anomalie_facteur: [2, 1000], anomalie_doublon_min: [0, 1440],
};

// ── Prérequis de l'ouverture des commandes réelles (conception § 19) ──
// pas_avant : jour (heure de Paris) avant lequel la case ne peut pas être cochée. Libellés neutres (dépôt public).
export const PREREQUIS = [
  { id: "P1", libelle: "Sécurisation de la base de données : étape 2 et Bloc 1 du plan terminés" },
  { id: "P3", libelle: "Fin de la quarantaine des commandes du site (02/11/2026)", pas_avant: "2026-11-02" },
  { id: "P4", libelle: "Identifiants du relais renouvelés et envoi automatique du site stable" },
  { id: "P7", libelle: "Conditions d'utilisation de l'API validées par un avocat (dossier BPDG validé)" },
];

export const REGLAGES_DEFAUT = { actif: true, commandes_live: false, prerequis: {} };
const lireJson = (t, d) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return d; } };
export const jourParis = (d = new Date()) => new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

export function fusionnerReglages(valeur) {
  const v = lireJson(valeur, {}) || {};
  const prerequis = {};
  for (const p of PREREQUIS) {
    const x = v.prerequis?.[p.id];
    if (x && typeof x === "object") prerequis[p.id] = { fait: x.fait === true, le: x.le || null, par: x.par || null, note: String(x.note || "").slice(0, 300) || null };
  }
  return { actif: v.actif !== false, commandes_live: v.commandes_live === true, prerequis };
}

// → [{ id, libelle, pas_avant, fait, le, par, note, cochable }]
export function prerequisEtat(reglages, maintenant = new Date()) {
  const r = fusionnerReglages(reglages);
  const jour = jourParis(maintenant);
  return PREREQUIS.map(p => ({ ...p, pas_avant: p.pas_avant || null, fait: false, le: null, par: null, note: null, ...(r.prerequis[p.id] || {}),
    cochable: !p.pas_avant || jour >= p.pas_avant }));
}
// L'interrupteur « Commandes par API » ne s'ouvre que si tous les prérequis sont cochés (et datés au bon jour)
export function commandesOuvrables(reglages, maintenant = new Date()) {
  const manquants = prerequisEtat(reglages, maintenant).filter(p => !p.fait || !p.cochable).map(p => p.id);
  return { ok: manquants.length === 0, manquants };
}
// Commandes RÉELLES (clés live) possibles : interrupteur ouvert ET prérequis toujours cochés (une case décochée referme)
export const commandesLiveOuvertes = (reglages, maintenant = new Date()) =>
  fusionnerReglages(reglages).commandes_live && commandesOuvrables(reglages, maintenant).ok;

// ── Conditions d'utilisation de l'API : PROJET (P7 : à faire valider par un avocat) ──
// Une nouvelle version (nouvelle date) oblige à les accepter de nouveau avant de créer une clé (et, plus tard, de commander).
// Preuve d'acceptation : version, empreinte du texte affiché, compte, date, réseau (api_acces.cgu_*).
export const CGU = {
  version: "2026-10-24-projet",
  titre: "Conditions d'utilisation de l'API Elixir Pharma (projet)",
  avertissement: "Version provisoire, en cours de validation juridique. Les commandes réelles par l'API ne seront ouvertes qu'après sa validation ; vous serez alors invité à accepter la version définitive.",
  articles: [
    ["Objet", "L'API permet à votre pharmacie, cliente d'Elixir Pharma, de consulter le catalogue à vos prix, la disponibilité, vos contingents et vos commandes, et de passer ou d'annuler des commandes depuis un outil de votre choix. Elle complète les conditions générales de vente, qui restent applicables."],
    ["Clés d'accès", "Toute requête faite avec une clé valide est réputée faite par votre pharmacie, jusqu'à ce que vous signaliez sa compromission. Vous gardez vos clés secrètes (jamais dans une page web, un tableur partagé ou un message) et vous les révoquez sans délai depuis votre compte en cas de doute."],
    ["Preuve", "Les enregistrements d'Elixir Pharma (commandes reçues par l'API, journal des appels) font foi, sauf preuve contraire."],
    ["Formation de la commande", "La commande est formée à la réponse de l'API qui l'accepte. Elixir Pharma peut réduire ou refuser une ligne (stock, contingentement, plafonds, anomalie, obligations réglementaires). La disponibilité affichée est indicative."],
    ["Prix", "Les prix donnés par l'API sont les prix hors taxes de votre liste de prix, hors offres réservées au site. Ils sont indicatifs : la facture applique vos conditions au jour de la livraison."],
    ["Plafonds et contrôles", "Des plafonds par commande et par jour s'appliquent. Une commande qui présente une anomalie nette (quantité très supérieure à vos habitudes, quasi-doublon d'une commande récente) est gardée pour vérification avant envoi."],
    ["Annulation", "Une commande peut être annulée par l'API pendant le délai d'annulation indiqué, tant que rien n'est parti. Ensuite, les réclamations et retours suivent les conditions générales de vente."],
    ["Un seul canal par besoin", "Vous vous engagez à ne pas commander le même besoin à la fois par votre logiciel d'officine et par l'API, et vous assumez les doublons qui en résulteraient."],
    ["Disponibilité du service", "Le service est fourni sans engagement de disponibilité. Le site, votre logiciel d'officine et le téléphone restent disponibles en secours. Elixir Pharma peut suspendre un accès immédiatement en cas d'abus ou de risque."],
    ["Confidentialité et données", "Vos prix et conditions sont confidentiels : il est interdit d'aspirer, de diffuser ou de revendre le catalogue. Aucune donnée de patient ni ordonnance ne passe par l'API."],
    ["Mode test et évolutions", "Le mode test est obligatoire avant toute clé de production. Toute évolution incompatible de l'API fait l'objet d'un préavis de six mois."],
    ["Responsabilité", "La responsabilité d'Elixir Pharma est limitée aux dommages directs, dans la limite du montant de la commande en cause, sauf faute lourde ou dolosive."],
  ],
};
export const empreinteCgu = () => crypto.createHash("sha256").update(JSON.stringify([CGU.version, CGU.titre, CGU.articles])).digest("hex");
