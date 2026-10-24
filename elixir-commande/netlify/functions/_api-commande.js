// ── API des pharmacies, phase 3 : COMMANDES (droit « commande ») ──
// Ajoutées à ROUTES par api-v1.js (clé, accès, fiche relue dans Odoo à CHAQUE appel, droit, débit par clé, journal) :
//   POST   /v1/commandes/simulation   que se passerait-il ? Contrôles complets (prix, contingents, disponibilité, plafonds,
//                                     anomalies), RIEN n'est écrit (hors parcours de test)
//   POST   /v1/commandes              commande : Idempotency-Key obligatoire, reference_client unique par pharmacie
//   DELETE /v1/commandes/{id}         annulation pendant le délai d'annulation (ou tant qu'une commande gardée « à vérifier »
//                                     n'est pas partie)
// Décisions de Zineb (24/10/2026) : pas de validation manuelle par défaut — une commande acceptée part seule après le délai
// d'annulation (10 min, réglable par pharmacie) par api-commandes-cron → api-envoi-background → envoiAuto (relais) ;
// plafonds par pharmacie (100 lignes, 1 000 boîtes, 3 000 € HT, 10 commandes par jour) : dépassement = refus explicite ;
// commande gardée « à vérifier » SEULEMENT pour une anomalie nette (quantité > 10 × l'habitude mensuelle du produit,
// quasi-doublon d'une commande reçue depuis moins de 30 min, tous canaux) ; ruptures retirées par défaut ; contingent dépassé :
// ligne ramenée au reste, refusée à 0, commande entière refusée seulement avec tout_ou_rien ; prix = liste de prix Odoo de la
// pharmacie (api_prix : MINIMUM des règles, comme la facture), recalculés au serveur — rien n'est pris du client ; offres
// du site hors V1 : produits sur justificatif, articles multi-CIP (fauteuils), produits de campagne et produits exclus par
// l'admin refusés (« à commander sur le site »), menus et remises du site jamais appliqués (prix de la liste seulement).
// Commandes RÉELLES (clés elx_live_) refusées (503 ecriture_suspendue) tant que l'interrupteur « Commandes par API » est
// fermé (prérequis de la conception § 19). Clés de test : tout est contrôlé de la même façon, la commande « T… » n'est
// écrite que dans api_commandes (jamais dans elixir_orders, jamais envoyée), son état est simulé.
// Idempotence (conception § 5) : réservation dans api_commandes (unique : fiche, environnement, Idempotency-Key ; et
// reference_client hors refusées), empreinte du corps normalisé, numéro choisi par le serveur et noté AVANT l'insertion dans
// elixir_orders (une reprise après coupure réutilise le même numéro), rejeu à l'identique (Idempotent-Replayed: true).
// order-save.js n'est pas touché : la ligne elixir_orders est écrite ici (source « api », sans e-mail, CIP de la fiche).
import crypto from "node:crypto";
import { COMPANY_ID } from "./_odoo-rpc.js";
import { jourParis, jourPlus, jourFr, minuitParisIso } from "./_chat-perimetre.js";
import { ANOMALIE, CGU, COMMANDE, MENTION_COMMANDE, MOTIFS_ANOMALIE, PRIX, commandesLiveOuvertes } from "./_api-config.js";
import { CODES, erreurApi, isoParis, probleme } from "./_api-http.js";
import { noterParcours } from "./_api-parcours.js";

const CIP13 = /^\d{13}$/;
export const ORDRE_SITE = /^1[7-9]\d{11}$/;
export const ORDRE_TEST = /^T1[7-9]\d{11}$/;
const REFERENCE = /^[\p{L}\p{N} _.:/#+-]{1,40}$/u;
const CONTROLE = /[\u0000-\u001f\u007f]/;
const CHAMPS = new Set(["reference_client", "lignes", "si_rupture", "tout_ou_rien", "commentaire"]);
const CHAMPS_LIGNE = new Set(["cip", "quantite"]);
const SIMULATIONS = new Set(["rupture", "contingent", "indisponible", "doublon"]);
export const TACHES_LIBEREES = new Set(["refusee", "expiree", "annulee", "non_envoyee"]);   // tâches du relais dont rien n'est parti
// produits que le site seul sait commander (services.produitsHorsApi) → détail de la ligne refusée « produit_non_commandable »
export const HORS_API = {
  multi_cip: "Article livré sous plusieurs références : à commander sur le site (outil dédié), qui répartit la quantité entre elles.",
  campagne: "Produit d'une campagne du site : à commander sur le site, page de la campagne.",
};
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const m2o = (v) => (Array.isArray(v) ? v[0] : Number(v) || 0);
const lireJson = (t, d) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return d; } };
const nettoyer = (s) => String(s || "").replace(/\s+/g, " ").trim();
const odooDt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const dateOdoo = (s) => (s ? Date.parse(String(s).replace(" ", "T") + (/(Z|[+-]\d\d:?\d\d)$/i.test(String(s)) ? "" : "Z")) : NaN);
const joindre = (a, b) => (a ? `${a} ${b}` : b);
const entete = (event, nom) => { const h = event?.headers || {}; const k = Object.keys(h).find(x => x.toLowerCase() === nom); return k ? h[k] : null; };
const ENTETES = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const REJOUER = "Rien n'a été enregistré : renvoyez la même requête (même Idempotency-Key) dans un instant, sans risque de doublon.";

const invalide = (erreurs) => erreurApi("requete_invalide", { detail: erreurs.slice(0, 5).map(e => e.message).join(" "), extra: { erreurs: erreurs.slice(0, 50) } });

