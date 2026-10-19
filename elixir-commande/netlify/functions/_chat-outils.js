// ── Assistant Elixir : les 7 outils (définitions, validation, exécution) ──
// Contrat : docs/assistant-contrat.md (« Outils », « Cartes UiAction ») ; conception § 2.5 et § 1.3.
// Définitions JSON (`strict: true`, ordre et octets stables) : _chat-outils-liste.js, réexportées ici. Le mode strict
// ne prend ni bornes (min/max, longueurs) ni motifs : ils sont vérifiés ici par Zod.
// Les lectures passent toutes par _chat-perimetre.js (filtres de la fiche imposés). Le modèle ne reçoit qu'une
// liste blanche de champs (≤ 20 éléments, textes libres ≤ 120 caractères) ; les chiffres qui font foi sont
// ceux des cartes (ui_actions), construites ici, jamais à partir du texte du modèle.
import { z } from "zod";
import { MOTIFS, SOUHAITS, CATEGORIES } from "./_chat-outils-liste.js";
import {
  listerPieces, piecesPourDuplicata, donneesReleve, listerCommandes, commandesSite, detailCommande, construireRetour,
  combinaisonValide, SOUHAITS_PAR_MOTIF, MSG_DOC_INCONNU, DELAI_RETOUR_JOURS, jourParis, jourPlus, jourValide, moisAvant, jourFr,
  analyserRecherche, depsParDefaut, tronquer,
} from "./_chat-perimetre.js";
import { calculerReleve, MENTION_RELEVE } from "./_chat-releve.js";
import { REGLAGES_DEFAUT, fusionnerReglages, lireReglages, journalJson } from "./_chat-config.js";

// ── Définitions, version et textes d'attente : _chat-outils-liste.js (sans dépendance, lu seul par chat.js) ──
export { OUTILS, VERSION_OUTILS, ETAPES } from "./_chat-outils-liste.js";

// ── Validation (bornes vérifiées ici : le mode strict ne les prend pas) ──
const date = z.string().refine(jourValide, "date AAAA-MM-JJ attendue");
const texte = (max) => z.string().trim().max(max, `${max} caractères au plus`);
const texteNul = (max) => texte(max).nullable().transform(v => (v ? v : null));
const page = z.number().int("nombre entier attendu").min(1, "1 au moins").max(50, "50 au plus");
const SCHEMAS = {
  rechercher_factures: z.strictObject({ date_debut: date.nullable(), date_fin: date.nullable(), type_document: z.enum(["factures", "avoirs", "tous"]),
    recherche: texteNul(60), page }),
  duplicata_facture: z.strictObject({ numero: texteNul(40), date: date.nullable(), envoi: z.enum(["telechargement", "email_compte"]) }),
  releve_facturation: z.strictObject({ date_debut: date, date_fin: date, detail: z.enum(["par_document", "par_produit"]) }),
  rechercher_commandes: z.strictObject({ date_debut: date.nullable(), date_fin: date.nullable(),
    etat: z.enum(["toutes", "en_cours", "sorties", "partiellement_servies", "facturees"]), recherche: texteNul(60), page }),
  detail_commande: z.strictObject({ reference: texte(40).min(3, "référence trop courte") }),
  preparer_demande_retour: z.strictObject({ reference_document: texte(40).min(3, "référence trop courte"), motif: z.enum(MOTIFS), souhait: z.enum(SOUHAITS),
    lignes: z.array(z.strictObject({ produit: texte(120).min(2, "produit manquant"), quantite: z.number().int("nombre entier attendu").min(1, "1 au moins").max(9999, "9999 au plus"),
      lot: texteNul(40) })).min(1, "au moins une ligne").max(30, "30 lignes au plus"),
    commentaire: texteNul(1000) }),
  transmettre_a_un_conseiller: z.strictObject({ categorie: z.enum(CATEGORIES), resume: texte(1500).min(10, "résumé trop court"), reference: texteNul(60),
    urgence: z.enum(["normale", "urgente"]), rappel: z.enum(["email", "telephone", "indifferent"]) }),
};
const resumeZod = (e) => e.issues.slice(0, 4).map(i => `${i.path.join(".") || "entrée"} : ${i.message}`).join(" ; ");

