import React, { useState, useEffect, useCallback, useMemo } from "react";
import { T, R, ui, tone, fmtEur } from "../theme.js";
import { Icone } from "../icons.jsx";
import { libelleOffre, remiseDefaut } from "../peremption-panier.js";

// ── Onglet « Péremptions » de l'admin : « Odoo facture la remise » (V1, docs/peremption-odoo.md, conception § 7) ──
// Chargé à la demande par AdminPanel (React.lazy) : hors du bundle des pharmacies. Tous les appels passent par adminFetch
// (jeton admin renouvelé) vers netlify/functions/peremption.js. Rien ne s'écrit dans Odoo depuis ce navigateur : le serveur
// applique les deux verrous (variable Netlify PEREMPTION_ODOO_ECRITURE=1 ET mode « Actif ») ; en simulation, chaque bouton
// calcule et journalise le plan, sans écriture Odoo.
// Bandeau (mode, verrous, droits Odoo, dernier passage, filet en échec, actualiser, réconcilier, tout retirer), alertes,
// compteurs, filtres, tableau par produit (faits frais : court / long / autre, prix, coût, marge, économie, ventes LGO,
// état), aperçu exact des changements dans Odoo (création ou modification, 6 listes, économie, ce que dira la facture),
// confirmation sous le coût et forçage du lot long, application en lot (40 au plus, saisie du nombre de règles), retrait
// (2 h ou tout de suite, commandes en cours affichées), journal lisible par produit, réglages, contrôle des écarts.
// Les actions longues avancent pas à pas (« etape », chaque appel sous 10 s) ; un 502 ou un 504 est réessayé.
// Règle du 21/10/2026 (décision de Zineb, docs/peremption.md) : la page affiche −50 % par défaut (−20 % dès 500 €) ; colonne
// « Page : remise affichée » (expiry_discounts : 0 à 90 %, 0 = aucune, vide = défaut ; aucune écriture Odoo) avec ce que
// facture Odoo ; « Appliquer dans Odoo » prérempli avec la remise affichée ; tuile « Écarts à rectifier » (résumé du jour) et
// Contrôle des écarts : chaque ligne prise au prix de la page et facturée plus cher, statut « à rectifier / rectifié »,
// référence libre (n° d'avoir…), qui et quand (peremption_ecarts, sql/peremption-ecarts.sql), totaux par pharmacie, CSV.

const API = "/.netlify/functions/peremption";
const ODOO_WEB = "https://odoo.elixir-pharma.fr";
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (n == null ? "–" : fmtEur(n));
const pct = (n) => (n == null ? "–" : `${String(Number(Number(n).toFixed(1))).replace(".", ",")} %`);
const pctBrut = (n) => String(Number(Number(n).toFixed(2))).replace(".", ",");
// dates et heures à Paris (entre minuit et 2 h, l'UTC donnerait la veille)
const dateFr = (d) => {
  const s = String(d || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return `${m[3]}/${m[2]}/${m[1]}`; }
  const t = Date.parse(s.replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$|^\d{4}-\d{2}-\d{2}$/.test(s) ? "" : "Z"));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }) : "–";
};
const heureFr = (d) => { const t = Date.parse(d || ""); return Number.isFinite(t) ? new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–"; };
const attendre = (ms) => new Promise(r => setTimeout(r, ms));
// début de la règle panier : premier jour du contrôle des écarts (« depuis »)
export const DEBUT_REGLE_PANIER = "2026-10-21";

// Remise saisie : entier de 0 à 90 (0 = aucune remise : « Retirer ») ; toute autre saisie → null (refusée)
export const remiseSaisie = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 90 ? n : null;
};
// Prix habituel liste 5 d'un produit : figé à la décision s'il y en a une (les faits relus portent alors NOTRE remise),
// sinon celui des faits frais
export function habituelDe(p) {
  const fige = p?.decision?.prix_habituel;
  const v = Number(fige?.["5"] ?? fige?.[5] ?? p?.faits?.prix_listes?.["5"] ?? p?.faits?.prix_listes?.[5]);
  return Number.isFinite(v) && v > 0 ? v : null;
}
// Prix visé par une remise (aperçu du tableau ; l'aperçu du serveur fait foi) : % du prix de base, ou du prix habituel
// (habituel : figé à la décision s'il y en a une)
export function prixVise(f, remise, base = "prix_base", habituel = null) {
  const lp = Number(f?.list_price), l5 = Number(habituel ?? f?.prix_listes?.["5"] ?? f?.prix_listes?.[5]);
  if (!(remise > 0)) return null;
  if (base === "prix_liste5") return l5 > 0 ? r2(l5 * (1 - remise / 100)) : null;
  return lp > 0 ? r2(lp * (1 - remise / 100)) : null;
}
// « Appliquer dans Odoo » prérempli : la remise qui fait facturer par Odoo le prix que la page annonce. Base « % du prix de
// base » : la remise affichée ; base « % du prix habituel (liste 5) » : 1 − prix de la page / prix habituel (1 à 90 %)
export function remiseRegleDepuisPage(p, R0) {
  const a = p?.affichage;
  if (!(a?.remise >= 1)) return null;
  if (R0?.base_remise !== "prix_liste5") return a.remise;
  const h = habituelDe(p);
  if (!(h > 0) || !(a.pn > 0)) return a.remise;
  return Math.min(90, Math.max(1, Math.round(100 * (1 - a.pn / h))));
}
// Économie pour la pharmacie par rapport à son prix habituel (liste 5), en % (arrondi au dixième)
export const economie = (prix, habituel) => (prix > 0 && habituel > 0 ? Math.round((1 - prix / habituel) * 1000) / 10 : null);

export const ETATS = {
  facture: ["Facturé par Odoo", "ok"], en_cours: ["En cours", "info"], simule: ["Simulé", "neutral"], a_remiser: ["Règle Odoo proposée", "warn"],
  non_facture: ["Sans règle Odoo", "neutral"], exclu: ["Règle Odoo exclue", "neutral"], court_epuise: ["Court épuisé", "neutral"], sortie_date: ["Sortie par la date", "neutral"],
  faits_absents: ["Faits à lire", "neutral"], retrait: ["Retrait en attente", "warn"], partiel: ["Partiel", "danger"], erreur: ["Erreur", "danger"], modifie_odoo: ["Modifié dans Odoo", "danger"],
  facture_site: ["Facturé, page à mettre à jour", "info"], baisse: ["Baisse en attente", "warn"],
};
const MODES = { simulation: "Simulation", actif: "Actif", creations_suspendues: "Créations suspendues" };
// ordre du tableau : ce qui demande une action d'abord
const ORDRE = ["erreur", "partiel", "modifie_odoo", "retrait", "baisse", "en_cours", "facture_site", "facture", "simule", "a_remiser", "non_facture", "exclu", "sortie_date", "court_epuise", "faits_absents"];
const RAISONS = { remise_retiree: "remise retirée", sortie_date: "sortie par la date", court_epuise: "stock court épuisé", lot_long_recu: "lot long reçu", exclu: "produit exclu",
  tout_retirer: "« Tout retirer »", refus: "refusée", fin_simulation: "fin de la simulation", regle_supprimee_odoo: "règle supprimée dans Odoo", regle_orpheline: "règle retrouvée sous une décision close" };

// ── Journal lisible (libellés, résultats, détail en phrases ; le JSON reste dans « détail technique ») ──
export const ACTIONS_JOURNAL = { creer: "Création de la règle", controler: "Contrôle du prix facturé", prix_site: "Prix du site", cacher: "Remise facturée retirée (la page reprend la remise affichée)",
  retirer: "Suppression dans Odoo", adopter: "Règle retrouvée après coupure", plan: "Plan du passage", decision: "Décision", modifier: "Modification de la règle",
  relire: "Relecture de la règle", refus: "Refusé", alerte: "Alerte", resume: "Résumé de la nuit", mode: "Changement de mode", reglages: "Réglages", droits: "Droits Odoo",
  verrou: "Passage déjà en cours", essai_t1: "Essai T1 (dates)", completer: "Création à compléter", baisser: "Baisse de la remise", reverifier: "Contrôle du prix facturé", fin: "Date de fin",
  remise_affichee: "Remise affichée (page)", ecart: "Écart (rectification)" };
export const RESULTATS_JOURNAL = { ok: "fait", simule: "simulé", echec: "échec", reporte: "reporté", ignore: "rien fait", en_cours: "demandé", incertain: "incertain" };
export const MODES_JOURNAL = { simulation: "simulation", actif: "actif", creations_suspendues: "créations suspendues", site: "site (sans Odoo)" };
export function detailJournal(l) {
  const a = l?.apres || {};
  if (l?.message) return l.message;
  if (l?.action === "controler" && a.prix_facture !== undefined) return `Liste n° ${l.pricelist_id} : facturé ${fmt(a.prix_facture)}, attendu ${fmt(a.prix_attendu)}`;
  if (a.compute_price === "percentage" && a.percent_price != null) return `Liste n° ${a.pricelist_id ?? l.pricelist_id} : remise ${pctBrut(a.percent_price)} % sur le prix de base, du ${dateFr(a.date_start)} au ${dateFr(a.date_end)}`;
  if (a.discounted_price !== undefined) return `Prix du site : ${fmt(a.discounted_price)}`;
  return "";
}

// ── Contrôle des écarts : traduction, totaux et export ──
export const FACTURATION = { invoiced: "facturée", "to invoice": "à facturer", no: "rien à facturer", upselling: "à facturer (supplément)" };
export const TYPES_ECART = { peremption: "page Péremption (« Pér. »)", probable: "ancienne page (probable)", autre: "autre écart" };
export const STATUTS_ECART = { a_rectifier: "à rectifier", rectifie: "rectifié" };
export const MOTIFS_NON_RETROUVEE = { pas_encore: "commande pas encore dans Odoo", introuvable: "commande introuvable dans Odoo (plus de 48 h)", sans_produit: "commande Odoo sans ce produit",
  attente_import: "commande à part pas encore importée", a_part_introuvable: "commande à part introuvable dans Odoo (plus de 48 h)", non_servie: "boîtes servies : celles des autres lignes seulement (service réduit)" };
// Cellule CSV : une cellule qui commence par = + - @ (ou une tabulation, un retour) est préfixée d'une apostrophe (le tableur ne
// l'exécute pas comme une formule) ; « ; », « " » et les retours à la ligne entre guillemets
export const csvCellule = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function csvEcarts(lignes) {
  const tete = ["Date", "Pharmacie", "Réf. site", "Commande Odoo", "Liste", "CIP", "Produit", "Qté", "Prix page", "Facturé (net Odoo)", "Écart", "Type", "Pér.", "Remise page",
    "À vérifier", "Facturation", "Statut", "Référence", "Par", "Le", "CIP pharmacie", "Complément à rectifier", "Avoirs détectés", "Règle Odoo absente"];
  const num = (n) => (n == null ? "" : String(n).replace(".", ","));
  return [tete, ...(lignes || []).map(l => [dateFr(l.date), l.pharmacie, l.commande, l.odoo, l.liste_nom || l.liste, l.cip, l.nom, l.qte, num(l.pn), num(l.net), num(l.ecart),
    TYPES_ECART[l.type] || (l.page_peremption ? "page péremption probable" : "autre écart"), l.peremption ? dateFr(l.peremption) : "", l.remise != null ? `${num(l.remise)} %` : "",
    l.coherent === false ? (l.a_verifier?.length ? `oui : ${l.a_verifier.join(" ; ")}` : "oui") : "", FACTURATION[l.facturation] || l.facturation || "", STATUTS_ECART[l.statut] || l.statut || "", l.reference || "", l.par || "", l.le ? heureFr(l.le) : "",
    l.pharmacy_cip || "", l.complement > 0 ? num(l.complement) : "", (l.avoirs || []).map(a => `${a.numero} (${num(a.montant)} €)`).join(", "), l.regle_absente ? "oui" : ""])]
    .map(r => r.map(csvCellule).join(";")).join("\r\n");
}
// Totaux : lignes « Pér. » cohérentes seulement (« à vérifier » et autres types à part), par pharmacie (CIP ; deux pharmacies du
// même nom restent deux) et en tout. À rectifier : écart des lignes « à rectifier » et complément des lignes rectifiées dont
// l'écart a grossi. cles : lignes que « Tout marquer rectifié… » peut marquer (« Pér. », cohérentes, à rectifier).
export function totauxEcarts(lignes) {
  const r2l = (n) => Math.round(n * 100) / 100;
  const parPh = new Map();
  const zero = () => ({ montant: 0, lignes: 0 });
  const tout = { a_rectifier: zero(), rectifie: zero(), a_verifier: zero(), autres: zero() };
  const ajoute = (o, m) => { o.montant = r2l(o.montant + (m || 0)); o.lignes++; };
  for (const l of lignes || []) {
    if (l.type !== "peremption") { ajoute(tout.autres, l.ecart); continue; }
    if (l.coherent === false) { if (l.statut !== "rectifie") ajoute(tout.a_verifier, l.ecart); continue; }
    const k = l.pharmacy_cip || l.pharmacie || "?";
    const v = parPh.get(k) || { cle: k, pharmacie: l.pharmacie || "?", pharmacy_cip: l.pharmacy_cip || null, a_rectifier: zero(), rectifie: zero(), cles: [] };
    if (l.statut === "rectifie") { ajoute(v.rectifie, l.ecart_rectifie ?? l.ecart); ajoute(tout.rectifie, l.ecart_rectifie ?? l.ecart); }
    const reste = l.statut === "rectifie" ? l.complement || 0 : l.ecart;
    if (reste > 0) { ajoute(v.a_rectifier, reste); ajoute(tout.a_rectifier, reste); if (l.statut !== "rectifie") v.cles.push(l.cle); }
    parPh.set(k, v);
  }
  const pharmacies = [...parPh.values()].sort((a, b) => b.a_rectifier.montant - a.a_rectifier.montant || b.rectifie.montant - a.rectifie.montant);
  return { ...tout, pharmacies, nbPharmaciesARectifier: pharmacies.filter(p => p.a_rectifier.lignes > 0).length };
}
// Ce que demande une ligne : commande Odoo pas encore facturée → corriger la commande (la ligne disparaît au contrôle suivant) ;
// facturée → avoir (référence obligatoire)
export const actionEcart = (l) => (l?.facturation === "invoiced" || (l?.avoirs || []).length ? "avoir" : "corriger");

