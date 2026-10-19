// Tests des 7 outils de l'Assistant Elixir et de chat-fichier : node scripts/test-chat-outils.mjs
// Hors ligne : faux Odoo et faux Supabase de test-chat-perimetre.mjs, faux stock (autorisations de fichiers), fausses
// demandes (brouillons, transmissions). Aucun appel au modèle, aucune écriture réelle.
//  • définitions : 7 outils dans l'ordre, strict, toutes propriétés requises, additionalProperties false, aucun mot-clé
//    non pris en charge par le mode strict ; empreinte stable ; texte d'attente pour chaque outil ;
//  • validation Zod (bornes) → is_error ; fiche sans CIP → seul « transmettre » ;
//  • référence inconnue = référence d'une autre pharmacie (même sortie, pour chaque outil qui en prend une) ;
//  • duplicata par numéro, par date (0, 1, 2 candidats), avoir sans PDF ; relevé (totaux, TVA, 2 fichiers) ;
//  • commandes (site pas encore dans Odoo, non servie, sortie d'entrepôt) ; retours (quantité ≤ livrée − retournée,
//    lots, reliquat, combinaisons motif/souhait) ; revaliderRetour après un nouveau retour ; transmission (qualité urgente) ;
//  • aucun champ interdit dans ce qui sort (payment_state, amount_residual, access_token, pharmaml_key, credit, narration) ;
//  • chat-fichier : PDF d'origine tel quel, relevé PDF/Excel, autre fiche → 404, en-têtes attachment/no-store/nosniff.
import { randomBytes } from "node:crypto";
import { creerFauxOdoo, jeuOdoo, creerFauxSb, fauxJetons, MAINTENANT, evenement, controlerAppels, INJECTION } from "./test-chat-perimetre.mjs";
import { OUTILS, VERSION_OUTILS, ETAPES, executerOutil, borner } from "../netlify/functions/_chat-outils.js";
import { revaliderRetour } from "../netlify/functions/_chat-perimetre.js";
import { traiter } from "../netlify/functions/chat-fichier.js";

// journaux JSON de l'assistant (une ligne par outil) : masqués pendant les tests
const log = console.log;
console.log = (...a) => { if (typeof a[0] === "string" && a[0].startsWith('{"app":"assistant"')) return; log(...a); };
let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, cond, detail = "") => { if (cond) ok++; else { ko++; console.log("✗", label, detail); } };

// ── Définitions ─────────────────────────────────────────────────────────
const NOMS = ["rechercher_factures", "duplicata_facture", "releve_facturation", "rechercher_commandes", "detail_commande", "preparer_demande_retour", "transmettre_a_un_conseiller"];
eq("7 outils, ordre figé", OUTILS.map(o => o.name), NOMS);
eq("strict partout", OUTILS.every(o => o.strict === true), true);
const CLES_OK = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "description", "format"]);
const fautesSchema = [];
const parcourir = (s, ou) => {
  for (const k of Object.keys(s)) if (!CLES_OK.has(k)) fautesSchema.push(`${ou} : mot-clé non pris en charge « ${k} »`);
  if (s.format && s.format !== "date") fautesSchema.push(`${ou} : format ${s.format}`);
  if (s.type === "object") {
    if (s.additionalProperties !== false) fautesSchema.push(`${ou} : additionalProperties`);
    if (JSON.stringify([...(s.required || [])].sort()) !== JSON.stringify(Object.keys(s.properties || {}).sort())) fautesSchema.push(`${ou} : propriétés non toutes requises`);
    for (const [k, v] of Object.entries(s.properties || {})) parcourir(v, `${ou}.${k}`);
  }
  if (s.items) parcourir(s.items, `${ou}[]`);
  for (const [i, v] of (s.anyOf || []).entries()) parcourir(v, `${ou}|${i}`);
};
for (const o of OUTILS) parcourir(o.input_schema, o.name);
eq("schémas compatibles avec le mode strict", fautesSchema, []);
eq("définitions figées et stables", [Object.isFrozen(OUTILS), JSON.stringify(OUTILS) === JSON.stringify(JSON.parse(JSON.stringify(OUTILS))), /^outils-[0-9a-f]{12}$/.test(VERSION_OUTILS)], [true, true, true]);
eq("texte d'attente pour chaque outil", NOMS.every(n => typeof ETAPES[n] === "string" && ETAPES[n].endsWith("…")), true);
eq("duplicata : envoi telechargement | email_compte", OUTILS[1].input_schema.properties.envoi.enum, ["telechargement", "email_compte"]);