// ── Libellés ────────────────────────────────────────────────────────────
export const LIBELLES_MOTIF = {
  produit_manquant: "Produit non reçu", reliquat: "Reliquat (non livré ni facturé)", erreur_produit: "Mauvais produit reçu",
  quantite_incorrecte: "Quantité incorrecte", produit_casse: "Produit endommagé", caisse_manquante: "Caisse ou carton manquant",
  mauvaise_caisse: "Mauvaise caisse ou carton reçu", commande_non_recue: "Commande non reçue", mauvaise_commande_recue: "Commande d'une autre pharmacie reçue",
  retour_erreur_pharmacie: "Produit commandé par erreur", dlu_courte: "Date de péremption trop courte", ecart_facture: "Écart entre la facture et la livraison", autre: "Autre",
};
export const LIBELLES_SOUHAIT = {
  renvoi: "Renvoi du produit", avoir: "Un avoir", garde: "Conserver le produit", reprise: "Reprise du produit", remise: "Une remise (produit conservé)",
  recevoir_reliquat: "Recevoir le reliquat dès disponibilité", annule_reliquat: "Annuler le reliquat", non_precise: "Non précisé",
};
// motifs où la marchandise repart physiquement : la règle des 10 jours calendaires s'applique (information seulement)
const RETOUR_PHYSIQUE = new Set(["retour_erreur_pharmacie", "dlu_courte", "produit_casse", "erreur_produit", "mauvaise_caisse", "mauvaise_commande_recue"]);
const MSG_CONSEILLER_SEUL = "Je ne peux pas consulter les documents de ce compte. Je peux transmettre votre demande à un conseiller Elixir.";
const MSG_INDISPONIBLE = "Information momentanément indisponible. Réessayez dans un instant ou proposez la transmission à un conseiller.";

// ── Sortie vers le modèle : liste blanche, ≤ 20 éléments, textes libres ≤ 120 caractères ──
const INTERDITS = new Set(["payment_state", "amount_residual", "amount_residual_signed", "credit", "partner_credit", "access_token", "access_url",
  "pharmaml_key", "narration", "email", "phone", "mobile", "id", "product_id", "lot_id", "picking_id", "ids_odoo"]);
const TEXTES_SERVEUR = new Set(["message", "note", "info_delai", "raison", "libelle", "etat"]);   // phrases écrites ici, plafonnées à 300
export function borner(v, cle = null) {
  if (Array.isArray(v)) return v.slice(0, 20).map(x => borner(x));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!INTERDITS.has(k) && x !== undefined) o[k] = borner(x, k);
    return o;
  }
  if (typeof v === "string") return tronquer(v, TEXTES_SERVEUR.has(cle) ? 300 : 120);
  return v;
}
const ok = (contenu, ui_actions = []) => ({ contenu, erreur: false, ui_actions });
const echec = (message, extra = {}) => ({ contenu: { message, ...extra }, erreur: true, ui_actions: [] });

// réglages : passés par l'appelant (deps.reglages), sinon lus dans le stock, sinon défauts
async function reglages(d) {
  if (d.reglages) return fusionnerReglages(d.reglages);
  if (d.stock?.reglages?.lire) return lireReglages(d).catch(() => fusionnerReglages(null));
  return fusionnerReglages(REGLAGES_DEFAUT);
}
// quota de téléchargements sur 24 h glissantes (compté dans chat_fichiers) → message, ou null
async function quotaFichiers(ctx, d, R, besoin) {
  const max = Number(R.quotas?.fichiers_jour);
  if (!Number.isFinite(max) || !d.stock?.compter?.fichiers) return null;
  const n = await d.stock.compter.fichiers(ctx.odooId, new Date(d.maintenant().getTime() - 86400e3).toISOString());
  const deja = Array.isArray(n) ? n.length : Number(n) || 0;
  return deja + besoin > max ? `Limite de ${max} fichiers par 24 heures atteinte. Réessayez plus tard ou appelez Elixir au ${R.telephone}.` : null;
}
const creerFichier = (ctx, d, type, params) => d.stock.fichiers.creer({ odoo_id: ctx.odooId, type, params, ttl_min: 15, usages_max: 3 });

