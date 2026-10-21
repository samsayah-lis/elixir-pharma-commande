// ── Réponses fictives aux appels qui écrivent (POST, PUT, DELETE…) vers /.netlify/functions/ ──
// Partagé par le mode « essai à blanc » des aperçus Netlify (src/dev/essai-a-blanc.js, chargé à la
// demande, jamais dans le build de production) et par le banc local (scripts/banc/plugin.mjs).
// Rien n'est envoyé ni enregistré : la réponse imite celle du serveur juste assez pour que l'écran
// suive son cours normal (succès). JS pur, sans dépendance.

import { categoriesAffichees, REGLAGES_DEFAUT } from "../notifications/regles.js";

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
    // publication d'une clé de configuration (éditeur des mises en avant de l'accueil : base / 409) : acceptée, nouvelle
    // version datée de maintenant ; rien n'est écrit
    case "config-get":          return { success: true, key: b.key, updated_at: new Date().toISOString() };
    case "lab-justif":
      if (b.action === "rx_upload")   return { id: `essai-${Date.now()}`, name: b.name || "ordonnance" };
      if (b.action === "commander")   return { order_id: b.order_id, demandes: [] };
      if (b.action === "submit")      return { demandes: [] };
      if (b.action === "mes_demandes") return { demandes: [] };
      return { success: true };
    // Assistant Elixir : conversation écrite d'avance (aucune IA, aucun Odoo)
    case "chat":                return reponseChatFictive(b, pharmacie);
    // alertes retour (admin) : « Envoyer maintenant », « Activer / Suspendre », « Relancer » — aucun e-mail ne part
    case "restock-notify":      return b.action === "envoyer"
      ? { done: true, mode: "complet", envoyes: 0, pharmacies: 0, produits: 0, closes: { ancienne: 0, destinataire: 0, echec: 0, interrompu: 0 },
          echecs: 0, deja_pris: 0, restants: 0, reportes: 0, ecartees: 0, hors_fenetre: false, suspendu: false, plafond: false, panne: null,
          erreurs: ["essai à blanc : aucun e-mail envoyé"] }
      : b.action === "activer" ? { success: true, actif: b.actif === true, mise_en_service: b.actif === true ? new Date().toISOString() : null }
      : { success: true };
    // Notifications de l'appli (docs/notifications.md) : aucun abonnement enregistré, aucune notification envoyée
    case "push-abonnement":     return reponsePushFictive(b);
    case "push-admin":          return reponsePushAdminFictive(b);
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