// ── Doublures ───────────────────────────────────────────────────────────
function creerFauxStock() {
  const fichiers = new Map(), crees = [];
  return { crees, fichiers: {
    async creer(o) { const id = randomBytes(16).toString("hex"); fichiers.set(id, { ...structuredClone(o), usages: 0 }); crees.push({ id, ...o }); return id; },
    async consommer(id, odooId) { const f = fichiers.get(id); if (!f || f.odoo_id !== Number(odooId) || f.usages >= f.usages_max) return null; f.usages++; return { id, odoo_id: f.odoo_id, type: f.type, params: f.params }; },
  }, compter: { async fichiers(odooId) { return crees.filter(c => c.odoo_id === Number(odooId)).length; } } };
}
function creerFaussesDemandes() {
  const d = { brouillons: [], transmissions: [] };
  d.creerBrouillon = async (ctx, b) => { d.brouillons.push({ odooId: ctx.odooId, b: structuredClone(b) }); return { demande_id: `dem-${d.brouillons.length}`, expire_at: "2026-10-19T10:30:00.000Z" }; };
  // réponse imposée (d.prochaine) : transmission déjà ouverte dans la conversation (complément, ou rien de nouveau)
  d.transmettre = async (ctx, t) => { d.transmissions.push({ odooId: ctx.odooId, t }); const p = d.prochaine; d.prochaine = null;
    return p || { numero: `T-2026-000${d.transmissions.length}`, delai: null }; };
  return d;
}
const faux = creerFauxOdoo(jeuOdoo());
const fsb = creerFauxSb();
const stock = creerFauxStock();
const demandes = creerFaussesDemandes();
const REGLAGES = { telephone: "01 23 45 67 89", horaires: "lun-ven 9 h-18 h", delai_annonce: "Réponse sous 24 h ouvrées (du lundi au vendredi)." };
const deps = { odoo: faux.odoo, sb: fsb.sb, stock, demandes, maintenant: MAINTENANT, reglages: REGLAGES, conversation_id: "conv-1", ...fauxJetons };
const ctxA = { odooId: 100, cip: "1111111", nom: "PHARMACIE A", ville: "Ville 100", compteEmail: "a@pharma-a.test", comptes: ["a@pharma-a.test"], admin: null, mode: "complet" };
const sorties = [];
const outil = async (nom, entree, ctx = ctxA, d = deps) => { const r = await executerOutil(nom, entree, ctx, d); sorties.push(r); return r; };
const F = (e = {}) => ({ date_debut: null, date_fin: null, type_document: "tous", recherche: null, page: 1, ...e });
const C = (e = {}) => ({ date_debut: null, date_fin: null, etat: "toutes", recherche: null, page: 1, ...e });
const R = (e = {}) => ({ reference_document: "S300003", motif: "retour_erreur_pharmacie", souhait: "avoir", commentaire: null, lignes: [{ produit: "3400930000028", quantite: 1, lot: null }], ...e });

// ── Validation et mode limité ──
eq("entrée invalide (date) → is_error", (await outil("rechercher_factures", F({ date_debut: "2026-02-30" }))).erreur, true);
eq("entrée invalide (propriété en trop) → is_error", (await outil("detail_commande", { reference: "S300003", pharmacie: 200 })).erreur, true);
eq("entrée invalide (31 lignes) → is_error", (await outil("preparer_demande_retour", R({ lignes: Array(31).fill({ produit: "x1", quantite: 1, lot: null }) }))).erreur, true);
eq("page hors bornes → is_error", (await outil("rechercher_commandes", C({ page: 0 }))).erreur, true);
eq("outil inconnu → is_error", (await outil("lire_tout", {})).erreur, true);
const ctxC = { odooId: 300, cip: null, nom: "PHARMACIE C", mode: "conseiller_seul", comptes: [] };
const lim = await outil("rechercher_factures", F(), ctxC);
eq("fiche sans CIP : factures refusées, message neutre", [lim.erreur, /conseiller/.test(lim.contenu.message), /CIP|bloqu|impay/i.test(lim.contenu.message)], [true, true, false]);
eq("fiche sans CIP : transmission possible", (await outil("transmettre_a_un_conseiller", { categorie: "compte", resume: "La pharmacie demande l'accès à ses factures.", reference: null, urgence: "normale", rappel: "telephone" }, ctxC)).erreur, false);

