// ── Assistant Elixir : définitions des 7 outils (sans dépendance) ──
// Séparées de _chat-outils.js (Zod, relevé PDF/Excel) pour que chat.js, appelé à chaque attente de réponse, ne charge
// que ces définitions (VERSION_OUTILS) : son paquet passe d'environ 2 Mo à quelques dizaines de Ko.
// _chat-outils.js les réexporte (contrat : docs/assistant-contrat.md, « Outils »). Définitions JSON écrites à la main,
// `strict: true`, ordre et octets stables (préfixe mis en cache côté API) : toutes les propriétés sont requises, une
// valeur facultative s'écrit anyOf [type, null], additionalProperties: false partout. Le mode strict ne prend ni
// bornes ni motifs : ils sont vérifiés par Zod dans _chat-outils.js. Toute modification change VERSION_OUTILS.
import { createHash } from "node:crypto";

const D = { anyOf: [{ type: "string", format: "date" }, { type: "null" }] };
export const MOTIFS = ["produit_manquant", "reliquat", "erreur_produit", "quantite_incorrecte", "produit_casse", "caisse_manquante", "mauvaise_caisse",
  "commande_non_recue", "mauvaise_commande_recue", "retour_erreur_pharmacie", "dlu_courte", "ecart_facture", "autre"];
export const SOUHAITS = ["renvoi", "avoir", "garde", "reprise", "remise", "recevoir_reliquat", "annule_reliquat", "non_precise"];
export const CATEGORIES = ["documents", "commande", "livraison", "qualite", "reglement", "compte", "tarifs", "disponibilite", "referencement", "autre"];
const gel = (o) => { if (o && typeof o === "object") { for (const v of Object.values(o)) gel(v); Object.freeze(o); } return o; };