// ── Demande ──
// → { reference_client, lignes: [{ cip, quantite }] (ordre du client), si_rupture, tout_ou_rien, commentaire } ; lève 400/422
export function lireDemande(event) {
  let texte = event?.body ?? "";
  if (event?.isBase64Encoded) texte = Buffer.from(String(texte), "base64").toString("utf8");
  let b;
  try { b = JSON.parse(texte || ""); } catch { throw erreurApi("json_invalide"); }
  const erreurs = [];
  const err = (champ, message) => erreurs.push({ champ, message });
  if (!b || typeof b !== "object" || Array.isArray(b)) throw invalide([{ champ: "", message: "Le corps doit être un objet JSON : { \"lignes\": [{ \"cip\": \"…\", \"quantite\": 1 }] }." }]);
  for (const k of Object.keys(b)) if (!CHAMPS.has(k)) err(k, `${k} : champ inconnu (champs admis : ${[...CHAMPS].join(", ")}).`);
  const lignes = [];
  if (!Array.isArray(b.lignes) || !b.lignes.length) err("lignes", `lignes : tableau de 1 à ${COMMANDE.lignes_max} lignes { cip, quantite }.`);
  else if (b.lignes.length > COMMANDE.lignes_max) err("lignes", `lignes : ${COMMANDE.lignes_max} au plus par commande.`);
  else b.lignes.forEach((l, i) => {
    const c = `lignes[${i}]`;
    if (!l || typeof l !== "object" || Array.isArray(l)) { err(c, `${c} : objet { cip, quantite } attendu.`); return; }
    for (const k of Object.keys(l)) if (!CHAMPS_LIGNE.has(k)) err(`${c}.${k}`, `${c}.${k} : champ inconnu (cip, quantite).`);
    const cip = typeof l.cip === "string" ? l.cip.trim() : "";
    if (!CIP13.test(cip)) err(`${c}.cip`, `${c}.cip : texte de 13 chiffres (CIP13 ou code-barres du produit).`);
    if (!Number.isInteger(l.quantite) || l.quantite < 1 || l.quantite > COMMANDE.quantite_max) err(`${c}.quantite`, `${c}.quantite : nombre entier de 1 à ${COMMANDE.quantite_max}.`);
    lignes.push({ cip, quantite: l.quantite });
  });
  const vus = new Set();
  lignes.forEach((l, i) => { if (CIP13.test(l.cip)) { if (vus.has(l.cip)) err(`lignes[${i}].cip`, `lignes[${i}].cip : ${l.cip} en double (une ligne par produit).`); vus.add(l.cip); } });
  let reference = null;
  if (b.reference_client != null) {
    if (typeof b.reference_client !== "string" || !REFERENCE.test(b.reference_client.trim())) err("reference_client", `reference_client : 1 à ${COMMANDE.reference_max} caractères (lettres, chiffres, espace et _ . : / # + -).`);
    else reference = b.reference_client.trim();
  }
  const siRupture = b.si_rupture == null ? "retirer" : b.si_rupture;
  if (!["retirer", "garder"].includes(siRupture)) err("si_rupture", "si_rupture : « retirer » (défaut) ou « garder ».");
  const toutOuRien = b.tout_ou_rien == null ? false : b.tout_ou_rien;
  if (typeof toutOuRien !== "boolean") err("tout_ou_rien", "tout_ou_rien : true ou false.");
  let commentaire = null;
  if (b.commentaire != null && b.commentaire !== "") {
    if (typeof b.commentaire !== "string" || b.commentaire.length > COMMANDE.commentaire_max || CONTROLE.test(b.commentaire)) err("commentaire", `commentaire : texte de ${COMMANDE.commentaire_max} caractères au plus, sur une ligne.`);
    else commentaire = nettoyer(b.commentaire) || null;
  }
  if (erreurs.length) throw invalide(erreurs);
  return { reference_client: reference, lignes, si_rupture: siRupture, tout_ou_rien: toutOuRien, commentaire };
}
// empreinte du corps normalisé (lignes triées par CIP, valeurs par défaut remplies) : même commande = même empreinte
export const empreinteDemande = (d, simulation = null) => crypto.createHash("sha256").update(JSON.stringify({ r: d.reference_client, s: d.si_rupture, t: d.tout_ou_rien,
  c: d.commentaire, l: [...d.lignes].sort((a, b) => a.cip.localeCompare(b.cip)).map(l => [l.cip, l.quantite]), x: simulation || null })).digest("hex");
// X-Elixir-Simulation (clés de test seulement) : force un cas difficile
export function simulationDe(event) {
  const v = entete(event, "x-elixir-simulation");
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!SIMULATIONS.has(s)) throw invalide([{ champ: "X-Elixir-Simulation", message: `X-Elixir-Simulation : ${[...SIMULATIONS].join(", ")}.` }]);
  return s;
}

// Prix unitaire d'une quantité : le plus bas du prix à l'unité et des paliers atteints (paliers de la liste calculés par Odoo
// à leur quantité, MINIMUM des règles) — le prix qu'Odoo facture pour cette quantité
export function prixPour(p, q) {
  let pu = Number(p?.prix_ht);
  for (const x of p?.paliers || []) if (Number.isInteger(x?.a_partir_de) && x.a_partir_de <= q && Number(x.prix_ht) > 0) pu = Math.min(pu, Number(x.prix_ht));
  return r2(pu);
}