// Message de fin d'une application : noms, règles vérifiées, refus et raisons
export function texteFinLot(r, nomDe = (c) => c) {
  const res = r?.resultats || [];
  const facturees = res.filter(x => x.statut === "facturee").map(x => nomDe(x.item?.cip));
  const simulees = res.filter(x => x.simule).map(x => nomDe(x.item?.cip));
  const baisses = res.filter(x => x.baisse).map(x => nomDe(x.item?.cip));
  const partielles = res.filter(x => ["partielle", "erreur"].includes(x.statut)).map(x => nomDe(x.item?.cip));
  const erreurs = [...(r?.erreurs || [])].map(e => `${nomDe(e.cip)} (${e.erreur})`);
  const refus = (r?.refus || []).map(x => `${nomDe(x.cip)} (${x.raisons.map(y => y.texte).join(", ")})`);
  return [facturees.length ? `${facturees.join(", ")} : facturé${facturees.length > 1 ? "s" : ""} par Odoo` : "",
    simulees.length ? `${simulees.join(", ")} : simulé${simulees.length > 1 ? "s" : ""}, rien écrit dans Odoo` : "",
    baisses.length ? `${baisses.join(", ")} : baisse enregistrée, écrite dans Odoo après le délai` : "",
    partielles.length ? `${partielles.join(", ")} : partiel ou en erreur (voir le journal)` : "",
    erreurs.length ? `erreur : ${erreurs.join(" ; ")}` : "", refus.length ? `refusé : ${refus.join(" ; ")}` : ""].filter(Boolean).join(" · ");
}