// ── Formes renvoyées ────────────────────────────────────────────────────
const docModele = (p) => ({ piece: p.piece, numero: p.numero, date: p.date, montant_ht: p.montant_ht, montant_tva: p.montant_tva, montant_ttc: p.montant_ttc,
  commandes: p.commandes.length, pdf_disponible: p.pdf_disponible, ...(p.piece === "avoir" ? { avoir_de: p.avoir_de || null, motif: p.motif || null } : {}) });
const docCarte = (p) => ({ piece: p.piece, numero: p.numero, date: p.date, montant_ttc: p.montant_ttc, pdf_disponible: p.pdf_disponible });
const carteDocuments = (pieces) => (pieces.length ? [{ type: "documents", items: pieces.slice(0, 20).map(docCarte) }] : []);

// période d'une recherche : bornée à aujourd'hui et à la profondeur des réglages
function periode(debut, fin, defautJours, profondeurMois, d) {
  const auj = jourParis(d.maintenant());
  const limite = moisAvant(auj, profondeurMois);
  let f = fin && fin < auj ? fin : auj;
  let deb = debut || jourPlus(f, -defautJours);
  let note = null;
  if (deb < limite) { deb = limite; note = `Recherche limitée aux ${profondeurMois} derniers mois.`; }
  if (f < deb) f = deb;
  return { debut: deb, fin: f, note };
}

