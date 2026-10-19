// ── Réponses fictives aux appels qui écrivent (POST, PUT, DELETE…) vers /.netlify/functions/ ──
// Partagé par le mode « essai à blanc » des aperçus Netlify (src/dev/essai-a-blanc.js, chargé à la
// demande, jamais dans le build de production) et par le banc local (scripts/banc/plugin.mjs).
// Rien n'est envoyé ni enregistré : la réponse imite celle du serveur juste assez pour que l'écran
// suive son cours normal (succès). JS pur, sans dépendance.

export const PHARMACIE_FICTIVE = { name: "PHARMACIE D'ESSAI", cip: "", email: "" };

// fn : nom de la fonction Netlify ; corps : données envoyées (objet JSON ou texte) ;
// pharmacie : identité renvoyée à l'identification ; admin : connexion admin acceptée (banc) ou non (aperçu)
export function reponseFictive({ fn, methode = "POST", corps = null, pharmacie = PHARMACIE_FICTIVE, admin = false }) {
  const b = corps && typeof corps === "object" ? corps : {};
  const email = String(b.email || pharmacie.email || "").trim().toLowerCase();
  const ph = { ...pharmacie, email };
  // une adresse contenant « inconnu » essaie le parcours « pharmacie inconnue » (formulaire de demande d'accès)
  const inconnu = /inconnu/.test(email);
  if (methode === "DELETE") return { success: true };
  switch (fn) {
    // identification de la pharmacie (mode historique, puis mode code à 6 chiffres)
    case "pharmacy-lookup":     return inconnu ? { found: false } : { found: true, pharmacy: ph };
    case "pharmacy-otp-send":   return inconnu ? { success: false, unknown: true } : { success: true };
    case "pharmacy-otp-verify": return String(b.token) === "000000"   // code « 000000 » : essai du message d'erreur
      ? { success: false, error: "Code invalide ou expiré." }
      : { success: true, token: "essai-jeton", refresh_token: "essai-renouvellement", pharmacy: ph };
    case "admin-refresh":       return { success: true, token: "essai-jeton", refresh_token: "essai-renouvellement" };
    case "admin-login":         return admin
      ? { success: true, token: "essai-jeton-admin", refresh_token: "essai-renouvellement-admin" }
      : { success: false, error: "Aperçu : l'administration est désactivée ici (rien ne doit y être modifié)." };
    // lectures faites en POST : réponses neutres
    case "quota-status":        return { exempt: false, products: {} };
    case "gp-pharmacy":         return b.action === "access" ? { allowed: true } : b.action === "list" ? { operations: [] } : { success: true };
    // envoi d'une commande : e-mail, enregistrement, relais PharmaML
    case "send-email":          return { success: true };
    // contrôle de session avant envoi ({ verifier: true }) : accepté (admin seulement si la connexion admin l'est)
    case "order-save":          return b.verifier ? { success: true, admin: !!admin } : { success: true, id: b.id ?? Date.now() };
    case "submit-order":        return { queued: false, error: "essai à blanc : rien n'est transmis à PharmaML" };
    case "search-track":        return { ok: true };
    case "lab-justif":
      if (b.action === "rx_upload")   return { id: `essai-${Date.now()}`, name: b.name || "ordonnance" };
      if (b.action === "commander")   return { order_id: b.order_id, demandes: [] };
      if (b.action === "submit")      return { demandes: [] };
      if (b.action === "mes_demandes") return { demandes: [] };
      return { success: true };
    // Assistant Elixir : conversation écrite d'avance (aucune IA, aucun Odoo)
    case "chat":                return reponseChatFictive(b, pharmacie);
    default:                    return { success: true, ok: true };
  }
}

// ── Assistant Elixir (cas « chat ») : conversation fictive marquée « Aperçu : réponses fictives » (apercu: true) ──
// Réponses écrites d'avance, choisies d'après quelques mots de la question, qui montrent chaque carte du contrat
// (docs/assistant-contrat.md, « Cartes UiAction ») ; « toutes les cartes » les montre d'un coup. Numéros, montants,
// produits et lots inventés. Le message de l'assistant revient tout de suite avec le tour_id : sur un aperçu, les
// lectures (GET, dont l'attente de la réponse) partent vers le vrai serveur ; le banc local, lui, rejoue l'attente.
// Coordonnées : valeurs par défaut des réglages (_chat-config.js), recopiées pour l'aperçu seulement.
export const INFOS_FICTIVES = {
  delai_annonce: "Réponse sous 24 h ouvrées (du lundi au vendredi).",
  telephone: "01 86 04 39 95",
  horaires: "lun-ven 9 h 30-17 h, sam 9 h 30-14 h",
  conservation_jours: 90,
};
// identifiants de fichiers fictifs (32 caractères hexadécimaux, comme les vrais) : le banc sert un PDF ou un Excel d'essai
export const FICHIERS_FICTIFS = {
  facture: "0000000000000000000000000000a001",
  releve_pdf: "0000000000000000000000000000a002",
  releve_xlsx: "0000000000000000000000000000a003",
};