// Accès fermés à la commande → { code, detail?, retry? } | null (dans l'ordre : pharmacie bloquée, CGU, interrupteur)
export function refusAcces(acces, environnement, reglages, maintenant) {
  if (acces.mode === "bloque") return { code: "commandes_bloquees" };
  if (acces.cgu_version !== CGU.version) return { code: "cgu_a_accepter" };
  if (environnement === "live" && !commandesLiveOuvertes(reglages, maintenant)) return { code: "ecriture_suspendue", retry: 3600,
    detail: "Les commandes réelles par l'API ne sont pas encore ouvertes (ou momentanément fermées) : rien n'a été enregistré. Les clés de test (elx_test_) fonctionnent ; le site et votre logiciel d'officine restent disponibles." };
  return null;
}
const ctxDe = (acces, fiche) => ({ odooId: acces.odoo_id, cip: String(fiche?.cip || acces.cip || "").trim(), nom: nettoyer(fiche?.name) || acces.nom || null });
const periodeTexte = (info, now) => (info?.start ? `, du ${jourFr(info.start)} au ${jourFr(info.end ? jourPlus(info.end, -1) : jourParis(now))}` : "");
const sortieLigne = (l) => ({ ligne: l.ligne, cip: l.cip, ...(l.code_demande ? { code_demande: l.code_demande } : {}), nom: l.nom, quantite_demandee: l.quantite_demandee,
  quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, total_ht: l.total_ht, etat: l.etat, motif: l.motif || null, detail: l.detail || null,
  ...(l.anomalie ? { anomalie: l.anomalie } : {}) });