// ── Page d'accueil (GET accueil-offres) : classement fictif des aperçus Netlify, repli du banc local ──
// Sur un aperçu, la connexion est simulée : le jeton d'essai ne peut pas lire le vrai classement (401). La vitrine montre
// alors ces 6 diapositives (produits, prix, paliers et photos relevés le 19/10/2026 ; aucune donnée client, ni compte
// exact ni stock), marquées « apercu ». Régénérées par : node scripts/banc/fixture-accueil.mjs <top15j.json> --fictif
const ACCUEIL_FICTIF = [
  {"cip":"3400930292914","nom_court":"MOUNJARO 5mg","nom_panier":"MOUNJARO 5mg","nom":"MOUNJARO 5MG/DOSE KWIKPEN","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"5 mg","forme":"KwikPen","labo":"Lilly"},"pv":221.32,"pn":210.03,"pct":5.1,"remise_eur":11.29,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":210.03,"total":210.03},"stock":{"en_stock":true,"niveau":"limite"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 200 pharmacies","famille":"MOUNJARO","labo":"Lilly","tendance_pct":13,"nouveau":false,"serie_15j":[0.75,0.65,0.17,0.38,0.6,0.34,0.18,1,1,0.78,0.6,0.63,0.52,0.12,0.82],"variantes":[{"cip":"3400930292907","nom_court":"MOUNJARO 2,5mg","nom_panier":"MOUNJARO 2,5mg","nom":"MOUNJARO KWIKPEN 2,5 mg/dose sol inj stylo prérempli","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"2,5 mg","forme":"KwikPen","labo":"Lilly"},"pv":163.7,"pn":155.35,"pct":5.1,"remise_eur":8.35,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":155.35,"total":155.35},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 200 pharmacies","libelle":"2,5 mg","principal":false},{"cip":"3400930292914","nom_court":"MOUNJARO 5mg","nom_panier":"MOUNJARO 5mg","nom":"MOUNJARO 5MG/DOSE KWIKPEN","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"5 mg","forme":"KwikPen","labo":"Lilly"},"pv":221.32,"pn":210.03,"pct":5.1,"remise_eur":11.29,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":210.03,"total":210.03},"stock":{"en_stock":true,"niveau":"limite"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 200 pharmacies","libelle":"5 mg","principal":true},{"cip":"3400930292938","nom_court":"MOUNJARO 7,5mg","nom_panier":"MOUNJARO 7,5mg","nom":"MOUNJARO 7.5MG/DOSE KWIKPEN","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"7,5 mg","forme":"KwikPen","labo":"Lilly"},"pv":313.27,"pn":297.29,"pct":5.1,"remise_eur":15.98,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":297.29,"total":297.29},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 100 pharmacies","libelle":"7,5 mg","principal":false},{"cip":"3400930292945","nom_court":"MOUNJARO 10mg","nom_panier":"MOUNJARO 10mg","nom":"MOUNJARO 10MG/DOSE KWIKPEN","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"10 mg","forme":"KwikPen","labo":"Lilly"},"pv":313.27,"pn":297.29,"pct":5.1,"remise_eur":15.98,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":297.29,"total":297.29},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 100 pharmacies","libelle":"10 mg","principal":false},{"cip":"3400930292952","nom_court":"MOUNJARO 12,5mg","nom_panier":"MOUNJARO 12,5mg","nom":"MOUNJARO 12,5MG KWIKPEN 2,4ML1","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"12,5 mg","forme":"KwikPen","labo":"Lilly"},"pv":404.83,"pn":384.18,"pct":5.1,"remise_eur":20.65,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":384.18,"total":384.18},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 50 pharmacies","libelle":"12,5 mg","principal":false},{"cip":"3400930292976","nom_court":"MOUNJARO 15mg","nom_panier":"MOUNJARO 15mg","nom":"MOUNJARO 15MG KWIKPEN 2,4ML","image_url":null,"boite":{"marque":"MOUNJARO","dosage":"15 mg","forme":"KwikPen","labo":"Lilly"},"pv":404.83,"pn":384.18,"pct":5.1,"remise_eur":20.65,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":384.18,"total":384.18},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"obeso","label":"Mounjaro / Wegovy"},"popularite":"Plus de 50 pharmacies","libelle":"15 mg","principal":false}]},
  {"cip":"3400934438738","nom_court":"VENTOLINE 100µG/DOSE SUSP 120 DOSES","nom_panier":"VENTOLINE 100µG/DOSE SUSP 120 DOSES","nom":"VENTOLINE 100 microgrammes/dose (sulfate de salbutamol), suspension pour inhalation en flacon pressurisé (200 doses) avec valve doseuse et embout buccal","image_url":"https://assets.medipim.fr/media/medium/ccca55ac3993654e78b6b26578467071.png","boite":{"marque":"VENTOLINE","dosage":"100 µg/dose","forme":"Inhalation","labo":"GSK"},"pv":3.24,"pn":3.01,"pct":7.1,"remise_eur":0.23,"price_tiers":null,"regle_qte":{"step":120,"min":120,"multiple":120,"libelle":"Se commande par 120 (carton)"},"lot":{"qte":120,"pu":3.01,"total":361.2},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"stratege","label":"Sélection Stratège"},"popularite":"Plus de 100 pharmacies","famille":"VENTOLINE","labo":"GSK","tendance_pct":4,"nouveau":false,"serie_15j":[1,0.86,1,0.95,0.57,0.38,0.1,0.95,0.71,0.71,0.67,0.48,0.33,0.05,0.71],"variantes":[]},
  {"cip":"3400930303122","nom_court":"EYLEA 114,3 mg/ml","nom_panier":"EYLEA 114,3 mg/ml (aflibercept), solution injectable en seringue préremplie (verre) de 0,184 ml (B/1)","nom":"EYLEA 114,3 mg/ml (aflibercept), solution injectable en seringue préremplie (verre) de 0,184 ml (B/1)","image_url":null,"boite":{"marque":"EYLEA","dosage":"114,3 mg/ml","forme":"Seringue préremplie","labo":"Bayer"},"pv":366.23,"pn":349.71,"pct":4.5,"remise_eur":16.52,"price_tiers":null,"regle_qte":{"step":1,"min":1,"multiple":1,"libelle":null},"lot":{"qte":1,"pu":349.71,"total":349.71},"stock":{"en_stock":true,"niveau":"limite"},"menu":{"key":"saisie","label":"Saisie de commande"},"popularite":"Plus de 100 pharmacies","famille":"EYLEA","labo":"Bayer","tendance_pct":21,"nouveau":false,"serie_15j":[0.96,0.78,0.65,0.96,0.57,0.17,0.09,0.87,0.83,0.65,1,0.3,0.39,0.09,0.74],"variantes":[]},
  {"cip":"3400930986080","nom_court":"SPASFON COMPRIME ENROBE BTE 30","nom_panier":"SPASFON COMPRIME ENROBE BTE 30","nom":"SPASFON (phloroglucinol, triméthylphloroglucinol), comprimés enrobés (B/30)","image_url":"https://assets.medipim.fr/media/medium/3942c74684955bd54115cd9efd67b292.png","boite":{"marque":"SPASFON","dosage":null,"forme":"Comprimés","labo":"Teva"},"pv":1.93,"pn":1.7,"pct":11.9,"remise_eur":0.23,"price_tiers":[{"pct":13.5,"price":1.67,"min_qty":240}],"regle_qte":{"step":240,"min":240,"multiple":240,"libelle":"Se commande par 240 (carton)"},"lot":{"qte":240,"pu":1.67,"total":400.8},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"stratege","label":"Sélection Stratège"},"popularite":"Plus de 100 pharmacies","famille":"SPASFON","labo":"Teva","tendance_pct":13,"nouveau":false,"serie_15j":[1,0.84,0.47,0.26,0.37,0.53,0.11,0.68,0.74,0.89,0.63,0.53,0.21,0.11,0.63],"variantes":[{"cip":"3400941686245","nom_court":"SPASFON LYOC 160MG LYOPHILISAT ORAL BTE 5","nom_panier":"SPASFON LYOC 160MG LYOPHILISAT ORAL BTE 5","nom":"SPASFON LYOC 160 mg (phloroglucinol dihydraté), lyophilisats oraux (B/5)","image_url":"https://assets.medipim.fr/media/medium/eefb6180e80aa4ebba9875c4c6fb525e.png","boite":{"marque":"SPASFON","dosage":"160 mg","forme":"Lyophilisat","labo":"Teva"},"pv":1.3,"pn":1.07,"pct":17.7,"remise_eur":0.23,"price_tiers":[{"pct":18.5,"price":1.06,"min_qty":240}],"regle_qte":{"step":240,"min":240,"multiple":240,"libelle":"Se commande par 240 (carton)"},"lot":{"qte":240,"pu":1.06,"total":254.4},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"stratege","label":"Sélection Stratège"},"popularite":"Plus de 20 pharmacies","libelle":"Lyophilisat · 160 mg","principal":false},{"cip":"3400930986080","nom_court":"SPASFON COMPRIME ENROBE BTE 30","nom_panier":"SPASFON COMPRIME ENROBE BTE 30","nom":"SPASFON (phloroglucinol, triméthylphloroglucinol), comprimés enrobés (B/30)","image_url":"https://assets.medipim.fr/media/medium/3942c74684955bd54115cd9efd67b292.png","boite":{"marque":"SPASFON","dosage":null,"forme":"Comprimés","labo":"Teva"},"pv":1.93,"pn":1.7,"pct":11.9,"remise_eur":0.23,"price_tiers":[{"pct":13.5,"price":1.67,"min_qty":240}],"regle_qte":{"step":240,"min":240,"multiple":240,"libelle":"Se commande par 240 (carton)"},"lot":{"qte":240,"pu":1.67,"total":400.8},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"stratege","label":"Sélection Stratège"},"popularite":"Plus de 100 pharmacies","libelle":"Comprimés","principal":true}]},
  {"cip":"3400949605538","nom_court":"IZALGI MYLAN 500MG/25MG BTE 16","nom_panier":"IZALGI MYLAN 500MG/25MG BTE 16","nom":"IZALGI 500 mg/25 mg (paracétamol, poudre d'opium), gélules sous plaquettes  thermoformées (PVC/Aluminium) B/16","image_url":"https://assets.medipim.fr/media/medium/0a506f62fa0ca3618d2e07d399df6994.png","boite":{"marque":"IZALGI","dosage":"500 mg/25 mg","forme":"Gélules","labo":"Viatris"},"pv":1.43,"pn":1.2,"pct":16.1,"remise_eur":0.23,"price_tiers":[{"pct":17.5,"price":1.18,"min_qty":100}],"regle_qte":{"step":100,"min":100,"multiple":100,"libelle":"Se commande par 100 (carton)"},"lot":{"qte":100,"pu":1.18,"total":118},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"stratege","label":"Sélection Stratège"},"popularite":"Plus de 100 pharmacies","famille":"IZALGI","labo":"Viatris","tendance_pct":34,"nouveau":false,"serie_15j":[0.59,1,0.88,0.88,0.41,0.41,0.12,0.94,1,0.88,0.53,0.65,0.24,0.12,0.53],"variantes":[]},
  {"cip":"3400937784214","nom_court":"FLECTOR 1% GEL FL 100G BT 1","nom_panier":"FLECTOR 1% GEL FL 100G BT 1","nom":"FLECTOR 1 % (épolamine de diclofénac), gel, 100 g en flacon","image_url":"https://assets.medipim.fr/media/medium/895d3b3caaa23572edc6a8c4e048dd74.png","boite":{"marque":"FLECTOR","dosage":"1 %","forme":"Gel","labo":"IBSA"},"pv":2.42,"pn":2.19,"pct":9.5,"remise_eur":0.23,"price_tiers":null,"regle_qte":{"step":42,"min":42,"multiple":42,"libelle":"Se commande par 42 (carton)"},"lot":{"qte":42,"pu":2.19,"total":91.98},"stock":{"en_stock":true,"niveau":"ok"},"menu":{"key":"stratege","label":"Sélection Stratège"},"popularite":"Plus de 50 pharmacies","famille":"FLECTOR","labo":"IBSA","tendance_pct":16,"nouveau":false,"serie_15j":[0.5,0.55,0.45,0.65,0.45,0.3,0.05,0.65,0.7,0.45,1,0.5,0.8,0.1,0.9],"variantes":[]},
];
// Mises en avant d'exemple (badge « Aperçu ») : deux en vitrine cinéma (menu Précommande Vaseline, Ventoline au carton),
// une dans la grille (menu Claripharm) ; les menus promo sont ceux, réels, que lit l'aperçu (menu absent ou inactif :
// l'objet disparaît et le repli automatique prend sa place, comme en ligne).
function vedettesFictives() {
  const { famille, labo, tendance_pct, nouveau, serie_15j, variantes, popularite, ...offre } = ACCUEIL_FICTIF[1];   // eslint-disable-line no-unused-vars
  const objet = (id, type, emplacement, titre, fin, extra) => ({ id, type, emplacement, titre, accroche: "", badge: "Aperçu", fin, image: null, couleur: null, couleur_auto: null, ...extra });
  return { maj: null, repli: true, defilement: true, apercu: true, items: [
    objet("mea_apercu_vas", "menu", "vitrine", "Le baume culte, au prix de précommande", jourParis(10), { menu_id: "1792060000000" }),
    objet("mea_apercu_ven", "produit", "vitrine", "Ventoline au carton", jourParis(1), { couleur: "#2f6fa8", offre }),
    objet("mea_apercu_cla", "menu", "grille", "", null, { menu_id: "1792040000000" }),
    // outil du site (docs/accueil.md § 7.8) : chiffres d'exemple (aperçu ; règle du 21/10/2026 : « dès » et « jusqu'à −50 % »)
    objet("mea_apercu_per", "outil", "vitrine", "", null, { outil: "peremption", chiffres: { nb: 167, des: 0.44, jusqua: 50,
      mois: [jourParis(41).slice(0, 7), jourParis(130).slice(0, 7)], maj: new Date(Date.now() - 3 * 3600e3).toISOString() } }),
  ] };
}
export function accueilFictif() {
  const jours = Array.from({ length: 15 }, (_, i) => jourParis(i - 14));
  return { version: 1, genere_le: new Date(Date.now() - 2 * 3600e3).toISOString(), periode: { du: jours[0], au: jours[14], jours },
    slides: ACCUEIL_FICTIF.map((s, i) => ({ ...s, rang: i + 1 })), reserves: [], perime: false, apercu: true, vedettes: vedettesFictives() };
}
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

