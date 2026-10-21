// ── Notifications de l'appli Elixir : modèles de messages de l'admin (docs/notifications.md § 4) ──
// JS pur, sans dépendance, importé par l'onglet admin (chargé à la demande) et par les tests. Chaque modèle préremplit le
// composeur ; tout reste modifiable. Les champs entre crochets en minuscules (« [référence] ») sont à remplacer :
// l'envoi est refusé tant qu'il en reste (champsACompleter, regles.js). Jamais de montant sur l'écran verrouillé (avoir).
// Aucun modèle ne promet un envoi qui n'existe pas (« le détail vous est envoyé par e-mail ») : seul le téléphone d'Elixir
// est cité. typeLien : lien à choisir avant l'envoi (« promo » : menu promo, sans valeur, l'envoi reste bloqué tant qu'il
// n'est pas choisi). Un nouveau menu ou une offre est une « Promotion » (une pharmacie qui coupe les offres n'en reçoit pas).
// Les modèles enregistrés par l'admin (« Enregistrer comme modèle ») sont dans la table push_modeles (sql/push-messages.sql).
import { LIMITES, IDS_TYPES, lienValide, texteNet, longueur } from "./regles.js";

export const MODELES_ELIXIR = [
  { id: "reclamation_recue", nom: "Réclamation reçue", type: "reclamation", url: "/?commandes=1",
    titre: "Réclamation reçue", corps: "Nous avons bien reçu votre réclamation [référence]. Réponse sous 24 h ouvrées (du lundi au vendredi)." },
  { id: "reclamation_traitee", nom: "Réclamation traitée", type: "reclamation", url: "/?commandes=1",
    titre: "Réclamation traitée", corps: "Votre réclamation [référence] est traitée. Une question : 01 86 04 39 95." },
  { id: "retour_accepte", nom: "Retour accepté", type: "reclamation", url: "/?commandes=1",
    titre: "Retour accepté", corps: "Votre demande de retour [référence] est acceptée. Notre équipe vous contacte pour la reprise." },
  { id: "avoir_emis", nom: "Avoir émis", type: "reclamation", url: "/?commandes=1",
    titre: "Avoir émis", corps: "Un avoir est émis pour votre réclamation [référence]." },
  { id: "commande_expediee", nom: "Commande expédiée", type: "commande", url: "/?commandes=1",
    titre: "Commande expédiée", corps: "Votre commande [n° de commande] est sortie de l'entrepôt (tournée [n° de tournée])." },
  { id: "reliquat", nom: "Reliquat", type: "commande", url: "/?commandes=1",
    titre: "Reliquat sur votre commande", corps: "Une partie de votre commande [n° de commande] est en reliquat : elle partira dès réception du stock." },
  { id: "fermeture_exceptionnelle", nom: "Fermeture exceptionnelle", type: "communication", url: "/",
    titre: "Fermeture exceptionnelle", corps: "Elixir Pharma sera fermé le [date]. Les commandes reçues ce jour-là partiront le [date de reprise]." },
  { id: "nouveau_menu", nom: "Nouveau menu", type: "promotion", url: "/", typeLien: "promo",
    titre: "Nouveau sur votre espace Elixir", corps: "Découvrez le menu [nom du menu] : [ce qu'il apporte]." },
  { id: "offre_du_moment", nom: "Offre du moment", type: "promotion", url: "/", typeLien: "promo",
    titre: "Offre du moment", corps: "[produit ou gamme] : [avantage] jusqu'au [date]." },
];

// Modèle enregistré par l'admin → { ok, erreurs, modele: { nom, type, titre, corps, url } } (champs entre crochets admis :
// c'est un modèle)
export const NOM_MODELE_MAX = 40, MODELES_MAX = 100;
export function verifierModele(m = {}) {
  const erreurs = [];
  const nom = texteNet(m.nom), titre = texteNet(m.titre), corps = texteNet(m.corps);
  if (!nom) erreurs.push("Donnez un nom au modèle.");
  else if (longueur(nom) > NOM_MODELE_MAX) erreurs.push(`Nom du modèle : ${NOM_MODELE_MAX} caractères au plus.`);
  const type = IDS_TYPES.includes(m.type) ? m.type : null;
  if (!type) erreurs.push("Type de message inconnu.");
  if (!titre) erreurs.push("Le titre est vide.");
  else if (longueur(titre) > LIMITES.titre) erreurs.push(`Le titre dépasse ${LIMITES.titre} caractères.`);
  if (!corps) erreurs.push("Le texte est vide.");
  else if (longueur(corps) > LIMITES.corps) erreurs.push(`Le texte dépasse ${LIMITES.corps} caractères.`);
  const url = lienValide(m.url || "/");
  if (!url) erreurs.push("Le lien n'est pas une page du site.");
  return { ok: !erreurs.length, erreurs, modele: { nom, type, titre, corps, url } };
}