// ── Factures ──
const f90 = await outil("rechercher_factures", F());
eq("90 jours par défaut (autre société, brouillon exclus)", [f90.contenu.periode, f90.contenu.total], [{ debut: "2026-07-21", fin: "2026-10-19" }, 5]);
eq("carte documents (montants des cartes)", f90.ui_actions[0].items[0], { piece: "facture", numero: "INV/2026/40010", date: "2026-10-14", montant_ttc: 51.05, pdf_disponible: true });
const fInc = await outil("rechercher_factures", F({ recherche: "INV/2026/49999" }));
const fAut = await outil("rechercher_factures", F({ recherche: "INV/2026/40050" }));
eq("recherche : numéro inconnu = numéro d'une autre pharmacie", fAut, fInc);
eq("recherche par produit (lignes de facture de la fiche)", (await outil("rechercher_factures", F({ recherche: "spasfon" }))).contenu.documents.map(d => d.numero), ["INV/2026/40003", "INV/2026/40001"]);
eq("recherche par commande", (await outil("rechercher_factures", F({ recherche: "S300003" }))).contenu.documents.map(d => d.numero), ["INV/2026/40003", "INV/2026/40002"]);
eq("avoirs seulement", (await outil("rechercher_factures", F({ type_document: "avoirs" }))).contenu.documents.map(d => [d.numero, d.montant_ttc, d.avoir_de]),
  [["RINV/2026/00501", -20.42, "INV/2026/40001"]]);
eq("profondeur : 24 mois au plus", (await outil("rechercher_factures", F({ date_debut: "2020-01-01" }))).contenu.note, "Recherche limitée aux 24 derniers mois.");

// ── Duplicata ──
const dup = await outil("duplicata_facture", { numero: "INV/2026/40001", date: null, envoi: "telechargement" });
const carte = dup.ui_actions[0];
eq("duplicata par numéro : carte document", { ...carte, fichier_id: /^[0-9a-f]{32}$/.test(carte.fichier_id) },
  { type: "document", piece: "facture", numero: "INV/2026/40001", date: "2026-09-03", montant_ttc: 162.1, pdf_disponible: true, fichier_id: true });
eq("autorisation : fiche, type, pièce, 15 min, 3 usages", (({ odoo_id, type, params, ttl_min, usages_max }) => ({ odoo_id, type, params, ttl_min, usages_max }))(stock.crees.at(-1)),
  { odoo_id: 100, type: "facture", params: { move_id: 1001, numero: "INV/2026/40001" }, ttl_min: 15, usages_max: 3 });
const dInc = await outil("duplicata_facture", { numero: "INV/2026/49999", date: null, envoi: "telechargement" });
const dAut = await outil("duplicata_facture", { numero: "INV/2026/40050", date: null, envoi: "telechargement" });
eq("duplicata : numéro inconnu = numéro d'une autre pharmacie", dAut, dInc);
eq("duplicata : message unique", dInc.contenu.message, "Aucun document de ce numéro pour votre pharmacie.");
const d0 = await outil("duplicata_facture", { numero: null, date: "2026-09-10", envoi: "telechargement" });
eq("par date, 0 candidat : documents les plus proches", [d0.contenu.trouve, d0.ui_actions[0].type, d0.ui_actions[0].items.map(i => i.numero)], [false, "documents", ["RINV/2026/00502", "INV/2026/40001", "INV/2026/40002", "INV/2026/40003"]]);
const d1 = await outil("duplicata_facture", { numero: null, date: "2026-09-03", envoi: "telechargement" });
eq("par date, 1 candidat : carte document", [d1.ui_actions[0].type, d1.ui_actions[0].numero], ["document", "INV/2026/40001"]);
const d2 = await outil("duplicata_facture", { numero: null, date: "2026-09-15", envoi: "telechargement" });
eq("par date, 2 candidats : choix", [d2.ui_actions[0].type, d2.ui_actions[0].items.map(i => i.numero)], ["documents", ["INV/2026/40003", "INV/2026/40002"]]);
const nAvant = stock.crees.length;
const dav = await outil("duplicata_facture", { numero: "RINV/2026/00501", date: null, envoi: "telechargement" });
eq("avoir sans PDF : pas d'autorisation, proposition de transmission", [dav.ui_actions[0].pdf_disponible, dav.ui_actions[0].fichier_id, stock.crees.length === nAvant, /conseiller/.test(dav.contenu.message)],
  [false, null, true, true]);