export default function PeremptionsAdmin({ adminFetch }) {
  const [etat, setEtat] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);           // { ton, texte }
  const [occupe, setOccupe] = useState(null);             // texte de l'opération en cours
  const [remises, setRemises] = useState({});             // cip → saisie
  const [selection, setSelection] = useState(() => new Set());
  const [filtre, setFiltre] = useState({ etat: "", long: false, sousCout: false, exclu: false, lgo: false, texte: "" });
  const [apercu, setApercu] = useState(null);             // fenêtre d'aperçu : { donnees, cips, remise, force, sousCout, lot, confirmation, modifs }
  const [retrait, setRetrait] = useState(null);           // fenêtre de retrait : { cips, nom, toutDeSuite, lecture }
  const [toutRetirer, setToutRetirer] = useState(null);   // { saisie, lecture }
  const [journal, setJournal] = useState(null);           // { cip, lignes }
  const [panneau, setPanneau] = useState(null);           // "reglages" | "ecarts" | "alertes" | null
  const [resume, setResume] = useState(null);             // résumé des écarts à rectifier (tuile du bandeau)

  const appel = useCallback(async (url, options) => {
    const res = await adminFetch(url, options);
    const corps = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(corps?.message || corps?.error || `HTTP ${res.status}`), { status: res.status });
    return corps;
  }, [adminFetch]);
  const poste = useCallback((corps) => appel(API, { method: "POST", body: JSON.stringify(corps) }), [appel]);

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null);
    try { setEtat(await appel(`${API}?action=admin`)); }
    catch (e) { setErreur(e.message); }
    finally { setChargement(false); }
  }, [appel]);
  useEffect(() => { charger(); }, [charger]);
  // résumé du jour des écarts à rectifier (lignes « Pér. » facturées plus cher par Odoo) : lu à part, sans bloquer l'onglet
  const chargerResume = useCallback(async (frais = false) => {
    try { setResume(await appel(`${API}?action=ecarts_resume${frais ? "&frais=1" : ""}`)); }
    catch (e) { setResume({ erreur: e.message }); }
  }, [appel]);
  useEffect(() => { chargerResume(); }, [chargerResume]);

  // passage pas à pas (chaque appel sous 10 s), jusqu'à la fin ; un 502 ou un 504 (fonction coupée) est réessayé
  const suivre = useCallback(async (r, libelle) => {
    let n = 0, cur = r, essais = 0;
    const tous = { resultats: [...(r?.resultats || [])], erreurs: [...(r?.erreurs || [])] };
    while (cur && !cur.fini && cur.passage_id !== undefined && n++ < 400) {
      setOccupe(`${libelle} : ${cur.curseur ?? 0} / ${cur.total ?? "?"}${cur.attente ? ` (${cur.attente})` : ""}${essais ? " (nouvel essai)" : ""}`);
      if (cur.attente) await attendre(3000);
      try {
        const suite = await poste({ action: "etape", passage_id: r.passage_id });
        essais = 0;
        tous.resultats.push(...(suite.resultats || [])); tous.erreurs.push(...(suite.erreurs || []));
        cur = { ...suite, passage_id: r.passage_id };
      } catch (e) {
        if (![502, 503, 504].includes(e.status) || ++essais > 5) throw e;
        await attendre(2000 * essais);
      }
    }
    return { ...cur, ...tous };
  }, [poste]);
  const nomDe = useCallback((cip) => etat?.produits?.find(p => p.cip === cip)?.nom || cip, [etat]);
  const action = async (libelle, fn) => {
    setOccupe(libelle); setMessage(null);
    try {
      const r = await fn();
      if (r?.erreur) setMessage({ ton: "danger", texte: r.erreur });
      else { const t = texteFinLot(r, nomDe); setMessage({ ton: (r?.erreurs || []).length ? "warn" : "ok", texte: `${libelle} : terminé${t ? ` · ${t}` : ""}${r?.corrections?.length ? ` · ${r.corrections.map(c => `${c.libelle} : ${JSON.stringify(c.saisi)} hors limites, gardé à ${JSON.stringify(c.garde)}`).join(" ; ")}` : ""}` }); }
    }
    catch (e) { setMessage({ ton: "danger", texte: `${libelle} : ${e.message}` }); }
    finally { setOccupe(null); await charger(); }
  };

  // « Actualiser depuis Odoo » : synchro des péremptions (odoo-expiry-sync), puis faits frais de la page
  const actualiser = () => action("Actualiser depuis Odoo", async () => {
    let offset = 0, garde = 0;
    while (garde++ < 400) {
      const res = await adminFetch(`/.netlify/functions/odoo-expiry-sync?offset=${offset}`);
      if (!res.ok) break;
      const d = await res.json();
      setOccupe(`Péremptions : ${offset + (d.batch_size || 0)} / ${d.total_in_stock || "?"}`);
      if (d.error || d.done || !d.next_offset) break;
      offset = d.next_offset;
    }
    let off = 0; garde = 0;
    while (off != null && garde++ < 100) { const f = await poste({ action: "faits", offset: off }); setOccupe(`Faits frais : ${f.lus} / ${f.total}`); off = f.next_offset; }
    return {};
  });
  const reconcilier = () => action("Réconcilier maintenant", async () => { const r = await poste({ action: "reconcilier" }); return r.fini ? r : suivre(r, "Réconciliation"); });
  const controlerDroits = () => action("Droits Odoo", async () => { const d = await appel(`${API}?action=droits`); return d.ok ? {} : { erreur: `Droits Odoo incomplets : ${texteDroits(d)}` }; });
  const changerMode = (mode) => {
    const n = etat?.compteurs?.facturees || 0, s = etat?.compteurs?.simulees || 0;
    const textes = {
      actif: `Passer en mode « Actif » : les décisions créeront, modifieront et supprimeront des règles dans Odoo.${s ? `\n\nLes ${s} décision(s) simulée(s) seront closes (rien n'a été écrit dans Odoo) : il faudra les réappliquer une par une ou en lot, avec un nouvel aperçu. Notez la liste des produits « Simulé » avant de continuer.` : ""}\n\nContinuer ?`,
      simulation: `Repasser en simulation : plus aucune écriture dans Odoo, pas même les suppressions.${n ? `\n\nLes ${n} remise(s) facturée(s) restent annoncées sur la page et facturées par Odoo ; leur retrait dans Odoo ne se fera plus avant leur date de fin (si Odoo respecte les dates : essai T1 à prouver). Pour arrêter la facturation : « Retirer toutes les règles du site » AVANT de repasser en simulation.` : ""}\n\nContinuer ?`,
      creations_suspendues: "Suspendre les créations : plus aucune création ni hausse de remise ; les retraits et les baisses continuent. Continuer ?" };
    if (!window.confirm(textes[mode])) return;
    action(`Mode « ${MODES[mode]} »`, () => poste({ action: "mode", mode, confirmation: true }));
  };
  const ouvrirApercu = async (cips, remise, { force = {}, sousCout = {}, lot = false } = {}) => {
    setOccupe("Aperçu : lecture d'Odoo"); setMessage(null);
    try {
      const d = await poste({ action: "apercu", cips, remise_pct: remise, force_lot_long: force, sous_cout_confirme: sousCout });
      setApercu({ donnees: d, cips, remise, force, sousCout, lot, confirmation: "", modifs: false });
    } catch (e) { setMessage({ ton: "danger", texte: `Aperçu : ${e.message}` }); }
    finally { setOccupe(null); }
  };
  const appliquer = async () => {
    const a = apercu;
    const ok = a.donnees.produits.filter(p => applicable(p, a));
    if (!ok.length) return;
    setApercu(null);
    if (a.lot) setSelection(new Set());
    await action(a.lot ? "Application en lot" : ok[0]?.type === "modifier" ? "Modifier la remise" : "Appliquer dans Odoo", async () => {
      const r = await poste({ action: "appliquer", cips: ok.map(p => p.cip), remise_pct: a.remise, apercus: Object.fromEntries(ok.map(p => [p.cip, p.apercu_id])),
        sous_cout_confirme: Object.fromEntries(ok.filter(p => a.sousCout[p.cip]).map(p => [p.cip, true])),
        force_lot_long: Object.fromEntries(ok.filter(p => a.force[p.cip] != null).map(p => [p.cip, a.force[p.cip]])),
        ...(ok.length > 1 ? { confirmation_regles: Number(a.confirmation) } : {}) });
      if (r.erreur) return r;
      return { ...(await suivre(r, "Application")), refus: r.refus };
    });
  };
  const lireRetrait = useCallback(async (cips) => appel(`${API}?action=retrait_apercu${cips ? `&cips=${cips.join(",")}` : ""}`).catch(e => ({ erreur: e.message })), [appel]);
  // aussiPage (coché par défaut) : sans règle Odoo, la page reviendrait à la remise affichée (−50 % par défaut), qu'Odoo ne
  // facture pas ; cochée, la remise affichée de ces produits passe aussi à 0 % (prix habituel sur la page)
  const ouvrirRetrait = async (cips, nom, toutDeSuite = false) => { setRetrait({ cips, nom, toutDeSuite, aussiPage: true, lecture: null }); const lecture = await lireRetrait(cips); setRetrait(x => (x ? { ...x, lecture } : x)); };
  const ouvrirToutRetirer = async () => { setToutRetirer({ saisie: "", aussiPage: true, lecture: null }); const lecture = await lireRetrait(null); setToutRetirer(x => (x ? { ...x, lecture } : x)); };
  const remisesAZero = async (cips) => {
    for (const cip of cips) await poste({ action: "remise_affichee", cip, remise_pct: 0, nom: nomDe(cip) });
  };
  const retirer = async () => {
    const r0 = retrait; setRetrait(null);
    if (r0.cips.length > 1) setSelection(new Set());
    await action("Retirer", async () => {
      // remise affichée à 0 d'abord : tant que la règle est facturée, la page montre la règle (la remise affichée n'y joue pas)
      if (r0.aussiPage) await remisesAZero(r0.cips);
      const r = await poste({ action: "retirer", cips: r0.cips, tout_de_suite: !!r0.toutDeSuite });
      return suivre(r, "Retrait");
    });
  };
  const reessayer = (cip) => action("Réessayer", async () => { const r = await poste({ action: "reessayer", cip }); return r.erreur ? r : suivre(r, "Réessai"); });
  // remise affichée sur la page (expiry_discounts ; aucune écriture Odoo) : 0 à 90 %, null = défaut
  const remiseAffichee = (p, remise) => action(`Remise affichée · ${p.nom}`, async () => {
    const r = await poste({ action: "remise_affichee", cip: p.cip, remise_pct: remise, nom: p.nom });
    return r.erreur ? r : {};
  });
  const confirmerToutRetirer = async () => {
    const c = toutRetirer?.saisie, aussiPage = !!toutRetirer?.aussiPage; setToutRetirer(null);
    // produits qui ont une décision ouverte (ceux dont la règle est retirée)
    const cips = (etat?.produits || []).filter(p => p.decision && !["retiree"].includes(p.decision.statut)).map(p => p.cip);
    await action("Retirer toutes les règles du site", async () => {
      if (aussiPage) await remisesAZero(cips);
      const r = await poste({ action: "tout_retirer", confirmation: c });
      return suivre(r, "Suppressions dans Odoo");
    });
  };
  const voirJournal = async (cip) => {
    if (journal?.cip === cip) { setJournal(null); return; }
    try { setJournal({ cip, lignes: (await appel(`${API}?action=journal${cip ? `&cip=${cip}` : ""}&limit=100`)).lignes }); }
    catch (e) { setMessage({ ton: "danger", texte: `Journal : ${e.message}` }); }
  };

  const R0 = etat?.reglages;
  const produits = useMemo(() => {
    if (!etat) return [];
    const t = filtre.texte.trim().toLowerCase();
    return etat.produits.filter(p => {
      const f = p.faits;
      const r = remiseSaisie(remises[p.cip] ?? p.decision?.remise_pct ?? "");
      const pv = r ? prixVise(f, r, p.decision?.apercu?.base || R0?.base_remise, habituelDe(p)) : null;
      if (filtre.etat && p.etat !== filtre.etat) return false;
      if (filtre.long && !((f?.long_qte || 0) + (f?.autre_qte || 0) > 0)) return false;
      if (filtre.sousCout && !(pv != null && Number(f?.cout) > 0 && pv < Number(f.cout))) return false;
      if (filtre.exclu && !(f?.exclusions || []).length) return false;
      if (filtre.lgo && !(f?.ventes_30j?.lgo > 0)) return false;
      if (t && !String(p.nom).toLowerCase().includes(t) && !p.cip.includes(t)) return false;
      return true;
    }).sort((a, b) => (ORDRE.indexOf(a.etat) - ORDRE.indexOf(b.etat)) || String(a.faits?.court_fin || a.catalogue?.earliest_expiry || "9").localeCompare(String(b.faits?.court_fin || b.catalogue?.earliest_expiry || "9")));
  }, [etat, filtre, remises, R0]);
  // « Tout sélectionner » : seulement les produits sans décision ouverte et remisables (pas une modification d'office)
  const selectionnables = useMemo(() => produits.filter(p => !p.decision && !(p.faits?.exclusions || []).length), [produits]);

  if (chargement && !etat) return <div style={{ ...ui.card, padding: 40, textAlign: "center", color: T.inkMute }}>Chargement de l'onglet Péremptions…</div>;
  if (erreur && !etat) {
    return (
      <div style={{ ...ui.card }}>
        <div role="alert" style={{ ...encart("danger") }}><Icone nom="alerte" taille={16} /><span>Onglet Péremptions indisponible : {erreur}.
          {/non_install|SERVICE_ROLE|peremption_reglages|mise en service/i.test(erreur) ? " La mise en service n'est pas faite : tables Supabase et clé serveur (procédure de mise en service, étapes 1 et 2)." : ""}</span></div>
        <button onClick={charger} className="ex-btn-ligne" style={{ ...ui.btn("ligne", "s"), marginTop: 12 }}><Icone nom="actualiser" taille={14} />Réessayer</button>
      </div>
    );
  }
  const v = etat.verrous, c = etat.compteurs, dernier = etat.passages?.[0];
  const droitsOk = R0?.droits?.ok;
  const actifSansEffet = R0.mode === "actif" && !v.variable;
  const surPrixHabituel = R0.base_remise === "prix_liste5";

  return (
    <div className="ex-peremptions-admin">
      {/* ── Bandeau ── */}
      <div style={{ ...ui.card, marginBottom: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>Péremption courte · Odoo facture la remise</div>
            <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>Fenêtre de la page : du {dateFr(etat.fenetre?.min)} au {dateFr(etat.fenetre?.max)} · état lu à {heureFr(etat.maj)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ex-btn-ligne" disabled={!!occupe} onClick={actualiser} style={btnL}><Icone nom="actualiser" taille={14} />Actualiser depuis Odoo</button>
            <button className="ex-btn-ligne" disabled={!!occupe} onClick={reconcilier} style={btnL}><Icone nom="balance" taille={14} />Réconcilier maintenant</button>
            <button disabled={!!occupe} onClick={ouvrirToutRetirer} style={{ ...ui.btn("danger", "s") }}><Icone nom="corbeille" taille={14} />Retirer toutes les règles du site</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          <Tuile titre="Mode" ton={actifSansEffet ? "warn" : R0.mode === "actif" ? "ok" : R0.mode === "simulation" ? "neutral" : "warn"}>
            <div style={{ fontWeight: 800 }}>{actifSansEffet ? "Actif, sans effet" : MODES[R0.mode]}</div>
            {actifSansEffet && <div style={{ fontSize: 11, marginTop: 2 }}>variable Netlify absente : rien ne s'écrit dans Odoo</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {Object.keys(MODES).filter(m => m !== R0.mode).map(m => (
                <button key={m} disabled={!!occupe || (m === "actif" && !v.variable)} onClick={() => changerMode(m)} title={m === "actif" && !v.variable ? "Variable Netlify PEREMPTION_ODOO_ECRITURE=1 absente" : undefined}
                  style={{ ...ui.btn("ligne", "s"), height: 26, fontSize: 11, opacity: m === "actif" && !v.variable ? 0.5 : 1 }}>{MODES[m]}</button>
              ))}
            </div>
          </Tuile>
          <Tuile titre="Écriture Odoo" ton={v.creation ? "ok" : v.retrait ? "warn" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{v.creation ? "Créations et retraits" : v.retrait ? "Retraits seulement" : "Aucune"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Variable Netlify : {v.variable ? "présente" : v.contexte ? `ignorée (déploiement « ${v.contexte} »)` : "absente"} · mode : {MODES[R0.mode]}</div>
          </Tuile>
          <Tuile titre="Droits Odoo" ton={droitsOk ? "ok" : R0.droits ? "danger" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{R0.droits ? (droitsOk ? "OK" : "KO") : "Pas encore contrôlés"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{R0.droits?.compte ? `Compte du site : ${R0.droits.compte.login}` : "Compte du site : ?"}{R0.droits?.at ? ` · ${heureFr(R0.droits.at)}` : ""}</div>
            <button disabled={!!occupe} onClick={controlerDroits} style={{ ...ui.btn("ligne", "s"), height: 26, fontSize: 11, marginTop: 6 }}>Contrôler (lecture seule)</button>
          </Tuile>
          <Tuile titre="Filet Odoo (dates)" ton={R0.filet_dates_odoo === "oui" ? "ok" : R0.filet_dates_odoo === "non" ? "danger" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{{ oui: "Oui (essai T1)", non: "Non : filet horaire seul", a_prouver: "À prouver (essai T1)" }[R0.filet_dates_odoo]}</div>
          </Tuile>
          <Tuile titre="Écarts à rectifier" ton={resume?.erreur ? "neutral" : resume?.a_rectifier?.montant > 0 ? "warn" : resume ? "ok" : "neutral"}>
            <div className="ex-ecarts-resume" style={{ fontWeight: 800 }}>{!resume ? "Lecture…" : resume.erreur ? "Indisponible" : resume.a_rectifier.lignes
              ? `${fmt(resume.a_rectifier.montant)} à rectifier pour ${resume.a_rectifier.pharmacies} pharmacie${resume.a_rectifier.pharmacies > 1 ? "s" : ""}` : "Aucun écart à rectifier"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{resume?.erreur ? resume.erreur : resume ? `${resume.a_rectifier.lignes} ligne(s) « Pér. » depuis le ${dateFr(resume.depuis)}${resume.rectifie?.lignes ? ` · rectifié : ${fmt(resume.rectifie.montant)}` : ""}${resume.complet === false ? " · lecture partielle" : ""}${resume.suivi === "non_installe" ? " · suivi non installé (sql/peremption-ecarts.sql)" : ""} · ${heureFr(resume.maj)}` : ""}</div>
            {resume && !resume.erreur && (resume.a_verifier?.lignes > 0 || resume.non_retrouvees?.lignes > 0) && <div className="ex-ecarts-a-verifier" style={{ fontSize: 11, marginTop: 4, fontWeight: 700 }}>
              {[resume.a_verifier?.lignes > 0 ? `${resume.a_verifier.lignes} ligne(s) à vérifier (${fmt(resume.a_verifier.montant)}, hors total)` : "",
                resume.non_retrouvees?.lignes > 0 ? `${resume.non_retrouvees.lignes} ligne(s) non retrouvée(s) dans Odoo` : ""].filter(Boolean).join(" · ")}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setPanneau("ecarts")} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Voir les écarts</button>
              <button onClick={() => { setResume(null); chargerResume(true); }} style={{ ...ui.btn("lien"), fontSize: 11, color: T.inkMute }}>Relire</button>
            </div>
          </Tuile>
          <Tuile titre="Dernier passage" ton={dernier?.statut === "fini" ? "ok" : dernier?.statut === "erreur" ? "danger" : dernier?.statut === "verrou" ? "warn" : "neutral"}>
            <div style={{ fontWeight: 700 }}>{dernier ? `${heureFr(dernier.debut)} · ${ACTEURS[dernier.acteur] || dernier.acteur}` : "Aucun"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{dernier ? `${STATUTS_PASSAGE[dernier.statut] || dernier.statut || "en cours"}${dernier.resume?.disjoncteur ? ` · disjoncteur : ${dernier.resume.disjoncteur}` : ""}` : ""}</div>
            {etat.resume_nuit && <div style={{ fontSize: 11, marginTop: 4 }} title={etat.resume_nuit.apres?.texte}>{etat.resume_nuit.message} ({heureFr(etat.resume_nuit.at)})</div>}
            <button onClick={() => voirJournal(null)} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal, marginTop: 6 }}>Journal complet</button>
          </Tuile>
        </div>
        {(!v.creation) && (
          <div role="note" style={encart(c.facturees ? "warn" : "info")}><Icone nom="horloge" taille={16} /><span>
            <strong>Aucune écriture dans Odoo</strong> ({actifSansEffet ? "mode Actif, mais variable Netlify absente" : v.retrait ? "créations suspendues : seuls les retraits et les baisses s'écrivent" : `mode ${MODES[R0.mode]}${v.variable ? "" : ", variable Netlify absente"}`}). Les boutons
            calculent et journalisent les changements exacts{v.retrait ? "" : " ; les suppressions sont simulées"}.
            {c.facturees ? ` ${c.facturees} remise(s) déjà posée(s) restent facturées par Odoo jusqu'à leur retrait ou leur date de fin.` : ""} La page des pharmacies affiche la
            remise de la colonne « Page » (−50 % par défaut, −20 % dès 500 €) : sans règle Odoo, Odoo facture le tarif de la liste du client ; les écarts se
            rectifient depuis le Contrôle des écarts.</span></div>
        )}
        {etat.filet?.echec_depuis && <div role="alert" style={encart("danger")}><Icone nom="alerte" taille={16} /><span><strong>Filet horaire en échec depuis {heureFr(etat.filet.echec_depuis)}</strong> : {etat.filet.erreur || "voir le journal"}. Les retraits automatiques (date, stock) ne se font pas tant que l'erreur dure.</span></div>}
        {etat.verrou && <div role="status" style={encart("warn")}><Icone nom="cadenas" taille={16} /><span>Un passage est en cours ({ACTEURS[etat.verrou.acteur] || etat.verrou.acteur}) : les actions attendent qu'il finisse.</span></div>}
        {occupe && <div role="status" style={encart("info")}><Icone nom="horloge" taille={16} /><span>{occupe}…</span></div>}
        {message && <div role={message.ton === "danger" ? "alert" : "status"} style={encart(message.ton)}><Icone nom={message.ton === "danger" ? "alerte" : "coche"} taille={16} /><span>{message.texte}</span></div>}
      </div>

      {/* ── Alertes (7 jours ; le résumé de la nuit est dans la tuile « Dernier passage ») ── */}
      {etat.alertes?.length > 0 && (
        <div style={{ ...ui.card, marginBottom: 14, borderColor: tone("warn").border }}>
          <button onClick={() => setPanneau(panneau === "alertes" ? null : "alertes")} style={{ ...ui.btn("lien"), color: T.warn, fontWeight: 700 }}>
            {etat.alertes.length} alerte{etat.alertes.length > 1 ? "s" : ""} sur 7 jours {panneau === "alertes" ? "▴" : "▾"}</button>
          {panneau === "alertes" && <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, color: T.inkSoft, display: "grid", gap: 6 }}>
            {etat.alertes.map((a, i) => <li key={i}><strong>{heureFr(a.at)}</strong> · {a.message}{a.resultat === "simule" ? " (e-mail non envoyé : verrous fermés)" : ""}<div style={{ color: T.inkMute }}>{a.apres?.texte}</div></li>)}
          </ul>}
        </div>
      )}

      {/* ── Compteurs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Compteur libelle="Produits sur la page" valeur={c.visibles ?? c.page} detail={c.masques ? `${c.masques} sans boîte courte masqué${c.masques > 1 ? "s" : ""}` : undefined} />
        <Compteur libelle="Remisés sur la page (remise affichée)" valeur={c.remises_affichees ?? "–"} ton="warn" detail="−50 % par défaut, −20 % dès 500 €" />
        <Compteur libelle="Facturés par Odoo" valeur={c.facturees} ton="ok" onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "facture" ? "" : "facture" }))} actif={filtre.etat === "facture"} />
        <Compteur libelle="Non facturés par Odoo" valeur={c.non_facturees} detail={`dont ${c.a_remiser} règle${c.a_remiser > 1 ? "s" : ""} Odoo proposée${c.a_remiser > 1 ? "s" : ""}`}
          titre="Sans règle Odoo : la page affiche quand même la remise de la colonne Page (écarts à rectifier)" />
        <Compteur libelle="Règle Odoo proposée" valeur={c.a_remiser} ton="warn" onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "a_remiser" ? "" : "a_remiser" }))} actif={filtre.etat === "a_remiser"}
          titre="Produits que la proposition ferait facturer par Odoo ; la page affiche quand même la remise de la colonne Page" />
        <Compteur libelle="En cours" valeur={c.en_cours ?? 0} ton={c.en_cours ? "info" : undefined} />
        <Compteur libelle="En retrait" valeur={c.en_retrait} onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "retrait" ? "" : "retrait" }))} actif={filtre.etat === "retrait"} />
        <Compteur libelle="En erreur" valeur={c.en_erreur} ton={c.en_erreur ? "danger" : undefined} />
        {c.simulees > 0 && <Compteur libelle="Simulés" valeur={c.simulees} onClick={() => setFiltre(f => ({ ...f, etat: f.etat === "simule" ? "" : "simule" }))} actif={filtre.etat === "simule"} />}
        <Compteur libelle="Perte prévue (stock court facturé, faits du jour)" valeur={fmt(c.perte_prevue)} detail={`valeur au coût : ${fmt(c.valeur_court_cout)}`} ton={c.perte_prevue > 0 ? "danger" : undefined} />
      </div>

      {/* ── Filtres et application en lot ── */}
      <div style={{ ...ui.card, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filtre.texte} onChange={e => setFiltre(f => ({ ...f, texte: e.target.value }))} placeholder="Nom ou CIP…" aria-label="Filtrer par nom ou CIP" style={{ ...ui.input, width: 200, minHeight: 34, padding: "6px 10px", fontSize: 13 }} />
        <select value={filtre.etat} onChange={e => setFiltre(f => ({ ...f, etat: e.target.value }))} aria-label="Filtrer par état" style={{ ...ui.input, width: 200, minHeight: 34, padding: "6px 10px", fontSize: 13 }}>
          <option value="">Tous les états</option>
          {Object.entries(ETATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {[["long", "Lot long"], ["sousCout", "Sous le coût"], ["exclu", "Exclu"], ["lgo", "Vendu par LGO"]].map(([k, l]) => (
          <label key={k} style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={filtre[k]} onChange={e => setFiltre(f => ({ ...f, [k]: e.target.checked }))} />{l}</label>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.inkMute }}>{produits.length} produit{produits.length > 1 ? "s" : ""} affiché{produits.length > 1 ? "s" : ""}</span>
        {selection.size > 0 && <LotBar n={selection.size} max={R0.plafond_produits_par_lot} occupe={!!occupe} mode={R0.mode} creation={v.creation}
          onAppliquer={(r) => ouvrirApercu([...selection], r, { lot: true })} onRetirer={() => ouvrirRetrait([...selection], `${selection.size} produits`)} onVider={() => setSelection(new Set())} />}
      </div>

      {/* ── Tableau par produit ── */}
      <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: R.m, overflowX: "auto", boxShadow: T.shadow1 }}>
        <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: T.ink }}>
          <thead><tr>
            <th style={th}><input type="checkbox" aria-label="Tout sélectionner (produits sans décision)" title="Produits sans décision ouverte seulement (une modification se fait produit par produit)"
              checked={selectionnables.length > 0 && selectionnables.every(p => selection.has(p.cip))}
              onChange={e => setSelection(e.target.checked ? new Set(selectionnables.slice(0, R0.plafond_produits_par_lot).map(p => p.cip)) : new Set())} /></th>
            {[["Produit (CIP)"], ["Lot court · fin de page"], ["Court / long / autre"], ["Prix de base · habituel L5 · coût"], ["Page : remise affichée", "Remise de la page des pharmacies (−50 % par défaut, −20 % dès 500 €) et ce qu'Odoo facture"],
              ["Règle Odoo %", surPrixHabituel ? "sur le prix habituel liste 5" : "sur le prix de base, comme la facture"], ["Prix péremption L5 · économie · marge"], ["Ventes 30 j (LGO)"], ["État", "État de la règle Odoo (la page affiche la colonne Page)"], ["Action"]].map(([h, titre]) =>
              <th key={h} title={titre} style={{ ...th, textAlign: h.startsWith("Prix") ? "right" : "left", whiteSpace: "normal", ...(h === "Action" ? colleDroite : {}) }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {produits.map(p => <Ligne key={p.cip} p={p} R0={R0} v={v} occupe={!!occupe} selection={selection} setSelection={setSelection} remise={remises[p.cip]}
              setRemise={(x) => setRemises(m => ({ ...m, [p.cip]: x }))} onApercu={(r) => ouvrirApercu([p.cip], r)} onRetirer={() => ouvrirRetrait([p.cip], p.nom, p.decision?.statut === "retrait_demande")}
              onReessayer={() => reessayer(p.cip)} onJournal={() => voirJournal(p.cip)} journal={journal?.cip === p.cip ? journal.lignes : null} onRemiseAffichee={(r) => remiseAffichee(p, r)} />)}
            {!produits.length && <tr><td colSpan={11} style={{ padding: 24, textAlign: "center", color: T.inkMute }}>Aucun produit pour ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>
      {journal && journal.cip === null && <Journal lignes={journal.lignes} titre="Journal complet (100 dernières lignes)" onFermer={() => setJournal(null)} />}

      {/* ── Réglages et contrôle des écarts ── */}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button className="ex-btn-ligne" onClick={() => setPanneau(panneau === "reglages" ? null : "reglages")} style={btnL}><Icone nom="regle" taille={14} />Réglages {panneau === "reglages" ? "▴" : "▾"}</button>
        <button className="ex-btn-ligne" onClick={() => setPanneau(panneau === "ecarts" ? null : "ecarts")} style={btnL}><Icone nom="document" taille={14} />Contrôle des écarts (rectification) {panneau === "ecarts" ? "▴" : "▾"}</button>
      </div>
      {panneau === "reglages" && <Reglages key={R0.updated_at || "r"} R0={R0} occupe={!!occupe} onEnregistrer={(valeurs) => action("Réglages", () => poste({ action: "reglages", valeurs }))} />}
      {panneau === "ecarts" && <Ecarts appel={appel} poste={poste} onStatut={() => chargerResume(true)} />}

      {apercu && <Apercu a={apercu} setA={setApercu} R0={R0} v={v} occupe={!!occupe} onAppliquer={appliquer}
        onForcer={(cip, n) => ouvrirApercu(apercu.cips, apercu.remise, { force: { ...apercu.force, [cip]: n }, sousCout: apercu.sousCout, lot: apercu.lot })} />}
      {retrait && (
        <Fenetre titre={`Retirer la remise : ${retrait.nom}`} onFermer={() => setRetrait(null)}>
          <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 10px" }}>La règle Odoo est retirée : la page revient aussitôt à la remise affichée (colonne Page : −50 % par défaut,
            −20 % dès 500 €), qu'Odoo ne facture pas (écarts à rectifier). La règle est supprimée dans Odoo au premier passage après {R0.delai_retrait_min} min (passage
            toutes les heures à h:25), ou plus tard si des commandes en cours d'import contiennent ce produit.</p>
          {!v.retrait && <VerrousFermes />}
          <LectureRetrait lecture={retrait.lecture} />
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontWeight: 600 }}><input type="checkbox" checked={!!retrait.aussiPage} onChange={e => setRetrait(x => ({ ...x, aussiPage: e.target.checked }))} />
            <span>Revenir aussi au prix habituel sur la page (remise affichée à 0 %{retrait.cips.length > 1 ? `, ${retrait.cips.length} produits` : ""}) : sinon la page affiche la remise par défaut, non facturée.</span></label>
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}><input type="checkbox" checked={!!retrait.toutDeSuite} onChange={e => setRetrait(x => ({ ...x, toutDeSuite: e.target.checked }))} />
            <span>Tout de suite : supprimer dans Odoo sans attendre. Les commandes du site ci-dessus, pas encore importées, seront facturées au prix habituel (l'équipe reçoit la liste).</span></label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button onClick={() => setRetrait(null)} style={ui.btn("ligne", "s")}>Annuler</button>
            <button onClick={retirer} style={ui.btn("danger", "s")}>Retirer</button>
          </div>
        </Fenetre>
      )}
      {toutRetirer != null && (
        <Fenetre titre="Retirer toutes les règles du site" onFermer={() => setToutRetirer(null)} garder={!!toutRetirer.saisie}>
          {!toutRetirer.lecture ? <p style={{ fontSize: 13, color: T.inkMute }}>Lecture des décisions et des commandes en cours…</p> : toutRetirer.lecture.erreur ? <div style={encart("danger")}><Icone nom="alerte" taille={14} /><span>{toutRetirer.lecture.erreur}</span></div> : (
            <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 10px" }}><strong>{toutRetirer.lecture.decisions}</strong> décision(s) ouverte(s) ({Object.entries(toutRetirer.lecture.par_statut || {}).map(([k, n]) => `${n} ${STATUTS_DECISION[k] || k}`).join(", ") || "aucune"}),
              <strong> {toutRetirer.lecture.regles}</strong> règle(s) dans Odoo sur {toutRetirer.lecture.produits_avec_regles} produit(s){toutRetirer.lecture.reservees ? ` (+ ${toutRetirer.lecture.reservees} réservée(s) sans identifiant)` : ""}.
              Dès la confirmation, la page revient à la remise affichée de chaque produit (colonne Page : −50 % par défaut, −20 % dès 500 €), qu'Odoo ne facture pas (écarts à rectifier) ; puis les règles posées par le site (et seulement elles) sont supprimées dans Odoo, sans délai ni attente des commandes, produit par produit (si cette page se ferme, le filet termine dans le quart d'heure).</p>
          )}
          {!v.retrait && <VerrousFermes />}
          <LectureRetrait lecture={toutRetirer.lecture} />
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontWeight: 600 }}><input type="checkbox" checked={!!toutRetirer.aussiPage} onChange={e => setToutRetirer(x => ({ ...x, aussiPage: e.target.checked }))} />
            <span>Mettre aussi à 0 % la remise affichée de ces produits (prix habituel sur la page) ; les autres produits de la page gardent leur remise affichée.</span></label>
          <label style={{ ...ui.label, marginTop: 10 }}>Saisir RETIRER pour confirmer</label>
          <input value={toutRetirer.saisie} onChange={e => setToutRetirer(x => ({ ...x, saisie: e.target.value }))} aria-label="Confirmation RETIRER" style={{ ...ui.input, width: 220 }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button onClick={() => setToutRetirer(null)} style={ui.btn("ligne", "s")}>Annuler</button>
            <button disabled={toutRetirer.saisie !== "RETIRER"} onClick={confirmerToutRetirer} style={{ ...ui.btn("danger", "s"), opacity: toutRetirer.saisie === "RETIRER" ? 1 : 0.5 }}>Tout retirer</button>
          </div>
        </Fenetre>
      )}
    </div>
  );
}
const ACTEURS = { filet: "filet horaire", nuit: "nuit", automatique: "remise automatique" };
const STATUTS_PASSAGE = { fini: "fini", en_cours: "en cours", erreur: "en échec", verrou: "rien fait (autre passage en cours)" };
const STATUTS_DECISION = { voulue: "en cours", partielle: "partielle(s)", facturee: "facturée(s)", retrait_demande: "en retrait", erreur: "en erreur", modifiee_odoo: "modifiée(s) dans Odoo", simulee: "simulée(s)" };
const ETATS_COMMANDE = { a_envoyer: "à envoyer", prise: "en cours d'envoi", incertaine: "envoi à vérifier", import_en_attente: "envoyée, pas encore importée", commande_non_envoyee: "pas encore envoyée" };

function VerrousFermes() {
  return <div role="alert" style={{ ...encart("danger"), marginBottom: 10 }}><Icone nom="alerte" taille={16} /><span><strong>Verrous fermés</strong> (mode Simulation ou variable Netlify absente) : la page revient
    à la remise affichée, mais les règles RESTENT dans Odoo et continuent d'être facturées. Rouvrir la variable (puis redéployer) avant de retirer, ou supprimer les règles à la main dans Odoo.</span></div>;
}
function LectureRetrait({ lecture }) {
  if (!lecture || lecture.erreur) return null;
  if (lecture.commandes_erreur) return <div style={{ ...encart("warn"), marginBottom: 6 }}><Icone nom="alerte" taille={14} /><span>Commandes en cours illisibles ({lecture.commandes_erreur}) : sans « Tout de suite », la suppression attend.</span></div>;
  if (!lecture.commandes?.length) return <div style={{ fontSize: 12, color: T.inkMute }}>Aucune commande du site en cours d'import avec ces produits.</div>;
  return (
    <div style={{ fontSize: 12, color: T.inkSoft }}><strong>Commandes du site en cours d'import avec ces produits</strong> ({lecture.commandes.length}) :
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{lecture.commandes.slice(0, 12).map(cm => <li key={cm.ref}>{cm.ref}{cm.pharmacie ? ` · ${cm.pharmacie}` : ""} · {ETATS_COMMANDE[cm.etat] || cm.etat} · CIP {cm.cips.join(", ")}</li>)}</ul></div>
  );
}

// Un produit de l'aperçu est-il applicable (raisons restantes levées par les cases cochées) ?
function applicable(p, a) {
  if (!p.apercu_id || !["creer", "modifier"].includes(p.type || "creer")) return false;
  if (p.eligibilite?.ok) return true;
  return (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout" && a.sousCout[p.cip]);
}
function texteDroits(d) {
  const ko = [...Object.entries(d.modele || {}).filter(([, x]) => x !== true).map(([k]) => `règles de prix : ${k}`), ...Object.entries(d.regle || {}).filter(([, x]) => x !== true).map(([k, x]) => `${k} (${x})`)];
  if (!d.compte?.societe_elixir) ko.push("société Elixir non autorisée pour le compte du site");
  return ko.join(", ") || "inconnu";
}

// ── Ligne du tableau ──
function Ligne({ p, R0, v, occupe, selection, setSelection, remise, setRemise, onApercu, onRetirer, onReessayer, onJournal, journal, onRemiseAffichee }) {
  const f = p.faits, d = p.decision;
  // remise de la règle Odoo : celle de la décision ; sans décision, préremplie avec la remise affichée par la page (« Appliquer
  // dans Odoo » fait alors facturer par Odoo le prix que la page annonce)
  const saisie = remise ?? (d ? String(d.modification?.baisse ? d.modification.remise : d.remise_pct) : p.affichage?.remise >= 1 && p.affichage.source !== "odoo" ? String(remiseRegleDepuisPage(p, R0)) : "");
  const r = remiseSaisie(saisie);
  const habituel = habituelDe(p);
  const base = d?.apercu?.base || R0.base_remise;
  // remise appliquée : prix attendu de la décision (baisse en attente : celui de la nouvelle remise) ; saisie : prix visé
  const attendu = d?.modification?.baisse ? d.modification.prix_attendu : d?.prix_attendu;
  const prixPer = d && remise == null && attendu ? Number(attendu["5"] ?? attendu[5]) : r ? prixVise(f, r, base, habituel) : null;
  const cout = Number(f?.cout) > 0 ? Number(f.cout) : null;
  const marge = prixPer && cout ? ((prixPer - cout) / prixPer) * 100 : null;
  const eco = economie(prixPer, habituel);
  // « sans effet » : seulement pour une saisie pas encore appliquée (une remise facturée a déjà été contrôlée)
  const sansEffet = remise != null && prixPer != null && habituel > 0 && prixPer > r2(habituel * (1 - R0.seuil_annonce_pct / 100)) + 0.0001;
  const [libelle, ton] = ETATS[p.etat] || [p.etat, "neutral"];
  const modifiable = d && ["facturee", "partielle", "voulue"].includes(d.statut);
  const coche = selection.has(p.cip);
  const t = tone(ton);
  const suspendu = v.mode === "creations_suspendues";
  return (
    <>
      <tr className="ex-tr" style={{ borderBottom: `1px solid ${T.lineSoft}`, background: coche ? T.surface2 : undefined }}>
        <td style={td}><input type="checkbox" aria-label={`Sélectionner ${p.nom}`} checked={coche} onChange={e => setSelection(s => { const n = new Set(s); if (e.target.checked) n.add(p.cip); else n.delete(p.cip); return n; })} /></td>
        <td style={{ ...td, maxWidth: 220, minWidth: 160 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{p.nom}</div><div style={{ fontFamily: T.mono, color: T.inkMute, fontSize: 11 }}>{p.cip}</div>
          {(f?.exclusions || []).length > 0 && <div style={{ color: T.inkMute, fontSize: 11 }}>Non remisable : {f.exclusions.join(", ").replace(/_/g, " ")}</div>}</td>
        <td style={td}>{f?.court_fin ? dateFr(f.court_fin) : dateFr(p.catalogue?.earliest_expiry)}<div style={{ color: T.inkMute, fontSize: 11 }}>{d?.date_fin_regle ? `règle jusqu'au ${dateFr(d.date_fin_regle)}` : f?.court_fin ? `page jusqu'au ${dateFr(finPage(f.court_fin))}` : ""}</div></td>
        <td style={td}>{f ? <span style={{ whiteSpace: "nowrap" }}>{f.court_qte} / <span style={{ color: f.long_qte ? T.warn : undefined, fontWeight: f.long_qte ? 700 : 400 }}>{f.long_qte}</span> / {f.autre_qte}</span> : "–"}
          <div style={{ color: T.inkMute, fontSize: 11 }}>{f?.lu_at ? `lu ${heureFr(f.lu_at)}` : "faits à lire"}</div></td>
        <td style={tdD}><div>{fmt(f?.list_price ?? p.catalogue?.list_price)}</div><div style={{ fontWeight: 700 }} title={d ? "prix habituel figé à la décision" : undefined}>{fmt(habituel)}</div>
          <div style={{ color: T.inkMute }}>{cout != null ? `coût ${fmt(cout)}` : <span title="standard_price non renseigné dans Odoo">coût ?</span>}</div></td>
        <td style={{ ...td, minWidth: 140 }}><RemiseAffichee p={p} occupe={occupe} onEnregistrer={onRemiseAffichee} /></td>
        <td style={td}><input value={saisie} onChange={e => setRemise(e.target.value)} inputMode="numeric" aria-label={`Remise de la règle Odoo ${p.nom}`} placeholder="%"
          style={{ ...ui.input, width: 56, minHeight: 28, padding: "3px 6px", fontSize: 12, borderColor: saisie && r == null ? T.danger : undefined }} /></td>
        <td style={tdD}><div style={{ fontWeight: 700 }}>{fmt(prixPer)}</div>
          {eco != null && <div style={{ color: sansEffet ? T.inkMute : T.inkSoft, fontSize: 11 }}>économie pour la pharmacie : {eco > 0 ? `−${pct(eco)}` : "aucune"} sur l'habituel</div>}
          {sansEffet && <div style={{ color: T.inkMute, fontSize: 11 }}>sans effet (seuil : {pct(R0.seuil_annonce_pct)} d'économie)</div>}
          <div style={{ color: marge != null && marge < 0 ? T.danger : T.inkMute, fontWeight: marge != null && marge < 0 ? 700 : 400 }}>{marge == null ? "" : `marge ${pct(marge)}`}</div></td>
        <td style={td}>{f?.ventes_30j ? `${(f.ventes_30j.lgo || 0) + (f.ventes_30j.site || 0) + (f.ventes_30j.autre || 0)} (${f.ventes_30j.lgo || 0})` : "–"}</td>
        <td style={td}><span style={{ ...ui.badge(ton), background: ton === "warn" && p.etat === "a_remiser" ? T.actingBg : t.bg }}>{libelle}</span>
          {d && <div style={{ color: T.inkMute, fontSize: 11, marginTop: 3, maxWidth: 200 }}>{texteDecision(d, R0)}</div>}</td>
        <td style={{ ...td, minWidth: 120, ...colleDroite, background: coche ? T.surface2 : T.surface }}>
          <div style={{ display: "flex", gap: 4, flexDirection: "column", alignItems: "flex-start" }}>
            {(!d || modifiable) && !(f?.exclusions || []).length && r > 0 && (!d || r !== Number(d.modification?.baisse ? d.modification.remise : d.remise_pct)) && (
              suspendu ? <button disabled title="Mode « Créations suspendues » : ni création ni hausse de remise" style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11, opacity: 0.6 }}>Créations suspendues</button>
                : <button disabled={occupe} onClick={() => onApercu(r)} className="ex-btn-petrole" style={{ ...ui.btn("primaire", "s"), height: 28, fontSize: 11, background: undefined }}>
                  {d ? (v.creation ? "Modifier (aperçu)" : "Simuler la modification") : v.creation ? "Appliquer dans Odoo" : "Simuler"}</button>)}
            {d && ["partielle", "erreur", "modifiee_odoo"].includes(d.statut) && v.creation && <button disabled={occupe} onClick={onReessayer} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11 }}>Réessayer</button>}
            {d && d.statut !== "retiree" && <button disabled={occupe} onClick={onRetirer} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11, color: T.danger }}>{d.statut === "retrait_demande" ? "Supprimer tout de suite" : "Retirer"}</button>}
            <button onClick={onJournal} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>{journal ? "Fermer" : "Journal"}</button>
          </div>
        </td>
      </tr>
      {journal && <tr><td colSpan={11} style={{ padding: 0 }}><Journal lignes={journal} titre={`Journal · ${p.nom}`} decision={d} /></td></tr>}
    </>
  );
}
// Page : remise affichée (expiry_discounts ; vide = défaut 50 %, 20 % dès 500 € ; 0 = aucune) et ce qu'Odoo facture
function RemiseAffichee({ p, occupe, onEnregistrer }) {
  const [saisie, setSaisie] = useState(null);   // null : pas de saisie en cours
  const a = p.affichage;
  if (!a || p.masque) return <span style={{ color: T.inkMute, fontSize: 11 }}>{p.masque ? "hors de la page (aucune boîte courte)" : "hors de la page"}</span>;
  const val = saisie ?? (p.remise_admin != null ? String(p.remise_admin) : "");
  const r = val.trim() === "" ? null : remiseSaisie(val);
  const change = saisie != null && (val.trim() === "" ? p.remise_admin != null : r != null && r !== p.remise_admin);
  return (
    <div className="ex-remise-affichee" style={{ display: "grid", gap: 4 }}>
      <div><span style={{ ...ui.badge(a.remise >= 1 ? "danger" : "neutral"), fontSize: 11 }}>{libelleOffre(a)}</span></div>
      {a.pn != null && <div style={{ fontSize: 11, color: T.inkSoft }}>{a.remise >= 1 && a.base > a.pn ? <><s>{fmt(a.base)}</s> → </> : null}<strong>{fmt(a.pn)}</strong> sur la page</div>}
      <div style={{ fontSize: 11, color: a.facture_odoo ? T.ok : a.remise >= 1 ? T.warn : T.inkMute, fontWeight: 600 }}>{a.facture_odoo ? "facturée par Odoo : aucun écart" : a.remise >= 1 ? "non facturée par Odoo : écarts à rectifier" : "prix habituel"}</div>
      {a.source !== "odoo" && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <input value={val} onChange={e => setSaisie(e.target.value)} inputMode="numeric" aria-label={`Remise affichée sur la page ${p.nom}`} placeholder={`défaut ${remiseDefaut(a.base)}`}
            style={{ ...ui.input, width: 74, minHeight: 26, padding: "2px 6px", fontSize: 12, borderColor: val.trim() && r == null ? T.danger : undefined }} />
          <span style={{ fontSize: 11 }}>%</span>
          {change && <button disabled={occupe} onClick={() => { onEnregistrer(r); setSaisie(null); }} style={{ ...ui.btn("primaire", "s"), height: 26, fontSize: 11 }}>Enregistrer</button>}
          {p.remise_admin != null && saisie == null && <button disabled={occupe} onClick={() => onEnregistrer(null)} title="Revenir à la remise par défaut" style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Défaut</button>}
        </div>
      )}
      {a.source !== "odoo" && <div style={{ fontSize: 11, color: T.inkMute }}>0 = aucune remise · vide = défaut (−50 %, −20 % dès 500 €)</div>}
    </div>
  );
}
const finPage = (courtFin) => { const d = new Date(`${courtFin}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };
export function texteDecision(d, R0) {
  const regles = d.regles || [];
  const actives = regles.filter(r => r.statut === "active"), verifiees = actives.filter(r => r.verifiee_at);
  if (d.simulee) return `${d.remise_pct} % · simulé : aucune règle dans Odoo, rien à supprimer`;
  if (d.statut === "retrait_demande") {
    const fin = Date.parse(d.cachee_at || "") + R0.delai_retrait_min * 60e3;
    return `${RAISONS[d.raison_fin] || d.raison_fin || ""} · caché sur le site ; suppression dans Odoo ${d.retrait_immediat ? "immédiate (en cours)" : `au premier passage après ${heureFr(new Date(fin).toISOString())} (ou une fois les commandes importées)`}`;
  }
  if (d.statut === "voulue" && d.modification?.baisse) {
    const fin = Date.parse(d.modification.demandee_at || "") + R0.delai_retrait_min * 60e3;
    return `baisse ${d.remise_pct} % → ${d.modification.remise} % : en attendant, la page affiche la remise de la colonne Page ; écrite dans Odoo au premier passage après ${heureFr(new Date(fin).toISOString())} (ou une fois les commandes importées)`;
  }
  return [`${d.remise_pct} %`, regles.length ? `${verifiees.length}/${R0.listes.length} règles vérifiées` : "", d.erreur || ""].filter(Boolean).join(" · ");
}

// ── Aperçu (un produit ou un lot) ──
function Apercu({ a, setA, R0, v, occupe, onAppliquer, onForcer }) {
  const d = a.donnees;
  const ok = d.produits.filter(p => applicable(p, a));
  const creations = ok.filter(p => p.type !== "modifier"), modifications = ok.filter(p => p.type === "modifier");
  const nbRegles = ok.length * R0.listes.length;
  const confirme = (!a.lot || ok.length <= 1 || Number(a.confirmation) === nbRegles) && (!a.lot || !modifications.length || a.modifs);
  const utiles = d.produits.filter(p => ["creer", "modifier"].includes(p.type || "creer") && p.apercu_id);
  // prévus : pas écartés (au plus la case « sous le coût » à cocher)
  const prevus = utiles.filter(p => (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout"));
  const modifsPrevues = prevus.filter(p => p.type === "modifier");
  const enAttenteCase = prevus.filter(p => !applicable(p, a)).length;
  const sousCout = utiles.filter(p => p.pertes?.sous_cout && (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout"));
  const ecartes = d.produits.filter(p => !["creer", "modifier"].includes(p.type || "creer") || !(p.eligibilite?.ok || (p.eligibilite?.raisons || []).every(r => r.code === "sous_cout")));
  const perteCochee = r2(ok.reduce((s, p) => s + (p.pertes?.perte_totale || 0), 0));
  const pertePossible = r2(utiles.reduce((s, p) => s + (p.pertes?.perte_totale || 0), 0));
  const lgoCoche = r2(ok.reduce((s, p) => s + (p.pertes?.effet_lgo_mois || 0), 0));
  const seul = d.produits.length === 1 ? d.produits[0] : null;
  const verbe = !v.creation ? "Simuler"
    : seul ? (seul.type === "modifier" ? `Modifier les ${R0.listes.length} règles` : `Créer les ${R0.listes.length} règles`)
    : [creations.length ? `créer ${creations.length * R0.listes.length} règles` : "", modifications.length ? `modifier ${modifications.length * R0.listes.length} règles` : ""].filter(Boolean).join(", ").replace(/^./, x => x.toUpperCase())
      || (enAttenteCase ? "Cocher « sous le coût » d'abord" : "Rien à faire");
  const titre = a.lot ? `Appliquer une remise de ${a.remise} % à ${a.cips.length} produits`
    : seul?.type === "modifier" ? `Modifier la remise : ${seul.nom} de −${seul.remise_actuelle} % à −${a.remise} %` : `Appliquer dans Odoo : ${seul?.nom || a.cips[0]} à −${a.remise} %`;
  return (
    <Fenetre titre={titre} onFermer={() => setA(null)} large garder={Object.values(a.sousCout || {}).some(Boolean) || Object.keys(a.force || {}).length > 0 || !!a.confirmation}>
      {!v.creation && <div style={{ ...encart("info"), marginBottom: 10 }}><Icone nom="horloge" taille={16} /><span>Mode « {MODES[R0.mode]} »{!v.variable ? ", variable Netlify absente" : ""} : le plan est calculé et journalisé, rien n'est écrit dans Odoo.</span></div>}
      {a.lot && (
        <div style={{ fontSize: 13, color: T.inkSoft, display: "grid", gap: 6, marginBottom: 12 }}>
          <div><strong>{prevus.length - modifsPrevues.length}</strong> création(s), <strong>{modifsPrevues.length}</strong> modification(s){modifsPrevues.length ? ` (${modifsPrevues.map(p => `${p.nom} ${p.remise_actuelle} % → ${a.remise} %`).join(", ")})` : ""} · <strong>{nbRegles}</strong> règle(s) à écrire ({R0.listes.length} par produit){enAttenteCase ? ` ; ${enAttenteCase} produit(s) attendent la case « sous le coût »` : ""} · effet sur les logiciels (produits cochés) : environ {fmt(lgoCoche)} de moins par mois</div>
          {sousCout.length > 0 && <div><strong>Sous le coût</strong> (cocher chaque produit) : perte des produits cochés {fmt(perteCochee)} (sur {fmt(pertePossible)} possibles)</div>}
          {ecartes.length > 0 && <div><strong>Écartés</strong> (aucun changement dans Odoo) : {ecartes.map(p => `${p.nom || p.cip} (${(p.eligibilite?.raisons || []).filter(r => r.code !== "sous_cout").map(r => r.texte).join(", ")})`).join(" ; ")}</div>}
        </div>
      )}
      {d.produits.map(p => {
        const estUtile = ["creer", "modifier"].includes(p.type || "creer") && p.apercu_id;
        const bloquants = (p.eligibilite?.raisons || []).filter(r => r.code !== "sous_cout");
        const ecarte = !estUtile || bloquants.length > 0;
        const attendCase = !ecarte && p.pertes?.sous_cout && !a.sousCout[p.cip];
        if (a.lot && ecarte) return null;   // écartés : listés dans l'en-tête du lot
        return (
          <div key={p.cip} style={{ borderTop: a.lot ? `1px solid ${T.line}` : "none", paddingTop: a.lot ? 10 : 0, marginTop: a.lot ? 10 : 0 }}>
            {a.lot && <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{p.nom} <span style={{ fontFamily: T.mono, color: T.inkMute, fontWeight: 400 }}>{p.cip}</span>{p.type === "modifier" ? ` · modification ${p.remise_actuelle} % → ${a.remise} %` : ""}</div>}
            {ecarte && (
              <div style={{ ...encart(bloquants.some(r => r.code === "lot_long") ? "warn" : "danger"), marginBottom: 6 }}><Icone nom="alerte" taille={14} />
                <span><strong>Écarté : aucun changement dans Odoo.</strong> {bloquants.map(r => r.texte).join(" ; ")}</span></div>
            )}
            {attendCase && <div style={{ ...encart("warn"), marginBottom: 6 }}><Icone nom="alerte" taille={14} /><span>Ne sera {p.type === "modifier" ? "modifié" : "créé"} qu'une fois la case « sous le coût » cochée.</span></div>}
            {!ecarte && p.listes && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 8 }}>
                <thead><tr>{["Liste", "Prix aujourd'hui", "Prix après", "Économie", "Changement dans Odoo"].map(h => <th key={h} style={{ ...th, padding: "6px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>{p.listes.map(l => (
                  <tr key={l.liste} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                    <td style={{ ...td, padding: "6px 8px" }}>{l.nom}</td>
                    <td style={{ ...tdD, padding: "6px 8px" }}>{fmt(l.prix_aujourdhui)}{p.type === "modifier" && l.prix_habituel != null && Math.abs(l.prix_habituel - (l.prix_aujourdhui ?? 0)) >= 0.005 ? <div style={{ color: T.inkMute, fontSize: 11 }}>habituel {fmt(l.prix_habituel)}</div> : null}</td>
                    <td style={{ ...tdD, padding: "6px 8px", fontWeight: 700 }}>{fmt(l.prix_apres)}</td>
                    <td style={{ ...tdD, padding: "6px 8px" }}>{l.economie_pct > 0 ? `−${pct(l.economie_pct)}` : "–"}</td>
                    <td style={{ ...td, padding: "6px 8px", color: T.inkSoft }}>{l.changement || "–"}{l.sans_effet && <div style={{ color: T.inkMute }}>sans effet sur cette liste : prix habituel déjà plus bas (la règle est quand même posée, pour un retrait simple)</div>}</td>
                  </tr>))}</tbody>
              </table>
            )}
            {!ecarte && p.facture && <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 6 }}><strong>La facture affichera</strong> : PU {fmt(p.facture.pu)} · Remise {pctBrut(p.facture.remise_pct)} %{surHabituel(d, p) ? ` (vous avez saisi ${a.remise} % du prix habituel : la facture montre la remise équivalente sur le prix de base)` : ""}</div>}
            {p.stock && !ecarte && (
              <div style={{ fontSize: 12, color: T.inkSoft, display: "grid", gap: 4 }}>
                <div><strong>Stock touché</strong> : {p.stock.court} boîte(s) courte(s) (lot au {dateFr(p.stock.court_fin)}){p.stock.long + p.stock.autre > 0 ? ` ; ${p.stock.long} boîte(s) à date longue${p.stock.long_debut ? ` (lot au ${dateFr(p.stock.long_debut)})` : ""}${p.stock.autre ? ` et ${p.stock.autre} sans date` : ""}` : ""} · faits lus à {heureFr(p.lu_at)}</div>
                {p.pertes && (
                  <div><strong>Marge et pertes</strong> : marge {p.pertes.marge_pct == null ? "inconnue (coût non renseigné)" : pct(p.pertes.marge_pct)} · coût {fmt(p.pertes.cout)}
                    {p.pertes.perte_boite > 0 ? ` · perte ${fmt(p.pertes.perte_boite)} par boîte, ${fmt(p.pertes.perte_totale)} sur ${p.pertes.qte} boîtes` : ""}
                    {p.pertes.destruction != null ? ` · repère destruction : ${fmt(p.pertes.destruction)}` : ""}
                    {p.pertes.remise_max_sans_perte != null ? ` · remise maximale sans perte : ${p.pertes.remise_max_sans_perte} %` : ""}</div>)}
                {p.pertes?.sous_cout && (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: T.danger, fontWeight: 600 }}>
                    <input type="checkbox" checked={!!a.sousCout[p.cip]} onChange={e => setA(x => ({ ...x, sousCout: { ...x.sousCout, [p.cip]: e.target.checked } }))} />
                    <span>{p.pertes.cout_inconnu ? "Coût non renseigné dans Odoo : je confirme ce prix sans connaître la perte" : `Je vends sous le coût : perte ${fmt(p.pertes.perte_boite)} par boîte, ${fmt(p.pertes.perte_totale)} sur les ${p.pertes.qte} boîtes`}</span></label>)}
                {p.pertes && <div><strong>Effet sur les logiciels</strong> : ce prix vaudra aussi pour les commandes passées par les logiciels des pharmacies : {p.pertes.ventes_lgo_30j} boîte(s) le mois dernier, environ {fmt(p.pertes.effet_lgo_mois)} de moins par mois.</div>}
                {p.fin_regle && <div><strong>Fin automatique</strong> au plus tard le {dateFr(p.fin_regle)}, quand le lot passe sous 30 jours.</div>}
              </div>
            )}
            {p.stock && (p.stock.long + p.stock.autre > 0) && bloquants.every(r => r.code === "lot_long") && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: T.inkSoft, marginTop: 4 }}><input type="checkbox" checked={a.force[p.cip] != null} disabled={occupe}
                onChange={e => onForcer(p.cip, e.target.checked ? p.stock.long + p.stock.autre : null)} />
                <span>Forcer : {[p.stock.long ? `ces ${p.stock.long} boîte(s) à date longue${p.stock.long_debut ? ` (lot au ${dateFr(p.stock.long_debut)})` : ""}` : "", p.stock.autre ? `${p.stock.autre} boîte(s) sans date` : ""].filter(Boolean).join(" et ")} seront aussi vendues à ce prix</span></label>)}
          </div>
        );
      })}
      {a.lot && modifsPrevues.length > 0 && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 12, color: T.warn, fontWeight: 600 }}>
          <input type="checkbox" checked={!!a.modifs} onChange={e => setA(x => ({ ...x, modifs: e.target.checked }))} />
          <span>Je modifie aussi la remise de {modifsPrevues.length} produit(s) déjà remisé(s) : {modifsPrevues.map(p => `${p.nom} ${p.remise_actuelle} % → ${a.remise} %`).join(", ")}</span></label>
      )}
      {a.lot && ok.length > 1 && (
        <div style={{ marginTop: 12 }}><label style={ui.label}>Confirmer en saisissant le nombre de règles ({nbRegles})</label>
          <input value={a.confirmation} onChange={e => setA(x => ({ ...x, confirmation: e.target.value }))} inputMode="numeric" aria-label="Nombre de règles" style={{ ...ui.input, width: 140 }} /></div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={() => setA(null)} style={ui.btn("ligne", "s")}>Annuler</button>
        <button disabled={!ok.length || !confirme || occupe} onClick={onAppliquer} className="ex-btn-petrole" style={{ ...ui.btn("primaire", "s"), background: undefined, opacity: ok.length && confirme ? 1 : 0.5 }}>{verbe}</button>
      </div>
    </Fenetre>
  );
}
const surHabituel = (d, p) => d.base_remise === "prix_liste5" && p.facture && Math.abs(Number(p.facture.remise_pct) - Number(p.remise)) > 0.001;

function LotBar({ n, max, occupe, mode, creation, onAppliquer, onRetirer, onVider }) {
  const [r, setR] = useState("");
  const remise = remiseSaisie(r);
  const suspendu = mode === "creations_suspendues";
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "4px 8px", borderRadius: R.s, background: T.surface2 }}>
      <strong style={{ fontSize: 12 }}>{n} sélectionné{n > 1 ? "s" : ""}{n > max ? ` (au plus ${max})` : ""}</strong>
      {suspendu ? <span style={{ fontSize: 12, color: T.inkMute }}>Créations suspendues</span> : <>
        <span style={{ fontSize: 12 }}>Appliquer une remise de</span>
        <input value={r} onChange={e => setR(e.target.value)} inputMode="numeric" aria-label="Remise de la sélection" style={{ ...ui.input, width: 52, minHeight: 28, padding: "3px 6px", fontSize: 12 }} />
        <span style={{ fontSize: 12 }}>%</span>
        <button disabled={occupe || !(remise > 0) || n > max} onClick={() => onAppliquer(remise)} style={{ ...ui.btn("primaire", "s"), height: 28, fontSize: 11 }}>{creation ? "Aperçu" : "Simuler (aperçu)"}</button>
      </>}
      <button disabled={occupe} onClick={onRetirer} style={{ ...ui.btn("ligne", "s"), height: 28, fontSize: 11, color: T.danger }}>Retirer</button>
      <button onClick={onVider} style={{ ...ui.btn("lien"), fontSize: 11, color: T.inkMute }}>Vider</button>
    </span>
  );
}

function Journal({ lignes, titre, decision, onFermer }) {
  const liste = decision?.regles?.find(r => r.liste)?.liste || 5;
  return (
    <div style={{ ...ui.panel, margin: 8, maxWidth: 1000, boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{titre}</strong>
        <span style={{ display: "flex", gap: 10 }}>
          <a href={`${ODOO_WEB}/web#model=product.pricelist&id=${liste}&view_type=form&cids=2`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.teal }}>Voir dans Odoo, société Elixir (Ventes → Configuration → Listes de prix)</a>
          {onFermer && <button onClick={onFermer} style={{ ...ui.btn("lien"), fontSize: 12, color: T.inkMute }}>Fermer</button>}
        </span>
      </div>
      {!lignes?.length ? <div style={{ fontSize: 12, color: T.inkMute }}>Aucune ligne.</div> : (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr>{["Quand", "Qui", "Mode", "Action", "Liste", "Règle", "Résultat", "Détail"].map(h => <th key={h} style={{ ...th, padding: "4px 6px", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{lignes.map(l => (
              <tr key={l.id} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                <td style={tdJ}>{heureFr(l.at)}</td><td style={tdJ}>{ACTEURS[l.acteur] || l.acteur}</td><td style={tdJ}>{MODES_JOURNAL[l.mode] || l.mode}</td><td style={tdJ}>{ACTIONS_JOURNAL[l.action] || l.action}</td>
                <td style={tdJ}>{l.pricelist_id ? `n° ${l.pricelist_id}` : ""}</td><td style={tdJ}>{l.odoo_item_id ?? ""}</td>
                <td style={{ ...tdJ, color: ["echec", "incertain"].includes(l.resultat) ? T.danger : l.resultat === "simule" || l.resultat === "ignore" ? T.inkMute : l.resultat === "reporte" || l.resultat === "en_cours" ? T.warn : T.ok, fontWeight: 700 }}>{RESULTATS_JOURNAL[l.resultat] || l.resultat}</td>
                <td style={{ ...tdJ, color: T.inkSoft, maxWidth: 380, wordBreak: "break-word" }}>{detailJournal(l)}
                  {(l.avant || l.apres) && <details style={{ marginTop: 2 }}><summary style={{ cursor: "pointer", color: T.inkMute }}>détail technique</summary>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 10, color: T.inkMute }}>{JSON.stringify({ avant: l.avant ?? undefined, apres: l.apres ?? undefined }, null, 1)}</pre></details>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Réglages (propositions de la conception, § 16.3 : modifiables sans code) ──
const CHAMPS = [
  ["listes", "Listes de prix couvertes (jamais la 4)", "texte"], ["base_remise", "Base de la remise", ["prix_base", "% du prix de base (comme la facture)"], ["prix_liste5", "% du prix habituel (liste 5) : la facture affichera une autre remise (ex. 15,53 % pour 10 %)"]],
  ["remise_auto_pct", "Remise automatique (vide : aucune, seulement les remises saisies)", "nombre"], ["remise_max_pct", "Remise maximale (%)", "nombre"],
  ["sous_cout", "Vente sous le coût", ["confirmation", "confirmation explicite par produit"], ["interdit", "interdite"]], ["perte_max_produit", "Perte maximale par produit (€, vide : aucune)", "nombre"],
  ["budget_perte_mensuel", "Budget mensuel de perte (€, vide : aucun)", "nombre"], ["lot_long_recu", "Lot long reçu pendant la remise", ["retrait", "retrait automatique et alerte"], ["maintien", "maintien jusqu'à décision, alerte"]],
  ["ventes_lgo_max", "Boîtes vendues par LGO sur 30 j au plus (vide : pas de limite)", "nombre"], ["delai_retrait_min", "Délai avant suppression d'une règle ou baisse d'une remise (min)", "nombre"],
  ["seuil_annonce_pct", "Seuil d'annonce (% d'économie sur le prix habituel)", "nombre"], ["plafond_produits_par_lot", "Produits par application en lot", "nombre"],
  ["plafond_produits_factures", "Produits remisés en même temps", "nombre"], ["plafond_regles_par_passage", "Règles complétées par passage automatique", "nombre"],
  ["disjoncteur_sortie_pct", "Disjoncteur : sorties pour cause de stock (%)", "nombre"], ["filet_dates_odoo", "Odoo respecte les dates (essai T1)", ["a_prouver", "à prouver"], ["oui", "oui"], ["non", "non"]],
];
function Reglages({ R0, occupe, onEnregistrer }) {
  const [v, setV] = useState(() => Object.fromEntries(CHAMPS.map(([k]) => [k, k === "listes" ? (R0.listes || []).join(", ") : R0[k] ?? ""])));
  const valeurs = () => Object.fromEntries(CHAMPS.map(([k, , type]) => {
    const x = v[k];
    if (k === "listes") return [k, String(x).split(/[\s,;]+/).filter(Boolean).map(Number)];
    if (type === "nombre") return [k, String(x).trim() === "" ? null : Number(String(x).replace(",", "."))];
    return [k, x];
  }));
  return (
    <div style={{ ...ui.card, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10 }}>Valeurs proposées en attendant vos décisions (questions ouvertes de la conception). Chaque changement est journalisé ; une valeur hors limites est ramenée dans les bornes et signalée.
        {R0.updated_at ? ` Dernière modification : ${heureFr(R0.updated_at)}${R0.updated_by ? ` par ${R0.updated_by}` : ""}.` : ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {CHAMPS.map(([k, l, type, ...options]) => (
          <label key={k} style={{ fontSize: 12 }}><span style={ui.label}>{l}</span>
            {Array.isArray(type) ? (
              <select value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} style={{ ...ui.input, minHeight: 34, fontSize: 13, padding: "6px 10px" }}>
                {[type, ...options].map(([val, txt]) => <option key={val} value={val}>{txt}</option>)}</select>
            ) : <input value={v[k] ?? ""} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} style={{ ...ui.input, minHeight: 34, fontSize: 13, padding: "6px 10px" }} />}
          </label>
        ))}
      </div>
      <button disabled={occupe} onClick={() => onEnregistrer(valeurs())} style={{ ...ui.btn("primaire", "s"), marginTop: 12 }}>Enregistrer les réglages</button>
    </div>
  );
}

// ── Contrôle des écarts (rectification) : lignes du site prises au prix de la page, facturées plus cher par Odoo ──
// Lecture seule d'Odoo (peremption?action=ecarts, par pages de commandes). Le serveur regroupe par commande Odoo et produit
// (ligne additionnée, scindée ou corrigée à la main), lit les factures et les avoirs, recalcule l'offre de la page du jour
// (« à vérifier » sinon : hors des totaux) et renvoie à part les lignes « Pér. » non retrouvées dans Odoo. Statut de chaque
// ligne (« à rectifier » par défaut, « rectifié » avec une référence libre — obligatoire pour une ligne facturée : n° d'avoir),
// qui et quand : peremption_ecarts, montants recalculés par le serveur. Totaux par pharmacie (CIP) et en tout, période, CSV.
// Lignes « probables » de l'ancienne page (avant le 20/10/2026, sans mention) et autres écarts : sur demande, totaux à part.
function Ecarts({ appel, poste, onStatut }) {
  const [du, setDu] = useState(DEBUT_REGLE_PANIER);
  const [au, setAu] = useState("");
  const [avec, setAvec] = useState({ probable: false, autre: false });
  const [statut, setStatut] = useState("a_rectifier");
  const [res, setRes] = useState(null);
  const [cours, setCours] = useState(null);
  const [saisie, setSaisie] = useState(null);   // { cles, libelle, reference, obligatoire } : marquage « rectifié » en cours
  const [envoi, setEnvoi] = useState(null);
  const lancer = useCallback(async () => {
    const lignes = [], nonRetrouvees = []; let offset = 0, commandes = 0, garde = 0, suivi = "ok";
    const types = ["peremption", ...(avec.probable ? ["probable"] : []), ...(avec.autre ? ["autre"] : [])].join(",");
    setRes(null); setSaisie(null);
    try {
      while (offset != null && garde++ < 300) {
        setCours(`${commandes} commandes relues…`);
        const r = await appel(`${API}?action=ecarts&depuis=${du}${au ? `&jusqua=${au}` : ""}&types=${types}&offset=${offset}`);
        if (r.erreur) throw new Error(r.erreur);
        lignes.push(...r.lignes); nonRetrouvees.push(...(r.non_retrouvees || [])); commandes += r.commandes; offset = r.suivant; suivi = r.suivi || suivi;
      }
      setRes({ lignes, nonRetrouvees, commandes, suivi });
    } catch (e) { setRes({ erreur: e.message, lignes, nonRetrouvees, commandes, suivi }); }
    finally { setCours(null); }
  }, [appel, du, au, avec]);
  useEffect(() => { lancer(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const marquer = async (cles, st, reference = null) => {
    const lignes = (res?.lignes || []).filter(l => cles.includes(l.cle));
    if (!lignes.length) return;
    setEnvoi(`${st === "rectifie" ? "Marquage" : "Remise à rectifier"} : ${lignes.length} ligne(s)…`);
    try {
      // le serveur recalcule chaque ligne (commandes et Odoo relus) : montants enregistrés les siens
      const r = await poste({ action: "ecart_statut", statut: st, reference, lignes: lignes.map(l => ({ cle: l.cle })) });
      setRes(x => ({ ...x, lignes: x.lignes.map(l => (!cles.includes(l.cle) ? l : st === "rectifie"
        ? { ...l, statut: "rectifie", reference: r.reference, par: r.par, le: r.le, ecart_rectifie: r.montants?.[l.cle] ?? l.ecart, complement: 0, reference_precedente: null }
        : { ...l, statut: "a_rectifier", reference_precedente: l.reference || l.reference_precedente || null, reference: null, par: r.par, le: r.le, complement: 0 })) }));
      setSaisie(null); setEnvoi(null); onStatut?.();
    } catch (e) { setEnvoi(`Échec : ${e.message}`); }
  };
  const tot = useMemo(() => totauxEcarts(res?.lignes), [res]);
  const vues = (res?.lignes || []).filter(l => statut === "tous" || (statut === "a_verifier" ? l.type === "peremption" && l.coherent === false
    : statut === "a_rectifier" ? (l.statut || "a_rectifier") === "a_rectifier" || l.complement > 0 : (l.statut || "a_rectifier") === statut));
  const exporter = () => {
    const blob = new Blob(["﻿" + csvEcarts(res.lignes)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ecarts-peremption-${du}${au ? `-au-${au}` : ""}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const ouvrirSaisie = (cles, libelle) => {
    const ls = (res?.lignes || []).filter(l => cles.includes(l.cle));
    const avoir = ls.find(l => (l.avoirs || []).length)?.avoirs?.[0]?.numero || "";
    setSaisie({ cles, libelle, reference: avoir, obligatoire: ls.some(l => actionEcart(l) === "avoir") });
  };
  const lienOdoo = (l) => (l.odoo_id ? <a href={`${ODOO_WEB}/web#model=sale.order&id=${l.odoo_id}&view_type=form&cids=2`} target="_blank" rel="noreferrer" style={{ color: T.teal }}>{l.odoo}</a> : l.odoo);
  return (
    <div className="ex-ecarts" style={{ ...ui.card, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10 }}>Lignes des commandes du site prises au prix de la page Péremption courte (« Pér. », remise affichée)
        et facturées plus cher par Odoo, qui facture le tarif de la liste du client tant que la ligne n'est pas corrigée à la main. Le contrôle regroupe par commande
        Odoo et produit (lignes additionnées par le connecteur, scindées ou corrigées à la main) et lit les factures et les avoirs. Écart = facturé − (boîtes « Pér. » ×
        prix de la page), les autres lignes du même produit servies d'abord à leur prix. « À facturer » : corriger la commande dans Odoo, la ligne disparaît au contrôle
        suivant ; « facturée » : faire un avoir, puis « Marquer rectifié » avec son numéro. « À vérifier » (hors des totaux) : offre ou page non prouvées ce jour-là, ou
        moins de boîtes servies que commandées.</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Du <input type="date" value={du} onChange={e => setDu(e.target.value)} aria-label="Du" style={{ ...ui.input, width: 150, minHeight: 32, padding: "4px 8px", display: "inline-block" }} /></label>
        <label style={{ fontSize: 12 }}>au <input type="date" value={au} onChange={e => setAu(e.target.value)} aria-label="Au" style={{ ...ui.input, width: 150, minHeight: 32, padding: "4px 8px", display: "inline-block" }} /></label>
        <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={avec.probable} onChange={e => setAvec(x => ({ ...x, probable: e.target.checked }))} />ancienne page (probables)</label>
        <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={avec.autre} onChange={e => setAvec(x => ({ ...x, autre: e.target.checked }))} />autres écarts</label>
        <button disabled={!!cours} onClick={lancer} style={ui.btn("primaire", "s")}>Lancer le contrôle</button>
        {res?.lignes?.length > 0 && <button onClick={exporter} style={ui.btn("ligne", "s")}>Exporter (CSV)</button>}
        {cours && <span style={{ fontSize: 12, color: T.inkMute }}>{cours}</span>}
      </div>
      {res && (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {res.erreur && <div style={encart("danger")}><Icone nom="alerte" taille={14} /><span>{res.erreur}</span></div>}
          {res.suivi === "non_installe" && <div style={encart("warn")}><Icone nom="alerte" taille={14} /><span>Suivi des rectifications non installé : exécuter <code>sql/peremption-ecarts.sql</code> dans Supabase. Les écarts restent lisibles.</span></div>}
          <div className="ex-ecarts-totaux" style={{ fontSize: 13 }}><strong>{fmt(tot.a_rectifier.montant)}</strong> à rectifier pour <strong>{tot.nbPharmaciesARectifier}</strong> pharmacie{tot.nbPharmaciesARectifier > 1 ? "s" : ""} ({tot.a_rectifier.lignes} ligne{tot.a_rectifier.lignes > 1 ? "s" : ""})
            · rectifié : {fmt(tot.rectifie.montant)} ({tot.rectifie.lignes} ligne{tot.rectifie.lignes > 1 ? "s" : ""}) · {res.commandes} commandes relues du {dateFr(du)}{au ? ` au ${dateFr(au)}` : " à aujourd'hui"}
            {tot.a_verifier.lignes > 0 && <> · <span style={{ color: T.danger, fontWeight: 700 }}>à vérifier (hors total) : {fmt(tot.a_verifier.montant)} ({tot.a_verifier.lignes})</span></>}
            {tot.autres.lignes > 0 && <> · autres types (hors total) : {fmt(tot.autres.montant)} ({tot.autres.lignes})</>}
            {res.nonRetrouvees?.length > 0 && <> · <span style={{ color: T.warn, fontWeight: 700 }}>{res.nonRetrouvees.length} ligne{res.nonRetrouvees.length > 1 ? "s" : ""} « Pér. » non retrouvée{res.nonRetrouvees.length > 1 ? "s" : ""} dans Odoo</span></>}</div>
          {envoi && <div role="status" style={encart(/^Échec/.test(envoi) ? "danger" : "info")}><Icone nom="horloge" taille={14} /><span>{envoi}</span></div>}
          {saisie && (
            <div role="dialog" aria-label="Marquer rectifié" style={{ ...encart("info"), flexWrap: "wrap", alignItems: "center" }}>
              <span>Marquer rectifié : <strong>{saisie.libelle}</strong> · référence {saisie.obligatoire ? "(obligatoire : ligne facturée, n° d'avoir)" : "(n° d'avoir, correction de la commande Odoo…)"}</span>
              <input value={saisie.reference} autoFocus onChange={e => setSaisie(x => ({ ...x, reference: e.target.value }))} aria-label="Référence de la rectification" maxLength={120}
                style={{ ...ui.input, width: 220, minHeight: 30, padding: "4px 8px", fontSize: 12 }} />
              <button disabled={saisie.obligatoire && !saisie.reference.trim()} onClick={() => marquer(saisie.cles, "rectifie", saisie.reference)}
                style={{ ...ui.btn("primaire", "s"), height: 30, fontSize: 12, opacity: saisie.obligatoire && !saisie.reference.trim() ? 0.5 : 1 }}>Valider</button>
              <button onClick={() => setSaisie(null)} style={{ ...ui.btn("lien"), fontSize: 12, color: T.inkMute }}>Fermer</button>
            </div>
          )}
          {tot.pharmacies.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="ex-ecarts-pharmacies" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>{["Pharmacie (CIP)", "À rectifier", "Lignes", "Rectifié", ""].map(h => <th key={h} style={{ ...th, padding: "4px 6px", fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>{tot.pharmacies.map(ph => (
                  <tr key={ph.cle} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                    <td style={tdJ}>{ph.pharmacie}{ph.pharmacy_cip ? <span style={{ color: T.inkMute, fontFamily: T.mono }}> · {ph.pharmacy_cip}</span> : null}</td><td style={{ ...tdJ, fontWeight: 700 }}>{fmt(ph.a_rectifier.montant)}</td><td style={tdJ}>{ph.a_rectifier.lignes}</td>
                    <td style={tdJ}>{ph.rectifie.lignes ? `${fmt(ph.rectifie.montant)} (${ph.rectifie.lignes})` : "–"}</td>
                    <td style={tdJ}>{ph.cles.length > 0 && res.suivi !== "non_installe" && <button onClick={() => ouvrirSaisie(ph.cles, `${ph.pharmacie}${ph.pharmacy_cip ? ` (${ph.pharmacy_cip})` : ""}, ${ph.cles.length} ligne(s) « Pér. »`)} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Tout marquer rectifié…</button>}</td>
                  </tr>))}
                  <tr><td style={{ ...tdJ, fontWeight: 800 }}>Total</td><td style={{ ...tdJ, fontWeight: 800 }}>{fmt(tot.a_rectifier.montant)}</td><td style={tdJ}>{tot.a_rectifier.lignes}</td><td style={tdJ}>{fmt(tot.rectifie.montant)} ({tot.rectifie.lignes})</td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
            <span>Lignes :</span>
            {[["a_rectifier", "à rectifier"], ["rectifie", "rectifiées"], ["a_verifier", "à vérifier"], ["tous", "toutes"]].map(([k, l]) => (
              <label key={k} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="radio" name="statut-ecart" checked={statut === k} onChange={() => setStatut(k)} />{l}</label>))}
          </div>
          {vues.length > 0 ? (
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table className="ex-ecarts-lignes" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead><tr>{["Date", "Pharmacie", "Réf. site", "Odoo", "Produit", "Qté", "Prix page", "Facturé", "Écart", "Pér. · remise", "Statut"].map((h, i) => <th key={i} style={{ ...th, padding: "4px 6px", fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>{vues.map(l => (
                  <tr key={l.cle} style={{ borderBottom: `1px solid ${T.lineSoft}`, background: l.type === "peremption" && l.coherent !== false ? undefined : T.surface2 }}>
                    <td style={tdJ}>{dateFr(l.date)}</td><td style={tdJ}>{l.pharmacie}{l.pharmacy_cip ? <div style={{ color: T.inkMute, fontFamily: T.mono }}>{l.pharmacy_cip}</div> : null}</td>
                    <td style={tdJ}>{l.commande}{l.separe_de ? <div style={{ color: T.inkMute }}>à part de {l.separe_de}</div> : null}</td>
                    <td style={tdJ}>{lienOdoo(l)}{l.liste ? <div style={{ color: T.inkMute }}>liste n° {l.liste}</div> : null}<div style={{ color: T.inkMute }}>{FACTURATION[l.facturation] || l.facturation || ""}</div></td>
                    <td style={tdJ}>{l.nom || l.cip}</td>
                    <td style={tdJ}>{l.qte}{l.qte_odoo > l.qte ? <div style={{ color: T.inkMute }}>sur {l.qte_odoo} dans Odoo</div> : null}</td><td style={tdJ}>{fmt(l.pn)}</td><td style={tdJ}>{fmt(l.net)}</td>
                    <td style={{ ...tdJ, fontWeight: 700, minWidth: 120 }}>{fmt(l.ecart)}
                      {l.type === "peremption" && l.coherent !== false && (l.statut !== "rectifie" || l.complement > 0) && <div style={{ color: T.inkMute, fontWeight: 400 }}>{actionEcart(l) === "avoir" ? "avoir à faire" : "à corriger dans Odoo avant facture"}</div>}
                      {(l.avoirs || []).length > 0 && <div style={{ color: T.ok, fontWeight: 400 }}>avoir {l.avoirs.map(a => `${a.numero} (${fmt(a.montant)})`).join(", ")} détecté, déduit</div>}</td>
                    <td style={tdJ}>{l.type === "peremption" ? `${dateFr(l.peremption)}${l.remise != null ? ` · −${pctBrut(l.remise)} %` : ""}` : TYPES_ECART[l.type]}
                      {l.regle_absente && <div style={{ color: T.warn, fontWeight: 700 }}>règle Odoo absente à l'import</div>}
                      {l.coherent === false && <div style={{ color: T.danger, fontWeight: 700 }} title={(l.a_verifier || []).join(" ; ")}>à vérifier{l.a_verifier?.length ? ` : ${l.a_verifier.join(" ; ")}` : ""}</div>}</td>
                    <td style={tdJ}><span style={{ ...ui.badge(l.statut === "rectifie" && !(l.complement > 0) ? "ok" : "warn"), fontSize: 10 }}>{STATUTS_ECART[l.statut] || "à rectifier"}</span>
                      {l.statut === "rectifie" && <div style={{ color: T.inkMute }}>{l.reference ? `réf. ${l.reference} · ` : ""}{l.par} · {heureFr(l.le)}</div>}
                      {l.complement > 0 && <div style={{ color: T.danger, fontWeight: 700 }}>complément à rectifier : {fmt(l.complement)}</div>}
                      {l.statut !== "rectifie" && l.reference_precedente && <div style={{ color: T.inkMute }}>ancienne réf. {l.reference_precedente}</div>}
                      {res.suivi !== "non_installe" && <div style={{ marginTop: 2 }}>{l.statut === "rectifie" && !(l.complement > 0)
                        ? <button onClick={() => marquer([l.cle], "a_rectifier")} style={{ ...ui.btn("lien"), fontSize: 11, color: T.inkMute }}>Remettre à rectifier</button>
                        : <button onClick={() => ouvrirSaisie([l.cle], `${l.nom || l.cip}, ${fmt(l.complement > 0 ? l.complement : l.ecart)}${l.complement > 0 ? " de complément" : ""}`)} style={{ ...ui.btn("lien"), fontSize: 11, color: T.teal }}>Marquer rectifié…</button>}</div>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : !cours && <div style={{ fontSize: 12, color: T.inkMute }}>Aucune ligne {statut === "a_rectifier" ? "à rectifier" : statut === "rectifie" ? "rectifiée" : statut === "a_verifier" ? "à vérifier" : ""} sur cette période.</div>}
          {res.nonRetrouvees?.length > 0 && (
            <details className="ex-ecarts-non-retrouvees" open={res.nonRetrouvees.some(x => x.ancien)}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: T.warn }}>Lignes « Pér. » non retrouvées dans Odoo ({res.nonRetrouvees.length}) : à vérifier à la main, hors des totaux</summary>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 6 }}>
                <thead><tr>{["Date", "Pharmacie", "Réf. site", "Produit (CIP)", "Qté", "Prix page", "Motif"].map(h => <th key={h} style={{ ...th, padding: "4px 6px", fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>{res.nonRetrouvees.map(x => (
                  <tr key={x.cle} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                    <td style={tdJ}>{dateFr(x.date)}</td><td style={tdJ}>{x.pharmacie}{x.pharmacy_cip ? ` · ${x.pharmacy_cip}` : ""}</td><td style={tdJ}>{x.commande}{x.separe_de ? <div style={{ color: T.inkMute }}>à part de {x.separe_de}</div> : null}</td>
                    <td style={tdJ}>{x.nom || x.cip}</td><td style={tdJ}>{x.qte}</td><td style={tdJ}>{fmt(x.pn)}</td>
                    <td style={tdJ}>{MOTIFS_NON_RETROUVEE[x.motif] || x.motif}{x.odoo ? ` (${x.odoo})` : ""}{x.piste ? <div style={{ color: T.inkMute }}>piste : commande Odoo {x.piste} de la même pharmacie</div> : null}</td>
                  </tr>))}</tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Atomes ──
// garder : un clic sur le fond ne ferme pas la fenêtre (cases cochées, saisie en cours) ; Échap et la croix ferment toujours
function Fenetre({ titre, onFermer, children, large = false, garder = false }) {
  useEffect(() => { const f = (e) => { if (e.key === "Escape") onFermer(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onFermer]);
  return (
    <div role="dialog" aria-modal="true" aria-label={titre} onClick={garder ? undefined : onFermer} style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 1200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ ...ui.card, width: "100%", maxWidth: large ? 980 : 560, boxShadow: T.shadow3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <strong style={{ fontSize: 16, color: T.ink }}>{titre}</strong>
          <button onClick={onFermer} aria-label="Fermer" className="ex-btn-discret" style={{ ...ui.rond(32), fontSize: 16 }}><Icone nom="fermer" taille={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Tuile({ titre, ton = "neutral", children }) {
  const t = tone(ton);
  return (
    <div style={{ flex: "1 1 170px", minWidth: 160, padding: "10px 12px", borderRadius: R.s, background: t.bg, color: t.fg, border: `1px solid ${t.border}`, fontSize: 13 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.85, marginBottom: 4 }}>{titre}</div>
      {children}
    </div>
  );
}
function Compteur({ libelle, valeur, detail, ton, onClick, actif, titre }) {
  const t = ton ? tone(ton) : null;
  const corps = <><div style={{ fontSize: 20, fontWeight: 800, color: t ? t.fg : T.ink }}>{valeur}</div><div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{libelle}</div>
    {detail && <div style={{ fontSize: 11, color: T.inkMute }}>{detail}</div>}</>;
  const style = { ...ui.card, padding: "10px 12px", textAlign: "left", boxShadow: actif ? `inset 0 0 0 2px ${T.teal}` : T.shadow1, fontFamily: "inherit" };
  return onClick ? <button onClick={onClick} aria-pressed={!!actif} title={titre} style={{ ...style, cursor: "pointer" }}>{corps}</button> : <div title={titre} style={style}>{corps}</div>;
}
const th = { ...ui.th, padding: "8px 8px", fontSize: 10 };
const td = { padding: "8px 8px", verticalAlign: "top", fontSize: 12 };
const tdD = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const tdJ = { padding: "4px 6px", verticalAlign: "top" };
const btnL = { ...ui.btn("ligne", "s"), background: undefined, boxShadow: `inset 0 0 0 1.5px ${T.lineField}`, fontSize: 12 };
// colonne collée au bord droit du tableau (boutons Appliquer, Retirer, Journal toujours visibles)
const colleDroite = { position: "sticky", right: 0, zIndex: 1, boxShadow: `-1px 0 0 ${T.lineSoft}` };
const encart = (ton) => { const t = tone(ton); return { display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: R.s, fontSize: 13, lineHeight: 1.5, background: t.bg, color: t.fg, border: `1px solid ${t.border}` }; };