// ── Notifications de l'appli (cas « push-abonnement » et « push-admin ») : « Aperçu : aucune notification n'est envoyée » ──
// Le GET (clé publique, ouverture) reste réel sur un aperçu : l'abonnement du navigateur peut être pris, il n'est jamais
// enregistré et rien ne lui est envoyé.
export function reponsePushFictive(b = {}) {
  if (b.action === "statut") return { disponible: true, raison: null, cle_publique: null, plafond_offres_7j: 2, categories_disponibles: categoriesAffichees(2),
    appareil: null, autre_identite: false, appareils: [], apercu: true };
  if (b.action === "oublier") return { success: true, role: null, apercu: true };
  return { success: true, apercu: true };
}
export function reponsePushAdminFictive(b = {}) {
  const vide = { stock: 0, commandes: 0, offres: 0 };
  switch (b.action) {
    case "etat": return { apercu: true, disponible: true, service: { vapid_publique: true, vapid_privee: true, vapid_paire: true, sujet: true, sujet_defaut: false,
      cle_serveur: true, cron_secret: true, tables: true, defauts: [] }, sujet_affiche: "mailto:pharmacien@elixirpharma.fr", cle_publique: null, reglages: REGLAGES_DEFAUT,
      stats: { pharmacies: 0, appareils: 0, par_categorie: vide, par_plateforme: { ios: 0, android: 0, ordinateur: 0, autre: 0 }, installes: 0, en_echec: 0, vus_30j: 0 },
      pharmacies: [], mes_appareils: [], hotes_refuses: [], appareil_inconnu: null };
    case "estimer": return { apercu: true, visees: 0, plafonnees: 0, recevront: 0, appareils: 0, fermee: false, plafond_offres_7j: 2 };
    case "envoyer": return { apercu: true, annonce: { id: "apercu", statut: "envoyee", created_at: new Date().toISOString() } };
    case "historique": return { apercu: true, annonces: [] };
    case "pharmacie": return { apercu: true, appareils: [], raison: null, disponible: true };
    case "retirer_pharmacie": return { apercu: true, success: true, retires: 0 };
    case "test": case "apercu": return { apercu: true, envoyes: 0, echecs: 0, retires: 0 };
    case "reglages": return { apercu: true, reglages: { ...REGLAGES_DEFAUT, ...(b.reglages || {}) } };
    default: return { apercu: true, success: true };
  }
}