// ── Évaluation (simulation et commande) ──
// → { lignes, total, boites, refus: null | { code, detail?, extra? }, anomalies, avertissements, etat: recue | en_attente_elixir, motif }
// Erreurs passagères (Odoo, base) : levées (503 rejouable) — jamais d'acceptation sans contingent ni prix vérifiés.
export async function evaluer({ demande, acces, ctx, test, stock, services, reglages, now, simulation = null, apercu = false }) {
  const indispo = (detail, retry = 30) => erreurApi("indisponible", { retry, detail: detail || `Notre système ne répond pas. ${REJOUER}` });
  const codes = demande.lignes.map(l => l.cip);
  await services.chargerOdoo(acces.odoo_id);
  const [catalogue, liste, justif, horsApi, contingentes] = await Promise.all([
    stock.catalogue.deCips(codes),
    services.listeDeFiche(acces, { apercu }),
    services.produitsJustificatif().catch(() => { throw indispo(); }),
    services.produitsHorsApi().catch(() => { throw indispo(); }),
    services.contingentes(acces.odoo_id),
  ]);
  if (!liste) throw indispo(`Votre liste de prix n'a pas pu être lue. ${REJOUER}`, 300);
  const parCode = new Map();
  for (const r of catalogue) parCode.set(r.cip, r);
  for (const r of catalogue) if (r.barcode && !parCode.has(r.barcode)) parCode.set(r.barcode, r);
  // un même produit demandé deux fois (son CIP et son code-barres) : refus de structure, comme un CIP en double
  const vusProduit = new Map(), doubles = [];
  demande.lignes.forEach((l, i) => {
    const r = parCode.get(l.cip);
    if (!r) return;
    if (vusProduit.has(r.cip)) doubles.push({ champ: `lignes[${i}].cip`, message: `lignes[${i}].cip : même produit que lignes[${vusProduit.get(r.cip)}] (CIP et code-barres) : une ligne par produit.` });
    else vusProduit.set(r.cip, i);
  });
  if (doubles.length) throw invalide(doubles);
  const cipsCat = [...new Set(catalogue.map(r => r.cip))];
  const [prix, etatListe] = cipsCat.length ? await Promise.all([stock.prix.deCips(liste, cipsCat), stock.prixListes.lire(liste)]) : [[], null];
  if (cipsCat.length && !prix.length && etatListe?.etat !== "pret") throw indispo(`Vos prix sont en cours de calcul (moins d'une heure). ${REJOUER}`, 600);
  const prixDe = new Map(prix.map(p => [p.cip, p]));
  const exclus = new Set(reglages.cips_exclus || []);
  const avertissements = [];
  if (test) avertissements.push("Mode test : commande contrôlée comme en production, mais jamais envoyée ni facturée.");
  if (prix.some(p => now.getTime() - Date.parse(p.calcule_le) > PRIX.age_perime_h * 3600e3)) avertissements.push("Certains de vos prix n'ont pas pu être recalculés récemment (plus de 48 heures).");

  // 1. produits : catalogue, exclusions, justificatif, prix
  const lignes = demande.lignes.map((l, i) => {
    const r = parCode.get(l.cip);
    const base = { ligne: i + 1, cip: r?.cip || l.cip, code_demande: r && r.cip !== l.cip ? l.cip : null, nom: r ? nettoyer(r.name) || null : null,
      quantite_demandee: l.quantite, quantite: 0, prix_unitaire_ht: null, total_ht: 0, etat: "refusee", motif: null, detail: null };
    const refus = (motif, detail) => ({ ...base, motif, detail });
    if (!r) return refus("produit_inconnu", "Produit absent de notre catalogue.");
    const sesCodes = [r.cip, l.cip, r.barcode].filter(Boolean);
    if (sesCodes.some(c => exclus.has(c))) return refus("produit_non_commandable", "Produit non commandable par l'API : commandez-le sur le site.");
    const hors = sesCodes.map(c => horsApi?.get(c)).find(Boolean);
    if (hors) return refus("produit_non_commandable", HORS_API[hors] || HORS_API.campagne);
    if (sesCodes.some(c => justif?.[c])) return refus("produit_sur_justificatif", "À commander sur le site, page « Commande labo sur justificatif ».");
    const p = prixDe.get(r.cip);
    if (!p || !(Number(p.prix_ht) > 0)) return refus("prix_indisponible", "Prix pas encore disponible pour ce produit : réessayez plus tard, ou commandez-le sur le site.");
    return { ...base, etat: "acceptee", quantite: l.quantite, _r: r, _p: p };
  });

  // 2. lectures Odoo fraîches : produits (stock libre), contingent de la fiche, lignes de commande récentes (anomalies)
  const cand = lignes.filter(l => l.etat === "acceptee");
  const codesOdoo = [...new Set(cand.flatMap(l => [l.cip, l._r.barcode].filter(c => c && CIP13.test(c))))];
  const contingente = (l) => !contingentes || contingentes.has(l.cip) || (!!l._r.barcode && contingentes.has(l._r.barcode));
  const avecQuota = cand.some(contingente);
  const depuisHisto = now.getTime() - ANOMALIE.historique_jours * 86400e3;
  const [produits, quota, lignesOdoo] = cand.length ? await Promise.all([
    services.produitsOdoo(codesOdoo).catch(() => { throw indispo(); }),
    avecQuota ? services.contingentsBruts(ctx).catch(() => { throw erreurApi("contingent_indisponible", { retry: 60 }); }) : null,
    acces.anomalie_active ? services.lignesOdoo(acces.odoo_id, codesOdoo, odooDt(depuisHisto)).catch(() => { throw indispo(); }) : [],
  ]) : [new Map(), null, []];

  // 3. par ligne : produit connu d'Odoo, contingent, disponibilité, prix de la quantité
  let simContingent = simulation === "contingent";
  for (const l of cand) {
    const po = produits.get(l.cip) || (l._r.barcode ? produits.get(l._r.barcode) : null);
    if (!po) { Object.assign(l, { etat: "refusee", quantite: 0, motif: "produit_inconnu", detail: "Produit inconnu de notre système de préparation : commandez-le sur le site." }); continue; }
    l._id = po.id;
    let q = l.quantite;
    const info = quota && !quota.exempt ? (quota.products?.[l.cip] || (l._r.barcode ? quota.products?.[l._r.barcode] : null)) : null;
    let reste = info ? Math.max(0, Number(info.remaining) || 0) : null, libelle = info ? `${info.label}${periodeTexte(info, now)}` : null;
    if (simContingent) { reste = Math.floor(q / 2); libelle = "simulation X-Elixir-Simulation: contingent"; simContingent = false; }
    if (reste != null && q > reste) {
      if (reste <= 0) { Object.assign(l, { etat: "refusee", quantite: 0, motif: "contingentement", detail: `Contingent atteint (${libelle}) : plus rien à commander sur la période.` }); continue; }
      q = reste;
      Object.assign(l, { quantite: q, motif: "contingentement", detail: `Quantité ramenée au reste du contingent : ${reste} boîte(s) (${libelle}).` });
    }
    const libre = simulation === "rupture" ? 0 : po.free_qty;
    if (libre <= 0) {
      if (demande.si_rupture === "retirer") {
        Object.assign(l, { etat: "rupture", quantite: 0, motif: "rupture", detail: "En rupture : ligne retirée (si_rupture « retirer »), commandez ailleurs ou plus tard." });
        continue;
      }
      l.motif ||= "en_attente_stock";
      l.detail = joindre(l.detail, "En rupture : ligne gardée en attente du retour du stock (si_rupture « garder »), envoyée par Elixir Pharma au réapprovisionnement.");
    } else if (libre < q) {
      l.detail = joindre(l.detail, demande.si_rupture === "retirer" ? "Stock actuel insuffisant pour toute la quantité : la ligne sera retirée si le stock reste insuffisant au moment de l'envoi."
        : "Stock actuel insuffisant pour toute la quantité : la ligne attendra le réapprovisionnement si besoin.");
    }
    const pu = prixPour(l._p, q);
    Object.assign(l, { prix_unitaire_ht: pu, total_ht: r2(pu * q) });
  }
  const acceptees = lignes.filter(l => l.etat === "acceptee" && l.quantite > 0);
  const total = r2(acceptees.reduce((s, l) => s + l.total_ht, 0));
  const boites = acceptees.reduce((s, l) => s + l.quantite, 0);

  // 4. refus de la commande entière : tout_ou_rien, aucune ligne, plafonds de l'accès (sur ce qui serait envoyé)
  let refus = null;
  const touchees = lignes.filter(l => l.etat !== "acceptee" || l.quantite < l.quantite_demandee);
  if (demande.tout_ou_rien && touchees.length) refus = { code: "commande_refusee", detail: `${touchees.length} ligne(s) refusée(s), retirée(s) ou réduite(s) et « tout_ou_rien » demandé : rien n'a été enregistré (voir « lignes »).` };
  else if (!acceptees.length) refus = { code: "aucune_ligne_acceptee", detail: "Aucune ligne ne peut être acceptée (voir « lignes ») : rien n'a été enregistré." };
  else {
    const plafonds = [["lignes", acceptees.length, Number(acces.plafond_lignes), "ligne(s)"], ["boites", boites, Number(acces.plafond_boites), "boîte(s)"],
      ["montant_ht", total, Number(acces.plafond_montant_ht), "€ HT"]];
    const p = plafonds.find(([, v, max]) => v > max);
    if (p) refus = { code: "plafond_depasse", detail: `La commande dépasse le plafond de votre accès : ${p[1]} ${p[3]} pour ${p[2]} au plus par commande. Rien n'a été enregistré : scindez-la, ou demandez à Elixir Pharma d'ajuster vos plafonds.`,
      extra: { plafond: { nom: p[0], limite: p[2], valeur: p[1] } } };
  }

  // 5. anomalies nettes → commande gardée « à vérifier » (jamais d'envoi automatique ; Elixir valide ou refuse)
  const anomalies = [];
  if (!refus && (acces.anomalie_active || simulation === "doublon")) {
    if (acces.anomalie_active) {
      const histo = new Map();
      for (const x of lignesOdoo) histo.set(m2o(x.product_id), (histo.get(m2o(x.product_id)) || 0) + (Number(x.product_uom_qty) || 0));
      const facteur = Number(acces.anomalie_facteur) || 10;
      for (const l of acceptees) {
        const seuil = facteur * Math.max((histo.get(l._id) || 0) / ANOMALIE.mois, ANOMALIE.base_min_boites);
        if (l.quantite > seuil) {
          l.anomalie = "anomalie_quantite";
          anomalies.push({ type: "anomalie_quantite", cip: l.cip, detail: `${l.quantite} boîte(s) : plus de ${facteur} fois votre quantité mensuelle habituelle de ce produit.` });
        }
      }
    }
    const minutes = acces.anomalie_active ? Number(acces.anomalie_doublon_min) || 0 : 0;
    const mes = new Set(acceptees.map(l => l._id));
    let doublon = simulation === "doublon";
    if (!doublon && minutes > 0 && mes.size) {
      const depuis = now.getTime() - minutes * 60e3;
      const idDe = (code) => produits.get(String(code || ""))?.id ?? null;
      const autres = [];   // ensembles de produits des commandes récentes
      if (test) {
        // mode test : parmi les commandes de TEST de la pharmacie (jamais ses commandes réelles)
        for (const row of await stock.commandes.recentesTest(acces.odoo_id, new Date(depuis).toISOString())) {
          const rep = lireJson(row.reponse, null);
          autres.push(new Set((rep?.lignes || []).filter(x => x.etat === "acceptee" && x.quantite > 0).map(x => idDe(x.cip)).filter(Boolean)));
        }
      } else {
        // site et API (elixir_orders : CIP et comptes de la fiche, lignes annulées ou traitées exclues), logiciel d'officine (Odoo)
        const [emails] = await Promise.all([stock.site.comptes(acces.odoo_id)]);
        for (const o of await stock.site.recentes(ctx.cip, emails, new Date(depuis).toISOString())) {
          autres.push(new Set((o.items || []).filter(it => it && !it.handled_at).map(it => idDe(it.cip)).filter(Boolean)));
        }
        const parSo = new Map();
        for (const x of lignesOdoo) if (dateOdoo(x.create_date) >= depuis) { const so = m2o(x.order_id); (parSo.get(so) || parSo.set(so, new Set()).get(so)).add(m2o(x.product_id)); }
        autres.push(...parSo.values());
      }
      doublon = autres.some(s => { let n = 0; for (const id of mes) if (s.has(id)) n++; return n / mes.size >= ANOMALIE.part_doublon; });
    }
    if (doublon) anomalies.push({ type: "quasi_doublon", detail: `Au moins ${Math.round(ANOMALIE.part_doublon * 100)} % de ces produits figurent déjà dans une commande reçue il y a moins de ${minutes || 30} min.` });
  }
  if (anomalies.length) avertissements.push(`Commande gardée « à vérifier » par Elixir Pharma (${[...new Set(anomalies.map(a => MOTIFS_ANOMALIE[a.type]))].join(" ; ")}) : elle ne part qu'après sa validation, et reste annulable d'ici là.`);
  const enAttente = !refus && anomalies.length > 0;
  return { lignes: lignes.map(sortieLigne), total, boites, refus, anomalies, avertissements, etat: enAttente ? "en_attente_elixir" : "recue", motif: enAttente ? anomalies[0].type : null };
}