eq("ni numéro ni date → is_error", (await outil("duplicata_facture", { numero: null, date: null, envoi: "telechargement" })).erreur, true);
eq("e-mail demandé : téléchargement seulement (aucune adresse prise dans la conversation)", typeof (await outil("duplicata_facture", { numero: "INV/2026/40002", date: null, envoi: "email_compte" })).contenu.envoi, "string");

// ── Relevé ──
const rel = await outil("releve_facturation", { date_debut: "2026-09-01", date_fin: "2026-09-30", detail: "par_document" });
const rc = rel.ui_actions[0];
eq("relevé : carte (totaux, TVA par taux, mention)", { ...rc, fichiers: { pdf: /^[0-9a-f]{32}$/.test(rc.fichiers.pdf), xlsx: /^[0-9a-f]{32}$/.test(rc.fichiers.xlsx) } },
  { type: "releve", debut: "2026-09-01", fin: "2026-09-30", nb_factures: 3, nb_avoirs: 1, total_ht: 370, total_tva: 27.68, total_ttc: 397.68,
    tva: [{ taux: 2.1, base: 80, montant: 1.68 }, { taux: 5.5, base: 200, montant: 11 }, { taux: 10, base: 30, montant: 3 }, { taux: 20, base: 60, montant: 12 }],
    fichiers: { pdf: true, xlsx: true }, mention: "Liste des documents émis ; ne reflète pas les règlements." });
eq("relevé : le modèle ne reçoit que les totaux", Object.keys(rel.contenu).includes("documents"), false);
eq("relevé > 12 mois → is_error", (await outil("releve_facturation", { date_debut: "2025-09-01", date_fin: "2026-09-30", detail: "par_document" })).erreur, true);
eq("relevé de 12 mois exactement accepté", (await outil("releve_facturation", { date_debut: "2025-10-01", date_fin: "2026-09-30", detail: "par_document" })).erreur, false);
eq("relevé au-delà de 24 mois → is_error", (await outil("releve_facturation", { date_debut: "2024-01-01", date_fin: "2024-06-30", detail: "par_document" })).erreur, true);
const stockPlein = creerFauxStock();
for (let i = 0; i < 20; i++) await stockPlein.fichiers.creer({ odoo_id: 100, type: "facture", params: {}, ttl_min: 15, usages_max: 3 });
const q = await outil("releve_facturation", { date_debut: "2026-09-01", date_fin: "2026-09-30", detail: "par_document" }, ctxA, { ...deps, stock: stockPlein });
eq("quota de fichiers (20 par 24 h) : aucune autorisation de plus", [q.ui_actions.length, stockPlein.crees.length, /01 23 45 67 89/.test(q.contenu.message)], [0, 20, true]);

// ── Commandes ──
const cm = await outil("rechercher_commandes", C());
eq("commandes des 14 derniers jours", cm.contenu.commandes.map(x => [x.reference, x.origine, x.lignes_non_servies]), [["S300005", "logiciel", 0], ["S300004", "logiciel", 2], ["S300008", "logiciel", 0]]);
eq("commande du site pas encore dans Odoo (état simplifié ; commande forgée : non vérifiée)", cm.contenu.commandes_site_pas_encore_visibles.map(x => [x.reference_site, x.etat]),
  [["1792400000000", "En cours de transmission à notre système de préparation"],
    ["1792600000000", "Commande enregistrée sur le site sans être rattachée à un compte de la pharmacie : Elixir doit la vérifier"],
    ["1792300000000", "Elixir doit vérifier cette commande"]]);