// AAAA-MM-JJ à Paris, décalé de n jours
const jourParis = (n = 0) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const sansAccents = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
let numeroFictif = 0;
const messageFictif = (texte, ui_actions = []) =>
  ({ id: `apercu-${Date.now()}-${++numeroFictif}`, role: "assistant", texte, ui_actions, at: new Date().toISOString() });

const DOCUMENTS_FICTIFS = () => [
  { piece: "facture", numero: "INV/2026/90412", date: jourParis(-3), montant_ttc: 1234.56, pdf_disponible: true },
  { piece: "facture", numero: "INV/2026/90388", date: jourParis(-5), montant_ttc: 487.2, pdf_disponible: true },
  { piece: "avoir", numero: "RINV/2026/09021", date: jourParis(-10), montant_ttc: -86.4, pdf_disponible: false },
];
function carteDocument(numero) {
  const d = DOCUMENTS_FICTIFS().find((x) => x.numero === numero) || DOCUMENTS_FICTIFS()[0];
  return { type: "document", ...d, fichier_id: d.pdf_disponible ? FICHIERS_FICTIFS.facture : null };
}
function carteReleve() {
  // mois précédent, totaux cohérents (HT 88 560,00 + TVA 2 489,40 = TTC 91 049,40)
  const [a, m] = jourParis(0).split("-").map(Number);
  const am = m === 1 ? a - 1 : a, mm = m === 1 ? 12 : m - 1;
  const fin = new Date(Date.UTC(am, mm, 0)).getUTCDate();
  const mois = `${am}-${String(mm).padStart(2, "0")}`;
  return {
    type: "releve", debut: `${mois}-01`, fin: `${mois}-${fin}`, nb_factures: 41, nb_avoirs: 5,
    total_ht: 88560, total_tva: 2489.4, total_ttc: 91049.4,
    tva: [{ taux: 2.1, base: 78400, montant: 1646.4 }, { taux: 5.5, base: 8200, montant: 451 }, { taux: 20, base: 1960, montant: 392 }],
    fichiers: { pdf: FICHIERS_FICTIFS.releve_pdf, xlsx: FICHIERS_FICTIFS.releve_xlsx },
    mention: "Liste des documents émis ; ne reflète pas les règlements.",
  };
}
const carteCommande = (commandeSiteId = null) => ({
  type: "commande", reference: "S900123", date: jourParis(-1), origine: commandeSiteId ? "site" : "logiciel",
  etapes: [
    { cle: "recue", libelle: "Reçue", date: jourParis(-1), fait: true },
    { cle: "preparation", libelle: "En préparation", date: jourParis(-1), fait: true },
    { cle: "sortie", libelle: "Sortie de l'entrepôt (tournée 3)", date: jourParis(-1), fait: true },
    { cle: "facturee", libelle: "Facturée", date: null, fait: false },
  ],
  lignes: [
    { produit: "Paracétamol 1000 mg comprimés B/8 (fictif)", cip: "3400900000011", commande: 10, servi: 6, non_servi: 4 },
    { produit: "Phloroglucinol 80 mg lyophilisat B/10 (fictif)", cip: "3400900000028", commande: 3, servi: 3, non_servi: 0 },
  ],
  lots: [
    { produit: "Paracétamol 1000 mg comprimés B/8 (fictif)", lot: "AB123", peremption: "2028-04-30", quantite: 6 },
    { produit: "Phloroglucinol 80 mg lyophilisat B/10 (fictif)", lot: "CD456", peremption: "2027-11-30", quantite: 3 },
  ],
  factures: [],
  commande_site_id: commandeSiteId,
});
const carteRecap = () => {
  const limite = jourParis(7).split("-").reverse().slice(0, 2).join("/");
  return {
    type: "recap_retour", demande_id: `apercu-retour-${Date.now()}-${++numeroFictif}`, expire_at: new Date(Date.now() + 30 * 60e3).toISOString(),
    document: { numero: "INV/2026/90412", date_sortie: jourParis(-3) },
    lignes: [{ produit: "Phloroglucinol 80 mg lyophilisat B/10 (fictif)", cip: "3400900000028", lot: "CD456", peremption: "2027-11-30", quantite: 2 }],
    motif: "retour_erreur_pharmacie", souhait: "avoir",
    info_delai: `Retour sans abattement après accord du Pharmacien Responsable, dans la limite de 10 jours calendaires après livraison (ici jusqu'au ${limite}).`,
  };
};
const carteTransmission = () => ({ type: "transmission", numero: "T-2026-0001", delai: INFOS_FICTIVES.delai_annonce,
  telephone: INFOS_FICTIVES.telephone, horaires: INFOS_FICTIVES.horaires });