// ── Numéros, corps, ligne du site ──
let dernierNumero = 0;
// numéro du serveur : Date.now() (13 chiffres, même famille que le site : suivi de l'Assistant, canal « site » de la péremption),
// toujours croissant dans l'instance ; « T » devant pour une commande de test
export function nouveauNumero(test, now) {
  dernierNumero = Math.max(now.getTime(), dernierNumero + 1);
  return `${test ? "T" : ""}${dernierNumero}`;
}
function corpsCommande({ id, test, demande, ev, now, acces }) {
  const recue = ev.etat === "recue";
  const fin = recue ? new Date(now.getTime() + Math.min(Number(acces.delai_annulation_min) || 0, COMMANDE.delai_envoi_max_min) * 60e3) : null;
  return { id, environnement: test ? "test" : "live", reference_client: demande.reference_client, canal: "api", etat: ev.etat, motif: ev.motif,
    cree_le: isoParis(now), annulable_jusqu_a: fin ? isoParis(fin) : null, si_rupture: demande.si_rupture, total_indicatif_ht: ev.total,
    lignes: ev.lignes, anomalies: ev.anomalies, avertissements: ev.avertissements, mention: MENTION_COMMANDE };
}
// ligne elixir_orders d'une commande acceptée (déterministe : une reprise reconstruit la même)
export function ligneSite(corps, ctx) {
  const items = (corps.lignes || []).filter(l => l.etat === "acceptee" && l.quantite > 0)
    .map(l => ({ cip: l.cip, name: String(l.nom || l.cip).slice(0, 200), qty: l.quantite, pn: l.prix_unitaire_ht, total: l.total_ht, ligne_api: l.ligne }));
  return { id: Number(corps.id), date: new Date(Date.parse(corps.cree_le)).toISOString(), pharmacy_name: String(ctx.nom || "").slice(0, 200) || null, pharmacy_email: null,
    pharmacy_cip: ctx.cip, is_client: true, items, total_ht: corps.total_indicatif_ht, nb_lignes: items.length, csv: null, processed: false, source: "api" };
}
const lignesCles = (its) => JSON.stringify((its || []).map(i => [String(i?.cip ?? ""), Number(i?.qty) || 0]));
const memeLigne = (o, l) => o.source === "api" && String(o.pharmacy_cip || "") === String(l.pharmacy_cip) && lignesCles(o.items) === lignesCles(l.items);