eq("jamais « livrée »", /livr[ée]e chez|livrée/i.test(JSON.stringify(cm.contenu)), false);
eq("commandes partiellement servies", (await outil("rechercher_commandes", C({ etat: "partiellement_servies" }))).contenu.commandes.map(x => x.reference), ["S300005"]);
eq("recherche par produit", (await outil("rechercher_commandes", C({ date_debut: "2026-09-01", recherche: "smecta" }))).contenu.commandes.map(x => x.reference), ["S300009", "S300002"]);
// une référence (ou un produit) cherchée sans dates : toute la profondeur, pas les 14 derniers jours
for (const [ref, attendu] of [["S300001", ["S300001"]], ["EP/OUT/1003", ["S300003"]], ["1791915880329", ["S300002"]], ["124714", ["S300005", "S300004", "S300003", "S300001", "S300010"]]]) {
  eq(`recherche « ${ref} » sans dates : retrouvée au-delà de 14 jours`, (await outil("rechercher_commandes", C({ recherche: ref }))).contenu.commandes.map(x => x.reference), attendu);
}
const cav = await outil("rechercher_commandes", C({ recherche: "S300010" }));
eq("commande avec avoir : facture et avoir séparés", [cav.contenu.commandes[0].factures, cav.contenu.commandes[0].avoirs], [["INV/2026/00123"], ["RINV/2026/00502"]]);
const dav10 = await outil("detail_commande", { reference: "S300010" });
eq("détail : avoir séparé dans la carte", [dav10.ui_actions[0].factures, dav10.ui_actions[0].avoirs, dav10.ui_actions[0].etapes[3].libelle], [["INV/2026/00123"], ["RINV/2026/00502"], "Facturée (INV/2026/00123)"]);
const dforge = await outil("detail_commande", { reference: "1792600000000" });
eq("commande du site forgée : non vérifiée, aucune consigne transmise au modèle", [/vérifier/.test(dforge.contenu.commande_site?.etat), JSON.stringify(dforge).includes("IMPORTANT")], [true, false]);
const dc = await outil("detail_commande", { reference: "S300008" });
eq("détail : frise (sortie le soir = lendemain à Paris)", dc.ui_actions[0].etapes.map(e => [e.cle, e.fait, e.date]),
  [["recue", true, "2026-10-15"], ["preparation", true, null], ["sortie", true, "2026-10-16"], ["facturee", true, "2026-10-14"]]);
eq("détail : libellé de sortie d'entrepôt", dc.ui_actions[0].etapes[2].libelle, "Sortie de l'entrepôt le 16/10/2026 (Chronopost)");
eq("détail : lots et péremptions (livraison validée)", dc.ui_actions[0].lots.map(l => [l.lot, l.peremption, l.quantite]), [["DA1", "2028-04-30", 4], ["DA2", "2028-04-30", 2]]);
const dz = await outil("detail_commande", { reference: "S300004" });
eq("commande entièrement à 0 : non servie, aucune étape au-delà de « reçue »", [dz.contenu.commandes[0].etat, dz.ui_actions[0].lignes.map(l => [l.commande, l.servi, l.non_servi]),
  dz.ui_actions[0].etapes.filter(e => e.fait).map(e => e.cle)], ["Non servie (aucun produit disponible)", [[5, 0, 5], [2, 0, 2]], ["recue"]]);
const dp = await outil("detail_commande", { reference: "S300005" });
eq("livraison non validée : pas de lots, servi = retenu", [dp.ui_actions[0].lots, dp.ui_actions[0].lignes[0]], [[], { produit: "DOLIPRANE 1000 mg cp B/8", cip: "3400930000011", commande: 10, servi: 6, non_servi: 4 }]);
const dcInc = await outil("detail_commande", { reference: "S999999" });
eq("détail : commande inconnue = commande d'une autre pharmacie", await outil("detail_commande", { reference: "S300006" }), dcInc);
eq("détail : livraison d'une autre pharmacie = inconnue", await outil("detail_commande", { reference: "EP/OUT/1006" }), dcInc);
eq("détail : commande du site d'une autre pharmacie = inconnue", await outil("detail_commande", { reference: "1792500000000" }), dcInc);
const ds = await outil("detail_commande", { reference: "1792400000000" });
eq("détail d'une commande du site pas encore dans Odoo : sans carte", [ds.ui_actions.length, ds.contenu.commande_site.etat], [0, "En cours de transmission à notre système de préparation"]);

// ── Retours ──
const r1 = await outil("preparer_demande_retour", R({ lignes: [{ produit: "3400930000028", quantite: 3, lot: null }] }));
eq("retour : livré 5 − déjà retourné 2 → 3 accepté", [r1.erreur, r1.ui_actions[0]?.type, r1.ui_actions[0]?.lignes], [false, "recap_retour",
  [{ produit: "SPASFON LYOC 80 mg B/10", cip: "3400930000028", lot: "SP456", peremption: "2028-04-30", quantite: 3 }]]);
const b1 = demandes.brouillons.at(-1).b;
eq("brouillon : forme du contrat", { ...b1, lignes: b1.lignes.map(l => Object.keys(l)) }, {
  reference_document: "S300003", document: { numero: "S300003", date_sortie: "2026-09-14", picking_id: 5003, picking_ids: [5003], facture_ids: [1002, 1004] },
  lignes: [["produit", "cip", "product_id", "lot", "lot_id", "peremption", "quantite", "quantite_max"]], motif: "retour_erreur_pharmacie", souhait: "avoir",
  commentaire: null, hors_delai: true, limite_retour: "2026-09-25" });