// question → réponse écrite d'avance (texte court, comme l'assistant ; les chiffres sont dans les cartes)
function reponseFictiveA(texte, contexte) {
  const q = sansAccents(texte);
  const numero = String(texte ?? "").match(/\b(?:R?INV)\/\d{4}\/\d+/i)?.[0]?.toUpperCase();
  if (/toutes les cartes|demonstration/.test(q)) return messageFictif(
    "Aperçu de **toutes les cartes** de l'assistant :\n- duplicata, choix d'un document, relevé ;\n- commande, retour à confirmer, transmission ;\n- carte d'erreur.\n\nAffichage sûr : <a href=\"javascript:alert(1)\">lien</a>, <img src=x onerror=alert(1)> et https://exemple.fr restent du texte.",
    [carteDocument("INV/2026/90412"), carteDocument("RINV/2026/09021"), { type: "documents", items: DOCUMENTS_FICTIFS() }, carteReleve(),
      carteCommande(contexte?.commande_site_id || null), carteRecap(), carteTransmission(),
      { type: "erreur", texte: "Aperçu : exemple de carte d'erreur." }]);
  if (/^le document /.test(q) || (numero && /duplicata|facture|avoir|document/.test(q))) {
    const c = carteDocument(numero);
    return messageFictif(c.pdf_disponible
      ? `Voici votre ${c.piece} ${c.numero}. Vous pouvez la télécharger ci-dessous.`
      : `Cet avoir n'a pas encore été émis au format PDF. Je peux demander à l'équipe de vous l'envoyer : je transmets ?`, [c]);
  }
  if (/relev/.test(q)) return messageFictif("Votre relevé du mois dernier est prêt : il liste les documents émis, sans les règlements.", [carteReleve()]);
  if (/retour|reclamation|retourner|probleme|signale/.test(q)) return messageFictif(
    "Voici le récapitulatif. Il ne sera envoyé que si vous confirmez.", [carteRecap()]);
  if (/conseiller|parler|quelqu.un|humain|rappel/.test(q)) return messageFictif(
    "Je transmets votre demande à l'équipe Elixir.", [carteTransmission()]);
  if (contexte?.commande_site_id || /commande|livr|colis/.test(q)) return messageFictif(
    "Votre commande S900123 est sortie de l'entrepôt hier. Pour le paracétamol : **10 commandés, 6 servis** ; les 4 autres n'ont pas été servis et ne seront pas facturés.",
    [carteCommande(contexte?.commande_site_id ? String(contexte.commande_site_id) : null)]);
  if (/duplicata|facture|avoir/.test(q)) return messageFictif(
    "Plusieurs documents correspondent. Lequel voulez-vous ?", [{ type: "documents", items: DOCUMENTS_FICTIFS() }]);
  return messageFictif("Ceci est un **aperçu** : les réponses sont écrites d'avance. Essayez par exemple :\n- « Duplicata d'une facture »\n- « Relevé de facturation »\n- « Où en est ma commande ? »\n- « Demande de retour »\n- « Parler à un conseiller »\n- « Toutes les cartes »");
}

export function reponseChatFictive(b = {}, pharmacie = PHARMACIE_FICTIVE) {
  const ouverture = () => ({
    conversation_id: "apercu-conversation",
    // saisie Elixir (pour_odoo_id) : nom vide, le panneau affiche celui de la pharmacie servie
    pharmacie: { nom: b.pour_odoo_id != null ? "" : pharmacie.name || "", ville: null },
    admin: null, mode: "complet", messages: [], infos: INFOS_FICTIVES, apercu: true,
  });
  switch (b.action) {
    case "etat":     return { disponible: true, mode: "complet", raison: null, infos: INFOS_FICTIVES };
    case "ouvrir":
    case "nouvelle": return ouverture();
    case "message":  return { tour_id: `apercu-tour-${Date.now()}-${++numeroFictif}`, message: reponseFictiveA(b.texte, b.contexte) };
    // identifiant « d-<demande_id> », comme le serveur : le récapitulatif reste fermé à la réouverture
    case "confirmer": return { message: { ...(b.decision === "confirmer"
      ? messageFictif("", [{ type: "demande_enregistree", numero: "R-2026-0001", date: jourParis(0),
          delai: INFOS_FICTIVES.delai_annonce, email_masque: "ph…@…fr", simulation: true }])
      : messageFictif("Demande annulée : rien n'a été envoyé.")), id: `d-${b.demande_id}` } };
    default:         return { success: true };
  }
}