// ═══ Exécutants ═════════════════════════════════════════════════════════
const EXECUTANTS = {
  async rechercher_factures(e, ctx, d, R) {
    if (e.date_debut && e.date_fin && e.date_debut > e.date_fin) return echec("La date de début est postérieure à la date de fin.");
    // un numéro cherché sans période : toute la profondeur (24 mois), sinon 90 jours
    const p = periode(e.date_debut, e.date_fin, e.recherche ? 9999 : 90, R.profondeur.factures_mois, d);
    const { total, pieces } = await listerPieces(ctx, { debut: p.debut, fin: p.fin, type: e.type_document, recherche: e.recherche, page: e.page }, d);
    const contenu = { periode: { debut: p.debut, fin: p.fin }, total, page: e.page, pages: Math.max(1, Math.ceil(total / 20)), documents: pieces.map(docModele),
      ...(p.note ? { note: p.note } : {}) };
    if (!total) contenu.message = e.recherche ? "Aucun document ne correspond à cette recherche pour votre pharmacie sur la période." : "Aucun document sur cette période.";
    return ok(contenu, carteDocuments(pieces));
  },

  async duplicata_facture(e, ctx, d, R) {
    if (!e.numero && !e.date) return echec("Indiquez le numéro du document ou sa date de facture.");
    const { pieces, proches } = await piecesPourDuplicata(ctx, { numero: e.numero, date: e.numero ? null : e.date }, d);
    if (!pieces.length) {
      if (e.numero) return ok({ trouve: false, message: MSG_DOC_INCONNU });
      return ok({ trouve: false, date: e.date, message: proches.length ? "Aucun document à cette date. Les plus proches sont listés : demandez lequel." : "Aucun document à cette date.",
        proches: proches.map(docModele) }, carteDocuments(proches));
    }
    if (pieces.length > 1) return ok({ trouve: true, message: "Plusieurs documents correspondent : demandez lequel.", candidats: pieces.map(docModele) }, carteDocuments(pieces));
    const p = pieces[0];
    const email = e.envoi === "email_compte" ? { envoi: "L'envoi par e-mail n'est pas encore proposé : le document est à télécharger sous la réponse." } : {};
    if (!p.pdf_disponible) {
      return ok({ trouve: true, document: docModele(p), message: "Ce document n'a pas encore été émis au format PDF : proposez de transmettre la demande à un conseiller.", ...email },
        [{ type: "document", ...docCarte(p), pdf_disponible: false, fichier_id: null }]);
    }
    const quota = await quotaFichiers(ctx, d, R, 1);
    if (quota) return ok({ trouve: true, document: docModele(p), message: quota });
    const fichier_id = await creerFichier(ctx, d, "facture", { move_id: p.id, numero: p.numero });
    return ok({ trouve: true, document: docModele(p), message: "Le document est disponible au téléchargement sous la réponse.", ...email },
      [{ type: "document", ...docCarte(p), pdf_disponible: true, fichier_id }]);
  },

  async releve_facturation(e, ctx, d, R) {
    const auj = jourParis(d.maintenant());
    const fin = e.date_fin > auj ? auj : e.date_fin, debut = e.date_debut;
    if (debut > fin) return echec("La date de début est postérieure à la date de fin (ou à aujourd'hui).");
    const limite = moisAvant(auj, R.profondeur.factures_mois);
    if (debut < limite) return echec(`Le relevé ne remonte pas au-delà de ${R.profondeur.factures_mois} mois (depuis le ${jourFr(limite)}).`);
    if (debut < jourPlus(moisAvant(fin, R.profondeur.releve_mois), 1)) return echec(`Un relevé couvre ${R.profondeur.releve_mois} mois au plus : découpez la période.`);
    const rel = calculerReleve(await donneesReleve(ctx, debut, fin, {}, d));
    const resume = { debut, fin, nb_factures: rel.nb_factures, nb_avoirs: rel.nb_avoirs, total_ht: rel.total_ht, total_tva: rel.total_tva, total_ttc: rel.total_ttc, tva: rel.tva };
    if (!rel.nb_factures && !rel.nb_avoirs) return ok({ ...resume, message: "Aucune facture ni aucun avoir sur cette période." });
    const quota = await quotaFichiers(ctx, d, R, 2);
    if (quota) return ok({ ...resume, mention: MENTION_RELEVE, message: quota });
    const params = { debut, fin, detail: e.detail };
    const pdf = await creerFichier(ctx, d, "releve", { ...params, format: "pdf" });
    const xlsx = await creerFichier(ctx, d, "releve", { ...params, format: "xlsx" });
    return ok({ ...resume, mention: MENTION_RELEVE, message: "Le relevé (PDF et Excel) est disponible sous la réponse." },
      [{ type: "releve", ...resume, fichiers: { pdf, xlsx }, mention: MENTION_RELEVE }]);
  },

  async rechercher_commandes(e, ctx, d, R) {
    if (e.date_debut && e.date_fin && e.date_debut > e.date_fin) return echec("La date de début est postérieure à la date de fin.");
    // une référence ou un produit cherché sans période : toute la profondeur (6 mois), sinon 14 jours
    const rech = analyserRecherche(e.recherche);
    const p = periode(e.date_debut, e.date_fin, rech ? 9999 : 14, R.profondeur.commandes_mois, d);
    const r = await listerCommandes(ctx, { debut: p.debut, fin: p.fin, etat: e.etat, recherche: e.recherche, page: e.page }, d);
    // commandes envoyées du site pas encore visibles dans Odoo (médiane d'arrivée ≈ 2 h) : page 1 seulement. Leur libellé
    // d'article n'est jamais lu (texte écrit sans authentification) : recherche par référence du site ou par CIP seulement
    let site = [];
    if (e.page === 1 && (e.etat === "toutes" || e.etat === "en_cours")) {
      site = (await commandesSite(ctx, { debut: p.debut, fin: p.fin }, d)).filter(s => s.etat !== "dans_odoo").filter(s => {
        if (!rech) return true;
        if (rech.type === "site") return s.reference_site === rech.valeur;
        if (rech.type === "cip") return s.produits.some(x => x.cip === rech.valeur || x.cip?.slice(5, 12) === rech.valeur);
        return false;
      });
    }
    const contenu = {
      periode: { debut: p.debut, fin: p.fin }, total: r.total, page: e.page, pages: Math.max(1, Math.ceil(r.total / 20)),
      commandes: r.commandes.map(c => ({ reference: c.reference, date: c.date, heure: c.heure, origine: c.origine, etat: c.etat, lignes: c.lignes,
        lignes_non_servies: c.lignes_non_servies, lignes_partielles: c.lignes_partielles, factures: c.factures, ...(c.avoirs?.length ? { avoirs: c.avoirs } : {}),
        ...(c.commande_site_id ? { reference_site: c.commande_site_id } : {}) })),
      ...(site.length ? { commandes_site_pas_encore_visibles: site.map(s => ({ reference_site: s.reference_site, date: s.date, heure: s.heure, origine: s.origine,
        lignes: s.lignes, etat: s.libelle })) } : {}),
    };
    const note = [p.note, r.limite ? "Recherche limitée aux 200 commandes les plus récentes de la période." : null].filter(Boolean).join(" ");
    if (note) contenu.note = note;
    if (!r.total && !site.length) contenu.message = "Aucune commande ne correspond pour votre pharmacie sur la période.";
    return ok(contenu);
  },

  async detail_commande(e, ctx, d) {
    const r = await detailCommande(ctx, e.reference, d);
    if (!r) return ok({ trouve: false, message: "Aucune commande de cette référence pour votre pharmacie." });
    const contenu = {
      trouve: true,
      commandes: r.commandes.map(c => ({ reference: c.reference, date: c.date, heure: c.heure, origine: c.origine, etat: c.etat,
        etapes: c.etapes.filter(x => x.fait).map(x => x.libelle), lignes_total: c.lignes.length,
        lignes: c.lignes.map(l => ({ produit: l.produit, cip: l.cip, commande: l.commande, servi: l.servi, non_servi: l.non_servi, facture: l.facture })),
        lots: c.lots, factures: c.factures, ...(c.avoirs?.length ? { avoirs: c.avoirs } : {}), ...(c.retours.length ? { retours: c.retours } : {}) })),
      ...(r.site && !r.commandes.length ? { commande_site: { reference_site: r.site.reference_site, date: r.site.date, heure: r.site.heure, origine: r.site.origine,
        lignes: r.site.lignes, etat: r.site.libelle, produits: r.site.produits } } : {}),
    };
    if (r.commandes.length > 1) contenu.note = "Cette commande du site a été répartie sur plusieurs commandes de préparation.";
    const ui = r.commandes.map(c => ({ type: "commande", reference: c.reference, date: c.date, origine: c.origine, etapes: c.etapes,
      lignes: c.lignes.map(l => ({ produit: l.produit, cip: l.cip, commande: l.commande, servi: l.servi, non_servi: l.non_servi })),
      lots: c.lots, factures: c.factures, ...(c.avoirs?.length ? { avoirs: c.avoirs } : {}), commande_site_id: c.commande_site_id || null }));
    return ok(contenu, ui);
  },

  async preparer_demande_retour(e, ctx, d) {
    if (!combinaisonValide(e.motif, e.souhait)) {
      const possibles = [...(SOUHAITS_PAR_MOTIF[e.motif] || []), "non_precise"].map(s => `${s} (${LIBELLES_SOUHAIT[s]})`).join(", ");
      return echec(`Ce souhait ne correspond pas au motif « ${LIBELLES_MOTIF[e.motif]} ». Souhaits possibles : ${possibles}.`);
    }
    const r = await construireRetour(ctx, { reference_document: e.reference_document, motif: e.motif, souhait: e.souhait, commentaire: e.commentaire,
      lignes: e.lignes.map(l => ({ produit: l.produit, lot: l.lot, quantite: l.quantite })) }, d);
    if (!r.ok) {
      if (r.raison === MSG_DOC_INCONNU) return ok({ trouve: false, message: MSG_DOC_INCONNU });
      return r.a_preciser ? ok({ message: r.raison, a_preciser: r.a_preciser }) : echec(r.raison);
    }
    const b = r.brouillon;
    const { demande_id, expire_at } = await d.demandes.creerBrouillon(ctx, b);
    const info_delai = infoDelai(e.motif, b);
    const lignes = b.lignes.map(l => ({ produit: l.produit, cip: l.cip, lot: l.lot, peremption: l.peremption, quantite: l.quantite }));
    return ok({
      message: "Récapitulatif affiché sous la réponse : rien n'est envoyé tant que la pharmacie n'a pas cliqué sur « Confirmer la demande ».",
      document: { numero: b.document.numero, date_sortie: b.document.date_sortie }, lignes, motif: LIBELLES_MOTIF[e.motif], souhait: LIBELLES_SOUHAIT[e.souhait],
      hors_delai: b.hors_delai, info_delai,
    }, [{ type: "recap_retour", demande_id, expire_at, document: { numero: b.document.numero, date_sortie: b.document.date_sortie }, lignes,
      motif: LIBELLES_MOTIF[e.motif], souhait: LIBELLES_SOUHAIT[e.souhait], info_delai }]);
  },

  async transmettre_a_un_conseiller(e, ctx, d, R) {
    const urgence = e.categorie === "qualite" ? "urgente" : e.urgence;    // qualité : toujours urgente
    const conversation_id = d.conversation_id ?? ctx.conversation_id ?? null;
    const t = await d.demandes.transmettre(ctx, { categorie: e.categorie, resume: e.resume, reference: e.reference, urgence, rappel: e.rappel, conversation_id });
    const delai = t?.delai || R.delai_annonce;
    const carte = [{ type: "transmission", numero: t.numero, delai, telephone: R.telephone, horaires: R.horaires }];
    // demande de même catégorie déjà ouverte dans la conversation : complément envoyé, ou rien de nouveau (jamais « transmise »)
    if (t.deja_transmise) {
      return t.complement
        ? ok({ message: `Complément ajouté à la demande n° ${t.numero}, déjà transmise : l'équipe Elixir l'a reçu.`, numero: t.numero, delai, telephone: R.telephone, horaires: R.horaires }, carte)
        : ok({ message: `Cette demande est déjà transmise (n° ${t.numero}) : rien de nouveau n'a été envoyé.`, numero: t.numero, delai, telephone: R.telephone, horaires: R.horaires });
    }
    return ok({ message: "Demande transmise à l'équipe Elixir.", numero: t.numero, delai, telephone: R.telephone, horaires: R.horaires }, carte);
  },
};