eq("carte : libellés, information de délai (jamais de refus)", [r1.ui_actions[0].motif, r1.ui_actions[0].souhait, /cas par cas/.test(r1.ui_actions[0].info_delai)],
  ["Produit commandé par erreur", "Un avoir", true]);
const r2 = await outil("preparer_demande_retour", R({ lignes: [{ produit: "SPASFON", quantite: 4, lot: null }] }));
eq("retour : 4 > 3 → refus avec le maximum", [r2.erreur, /3 au plus/.test(r2.contenu.message)], [true, true]);
const r3 = await outil("preparer_demande_retour", R({ reference_document: "S300008", lignes: [{ produit: "dafalgan", quantite: 1, lot: null }] }));
eq("plusieurs lots livrés : lot à préciser", [r3.erreur, r3.contenu.a_preciser?.[0]?.lots.map(l => l.lot)], [false, ["DA1", "DA2"]]);
eq("lot précis : DA2 (2 livrés) → 2 accepté", (await outil("preparer_demande_retour", R({ reference_document: "S300008", lignes: [{ produit: "3400930000059", quantite: 2, lot: "da-2" }] }))).erreur, false);
eq("lot précis : DA2 → 3 refusé", (await outil("preparer_demande_retour", R({ reference_document: "S300008", lignes: [{ produit: "3400930000059", quantite: 3, lot: "DA2" }] }))).erreur, true);
eq("même lot sur deux lignes : total contrôlé", (await outil("preparer_demande_retour", R({ reference_document: "S300008",
  lignes: [{ produit: "3400930000059", quantite: 2, lot: "DA2" }, { produit: "3400930000059", quantite: 1, lot: "DA2" }] }))).erreur, true);
eq("produit manquant : lot non exigé", (await outil("preparer_demande_retour", R({ reference_document: "S300008", motif: "produit_manquant", souhait: "renvoi",
  lignes: [{ produit: "dafalgan", quantite: 1, lot: null }] }))).erreur, false);
eq("produit absent du document → refus", (await outil("preparer_demande_retour", R({ lignes: [{ produit: "3400930000011", quantite: 1, lot: null }] }))).erreur, true);
eq("combinaison motif/souhait invalide → refus", (await outil("preparer_demande_retour", R({ motif: "dlu_courte", souhait: "renvoi" }))).erreur, true);
eq("par facture (commandes d'origine, contact enfant compris)", (await outil("preparer_demande_retour", R({ reference_document: "INV/2026/40001", motif: "produit_casse", souhait: "renvoi",
  lignes: [{ produit: "smecta", quantite: 2, lot: null }] }))).ui_actions[0]?.document, { numero: "INV/2026/40001", date_sortie: "2026-09-02" });
eq("reliquat : ≤ commandé − livré (10 − 6)", [(await outil("preparer_demande_retour", R({ reference_document: "S300001", motif: "reliquat", souhait: "recevoir_reliquat",
  lignes: [{ produit: "doliprane", quantite: 4, lot: null }] }))).erreur, (await outil("preparer_demande_retour", R({ reference_document: "S300001", motif: "reliquat",
  souhait: "recevoir_reliquat", lignes: [{ produit: "doliprane", quantite: 5, lot: null }] }))).erreur], [false, true]);
eq("commande pas encore sortie de l'entrepôt → refus", (await outil("preparer_demande_retour", R({ reference_document: "S300005", lignes: [{ produit: "doliprane", quantite: 1, lot: null }] }))).erreur, true);
const rInc = await outil("preparer_demande_retour", R({ reference_document: "S999999" }));
eq("retour : document inconnu = document d'une autre pharmacie", await outil("preparer_demande_retour", R({ reference_document: "S300006" })), rInc);
eq("retour : facture d'une autre pharmacie = inconnue", await outil("preparer_demande_retour", R({ reference_document: "INV/2026/40050" })), rInc);

// revalidation à la confirmation (lots 2-3-5)
const rv = await revaliderRetour(ctxA, b1, deps);
eq("revaliderRetour : toujours valide", [rv.ok, rv.brouillon?.lignes[0].quantite_max], [true, 3]);
faux.tables["stock.picking"].push({ id: 5009, name: "EP/IN/2002", sale_id: [300003, "S300003"], partner_id: [100, "Fiche 100"], company_id: [2, "Elixir"], state: "assigned",
  date_done: false, picking_type_code: "incoming", return_id: [5003, "EP/OUT/1003"] });