// conception § 2.5 ; duplicata_facture.envoi : telechargement | email_compte
export const OUTILS = gel([
  { name: "rechercher_factures", strict: true,
    description: "Liste les factures et avoirs émis par Elixir Pharma à la pharmacie connectée (elle seule). À appeler dès qu'une facture, un avoir ou un montant facturé est évoqué, ou pour retrouver un numéro. Ne renvoie jamais d'état de paiement (information non disponible).",
    input_schema: { type: "object", additionalProperties: false, required: ["date_debut", "date_fin", "type_document", "recherche", "page"],
      properties: {
        date_debut: { ...D, description: "AAAA-MM-JJ inclus ; null = 90 jours avant aujourd'hui" },
        date_fin: { ...D, description: "AAAA-MM-JJ inclus ; null = aujourd'hui" },
        type_document: { type: "string", enum: ["factures", "avoirs", "tous"] },
        recherche: { anyOf: [{ type: "string" }, { type: "null" }], description: "N° de facture ou d'avoir, n° de commande (S…), CIP13 ou mot du nom d'un produit ; null = aucun filtre" },
        page: { type: "integer", description: "1 = les 20 plus récents" } } } },
  { name: "duplicata_facture", strict: true,
    description: "Prépare le duplicata (PDF d'origine) d'une facture ou d'un avoir de la pharmacie connectée, à partir de son numéro exact OU d'une date de facture. Si plusieurs documents correspondent, renvoie les candidats : demander lequel. Le bouton est affiché par l'interface : ne jamais écrire de lien.",
    input_schema: { type: "object", additionalProperties: false, required: ["numero", "date", "envoi"],
      properties: {
        numero: { anyOf: [{ type: "string" }, { type: "null" }], description: "Ex. INV/2026/51300 ou RINV/2026/01176 ; null si la pharmacie donne une date" },
        date: { ...D, description: "Date de facture AAAA-MM-JJ ; null si le numéro est connu" },
        envoi: { type: "string", enum: ["telechargement", "email_compte"], description: "email_compte seulement si la pharmacie le demande ; l'adresse est celle de son compte, jamais une adresse dictée" } } } },
  { name: "releve_facturation", strict: true,
    description: "Produit le relevé des factures et avoirs émis à la pharmacie connectée sur une période (12 mois au plus), avec les totaux HT, TVA par taux et TTC calculés par le serveur, en PDF et Excel. Ne reflète pas les règlements : n'en déduire aucun solde.",
    input_schema: { type: "object", additionalProperties: false, required: ["date_debut", "date_fin", "detail"],
      properties: {
        date_debut: { type: "string", format: "date" },
        date_fin: { type: "string", format: "date" },
        detail: { type: "string", enum: ["par_document", "par_produit"] } } } },
  { name: "rechercher_commandes", strict: true,
    description: "Liste les commandes de la pharmacie connectée (site Elixir, logiciel de l'officine via PharmaML, saisie Elixir) avec leur état. À appeler pour « où en est ma commande », une commande passée ou un produit commandé.",
    input_schema: { type: "object", additionalProperties: false, required: ["date_debut", "date_fin", "etat", "recherche", "page"],
      properties: {
        date_debut: { ...D, description: "null = 14 jours avant aujourd'hui" },
        date_fin: D,
        etat: { type: "string", enum: ["toutes", "en_cours", "sorties", "partiellement_servies", "facturees"] },
        recherche: { anyOf: [{ type: "string" }, { type: "null" }], description: "S…, référence du site, CIP13 ou mot du nom d'un produit" },
        page: { type: "integer" } } } },
  { name: "detail_commande", strict: true,
    description: "Détail d'une commande de la pharmacie connectée : lignes commandées, servies, non servies et facturées, sortie d'entrepôt, tournée, lots et péremptions (si la livraison est validée), factures liées. La référence vient de rechercher_commandes ou de la pharmacie.",
    input_schema: { type: "object", additionalProperties: false, required: ["reference"],
      properties: { reference: { type: "string", description: "S348696, référence du site (13 chiffres) ou EP/OUT/…" } } } },
  { name: "preparer_demande_retour", strict: true,
    description: "Prépare (n'envoie PAS) une demande de retour ou une réclamation sur une livraison ou une facture de la pharmacie connectée. L'interface affiche un récapitulatif que la pharmacie confirme par un bouton. À appeler seulement quand document, produits, quantités et motif sont connus. Ne jamais promettre d'avoir ni de reprise. Qualité pharmaceutique : utiliser transmettre_a_un_conseiller.",
    input_schema: { type: "object", additionalProperties: false, required: ["reference_document", "motif", "souhait", "lignes", "commentaire"],
      properties: {
        reference_document: { type: "string", description: "N° de facture, de commande (S…) ou de livraison (EP/OUT/…)" },
        motif: { type: "string", enum: MOTIFS },
        souhait: { type: "string", enum: SOUHAITS },
        lignes: { type: "array", items: { type: "object", additionalProperties: false, required: ["produit", "quantite", "lot"],
          properties: {
            produit: { type: "string", description: "CIP13 ou libellé tel qu'il figure sur le document" },
            quantite: { type: "integer" },
            lot: { anyOf: [{ type: "string" }, { type: "null" }], description: "Seulement si la pharmacie l'indique (plusieurs lots livrés)" } } } },
        commentaire: { anyOf: [{ type: "string" }, { type: "null" }] } } } },
  { name: "transmettre_a_un_conseiller", strict: true,
    description: "Transmet la demande à l'équipe Elixir avec un résumé (accès à la conversation) : un e-mail part aussitôt. N'appeler qu'avec l'accord explicite de la pharmacie (elle le demande, ou répond oui à votre proposition). Exception, immédiatement et sans question : défaut de qualité, rappel de lot, suspicion de falsification, effet indésirable (categorie qualite, urgence urgente).",
    input_schema: { type: "object", additionalProperties: false, required: ["categorie", "resume", "reference", "urgence", "rappel"],
      properties: {
        categorie: { type: "string", enum: CATEGORIES },
        resume: { type: "string", description: "2 à 5 phrases factuelles : demande, références, ce qui a été vérifié" },
        reference: { anyOf: [{ type: "string" }, { type: "null" }] },
        urgence: { type: "string", enum: ["normale", "urgente"] },
        rappel: { type: "string", enum: ["email", "telephone", "indifferent"] } } } },
]);
export const VERSION_OUTILS = `outils-${createHash("sha256").update(JSON.stringify(OUTILS)).digest("hex").slice(0, 12)}`;

// Texte d'attente affiché pendant l'outil (jamais écrit par le modèle)
export const ETAPES = Object.freeze({
  rechercher_factures: "Je recherche vos factures…",
  duplicata_facture: "Je prépare votre document…",
  releve_facturation: "Je prépare votre relevé de facturation…",
  rechercher_commandes: "Je recherche vos commandes…",
  detail_commande: "Je consulte le détail de la commande…",
  preparer_demande_retour: "Je prépare le récapitulatif de votre demande…",
  transmettre_a_un_conseiller: "Je transmets votre demande à l'équipe Elixir…",
});