// information sur le délai (jamais de refus automatique : le Pharmacien Responsable décide)
function infoDelai(motif, b) {
  const sortie = b.document.date_sortie;
  if (RETOUR_PHYSIQUE.has(motif)) {
    if (!sortie) return "Votre demande sera étudiée par le Pharmacien Responsable.";
    return b.hors_delai
      ? `La livraison date de plus de ${DELAI_RETOUR_JOURS} jours (sortie de l'entrepôt le ${jourFr(sortie)}) : votre demande sera étudiée au cas par cas par le Pharmacien Responsable.`
      : `Les retours sont étudiés par le Pharmacien Responsable, dans les ${DELAI_RETOUR_JOURS} jours calendaires suivant la livraison (ici jusqu'au ${jourFr(b.limite_retour)}).`;
  }
  return b.hors_delai && sortie
    ? `La livraison date de plus de ${DELAI_RETOUR_JOURS} jours (sortie de l'entrepôt le ${jourFr(sortie)}) : votre réclamation sera étudiée au cas par cas.`
    : "Votre réclamation sera étudiée par l'équipe Elixir.";
}

// Valide `entree` (Zod), applique le périmètre de ctx ; renvoie toujours { contenu, erreur, ui_actions } (ne lève pas)
// deps = { odoo, sb, stock, demandes, maintenant, reglages?, conversation_id? }
export async function executerOutil(nom, entree, ctx, deps = {}) {
  const t0 = Date.now();
  const schema = SCHEMAS[nom];
  if (!schema || !Object.hasOwn(EXECUTANTS, nom)) return echec("Outil inconnu.");
  const v = schema.safeParse(entree);
  if (!v.success) return echec(`Entrée invalide : ${resumeZod(v.error)}.`);
  if (!(Number(ctx?.odooId) > 0)) return echec(MSG_INDISPONIBLE);
  if (ctx.mode !== "complet" && nom !== "transmettre_a_un_conseiller") return echec(MSG_CONSEILLER_SEUL);
  const d = depsParDefaut(deps);
  try {
    const R = await reglages(d);
    const r = await EXECUTANTS[nom](v.data, ctx, d, R);
    journalJson({ evt: "outil", outil: nom, code: r.erreur ? "refus" : "ok", duree_ms: Date.now() - t0 });
    return { contenu: borner(r.contenu), erreur: !!r.erreur, ui_actions: r.ui_actions || [] };
  } catch (e) {
    // jamais le message d'erreur (il peut citer des données) : nom de l'erreur seulement
    journalJson({ evt: "outil", outil: nom, code: e?.public ? "refus" : "erreur", type: String(e?.name || "Error").slice(0, 40), duree_ms: Date.now() - t0 });
    return echec(e?.public ? tronquer(e.message, 300) : MSG_INDISPONIBLE);
  }
}