faux.tables["stock.move"].push({ id: 2, picking_id: [5009, "EP/IN/2002"], product_id: [12, "[3400930000028] SPASFON LYOC 80 mg B/10"], product_uom_qty: 2, quantity: 0, state: "assigned",
  picking_code: "incoming", origin_returned_move_id: [104, "SPASFON"], sale_line_id: false, company_id: [2, "Elixir"] });
const rv2 = await revaliderRetour(ctxA, b1, deps);
eq("revaliderRetour : un retour en cours entre-temps → refus (1 au plus)", [rv2.ok, /1 au plus/.test(rv2.raison)], [false, true]);
eq("revaliderRetour : brouillon d'une autre fiche → refus", (await revaliderRetour({ ...ctxA, odooId: 200, cip: "2222222" }, b1, deps)).ok, false);
const enPanne = await revaliderRetour(ctxA, b1, { ...deps, odoo: async () => { throw new Error("délai dépassé"); } });
eq("revaliderRetour : Odoo injoignable → temporaire", [enPanne.ok, enPanne.temporaire], [false, true]);

// ── Transmission ──
const tr = await outil("transmettre_a_un_conseiller", { categorie: "qualite", resume: "Boîte de Spasfon reçue descellée sur la commande S300003.", reference: "S300003", urgence: "normale", rappel: "telephone" });
eq("qualité → toujours urgente, conversation transmise", [demandes.transmissions.at(-1).t.urgence, demandes.transmissions.at(-1).t.conversation_id], ["urgente", "conv-1"]);
eq("carte transmission : téléphone et horaires des réglages", tr.ui_actions[0], { type: "transmission", numero: "T-2026-0002", delai: "Réponse sous 24 h ouvrées (du lundi au vendredi).",
  telephone: "01 23 45 67 89", horaires: "lun-ven 9 h-18 h" });