// Rejeu d'une réponse enregistrée (même statut, même corps)
function rejeu(row, requestId) {
  const statut = Number(row.statut_http);
  return { statusCode: statut, headers: { ...ENTETES, "Content-Type": statut >= 400 ? "application/problem+json; charset=utf-8" : "application/json; charset=utf-8",
    "X-Request-Id": requestId, "Idempotent-Replayed": "true", ...(statut === 201 && row.order_id ? { Location: `/api/v1/commandes/${row.order_id}` } : {}) }, body: row.reponse };
}

// Insertion dans elixir_orders (réelle) puis fin de la réservation → { row, corps } (row null : quelqu'un d'autre a terminé)
async function enregistrer({ stock, row, corps, ctx, test, now }) {
  let r = row, c = corps;
  if (!test) {
    for (let essai = 0; ; essai++) {
      const ligne = ligneSite(c, ctx);
      const res = await stock.site.inserer(ligne);
      if (res.ok) break;
      const deja = await stock.site.lire(c.id);
      if (deja && memeLigne(deja, ligne)) break;   // reprise : déjà enregistrée par l'essai coupé
      if (essai >= 2) throw new Error("aucun numéro de commande libre");
      // numéro pris par une autre commande (même milliseconde) : nouveau numéro, noté AVANT la nouvelle insertion
      c = { ...c, id: nouveauNumero(false, now) };
      r = await stock.commandes.ecrire(r, { order_id: c.id, reponse: JSON.stringify(c) });
      if (!r) return { row: null, corps: c };
    }
  }
  const verifier = c.etat === "en_attente_elixir";
  const fin = await stock.commandes.ecrire(r, { etat: verifier ? "a_verifier" : "recue", motif: verifier ? c.motif : null, statut_http: 201, reponse: JSON.stringify(c),
    envoi_apres: verifier || !c.annulable_jusqu_a ? null : new Date(Date.parse(c.annulable_jusqu_a)).toISOString() });
  return { row: fin, corps: c };
}

// Marques de l'API sur les lignes d'une commande du site (rupture retirée, annulation) : handled_at + api_motif, comme
// « Traiter sans envoi » de l'admin (le contingent ne les compte plus, le relais ne les envoie pas) → nombre de lignes marquées
export async function marquerLignes(stock, ordre, idx, motif, now) {
  const o = await stock.site.lire(ordre);
  if (!o) return 0;
  const its = o.items.map(x => (x && typeof x === "object" ? { ...x } : x));
  let n = 0;
  its.forEach((it, i) => {
    if (!it || (idx && !idx.includes(i)) || it.synced_at || it.handled_at) return;
    its[i] = { ...it, handled_at: now.toISOString(), api_motif: motif };
    n++;
  });
  if (n) await stock.site.ecrireLignes(ordre, its, o.processed || its.every(it => it?.synced_at || it?.handled_at));
  return n;
}

// Stock libre Odoo (société 2) par CIP, en une lecture (fonction d'envoi) → Map(cip → quantité)
export async function stockLibreLots(lire, cips) {
  const xs = [...new Set(cips.map(String))].filter(c => CIP13.test(c));
  const out = new Map(xs.map(c => [c, 0]));
  if (!xs.length) return out;
  const rows = (await lire("product.product", "search_read", [["&", ["company_id", "in", [COMPANY_ID, false]], "|", ["barcode", "in", xs], ["default_code", "in", xs]]],
    { fields: ["id", "default_code", "barcode", "free_qty"], order: "id asc", limit: xs.length * 3 })) || [];
  const vus = new Set();
  for (const r of rows) for (const c of [r.barcode, r.default_code]) if (c && out.has(c) && !vus.has(c)) { vus.add(c); out.set(c, Number(r.free_qty) || 0); }
  return out;
}

const secondesAvantMinuit = (now) => { const j = jourParis(now); return Math.max(1, Math.ceil((Date.parse(minuitParisIso(jourPlus(j, 1))) - now.getTime()) / 1000)); };
const refusVu = (refus) => {
  const [statut, titre, defaut] = CODES[refus.code] || CODES.indisponible;
  return { statut, code: refus.code, titre, detail: refus.detail || defaut, ...(refus.extra || {}) };
};