const TR = { categorie: "reglement", resume: "La pharmacie demande où en est le règlement de la facture INV/2026/40001.", reference: "INV/2026/40001", urgence: "normale", rappel: "telephone" };
demandes.prochaine = { numero: "T-2026-0002", delai: null, deja_transmise: true, complement: true };
const trc = await outil("transmettre_a_un_conseiller", TR);
eq("même catégorie déjà ouverte : « complément ajouté », jamais « transmise »", [/Complément ajouté à la demande n° T-2026-0002/.test(trc.contenu.message), /Demande transmise/.test(trc.contenu.message), trc.ui_actions.length], [true, false, 1]);
demandes.prochaine = { numero: "T-2026-0002", delai: null, deja_transmise: true };
const trr = await outil("transmettre_a_un_conseiller", TR);
eq("rien de nouveau : dit tel quel, sans carte", [/rien de nouveau n'a été envoyé/.test(trr.contenu.message), trr.ui_actions.length], [true, 0]);

// ── Bornes de sortie ──
const b = borner({ message: "m".repeat(400), produit: "p".repeat(300), liste: Array(30).fill(1), payment_state: "paid", credit: 5, ok: { access_token: "x", y: 1 } });
eq("borner : textes, listes, champs interdits", [b.message.length, b.produit.length, b.liste.length, "payment_state" in b, "credit" in b, b.ok], [300, 120, 20, false, false, { y: 1 }]);

// ── Aucun champ interdit ni secret dans ce qui sort ──
const tout = JSON.stringify(sorties);
eq("aucun champ interdit", ["payment_state", "amount_residual", "access_token", "pharmaml_key", "\"credit\"", "narration", "purchase_price"].filter(k => tout.includes(k)), []);
eq("aucune valeur confidentielle (jeton portail, notes, e-mails, téléphones des fiches)", ["secret-jeton-portail", "note interne", "@fiche.test", "0100000000", "PML-"].filter(k => tout.includes(k)), []);
eq("aucun détail technique du relais", tout.includes("détail technique"), false);
eq("aucun texte d'une commande du site forgée (consigne d'un tiers)", tout.includes(INJECTION) || tout.includes("IMPORTANT"), false);
eq("aucun lien dans les sorties", /https?:\/\//.test(tout), false);

// ── chat-fichier ──
const evt = (jeton, id, extra = {}) => ({ ...evenement(jeton), queryStringParameters: { id, ...extra } });
const depsF = { ...deps };
const pdfA = await traiter(evt("jeton-a", carte.fichier_id), depsF);
eq("duplicata : PDF d'origine tel quel", [pdfA.statusCode, pdfA.isBase64Encoded, Buffer.from(pdfA.body, "base64").toString(), pdfA.headers["Content-Type"]],
  [200, true, "%PDF-1.4 facture 40001", "application/pdf"]);
eq("en-têtes : attachment, no-store, nosniff", [pdfA.headers["Content-Disposition"], pdfA.headers["Cache-Control"], pdfA.headers["X-Content-Type-Options"]],
  ["attachment; filename=\"Duplicata_INV_2026_40001.pdf\"", "no-store", "nosniff"]);
eq("autre pharmacie avec le même identifiant → 404", (await traiter(evt("jeton-b", carte.fichier_id), depsF)).statusCode, 404);
eq("admin pour la bonne fiche", (await traiter(evt("jeton-admin", carte.fichier_id, { pour_odoo_id: "100" }), depsF)).statusCode, 200);
eq("3 usages au plus", [(await traiter(evt("jeton-a", carte.fichier_id), depsF)).statusCode, (await traiter(evt("jeton-a", carte.fichier_id), depsF)).statusCode], [200, 404]);
eq("sans jeton → 401 reconnexion", JSON.parse((await traiter(evt(null, carte.fichier_id), depsF)).body), { error: "reconnexion" });
eq("admin pour une fiche d'une autre société → 403 fiche", [(await traiter(evt("jeton-admin", carte.fichier_id, { pour_odoo_id: "400" }), depsF)).statusCode], [403]);
eq("identifiant mal formé → 404", (await traiter(evt("jeton-a", "../../etc"), depsF)).statusCode, 404);
eq("aperçu Netlify → 404", (await traiter({ ...evt("jeton-a", rc.fichiers.pdf), headers: { authorization: "Bearer jeton-a", host: "deploy-preview-12--commandes-elixir.netlify.app" } }, depsF)).statusCode, 404);
// propriété revérifiée dans Odoo : autorisation forgée vers la pièce d'une autre pharmacie → 404
const forge = await stock.fichiers.creer({ odoo_id: 100, type: "facture", params: { move_id: 2001 }, ttl_min: 15, usages_max: 3 });
eq("autorisation vers la pièce d'une autre pharmacie → 404 (domaine Odoo)", (await traiter(evt("jeton-a", forge), depsF)).statusCode, 404);
const px = await traiter(evt("jeton-a", rc.fichiers.pdf), depsF);
eq("relevé PDF", [px.statusCode, Buffer.from(px.body, "base64").subarray(0, 5).toString(), px.headers["Content-Disposition"]],
  [200, "%PDF-", "attachment; filename=\"Releve_Elixir_2026-09-01_2026-09-30.pdf\""]);
const xx = await traiter(evt("jeton-a", rc.fichiers.xlsx), depsF);
eq("relevé Excel", [xx.statusCode, Buffer.from(xx.body, "base64").subarray(0, 2).toString(), xx.headers["Content-Type"]],
  [200, "PK", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
const XLSX = await import("xlsx");
const wb = XLSX.read(Buffer.from(xx.body, "base64"), { type: "buffer" });
const lignesX = XLSX.utils.sheet_to_json(wb.Sheets["Relevé"], { header: 1 });
eq("relevé Excel : en-tête et total", [lignesX[1][0], lignesX.find(l => l[0] === "Total")?.slice(5)], ["Relevé des factures et avoirs émis – ne vaut pas état des règlements", [370, 27.68, 397.68]]);
const prod = await outil("releve_facturation", { date_debut: "2026-09-01", date_fin: "2026-09-30", detail: "par_produit" });
const xp = await traiter(evt("jeton-a", prod.ui_actions[0].fichiers.xlsx), depsF);
const wp = XLSX.read(Buffer.from(xp.body, "base64"), { type: "buffer" });
eq("relevé par produit : quantités nettes des avoirs", XLSX.utils.sheet_to_json(wp.Sheets["Par produit"], { header: 1 }).slice(1).map(l => [l[0], l[2], l[3]]),
  [["3400930000011", 0, 80], ["3400930000042", 1, 30], ["3400930000035", 1, 200], ["3400930000028", 2, 60]]);
const pp = await traiter(evt("jeton-a", prod.ui_actions[0].fichiers.pdf), depsF);
eq("relevé par produit (PDF)", [pp.statusCode, Buffer.from(pp.body, "base64").subarray(0, 5).toString()], [200, "%PDF-"]);

// ── Garde sur tous les appels Odoo de ce fichier ──
eq("chaque appel Odoo : société 2, filtre de la fiche, délai, aucun champ interdit", controlerAppels(faux.appels, [100, 200, 300, 400, 500, 600, 700]).slice(0, 5), []);

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