// ── POST /v1/commandes/simulation ──
async function routeSimulation(arg) {
  const { event, acces, reglages, environnement, maintenant: now, stock, services, fiche, apercu } = arg;
  const test = environnement === "test";
  const demande = lireDemande(event);
  const sim = test ? simulationDe(event) : null;
  if (sim === "indisponible") throw erreurApi("indisponible", { retry: 30, detail: "Simulation (X-Elixir-Simulation: indisponible) : notre système ne répond pas." });
  const ev = await evaluer({ demande, acces, ctx: ctxDe(acces, fiche), test, stock, services, reglages, now, simulation: sim, apercu });
  let refus = refusAcces(acces, environnement, reglages, now) || ev.refus;
  if (!refus) {
    const n = await stock.commandes.compterDepuis(acces.odoo_id, test, minuitParisIso(jourParis(now)));
    if (n >= acces.plafond_commandes_jour) refus = { code: "plafond_commandes_jour", extra: { plafond: { nom: "commandes_jour", limite: acces.plafond_commandes_jour, valeur: n } } };
  }
  await noterParcours(arg, "simulation");
  return { simulation: true, resultat: refus ? "refusee" : "acceptee", refus: refus ? refusVu(refus) : null, environnement,
    etat: refus ? null : ev.etat, motif: refus ? null : ev.motif, delai_annulation_min: !refus && ev.etat === "recue" ? Math.min(acces.delai_annulation_min, COMMANDE.delai_envoi_max_min) : null,
    si_rupture: demande.si_rupture, total_indicatif_ht: ev.total, lignes: ev.lignes, anomalies: ev.anomalies, avertissements: ev.avertissements, mention: MENTION_COMMANDE };
}

// ── POST /v1/commandes ──
async function routeCommander(arg) {
  const { event, acces, reglages, environnement, maintenant: now, stock, services, fiche, cle, requestId, apercu } = arg;
  const t0 = Date.now();
  const test = environnement === "test";
  const porte = refusAcces(acces, environnement, reglages, now);
  if (porte) throw erreurApi(porte.code, { detail: porte.detail, retry: porte.retry });
  const cleIdem = String(entete(event, "idempotency-key") ?? "").trim();
  if (!cleIdem) throw erreurApi("idempotency_key_absente");
  if (!COMMANDE.idempotence.test(cleIdem)) throw erreurApi("idempotency_key_absente", { detail: "Idempotency-Key : 8 à 128 caractères parmi A-Z a-z 0-9 _ . : - (un UUID par exemple)." });
  const demande = lireDemande(event);
  const sim = test ? simulationDe(event) : null;
  const empreinte = empreinteDemande(demande, sim);
  const ctx = ctxDe(acces, fiche);

  // Fin commune (première fois, ou reprise d'une réservation dont le numéro est déjà noté) : insertion puis 201
  const finir = async (corps, r) => {
    let fin;
    try { fin = await enregistrer({ stock, row: r, corps, ctx, test, now }); }
    catch { throw erreurApi("indisponible", { retry: 60, detail: "Enregistrement interrompu : renvoyez la même requête (même Idempotency-Key) dans une minute ; elle sera terminée sans doublon." }); }
    if (!fin.row) {
      const lu = await stock.commandes.parId(r.id);
      if (lu?.statut_http) return rejeu(lu, requestId);
      throw erreurApi("requete_en_cours", { retry: 2 });
    }
    if (!test) {
      services.oublierContingents?.(acces.odoo_id);
      const garde = fin.corps.etat === "en_attente_elixir";
      await stock.site.notifier({ type: "new_order", title: `${garde ? "⚠ À vérifier — " : ""}Commande API de ${ctx.nom || `la fiche n° ${acces.odoo_id}`}`,
        body: `${Number(fin.corps.total_indicatif_ht || 0).toFixed(2)} € HT · ${fin.corps.lignes.filter(l => l.etat === "acceptee" && l.quantite > 0).length} ligne(s)${garde ? ` · ${MOTIFS_ANOMALIE[fin.corps.motif] || "anomalie"}` : ""}`,
        data: { order_id: Number(fin.corps.id), pharmacy: ctx.nom, total: fin.corps.total_indicatif_ht, source: "api" } }).catch(() => {});
    } else await noterParcours(arg, "commande");
    return { statusCode: 201, headers: { ...ENTETES, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": requestId, Location: `/api/v1/commandes/${fin.corps.id}` },
      body: JSON.stringify(fin.corps) };
  };

  // 1. réservation (idempotence)
  let row;
  const res = await stock.commandes.reserver({ odoo_id: acces.odoo_id, cle_id: cle.id, test, idempotency_key: cleIdem, empreinte_requete: empreinte,
    reference_client: demande.reference_client, demande: JSON.stringify(demande) });
  if (res.conflit) {
    const ex = await stock.commandes.parIdempotence(acces.odoo_id, test, cleIdem);
    if (!ex) {
      const autre = demande.reference_client ? await stock.commandes.parReference(acces.odoo_id, test, demande.reference_client) : null;
      if (autre) throw erreurApi("reference_deja_utilisee", { detail: `La reference_client « ${demande.reference_client} » a déjà servi pour une autre commande.`, extra: { id: autre.order_id || null } });
      throw erreurApi("requete_en_cours", { retry: 2 });
    }
    if (ex.empreinte_requete !== empreinte) throw erreurApi("idempotency_key_reutilisee");
    if (ex.statut_http) { await noterParcours(arg, "rejeu"); return rejeu(ex, requestId); }
    if (now.getTime() - Date.parse(ex.updated_at) < COMMANDE.en_cours_ms) throw erreurApi("requete_en_cours", { retry: 2 });
    // requête coupée depuis plus d'une minute : reprise (une seule gagne : la ligne change de version)
    row = await stock.commandes.ecrire(ex, {});
    if (!row) throw erreurApi("requete_en_cours", { retry: 2 });
    const prep = lireJson(row.reponse, null);
    if (row.order_id && prep?.id === row.order_id) return finir(prep, row);   // numéro déjà noté : on termine sans réévaluer
  } else row = res.row;

  // 2. contrôles (aucune écriture) ; erreur passagère ou plafond du jour : réservation rendue (la même clé repart de zéro)
  let ev;
  try {
    if (sim === "indisponible") throw erreurApi("indisponible", { retry: 30, detail: `Simulation (X-Elixir-Simulation: indisponible) : notre système ne répond pas. ${REJOUER}` });
    const n = await stock.commandes.compterDepuis(acces.odoo_id, test, minuitParisIso(jourParis(now)));
    if (n >= acces.plafond_commandes_jour) throw erreurApi("plafond_commandes_jour", { retry: secondesAvantMinuit(now), extra: { plafond: { nom: "commandes_jour", limite: acces.plafond_commandes_jour, valeur: n } } });
    ev = await evaluer({ demande, acces, ctx, test, stock, services, reglages, now, simulation: sim, apercu });
    if (!ev.refus && Date.now() - t0 > COMMANDE.budget_ms) throw erreurApi("indisponible", { retry: 5, detail: `Notre système est lent. ${REJOUER}` });
  } catch (e) {
    await stock.commandes.liberer(row).catch(() => {});
    if (e?.api) throw e;
    throw erreurApi("indisponible", { retry: 30, detail: `Notre système ne répond pas. ${REJOUER}` });
  }

  // 3. refus métier : réponse enregistrée (rejouée à l'identique), reference_client libérée
  if (ev.refus) {
    const rep = probleme(event, ev.refus.code, requestId, { detail: ev.refus.detail, extra: { ...(ev.refus.extra || {}), lignes: ev.lignes } });
    await stock.commandes.ecrire(row, { etat: "refusee", motif: ev.refus.code, statut_http: rep.statusCode, reponse: rep.body }).catch(() => null);
    return rep;
  }

  // 4. numéro choisi par le serveur et noté AVANT l'insertion, puis insertion et fin
  const corps = corpsCommande({ id: nouveauNumero(test, now), test, demande, ev, now, acces });
  const prepare = await stock.commandes.ecrire(row, { order_id: corps.id, reponse: JSON.stringify(corps) });
  if (!prepare) throw erreurApi("requete_en_cours", { retry: 2 });
  return finir(corps, prepare);
}

// ── DELETE /v1/commandes/{id} ──
// Possible pendant le délai d'annulation (commande reçue, pas encore prise par l'envoi), ou tant qu'une commande gardée
// « à vérifier » n'est pas partie ; jamais si une ligne est envoyée ou si une tâche du relais est en cours ou faite.
// La transition est conditionnelle (état et version lus) : l'envoi et l'annulation ne peuvent pas passer tous les deux.
async function routeAnnuler(arg) {
  const { acces, environnement, maintenant: now, stock, params } = arg;
  const id = params[0];
  const test = environnement === "test";
  if (!(test ? ORDRE_TEST : ORDRE_SITE).test(id)) throw erreurApi("introuvable");
  const row = await stock.commandes.parOrdre(acces.odoo_id, test, id);
  if (!row) throw erreurApi("introuvable");
  const annulee = (r) => ({ id, environnement, etat: "annulee", annulee_le: isoParis(r.updated_at) });
  const tropTard = (etat) => erreurApi("trop_tard", { extra: { etat } });
  if (row.etat === "annulee") { await noterParcours(arg, "annulation"); return annulee(row); }
  if (row.etat === "en_cours") throw erreurApi("requete_en_cours", { retry: 2 });
  const dansDelai = row.etat === "recue" && row.envoi_apres && now.getTime() < Date.parse(row.envoi_apres);
  if (!dansDelai && row.etat !== "a_verifier") throw tropTard(row.etat === "non_servie" ? "non_servie" : row.etat === "recue" || row.etat === "envoi_demande" ? "en_transmission" : "transmise");
  if (!test) {
    const [o, taches] = await Promise.all([stock.site.lire(id), stock.relais.taches(id)]);
    if (!o || o.items.some(it => it?.synced_at) || taches.some(t => !TACHES_LIBEREES.has(t.etat))) throw tropTard("en_transmission");
  }
  const fin = await stock.commandes.ecrire(row, { etat: "annulee", motif: "annulee_par_la_pharmacie", envoi_apres: null });
  if (!fin) {
    const lu = await stock.commandes.parOrdre(acces.odoo_id, test, id);
    if (lu?.etat === "annulee") return annulee(lu);
    throw tropTard("en_transmission");
  }
  if (!test) await marquerLignes(stock, id, null, "annulee", now);
  await noterParcours(arg, "annulation");
  return annulee(fin);
}

export const ROUTES_COMMANDE = [
  { methode: "POST", gabarit: "/v1/commandes/simulation", re: /^\/v1\/commandes\/simulation$/, portee: "commande", classe: "simulation", fiche_fraiche: true, traiter: routeSimulation },
  { methode: "POST", gabarit: "/v1/commandes", re: /^\/v1\/commandes$/, portee: "commande", classe: "commande", fiche_fraiche: true, traiter: routeCommander },
  { methode: "DELETE", gabarit: "/v1/commandes/{id}", re: /^\/v1\/commandes\/([^/]+)$/, portee: "commande", classe: "commande", fiche_fraiche: true, traiter: routeAnnuler },
];
