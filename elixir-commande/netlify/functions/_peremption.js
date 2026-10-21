// ── Péremption courte, « Odoo facture la remise » (V1) : logique du serveur ─────────────────────────────────────────
// Exploitation et mise en service : docs/peremption-odoo.md. Tables : sql/peremption.sql (RLS sans policy, clé
// service_role). Choix de Zineb (20/10/2026) : une remise péremption n'existe que si Odoo la facture.
//
// Mécanisme : une règle produit Odoo par liste de prix (applied_on = 1_product, compute_price = percentage, base =
// list_price), datée (date_start = repère de l'opération, date_end = filet : dernier jour où le produit peut rester sur la
// page). Les identifiants Odoo sont gardés dans peremption_regles : le site ne touche JAMAIS une règle absente de cette
// table (règles commerciales, barèmes, catégories, règles du 19/10).
//
// Règle d'ordre (le site n'affiche jamais un prix plus bas que celui qu'Odoo facture) :
//  • poser : réserver → créer dans Odoo → relire → contrôler le prix facturé (rapport Odoo) → prix du site → afficher ;
//  • retirer : cacher sur la page et remettre le prix habituel sur le site (étape A) → attendre les commandes en cours
//    d'import et le délai des réglages → supprimer dans Odoo, une règle à la fois, après contrôle d'identité (étape B).
//
// Deux verrous avant toute écriture Odoo (création, modification, suppression, e-mail d'alerte) : la variable Netlify
// PEREMPTION_ODOO_ECRITURE=1 ET le mode de l'admin (« Actif » ; « Créations suspendues » : retraits seulement).
// Mode « Simulation » (défaut) : tout se calcule et se journalise (resultat = « simule »), les lectures Odoo se font,
// aucune écriture Odoo. Toute écriture passe par ecrireOdoo() (JSON-RPC de _odoo-rpc.js, jamais odoo.js : son encodeur
// XML-RPC arrondit les nombres à l'entier).
//
// creerPeremption(deps) : deps.odoo, deps.fetch, deps.url, deps.cle, deps.env, deps.maintenant sont injectables
// (scripts/test-peremption-odoo.mjs : faux Odoo et faux Supabase, aucun appel réel).
import { randomUUID, createHash } from "node:crypto";
import { odoo as odooReel, COMPANY_ID } from "./_odoo-rpc.js";
import { indexRegles, prixUnitaire } from "./odoo-price-sync.js";
import { contexteMenus } from "./_accueil-selection.js";
import { FAUTEUILS, CLE_OUTILS } from "./_accueil-outils.js";
import { CONFIG_DEFAUT as LJ_DEFAUT } from "./_lab-justif.js";
// Offre de la page Péremption courte (règle du 21/10/2026 : −50 % par défaut, remise affichée de l'admin, règle Odoo facturée)
// et lignes de commande « Pér. » : même code que la page des pharmacies et que le panier (src/peremption-panier.js, pur)
import { offreAffichee, remiseAdmin, remiseDefaut, estPeremption, remiseLigne, SEUIL_CHER } from "../../src/peremption-panier.js";

// ── Constantes ──
export const LISTE_SITE = 5;            // liste affichée par le site (odoo_catalog.discounted_price)
export const LISTE_EXPORT = 4;          // jamais couverte
export const LISTES_DEFAUT = [5, 15, 1110, 1112, 1114, 25];
export const NOMS_LISTES = { 2: "Liste de prix EUR", 4: "Export", 5: "Liste de prix EUR 2", 15: "Expepharma", 1110: "CA >50k mensuel",
  1112: "Cluster 78", 1114: "VIP", 25: "Liste de prix EUR par défaut" };
export const nomListe = (l) => `${NOMS_LISTES[l] || "Liste"} (n° ${l})`;
export const MODES = ["simulation", "actif", "creations_suspendues"];
export const OUVERTES = ["voulue", "partielle", "facturee", "retrait_demande", "erreur", "modifiee_odoo"];
const VIVANTES = ["reservee", "active", "a_retirer", "modifiee_odoo"];
export const EXCLUSIONS = { multi_cip: "article multi-CIP (fauteuils)", menu_promo: "rangé dans un menu promo (prix saisi)",
  campagne: "rangé dans une campagne (prix de campagne)", justificatif: "produit sur justificatif labo", sanofipro: "commandé par Sanofi Pro",
  variantes: "fiche Odoo à plusieurs variantes", plusieurs_fiches: "plusieurs fiches Odoo pour ce CIP" };
export const RAISONS_FIN = { remise_retiree: "remise retirée par l'admin", sortie_date: "sortie de la page par la date", court_epuise: "stock court épuisé",
  lot_long_recu: "lot long reçu", exclu: "produit exclu", tout_retirer: "« Tout retirer »", regle_supprimee_odoo: "règle supprimée dans Odoo",
  fin_simulation: "fin de la simulation", refus: "refusée au moment de créer", erreur: "retirée après une erreur",
  regle_orpheline: "règle du site retrouvée sous une décision close" };
// décisions qui portent (ou vont porter) des règles vivantes dans Odoo : comptées dans le plafond des produits facturés
export const PORTEUSES = ["voulue", "partielle", "facturee", "erreur", "modifiee_odoo"];
export const MODES_LIBELLES = { simulation: "Simulation", actif: "Actif", creations_suspendues: "Créations suspendues" };
// Propositions de la conception (§ 16.3), modifiables dans l'admin sans code
export const REGLAGES_DEFAUT = {
  mode: "simulation", listes: LISTES_DEFAUT, base_remise: "prix_base", remise_auto_pct: null, remise_max_pct: 90, sous_cout: "confirmation",
  perte_max_produit: null, budget_perte_mensuel: null, lot_long_recu: "retrait", ventes_lgo_max: null, plafond_produits_par_lot: 40,
  plafond_produits_factures: 120, plafond_regles_par_passage: 60, seuil_annonce_pct: 5, delai_retrait_min: 120, disjoncteur_sortie_pct: 30,
  filet_dates_odoo: "a_prouver",
};
export const MARGE_DATE_MS = 3 * 3600e3;    // la page cache la remise 3 h avant date_end (Odoo cesse alors de l'appliquer)
export const VIE_MIN_MS = 24 * 3600e3;      // une règle doit pouvoir vivre au moins 24 h sur la page (sinon « fin trop proche »)
export const AVANCE_DEBUT_MS = 120e3;       // date_start = seconde de l'opération − 2 min (horloge de Netlify en avance sur Odoo)
export const ESSAIS_MAX = 3;
export const VERROU_MS = 90e3;              // verrou d'un appel : prolongé après chaque élément ; un appel coupé le perd en 90 s
export const ESTIMATION_ELEMENT_MS = 4000;  // coût d'un élément (création : ~35 appels) : pas de nouvel élément au-delà du budget
export const PROTECTION_ADMIN_MS = 30 * 60e3;   // décisions d'un passage de l'admin en cours : ni complétées ni touchées par le filet
export const ATTENTE_COMMANDES_MAX_MS = 24 * 3600e3;
export const FAITS_FRAIS_MS = 24 * 3600e3;
export const RETRAIT_VISIBLE_MS = 7 * 864e5; // remises finies renvoyées à la page (prix des paniers enregistrés)
// Règle panier (21/10/2026) : la page affiche −50 % par défaut, la ligne « Pér. » du panier garde ce prix ; Odoo facture le tarif
// de la liste du client tant que la ligne n'est pas corrigée à la main → contrôle et suivi des écarts (peremption_ecarts)
export const DEBUT_REGLE_PANIER = "2026-10-21";
export const STATUTS_ECART = ["a_rectifier", "rectifie"];
const RESUME_ECARTS_MS = 10 * 60e3;          // résumé des écarts gardé 10 min par instance (bandeau de l'admin)
const ENVOI_RECENT_MS = 60 * 60e3;          // tâche du relais envoyée il y a moins de 60 min : import peut-être en cours
const COMMANDES_SITE_MS = 48 * 3600e3;      // commandes du site non envoyées regardées sur 48 h
const DISJ_MIN_SORTIES = 3;                 // le disjoncteur des sorties ne s'ouvre qu'à partir de 3 sorties
const CHAMPS_REGLE = ["pricelist_id", "applied_on", "product_tmpl_id", "product_id", "compute_price", "percent_price", "base",
  "min_quantity", "date_start", "date_end", "company_id"];
const IDENTITE = ["pricelist_id", "product_tmpl_id", "applied_on", "compute_price", "percent_price", "date_start"];
const PAR_APPEL_RAPPORT = 60;

// ── Petits outils (purs) ──
export const round2 = (n) => Math.round(n * 100) / 100;
const num = (x) => { const v = typeof x === "number" ? x : parseFloat(String(x ?? "").replace(",", ".")); return Number.isFinite(v) ? v : null; };
const enc = encodeURIComponent;
const liste = (arr) => `(${arr.map(v => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;
const lireJson = (t, defaut) => { if (typeof t !== "string") return t ?? defaut; try { return JSON.parse(t); } catch { return defaut; } };
const court = (e) => String(e?.message || e || "").replace(/\s+/g, " ").slice(0, 300);
const many2one = (v) => (Array.isArray(v) ? v[0] : Number(v) || null);
export const jourUTC = (t) => new Date(t).toISOString().slice(0, 10);
export const ajouterJours = (j, n) => { const d = new Date(`${j}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// datetime Odoo « AAAA-MM-JJ HH:MM:SS » (UTC) ↔ instant
export const versOdoo = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
export const depuisOdoo = (s) => { if (!s) return null; const t = Date.parse(String(s).replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$/.test(String(s)) ? "" : "Z")); return Number.isFinite(t) ? t : null; };
const memeInstant = (a, b) => { const x = depuisOdoo(a), y = depuisOdoo(b); return x != null && y != null && Math.floor(x / 1000) === Math.floor(y / 1000); };
export const empreinte = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
// montant en français : 3.29 → « 3,29 € » (messages du serveur lus dans l'admin et les e-mails)
export const eur = (n) => (n == null || !Number.isFinite(Number(n)) ? "?" : `${Number(n).toFixed(2).replace(".", ",")} €`);
// date et heure à Paris : « 21/10/2026 » ; « 21/10 à 14 h 05 »
export const dateParis = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }) : "?"; };
export const heureParis = (t) => { const d = new Date(t); if (!Number.isFinite(d.getTime())) return "?";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}/${p.month} à ${p.hour} h ${p.minute}`; };
// erreur dont l'issue est inconnue (délai, coupure réseau) : l'écriture a pu aboutir dans Odoo
export const estIncertain = (e) => !!(e?.incertain || e?.name === "TimeoutError" || e?.name === "AbortError" || /fetch failed|network|ECONN|socket|timeout|délai/i.test(String(e?.message || "")));

// Fenêtre de la page (odoo-catalog.js expiry_months=4, en UTC comme Netlify) : péremption entre J+30 et la fin du 4e mois
export function fenetre(t) {
  const d = new Date(t);
  return { aujourdhui: jourUTC(t), min: jourUTC(t + 30 * 864e5), max: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 5, 0)).toISOString().slice(0, 10) };
}
// Fin de la règle : dernier jour où le produit peut rester sur la page (lot court − 30 j), fin de journée à Paris (hiver)
export const finRegle = (courtFin) => `${ajouterJours(courtFin, -30)}T22:59:59.000Z`;

// Réglages lus (ligne de la table) → réglages normalisés : listes entières, jamais la 4, toujours la 5 ; valeurs bornées
export function normaliserReglages(r = {}) {
  const v = { ...REGLAGES_DEFAUT, ...Object.fromEntries(Object.entries(r || {}).filter(([, x]) => x !== undefined)) };
  const listes = [...new Set((Array.isArray(v.listes) ? v.listes : lireJson(v.listes, LISTES_DEFAUT) || []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== LISTE_EXPORT))];
  if (!listes.includes(LISTE_SITE)) listes.unshift(LISTE_SITE);
  const entier = (x, d, min, max) => { const n = Number(x); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
  const montant = (x) => { const n = num(x); return n != null && n >= 0 ? n : null; };
  return { ...v, mode: MODES.includes(v.mode) ? v.mode : "simulation", listes,
    base_remise: v.base_remise === "prix_liste5" ? "prix_liste5" : "prix_base",
    remise_auto_pct: v.remise_auto_pct == null ? null : entier(v.remise_auto_pct, null, 1, 90),
    remise_max_pct: entier(v.remise_max_pct, 90, 1, 90), sous_cout: v.sous_cout === "interdit" ? "interdit" : "confirmation",
    perte_max_produit: montant(v.perte_max_produit), budget_perte_mensuel: montant(v.budget_perte_mensuel),
    lot_long_recu: v.lot_long_recu === "maintien" ? "maintien" : "retrait", ventes_lgo_max: v.ventes_lgo_max == null ? null : entier(v.ventes_lgo_max, null, 0, 100000),
    plafond_produits_par_lot: entier(v.plafond_produits_par_lot, 40, 1, 200), plafond_produits_factures: entier(v.plafond_produits_factures, 120, 1, 1000),
    plafond_regles_par_passage: entier(v.plafond_regles_par_passage, 60, 6, 600), seuil_annonce_pct: Math.min(50, Math.max(0, num(v.seuil_annonce_pct) ?? 5)),
    delai_retrait_min: entier(v.delai_retrait_min, 120, 0, 7 * 24 * 60), disjoncteur_sortie_pct: entier(v.disjoncteur_sortie_pct, 30, 1, 100),
    filet_dates_odoo: ["oui", "non"].includes(v.filet_dates_odoo) ? v.filet_dates_odoo : "a_prouver" };
}

// Verrous d'écriture Odoo : variable Netlify ET mode de l'admin. Une fonction d'aperçu de déploiement (deploy preview,
// branch deploy : autre version du code, mêmes variables si leur portée n'est pas limitée à « Production ») n'écrit
// jamais : si Netlify expose CONTEXT et qu'il ne vaut pas « production », la variable est tenue pour absente.
export function verrous(reglages, env = process.env) {
  const contexte = env?.CONTEXT ? String(env.CONTEXT) : null;
  const horsProduction = contexte != null && contexte !== "production";
  const variable = String(env?.PEREMPTION_ODOO_ECRITURE ?? "") === "1" && !horsProduction;
  const mode = reglages?.mode || "simulation";
  return { variable, mode, creation: variable && mode === "actif", retrait: variable && (mode === "actif" || mode === "creations_suspendues"),
    ...(horsProduction ? { contexte } : {}) };
}

// Rapport Odoo des listes de prix (report.product.report_pricelist.get_html, qté 1) → { pid: prix } ; « 1 417,48 » → 1417.48
export function lireRapport(html) {
  const out = {};
  for (const ligne of String(html || "").split(/<tr>/).slice(1)) {
    const m = ligne.match(/data-res-id="(\d+)"/);
    if (!m) continue;
    const v = [...ligne.matchAll(/oe_currency_value">([^<]+)</g)].map(x => {
      let s = x[1].replace(/[\s\u00a0\u202f]/g, "");
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      return Number(s);
    }).filter(Number.isFinite);
    if (v.length) out[m[1]] = v.at(-1);
  }
  return out;
}

// Stock libre par lot → { court_qte, court_fin, long_qte, long_debut, autre_qte } (court : périme au plus tard à la fin de la
// fenêtre ; long : au-delà ; autre : sans lot ou lot sans date). Emplacements exclus (quarantaine, destruction, rebut) ignorés.
export function classerStock(quants, lotsParId, exclus, fen) {
  const r = { court_qte: 0, court_fin: null, long_qte: 0, long_debut: null, autre_qte: 0 };
  for (const q of quants || []) {
    if (exclus?.has?.(many2one(q.location_id))) continue;
    const libre = (num(q.quantity) || 0) - (num(q.reserved_quantity) || 0);
    if (libre < 1) continue;
    const n = Math.round(libre);
    const lot = many2one(q.lot_id);
    const exp = lot ? lotsParId[lot] : null;
    const j = exp ? String(exp).slice(0, 10) : null;
    if (!j || !/^\d{4}-\d{2}-\d{2}$/.test(j)) { r.autre_qte += n; continue; }
    if (j <= fen.max) { r.court_qte += n; if (!r.court_fin || j < r.court_fin) r.court_fin = j; }
    else { r.long_qte += n; if (!r.long_debut || j < r.long_debut) r.long_debut = j; }
  }
  return r;
}

// Canal d'une ligne de vente : site (référence PharmaML du site, 13 chiffres « 17… »), LGO (autre référence PharmaML), autre
export const canalVente = (ref) => (/^17\d{11}(P\d+)?$/.test(String(ref || "")) ? "site" : ref ? "lgo" : "autre");

// Demi-centime : prix de base × (1 − pct) tombe exactement sur x,xx5 €. Odoo arrondit au demi supérieur (float_round :
// 6,35 × 0,7 = 4,445 → 4,45 €) ; la synchro « Prix remisés » du site (applyRule d'odoo-price-sync.js, Math.round en
// virgule flottante) donne 4,44 € : le site afficherait un centime de MOINS que la facture. Une telle remise est refusée
// (choisir le pourcentage voisin) ; calcul exact en centimes.
export function demiCentime(lp, pct) {
  const x = Math.round(Number(lp) * 100) * (100 - Number(pct));   // centièmes de centime
  return Math.abs((((x / 100) % 1) + 1) % 1 - 0.5) < 1e-6;
}
// Cible d'une remise : percent_price posé dans Odoo et prix visé (prix de base × (1 − percent_price))
// base « prix_base » : % du prix de base (comme la facture : « PU = prix de base, Remise % ») ; « prix_liste5 » : % du prix
// habituel de la liste n° 5, traduit en % du prix de base (4 décimales).
export function cibleRemise(f, remise, reglages) {
  const lp = num(f?.list_price);
  if (!(lp > 0) || !(remise > 0)) return null;
  let pct = remise;
  if (reglages?.base_remise === "prix_liste5") {
    // 2 décimales : la ligne de vente d'Odoo garde la remise avec la précision « Discount » (2 décimales, relevé du
    // 21/10/2026) ; avec 4 décimales, la facture (PU × (1 − remise arrondie)) pourrait s'écarter du rapport d'un centime
    const l5 = num(f?.prix_listes?.[LISTE_SITE]);
    if (!(l5 > 0)) return null;
    pct = Math.round((1 - (l5 * (1 - remise / 100)) / lp) * 1e4) / 100;
    if (demiCentime(lp, pct)) pct = Math.round((pct + 0.01) * 100) / 100;   // décimales libres : on s'écarte du demi-centime
    if (!(pct > 0 && pct < 100)) return null;
  }
  // arrondi au centime le plus proche, calculé en centimes (pas de 4,4449999… flottant)
  return { percent_price: pct, prix_vise: Math.round(Math.round(lp * 100) * (100 - pct) / 100) / 100 };
}

// Prix attendus après la règle, par liste : min(prix sans la règle, prix visé) (logique MIN d'Odoo)
export function prixAttendus(prixSansRegle, prixVise, listes) {
  const out = {};
  for (const l of listes) { const p = num(prixSansRegle?.[l]); out[l] = p == null ? null : Math.min(p, prixVise); }
  return out;
}

// Éligibilité d'un produit (faits frais) à une remise. options : remise, force (long + autre accepté), sousCout (case
// cochée), decision (ouverte), nbFacturees (autres produits facturés ; null : pas de plafond), lot (taille de l'application
// en lot), controleFin (false : décision existante, la « fin trop proche » ne vaut que pour une création)
// → { ok, statut, raisons:[{code, texte}], cible, prix, pertes, propose }
// habituels : prix par liste figés à la décision (produit déjà remisé : le rapport d'Odoo donne alors NOTRE prix)
export function eligibilite(f0, reglages, t, o = {}) {
  const f = f0 && o.habituels ? { ...f0, prix_listes: { ...(f0.prix_listes || {}), ...o.habituels } } : f0;
  const raisons = [];
  const non = (code, texte) => raisons.push({ code, texte });
  const R = reglages;
  if (!f) return { ok: false, statut: "faits_absents", raisons: [{ code: "faits_absents", texte: "faits Odoo absents (produit introuvable dans Odoo ?)" }] };
  const fen = fenetre(t);
  const excl = (f.exclusions || []).filter(e => EXCLUSIONS[e]);
  if (excl.length) non("exclu", `Non remisable : ${excl.map(e => EXCLUSIONS[e]).join(", ")}`);
  if (!(f.court_qte >= 1)) non("court_epuise", "Court épuisé : aucune boîte courte vendable dans Odoo");
  else if (!f.court_fin || f.court_fin < fen.min) non("sortie_date", "Sortie par la date : le lot court passe sous 30 jours");
  else if (o.remise != null && o.controleFin !== false && Date.parse(finRegle(f.court_fin)) - MARGE_DATE_MS - (R.delai_retrait_min || 0) * 60e3 < t + VIE_MIN_MS)
    // une remise décidée le soir d'un dernier jour vivrait quelques heures (ou naîtrait expirée : date_end déjà passée)
    non("fin_proche", `Fin trop proche : la règle s'arrêterait le ${dateParis(Date.parse(finRegle(f.court_fin)))} (lot au ${dateParis(Date.parse(`${f.court_fin}T12:00:00Z`))}), la page la cacherait avant 24 h`);
  const horsCourt = (f.long_qte || 0) + (f.autre_qte || 0);
  const force = o.force != null ? Number(o.force) : null;
  if (horsCourt > 0 && !(force != null && horsCourt <= force))
    non("lot_long", `${f.long_qte || 0} boîte(s) à date longue${f.autre_qte ? ` et ${f.autre_qte} sans date` : ""} : forcer pour remiser aussi ces boîtes`);
  if (R.ventes_lgo_max != null && (f.ventes_30j?.lgo || 0) > R.ventes_lgo_max) non("lgo", `vendu par les logiciels des pharmacies (${f.ventes_30j.lgo} boîtes en 30 j)`);
  const remise = Number(o.remise);
  let cible = null, prix = null, pertes = null;
  if (o.remise != null) {
    if (!Number.isInteger(remise) || remise < 1 || remise > R.remise_max_pct) non("remise", `remise entière de 1 à ${R.remise_max_pct} %`);
    else {
      cible = cibleRemise(f, remise, R);
      const habituel = num(f.prix_listes?.[LISTE_SITE]);
      if (!cible || habituel == null) non("prix", "prix de base ou prix de la liste n° 5 illisible");
      else {
        const manquantes = R.listes.filter(l => num(f.prix_listes?.[l]) == null);
        if (manquantes.length) non("prix", `prix illisible sur ${manquantes.map(nomListe).join(", ")}`);
        prix = { habituel, vise: cible.prix_vise, base: num(f.list_price) };
        if (demiCentime(f.list_price, cible.percent_price)) {
          const exact = (Math.round(num(f.list_price) * 100) * (100 - cible.percent_price) / 10000).toFixed(3).replace(".", ",");
          non("arrondi", `Remise de ${remise} % : ${exact} € tombe sur un demi-centime (Odoo arrondit au centime supérieur, la synchro « Prix remisés » du site au centime inférieur) : choisir ${remise - 1} % ou ${remise + 1} %`);
        }
        if (cible.prix_vise > round2(habituel * (1 - R.seuil_annonce_pct / 100)) + 0.0001) {
          const eco = Math.round((1 - cible.prix_vise / habituel) * 1000) / 10;
          non("sans_effet", `Sans effet : ${eur(cible.prix_vise)} contre ${eur(habituel)} habituellement, soit ${String(Math.max(0, eco)).replace(".", ",")} % d'économie pour la pharmacie (il en faut au moins ${String(R.seuil_annonce_pct).replace(".", ",")} % : seuil d'annonce des réglages)`);
        }
        pertes = calculPertes(f, cible.prix_vise, { force: horsCourt > 0 && force != null });
        if (pertes.sous_cout) {
          if (R.sous_cout === "interdit") non("sous_cout_interdit", "vente sous le coût interdite par les réglages");
          else if (!o.sousCout) non("sous_cout", pertes.cout_inconnu ? "coût non renseigné dans Odoo : cocher la confirmation" : `sous le coût : perte ${eur(pertes.perte_boite)} par boîte, à confirmer`);
          if (R.perte_max_produit != null && pertes.perte_totale > R.perte_max_produit) non("perte_max", `perte ${eur(pertes.perte_totale)} au-delà du plafond de ${eur(R.perte_max_produit)} par produit`);
        }
      }
    }
  }
  const plafond = o.decision ? 0 : 1;
  if (o.nbFacturees != null && o.nbFacturees + plafond > R.plafond_produits_factures) non("plafond", `plafond de ${R.plafond_produits_factures} produits facturés atteint`);
  if (o.lot != null && o.lot > R.plafond_produits_par_lot) non("plafond_lot", `au plus ${R.plafond_produits_par_lot} produits par application`);
  const premier = raisons[0]?.code;
  const statut = !raisons.length ? "remisable" : ["exclu", "court_epuise", "sortie_date", "fin_proche", "lot_long", "sans_effet", "lgo"].includes(premier) ? premier : "bloque";
  // proposition « À remiser » (repère de l'admin, rien n'est créé) : seulement court, sans exclusion
  const propose = !excl.length && f.court_qte >= 1 && f.court_fin >= fen.min && horsCourt === 0;
  return { ok: !raisons.length, statut, raisons, cible, prix, pertes, propose };
}

// Marge et pertes au prix péremption (§ 4.3) : marge = (prix − coût) / prix
export function calculPertes(f, prix, { force = false } = {}) {
  const cout = num(f?.cout);
  const qte = (f?.court_qte || 0) + (force ? (f?.long_qte || 0) + (f?.autre_qte || 0) : 0);
  const coutInconnu = !(cout > 0);
  const perteBoite = coutInconnu ? 0 : Math.max(0, round2(cout - prix));
  const habituel = num(f?.prix_listes?.[LISTE_SITE]);
  return {
    cout: coutInconnu ? null : cout, cout_inconnu: coutInconnu, sous_cout: coutInconnu || prix < cout - 0.0001,
    marge_pct: coutInconnu || !(prix > 0) ? null : Math.round(((prix - cout) / prix) * 1000) / 10,
    perte_boite: perteBoite, qte, perte_totale: round2(perteBoite * qte), perte_court: round2(perteBoite * (f?.court_qte || 0)),
    destruction: coutInconnu ? null : round2((f?.court_qte || 0) * cout),
    effet_lgo_mois: habituel == null ? null : round2((f?.ventes_30j?.lgo || 0) * Math.max(0, habituel - prix)),
    ventes_lgo_30j: f?.ventes_30j?.lgo || 0,
    remise_max_sans_perte: coutInconnu || !(num(f?.list_price) > 0) ? null : Math.max(0, Math.floor((1 - cout / num(f.list_price)) * 100)),
  };
}

// Valeurs d'une règle Odoo (une par liste ; identiques hors pricelist_id)
export function valeursRegle({ liste: l, tmpl, percent, debut, fin }) {
  return { pricelist_id: l, applied_on: "1_product", product_tmpl_id: tmpl, compute_price: "percentage", percent_price: percent,
    base: "list_price", min_quantity: 0, date_start: versOdoo(debut), date_end: versOdoo(fin) };
}
// Identité d'une règle relue dans Odoo ↔ ligne enregistrée : liste des champs qui diffèrent (vide = conforme)
// Une écriture du site en cours (r.cible : { percent_price?, date_end? }, posée AVANT l'écriture Odoo) : la valeur
// visée est acceptée autant que la valeur enregistrée, jusqu'à la finalisation (finaliserCible).
const memePct = (a, b) => b != null && a != null && Math.abs(Number(a) - Number(b)) <= 1e-6;
export function ecartsIdentite(lu, r) {
  const d = [];
  const cible = lireJson(r.cible, null);
  if (many2one(lu.pricelist_id) !== Number(r.pricelist_id)) d.push("pricelist_id");
  if (many2one(lu.product_tmpl_id) !== Number(r.odoo_tmpl_id)) d.push("product_tmpl_id");
  if (lu.applied_on !== "1_product") d.push("applied_on");
  if (lu.compute_price !== "percentage") d.push("compute_price");
  const p = num(lu.percent_price);
  if (!memePct(p, r.percent_price) && !memePct(p, cible?.percent_price)) d.push("percent_price");
  if (!memeInstant(lu.date_start, r.date_start)) d.push("date_start");
  return d;
}
// Relecture juste après la création : tous les champs envoyés
export function ecartsValeurs(lu, v) {
  const d = ecartsIdentite(lu, { pricelist_id: v.pricelist_id, odoo_tmpl_id: v.product_tmpl_id, percent_price: v.percent_price, date_start: v.date_start, cible: v.cible });
  if (lu.base !== "list_price") d.push("base");
  if (Math.abs(num(lu.min_quantity) || 0) > 1e-9) d.push("min_quantity");
  const cible = lireJson(v.cible, null);
  if (!memeInstant(lu.date_end, v.date_end) && !(cible?.date_end && memeInstant(lu.date_end, cible.date_end))) d.push("date_end");
  return d;
}
// Écriture du site en cours sur une règle : la relecture dit si elle a abouti → champs à enregistrer (null : rien)
export function issueCible(lu, r) {
  const cible = lireJson(r.cible, null);
  if (!cible || !lu) return null;
  const pctOk = cible.percent_price == null || memePct(num(lu.percent_price), cible.percent_price);
  const finOk = cible.date_end == null || memeInstant(lu.date_end, cible.date_end);
  if (pctOk && finOk) return { ...(cible.percent_price != null ? { percent_price: Number(cible.percent_price) } : {}), ...(cible.date_end ? { date_end: cible.date_end } : {}), cible: null };
  const pctAvant = cible.percent_price == null || memePct(num(lu.percent_price), r.percent_price);
  const finAvant = cible.date_end == null || memeInstant(lu.date_end, r.date_end);
  return pctAvant && finAvant ? { cible: null } : null;   // l'écriture n'a pas eu lieu ; sinon (mélange) : on attend
}

// Règle Odoo → format compact d'odoo-price-sync (step=load)
export const regleCompacte = (it) => ({ id: it.id, ao: it.applied_on || "", cp: it.compute_price || "", fp: num(it.fixed_price) || 0, pp: num(it.percent_price) || 0,
  pd: num(it.price_discount) || 0, ps: num(it.price_surcharge) || 0, mq: num(it.min_quantity) || 0, pid: many2one(it.product_id) || 0,
  tid: many2one(it.product_tmpl_id) || 0, cid: many2one(it.categ_id) || 0,
  ds: /^\d{4}-\d{2}-\d{2}/.test(String(it.date_start || "")) ? String(it.date_start).slice(0, 10) : "",
  de: /^\d{4}-\d{2}-\d{2}/.test(String(it.date_end || "")) ? String(it.date_end).slice(0, 10) : "" });
// copie d'applyRule (odoo-price-sync.js, non exportée) pour les paliers ; scripts/test-peremption-odoo.mjs la compare à prixUnitaire
export function prixRegle(r, lp) {
  if (r.cp === "fixed") return r.fp > 0 ? round2(r.fp) : null;
  if (r.cp === "percentage") return round2(lp * (1 - (r.pp || 0) / 100));
  if (r.cp === "formula") return round2(lp * (1 - (r.pd || 0) / 100) + (r.ps || 0));
  return null;
}
// Prix du site d'un produit (même calcul qu'odoo-price-sync step=apply) → { discounted_price, discount_pct, price_tiers }
export function prixSite(p, regles, parentMap, jour) {
  const lp = num(p.list_price) || 0;
  if (lp <= 0) return null;
  const ix = indexRegles(regles, jour);
  const price = prixUnitaire(p, ix, parentMap);
  const unit = price != null && price > 0 && price < lp ? price : lp;
  const tiers = [];
  for (const r of [...(ix.tiersByPid[p.odoo_pid] || []), ...(ix.tiersByTid[p.odoo_tmpl_id] || [])]) {
    const tp = prixRegle(r, lp);
    if (tp == null || tp <= 0 || tp >= unit) continue;
    const prev = tiers.find(x => x.min_qty === r.mq);
    if (prev) { if (tp < prev.price) prev.price = tp; } else tiers.push({ min_qty: r.mq, price: tp });
  }
  tiers.sort((a, b) => a.min_qty - b.min_qty);
  tiers.forEach(x => { x.pct = Math.round((1 - x.price / lp) * 1000) / 10; });
  const price_tiers = tiers.length ? tiers : null;
  if (price == null || price <= 0 || price >= lp) return { discounted_price: null, discount_pct: 0, price_tiers };
  return { discounted_price: price, discount_pct: Math.round((1 - price / lp) * 1000) / 10, price_tiers };
}
export const prixAffiche = (c) => { const dp = num(c?.discounted_price); return dp > 0 && num(c?.discount_pct) > 0 ? dp : num(c?.list_price); };

// La page n'annonce la remise que si : décision facturée, règles actives et vérifiées sur toutes les listes, prix du
// site repris (|discounted_price − prix attendu liste 5| < 0,01), et date de fin pas encore atteinte (3 h avant
// date_end : calcul pur, sans Odoo, pour qu'une panne d'Odoo ne laisse pas la page annoncer une remise expirée)
export function estAffichee(d, regles, cat, listes, t = Date.now()) {
  if (!d || d.statut !== "facturee" || d.simulee) return false;
  const finMs = Date.parse(d.date_fin_regle || "");
  if (Number.isFinite(finMs) && t >= finMs - MARGE_DATE_MS) return false;
  const actives = new Map((regles || []).filter(r => r.decision_id === d.id && r.statut === "active" && r.verifiee_at && r.odoo_item_id).map(r => [Number(r.pricelist_id), r]));
  if (!listes.every(l => actives.has(Number(l)))) return false;
  const attendu = num(lireJson(d.prix_attendu, {})?.[LISTE_SITE]);
  const site = num(cat?.discounted_price);
  return attendu != null && site != null && Math.abs(site - attendu) < 0.01;
}

// ── Écarts (règle panier) : lignes du site contre les lignes de vente Odoo (pur, testé) ──
// ecartLigne (une ligne du site contre une ligne Odoo, ou un groupe additionné) : it = ligne enregistrée par le site (pn = prix
// du panier ; peremption, remise, facture_odoo, separeDe) ; l = { product_uom_qty, price_unit, discount, price_subtotal }.
// → null (pas d'écart) ou { type, qte, net, ecart, coherent, … } :
//  • « peremption » : ligne prise au prix de la page (« Pér. », remise ≥ 1) facturée plus cher (règle Odoo absente à l'import
//                     d'une ligne « facturée par Odoo » comprise : regle_absente) ;
//  • « probable »   : ancienne page (avant le 20/10/2026), sans mention : PU du panier = prix de base × 0,5 (× 0,8 dès 500 €) ;
//  • « autre »      : client d'une autre liste que la 5, prix changé entre le panier et l'import, ligne du lot 0 (mention sans
//                     remise, au prix habituel).
// Une ligne réellement facturée par une règle Odoo (net ≤ prix du panier) n'a jamais d'écart. coherent : le prix de la ligne vaut
// au moins le PU d'Odoo (prix de base) × (1 − remise) à 2 centimes près (le serveur contrôle aussi l'offre : lignesEcarts).
export function ecartLigne(it, l) {
  const qteOdoo = Number(l?.product_uom_qty);
  if (!it || !(qteOdoo > 0)) return null;
  const { remise, facture_odoo } = remiseLigne(it);
  const per = estPeremption(it);
  const pn = num(it.pn);
  const net = round2(Number(l.price_subtotal) / qteOdoo);
  if (pn == null || !(net > pn + 0.005)) return null;
  const pu = num(l.price_unit);
  const type = per && remise >= 1 ? "peremption"
    : !per && pu > 0 && (Math.abs(pn - round2(pu * 0.5)) <= 0.01 || (pu >= SEUIL_CHER && Math.abs(pn - round2(pu * 0.8)) <= 0.01)) ? "probable" : "autre";
  const qteSite = Number(it.qty) || 0;
  const qte = Math.min(qteSite > 0 ? qteSite : qteOdoo, qteOdoo);
  const attendu = type === "peremption" && pu > 0 ? round2(pu * (1 - remise / 100)) : null;
  return { type, qte, qte_commandee: qteSite, qte_odoo: qteOdoo, pn, net, pu, remise_odoo: num(l.discount), remise: per ? remise : null,
    ecart: round2((net - pn) * qte), coherent: attendu == null || pn >= attendu - 0.02, ...(type === "peremption" && facture_odoo ? { regle_absente: true } : {}) };
}
// Une ligne de vente Odoo → ce qui est réellement facturé (revue du 21/10/2026) : factures postées moins avoirs postés, plus les
// boîtes livrées (ou commandées, rien de livré) pas encore facturées, au net de la ligne. mouvements : id de account.move.line →
// { type: out_invoice | out_refund, etat, quantite, montant, numero }. → { boites, montant, puNet, avoirs, facturee }
export function factureLigne(l, mouvements = new Map()) {
  const qte = Number(l?.product_uom_qty) || 0;
  const puNet = qte > 0 ? (Number(l.price_subtotal) || 0) / qte : 0;
  const mv = (Array.isArray(l?.invoice_lines) ? l.invoice_lines : []).map(id => mouvements.get(Number(id))).filter(m => m && m.etat === "posted");
  const fact = mv.filter(m => m.type === "out_invoice"), avoirs = mv.filter(m => m.type === "out_refund");
  const qInv = fact.reduce((s, m) => s + (Number(m.quantite) || 0), 0);
  const livre = Number(l?.qty_delivered) > 0 ? Math.min(qte, Number(l.qty_delivered)) : qte;
  const reste = Math.max(0, livre - qInv);
  const montant = fact.reduce((s, m) => s + (Number(m.montant) || 0), 0) - avoirs.reduce((s, m) => s + (Number(m.montant) || 0), 0) + reste * puNet;
  return { boites: qInv + reste, montant: round2(montant), puNet: round2(puNet), avoirs: avoirs.map(m => ({ numero: m.numero, montant: round2(Number(m.montant) || 0) })), facturee: fact.length > 0 };
}
// Groupe (commande Odoo × produit) : le connecteur additionne sur une ligne les boîtes d'un même produit de commandes du site
// regroupées (ligne du menu et ligne « Pér. » partie à part), l'admin peut scinder ou corriger la ligne. odoo : factureLigne de
// TOUTES les lignes du groupe ; site : [{ qty, pn, per }] de toutes les lignes du site qui y aboutissent. Les lignes hors « Pér. »
// sont servies d'abord, à leur prix ; le reste des boîtes et du montant revient aux lignes « Pér. » ; écart = reste du montant −
// boîtes « Pér. » × prix de la page, au plus boîtes × (PU net maximal du groupe − prix de la page). → { boites, montant, puMax,
// serviReduit (moins de boîtes dans Odoo que sur le site), lignes: [{ qte, ecart, net }] (une par ligne « Pér. », dans l'ordre) }
export function repartirGroupe(odoo, site) {
  const Q = odoo.reduce((s, l) => s + (l.boites || 0), 0), M = odoo.reduce((s, l) => s + (l.montant || 0), 0);
  const puMax = odoo.reduce((m, l) => (l.boites > 0 ? Math.max(m, l.puNet || 0) : m), 0);
  const autres = site.filter(x => !x.per), pers = site.filter(x => x.per);
  const qte = (x) => Math.max(0, Number(x.qty) || 0);
  const resteQ = Q - autres.reduce((s, x) => s + qte(x), 0);
  const resteM = M - autres.reduce((s, x) => s + qte(x) * (num(x.pn) ?? puMax), 0);
  let dispo = Math.max(0, resteQ);
  const q = pers.map(x => { const v = Math.min(qte(x), dispo); dispo -= v; return v; });
  const attendu = pers.reduce((s, x, i) => s + q[i] * (num(x.pn) || 0), 0);
  const caps = pers.map((x, i) => q[i] * Math.max(0, puMax - (num(x.pn) || 0)));
  const capTot = caps.reduce((s, c) => s + c, 0);
  const total = round2(Math.min(Math.max(0, resteM - attendu), capTot));
  let reparti = 0;
  const ecarts = caps.map((c, i) => { if (i === caps.length - 1) return round2(total - reparti); const e = capTot > 0 ? round2(total * c / capTot) : 0; reparti = round2(reparti + e); return e; });
  return { boites: Q, montant: round2(M), puMax: round2(puMax), serviReduit: Q < site.reduce((s, x) => s + qte(x), 0),
    lignes: pers.map((x, i) => ({ qte: q[i], ecart: Math.max(0, ecarts[i] || 0), net: q[i] > 0 ? round2((num(x.pn) || 0) + Math.max(0, ecarts[i] || 0) / q[i]) : null })) };
}
// minuit à Paris du jour « AAAA-MM-JJ » (changement d'heure compris) → ISO UTC ; jour valide
function decalageParisMin(date) {
  const m = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" }).format(date).match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
export function minuitParisIso(jour) {
  const approx = Date.parse(`${jour}T00:00:00Z`);
  let t = approx - decalageParisMin(new Date(approx)) * 60000;
  t = approx - decalageParisMin(new Date(t)) * 60000;
  return new Date(t).toISOString();
}
export const jourValide = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const CLE_ECART = /^\d{6,16}:\d{7,14}(:\d{1,3})?$/;
export const cleEcartValide = (c) => CLE_ECART.test(String(c || ""));

// ── Le module (dépendances injectables) ──
export function creerPeremption(deps = {}) {
  const env = deps.env || process.env;
  const url = deps.url || env.SUPABASE_URL;
  const cle = deps.cle || env.SUPABASE_SERVICE_ROLE_KEY;
  const http = deps.fetch || ((...a) => fetch(...a));
  const maintenant = deps.maintenant || (() => Date.now());
  const odooBrut = deps.odoo || ((m, me, a, k) => odooReel(m, me, a, k, { timeoutMs: deps.delaiOdooMs ?? 8000 }));
  const CTX = { allowed_company_ids: [COMPANY_ID], company_id: COMPANY_ID, lang: "fr_FR" };
  const iso = (t = maintenant()) => new Date(t).toISOString();
  const ECRITURES = new Set(["create", "write", "unlink", "copy", "toggle_active", "action_archive", "send"]);

  // Odoo en lecture : toute méthode d'écriture est refusée ici (garde-fou)
  const lire = (model, method, args, kwargs = {}) => {
    if (ECRITURES.has(method)) throw new Error(`lecture Odoo : méthode d'écriture interdite (${model}.${method})`);
    return odooBrut(model, method, args, { ...kwargs, context: { ...CTX, ...(kwargs.context || {}) } });
  };
  // Odoo en écriture : SEULE porte d'écriture ; deux verrous ; seulement product.pricelist.item (et mail.mail pour les alertes).
  // Piste d'audit (règles de prix) : une ligne d'intention au journal AVANT l'appel (journal en panne → aucune écriture :
  // échec fermé), puis une ligne de résultat (ok, echec, incertain). trace : { passageId, acteur, cip, action, message, avant }.
  async function ecrireOdoo(reglages, pour, model, method, args, kwargs = {}, trace = null) {
    const v = verrous(reglages, env);
    const permis = pour === "creation" ? v.creation : v.retrait;
    if (!permis) throw Object.assign(new Error(`écriture Odoo refusée : ${!v.variable ? (v.contexte ? `déploiement « ${v.contexte} » (pas la production)` : "PEREMPTION_ODOO_ECRITURE absente") : `mode « ${MODES_LIBELLES[v.mode] || v.mode} »`}`), { code: "verrou" });
    const ok = (model === "product.pricelist.item" && ["create", "write", "unlink"].includes(method)) || (model === "mail.mail" && ["create", "send"].includes(method));
    if (!ok) throw new Error(`écriture Odoo non prévue : ${model}.${method}`);
    if (model === "product.pricelist.item" && method === "create" && (args?.[0] || []).some(x => Number(x?.pricelist_id) === LISTE_EXPORT)) throw new Error("liste 4 (Export) interdite");
    const appel = () => odooBrut(model, method, args, { ...kwargs, context: { ...CTX, ...(kwargs.context || {}) } });
    if (model !== "product.pricelist.item") return appel();
    const action = trace?.action || { create: "creer", write: "modifier", unlink: "retirer" }[method];
    const ids = method === "create" ? null : (Array.isArray(args?.[0]) ? args[0] : [args?.[0]]).map(Number);
    const vals = method === "create" ? (args?.[0] || []) : method === "write" ? args?.[1] : null;
    const une = (x) => (Array.isArray(x) && x.length === 1 ? x[0] : null);
    const base = { passage_id: trace?.passageId, acteur: trace?.acteur || "?", mode: reglages?.mode || "?", action, cip: trace?.cip || null,
      pricelist_id: method === "create" ? (une(vals)?.pricelist_id ?? null) : (trace?.pricelist_id ?? null), odoo_item_id: une(ids) };
    await journal({ ...base, avant: trace?.avant ?? null, apres: { appel: `${model}.${method}`, ids, valeurs: vals }, resultat: "en_cours",
      message: trace?.message || `écriture Odoo demandée (${method})` });
    try {
      const r = await appel();
      await journalSur({ ...base, apres: { appel: `${model}.${method}`, ids: method === "create" ? (Array.isArray(r) ? r : [r]) : ids }, resultat: "ok", message: `écriture Odoo faite (${method})` });
      return r;
    } catch (e) {
      const incertain = estIncertain(e);
      await journalSur({ ...base, apres: { appel: `${model}.${method}`, ids }, resultat: incertain ? "incertain" : "echec", message: `${incertain ? "réponse d'Odoo perdue" : "refusée par Odoo"} : ${court(e)}` });
      throw e;
    }
  }
  async function lireTout(model, domain, fields, page = 2000) {
    const out = [];
    for (let offset = 0; ; offset += page) {
      const rows = await lire(model, "search_read", [domain], { fields, limit: page, offset });
      out.push(...(rows || []));
      if (!rows || rows.length < page) return out;
    }
  }

  // ── Supabase (clé service_role : tables privées ; odoo_catalog, kv_store, configuration) ──
  async function sb(path, { method = "GET", body, prefer, anon = false } = {}) {
    const cle0 = cle || (anon ? env.SUPABASE_KEY : null);
    if (!cle0) throw Object.assign(new Error("SUPABASE_SERVICE_ROLE_KEY absente des variables Netlify"), { code: "configuration" });
    if (!url) throw Object.assign(new Error("SUPABASE_URL absente des variables Netlify"), { code: "configuration" });
    const headers = { apikey: cle0, Authorization: `Bearer ${cle0}`, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await http(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    if (!res.ok) {
      const pg = lireJson(text, {})?.code;
      throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} : HTTP ${res.status}${pg ? ` (${pg})` : ""}`), { status: res.status, pg });
    }
    return text ? JSON.parse(text) : null;
  }
  const doublon = (e) => e?.status === 409 || e?.pg === "23505";
  const tableAbsente = (e) => e?.pg === "42P01" || e?.status === 404 || e?.code === "configuration";

  // ── Journal (ajout seul) ──
  async function journal(lignes) {
    const rows = (Array.isArray(lignes) ? lignes : [lignes]).filter(Boolean).map(l => ({ at: iso(), passage_id: l.passage_id || null, acteur: String(l.acteur || "?").slice(0, 120),
      mode: l.mode || "simulation", action: l.action, cip: l.cip || null, pricelist_id: l.pricelist_id ?? null, odoo_item_id: l.odoo_item_id ?? null,
      avant: l.avant ?? null, apres: l.apres ?? null, resultat: l.resultat || "ok", message: l.message ? String(l.message).slice(0, 500) : null }));
    if (rows.length) await sb("peremption_journal", { method: "POST", prefer: "return=minimal", body: rows });
  }
  const journalSur = (l) => journal(l).catch(e => console.error("[peremption] journal :", court(e)));

  // ── Réglages et verrou de passage ──
  async function lireReglages() {
    const [r] = (await sb("peremption_reglages?id=eq.1&select=*")) || [];
    if (!r) throw Object.assign(new Error("peremption_reglages vide : exécuter sql/peremption.sql"), { code: "configuration" });
    return normaliserReglages(r);
  }
  // Verrou d'APPEL (pas de passage) : chaque invocation (etape, filet, nuit, réconcilier) tire un jeton ; seul ce jeton
  // prolonge le verrou. Deux « etape » simultanées sur un même passage ne s'exécutent donc jamais ensemble.
  async function prendreVerrou(passageId, appel = randomUUID()) {
    const t = maintenant();
    // valeurs entre guillemets dans or=(…) : « . » et « : » y sont réservés (PostgREST)
    const rows = await sb(`peremption_reglages?id=eq.1&or=${enc(`(verrou_jusqua.is.null,verrou_jusqua.lt."${iso(t)}",verrou_appel.eq."${appel}")`)}`,
      { method: "PATCH", prefer: "return=representation", body: { verrou_jusqua: iso(t + VERROU_MS), verrou_passage: passageId, verrou_appel: appel } });
    return Array.isArray(rows) && rows.length === 1;
  }
  async function rendreVerrou(appel) {
    await sb(`peremption_reglages?id=eq.1&verrou_appel=eq.${appel}`, { method: "PATCH", prefer: "return=minimal", body: { verrou_jusqua: null, verrou_passage: null, verrou_appel: null } }).catch(() => {});
  }
  async function quiTientLeVerrou() {
    const [r] = (await sb("peremption_reglages?id=eq.1&select=verrou_jusqua,verrou_passage").catch(() => [])) || [];
    if (!r?.verrou_passage || !(Date.parse(r.verrou_jusqua) > maintenant())) return null;
    const [p] = (await sb(`peremption_passages?id=eq.${r.verrou_passage}&select=id,acteur,debut`).catch(() => [])) || [];
    return { passage: r.verrou_passage, acteur: p?.acteur || "?", jusqua: r.verrou_jusqua };
  }

  // ── Catalogue du site ──
  const COLS_CAT = "cip,name,list_price,discounted_price,discount_pct,price_tiers,in_stock,available,earliest_expiry,lots,odoo_pid,odoo_tmpl_id,categ_id,updated_at";
  async function catalogueFenetre(t = maintenant()) {
    const { min, max } = fenetre(t);
    const rows = await sb(`odoo_catalog?select=${COLS_CAT}&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=gte.${min}&earliest_expiry=lte.${max}&order=earliest_expiry.asc&limit=1000`, { anon: true });
    return (Array.isArray(rows) ? rows : []).filter(r => r?.cip);
  }
  async function catalogueDe(cips) {
    if (!cips.length) return [];
    const out = [];
    for (let i = 0; i < cips.length; i += 150) out.push(...((await sb(`odoo_catalog?cip=in.${enc(liste(cips.slice(i, i + 150)))}&select=${COLS_CAT}`, { anon: true })) || []));
    return out;
  }

  // ── Exclusions (§ 4.1) : prix que le panier ne reprend pas d'Odoo ──
  async function exclusionsSite(cips) {
    const out = new Map(cips.map(c => [c, new Set()]));
    const ajoute = (cip, raison) => out.get(String(cip))?.add(raison);
    const [plan, promosRow, produits, campagnes, lj, sp] = await Promise.all([
      sb(`kv_store?key=eq.${enc(CLE_OUTILS)}&select=value`).then(r => lireJson(r?.[0]?.value, null)).catch(() => null),
      sb(`ec_config?key=eq.admin_promos&select=value`).then(r => lireJson(r?.[0]?.value, [])).catch(() => []),
      cips.length ? sb(`elixir_products?cip=in.${enc(liste(cips))}&select=cip,section`).catch(() => []) : [],
      sb("elixir_campaigns?active=eq.true&select=id,active").catch(() => []),
      sb(`kv_store?key=eq.lj:config&select=value`).then(r => lireJson(r?.[0]?.value, null)).catch(() => null),
      sb(`kv_store?key=like.${enc("sp:ord:")}*&select=value&limit=500`).catch(() => []),
    ]);
    for (const F of Object.values(FAUTEUILS)) {
      for (const c of Object.values(F.fallback)) ajoute(c, "multi_cip");
      for (const code of Object.values(F.codes)) for (const c of plan?.fauteuils?.[code] || []) ajoute(c, "multi_cip");
    }
    const menus = contexteMenus({ promos: Array.isArray(promosRow) ? promosRow : [], campagnes: Array.isArray(campagnes) ? campagnes : [] });
    for (const ps of menus.promos) for (const p of ps.produits) if (p?.cip) ajoute(p.cip, "menu_promo");
    for (const p of Array.isArray(produits) ? produits : []) if (menus.campagnes.has(String(p.section)) || p.section === "ulabs") ajoute(p.cip, "campagne");
    // justificatifs : configuration de l'admin (kv lj:config) et produits par défaut de _lab-justif.js (Takeda, Pfizer)
    for (const lab of Object.values(lj?.labs || {})) for (const p of lab?.produits || []) if (p?.cip) ajoute(p.cip, "justificatif");
    for (const lab of Object.values(LJ_DEFAUT.labs)) for (const p of lab.produits || []) if (p?.cip) ajoute(p.cip, "justificatif");
    for (const r of Array.isArray(sp) ? sp : []) for (const l of lireJson(r?.value, {})?.lignes || []) if (l?.code) ajoute(l.code, "sanofipro");
    return out;
  }

  // ── Faits frais (§ 4.1), lus dans Odoo pour des CIP ──
  // options : prix (rapport des listes), ventes (30 j par canal). → { faits: {cip: …}, absents: [cip], douteux, raison }
  let emplacementsExclus = null;   // { t, ids } gardé 1 h par instance
  async function exclusOdoo() {
    if (emplacementsExclus && maintenant() - emplacementsExclus.t < 3600e3) return emplacementsExclus.ids;
    const locs = await lire("stock.location", "search_read", [["|", ["do_not_export", "=", true], ["scrap_location", "=", true]]], { fields: ["id"] });
    emplacementsExclus = { t: maintenant(), ids: new Set((locs || []).map(l => l.id)) };
    return emplacementsExclus.ids;
  }
  async function lireFaits(cipsDemandes, { prix = true, ventes = true, listes = LISTES_DEFAUT } = {}) {
    const cips = [...new Set((cipsDemandes || []).map(String))].filter(c => /^\d{7,14}$/.test(c));
    const t = maintenant();
    if (!cips.length) return { faits: {}, absents: [], douteux: false };
    const prods = await lireTout("product.product", [["default_code", "in", cips]],
      ["id", "default_code", "name", "product_tmpl_id", "list_price", "standard_price", "product_variant_count"]);
    const parCip = new Map();
    for (const p of prods) (parCip.get(p.default_code) || parCip.set(p.default_code, []).get(p.default_code)).push(p);
    const fiche = new Map([...parCip].map(([c, l]) => [c, l.sort((a, b) => a.id - b.id)[0]]));
    const pids = [...fiche.values()].map(p => p.id);
    let quants = [], douteux = false, raison = null;
    const lotsParId = {};
    let exclus = new Set();
    try {
      exclus = await exclusOdoo();
      quants = pids.length ? await lireTout("stock.quant", [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"], ["product_id", "in", pids]],
        ["product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]) : [];
      const lotIds = [...new Set(quants.map(q => many2one(q.lot_id)).filter(Boolean))];
      for (let i = 0; i < lotIds.length; i += 500) for (const l of (await lire("stock.lot", "read", [lotIds.slice(i, i + 500), ["expiration_date"]])) || []) lotsParId[l.id] = l.expiration_date || null;
    } catch (e) { douteux = true; raison = `lecture du stock en échec : ${court(e)}`; }
    const prixParListe = {};
    if (prix && pids.length) {
      for (const l of listes) {
        prixParListe[l] = {};
        for (let i = 0; i < pids.length; i += PAR_APPEL_RAPPORT) {
          const html = await lire("report.product.report_pricelist", "get_html", [{ active_model: "product.product", active_ids: pids.slice(i, i + PAR_APPEL_RAPPORT),
            pricelist_id: l, quantities: [1], is_visible_title: false }]);
          Object.assign(prixParListe[l], lireRapport(html));
        }
      }
    }
    const ventesParPid = {};
    if (ventes && pids.length) {
      const depuis = versOdoo(t - 30 * 864e5);
      const lignes = await lireTout("sale.order.line", [["company_id", "=", COMPANY_ID], ["product_id", "in", pids], ["order_id.date_order", ">=", depuis],
        ["state", "in", ["sale", "done"]], ["product_uom_qty", ">", 0]], ["product_id", "product_uom_qty", "pml_order_ref"]);
      for (const x of lignes) {
        const v = (ventesParPid[many2one(x.product_id)] ||= { lgo: 0, site: 0, autre: 0 });
        v[canalVente(x.pml_order_ref)] += Number(x.product_uom_qty) || 0;
      }
    }
    const excl = await exclusionsSite(cips);
    const fen = fenetre(t);
    const faits = {};
    for (const cip of cips) {
      const p = fiche.get(cip);
      if (!p) continue;
      const qs = quants.filter(q => many2one(q.product_id) === p.id);
      const st = douteux ? { court_qte: 0, court_fin: null, long_qte: 0, long_debut: null, autre_qte: 0 } : classerStock(qs, lotsParId, exclus, fen);
      const ex = [...(excl.get(cip) || [])];
      if ((p.product_variant_count || 1) > 1) ex.push("variantes");
      if ((parCip.get(cip) || []).length > 1) ex.push("plusieurs_fiches");
      faits[cip] = { cip, odoo_pid: p.id, odoo_tmpl_id: many2one(p.product_tmpl_id), nom: String(p.name || "").replace(/^\[\d+\]\s*/, ""), lu_at: iso(t),
        list_price: num(p.list_price), cout: num(p.standard_price), ...st,
        prix_listes: prix ? Object.fromEntries(listes.map(l => [l, prixParListe[l]?.[p.id] ?? null])) : null,
        ventes_30j: ventes ? (ventesParPid[p.id] || { lgo: 0, site: 0, autre: 0 }) : null, exclusions: ex, ...(douteux ? { douteux: true } : {}) };
    }
    return { faits, absents: cips.filter(c => !faits[c]), douteux, raison };
  }
  // Faits enregistrés (ceux du passage, et les plus récents pour la page) ; un fait sans prix garde les prix de la veille
  async function enregistrerFaits(faits) {
    const rows = Object.values(faits).filter(f => !f.douteux);
    if (!rows.length) return;
    const anciens = new Map(((await sb(`peremption_faits?cip=in.${enc(liste(rows.map(r => r.cip)))}&select=cip,prix_listes,ventes_30j`).catch(() => [])) || []).map(r => [r.cip, r]));
    const corps = rows.map(f => ({ cip: f.cip, odoo_pid: f.odoo_pid, odoo_tmpl_id: f.odoo_tmpl_id, nom: f.nom, lu_at: f.lu_at, list_price: f.list_price, cout: f.cout,
      court_qte: f.court_qte, court_fin: f.court_fin, long_qte: f.long_qte, long_debut: f.long_debut, autre_qte: f.autre_qte,
      prix_listes: f.prix_listes ?? anciens.get(f.cip)?.prix_listes ?? null, ventes_30j: f.ventes_30j ?? anciens.get(f.cip)?.ventes_30j ?? null, exclusions: f.exclusions }));
    for (let i = 0; i < corps.length; i += 200) await sb("peremption_faits?on_conflict=cip", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: corps.slice(i, i + 200) });
  }

  // ── Décisions et règles ──
  async function decisionsOuvertes() { return (await sb(`peremption_decisions?statut=in.${enc(`(${OUVERTES.join(",")})`)}&select=*&order=decide_at.asc&limit=2000`)) || []; }
  async function reglesDe(decisionIds) {
    if (!decisionIds.length) return [];
    const out = [];
    for (let i = 0; i < decisionIds.length; i += 100) out.push(...((await sb(`peremption_regles?decision_id=in.${enc(`(${decisionIds.slice(i, i + 100).join(",")})`)}&select=*&order=created_at.asc&limit=5000`)) || []));
    return out;
  }
  async function majDecision(d, champs, { siStatut } = {}) {
    const filtre = siStatut ? `&statut=eq.${siStatut}` : "";
    const rows = await sb(`peremption_decisions?id=eq.${d.id}${filtre}`, { method: "PATCH", prefer: "return=representation", body: { ...champs, updated_at: iso() } });
    if (siStatut && !(Array.isArray(rows) && rows.length === 1)) return null;
    const nouv = rows?.[0] || { ...d, ...champs };
    Object.assign(d, nouv);
    return d;
  }
  const majRegle = (r, champs) => sb(`peremption_regles?id=eq.${r.id}`, { method: "PATCH", prefer: "return=minimal", body: champs }).then(() => Object.assign(r, champs));
  // mêmes champs sur plusieurs règles : un seul PATCH
  const majRegles = async (rs, champs) => {
    if (!rs.length) return;
    await sb(`peremption_regles?id=in.${enc(`(${rs.map(r => r.id).join(",")})`)}`, { method: "PATCH", prefer: "return=minimal", body: champs });
    rs.forEach(r => Object.assign(r, champs));
  };
  // champs différents par règle (identifiants, relectures) : un seul envoi (upsert des lignes complètes, clé id)
  const COLS_REGLE = ["id", "decision_id", "cip", "pricelist_id", "odoo_tmpl_id", "odoo_item_id", "operation_id", "date_start", "percent_price", "date_end", "statut",
    "verifiee_at", "prix_verifie", "instantane", "created_at", "retiree_at", "erreur", "cible"];
  const majReglesUne = async (paires) => {
    const ok = paires.filter(([r]) => r?.id);
    if (!ok.length) return;
    if (ok.length === 1) return majRegle(ok[0][0], ok[0][1]);
    const corps = ok.map(([r, c]) => Object.fromEntries(COLS_REGLE.filter(k => k in { ...r, ...c }).map(k => [k, k in c ? c[k] : r[k]])));
    await sb("peremption_regles?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: corps });
    ok.forEach(([r, c]) => Object.assign(r, c));
  };
  // prix habituel figé à la décision (liste n° 5) écrit sur le site par Supabase seul : repli quand Odoo ne répond pas
  // (étape A, « Tout retirer ») ; toujours ≥ au prix facturé (logique MIN d'Odoo), donc jamais en défaveur de la pharmacie
  async function prixHabituelSurSite(d, { acteur, mode, passageId, sansJournal = false } = {}) {
    const hab = num(lireJson(d.prix_habituel, {})?.[LISTE_SITE]);
    const lp = num(d.prix_base);
    if (!(hab > 0)) return false;
    const corps = lp > 0 && hab < lp - 0.004 ? { discounted_price: hab, discount_pct: Math.round((1 - hab / lp) * 1000) / 10 } : { discounted_price: null, discount_pct: 0 };
    await sb(`odoo_catalog?cip=eq.${enc(d.cip)}`, { method: "PATCH", prefer: "return=minimal", body: corps });
    const ligne = { passage_id: passageId, acteur, mode, action: "prix_site", cip: d.cip, apres: corps, resultat: "ok", message: `prix habituel figé à la décision (${eur(hab)}), écrit sans relire Odoo` };
    if (sansJournal) return ligne;
    await journalSur(ligne);
    return true;
  }
  // prix du site sans nos règles (étape A) ; Odoo injoignable → prix habituel figé, par Supabase
  async function prixSiteSansNous(d, ids, ctx) {
    const o = { acteur: ctx.acteur, mode: ctx.reglages?.mode, passageId: ctx.passageId };
    try {
      const r = await majPrixSite([d.cip], { sansRegles: ids, ...o });
      if (r[d.cip]?.ok) return true;
    } catch (e) { console.error("[peremption] prix du site (étape A) :", court(e)); }
    return prixHabituelSurSite(d, o).catch(() => false);
  }

  // ── Prix du site : recalcul ciblé (§ 9), règles de la liste n° 5 relues dans Odoo ──
  // sansRegles : identifiants Odoo exclus du calcul (nos règles à l'étape A d'un retrait, ou pendant une modification)
  async function prixSiteCalcule(cips, { sansRegles = [] } = {}) {
    const cat = await catalogueDe(cips);
    const out = {};
    const sans = new Set(sansRegles.map(Number));
    for (const c of cat) {
      const pid = Number(c.odoo_pid) || 0, tid = Number(c.odoo_tmpl_id) || 0, cid = Number(c.categ_id) || 0;
      const parentMap = {};
      const chaine = [];
      if (cid) {
        const [cat0] = (await lire("product.category", "read", [[cid], ["parent_path"]])) || [];
        const ids = String(cat0?.parent_path || `${cid}/`).split("/").map(Number).filter(Boolean);
        ids.forEach((id, i) => { parentMap[id] = i ? ids[i - 1] : 0; chaine.push(id); });
      }
      const dom = [["pricelist_id", "=", LISTE_SITE], "|", "|", ["product_id", "=", pid || -1], ["product_tmpl_id", "=", tid || -1], ["categ_id", "in", chaine.length ? chaine : [-1]]];
      const items = await lireTout("product.pricelist.item", dom, ["id", "applied_on", "compute_price", "fixed_price", "percent_price", "price_discount",
        "price_surcharge", "min_quantity", "product_id", "product_tmpl_id", "categ_id", "date_start", "date_end"]);
      // règles produit sans variante ciblée (1_product) et règles de variante : comme odoo-price-sync (pid d'abord)
      const regles = items.filter(it => !sans.has(it.id)).map(it => { const r = regleCompacte(it); if (it.applied_on === "1_product") r.pid = 0; return r; });
      out[c.cip] = { cat: c, prix: prixSite({ ...c, odoo_pid: pid, odoo_tmpl_id: tid, categ_id: cid }, regles, parentMap, jourUTC(maintenant())) };
    }
    return out;
  }
  // écriture du prix du site (odoo_catalog), puis relecture → { cip: { avant, apres, ok } }
  async function majPrixSite(cips, { sansRegles = [], acteur, mode, passageId, ecrire = true } = {}) {
    const calc = await prixSiteCalcule(cips, { sansRegles });
    const res = {};
    for (const [cip, { cat, prix }] of Object.entries(calc)) {
      if (!prix) { res[cip] = { ok: false, erreur: "prix de base nul" }; continue; }
      const avant = { discounted_price: num(cat.discounted_price), discount_pct: num(cat.discount_pct), price_tiers: cat.price_tiers ?? null };
      if (!ecrire) { res[cip] = { ok: true, simule: true, avant, apres: prix }; continue; }
      await sb(`odoo_catalog?cip=eq.${enc(cip)}`, { method: "PATCH", prefer: "return=minimal", body: prix });
      const [relu] = (await sb(`odoo_catalog?cip=eq.${enc(cip)}&select=cip,list_price,discounted_price,discount_pct`)) || [];
      const ok = relu && (num(relu.discounted_price) ?? null) === (prix.discounted_price ?? null);
      res[cip] = { ok: !!ok, avant, apres: prix, relu: relu ? prixAffiche(relu) : null };
      await journalSur({ passage_id: passageId, acteur, mode, action: "prix_site", cip, avant, apres: prix, resultat: ok ? "ok" : "echec",
        message: sansRegles.length ? "prix habituel (règles du site exclues du calcul)" : "prix d'Odoo (liste n° 5)" });
    }
    return res;
  }

  // ── Contrôle du prix facturé : rapport Odoo de chaque liste pour un produit ──
  async function prixFactures(pid, listes) {
    const out = {};
    for (const l of listes) {
      const html = await lire("report.product.report_pricelist", "get_html", [{ active_model: "product.product", active_ids: [pid], pricelist_id: l, quantities: [1], is_visible_title: false }]);
      out[l] = lireRapport(html)[pid] ?? null;
    }
    return out;
  }
  // une liste est conforme si : liste 5, prix = attendu au centime ; autre liste, prix ≤ attendu
  const prixConforme = (l, lu, attendu) => lu != null && attendu != null && (Number(l) === LISTE_SITE ? Math.abs(lu - attendu) < 0.005 : lu <= attendu + 0.005);

  // ── Commandes en cours (§ 5.4) : relais PharmaML, imports en attente, commandes du site pas encore envoyées ──
  // Échec fermé : une lecture en échec, ou une réponse qui atteint sa limite (lecture peut-être incomplète), lève une
  // erreur « commandes_illisibles » : l'étape B est alors reportée (jamais de suppression à l'aveugle).
  // Lectures : la file du relais (pmlr:file:<réf>, tâches « a_envoyer ») et les tâches (pmlr:tache:<réf>) mises à jour
  // depuis 48 h, les plus récentes d'abord (_relais.js ne supprime jamais les tâches : la table grossit à chaque envoi).
  const LIMITE_TACHES = 1000;
  async function commandesEnCours(cips) {
    const voulus = new Set(cips.map(String));
    const t = maintenant();
    const out = [];
    const illisible = (quoi) => Object.assign(new Error(`commandes en cours illisibles (${quoi}) : suppression reportée`), { code: "commandes_illisibles" });
    let file, recentes;
    try {
      [file, recentes] = await Promise.all([
        sb(`kv_store?key=like.${enc("pmlr:file:")}*&select=key,value&limit=${LIMITE_TACHES}`),
        sb(`kv_store?key=like.${enc("pmlr:tache:")}*&updated_at=gte.${enc(iso(t - COMMANDES_SITE_MS))}&select=key,value,updated_at&order=updated_at.desc&limit=${LIMITE_TACHES}`),
      ]);
    } catch (e) { throw illisible(court(e)); }
    if (!Array.isArray(file) || !Array.isArray(recentes) || file.length >= LIMITE_TACHES || recentes.length >= LIMITE_TACHES) throw illisible("trop de tâches");
    const parRef = new Map(recentes.map(r => [r.key.slice("pmlr:tache:".length), lireJson(r.value, null)]).filter(([, v]) => v));
    // tâches de la file plus anciennes que 48 h (encore à envoyer) : relues une à une par lot de clés
    const manquantes = file.map(f => String(f.key).slice("pmlr:file:".length)).filter(ref => ref && !parRef.has(ref));
    for (let i = 0; i < manquantes.length; i += 100) {
      let rows;
      try { rows = await sb(`kv_store?key=in.${enc(liste(manquantes.slice(i, i + 100).map(r => `pmlr:tache:${r}`)))}&select=key,value`); }
      catch (e) { throw illisible(court(e)); }
      for (const r of rows || []) { const v = lireJson(r.value, null); if (v) parRef.set(r.key.slice("pmlr:tache:".length), v); }
    }
    const taches = [...parRef.values()];
    const aVerifier = [];
    for (const x of taches) {
      if (x.source === "test") continue;
      const lignes = (x.corps?.[0]?.lignes || []).filter(l => voulus.has(String(l.CIP)));
      if (!lignes.length) continue;
      const enCours = ["a_envoyer", "prise", "incertaine"].includes(x.etat);
      const recente = x.etat === "envoyee" && t - Date.parse(x.renduA || x.creeA || 0) < ENVOI_RECENT_MS;
      if (enCours) out.push({ ref: x.ref, etat: x.etat, source: x.source || "site", pharmacie: x.pharmacie || null, cips: lignes.map(l => String(l.CIP)) });
      else if (recente) aVerifier.push({ ref: x.ref, etat: x.etat, source: x.source || "site", pharmacie: x.pharmacie || null, cips: lignes.map(l => String(l.CIP)) });
    }
    if (aVerifier.length) {
      const refs = aVerifier.map(a => a.ref);
      let vus;
      try { vus = new Set(((await lire("sale.order.line", "search_read", [[["pml_order_ref", "in", refs]]], { fields: ["pml_order_ref"], limit: 2000 })) || []).map(l => String(l.pml_order_ref))); }
      catch (e) { throw illisible(`import Odoo : ${court(e)}`); }
      for (const a of aVerifier) if (!vus.has(String(a.ref))) out.push({ ...a, etat: "import_en_attente" });
    }
    // commandes du site enregistrées (48 h) dont une ligne de ces CIP n'est ni envoyée ni traitée (synchro manuelle)
    const depuis = t - COMMANDES_SITE_MS;
    let cmds;
    try { cmds = (await sb(`elixir_orders?processed=eq.false&id=gte.${Math.floor(depuis)}&select=id,items,source,pharmacy_name&limit=500`)) || []; }
    catch (e) { throw illisible(`commandes du site : ${court(e)}`); }
    if (cmds.length >= 500) throw illisible("trop de commandes du site non traitées");
    for (const o of cmds) {
      if (["justificatif", "test"].includes(o.source)) continue;
      const its = Array.isArray(o.items) ? o.items : lireJson(o.items, []);
      const c = (its || []).filter(i => i && voulus.has(String(i.cip)) && !i.synced_at && !i.handled_at).map(i => String(i.cip));
      if (c.length) out.push({ ref: String(o.id), etat: "commande_non_envoyee", source: "site", pharmacie: o.pharmacy_name || null, cips: [...new Set(c)] });
    }
    return out;
  }

  // ── Alertes : journal toujours ; e-mail (Odoo mail.mail, comme le relais) seulement verrous ouverts, une par clé et 12 h ──
  // action « resume » (résumé de la nuit) : même envoi, hors du compteur des alertes de l'admin
  async function alerter({ cle: cleAlerte, sujet, texte, cip, reglages, acteur, passageId, action = "alerte" }) {
    const depuis = iso(maintenant() - 12 * 3600e3);
    const deja = await sb(`peremption_journal?action=eq.${action}&at=gte.${enc(depuis)}&message=eq.${enc(String(sujet).slice(0, 500))}&select=id&limit=1`).catch(() => []);
    if (deja?.length) return false;
    const v = verrous(reglages, env);
    let resultat = "simule", message = sujet;
    if (v.retrait) {
      try {
        const to = String(env.PEREMPTION_ALERTES || env.ADMIN_EMAIL || "pharmacien@elixirpharma.fr").split(/[\s,;]+/).filter(Boolean).join(", ");
        const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt"><p>Bonjour,</p><p>${esc(texte)}</p>
<p style="color:#64748b;font-size:9pt">Péremption courte (« Odoo facture la remise ») — admin du site de commande, onglet « Péremptions ».</p></div>`;
        const id = await ecrireOdoo(reglages, "retrait", "mail.mail", "create", [{ subject: `[Péremptions] ${sujet}`, body_html: corps, email_from: env.LJ_MAIL_FROM || "pharmacien@elixirpharma.fr", email_to: to, auto_delete: false }]);
        await ecrireOdoo(reglages, "retrait", "mail.mail", "send", [[id]]);
        resultat = "ok";
      } catch (e) { resultat = "echec"; message = `${sujet} (e-mail non envoyé : ${court(e)})`; }
    }
    await journalSur({ passage_id: passageId, acteur, mode: reglages.mode, action, cip, apres: { cle: cleAlerte, texte }, resultat, message });
    return true;
  }

  // Cible d'une remise pour une décision existante : prix des listes figés à la décision (le rapport d'Odoo donne
  // désormais NOTRE prix ; base « prix habituel liste 5 » : le prix habituel, pas le prix remisé)
  // (base de la remise : celle de la décision, même si le réglage a changé depuis)
  const cibleDecision = (d, f, remise, R) => cibleRemise({ ...f, prix_listes: { ...(f?.prix_listes || {}), ...(lireJson(d.prix_habituel, null) || {}) } }, remise,
    { ...R, base_remise: lireJson(d.apercu, {})?.base || R.base_remise });
  const vivantesDe = async (d) => (await reglesDe([d.id])).filter(r => VIVANTES.includes(r.statut));
  const idsDe = (rs) => rs.map(r => r.odoo_item_id).filter(Boolean).map(Number);

  // ── Écriture d'une valeur sur nos règles (percent_price, date_end), avec intention enregistrée AVANT l'écriture Odoo ──
  // 1. règles : cible = valeurs visées (échec Supabase → aucune écriture Odoo) ; 2. write Odoo (journal d'intention puis de
  // résultat) ; 3. finalisation (valeurs enregistrées, cible effacée). Réponse perdue : relecture ; issue mêlée : la cible
  // reste, la relecture du passage suivant tranche (issueCible). Une coupure entre 2 et 3 ne fait donc jamais prendre notre
  // propre écriture pour une modification faite à la main dans Odoo.
  async function ecrireSurRegles(d, regles, champs, ctx, pour, message) {
    const { reglages: R, acteur, passageId } = ctx;
    const odooVals = { ...champs, ...(champs.date_end ? { date_end: versOdoo(champs.date_end) } : {}) };
    const ids = idsDe(regles);
    await majRegles(regles, { cible: { ...champs, at: iso() }, verifiee_at: null });
    try {
      await ecrireOdoo(R, pour, "product.pricelist.item", "write", [ids, odooVals], {}, { passageId, acteur, cip: d.cip, action: "modifier", message,
        avant: regles.map(r => ({ id: r.odoo_item_id, liste: r.pricelist_id, percent_price: Number(r.percent_price), date_end: r.date_end })) });
    } catch (e) {
      if (e.code === "verrou") { await majRegles(regles, { cible: null }).catch(() => {}); throw e; }
      if (!estIncertain(e)) { await majRegles(regles, { cible: null }).catch(() => {}); throw e; }
      // réponse perdue : la règle dit si l'écriture a eu lieu
      const lus = await lire("product.pricelist.item", "read", [ids, CHAMPS_REGLE]).catch(() => null);
      const parId = new Map((lus || []).map(x => [x.id, x]));
      const issues = regles.map(r => issueCible(parId.get(Number(r.odoo_item_id)), r));
      if (!lus || issues.some(x => !x || x.cible !== null || !("percent_price" in x || "date_end" in x))) throw e;   // pas toutes écrites : on attend
    }
    await majRegles(regles, { ...champs, cible: null });
  }
  // Relecture : écritures du site interrompues → enregistrées (Odoo a la valeur visée) ou abandonnées (Odoo a l'ancienne) ;
  // modification de la décision (remise) enregistrée quand ses règles ont toutes la nouvelle valeur → true si la décision change
  async function resoudreEcritures(d, regles, parId) {
    const paires = [];
    for (const r of regles) { const x = issueCible(parId.get(Number(r.odoo_item_id)), r); if (x) paires.push([r, x]); }
    if (paires.length) await majReglesUne(paires);
    const m = lireJson(d.modification, null);
    if (!m?.ecriture_at || !regles.length) return false;
    const pcts = regles.filter(r => r.statut === "active").map(r => Number(r.percent_price));
    if (regles.some(r => r.cible)) return false;
    if (pcts.length && pcts.every(p => Math.abs(p - Number(m.percent_price)) < 1e-6)) {
      await majDecision(d, { remise_pct: m.remise, percent_price: m.percent_price, prix_attendu: m.prix_attendu, sous_cout_confirme: !!m.sous_cout, modification: null, essais: 0 });
      return true;
    }
    if (pcts.length && pcts.every(p => Math.abs(p - Number(d.percent_price)) < 1e-6)) { await majDecision(d, { modification: null }); return true; }
    return false;
  }

  // ── Décision close qui porte encore des règles vivantes : rouverte en retrait immédiat, alerte ──
  async function rouvrirOrpheline(d, ctx, cause) {
    const { reglages: R, acteur, passageId } = ctx;
    const regles = await vivantesDe(d);
    if (!regles.length || OUVERTES.includes(d.statut) && d.statut === "retrait_demande") return false;
    let ok = null;
    try {
      ok = await majDecision(d, { statut: "retrait_demande", raison_fin: "regle_orpheline", retrait_immediat: true, cachee_at: iso(), retiree_at: null, modification: null, essais: 0 }, { siStatut: d.statut });
    } catch (e) { if (!doublon(e)) throw e; }
    if (!ok) {   // une autre décision est ouverte sur ce CIP : on ne peut pas rouvrir, alerte seulement
      await alerter({ cle: `orpheline:${d.id}`, sujet: `Règles du site sans décision ouverte : ${d.nom || d.cip}`, texte: `Les règles Odoo n° ${idsDe(regles).join(", ") || "(réservées)"} posées par le site pour ${d.nom || d.cip} (CIP ${d.cip}) appartiennent à une décision close (${cause}) et une autre décision est ouverte sur ce produit. Le site ne peut pas les retirer seul : « Retirer » le produit dans l'admin, puis vérifier dans Odoo.`, cip: d.cip, reglages: R, acteur, passageId });
      return false;
    }
    await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "cacher", cip: d.cip, apres: { raison: "regle_orpheline", regles: idsDe(regles) }, resultat: "ok", message: `décision close (${cause}) qui portait encore ${regles.length} règle(s) : rouverte pour les supprimer` });
    await prixSiteSansNous(d, idsDe(regles), ctx);
    await alerter({ cle: `orpheline:${d.id}`, sujet: `Règles du site retrouvées sous une décision close : ${d.nom || d.cip}`, texte: `${regles.length} règle(s) Odoo posée(s) par le site pour ${d.nom || d.cip} (CIP ${d.cip}) restaient sous une décision close (${cause}). La page n'annonce pas la remise ; la décision est rouverte et ses règles sont supprimées dans Odoo tout de suite.`, cip: d.cip, reglages: R, acteur, passageId });
    return true;
  }
  // Balayage (chaque passage, et avant « Tout retirer ») : toute règle vivante dont la décision n'est plus ouverte
  async function balayerOrphelines(ctx) {
    const vivantes = (await sb(`peremption_regles?statut=in.${enc(`(${VIVANTES.join(",")})`)}&select=id,decision_id&limit=5000`)) || [];
    if (!vivantes.length) return 0;
    const ouvertes = new Set((await decisionsOuvertes()).map(d => d.id));
    const closes = [...new Set(vivantes.filter(r => !ouvertes.has(r.decision_id)).map(r => r.decision_id))];
    let n = 0;
    for (let i = 0; i < closes.length; i += 100) {
      const ds = (await sb(`peremption_decisions?id=in.${enc(`(${closes.slice(i, i + 100).join(",")})`)}&select=*`)) || [];
      for (const d of ds) if (await rouvrirOrpheline(d, ctx, RAISONS_FIN[d.raison_fin] || d.raison_fin || d.statut)) n++;
    }
    return n;
  }
  // Après une écriture conditionnelle perdue (« Retirer » ou « Tout retirer » passé pendant la création) : la décision a
  // changé ; ses règles existent → prix du site sans nos règles, et décision close rouverte pour retrait
  async function apresConcurrence(d, ctx) {
    const [lu] = (await sb(`peremption_decisions?id=eq.${d.id}&select=*`)) || [];
    if (lu) Object.assign(d, lu);
    const regles = await vivantesDe(d);
    if (d.statut === "retrait_demande" && regles.length) await prixSiteSansNous(d, idsDe(regles), ctx);
    else if (!OUVERTES.includes(d.statut) && regles.length) await rouvrirOrpheline(d, ctx, `décision « ${d.statut} » pendant la création`);
    await journalSur({ passage_id: ctx.passageId, acteur: ctx.acteur, mode: ctx.reglages.mode, action: "decision", cip: d.cip, apres: { statut: d.statut }, resultat: "ignore", message: `décision changée pendant le passage (« ${d.statut} ») : ce passage n'y touche plus` });
    return { statut: d.statut, concurrent: true };
  }

  // ── Création des règles (§ 5.2) d'une décision, sur les listes qui n'en ont pas ──
  // → { statut, simule?, perime?, refus? } ; décision mise à jour (facturee | partielle | erreur | retiree si refusée).
  // Garde : seulement une décision « voulue » ou « partielle » (un « Retirer » ou « Tout retirer » passé entre-temps gagne).
  async function creerRegles(d, f, ctx) {
    const { reglages: R, acteur, passageId, apercu } = ctx;
    const mode = R.mode;
    const m = lireJson(d.modification, null);
    if (!["voulue", "partielle"].includes(d.statut) || (m?.baisse && !m.ecriture_at)) {
      await journalSur({ passage_id: passageId, acteur, mode, action: "creer", cip: d.cip, resultat: "ignore", message: `élément périmé : décision « ${d.statut} »${m?.baisse ? " (baisse en attente)" : ""}, rien créé` });
      return { statut: d.statut, perime: true };
    }
    const regles = await reglesDe([d.id]);
    const dejaRegles = regles.some(r => VIVANTES.includes(r.statut));
    // plafond des produits facturés : seulement pour une première création, compté sous le verrou sur toutes les autres
    // décisions ouvertes qui portent (ou vont porter) des règles
    const autres = dejaRegles || d.statut === "partielle" ? null : (await decisionsOuvertes()).filter(x => x.id !== d.id && !x.simulee && PORTEUSES.includes(x.statut)).length;
    const premiere = d.statut === "voulue" && !dejaRegles;
    const el = eligibilite(f, R, maintenant(), { remise: d.remise_pct, force: d.force_lot_long ? d.long_qte_accepte : null, sousCout: d.sous_cout_confirme,
      decision: !premiere, nbFacturees: autres, habituels: lireJson(d.prix_habituel, null), controleFin: premiere });
    if (!el.ok) {
      const texte = el.raisons.map(r => r.texte).join(" ; ");
      await journalSur({ passage_id: passageId, acteur, mode, action: "refus", cip: d.cip, avant: { decision: d.id }, resultat: "echec", message: texte });
      if (dejaRegles) {   // déjà des règles : on retire proprement (étape A, puis B)
        await cacher(d, "refus", ctx);
        return { statut: d.statut, refus: el.raisons };
      }
      await majDecision(d, { statut: "retiree", raison_fin: "refus", retiree_at: iso(), erreur: texte.slice(0, 300) }, { siStatut: d.statut });
      return { statut: "retiree", refus: el.raisons };
    }
    const cible = el.cible;
    const attendus = prixAttendus(lireJson(d.prix_habituel, {}), cible.prix_vise, R.listes);
    // empreinte de l'aperçu : seulement avant la toute première création (ensuite, les prix relus portent NOTRE remise)
    if (apercu && premiere && apercu !== empreinteApercu(d.cip, d.remise_pct, cible, finRegle(f.court_fin), attendus, f)) {
      await majDecision(d, { statut: "retiree", raison_fin: "refus", retiree_at: iso(), erreur: "l'aperçu a changé, revoir" }, { siStatut: d.statut });
      await journalSur({ passage_id: passageId, acteur, mode, action: "refus", cip: d.cip, resultat: "echec", message: "l'aperçu a changé (prix, date ou stock) : rien créé, refaire l'aperçu" });
      return { statut: "retiree", refus: [{ code: "apercu", texte: "l'aperçu a changé, revoir" }] };
    }
    const vivantes = new Map(regles.filter(r => VIVANTES.includes(r.statut)).map(r => [Number(r.pricelist_id), r]));
    const manquantes = R.listes.filter(l => !vivantes.has(Number(l)));
    const fin = d.date_fin_regle;
    // simulation (ou verrous fermés) : le plan seul, journalisé
    if (d.simulee || (manquantes.length && !verrous(R, env).creation)) {
      const t0 = Math.floor(maintenant() / 1000) * 1000 - AVANCE_DEBUT_MS;
      await journalSur(manquantes.map(l => ({ passage_id: passageId, acteur, mode, action: "creer", cip: d.cip, pricelist_id: l, resultat: "simule",
        apres: valeursRegle({ liste: l, tmpl: d.odoo_tmpl_id, percent: Number(d.percent_price), debut: t0, fin }),
        message: `${nomListe(l)} : ${eur(f.prix_listes?.[l])} → ${eur(attendus[l])}` })));
      return { statut: d.statut, simule: true, manquantes };
    }
    if (ctx.budgetRegles != null && manquantes.length > ctx.budgetRegles.reste) return { statut: d.statut, reporte: "plafond de règles du passage" };
    // 1. réservation (index unique : une règle vivante par CIP et par liste)
    const creees = [];
    if (manquantes.length) {
      const operation = randomUUID();
      const debut = Math.floor(maintenant() / 1000) * 1000 - AVANCE_DEBUT_MS;
      let reservees;
      try {
        reservees = await sb("peremption_regles", { method: "POST", prefer: "return=representation", body: manquantes.map(l => ({ decision_id: d.id, cip: d.cip, pricelist_id: l,
          odoo_tmpl_id: d.odoo_tmpl_id, operation_id: operation, date_start: iso(debut), percent_price: Number(d.percent_price), date_end: fin, statut: "reservee" })) });
      } catch (e) {
        if (doublon(e)) return { statut: d.statut, reporte: "règle déjà réservée par un autre passage" };
        throw e;
      }
      if (ctx.budgetRegles) ctx.budgetRegles.reste -= manquantes.length;
      const vals = reservees.map(r => valeursRegle({ liste: Number(r.pricelist_id), tmpl: d.odoo_tmpl_id, percent: Number(d.percent_price), debut, fin }));
      // 2. création : les listes en un appel ; refus d'Odoo → liste par liste (échec partiel) ; pas de réponse → réservations
      // gardées (adoptées au passage suivant si Odoo les a créées)
      const trace = { passageId, acteur, cip: d.cip, action: "creer" };
      const poser = async (rs, vs) => {
        const ids = await ecrireOdoo(R, "creation", "product.pricelist.item", "create", [vs], {}, { ...trace, message: `création : ${vs.map(v => `${nomListe(v.pricelist_id)} −${String(v.percent_price).replace(".", ",")} %`).join(", ")}` });
        const liste_ids = Array.isArray(ids) ? ids : [ids];
        if (liste_ids.length !== rs.length) throw Object.assign(new Error(`Odoo a renvoyé ${liste_ids.length} identifiant(s) pour ${rs.length} règle(s)`), { incertain: true });
        rs.forEach((r, i) => creees.push({ r, v: vs[i], id: liste_ids[i] }));
      };
      try { await poser(reservees, vals); }
      catch (e) {
        if (e.code === "verrou") throw e;
        if (estIncertain(e)) {
          await majDecision(d, { erreur: `création incertaine : ${court(e)}`, essais: (d.essais || 0) + 1 });
          return { statut: d.statut, incertain: true };
        }
        for (let i = 0; i < reservees.length; i++) {
          try { await poser([reservees[i]], [vals[i]]); }
          catch (e2) {
            if (e2.code === "verrou") throw e2;
            // délai dépassé ou coupure : la règle a pu naître → réservation gardée (adoption) ; refus certain d'Odoo → échec
            if (estIncertain(e2)) continue;
            await majRegle(reservees[i], { statut: "echec", erreur: court(e2) });
          }
        }
      }
      // 3. identifiants enregistrés en un envoi (une coupure ici : réservations sans identifiant, adoptées par date_start)
      await majReglesUne(creees.map(c => [c.r, { odoo_item_id: c.id, statut: "active" }]));
    }
    // 4. relecture et contrôle du prix facturé, sur toutes nos règles actives de la décision
    return verifierDecision(d, f, { ...ctx, attendus });
  }

  // Relecture des règles d'une décision et contrôle du prix facturé par le rapport, puis prix du site → statut.
  // Le prix du site ne reprend NOS règles que si les 6 listes sont conformes ; sinon il garde le prix habituel (toujours ≥
  // au prix facturé, logique MIN) : jamais d'écart en défaveur d'une liste où la remise a échoué.
  async function verifierDecision(d, f, ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    const mode = R.mode;
    const statutLu = d.statut;
    const toutes = await vivantesDe(d);
    const regles = toutes.filter(r => r.statut === "active" && r.odoo_item_id);
    const lus = regles.length ? await lire("product.pricelist.item", "read", [regles.map(r => Number(r.odoo_item_id)), CHAMPS_REGLE]) : [];
    const parId = new Map((lus || []).map(x => [x.id, x]));
    const change = await resoudreEcritures(d, regles, parId);
    const attendus = !change && ctx.attendus ? ctx.attendus : lireJson(d.prix_attendu, {});
    const factures = await prixFactures(d.odoo_pid, R.listes);
    const problemes = [];
    if (lireJson(d.modification, null)?.ecriture_at) problemes.push("modification de la remise en cours dans Odoo (relue au passage suivant)");
    const majs = [], lignes = [];
    for (const r of regles) {
      const lu = parId.get(Number(r.odoo_item_id));
      if (!lu) { problemes.push(`${nomListe(r.pricelist_id)} : règle introuvable dans Odoo`); continue; }
      const ec = ecartsValeurs(lu, { pricelist_id: Number(r.pricelist_id), product_tmpl_id: Number(r.odoo_tmpl_id), percent_price: Number(r.percent_price), date_start: r.date_start, date_end: r.date_end, cible: r.cible });
      if (ec.length) { problemes.push(`${nomListe(r.pricelist_id)} : ${ec.join(", ")} différent(s) à la relecture`); continue; }
      const p = factures[r.pricelist_id];
      const att = num(attendus[r.pricelist_id]);
      const conforme = prixConforme(r.pricelist_id, p, att);
      majs.push([r, { instantane: lu, verifiee_at: conforme ? iso() : null, prix_verifie: p }]);
      lignes.push({ passage_id: passageId, acteur, mode, action: "controler", cip: d.cip, pricelist_id: r.pricelist_id, odoo_item_id: r.odoo_item_id,
        apres: { prix_facture: p, prix_attendu: att }, resultat: conforme ? "ok" : "echec", message: `${nomListe(r.pricelist_id)} : facturé ${eur(p)}, attendu ${eur(att)}` });
      if (!conforme) problemes.push(`${nomListe(r.pricelist_id)} : facturé ${eur(p)} au lieu de ${eur(att)}`);
    }
    await majReglesUne(majs);
    await journalSur(lignes);
    const couvertes = new Set(regles.map(r => Number(r.pricelist_id)));
    for (const l of R.listes) if (!couvertes.has(Number(l))) problemes.push(`${nomListe(l)} : aucune règle active`);
    // prix du site : repris d'Odoo (nos règles comprises) seulement si tout est conforme ; relu
    if (!problemes.length) {
      const site = await majPrixSite([d.cip], { acteur, mode, passageId });
      const siteOk = site[d.cip]?.ok && Math.abs((site[d.cip]?.relu ?? -1) - (factures[LISTE_SITE] ?? -2)) < 0.005;
      if (!siteOk) problemes.push(`prix du site : ${eur(site[d.cip]?.relu)} au lieu de ${eur(factures[LISTE_SITE])}`);
    }
    if (problemes.length) await prixSiteSansNous(d, idsDe(toutes), ctx);
    if (!problemes.length) {
      if (!(await majDecision(d, { statut: "facturee", facturee_at: d.facturee_at || iso(), prix_attendu: attendus, erreur: null, essais: 0 }, { siStatut: statutLu }))) return apresConcurrence(d, ctx);
      await journalSur({ passage_id: passageId, acteur, mode, action: "decision", cip: d.cip, apres: { statut: "facturee", prix: factures }, resultat: "ok", message: `facturé par Odoo sur les ${R.listes.length} listes : la page annonce la remise de ${d.remise_pct} %` });
      return { statut: "facturee", prix: factures };
    }
    const essais = (d.essais || 0) + 1;
    const statut = essais >= ESSAIS_MAX ? "erreur" : "partielle";
    if (!(await majDecision(d, { statut, prix_attendu: attendus, essais, erreur: problemes.join(" ; ").slice(0, 300) }, { siStatut: statutLu }))) return apresConcurrence(d, ctx);
    await journalSur({ passage_id: passageId, acteur, mode, action: "decision", cip: d.cip, apres: { statut }, resultat: "echec", message: `${statut === "erreur" ? "erreur" : "partielle"} : ${problemes.join(" ; ")} (remise non facturée : le site garde le prix habituel, la page Péremption affiche la remise de la colonne Page)` });
    if (statut === "erreur") await alerter({ cle: `erreur:${d.id}`, sujet: `Échec de création : ${d.nom || d.cip}`, texte: `La remise de ${d.remise_pct} % sur ${d.nom || d.cip} (CIP ${d.cip}) n'a pas pu être posée dans Odoo après ${essais} essais : ${problemes.join(" ; ")}. Elle n'est pas facturée : le site garde le prix habituel et la page Péremption affiche la remise de la colonne Page (−50 % par défaut), non facturée (écarts à rectifier). Dans l'admin : « Réessayer » ou « Retirer ».`, cip: d.cip, reglages: R, acteur, passageId });
    return { statut, problemes };
  }

  // ── Modification (§ 5.3) : nouvelle remise sur un produit déjà remisé ──
  // Hausse de la remise (prix plus bas) : écriture tout de suite (Odoo facture moins que le site entre-temps). Baisse
  // (prix plus haut) : traitée comme un retrait partiel → étape A (la page cesse d'annoncer, le site reprend le prix
  // habituel, décision « voulue » avec la baisse en attente), puis l'écriture dans Odoo au passage suivant, après le délai
  // des réglages et l'import des commandes en cours (élément « baisser »).
  async function modifierRemise(d, f, nouvelle, ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    const mode = R.mode;
    if (!["voulue", "partielle", "facturee"].includes(d.statut)) return { statut: d.statut, perime: true };
    const ancienne = d.remise_pct;
    const cible = cibleDecision(d, f, nouvelle, R);
    if (!cible) return { refus: [{ code: "prix", texte: "prix illisible" }] };
    const attendus = prixAttendus(lireJson(d.prix_habituel, {}), cible.prix_vise, R.listes);
    const regles = (await reglesDe([d.id])).filter(r => r.statut === "active" && r.odoo_item_id);
    if (!verrous(R, env).creation || d.simulee) {
      await journalSur(regles.map(r => ({ passage_id: passageId, acteur, mode, action: "modifier", cip: d.cip, pricelist_id: r.pricelist_id, odoo_item_id: r.odoo_item_id,
        avant: { percent_price: Number(r.percent_price) }, apres: { percent_price: cible.percent_price }, resultat: "simule", message: `${nomListe(r.pricelist_id)} : remise ${String(r.percent_price).replace(".", ",")} % → ${String(cible.percent_price).replace(".", ",")} %` })));
      if (d.simulee) await majDecision(d, { remise_pct: nouvelle, percent_price: cible.percent_price, prix_attendu: attendus, sous_cout_confirme: !!ctx.sousCout });
      await journalSur({ passage_id: passageId, acteur, mode, action: "modifier", cip: d.cip, avant: { remise_pct: ancienne }, apres: { remise_pct: nouvelle }, resultat: "simule", message: `remise ${ancienne} % → ${nouvelle} % (simulée)` });
      return { statut: d.statut, simule: true };
    }
    const lus = await lire("product.pricelist.item", "read", [regles.map(r => Number(r.odoo_item_id)), CHAMPS_REGLE]);
    const parId = new Map((lus || []).map(x => [x.id, x]));
    await resoudreEcritures(d, regles, parId);
    for (const r of regles) {
      const lu = parId.get(Number(r.odoo_item_id));
      if (!lu) { await majRegle(r, { statut: "retiree", retiree_at: iso(), erreur: "supprimée dans Odoo" }); continue; }
      const ec = ecartsIdentite(lu, r);
      if (ec.length) { await marquerModifiee(d, r, ec, lu, ctx); return { statut: "modifiee_odoo" }; }
    }
    const vivantes = regles.filter(r => r.statut === "active");
    const m = { remise: nouvelle, percent_price: cible.percent_price, prix_attendu: attendus, sous_cout: !!ctx.sousCout, demandee_at: iso() };
    const pctActuel = Number(d.percent_price);
    if (cible.percent_price < pctActuel - 1e-6) {
      // BAISSE : étape A maintenant, écriture dans Odoo plus tard (élément « baisser »)
      const avant = lireJson(d.modification, null);
      const ok = await majDecision(d, { statut: "voulue", modification: { ...m, baisse: true, demandee_at: avant?.baisse ? avant.demandee_at : m.demandee_at } }, { siStatut: d.statut });
      if (!ok) return apresConcurrence(d, ctx);
      await journalSur({ passage_id: passageId, acteur, mode, action: "cacher", cip: d.cip, avant: { remise_pct: ancienne }, apres: { remise_pct: nouvelle }, resultat: "ok",
        message: `baisse ${ancienne} % → ${nouvelle} % : la remise facturée n'est plus annoncée, la page reprend la remise affichée (colonne Page) ; écriture dans Odoo après ${R.delai_retrait_min} min et l'import des commandes en cours` });
      await prixSiteSansNous(d, idsDe(regles), ctx);
      return { statut: "voulue", baisse: true };
    }
    if (Math.abs(cible.percent_price - pctActuel) < 1e-6) {
      // même pourcentage qu'Odoo (annulation d'une baisse en attente) : rien à écrire, relecture puis réaffichage
      if (!(await majDecision(d, { statut: "partielle", modification: null, remise_pct: nouvelle }, { siStatut: d.statut }))) return apresConcurrence(d, ctx);
      return creerRegles(d, f, { ...ctx, apercu: null });
    }
    // HAUSSE : écriture tout de suite (prix plus bas : en faveur de la pharmacie jusqu'au prix du site)
    if (!(await majDecision(d, { statut: "partielle", modification: { ...m, ecriture_at: iso() } }, { siStatut: d.statut }))) return apresConcurrence(d, ctx);
    await ecrireSurRegles(d, vivantes, { percent_price: cible.percent_price }, ctx, "creation", `remise ${ancienne} % → ${nouvelle} % (${String(pctActuel).replace(".", ",")} % → ${String(cible.percent_price).replace(".", ",")} % sur le prix de base)`);
    await majDecision(d, { remise_pct: nouvelle, percent_price: cible.percent_price, prix_attendu: attendus, sous_cout_confirme: !!ctx.sousCout, modification: null, essais: 0 });
    return creerRegles(d, f, { ...ctx, apercu: null });   // listes manquantes éventuelles, puis relecture, contrôle, prix du site
  }
  // Baisse en attente (décision « voulue », modification.baisse) : écriture après le délai et les commandes en cours
  async function baisserRemise(d, f, ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    const m = lireJson(d.modification, null);
    if (d.statut !== "voulue" || !m?.baisse || m.ecriture_at) return { statut: d.statut, perime: true };
    const t = maintenant();
    const depuis = Date.parse(m.demandee_at || 0);
    if (t - depuis < R.delai_retrait_min * 60e3) return { statut: d.statut, reporte: "délai" };
    let cmds;
    try { cmds = (ctx.enCours || await commandesEnCours([d.cip])).filter(c => c.cips.includes(d.cip)); }
    catch (e) { await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "modifier", cip: d.cip, resultat: "reporte", message: court(e) }); return { statut: d.statut, reporte: "commandes" }; }
    if (cmds.length && t - depuis < ATTENTE_COMMANDES_MAX_MS) {
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "modifier", cip: d.cip, resultat: "reporte", message: `baisse reportée : commandes en cours d'import ${cmds.map(c => `${c.ref} (${c.etat})`).join(", ")}` });
      return { statut: d.statut, reporte: "commandes" };
    }
    if (cmds.length) await alerter({ cle: `baisse:${d.id}`, sujet: `Baisse de remise après 24 h d'attente : ${d.nom || d.cip}`, texte: `La remise sur ${d.nom || d.cip} (CIP ${d.cip}) passe de ${d.remise_pct} % à ${m.remise} % dans Odoo malgré des commandes pas encore importées : ${cmds.map(c => `${c.ref} (${c.etat})`).join(", ")}. Vérifier leurs lignes à l'import.`, cip: d.cip, reglages: R, acteur, passageId });
    const regles = (await reglesDe([d.id])).filter(r => r.statut === "active" && r.odoo_item_id);
    if (!verrous(R, env).retrait) {
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "modifier", cip: d.cip, resultat: "simule", message: `baisse ${d.remise_pct} % → ${m.remise} % simulée (verrous fermés)` });
      return { statut: d.statut, simule: true };
    }
    const lus = await lire("product.pricelist.item", "read", [regles.map(r => Number(r.odoo_item_id)), CHAMPS_REGLE]);
    const parId = new Map((lus || []).map(x => [x.id, x]));
    await resoudreEcritures(d, regles, parId);
    for (const r of regles) {
      const lu = parId.get(Number(r.odoo_item_id));
      if (!lu) { await majRegle(r, { statut: "retiree", retiree_at: iso(), erreur: "supprimée dans Odoo" }); continue; }
      const ec = ecartsIdentite(lu, r);
      if (ec.length) { await marquerModifiee(d, r, ec, lu, ctx); return { statut: "modifiee_odoo" }; }
    }
    if (!(await majDecision(d, { statut: "partielle", modification: { ...m, ecriture_at: iso() } }, { siStatut: "voulue" }))) return apresConcurrence(d, ctx);
    const ancienne = d.remise_pct;
    // une baisse remonte le prix : sens sûr pour Elixir, permise aussi en « Créations suspendues » (comme un retrait)
    await ecrireSurRegles(d, regles.filter(r => r.statut === "active"), { percent_price: m.percent_price }, ctx, "retrait", `baisse ${ancienne} % → ${m.remise} %`);
    await majDecision(d, { remise_pct: m.remise, percent_price: m.percent_price, prix_attendu: m.prix_attendu, sous_cout_confirme: !!m.sous_cout, modification: null, essais: 0 });
    return creerRegles(d, f, { ...ctx, apercu: null });
  }
  // date de fin (§ 5.3 point 5) : un autre lot court devient le plus proche
  async function modifierFin(d, f, ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    if (!["facturee", "partielle"].includes(d.statut)) return;
    const fin = finRegle(f.court_fin);
    const regles = (await reglesDe([d.id])).filter(r => r.statut === "active" && r.odoo_item_id);
    if (!verrous(R, env).retrait || d.simulee || !regles.length) {
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "modifier", cip: d.cip, avant: { date_end: d.date_fin_regle }, apres: { date_end: fin }, resultat: d.simulee ? "simule" : regles.length ? "simule" : "ignore", message: `date de fin : ${dateParis(d.date_fin_regle)} → ${dateParis(fin)}` });
      if (d.simulee || !regles.length) await majDecision(d, { lot_court_fin: f.court_fin, date_fin_regle: fin });
      return;
    }
    const lus = await lire("product.pricelist.item", "read", [regles.map(r => Number(r.odoo_item_id)), CHAMPS_REGLE]);
    const parId = new Map((lus || []).map(x => [x.id, x]));
    await resoudreEcritures(d, regles, parId);
    for (const r of regles) { const lu = parId.get(Number(r.odoo_item_id)); const ec = lu ? ecartsIdentite(lu, r) : ["absente"]; if (ec.length) return marquerModifiee(d, r, ec, lu, ctx); }
    // date_end plus proche : écriture qui raccourcit la règle (permise aussi en « créations suspendues ») ; plus lointaine :
    // écriture qui la prolonge (mode « Actif » seulement)
    const pour = Date.parse(fin) > Date.parse(d.date_fin_regle) ? "creation" : "retrait";
    if (!verrous(R, env)[pour]) {
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "modifier", cip: d.cip, avant: { date_end: d.date_fin_regle }, apres: { date_end: fin }, resultat: "simule", message: "date de fin : écriture non permise par les verrous" });
      return;
    }
    const avant = d.date_fin_regle;
    await ecrireSurRegles(d, regles, { date_end: fin }, ctx, pour, `autre lot court : date de fin ${dateParis(avant)} → ${dateParis(fin)}`);
    await majDecision(d, { lot_court_fin: f.court_fin, date_fin_regle: fin });
  }

  async function marquerModifiee(d, r, ecarts, lu, ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    await majRegle(r, { statut: "modifiee_odoo", erreur: `différent dans Odoo : ${ecarts.join(", ")}`, instantane: lu || r.instantane });
    await majDecision(d, { statut: "modifiee_odoo", modification: null, erreur: `règle ${r.odoo_item_id} (${nomListe(r.pricelist_id)}) changée dans Odoo : ${ecarts.join(", ")}` });
    await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "relire", cip: d.cip, pricelist_id: r.pricelist_id, odoo_item_id: r.odoo_item_id, avant: r.instantane, apres: lu, resultat: "echec", message: `modifiée dans Odoo (${ecarts.join(", ")}) : plus aucune écriture du site sur cette remise` });
    // le site affiche le prix habituel (toujours ≥ au prix facturé, règle modifiée comprise) ; la page n'annonce plus
    await prixSiteSansNous(d, idsDe(await vivantesDe(d)), ctx);
    await alerter({ cle: `modifiee:${r.odoo_item_id}`, sujet: `Règle modifiée dans Odoo : ${d.nom || d.cip}`, texte: `La règle Odoo n° ${r.odoo_item_id} (${nomListe(r.pricelist_id)}) posée par le site pour ${d.nom || d.cip} a été modifiée dans Odoo (${ecarts.join(", ")}). Le site n'y touche plus et la page n'annonce plus la remise. À régler à la main dans Odoo (Ventes → Configuration → Listes de prix), puis « Retirer » dans l'admin.`, cip: d.cip, reglages: R, acteur, passageId });
    return { statut: "modifiee_odoo" };
  }

  // ── Retrait, étape A (§ 5.4) : la page cesse d'annoncer, le site reprend le prix habituel ──
  // Décision sans aucune règle (simulée, ou création jamais faite) : close tout de suite, rien à supprimer dans Odoo.
  async function cacher(d, raison, ctx, { immediat = false, admin = false } = {}) {
    const { reglages: R, acteur, passageId } = ctx;
    if (!["voulue", "partielle", "facturee", "erreur", ...(admin ? ["modifiee_odoo"] : [])].includes(d.statut)) return { statut: d.statut };
    const regles = await vivantesDe(d);
    if (!regles.length) {
      if (!(await majDecision(d, { statut: "retiree", cachee_at: iso(), retiree_at: iso(), raison_fin: raison, modification: null }, { siStatut: d.statut }))) return { statut: "concurrent" };
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, resultat: d.simulee ? "simule" : "ok", message: `${d.simulee ? "décision simulée" : "décision"} close (${RAISONS_FIN[raison] || raison}) : aucune règle dans Odoo, rien à supprimer` });
      return { statut: "retiree" };
    }
    const ok = await majDecision(d, { statut: "retrait_demande", cachee_at: iso(), raison_fin: raison, retrait_immediat: !!immediat, modification: null, essais: 0 }, { siStatut: d.statut });
    if (!ok) return { statut: "concurrent" };
    await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "cacher", cip: d.cip, apres: { raison, immediat }, resultat: "ok", message: `page : remise plus annoncée (${RAISONS_FIN[raison] || raison})` });
    await prixSiteSansNous(d, idsDe(regles), ctx);
    return { statut: "retrait_demande" };
  }

  // prix du site repris d'Odoo une fois nos règles supprimées, relu → true si conforme
  async function prixSiteFinal(d, ctx) {
    try { return !!(await majPrixSite([d.cip], { acteur: ctx.acteur, mode: ctx.reglages.mode, passageId: ctx.passageId }))[d.cip]?.ok; }
    catch (e) { console.error("[peremption] prix après retrait :", court(e)); return false; }
  }

  // ── Retrait, étape B : suppression dans Odoo, une règle à la fois, après contrôle d'identité ──
  // force : « Tout retirer » ou « tout de suite » (ni délai ni attente des commandes)
  async function retirerRegles(d, ctx, { force = false, enCours = null } = {}) {
    const { reglages: R, acteur, passageId } = ctx;
    if (d.statut !== "retrait_demande") return { statut: d.statut };
    const t = maintenant();
    const cachee = Date.parse(d.cachee_at || 0);
    const immediat = force || d.retrait_immediat;
    const regles = await vivantesDe(d);
    const reelles = regles.filter(r => r.odoo_item_id || r.statut === "reservee");
    if (!reelles.length) {   // plus aucune règle dans Odoo (décision simulée, création jamais faite, ou suppressions finies)
      for (const r of regles) await majRegle(r, { statut: "retiree", retiree_at: iso() });
      if (!d.simulee && !(await prixSiteFinal(d, ctx))) {
        await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "prix_site", cip: d.cip, resultat: "reporte", message: "prix du site non repris d'Odoo : la décision reste en retrait jusqu'au passage suivant" });
        return { statut: d.statut, reporte: "prix du site" };
      }
      await majDecision(d, { statut: "retiree", retiree_at: iso() });
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, resultat: d.simulee ? "simule" : "ok", message: d.simulee ? "décision simulée close : rien à supprimer dans Odoo" : "plus aucune règle du site dans Odoo : décision close" });
      return { statut: "retiree" };
    }
    if (!immediat && t - cachee < R.delai_retrait_min * 60e3) return { statut: d.statut, reporte: "délai" };
    if (!immediat) {
      let cmds;
      try { cmds = (enCours || await commandesEnCours([d.cip])).filter(c => c.cips.includes(d.cip)); }
      catch (e) {
        await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, resultat: "reporte", message: court(e) });
        return { statut: d.statut, reporte: "commandes illisibles" };
      }
      if (cmds.length && t - cachee < ATTENTE_COMMANDES_MAX_MS) {
        await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, resultat: "reporte", message: `commandes en cours d'import : ${cmds.map(c => `${c.ref} (${c.etat})`).join(", ")}` });
        return { statut: d.statut, reporte: "commandes" };
      }
      if (cmds.length) await alerter({ cle: `force:${d.id}`, sujet: `Retrait après 24 h d'attente : ${d.nom || d.cip}`, texte: `La remise sur ${d.nom || d.cip} (CIP ${d.cip}) est supprimée dans Odoo malgré des commandes pas encore importées : ${cmds.map(c => `${c.ref} (${c.etat})`).join(", ")}. Elles seront facturées au prix habituel : vérifier les lignes à leur import.`, cip: d.cip, reglages: R, acteur, passageId });
    }
    if (!verrous(R, env).retrait) {
      await journalSur(reelles.map(r => ({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, pricelist_id: r.pricelist_id, odoo_item_id: r.odoo_item_id, resultat: "simule", message: "suppression simulée (verrous fermés) : la règle reste dans Odoo et continue d'être facturée jusqu'à sa date de fin" })));
      return { statut: d.statut, simule: true };
    }
    // prix du site sans nos règles, relu, AVANT la première suppression (une synchro « Prix remisés » a pu remettre la remise)
    const ids = idsDe(reelles);
    let siteOk = false;
    try { siteOk = !!(await majPrixSite([d.cip], { sansRegles: ids, acteur, mode: R.mode, passageId }))[d.cip]?.ok; } catch (e) { console.error("[peremption] prix avant suppression :", court(e)); }
    if (!siteOk) {
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, resultat: "reporte", message: "prix habituel non repris sur le site : suppression dans Odoo reportée" });
      return { statut: d.statut, reporte: "prix du site" };
    }
    let modifiee = false, attente = false;
    // une relecture pour toutes, contrôle d'identité, puis suppression une règle à la fois ; un contrôle de présence à la fin
    const lus = new Map(((await lire("product.pricelist.item", "search_read", [[["id", "in", ids]]], { fields: CHAMPS_REGLE })) || []).map(x => [x.id, x]));
    const supprimees = [];
    for (const r of reelles) {
      if (!r.odoo_item_id) { attente = true; continue; }   // réservation sans identifiant : adoptée d'abord (adopterOrphelines)
      const lu = lus.get(Number(r.odoo_item_id));
      if (!lu) {
        await majRegle(r, { statut: "retiree", retiree_at: iso(), erreur: "supprimée dans Odoo" });
        await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, pricelist_id: r.pricelist_id, odoo_item_id: r.odoo_item_id, resultat: "ok", message: `${nomListe(r.pricelist_id)} : règle déjà absente d'Odoo (supprimée à la main)` });
        continue;
      }
      const ec = ecartsIdentite(lu, r);
      if (ec.length) { await marquerModifiee(d, r, ec, lu, ctx); modifiee = true; continue; }
      await ecrireOdoo(R, "retrait", "product.pricelist.item", "unlink", [[Number(r.odoo_item_id)]], {}, { passageId, acteur, cip: d.cip, action: "retirer", pricelist_id: r.pricelist_id, avant: lu,
        message: `${nomListe(r.pricelist_id)} : suppression de la règle n° ${r.odoo_item_id} (${RAISONS_FIN[d.raison_fin] || d.raison_fin || "retrait"})` });
      supprimees.push(r);
    }
    if (supprimees.length) {
      const encore = new Set(((await lire("product.pricelist.item", "search_read", [[["id", "in", supprimees.map(r => Number(r.odoo_item_id))]]], { fields: ["id"] })) || []).map(x => x.id));
      for (const r of supprimees.filter(r => encore.has(Number(r.odoo_item_id)))) { attente = true; await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "retirer", cip: d.cip, pricelist_id: r.pricelist_id, odoo_item_id: r.odoo_item_id, resultat: "echec", message: "toujours présente après la suppression" }); }
      await majRegles(supprimees.filter(r => !encore.has(Number(r.odoo_item_id))), { statut: "retiree", retiree_at: iso() });
    }
    if (modifiee) return { statut: "modifiee_odoo" };
    if (attente) return { statut: d.statut, reporte: "règles en attente" };
    // tout est supprimé : prix du site repris d'Odoo, relu ; sinon la décision reste « retrait_demande » (passage suivant)
    if (!(await prixSiteFinal(d, ctx))) {
      await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "prix_site", cip: d.cip, resultat: "reporte", message: "règles supprimées, prix du site non repris d'Odoo : repris au passage suivant" });
      return { statut: d.statut, reporte: "prix du site" };
    }
    await majDecision(d, { statut: "retiree", retiree_at: iso() });
    await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "decision", cip: d.cip, apres: { statut: "retiree", raison: d.raison_fin }, resultat: "ok", message: `remise retirée : règles supprimées dans Odoo, prix habituel sur le site (${RAISONS_FIN[d.raison_fin] || d.raison_fin || "retrait"})` });
    return { statut: "retiree" };
  }

  // ── Réservations sans identifiant, règles datées inconnues (§ 5.7) : à chaque passage ──
  // Réservations « reservee » (toutes) et « echec » des dernières 48 h (une réponse perdue classée à tort en échec) :
  // rapprochées des règles datées d'Odoo par (liste, modèle, date_start exact). Une règle retrouvée pour une liste déjà
  // recréée est un doublon du site : supprimée (contrôle d'identité), verrous ouverts ; sinon alerte.
  async function adopterOrphelines(ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    const datees = await lireTout("product.pricelist.item", [["pricelist_id", "in", R.listes], ["date_start", "!=", false]], ["id", ...CHAMPS_REGLE]);
    const connues = new Set(((await sb(`peremption_regles?odoo_item_id=not.is.null&select=odoo_item_id&limit=10000`)) || []).map(r => Number(r.odoo_item_id)));
    const reservees = (await sb(`peremption_regles?statut=eq.reservee&odoo_item_id=is.null&select=*&limit=500`)) || [];
    const echecs = (await sb(`peremption_regles?statut=eq.echec&odoo_item_id=is.null&created_at=gte.${enc(iso(maintenant() - 48 * 3600e3))}&select=*&limit=500`)) || [];
    const adoptees = new Set();
    let n = 0;
    for (const r of [...reservees, ...echecs]) {
      const cand = datees.filter(x => !connues.has(x.id) && !adoptees.has(x.id) && many2one(x.pricelist_id) === Number(r.pricelist_id) && many2one(x.product_tmpl_id) === Number(r.odoo_tmpl_id) && memeInstant(x.date_start, r.date_start));
      if (cand.length === 1) {
        adoptees.add(cand[0].id);
        try {
          await majRegle(r, { odoo_item_id: cand[0].id, statut: "active", instantane: cand[0], erreur: null });
          n++;
          await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "adopter", cip: r.cip, pricelist_id: r.pricelist_id, odoo_item_id: cand[0].id, apres: cand[0], resultat: "ok", message: `${nomListe(r.pricelist_id)} : règle n° ${cand[0].id} créée avant une coupure, retrouvée par son repère date_start` });
        } catch (e) {
          if (!doublon(e)) throw e;
          // la liste a été recréée depuis : cette règle est un doublon posé par le site
          const ec = ecartsIdentite(cand[0], r);
          if (!ec.length && verrous(R, env).retrait) {
            await ecrireOdoo(R, "retrait", "product.pricelist.item", "unlink", [[cand[0].id]], {}, { passageId, acteur, cip: r.cip, action: "retirer", pricelist_id: r.pricelist_id, avant: cand[0], message: `${nomListe(r.pricelist_id)} : doublon n° ${cand[0].id} (création à la réponse perdue) supprimé` });
            await majRegle(r, { odoo_item_id: cand[0].id, statut: "retiree", retiree_at: iso(), instantane: cand[0], erreur: "doublon supprimé" });
          } else {
            await alerter({ cle: `doublon:${cand[0].id}`, sujet: `Doublon d'une règle du site : ${r.cip}`, texte: `La règle Odoo n° ${cand[0].id} (${nomListe(r.pricelist_id)}) a été créée par le site (repère ${r.date_start}) mais la liste a été recréée depuis. ${verrous(R, env).retrait ? "Elle a été changée dans Odoo : le site n'y touche pas." : "Verrous fermés : le site ne la supprime pas."} À supprimer à la main dans Odoo.`, cip: r.cip, reglages: R, acteur, passageId });
          }
        }
      } else if (!cand.length) {
        // aucune : la création n'a pas eu lieu (passée l'heure de la réservation + 10 min, pour ne pas croiser un passage en cours)
        if (r.statut === "reservee" && maintenant() - Date.parse(r.created_at || r.date_start) > 10 * 60e3) {
          await majRegle(r, { statut: "echec", erreur: "aucune règle trouvée dans Odoo pour cette réservation" });
          await journalSur({ passage_id: passageId, acteur, mode: R.mode, action: "adopter", cip: r.cip, pricelist_id: r.pricelist_id, resultat: "echec", message: `${nomListe(r.pricelist_id)} : réservation sans règle dans Odoo, sera recréée` });
        }
      } else {
        await alerter({ cle: `plusieurs:${r.id}`, sujet: `Plusieurs règles pour une réservation : ${r.cip}`, texte: `Pour le CIP ${r.cip} (${nomListe(r.pricelist_id)}), ${cand.length} règles Odoo portent le même repère date_start (${r.date_start}) : ${cand.map(c => c.id).join(", ")}. Le site n'y touche pas : à vérifier dans Odoo.`, cip: r.cip, reglages: R, acteur, passageId });
      }
    }
    // règles datées inconnues : jamais touchées, signalées
    const sansId = [...reservees, ...echecs];
    const inconnues = datees.filter(x => !connues.has(x.id) && !adoptees.has(x.id) && !sansId.some(r => many2one(x.pricelist_id) === Number(r.pricelist_id) && many2one(x.product_tmpl_id) === Number(r.odoo_tmpl_id) && memeInstant(x.date_start, r.date_start)));
    if (inconnues.length) await alerter({ cle: `inconnues:${inconnues.map(x => x.id).join(",")}`, sujet: `Règle datée inconnue sur les listes couvertes (${inconnues.length})`, texte: `Odoo porte ${inconnues.length} règle(s) datée(s) absente(s) des tables du site : ${inconnues.slice(0, 20).map(x => `n° ${x.id} (${nomListe(many2one(x.pricelist_id))}, du ${x.date_start} au ${x.date_end || "—"})`).join(", ")}. Le site n'y touche jamais. Si Elixir date désormais ses propres règles, rien à faire.`, reglages: R, acteur, passageId });
    return { adoptees: n, inconnues: inconnues.length };
  }

  // ── Listes en usage (nuit) : commandes PharmaML des 7 derniers jours par liste ──
  async function listesEnUsage(ctx) {
    const { reglages: R, acteur, passageId } = ctx;
    const depuis = versOdoo(maintenant() - 7 * 864e5);
    const g = (await lire("sale.order", "read_group", [[["company_id", "=", COMPANY_ID], ["date_order", ">=", depuis], ["state", "!=", "cancel"], ["order_line.pml_order_ref", "!=", false]], ["pricelist_id"], ["pricelist_id"]], { lazy: false })) || [];
    const usage = g.map(x => ({ liste: many2one(x.pricelist_id), nom: Array.isArray(x.pricelist_id) ? x.pricelist_id[1] : null, commandes: x.__count ?? x.pricelist_id_count ?? 0 })).filter(x => x.liste);
    const nonCouvertes = usage.filter(x => x.liste !== LISTE_EXPORT && !R.listes.includes(x.liste));
    if (nonCouvertes.length) await alerter({ cle: `listes:${nonCouvertes.map(x => x.liste).join(",")}`, sujet: `Liste de prix en usage non couverte`, texte: `Des commandes PharmaML des 7 derniers jours portent une liste sans règle péremption : ${nonCouvertes.map(x => `${x.nom || nomListe(x.liste)} (n° ${x.liste}, ${x.commandes} commandes)`).join(", ")}. Ces pharmacies paient le prix habituel. Ajouter la liste dans les réglages (onglet Péremptions) si elle doit être couverte.`, reglages: R, acteur, passageId });
    return { usage, non_couvertes: nonCouvertes.map(x => x.liste) };
  }

  // ── Filets de cohérence du prix du site et des retraits (chaque passage) ──
  // Remises retirées depuis moins de 24 h : une synchro « Prix remisés » lancée avec des règles relues avant la suppression
  // (chaîne de nuit : load puis apply) a pu remettre la remise sur le site ; Odoo ne la facture plus → prix repris d'Odoo.
  async function reprendrePrixRetirees(ctx, ouvertes) {
    const recentes = (await sb(`peremption_decisions?statut=eq.retiree&simulee=eq.false&retiree_at=gte.${enc(iso(maintenant() - 24 * 3600e3))}&select=*&limit=500`)) || [];
    const avecDecision = new Set((ouvertes || []).map(d => d.cip));
    const visees = recentes.filter(d => !avecDecision.has(d.cip) && num(lireJson(d.prix_attendu, {})?.[LISTE_SITE]) != null);
    if (!visees.length) return 0;
    const cat = new Map((await catalogueDe([...new Set(visees.map(d => d.cip))])).map(c => [c.cip, c]));
    let n = 0;
    for (const d of visees) {
      const c = cat.get(d.cip);
      const att = num(lireJson(d.prix_attendu, {})[LISTE_SITE]);
      if (!c || !(prixAffiche(c) <= att + 0.005)) continue;
      if (!(await prixSiteFinal(d, ctx))) await prixHabituelSurSite(d, { acteur: ctx.acteur, mode: ctx.reglages.mode, passageId: ctx.passageId }).catch(() => false);
      n++;
    }
    return n;
  }
  // Retraits bloqués (rien supprimé 24 h après le délai : droits retirés, Odoo en panne…) : alerte
  async function alerterRetraitsBloques(ouvertes, ctx) {
    const R = ctx.reglages;
    const limite = maintenant() - (R.delai_retrait_min * 60e3 + ATTENTE_COMMANDES_MAX_MS + 3600e3);
    const bloques = (ouvertes || []).filter(d => d.statut === "retrait_demande" && !d.simulee && Date.parse(d.cachee_at || 0) < limite);
    if (bloques.length) await alerter({ cle: `bloques:${bloques.map(d => d.id).join(",")}`, sujet: `Retrait bloqué depuis plus de 24 h (${bloques.length})`, texte: `Ces remises sont cachées sur la page mais leurs règles n'ont pas pu être supprimées dans Odoo depuis plus de 24 h : ${bloques.slice(0, 20).map(d => `${d.nom || d.cip} (caché le ${dateParis(d.cachee_at)})`).join(", ")}. Odoo continue de facturer la remise. Vérifier le journal (droits Odoo, Odoo injoignable) ; au besoin, supprimer les règles à la main dans Odoo.`, reglages: R, acteur: ctx.acteur, passageId: ctx.passageId });
    return bloques.length;
  }
  // Décisions d'un passage de l'admin en cours depuis moins de 30 min : le filet et la nuit ne les complètent pas (le
  // navigateur avance pas à pas ; un passage abandonné est repris passé ce délai)
  async function decisionsProtegees() {
    const ps = (await sb(`peremption_passages?statut=eq.en_cours&debut=gte.${enc(iso(maintenant() - PROTECTION_ADMIN_MS))}&select=id,acteur,plan&limit=50`).catch(() => [])) || [];
    const out = new Set();
    for (const p of ps) if (!["filet", "nuit", "automatique"].includes(p.acteur)) for (const e of lireJson(p.plan, {})?.elements || []) if (e?.decision) out.add(e.decision);
    return out;
  }

  // ── Une décision au passage : que faire ? (§ 5.4, § 5.6) ──
  // → { action: "rien"|"cacher"|"retirer"|"completer"|"baisser"|"fin"|"reverifier"|"alerte_long", raison, stock (true : décidé par le stock) }
  function actionDecision(d, f, regles, R, t, { faitsDouteux = false, protegees = null } = {}) {
    if (["retiree", "modifiee_odoo"].includes(d.statut)) return { action: "rien" };
    if (d.statut === "retrait_demande") return { action: "retirer" };
    const finMs = Date.parse(d.date_fin_regle);
    if (Number.isFinite(finMs) && t >= finMs - MARGE_DATE_MS) return { action: "cacher", raison: "sortie_date" };
    const fen = fenetre(t);
    const protegee = !!protegees?.has?.(d.id);
    if (f && !faitsDouteux && !f.douteux) {
      if ((f.exclusions || []).some(e => EXCLUSIONS[e])) return { action: "cacher", raison: "exclu" };
      if (!(f.court_qte >= 1)) return { action: "cacher", raison: "court_epuise", stock: true };
      if (!f.court_fin || f.court_fin < fen.min) return { action: "cacher", raison: "sortie_date" };
      const hors = (f.long_qte || 0) + (f.autre_qte || 0);
      const accepte = d.force_lot_long ? Number(d.long_qte_accepte) || 0 : 0;
      if (hors > accepte) return R.lot_long_recu === "retrait" ? { action: "cacher", raison: "lot_long_recu", stock: true, hors } : { action: "alerte_long", hors };
      if (f.court_fin !== String(d.lot_court_fin).slice(0, 10) && !d.simulee && ["facturee", "partielle"].includes(d.statut) && !protegee) return { action: "fin" };
    }
    if (d.statut === "erreur") return { action: "rien" };
    const m = lireJson(d.modification, null);
    if (d.statut === "voulue" && m?.baisse && !m.ecriture_at) return t - Date.parse(m.demandee_at || 0) >= R.delai_retrait_min * 60e3 ? { action: "baisser" } : { action: "rien" };
    if (protegee) return { action: "rien" };
    const vivantes = new Set(regles.filter(r => r.decision_id === d.id && VIVANTES.includes(r.statut)).map(r => Number(r.pricelist_id)));
    // partielle, voulue (création coupée, passage de l'admin abandonné depuis 30 min), modification interrompue, ou liste
    // ajoutée aux réglages : compléter puis vérifier
    if (!d.simulee && (d.statut === "partielle" || d.statut === "voulue" || R.listes.some(l => !vivantes.has(Number(l))))) return { action: "completer" };
    if (d.statut === "facturee") return { action: "reverifier" };
    return { action: "rien" };
  }

  // ── Plan d'un passage (§ 5.6) : décisions ouvertes × faits frais → actions ; disjoncteurs (§ 4.4) ──
  function planifier(decisions, faits, regles, R, t, { douteux = false, faitsVeille = null, creationPermise = verrous(R, env).creation, protegees = null } = {}) {
    const plan = [];
    const facturees = decisions.filter(d => d.statut === "facturee");
    // faits douteux : lecture du stock en échec, ou moins de la moitié des CIP en stock de la veille
    const enStock = Object.values(faits).filter(f => !f.douteux && f.court_qte + f.long_qte + f.autre_qte > 0).length;
    const douteuxVeille = faitsVeille != null && faitsVeille >= 4 && enStock < faitsVeille * 0.5;
    const d0 = douteux || douteuxVeille;
    for (const d of decisions) {
      const a = actionDecision(d, faits[d.cip], regles, R, t, { faitsDouteux: d0 || !faits[d.cip], protegees });
      if (a.action === "completer" && !creationPermise) continue;
      if (a.action !== "rien") plan.push({ type: a.action, cip: d.cip, decision: d.id, raison: a.raison || null, stock: !!a.stock, hors: a.hors ?? null });
    }
    const sorties = plan.filter(p => p.type === "cacher" && p.stock && facturees.some(d => d.id === p.decision));
    let disjoncteur = d0 ? (douteux ? "faits douteux : lecture d'Odoo en échec" : `faits douteux : ${enStock} CIP en stock contre ${faitsVeille} la veille`) : null;
    if (!disjoncteur && facturees.length && sorties.length >= DISJ_MIN_SORTIES && sorties.length / facturees.length > R.disjoncteur_sortie_pct / 100)
      disjoncteur = `${sorties.length} produits facturés sur ${facturees.length} sortiraient pour cause de stock (plus de ${R.disjoncteur_sortie_pct} %)`;
    const enAttente = disjoncteur && !d0 ? sorties : [];
    return { plan: plan.filter(p => !enAttente.includes(p)), disjoncteur, en_attente: enAttente };
  }

  // ── Exécution d'un élément du plan (idempotent : rejouer ne change rien ; un élément périmé n'agit pas) ──
  const PERMIS_PAR_TYPE = { creer: ["voulue", "partielle"], completer: ["voulue", "partielle"], modifier: ["voulue", "partielle", "facturee"], baisser: ["voulue"],
    fin: ["facturee", "partielle"], reverifier: ["facturee"] };
  async function executerElement(item, ctx) {
    const { reglages: R } = ctx;
    const [d] = (await sb(`peremption_decisions?id=eq.${item.decision}&select=*`)) || [];
    if (!d) return { item, resultat: "introuvable" };
    const permis = PERMIS_PAR_TYPE[item.type];
    if (permis && !permis.includes(d.statut)) {
      await journalSur({ passage_id: ctx.passageId, acteur: ctx.acteur, mode: R.mode, action: item.type, cip: d.cip, resultat: "ignore", message: `élément périmé : décision « ${d.statut} » (retirée ou changée entre-temps), rien fait` });
      return { item, resultat: "perime", statut: d.statut };
    }
    const f = ctx.faits?.[d.cip] || null;
    switch (item.type) {
      case "cacher": {
        const r = await cacher(d, item.raison, ctx, { immediat: !!item.immediat, admin: !!item.admin });
        if (item.raison === "lot_long_recu" && r.statut === "retrait_demande") {
          const vers = heureParis(Date.parse(d.cachee_at || iso()) + R.delai_retrait_min * 60e3);
          await alerter({ cle: `long:${d.id}`, sujet: `Lot long reçu : ${d.nom || d.cip}`, texte: `Un lot long est arrivé pour ${d.nom || d.cip} (CIP ${d.cip}) : ${item.hors} boîte(s) hors lot court. La remise de ${d.remise_pct} % est retirée : la page reprend aussitôt la remise de la colonne Page (−50 % par défaut, non facturée : écarts à rectifier ; 0 % dans la colonne Page pour le prix habituel), la règle est supprimée dans Odoo vers ${vers} (ou une fois les commandes en cours importées). Pour garder la remise sur toutes les boîtes : attendre la suppression, ou cliquer « Supprimer tout de suite » dans l'admin, puis réappliquer avec « Forcer ».`, cip: d.cip, reglages: R, acteur: ctx.acteur, passageId: ctx.passageId });
        }
        if (item.immediat && r.statut === "retrait_demande") return { item, ...(await retirerRegles(d, ctx, { force: true })) };
        return { item, ...r };
      }
      case "retirer": return { item, ...(await retirerRegles(d, ctx, { force: !!item.force, enCours: ctx.enCours })) };
      case "alerte_long":
        await alerter({ cle: `long:${d.id}`, sujet: `Lot long reçu : ${d.nom || d.cip}`, texte: `Un lot long est arrivé pour ${d.nom || d.cip} (CIP ${d.cip}) : ${item.hors} boîte(s) hors lot court. Réglage « maintien » : la remise reste en place jusqu'à votre décision (« Retirer » ou « Forcer »).`, cip: d.cip, reglages: R, acteur: ctx.acteur, passageId: ctx.passageId });
        return { item, statut: d.statut };
      case "completer":
      case "creer": {
        let fr = f;
        if (!fr?.prix_listes || fr.douteux) { const lu = await lireFaits([d.cip], { listes: R.listes }); fr = lu.faits[d.cip]; if (fr) await enregistrerFaits({ [d.cip]: fr }).catch(() => {}); }
        if (!fr) return { item, resultat: "faits absents" };
        return { item, ...(await creerRegles(d, fr, { ...ctx, apercu: item.apercu || null })) };
      }
      case "modifier": {
        let fr = f;
        if (!fr?.prix_listes) { fr = (await lireFaits([d.cip], { listes: R.listes })).faits[d.cip]; }
        if (!fr) return { item, resultat: "faits absents" };
        return { item, ...(await modifierRemise(d, fr, item.remise, { ...ctx, sousCout: item.sous_cout })) };
      }
      case "baisser": {
        let fr = f;
        if (!fr?.prix_listes || fr.douteux) fr = (await lireFaits([d.cip], { listes: R.listes })).faits[d.cip];
        if (!fr) return { item, resultat: "faits absents" };
        return { item, ...(await baisserRemise(d, fr, ctx)) };
      }
      case "fin": if (f) await modifierFin(d, f, ctx); return { item, statut: d.statut };
      case "reverifier": {
        if (!f?.prix_listes) return { item, statut: d.statut };
        const att = lireJson(d.prix_attendu, {});
        const ecart = R.listes.some(l => !prixConforme(l, num(f.prix_listes[l]), num(att[l])));
        if (!ecart) {
          // prix du site : le passage « Prix remisés » de la nuit le recalcule ; s'il s'écarte, on le reprend d'Odoo
          const [c] = await catalogueDe([d.cip]);
          if (c && Math.abs((num(c.discounted_price) ?? -1) - (num(att[LISTE_SITE]) ?? -2)) >= 0.01) await majPrixSite([d.cip], { acteur: ctx.acteur, mode: R.mode, passageId: ctx.passageId });
          return { item, statut: d.statut };
        }
        // prix de base changé dans Odoo (la règle en % le suit) ou règle concurrente : relecture et contrôle complets
        const cible = cibleDecision(d, f, d.remise_pct, R);
        const attendus = cible ? prixAttendus(lireJson(d.prix_habituel, {}), cible.prix_vise, R.listes) : att;
        if (!(await majDecision(d, { statut: "partielle" }, { siStatut: "facturee" }))) return { item, resultat: "perime" };
        return { item, ...(await verifierDecision(d, f, { ...ctx, attendus })) };
      }
      default: return { item, resultat: "inconnu" };
    }
  }

  // ── Passages ──
  async function nouveauPassage(acteur, mode, plan = null) {
    const [p] = (await sb("peremption_passages", { method: "POST", prefer: "return=representation", body: { acteur: String(acteur).slice(0, 120), mode, statut: "en_cours", plan, curseur: 0 } })) || [];
    return p;
  }
  const majPassage = (id, champs) => sb(`peremption_passages?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: champs }).catch(() => {});

  // Exécute le plan d'un passage depuis son curseur, dans le budget de temps → { fini, curseur, resultats }.
  // Un élément ne commence que si le temps restant couvre son coût (estimé par type, ou mesuré) ; le curseur est enregistré
  // après chaque élément ; le verrou d'appel est prolongé, et s'il est perdu, l'appel s'arrête.
  const COUT_TYPE = { creer: ESTIMATION_ELEMENT_MS, completer: ESTIMATION_ELEMENT_MS, modifier: ESTIMATION_ELEMENT_MS, baisser: ESTIMATION_ELEMENT_MS, retirer: 3000, cacher: 1500, fin: 1500, reverifier: 800, alerte_long: 300 };
  async function executerPassage(p, ctx, budgetMs) {
    const debut = maintenant();
    const plan = Array.isArray(p.plan?.elements) ? p.plan.elements : [];
    let curseur = p.curseur || 0;
    const resultats = [];
    const erreurs = [];
    const mesure = {};
    while (curseur < plan.length) {
      const item = plan[curseur];
      const cout = Math.max(COUT_TYPE[item.type] ?? ESTIMATION_ELEMENT_MS, mesure[item.type] || 0);
      if (maintenant() - debut + cout > budgetMs) break;
      const t1 = maintenant();
      try { resultats.push(await executerElement(item, ctx)); }
      catch (e) {
        if (e.code === "verrou") resultats.push({ item, simule: true, message: court(e) });
        else {
          erreurs.push({ cip: item.cip, type: item.type, erreur: court(e) }); resultats.push({ item, erreur: court(e) });
          await journalSur({ passage_id: p.id, acteur: ctx.acteur, mode: ctx.reglages.mode, action: item.type, cip: item.cip, resultat: "echec", message: court(e) });
          if (item.type === "retirer") await compterEchecRetrait(item, e, ctx).catch(() => {});
        }
      }
      mesure[item.type] = Math.max(mesure[item.type] || 0, maintenant() - t1);
      curseur++;
      await majPassage(p.id, { curseur });
      if (ctx.appel && !(await prendreVerrou(p.id, ctx.appel).catch(() => false))) break;
    }
    const fini = curseur >= plan.length;
    await majPassage(p.id, { curseur, ...(fini ? { fin: iso(), statut: "fini" } : {}), erreurs: [...(p.erreurs || []), ...erreurs].slice(-50),
      resume: { ...(p.resume || {}), executes: curseur, total: plan.length } });
    return { fini, curseur, total: plan.length, resultats, erreurs };
  }
  // étape B en échec 3 fois de suite (droits retirés, Odoo en panne) : alerte (l'essai suivant continue)
  async function compterEchecRetrait(item, e, ctx) {
    const [d] = (await sb(`peremption_decisions?id=eq.${item.decision}&select=id,cip,nom,essais,statut`)) || [];
    if (!d || d.statut !== "retrait_demande") return;
    const essais = (d.essais || 0) + 1;
    await sb(`peremption_decisions?id=eq.${d.id}`, { method: "PATCH", prefer: "return=minimal", body: { essais, erreur: `suppression dans Odoo : ${court(e)}`.slice(0, 300), updated_at: iso() } });
    if (essais >= ESSAIS_MAX) await alerter({ cle: `retrait:${d.id}`, sujet: `Suppression dans Odoo en échec : ${d.nom || d.cip}`, texte: `La suppression des règles de ${d.nom || d.cip} (CIP ${d.cip}) échoue depuis ${essais} essais : ${court(e)}. La page n'annonce plus la remise, mais Odoo continue de la facturer. Vérifier les droits Odoo (onglet Péremptions → Droits Odoo) ; au besoin, supprimer les règles à la main.`, cip: d.cip, reglages: ctx.reglages, acteur: ctx.acteur, passageId: ctx.passageId });
  }

  // ── Réconciliation (filet horaire, bouton de l'admin ; la nuit passe par passageNuit) ──
  // etendue : « nuit » (faits de toute la fenêtre, orphelines, listes en usage), « filet » (décisions ouvertes : stock et
  // dates, sans prix), « admin » (décisions ouvertes, avec prix). Un passage ne crée aucune décision (sauf remise
  // automatique des réglages, nuit seulement) ; il complète les décisions partielles et les listes ajoutées.
  // Odoo injoignable : faits « douteux » → seuls les retraits par la date passent, alerte. Erreur : passage « erreur ».
  async function reconcilier({ acteur, etendue = "filet", budgetMs = 8000, cips: cipsVises = null } = {}) {
    const t0 = maintenant();
    const R = await lireReglages();
    const p = await nouveauPassage(acteur, R.mode);
    const appel = randomUUID();
    if (!(await prendreVerrou(p.id, appel))) {
      const qui = await quiTientLeVerrou();
      await majPassage(p.id, { statut: "verrou", fin: iso(), resume: { verrou: qui } });
      await journalSur({ passage_id: p.id, acteur, mode: R.mode, action: "verrou", resultat: "ignore", message: `verrou pris par ${qui?.acteur || "?"} : rien fait` });
      return { passage_id: p.id, verrou: qui, fini: true };
    }
    try {
      const ctx = { reglages: R, acteur, passageId: p.id, appel, budgetRegles: { reste: R.plafond_regles_par_passage } };
      const extra = {};
      extra.orphelines_rouvertes = await balayerOrphelines(ctx).catch(e => ({ erreur: court(e) }));
      const decisions = await decisionsOuvertes();
      const visees = cipsVises ? decisions.filter(d => cipsVises.includes(d.cip)) : decisions;
      let cips = visees.map(d => d.cip);
      let catalogue = [];
      if (etendue === "nuit") { catalogue = await catalogueFenetre(t0); cips = [...new Set([...cips, ...catalogue.map(c => c.cip)])]; }
      const veille = etendue === "nuit" ? ((await sb("peremption_faits?select=cip,court_qte,long_qte,autre_qte&limit=5000").catch(() => [])) || []).filter(f => f.court_qte + f.long_qte + f.autre_qte > 0).length : null;
      let lu;
      try { lu = await lireFaits(cips, { prix: etendue !== "filet", ventes: etendue === "nuit", listes: R.listes }); }
      catch (e) {
        lu = { faits: {}, absents: cips, douteux: true, raison: `lecture d'Odoo en échec : ${court(e)}` };
        await alerter({ cle: `odoo:${jourUTC(t0)}`, sujet: "Odoo injoignable pendant un passage", texte: `${lu.raison}. Seuls les retraits par la date passent (les remises facturées arrivées à leur date de fin ne sont plus annoncées ; la page reprend la remise de la colonne Page) ; les suppressions dans Odoo reprendront au retour d'Odoo.`, reglages: R, acteur, passageId: p.id });
      }
      await enregistrerFaits(lu.faits).catch(e => console.error("[peremption] faits :", court(e)));
      const regles = await reglesDe(visees.map(d => d.id));
      const protegees = await decisionsProtegees();
      const { plan, disjoncteur, en_attente } = planifier(visees, lu.faits, regles, R, maintenant(), { douteux: lu.douteux, faitsVeille: etendue === "nuit" ? veille : null, protegees });
      if (disjoncteur) await alerter({ cle: `disjoncteur:${jourUTC(t0)}`, sujet: "Disjoncteur des retraits", texte: `${disjoncteur}. ${en_attente.length ? `${en_attente.length} retrait(s) pour cause de stock mis en attente ; seuls les retraits par la date passent. « Tout retirer » passe outre.` : "Seuls les retraits par la date passent."}`, reglages: R, acteur, passageId: p.id });
      ctx.faits = lu.faits;
      // retraits et baisses en attente de commandes : une lecture pour tous (illisible : chaque élément reporte)
      const attente = plan.filter(x => x.type === "retirer" || x.type === "baisser").map(x => x.cip);
      if (attente.length) ctx.enCours = await commandesEnCours(attente).catch(() => null);
      // prix habituel des produits en retrait (une synchro « Prix remisés » a pu remettre la remise)
      if (etendue !== "nuit") for (const d of visees.filter(x => x.statut === "retrait_demande")) {
        const ids = regles.filter(r => r.decision_id === d.id && VIVANTES.includes(r.statut) && r.odoo_item_id).map(r => r.odoo_item_id);
        const [c] = ids.length ? await catalogueDe([d.cip]).catch(() => []) : [];
        if (c && num(c.discounted_price) != null && num(lireJson(d.prix_attendu, {})?.[LISTE_SITE]) != null && Math.abs(num(c.discounted_price) - num(lireJson(d.prix_attendu, {})[LISTE_SITE])) < 0.01)
          await prixSiteSansNous(d, ids, ctx);
      }
      extra.prix_retirees = await reprendrePrixRetirees(ctx, decisions).catch(e => ({ erreur: court(e) }));
      extra.retraits_bloques = await alerterRetraitsBloques(decisions, ctx).catch(() => 0);
      // remise automatique (réglage, désactivée par défaut) : nuit seulement, jamais sous le coût, dans les plafonds
      const auto = etendue === "nuit" && R.remise_auto_pct && !lu.douteux ? await decisionsAutomatiques(catalogue, lu.faits, decisions, R, { acteur, passageId: p.id }) : [];
      const elements = [...plan, ...auto.map(d => ({ type: "creer", cip: d.cip, decision: d.id }))];
      p.plan = { elements, disjoncteur, en_attente };
      await majPassage(p.id, { plan: p.plan, resume: { faits: Object.keys(lu.faits).length, absents: lu.absents.length, douteux: lu.douteux, disjoncteur } });
      // filet horaire sans rien à faire : pas de ligne au journal (le passage reste dans peremption_passages)
      if (elements.length || en_attente.length || etendue !== "filet") await journalSur({ passage_id: p.id, acteur, mode: R.mode, action: "plan", resultat: R.mode === "simulation" ? "simule" : "ok",
        apres: { elements: elements.map(e => ({ type: e.type, cip: e.cip, raison: e.raison })), en_attente: en_attente.map(e => e.cip), disjoncteur }, message: textePlan(elements) });
      extra.orphelines = await adopterOrphelines(ctx).catch(e => ({ erreur: court(e) }));
      if (etendue === "nuit") extra.listes = await listesEnUsage(ctx).catch(e => ({ erreur: court(e) }));
      const reste = Math.max(1000, budgetMs - (maintenant() - t0));
      const ex = await executerPassage({ ...p, curseur: 0, resume: { faits: Object.keys(lu.faits).length } }, ctx, reste);
      return { passage_id: p.id, ...ex, disjoncteur, en_attente: en_attente.length, ...extra };
    } catch (e) {
      await majPassage(p.id, { statut: "erreur", fin: iso(), erreurs: [{ erreur: court(e) }] });
      throw e;
    } finally { await rendreVerrou(appel); }
  }
  // texte du plan : « 3 actions : 2 remises retirées de la page, 1 suppression dans Odoo »
  const LIBELLES_PLAN = { cacher: ["remise facturée retirée (la page reprend la remise affichée)", "remises facturées retirées (la page reprend la remise affichée)"], retirer: ["suppression dans Odoo", "suppressions dans Odoo"],
    completer: ["création à compléter", "créations à compléter"], creer: ["création", "créations"], baisser: ["baisse de remise", "baisses de remise"],
    fin: ["date de fin à mettre à jour", "dates de fin à mettre à jour"], reverifier: ["contrôle du prix facturé", "contrôles du prix facturé"], alerte_long: ["alerte lot long", "alertes lot long"] };
  function textePlan(elements) {
    const parts = Object.entries(LIBELLES_PLAN).map(([k, [un, plus]]) => { const n = elements.filter(e => e.type === k).length; return n ? `${n} ${n > 1 ? plus : un}` : null; }).filter(Boolean);
    return elements.length ? `${elements.length} action${elements.length > 1 ? "s" : ""} : ${parts.join(", ")}` : "rien à faire";
  }
  // Filet d'échec (peremption-cron) : une ligne d'alerte au journal (et un e-mail si les verrous sont ouverts), au plus une
  // par jour ; le passage en échec est déjà marqué « erreur » (bandeau de l'admin)
  async function signalerEchec(e, acteur = "filet") {
    const R = await lireReglages().catch(() => normaliserReglages({}));
    await alerter({ cle: `echec:${acteur}:${jourUTC(maintenant())}`, sujet: `Passage « ${acteur} » en échec`, texte: `Le passage « ${acteur} » de la Péremption courte a échoué : ${court(e)}. Les retraits automatiques (date, stock) ne se font pas tant que l'erreur dure ; la page n'annonce plus une remise arrivée à sa date de fin. Voir l'onglet Péremptions (bandeau) et le journal.`, reglages: R, acteur });
  }

  // Nuit, pas à pas (GitHub Action : step=nuit&offset=) : offset 0 = faits par paquets de 30 puis plan et exécution
  async function passageNuit({ offset = 0, budgetMs = 8000 } = {}) {
    const PAQUET = 30;
    const t0 = maintenant();
    const R = await lireReglages();
    let p;
    if (offset === 0) {
      p = await nouveauPassage("nuit", R.mode, { etape: "faits", cips: [], elements: [] });
      const cat = await catalogueFenetre(t0);
      const dec = await decisionsOuvertes();
      const cips = [...new Set([...dec.map(d => d.cip), ...cat.map(c => c.cip)])];
      const veille = ((await sb("peremption_faits?select=cip,court_qte,long_qte,autre_qte&limit=5000").catch(() => [])) || []).filter(f => f.court_qte + f.long_qte + f.autre_qte > 0).length;
      p.plan = { etape: "faits", cips, elements: [], veille, douteux: false, cat: cat.map(c => c.cip) };
      await majPassage(p.id, { plan: p.plan });
    } else {
      [p] = (await sb(`peremption_passages?acteur=eq.nuit&statut=eq.en_cours&debut=gte.${enc(iso(t0 - 3 * 3600e3))}&order=debut.desc&limit=1&select=*`)) || [];
      if (!p) return { done: true, erreur: "passage de nuit introuvable (plus de 3 h ?)" };
    }
    const appel = randomUUID();
    if (!(await prendreVerrou(p.id, appel))) {
      const qui = await quiTientLeVerrou();
      await majPassage(p.id, { statut: "verrou", fin: iso(), resume: { verrou: qui } });
      return { done: true, verrou: `verrou pris par ${qui?.acteur || "?"} : nuit arrêtée, le filet horaire reprend` };
    }
    try {
      const ctx = { reglages: R, acteur: "nuit", passageId: p.id, appel, budgetRegles: { reste: R.plafond_regles_par_passage } };
      if (p.plan.etape === "faits") {
        const i = p.curseur || 0;
        const paquet = p.plan.cips.slice(i, i + PAQUET);
        let lu;
        try { lu = await lireFaits(paquet, { prix: true, ventes: true, listes: R.listes }); }
        catch (e) { lu = { faits: {}, douteux: true, raison: court(e) }; }
        await enregistrerFaits(lu.faits);
        const douteux = p.plan.douteux || lu.douteux;
        const suivant = i + paquet.length;
        if (suivant < p.plan.cips.length) {
          await majPassage(p.id, { curseur: suivant, plan: { ...p.plan, douteux } });
          return { done: false, next_offset: offset + 1, etape: "faits", lus: suivant, total: p.plan.cips.length };
        }
        // tous les faits lus : plan global (disjoncteurs sur l'ensemble), orphelines, listes en usage, remise automatique
        await balayerOrphelines(ctx).catch(() => 0);
        const faits = Object.fromEntries(((await sb(`peremption_faits?select=*&limit=5000`)) || []).filter(f => p.plan.cips.includes(f.cip) && Date.parse(f.lu_at) >= Date.parse(p.debut) - 60e3).map(f => [f.cip, f]));
        const decisions = await decisionsOuvertes();
        const regles = await reglesDe(decisions.map(d => d.id));
        const protegees = await decisionsProtegees();
        const { plan, disjoncteur, en_attente } = planifier(decisions, faits, regles, R, maintenant(), { douteux, faitsVeille: p.plan.veille, protegees });
        if (disjoncteur) await alerter({ cle: `disjoncteur:${jourUTC(t0)}`, sujet: "Disjoncteur des retraits", texte: `${disjoncteur}. ${en_attente.length} retrait(s) pour cause de stock mis en attente ; seuls les retraits par la date passent.`, reglages: R, acteur: "nuit", passageId: p.id });
        const orph = await adopterOrphelines(ctx).catch(e => ({ erreur: court(e) }));
        const listes = await listesEnUsage(ctx).catch(e => ({ erreur: court(e) }));
        await reprendrePrixRetirees(ctx, decisions).catch(() => 0);
        await alerterRetraitsBloques(decisions, ctx).catch(() => 0);
        const cat = await catalogueDe(p.plan.cat || []);
        const auto = R.remise_auto_pct && !douteux ? await decisionsAutomatiques(cat, faits, decisions, R, { acteur: "automatique", passageId: p.id }) : [];
        const elements = [...plan, ...auto.map(d => ({ type: "creer", cip: d.cip, decision: d.id }))];
        p.plan = { ...p.plan, etape: "executer", elements, disjoncteur, en_attente };
        await majPassage(p.id, { plan: p.plan, curseur: 0, resume: { faits: Object.keys(faits).length, douteux, disjoncteur, orphelines: orph, listes } });
        await journalSur({ passage_id: p.id, acteur: "nuit", mode: R.mode, action: "plan", resultat: R.mode === "simulation" ? "simule" : "ok",
          apres: { elements: elements.map(e => ({ type: e.type, cip: e.cip, raison: e.raison })), en_attente: en_attente.map(e => e.cip), disjoncteur, listes },
          message: `nuit : ${Object.keys(faits).length} produits relus ; ${textePlan(elements)}` });
        return { done: !elements.length, next_offset: offset + 1, etape: "plan", actions: elements.length, ...(elements.length ? {} : { fin: await finNuit(p, R) }) };
      }
      const faits = Object.fromEntries(((await sb(`peremption_faits?cip=in.${enc(liste([...new Set(p.plan.elements.map(e => e.cip))].slice(0, 500)))}&select=*`).catch(() => [])) || []).map(f => [f.cip, f]));
      ctx.faits = faits;
      const attente = p.plan.elements.slice(p.curseur || 0).filter(x => x.type === "retirer" || x.type === "baisser").map(x => x.cip);
      if (attente.length) ctx.enCours = await commandesEnCours(attente).catch(() => null);
      const ex = await executerPassage(p, ctx, Math.max(1000, budgetMs - (maintenant() - t0)));
      if (ex.fini) return { done: true, etape: "executer", executes: ex.curseur, total: ex.total, fin: await finNuit(p, R) };
      return { done: false, next_offset: offset + 1, etape: "executer", executes: ex.curseur, total: ex.total };
    } catch (e) {
      await majPassage(p.id, { statut: "erreur", fin: iso(), erreurs: [{ erreur: court(e) }] });
      throw e;
    } finally { await rendreVerrou(appel); }
  }
  // fin de la nuit : résumé (journal, action « resume » : hors du compteur des alertes ; e-mail à l'équipe quand les verrous
  // sont ouverts, un par jour)
  async function finNuit(p, R) {
    await majPassage(p.id, { statut: "fini", fin: iso() });
    const ouvertes = await decisionsOuvertes();
    const r = { facturees: ouvertes.filter(d => d.statut === "facturee").length, en_retrait: ouvertes.filter(d => d.statut === "retrait_demande").length,
      erreurs: ouvertes.filter(d => ["erreur", "modifiee_odoo", "partielle"].includes(d.statut)).length, mode: R.mode };
    const elements = p.plan?.elements || [];
    const jour = dateParis(maintenant());
    await alerter({ cle: `nuit:${jourUTC(maintenant())}`, sujet: `Résumé de la nuit du ${jour}`, reglages: R, acteur: "nuit", passageId: p.id, action: "resume",
      texte: `Mode « ${MODES_LIBELLES[R.mode] || R.mode} ». ${r.facturees} produit(s) facturé(s) par Odoo, ${r.en_retrait} en retrait, ${r.erreurs} en erreur, partiel(s) ou modifié(s) dans Odoo. Cette nuit : ${textePlan(elements)}${p.plan?.disjoncteur ? ` ; disjoncteur : ${p.plan.disjoncteur}` : ""}. Détail : onglet Péremptions, journal.` }).catch(() => {});
    return r;
  }

  // Remise automatique (réglage remise_auto_pct, null par défaut) : produits « À remiser » seulement, jamais sous le coût
  async function decisionsAutomatiques(catalogue, faits, decisions, R, { acteur, passageId }) {
    const ouvertes = new Set(decisions.map(d => d.cip));
    const out = [];
    let nb = decisions.filter(d => !d.simulee && PORTEUSES.includes(d.statut)).length;
    for (const c of catalogue) {
      if (out.length >= R.plafond_produits_par_lot || ouvertes.has(c.cip)) continue;
      const f = faits[c.cip];
      const el = eligibilite(f, R, maintenant(), { remise: R.remise_auto_pct, nbFacturees: nb });
      if (!el.ok || !el.propose || el.pertes?.sous_cout) continue;
      const [d] = await enregistrerDecisions([{ f, remise: R.remise_auto_pct, cible: el.cible, pertes: el.pertes, force: null, sousCout: false }], { R, acteur: "automatique", passageId }).catch(() => [[]]);
      if (d?.id) { out.push(d); nb++; }
    }
    return out;
  }

  // ── Aperçu (§ 7), lecture seule : faits relus à l'instant, changements exacts par liste ──
  function empreinteApercu(cip, remise, cible, fin, attendus, f) {
    return empreinte({ cip, remise, pct: cible?.percent_price, fin, attendus, prix: f?.prix_listes, hors: (f?.long_qte || 0) + (f?.autre_qte || 0) });
  }
  // type : « creer » (aucune décision), « modifier » (décision ouverte : write de percent_price sur nos règles, dates
  // inchangées), « ecarte » (rien ne change dans Odoo), « en_retrait » (décision en retrait : réappliquer après la suppression)
  function apercuProduit(f, R, t, { remise, force, sousCout, decision, regles = [], nbFacturees }) {
    const ouverte = decision && ["voulue", "partielle", "facturee"].includes(decision.statut) ? decision : null;
    const habituelsFiges = ouverte ? lireJson(ouverte.prix_habituel, null) : null;
    const el = eligibilite(f, R, t, { remise, force, sousCout, decision: !!ouverte, nbFacturees: ouverte ? null : nbFacturees, habituels: habituelsFiges, controleFin: !ouverte });
    if (!f) return { cip: null, type: "ecarte", eligibilite: el };
    const cible = el.cible;
    const fin = ouverte ? ouverte.date_fin_regle : f.court_fin ? finRegle(f.court_fin) : null;
    const habituels = habituelsFiges || f.prix_listes || {};
    const attendus = cible ? prixAttendus(habituels, cible.prix_vise, R.listes) : {};
    const debut = Math.floor(maintenant() / 1000) * 1000 - AVANCE_DEBUT_MS;
    const parListe = new Map((regles || []).filter(r => VIVANTES.includes(r.statut)).map(r => [Number(r.pricelist_id), r]));
    const pctTxt = (x) => String(x).replace(".", ",");
    const enRetrait = decision?.statut === "retrait_demande";
    const enCours = decision && !ouverte && !enRetrait;
    const listes = R.listes.map(l => {
      const aujourdhui = num(f.prix_listes?.[l]);
      const habituel = num(habituels?.[l]);
      const apres = attendus[l] ?? null;
      const r = parListe.get(Number(l));
      let changement = null, valeurs = null;
      if (cible && fin && !enRetrait && !enCours) {
        if (ouverte && r?.odoo_item_id) changement = `Modifier la règle n° ${r.odoo_item_id} : remise ${pctTxt(Number(r.percent_price))} % → ${pctTxt(cible.percent_price)} % sur PGHT (dates inchangées : du ${dateParis(r.date_start)} au ${dateParis(r.date_end)})`;
        else {
          valeurs = valeursRegle({ liste: l, tmpl: f.odoo_tmpl_id, percent: cible.percent_price, debut, fin });
          changement = `Créer : « Produit ${f.nom} · Remise ${pctTxt(cible.percent_price)} % sur PGHT · qté min. 0 · du ${dateParis(debut)} au ${dateParis(fin)} »`;
        }
      }
      // « sans effet sur cette liste » : le prix visé n'est pas plus bas que le prix habituel de la liste (figé à la décision
      // pour un produit déjà remisé : le prix du jour porte NOTRE remise)
      const sansEffet = cible && habituel != null ? apres != null && apres >= habituel - 0.004 : false;
      return { liste: l, nom: nomListe(l), prix_aujourdhui: aujourdhui, prix_habituel: habituel, prix_apres: apres, sans_effet: sansEffet,
        economie_pct: habituel > 0 && apres != null ? Math.round((1 - apres / habituel) * 1000) / 10 : null, changement, valeurs };
    });
    const applicable = el.ok || (el.raisons || []).every(r => r.code === "sous_cout");
    const type = enRetrait ? "en_retrait" : enCours ? "ecarte" : !cible || !fin || !applicable ? "ecarte" : ouverte ? "modifier" : "creer";
    const vers = enRetrait ? heureParis(Date.parse(decision.cachee_at || 0) + R.delai_retrait_min * 60e3) : null;
    const raisons = enRetrait ? [{ code: "en_retrait", texte: `En cours de retrait : réappliquer après la suppression dans Odoo (vers ${vers}), ou cliquer « Supprimer tout de suite » puis réappliquer` }]
      : enCours ? [{ code: "en_cours", texte: { erreur: "En erreur : « Réessayer » ou « Retirer » d'abord", modifiee_odoo: "Règle modifiée dans Odoo : la remettre en état puis « Réessayer », ou « Retirer »" }[decision.statut] || `décision « ${decision.statut} »` }]
      : el.raisons;
    return { cip: f.cip, nom: f.nom, remise, type, eligibilite: { ok: el.ok && type !== "ecarte" && type !== "en_retrait", statut: el.statut, raisons, propose: el.propose }, cible, fin_regle: fin,
      stock: { court: f.court_qte, court_fin: f.court_fin, long: f.long_qte, long_debut: f.long_debut, autre: f.autre_qte }, listes, pertes: el.pertes,
      prix_base: f.list_price, cout: f.cout, ventes_30j: f.ventes_30j, exclusions: f.exclusions, lu_at: f.lu_at,
      facture: cible ? { pu: num(f.list_price), remise_pct: cible.percent_price } : null,
      ...(ouverte ? { remise_actuelle: ouverte.remise_pct } : {}),
      apercu_id: cible && fin && (type === "creer" || type === "modifier") ? empreinteApercu(f.cip, remise, cible, fin, attendus, f) : null };
  }
  async function apercu({ cips, remise, force = {}, sousCout = {} }) {
    const R = await lireReglages();
    const t = maintenant();
    const lus = await lireFaits(cips, { listes: R.listes });
    await enregistrerFaits(lus.faits).catch(() => {});
    const ouvertes = await decisionsOuvertes();
    const nbFacturees = ouvertes.filter(d => !d.simulee && PORTEUSES.includes(d.statut)).length;
    const decs = ouvertes.filter(d => cips.includes(d.cip));
    const regles = await reglesDe(decs.map(d => d.id));
    const produits = cips.map(cip => {
      const dec = decs.find(d => d.cip === cip) || null;
      const a = apercuProduit(lus.faits[cip] || null, R, t, { remise, force: force?.[cip] ?? null, sousCout: !!sousCout?.[cip], decision: dec, regles: dec ? regles.filter(r => r.decision_id === dec.id) : [], nbFacturees });
      return { ...a, cip, decision: dec ? { id: dec.id, statut: dec.statut, remise_pct: dec.remise_pct } : null };
    });
    // chiffres du lot : seulement les produits qui changeront dans Odoo (créations et modifications)
    const utiles = produits.filter(p => p.type === "creer" || p.type === "modifier");
    const ok = utiles.filter(p => p.eligibilite?.ok);
    return { mode: R.mode, verrous: verrous(R, env), listes: R.listes, base_remise: R.base_remise, produits, lot: { produits: ok.length, regles: ok.length * R.listes.length, demandes: cips.length,
      creations: utiles.filter(p => p.type === "creer").length, modifications: utiles.filter(p => p.type === "modifier").map(p => ({ cip: p.cip, nom: p.nom, avant: p.remise_actuelle, apres: remise })),
      sous_cout: utiles.filter(p => p.pertes?.sous_cout).map(p => ({ cip: p.cip, nom: p.nom, perte: p.pertes.perte_totale })),
      perte_possible: round2(utiles.reduce((s, p) => s + (p.pertes?.perte_totale || 0), 0)),
      effet_lgo_mois: round2(utiles.reduce((s, p) => s + (p.pertes?.effet_lgo_mois || 0), 0)),
      ecartes: produits.filter(p => p.type === "ecarte" || p.type === "en_retrait").map(p => ({ cip: p.cip, nom: p.nom, raisons: p.eligibilite?.raisons || [] })) } };
  }

  // Décisions enregistrées (statut voulue) en un seul envoi ; doublon (décision déjà ouverte) : une à une, les autres
  // passent → [décision | { erreur, cip }]. Simulation → simulee = true.
  async function enregistrerDecisions(liste0, { R, acteur, passageId }) {
    const corps = liste0.map(({ f, remise, cible, pertes, force, sousCout, apercuId = null }) => ({ cip: f.cip, odoo_pid: f.odoo_pid, odoo_tmpl_id: f.odoo_tmpl_id, nom: f.nom, remise_pct: remise,
      percent_price: cible.percent_price, lot_court_fin: f.court_fin, date_fin_regle: finRegle(f.court_fin), force_lot_long: force != null, long_qte_accepte: force != null ? Number(force) : null,
      sous_cout_confirme: !!sousCout, simulee: !verrous(R, env).creation, prix_base: f.list_price, prix_habituel: f.prix_listes, prix_attendu: prixAttendus(f.prix_listes, cible.prix_vise, R.listes),
      cout: f.cout, apercu: { id: apercuId, pertes, stock: { court: f.court_qte, long: f.long_qte, autre: f.autre_qte }, base: R.base_remise }, statut: "voulue", decide_par: acteur }));
    if (!corps.length) return [];
    let creees;
    try { creees = (await sb("peremption_decisions", { method: "POST", prefer: "return=representation", body: corps })) || []; }
    catch (e) {
      if (!doublon(e)) throw e;
      creees = [];
      for (const c of corps) {
        try { const [d] = (await sb("peremption_decisions", { method: "POST", prefer: "return=representation", body: c })) || []; creees.push(d); }
        catch (e2) { if (!doublon(e2)) throw e2; creees.push({ erreur: "décision déjà ouverte", cip: c.cip }); }
      }
    }
    await journalSur(creees.filter(d => d?.id).map((d, i) => { const x = liste0.find(y => y.f.cip === d.cip) || liste0[i]; return { passage_id: passageId, acteur, mode: R.mode, action: "decision", cip: d.cip,
      apres: { remise: d.remise_pct, percent_price: d.percent_price, fin: d.date_fin_regle, force: x?.force ?? null, sous_cout: !!x?.sousCout, pertes: x?.pertes, apercu: x?.apercuId ?? null },
      resultat: d.simulee ? "simule" : "ok", message: `remise de ${d.remise_pct} % décidée${x?.force != null ? `, lot long forcé (${x.force} boîtes)` : ""}${x?.sousCout && x?.pertes?.sous_cout ? `, vente sous le coût confirmée (perte ${eur(x?.pertes?.perte_totale ?? 0)})` : ""}${d.simulee ? " (simulation : rien dans Odoo)" : ""}` }; }));
    return creees;
  }

  // ── Appliquer (admin) : décisions + passage, puis la main au navigateur (« etape » exécute, chaque appel sous 10 s) ──
  async function appliquer({ cips, remise, force = {}, sousCout = {}, apercus = {}, confirmationRegles = null, acteur }) {
    const R = await lireReglages();
    const t = maintenant();
    if (!Array.isArray(cips) || !cips.length) return { erreur: "aucun produit" };
    if (cips.length > R.plafond_produits_par_lot) return { erreur: `au plus ${R.plafond_produits_par_lot} produits par application` };
    if (R.mode === "creations_suspendues") return { erreur: "créations suspendues : aucune création ni modification" };
    if (cips.length > 1 && Number(confirmationRegles) !== cips.length * R.listes.length) return { erreur: `confirmation : saisir le nombre de règles (${cips.length * R.listes.length})` };
    const lus = await lireFaits(cips, { listes: R.listes });
    await enregistrerFaits(lus.faits).catch(() => {});
    const ouvertes = await decisionsOuvertes();
    let nb = ouvertes.filter(d => !d.simulee && PORTEUSES.includes(d.statut)).length;
    // budget mensuel de perte (réglage) : pertes confirmées ce mois-ci
    let budget = null;
    if (R.budget_perte_mensuel != null) {
      const debutMois = `${jourUTC(t).slice(0, 7)}-01T00:00:00Z`;
      const ceMois = (await sb(`peremption_decisions?decide_at=gte.${enc(debutMois)}&simulee=eq.false&select=apercu&limit=2000`)) || [];
      budget = R.budget_perte_mensuel - ceMois.reduce((s, x) => s + (num(lireJson(x.apercu, {})?.pertes?.perte_totale) || 0), 0);
    }
    const elements = [], refus = [], nouvelles = [];
    const p = await nouveauPassage(acteur, R.mode);
    for (const cip of cips) {
      const f = lus.faits[cip];
      const dec = ouvertes.find(d => d.cip === cip);
      const fc = force?.[cip] != null && force[cip] !== false ? Number(force[cip]) : null;
      if (dec?.simulee && verrous(R, env).creation) {   // décision de la simulation : close, la décision réelle repart d'un aperçu
        await majDecision(dec, { statut: "retiree", raison_fin: "fin_simulation", retiree_at: iso() }, { siStatut: dec.statut });
      } else if (dec && ["facturee", "partielle", "voulue"].includes(dec.statut)) {
        const m = lireJson(dec.modification, null);
        if (m?.ecriture_at) { refus.push({ cip, raisons: [{ code: "en_cours", texte: "modification en cours dans Odoo : réessayer au passage suivant" }] }); continue; }
        const visee = m?.baisse ? m.remise : dec.remise_pct;
        if (Number(visee) === Number(remise)) { refus.push({ cip, raisons: [{ code: "deja", texte: `déjà à ${remise} %` }] }); continue; }
        const el = eligibilite(f, R, t, { remise, force: fc ?? (dec.force_lot_long ? dec.long_qte_accepte : null), sousCout: !!sousCout?.[cip], decision: true, nbFacturees: null, habituels: lireJson(dec.prix_habituel, null), controleFin: false });
        if (!el.ok) { refus.push({ cip, raisons: el.raisons }); continue; }
        elements.push({ type: "modifier", cip, decision: dec.id, remise, sous_cout: !!sousCout?.[cip] });
        continue;
      } else if (dec) {
        const vers = heureParis(Date.parse(dec.cachee_at || 0) + R.delai_retrait_min * 60e3);
        const texte = { retrait_demande: `en cours de retrait : réappliquer après la suppression dans Odoo (vers ${vers}), ou « Supprimer tout de suite » puis réappliquer`,
          erreur: "en erreur : « Réessayer » ou « Retirer » d'abord", modifiee_odoo: "règle modifiée dans Odoo : la remettre en état puis « Réessayer », ou « Retirer »" }[dec.statut] || `décision « ${dec.statut} » en cours`;
        refus.push({ cip, raisons: [{ code: "en_cours", texte }] }); continue;
      }
      const el = eligibilite(f, R, t, { remise, force: fc, sousCout: !!sousCout?.[cip], nbFacturees: nb });
      if (!el.ok) { refus.push({ cip, raisons: el.raisons }); continue; }
      if (budget != null && el.pertes?.perte_totale > budget) { refus.push({ cip, raisons: [{ code: "budget", texte: `budget mensuel de perte dépassé (reste ${eur(budget)})` }] }); continue; }
      const fin = finRegle(f.court_fin);
      const attendus = prixAttendus(f.prix_listes, el.cible.prix_vise, R.listes);
      const id = empreinteApercu(cip, remise, el.cible, fin, attendus, f);
      if (apercus?.[cip] && apercus[cip] !== id) { refus.push({ cip, raisons: [{ code: "apercu", texte: "l'aperçu a changé (prix, date ou stock) : refaire l'aperçu" }] }); continue; }
      if (budget != null) budget -= el.pertes?.perte_totale || 0;
      nb++;
      nouvelles.push({ f, remise, cible: el.cible, pertes: el.pertes, force: fc, sousCout: !!sousCout?.[cip], apercuId: id });
    }
    for (const d of await enregistrerDecisions(nouvelles, { R, acteur, passageId: p.id })) {
      if (d?.id) elements.push({ type: "creer", cip: d.cip, decision: d.id, apercu: nouvelles.find(x => x.f.cip === d.cip)?.apercuId || null });
      else if (d?.cip) refus.push({ cip: d.cip, raisons: [{ code: "en_cours", texte: "décision déjà ouverte" }] });
    }
    p.plan = { elements };
    await majPassage(p.id, { plan: p.plan, resume: { demandes: cips.length, refus: refus.length }, ...(elements.length ? {} : { statut: "fini", fin: iso() }) });
    if (refus.length) await journalSur(refus.map(r => ({ passage_id: p.id, acteur, mode: R.mode, action: "refus", cip: r.cip, resultat: "echec", message: r.raisons.map(x => x.texte).join(" ; ") })));
    return { passage_id: p.id, refus, fini: !elements.length, curseur: 0, total: elements.length, resultats: [] };
  }
  // Suite d'un passage de l'admin (pas à pas depuis le navigateur)
  async function etape({ passageId, acteur, budgetMs = 7000 }) {
    const R = await lireReglages();
    const [p] = (await sb(`peremption_passages?id=eq.${passageId}&select=*`)) || [];
    if (!p) return { erreur: "passage introuvable" };
    if (p.statut !== "en_cours") return { fini: true, curseur: p.curseur, total: p.plan?.elements?.length || 0, resultats: [] };
    const appel = randomUUID();
    if (!(await prendreVerrou(p.id, appel))) { const qui = await quiTientLeVerrou(); return { fini: false, attente: `verrou pris par ${qui?.acteur || "?"}`, curseur: p.curseur, total: p.plan?.elements?.length || 0, resultats: [] }; }
    try {
      const ctx = { reglages: R, acteur: acteur || p.acteur, passageId: p.id, appel, faits: {} };
      const attente = (p.plan?.elements || []).slice(p.curseur || 0).filter(x => (x.type === "retirer" && !x.force) || x.type === "baisser").map(x => x.cip);
      if (attente.length) ctx.enCours = await commandesEnCours(attente).catch(() => null);
      return await executerPassage(p, ctx, budgetMs);
    } finally { await rendreVerrou(appel); }
  }

  // Réessayer (admin) : décision partielle, en erreur, ou modifiée dans Odoo puis remise en état à la main
  async function reessayer({ cip, acteur }) {
    const R = await lireReglages();
    if (!verrous(R, env).creation) return { erreur: "création non permise : mode Simulation, créations suspendues, ou variable PEREMPTION_ODOO_ECRITURE absente" };
    const d = (await decisionsOuvertes()).find(x => x.cip === cip);
    if (!d || !["erreur", "partielle", "modifiee_odoo", "voulue"].includes(d.statut) || d.simulee) return { erreur: "rien à réessayer pour ce produit" };
    const p = await nouveauPassage(acteur, R.mode, { elements: [{ type: "completer", cip, decision: d.id }] });
    if (d.statut === "modifiee_odoo") {
      const rs = (await reglesDe([d.id])).filter(r => r.statut === "modifiee_odoo" && r.odoo_item_id);
      const lus = rs.length ? (await lire("product.pricelist.item", "read", [rs.map(r => Number(r.odoo_item_id)), CHAMPS_REGLE])) || [] : [];
      const parId = new Map(lus.map(x => [x.id, x]));
      const encore = rs.filter(r => parId.get(Number(r.odoo_item_id)) && ecartsIdentite(parId.get(Number(r.odoo_item_id)), r).length);
      if (encore.length) return { erreur: `règle(s) toujours différente(s) dans Odoo : n° ${encore.map(r => r.odoo_item_id).join(", ")} (à remettre comme avant ou à supprimer à la main)` };
      for (const r of rs) await majRegle(r, parId.get(Number(r.odoo_item_id)) ? { statut: "active", erreur: null, verifiee_at: null } : { statut: "retiree", retiree_at: iso(), erreur: "supprimée dans Odoo" });
    }
    await majDecision(d, { statut: "partielle", essais: 0, erreur: null });
    await journalSur({ passage_id: p.id, acteur, mode: R.mode, action: "decision", cip, apres: { statut: "partielle" }, resultat: "ok", message: "« Réessayer » demandé par l'admin" });
    return { passage_id: p.id, fini: false, curseur: 0, total: 1, resultats: [] };
  }

  // Ce que viserait un retrait (lecture seule) : décisions ouvertes par statut, règles vivantes, commandes en cours
  async function apercuRetrait({ cips = null } = {}) {
    const R = await lireReglages();
    const ouvertes = (await decisionsOuvertes()).filter(d => !cips || cips.includes(d.cip));
    const regles = (await reglesDe(ouvertes.map(d => d.id))).filter(r => VIVANTES.includes(r.statut));
    const parStatut = {};
    for (const d of ouvertes) { const k = d.simulee ? "simulee" : d.statut; parStatut[k] = (parStatut[k] || 0) + 1; }
    let commandes = [], commandesErreur = null;
    try { commandes = await commandesEnCours(ouvertes.map(d => d.cip)); } catch (e) { commandesErreur = court(e); }
    return { decisions: ouvertes.length, par_statut: parStatut, produits_avec_regles: new Set(regles.map(r => r.cip)).size, regles: regles.filter(r => r.odoo_item_id).length,
      reservees: regles.filter(r => !r.odoo_item_id).length, commandes, commandes_erreur: commandesErreur, verrous: verrous(R, env) };
  }

  // Retirer (admin) : étape A tout de suite ; B après le délai, ou tout de suite (« tout de suite » ou « Tout retirer »).
  // « Tout retirer » : étape A EN BLOC dès le premier appel (une écriture par table : la page cesse aussitôt d'annoncer, le
  // site reprend le prix habituel figé), puis l'étape B pas à pas ; si le navigateur s'arrête, le filet la termine
  // (retrait immédiat : passage toutes les 15 min tant qu'il en reste).
  async function retirer({ cips = null, toutDeSuite = false, tout = false, acteur }) {
    const R = await lireReglages();
    const p = await nouveauPassage(acteur, R.mode);
    const ctx = { reglages: R, acteur, passageId: p.id };
    let elements = [], cmds = [], visees = [];
    if (tout) {
      await balayerOrphelines(ctx).catch(e => console.error("[peremption] balayage :", court(e)));
      const champs = { cachee_at: iso(), raison_fin: "tout_retirer", modification: null, essais: 0, updated_at: iso() };
      const statuts = enc("(voulue,partielle,facturee,erreur,modifiee_odoo,retrait_demande)");
      await sb(`peremption_decisions?statut=in.${statuts}&simulee=eq.true`, { method: "PATCH", prefer: "return=minimal", body: { ...champs, statut: "retiree", retiree_at: iso() } });
      const cachees = (await sb(`peremption_decisions?statut=in.${enc("(voulue,partielle,facturee,erreur,modifiee_odoo)")}&simulee=eq.false`, { method: "PATCH", prefer: "return=representation", body: { ...champs, statut: "retrait_demande", retrait_immediat: true } })) || [];
      const deja = (await sb(`peremption_decisions?statut=eq.retrait_demande&simulee=eq.false&retrait_immediat=eq.false`, { method: "PATCH", prefer: "return=representation", body: { retrait_immediat: true, updated_at: iso() } })) || [];
      visees = [...cachees, ...deja];
      await journalSur(cachees.map(d => ({ passage_id: p.id, acteur, mode: R.mode, action: "cacher", cip: d.cip, apres: { raison: "tout_retirer", immediat: true }, resultat: "ok", message: "page : remise plus annoncée (« Tout retirer »)" })));
      const lignes = [];
      for (let i = 0; i < cachees.length; i += 10) lignes.push(...await Promise.all(cachees.slice(i, i + 10).map(d => prixHabituelSurSite(d, { acteur, mode: R.mode, passageId: p.id, sansJournal: true }).catch(() => null))));
      await journalSur(lignes.filter(x => x && typeof x === "object"));
      elements = visees.map(d => ({ type: "retirer", cip: d.cip, decision: d.id, force: true }));
    } else {
      visees = (await decisionsOuvertes()).filter(d => (cips || []).includes(d.cip));
      for (const d of visees) {
        if (d.statut === "retrait_demande") { if (toutDeSuite) elements.push({ type: "retirer", cip: d.cip, decision: d.id, force: true }); continue; }
        // « modifiée dans Odoo » : chaque règle est relue à l'étape B ; une règle encore différente n'est jamais supprimée
        elements.push({ type: "cacher", cip: d.cip, decision: d.id, raison: "remise_retiree", immediat: toutDeSuite || d.statut === "modifiee_odoo", admin: true });
      }
    }
    p.plan = { elements };
    await majPassage(p.id, { plan: p.plan, ...(elements.length ? {} : { statut: "fini", fin: iso() }) });
    if (tout || toutDeSuite) {
      cmds = await commandesEnCours(visees.map(d => d.cip)).catch(() => []);
      if (cmds.length) await alerter({ cle: `toutretirer:${p.id}`, sujet: tout ? "« Tout retirer » avec des commandes en cours" : "Retrait immédiat avec des commandes en cours",
        texte: `Retrait immédiat des remises péremption alors que des commandes du site ne sont pas encore importées dans Odoo : ${cmds.map(c => `${c.ref}${c.pharmacie ? ` (${c.pharmacie})` : ""} : ${c.etat}, ${c.cips.join(", ")}`).join(" ; ")}. Elles seront facturées au prix habituel.`, reglages: R, acteur, passageId: p.id });
    }
    return { passage_id: p.id, decisions: visees.length, commandes_en_cours: cmds, fini: !elements.length, curseur: 0, total: elements.length, resultats: [] };
  }

  // Mode (admin) : « Actif » refusé sans PEREMPTION_ODOO_ECRITURE ; fin de simulation → décisions simulées closes
  async function changerMode({ mode, acteur }) {
    if (!MODES.includes(mode)) return { erreur: "mode inconnu" };
    const R = await lireReglages();
    if (mode === "actif" && !verrous({ mode }, env).variable) return { erreur: "mode « Actif » refusé : la variable Netlify PEREMPTION_ODOO_ECRITURE=1 est absente (redéployer après l'avoir ajoutée, contexte « Production »)" };
    if (mode === R.mode) return { mode };
    await sb("peremption_reglages?id=eq.1", { method: "PATCH", prefer: "return=minimal", body: { mode, updated_at: iso(), updated_by: acteur } });
    let closes = 0;
    if (R.mode === "simulation" && mode !== "simulation") {
      for (const d of (await decisionsOuvertes()).filter(x => x.simulee)) {
        if (await majDecision(d, { statut: "retiree", raison_fin: "fin_simulation", retiree_at: iso() }, { siStatut: d.statut })) closes++;
      }
    }
    await journalSur({ acteur, mode, action: "mode", avant: { mode: R.mode }, apres: { mode, decisions_simulees_closes: closes }, resultat: "ok", message: `mode ${MODES_LIBELLES[R.mode]} → ${MODES_LIBELLES[mode]}${closes ? ` (${closes} décision(s) simulée(s) close(s))` : ""}` });
    return { mode, decisions_simulees_closes: closes };
  }
  // Réglages (admin) : valeurs validées ; ni le mode ni le verrou. corrections : valeurs refusées ou ramenées dans les bornes
  const LIBELLES_REGLAGES = { listes: "Listes de prix", base_remise: "Base de la remise", remise_auto_pct: "Remise automatique", remise_max_pct: "Remise maximale", sous_cout: "Vente sous le coût",
    perte_max_produit: "Perte maximale par produit", budget_perte_mensuel: "Budget mensuel de perte", lot_long_recu: "Lot long reçu", ventes_lgo_max: "Ventes par les logiciels",
    plafond_produits_par_lot: "Produits par application en lot", plafond_produits_factures: "Produits facturés en même temps", plafond_regles_par_passage: "Règles complétées par passage",
    seuil_annonce_pct: "Seuil d'annonce", delai_retrait_min: "Délai avant suppression", disjoncteur_sortie_pct: "Disjoncteur des sorties", filet_dates_odoo: "Odoo respecte les dates" };
  async function changerReglages({ valeurs, acteur }) {
    const R = await lireReglages();
    const permis = Object.keys(LIBELLES_REGLAGES);
    const v = Object.fromEntries(Object.entries(valeurs || {}).filter(([k]) => permis.includes(k)));
    if (v.listes && (!Array.isArray(v.listes) || v.listes.map(Number).includes(LISTE_EXPORT))) return { erreur: "listes : jamais la 4 (Export)" };
    const N = normaliserReglages({ ...R, ...v });
    const corps = Object.fromEntries(permis.filter(k => k in v).map(k => [k, N[k]]));
    const pareil = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (a != null && b != null && String(a) === String(b));
    const corrections = permis.filter(k => k in v && !pareil(k === "listes" ? (v.listes || []).map(Number) : v[k], N[k]))
      .map(k => ({ champ: k, libelle: LIBELLES_REGLAGES[k], saisi: v[k], garde: N[k] }));
    if (!Object.keys(corps).length) return { reglages: R, corrections };
    const at = iso();
    await sb("peremption_reglages?id=eq.1", { method: "PATCH", prefer: "return=minimal", body: { ...corps, updated_at: at, updated_by: acteur } });
    await journalSur({ acteur, mode: R.mode, action: "reglages", avant: Object.fromEntries(Object.keys(corps).map(k => [k, R[k]])), apres: corps, resultat: "ok",
      message: `réglages modifiés : ${Object.keys(corps).map(k => LIBELLES_REGLAGES[k]).join(", ")}${corrections.length ? ` (${corrections.length} valeur(s) corrigée(s))` : ""}` });
    return { reglages: { ...R, ...corps, updated_at: at, verrou_jusqua: undefined, verrou_passage: undefined, verrou_appel: undefined }, corrections };
  }

  // ── Droits Odoo (T0, lecture seule) ──
  async function droits({ acteur } = {}) {
    const R = await lireReglages().catch(() => normaliserReglages({}));
    const out = { at: iso(), modele: {}, regle: {}, compte: null };
    for (const op of ["read", "create", "write", "unlink"]) out.modele[op] = await lire("product.pricelist.item", "check_access_rights", [op], { raise_exception: false }).catch(e => `erreur : ${court(e)}`);
    const [une] = (await lire("product.pricelist.item", "search_read", [[["pricelist_id", "=", LISTE_SITE]]], { fields: ["id"], limit: 1 })) || [];
    for (const op of ["write", "unlink"]) {
      if (!une) { out.regle[op] = "aucune règle de la liste 5 à tester"; continue; }
      out.regle[op] = await lire("product.pricelist.item", "check_access_rule", [[une.id], op]).then(() => true).catch(e => `refusé : ${court(e)}`);
    }
    const cg = await lire("res.users", "context_get", []).catch(() => null);
    if (cg?.uid) { const [u] = (await lire("res.users", "read", [[cg.uid], ["login", "name", "company_ids"]])) || []; out.compte = u ? { login: u.login, nom: u.name, societes: u.company_ids, societe_elixir: (u.company_ids || []).includes(COMPANY_ID) } : null; }
    out.ok = ["read", "create", "write", "unlink"].every(op => out.modele[op] === true) && ["write", "unlink"].every(op => out.regle[op] === true) && !!out.compte?.societe_elixir;
    out.login_attendu = "pharmacien@elixirpharma.fr";
    await sb("peremption_reglages?id=eq.1", { method: "PATCH", prefer: "return=minimal", body: { droits: out } }).catch(() => {});
    await journalSur({ acteur: acteur || "admin", mode: R.mode, action: "droits", apres: out, resultat: out.ok ? "ok" : "echec" });
    return out;
  }

  // ── Contrôle des écarts (règle panier, 21/10/2026 ; § 16.1 de la conception ; revue du 21/10/2026) ──
  // Lecture seule d'Odoo et de Supabase. Commandes du site par leur date (posée par le serveur), jours à l'heure de Paris.
  //  1. lignes de vente Odoo citant la référence PharmaML des commandes (n° de la commande, synced_ref du relais ; sinon
  //     « <n°>P… ») et de la commande visée par separeDe (chargée même hors de la page) → commandes Odoo concernées ;
  //  2. TOUTES les lignes non annulées de ces commandes (lignes scindées ou ajoutées à la main, sans référence, comprises),
  //     regroupées par (commande Odoo, produit), avec ce qui est réellement facturé (factures postées − avoirs : factureLigne) ;
  //  3. chaque ligne du site rattachée à son groupe (ses références ; ligne « Pér. » à part sans commande Odoo à elle : celle de
  //     separeDe), commandes du site citées par le groupe chargées aussi ; repartirGroupe sert d'abord les lignes hors « Pér. » ;
  //  4. offre contrôlée côté serveur (une ligne enregistrée vient du navigateur) : remise au plus celle de la page ce jour-là
  //     (remise affichée de l'admin à la date de la commande, journal compris ; sinon −50 %, −20 % dès 500 € ; règle Odoo
  //     facturée) ; prix au moins prix de base × (1 − remise) ; produit sur la page ce jour-là (lot court en stock dans la
  //     fenêtre) ; boîtes servies au moins celles du site. Sinon « à vérifier » : visible, hors des totaux ;
  //  5. lignes « Pér. » non retrouvées dans Odoo : renvoyées à part (non_retrouvees, motif), comptées dans la tuile.
  // Suivi (statut, référence, qui, quand) : peremption_ecarts (sql/peremption-ecarts.sql), clé « <n° commande>:<CIP>[:rang] ».
  const COLS_CMD = "id,date,items,pharmacy_name,pharmacy_cip,source";
  const REF_SITE = /^(\d{6,16})(P\d{1,2})?$/;
  const itemsDe = (o) => (Array.isArray(o?.items) ? o.items : lireJson(o?.items, []) || []);
  const eligiblePer = (it) => !!it?.cip && estPeremption(it) && remiseLigne(it).remise >= 1;
  const nomOdoo = (l) => String(Array.isArray(l?.product_id) ? l.product_id[1] : "").replace(/^\[[^\]]*\]\s*/, "") || null;
  async function calculerEcarts(cmds, { seulPer = false, t = maintenant() } = {}) {
    const examinees = seulPer ? cmds.filter(o => itemsDe(o).some(eligiblePer)) : cmds;
    const parId = new Map(cmds.map(o => [String(o.id), o]));
    const charger = async (ids) => {
      const manque = [...new Set(ids.map(String))].filter(id => /^\d{6,16}$/.test(id) && !parId.has(id));
      for (let i = 0; i < manque.length; i += 100) for (const o of (await sb(`elixir_orders?id=in.(${manque.slice(i, i + 100).join(",")})&select=${COLS_CMD}`)) || []) parId.set(String(o.id), o);
    };
    if (!examinees.length) return { sortie: [], non_retrouvees: [] };
    await charger(examinees.flatMap(o => itemsDe(o).filter(it => eligiblePer(it) && it.separeDe).map(it => it.separeDe)));
    const refsCommande = (o) => [...new Set([String(o.id), ...itemsDe(o).map(it => it?.synced_ref).filter(Boolean).map(String)])];
    const depart = [...new Set([...examinees, ...examinees.flatMap(o => itemsDe(o).filter(it => eligiblePer(it) && it.separeDe).map(it => parId.get(String(it.separeDe))).filter(Boolean))])];
    // 1. lignes citant les références → commandes Odoo ; sans résultat pour une commande : références « <n°>P… » du relais
    const CH_REF = ["pml_order_ref", "order_id"];
    const parRef = new Map();   // référence PharmaML → Set(id de commande Odoo)
    const noter = (ls) => { for (const l of ls) { if (!l.pml_order_ref) continue; const k = String(l.pml_order_ref); if (!parRef.has(k)) parRef.set(k, new Set()); parRef.get(k).add(many2one(l.order_id)); } };
    const refs0 = [...new Set(depart.flatMap(refsCommande))];
    if (refs0.length) noter(await lireTout("sale.order.line", [["pml_order_ref", "in", refs0], ["state", "!=", "cancel"]], CH_REF));
    const sansRef = depart.filter(o => !refsCommande(o).some(r => parRef.has(r))).map(o => String(o.id));
    for (let i = 0; i < sansRef.length; i += 40) {
      const feuilles = sansRef.slice(i, i + 40).map(id => ["pml_order_ref", "=like", `${id}P%`]);
      noter(await lireTout("sale.order.line", [...Array(feuilles.length - 1).fill("|"), ...feuilles, ["state", "!=", "cancel"]], CH_REF));
    }
    const commandesOdoo = [...new Set([...parRef.values()].flatMap(x => [...x]))].filter(Boolean);
    // 2. toutes les lignes de ces commandes Odoo (non annulées, lignes de produit)
    const CH = ["order_id", "product_id", "pml_order_ref", "product_uom_qty", "price_unit", "discount", "price_subtotal", "qty_delivered", "qty_invoiced", "invoice_lines", "invoice_status"];
    const lignesO = [];
    for (let i = 0; i < commandesOdoo.length; i += 200) lignesO.push(...await lireTout("sale.order.line", [["order_id", "in", commandesOdoo.slice(i, i + 200)], ["display_type", "=", false], ["state", "!=", "cancel"]], CH));
    noter(lignesO);
    // commandes du site citées par ces lignes (autres paniers regroupés par le connecteur) : chargées
    await charger(lignesO.map(l => (String(l.pml_order_ref || "").match(REF_SITE) || [])[1]).filter(Boolean));
    // CIP d'une ligne Odoo : par le produit (odoo_catalog : CIP → odoo_pid), sinon le code du libellé « [CIP] »
    const cipsSite = [...new Set([...parId.values()].flatMap(o => itemsDe(o).map(it => it?.cip).filter(Boolean).map(String)))];
    const cat = await catalogueDe(cipsSite).catch(() => []);
    const catParCip = new Map(cat.map(c => [String(c.cip), c]));
    const cipParPid = new Map(cat.filter(c => c.odoo_pid).map(c => [Number(c.odoo_pid), String(c.cip)]));
    const cipDe = (l) => cipParPid.get(many2one(l.product_id)) || (String(Array.isArray(l.product_id) ? l.product_id[1] : "").match(/^\[(\d+)\]/) || [])[1] || null;
    // factures et avoirs des lignes (account.move.line, puis account.move : type, état, numéro)
    const idsMv = [...new Set(lignesO.flatMap(l => (Array.isArray(l.invoice_lines) ? l.invoice_lines : [])).map(Number).filter(Boolean))];
    const mvl = [];
    for (let i = 0; i < idsMv.length; i += 400) mvl.push(...((await lire("account.move.line", "read", [idsMv.slice(i, i + 400), ["move_id", "quantity", "price_subtotal", "parent_state"]])) || []));
    const idsPieces = [...new Set(mvl.map(m => many2one(m.move_id)).filter(Boolean))];
    const pieces = new Map();
    for (let i = 0; i < idsPieces.length; i += 400) for (const m of (await lire("account.move", "read", [idsPieces.slice(i, i + 400), ["name", "move_type", "state"]])) || []) pieces.set(m.id, m);
    const mouvements = new Map(mvl.map(m => { const pc = pieces.get(many2one(m.move_id)); return [m.id, { type: pc?.move_type, etat: m.parent_state || pc?.state, quantite: num(m.quantity) || 0, montant: num(m.price_subtotal) || 0, numero: pc?.name || null }]; }));
    // groupes (commande Odoo × CIP)
    const groupes = new Map();
    for (const l of lignesO) {
      const cip = cipDe(l);
      if (!cip) continue;
      const k = `${many2one(l.order_id)}|${cip}`;
      if (!groupes.has(k)) groupes.set(k, { cle: k, commande_odoo: many2one(l.order_id), odoo: Array.isArray(l.order_id) ? l.order_id[1] : null, cip, lignes: [], site: [], nom: nomOdoo(l) });
      groupes.get(k).lignes.push(l);
    }
    // 3. lignes du site → groupe
    const commandesDe = (refs) => [...new Set(refs.flatMap(r => [...(parRef.get(r) || [])]))];
    const refsP = new Map();   // n° de commande du site → références « <n°>P… » vues dans Odoo
    for (const r of parRef.keys()) { const m = String(r).match(/^(\d{6,16})P\d{1,2}$/); if (m) { if (!refsP.has(m[1])) refsP.set(m[1], []); refsP.get(m[1]).push(r); } }
    const avecP = (id) => refsP.get(String(id)) || [];
    const sortie = [], nonRetrouvees = [];
    const examineesIds = new Set(examinees.map(o => String(o.id)));
    const rattache = [];   // { o, it, k, n, g, viaSepare }
    for (const o of parId.values()) {
      const vus = new Map();
      itemsDe(o).forEach((it, k) => {
        if (!it?.cip) return;
        const n = (vus.get(String(it.cip)) || 0) + 1; vus.set(String(it.cip), n);
        const refs = [it.synced_ref ? String(it.synced_ref) : null, String(o.id), ...avecP(o.id)].filter(Boolean);
        let cmdsOdoo = commandesDe(refs), viaSepare = false;
        if (!cmdsOdoo.length && eligiblePer(it) && it.separeDe && parId.has(String(it.separeDe))) {
          const a = parId.get(String(it.separeDe));
          cmdsOdoo = commandesDe([...refsCommande(a), ...avecP(a.id)]); viaSepare = true;
        }
        const g = cmdsOdoo.map(c => groupes.get(`${c}|${it.cip}`)).find(Boolean);
        if (g) { g.site.push({ o, it, k, n, viaSepare }); return; }
        if (!eligiblePer(it) || !examineesIds.has(String(o.id))) return;
        const age = t - (Date.parse(o.date || "") || Number(o.id) || t);
        nonRetrouvees.push({ cle: `${o.id}:${it.cip}${n > 1 ? `:${n}` : ""}`, commande: String(o.id), date: o.date || null, pharmacie: o.pharmacy_name || null, pharmacy_cip: o.pharmacy_cip || null,
          cip: String(it.cip), qte: Number(it.qty) || 0, pn: num(it.pn), remise: remiseLigne(it).remise, separe_de: it.separeDe || null, ancien: age > 24 * 3600e3,
          motif: cmdsOdoo.length ? "sans_produit" : age > 48 * 3600e3 ? "introuvable" : "pas_encore", odoo: cmdsOdoo.length ? [...groupes.values()].find(x => x.commande_odoo === cmdsOdoo[0])?.odoo || null : null });
      });
    }
    // 4. calcul par groupe ; lignes « Pér. » des commandes examinées
    for (const g of groupes.values()) {
      if (!g.site.length) continue;
      const fl = g.lignes.map(l => factureLigne(l, mouvements));
      const statuts = [...new Set(g.lignes.map(l => l.invoice_status).filter(Boolean))];
      const facturation = statuts.length === 1 ? statuts[0] : statuts.includes("to invoice") ? "to invoice" : statuts[0] || null;
      const avoirs = fl.flatMap(x => x.avoirs);
      const commun = { odoo: g.odoo, odoo_id: g.commande_odoo, ref_odoo: [...new Set(g.lignes.map(l => l.pml_order_ref).filter(Boolean).map(String))].join(", ") || null, facturation,
        ...(avoirs.length ? { avoirs } : {}), lignes_odoo: g.lignes.length };
      const pers = g.site.filter(x => eligiblePer(x.it));
      const cle = (x) => `${x.o.id}:${x.it.cip}${x.n > 1 ? `:${x.n}` : ""}`;
      const base = (x) => ({ cle: cle(x), commande: String(x.o.id), date: x.o.date || null, pharmacie: x.o.pharmacy_name || null, pharmacy_cip: x.o.pharmacy_cip || null,
        cip: String(x.it.cip), nom: g.nom || null, peremption: estPeremption(x.it) ? x.it.peremption : null, separe_de: x.it.separeDe || null, ...commun });
      if (pers.length) {
        const r = repartirGroupe(fl, g.site.map(x => ({ qty: x.it.qty, pn: x.it.pn, per: eligiblePer(x.it) })));
        pers.forEach((x, i) => {
          if (!examineesIds.has(String(x.o.id))) return;
          const v = r.lignes[i];
          const { remise, facture_odoo } = remiseLigne(x.it);
          const propre = commandesDe([String(x.o.id), ...avecP(x.o.id), x.it.synced_ref ? String(x.it.synced_ref) : null].filter(Boolean)).length > 0;
          if (!(v.qte > 0)) {
            const age = t - (Date.parse(x.o.date || "") || Number(x.o.id) || t);
            nonRetrouvees.push({ ...base(x), qte: Number(x.it.qty) || 0, pn: num(x.it.pn), remise, ancien: age > 24 * 3600e3,
              motif: x.viaSepare && !propre ? (age > 48 * 3600e3 ? "a_part_introuvable" : "attente_import") : "non_servie" });
            return;
          }
          if (!(v.ecart >= 0.01)) return;
          sortie.push({ ...base(x), type: "peremption", qte: v.qte, qte_commandee: Number(x.it.qty) || 0, qte_odoo: r.boites, pn: num(x.it.pn), net: v.net, pu: round2(Math.max(...g.lignes.map(l => num(l.price_unit) || 0))),
            remise, ecart: v.ecart, coherent: true, service_reduit: r.serviReduit, ...(facture_odoo ? { regle_absente: true } : {}), _it: x.it, _o: x.o });
        });
        continue;
      }
      // groupe sans ligne « Pér. » : ancienne page (probable) et autres écarts, sur le groupe additionné
      if (seulPer) continue;
      const somme = { product_uom_qty: fl.reduce((s0, x) => s0 + x.boites, 0), price_unit: Math.max(...g.lignes.map(l => num(l.price_unit) || 0)), discount: num(g.lignes[0]?.discount),
        price_subtotal: fl.reduce((s0, x) => s0 + x.montant, 0) };
      for (const x of g.site) {
        if (!examineesIds.has(String(x.o.id))) continue;
        const e = ecartLigne(x.it, somme);
        if (e) sortie.push({ ...base(x), ...e, qte_odoo: somme.product_uom_qty, _it: x.it, _o: x.o });
      }
    }
    // 5. offre contrôlée côté serveur pour les lignes « Pér. » (et pistes des lignes non retrouvées)
    await verifierOffres(sortie.filter(x => x.type === "peremption"), { catParCip, t });
    // ordre des commandes (date, n°) puis des lignes dans la commande
    const rang = (x) => itemsDe(x._o).indexOf(x._it);
    sortie.sort((a, b) => (Date.parse(a._o.date || "") || 0) - (Date.parse(b._o.date || "") || 0) || Number(a.commande) - Number(b.commande) || rang(a) - rang(b));
    for (const x of sortie) { delete x._it; delete x._o; }
    for (const x of nonRetrouvees) {
      // piste : commande Odoo d'une autre commande du site de la même pharmacie, à moins de 24 h, qui a ce produit
      if (x.odoo) continue;
      const tx = Date.parse(x.date || "") || Number(x.commande);
      const p = [...groupes.values()].find(g => g.cip === x.cip && g.site.some(s0 => s0.o.pharmacy_cip && s0.o.pharmacy_cip === x.pharmacy_cip && Math.abs((Date.parse(s0.o.date || "") || Number(s0.o.id)) - tx) < 24 * 3600e3));
      if (p) x.piste = p.odoo;
    }
    return { sortie, non_retrouvees: nonRetrouvees };
  }
  // Offre de la page le jour de la commande, recalculée côté serveur (une ligne enregistrée vient du navigateur) → coherent,
  // a_verifier (motifs). Remise maximale : règle Odoo facturée (décision V1 facturée avant la commande), sinon remise affichée de
  // l'admin à la date de la commande (journal « remise_affichee » ; sinon expiry_discounts actuel), sinon −50 % (−20 % dès 500 €).
  async function verifierOffres(lignes, { catParCip, t }) {
    if (!lignes.length) return;
    const cips = [...new Set(lignes.map(x => x.cip))];
    const [journalR, actuelles, faits, decisions] = await Promise.all([
      sb(`peremption_journal?action=eq.remise_affichee&cip=in.${enc(liste(cips))}&select=at,cip,avant,apres&order=at.asc&limit=2000`).catch(() => []),
      lireRemisesAdmin().catch(() => ({})),
      sb(`peremption_faits?cip=in.${enc(liste(cips))}&select=cip,court_fin,odoo_pid`).catch(() => []),
      sb(`peremption_decisions?cip=in.${enc(liste(cips))}&select=cip,remise_pct,facturee_at,simulee&limit=2000`).catch(() => []),
    ]);
    const faitsParCip = new Map((faits || []).map(f => [String(f.cip), f]));
    const remiseAdminA = (cip, tc) => {
      const js = (journalR || []).filter(j => String(j.cip) === cip);
      const avant = js.filter(j => Date.parse(j.at) <= tc).at(-1);
      if (avant) return remiseAdmin(lireJson(avant.apres, {})?.remise_affichee);
      const apres = js.find(j => Date.parse(j.at) > tc);
      if (apres) return remiseAdmin(lireJson(apres.avant, {})?.remise_affichee);
      return actuelles?.[cip] ?? null;
    };
    const dansFenetre = (d, f) => { const j = String(d || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(j) && j >= f.min && j <= f.max; };
    let lotsOdoo = null;   // pid → [dates] (stock.lot), lus seulement si la page n'est pas prouvée par Supabase
    for (const x of lignes) {
      const tc = Date.parse(x._o?.date || "") || Number(x.commande) || t;
      const c = catParCip.get(x.cip);
      const f = faitsParCip.get(x.cip);
      const baseP = num(c?.list_price) || x.pu || 0;
      const v1 = (decisions || []).filter(d => String(d.cip) === x.cip && !d.simulee && d.facturee_at && Date.parse(d.facturee_at) <= tc).reduce((m, d) => Math.max(m, Number(d.remise_pct) || 0), 0);
      const adm = remiseAdminA(x.cip, tc);
      const rPage = adm != null ? adm : remiseDefaut(baseP);
      const rMax = Math.max(rPage, x.regle_absente || remiseLigne(x._it).facture_odoo ? v1 : 0);
      const fen = fenetre(tc);
      let lots = [];
      try { lots = Array.isArray(c?.lots) ? c.lots : lireJson(c?.lots, []) || []; } catch { lots = []; }
      let surPage = [f?.court_fin, c?.earliest_expiry, ...lots.map(l => l?.expiry)].some(d => dansFenetre(d, fen));
      if (!surPage) {
        const pid = Number(c?.odoo_pid || f?.odoo_pid) || 0;
        if (pid) {
          if (!lotsOdoo) {
            lotsOdoo = new Map();
            const pids = [...new Set(lignes.map(y => Number(catParCip.get(y.cip)?.odoo_pid || faitsParCip.get(y.cip)?.odoo_pid) || 0).filter(Boolean))];
            for (const l of (await lire("stock.lot", "search_read", [[["product_id", "in", pids], ["expiration_date", "!=", false]]], { fields: ["product_id", "expiration_date"], limit: 2000 }).catch(() => [])) || []) {
              const p = many2one(l.product_id); if (!lotsOdoo.has(p)) lotsOdoo.set(p, []); lotsOdoo.get(p).push(l.expiration_date);
            }
          }
          surPage = (lotsOdoo.get(pid) || []).some(d => dansFenetre(d, fen));
        }
      }
      const offreOk = x.remise != null && x.remise <= rMax + 0.01 && x.pn >= round2(baseP * (1 - rMax / 100)) - 0.02;
      const motifs = [...(offreOk ? [] : [`remise ou prix au-delà de l'offre de la page ce jour-là (au plus −${rMax} %, ${eur(round2(baseP * (1 - rMax / 100)))})`]),
        ...(surPage ? [] : ["produit sans lot court en stock ce jour-là (pas sur la page)"]), ...(x.service_reduit ? ["boîtes servies moins nombreuses que celles commandées : lesquelles ?"] : [])];
      x.coherent = !motifs.length;
      x.remise_max = rMax;
      if (motifs.length) x.a_verifier = motifs;
    }
  }
  async function lignesEcarts({ depuis, jusqua = null, offset = 0, page = 150, types = null }) {
    if (!jourValide(depuis) || (jusqua && !jourValide(jusqua))) return { erreur: "date invalide" };
    const d0 = minuitParisIso(depuis), d1 = jusqua ? minuitParisIso(ajouterJours(jusqua, 1)) : null;
    const cmds = (await sb(`elixir_orders?date=gte.${enc(d0)}${d1 ? `&date=lt.${enc(d1)}` : ""}&select=${COLS_CMD}&order=date.asc,id.asc&limit=${page}&offset=${offset}`)) || [];
    const seulPer = Array.isArray(types) && types.length === 1 && types[0] === "peremption";
    const r = await calculerEcarts(cmds, { seulPer });
    return { cmds: cmds.length, page, sortie: r.sortie.filter(x => !Array.isArray(types) || types.includes(x.type)), non_retrouvees: r.non_retrouvees };
  }
  // statut de rectification des lignes (peremption_ecarts) → { parCle, suivi: "ok" | "non_installe" }
  async function statutsEcarts(cles) {
    const parCle = new Map();
    if (!cles.length) return { parCle, suivi: "ok" };
    try {
      for (let i = 0; i < cles.length; i += 100) {
        for (const r of (await sb(`peremption_ecarts?cle=in.${enc(liste(cles.slice(i, i + 100)))}&select=cle,statut,reference,par,le,ecart`)) || []) parCle.set(r.cle, r);
      }
      return { parCle, suivi: "ok" };
    } catch (e) { if (tableAbsente(e)) return { parCle, suivi: "non_installe" }; throw e; }
  }
  // statut, référence, qui et quand d'une ligne ; complément : ligne rectifiée dont l'écart a grossi depuis (quantité ou prix
  // changé dans Odoo) → la différence est de nouveau à rectifier
  const appliquerStatut = (x, st) => {
    const statut = st?.statut === "rectifie" ? "rectifie" : "a_rectifier";
    const complement = statut === "rectifie" && num(st?.ecart) != null && x.ecart > num(st.ecart) + 0.01 ? round2(x.ecart - num(st.ecart)) : 0;
    return Object.assign(x, { statut, reference: statut === "rectifie" ? st?.reference || null : null, reference_precedente: statut === "a_rectifier" ? st?.reference || null : null,
      par: st?.par || null, le: st?.le || null, ecart_rectifie: statut === "rectifie" ? num(st?.ecart) : null, complement });
  };
  // montant encore à rectifier d'une ligne (à rectifier : son écart ; rectifiée : son complément)
  const resteARectifier = (x) => (x.statut === "rectifie" ? x.complement || 0 : x.ecart);
  const comptee = (x) => x.type === "peremption" && x.coherent !== false;
  async function ecarts({ depuis = DEBUT_REGLE_PANIER, jusqua = null, offset = 0, page = 100, types = null } = {}) {
    const r = await lignesEcarts({ depuis, jusqua, offset, page, types });
    if (r.erreur) return r;
    const sortie = r.sortie;
    // liste de prix de chaque commande Odoo (lecture seule)
    const ids = [...new Set(sortie.map(x => x.odoo_id).filter(Boolean))];
    const listes = new Map();
    for (let i = 0; i < ids.length; i += 200) for (const so of (await lire("sale.order", "read", [ids.slice(i, i + 200), ["pricelist_id"]]).catch(() => [])) || []) listes.set(so.id, so.pricelist_id);
    for (const x of sortie) { const pl = listes.get(x.odoo_id); x.liste = many2one(pl); x.liste_nom = Array.isArray(pl) ? pl[1] : null; }
    const { parCle, suivi } = await statutsEcarts(sortie.map(x => x.cle));
    for (const x of sortie) appliquerStatut(x, parCle.get(x.cle));
    const somme = (xs) => round2(xs.reduce((s, x) => s + x.ecart, 0));
    for (const x of sortie) x.page_peremption = x.type !== "autre";   // compatibilité (export d'avant)
    return { depuis, jusqua, offset, suivant: r.cmds === r.page ? offset + r.page : null, commandes: r.cmds, lignes: sortie, non_retrouvees: r.non_retrouvees, suivi,
      total_ecart: somme(sortie), total_peremption: somme(sortie.filter(comptee)), total_a_verifier: somme(sortie.filter(x => x.type === "peremption" && x.coherent === false)),
      total_probable: somme(sortie.filter(x => x.type === "probable")), total_autres: somme(sortie.filter(x => x.type === "autre")) };
  }
  // Résumé du bandeau de l'admin : lignes « Pér. » à rectifier depuis la règle panier (21/10/2026), par pharmacie (CIP), lignes
  // « à vérifier » et non retrouvées dans Odoo à part. Gardé 10 min (frais : relu). Budget : une page de plus seulement si elle
  // tient dans le temps restant (durée de la page précédente).
  let resumeEcarts = null;
  async function ecartsResume({ depuis = DEBUT_REGLE_PANIER, frais = false, budgetMs = 7000 } = {}) {
    const t = maintenant();
    if (!frais && resumeEcarts && resumeEcarts.depuis === depuis && t - resumeEcarts.t < RESUME_ECARTS_MS) return resumeEcarts.valeur;
    const debut = Date.now();
    const lignes = [], nonRetrouvees = [];
    let offset = 0, complet = true, derniere = 0;
    for (;;) {
      const t0 = Date.now();
      const r = await lignesEcarts({ depuis, offset, page: 300, types: ["peremption"] });
      if (r.erreur) return r;
      lignes.push(...r.sortie); nonRetrouvees.push(...r.non_retrouvees);
      derniere = Date.now() - t0;
      if (r.cmds < r.page) break;
      offset += r.page;
      // une page de plus seulement si elle tient avant le budget, lecture des statuts comprise (réserve d'une seconde)
      if (Date.now() - debut + derniere + 1000 > budgetMs) { complet = false; break; }
    }
    const { parCle, suivi } = await statutsEcarts(lignes.map(x => x.cle));
    for (const x of lignes) appliquerStatut(x, parCle.get(x.cle));
    const somme = (xs, f = (x) => x.ecart) => round2(xs.reduce((s, x) => s + f(x), 0));
    const aRectifier = lignes.filter(x => comptee(x) && resteARectifier(x) > 0);
    const rectifiees = lignes.filter(x => comptee(x) && x.statut === "rectifie");
    const aVerifier = lignes.filter(x => x.type === "peremption" && x.coherent === false && x.statut !== "rectifie");
    const parPharmacie = new Map();
    for (const x of aRectifier) {
      const k = x.pharmacy_cip || x.pharmacie || "?";
      const v = parPharmacie.get(k) || { pharmacie: x.pharmacie || "?", pharmacy_cip: x.pharmacy_cip || null, lignes: 0, montant: 0 };
      v.lignes++; v.montant = round2(v.montant + resteARectifier(x)); parPharmacie.set(k, v);
    }
    const anciennes = nonRetrouvees.filter(x => x.ancien);
    const valeur = { depuis, complet, suivi, maj: iso(t),
      a_rectifier: { montant: somme(aRectifier, resteARectifier), lignes: aRectifier.length, pharmacies: parPharmacie.size },
      rectifie: { montant: somme(rectifiees, x => num(x.ecart_rectifie) ?? x.ecart), lignes: rectifiees.length },
      a_verifier: { montant: somme(aVerifier), lignes: aVerifier.length },
      non_retrouvees: { lignes: anciennes.length, recentes: nonRetrouvees.length - anciennes.length },
      pharmacies: [...parPharmacie.values()].sort((a, b) => b.montant - a.montant).slice(0, 20) };
    resumeEcarts = { t, depuis, valeur };
    return valeur;
  }
  // Statut d'une ou plusieurs lignes : « rectifie » (référence libre : n° d'avoir, correction de la commande Odoo…) ou
  // « a_rectifier » (« Remettre à rectifier » : la référence est gardée) ; qui et quand gardés ; journal (ajout seul). Les
  // lignes sont RECALCULÉES côté serveur (commandes relues, Odoo relu) : montants enregistrés ceux du serveur ; « rectifie »
  // refusé pour une clé sans écart actuel.
  async function changerStatutEcarts({ lignes, statut, reference = null, acteur }) {
    if (!STATUTS_ECART.includes(statut)) return { erreur: `statut : ${STATUTS_ECART.join(" ou ")}` };
    const ref = reference == null ? null : String(reference).replace(/\s+/g, " ").trim().slice(0, 120) || null;
    const cles = [...new Set((Array.isArray(lignes) ? lignes : []).slice(0, 200).map(l => (typeof l === "string" ? l : l?.cle)).filter(cleEcartValide).map(String))];
    if (!cles.length) return { erreur: "lignes : au moins une clé valide (« <n° commande>:<CIP> »)" };
    const t = iso();
    const ids = [...new Set(cles.map(c => c.split(":")[0]))];
    const cmds = [];
    for (let i = 0; i < ids.length; i += 100) cmds.push(...((await sb(`elixir_orders?id=in.(${ids.slice(i, i + 100).join(",")})&select=${COLS_CMD}`)) || []));
    const actuelles = new Map((await calculerEcarts(cmds)).sortie.map(x => [x.cle, x]));
    if (statut === "rectifie") {
      const sans = cles.filter(c => !(actuelles.get(c)?.ecart > 0));
      if (sans.length) return { erreur: `aucun écart actuel pour ${sans.slice(0, 5).join(", ")}${sans.length > 5 ? ` et ${sans.length - 5} autre(s)` : ""} (relancer le contrôle)` };
      const rows = cles.map(c => { const x = actuelles.get(c); return { cle: c, commande: c.split(":")[0], cip: c.split(":")[1], pharmacie: x.pharmacie ? String(x.pharmacie).slice(0, 200) : null,
        commande_odoo: x.odoo ? String(x.odoo).slice(0, 40) : null, nom: x.nom ? String(x.nom).slice(0, 200) : null, qte: x.qte, prix_page: x.pn, prix_facture: x.net, ecart: x.ecart,
        statut, reference: ref, par: String(acteur || "admin").slice(0, 120), le: t, updated_at: t }; });
      try { await sb("peremption_ecarts?on_conflict=cle", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows }); }
      catch (e) { if (tableAbsente(e)) return { erreur: "non_installe", message: "table peremption_ecarts absente : exécuter sql/peremption-ecarts.sql dans Supabase" }; throw e; }
      const total = round2(rows.reduce((s, r) => s + (r.ecart || 0), 0));
      await journalSur({ acteur: acteur || "admin", mode: "site", action: "ecart", cip: rows.length === 1 ? rows[0].cip : null, apres: { cles, statut, reference: ref, total },
        resultat: "ok", message: `${rows.length} ligne(s) d'écart rectifiée(s) (${eur(total)})${ref ? ` · réf. ${ref}` : ""}` });
      resumeEcarts = null;
      return { ok: true, lignes: rows.length, statut, reference: ref, par: rows[0].par, le: t, total, montants: Object.fromEntries(rows.map(r => [r.cle, r.ecart])) };
    }
    // remettre à rectifier : lignes déjà suivies seulement ; référence gardée (n° d'avoir), qui et quand du changement
    let suivies;
    try { suivies = (await sb(`peremption_ecarts?cle=in.${enc(liste(cles))}&select=cle,reference,ecart`)) || []; }
    catch (e) { if (tableAbsente(e)) return { erreur: "non_installe", message: "table peremption_ecarts absente : exécuter sql/peremption-ecarts.sql dans Supabase" }; throw e; }
    if (!suivies.length) return { erreur: "aucune de ces lignes n'est marquée rectifiée" };
    await sb(`peremption_ecarts?cle=in.${enc(liste(suivies.map(r => r.cle)))}`, { method: "PATCH", prefer: "return=minimal", body: { statut, par: String(acteur || "admin").slice(0, 120), le: t, updated_at: t } });
    const total = round2(suivies.reduce((s, r) => s + (num(r.ecart) || 0), 0));
    await journalSur({ acteur: acteur || "admin", mode: "site", action: "ecart", cip: suivies.length === 1 ? String(suivies[0].cle).split(":")[1] : null,
      apres: { cles: suivies.map(r => r.cle), statut, references_gardees: suivies.map(r => r.reference).filter(Boolean), total }, resultat: "ok",
      message: `${suivies.length} ligne(s) d'écart remise(s) à rectifier (${eur(total)})${suivies.some(r => r.reference) ? ` · réf. gardée(s) : ${[...new Set(suivies.map(r => r.reference).filter(Boolean))].join(", ")}` : ""}` });
    resumeEcarts = null;
    return { ok: true, lignes: suivies.length, statut, reference: null, par: String(acteur || "admin").slice(0, 120), le: t, total };
  }

  // ── Remise affichée par l'admin (expiry_discounts : 0 à 90 %, 0 = aucune ; null = défaut 50 %, 20 % dès 500 €) ──
  // Écrite avec la clé service_role (la page la relit à chaque chargement) ; journalisée. Aucune écriture Odoo.
  async function lireRemisesAdmin() {
    try {
      const rows = await sb("expiry_discounts?select=cip,discount_pct&limit=5000", { anon: true });
      return Object.fromEntries((Array.isArray(rows) ? rows : []).filter(r => r?.cip).map(r => [String(r.cip), remiseAdmin(r.discount_pct)]));
    } catch (e) { if (tableAbsente(e) || e?.status === 404) return {}; throw e; }
  }
  async function remiseAffichee({ cip, remise, nom = null, acteur }) {
    if (!/^\d{7,14}$/.test(String(cip || ""))) return { erreur: "cip" };
    const r = remise == null ? null : remiseAdmin(remise);
    if (remise != null && (r == null || !Number.isInteger(r))) return { erreur: "remise_pct : entier de 0 à 90, ou null (défaut)" };
    const avant = (await lireRemisesAdmin())[cip] ?? null;
    if (r == null) await sb(`expiry_discounts?cip=eq.${enc(cip)}`, { method: "DELETE", prefer: "return=minimal" });
    else await sb("expiry_discounts?on_conflict=cip", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: [{ cip: String(cip), discount_pct: r, product_name: nom ? String(nom).slice(0, 200) : null, updated_at: iso() }] });
    await journalSur({ acteur: acteur || "admin", mode: "site", action: "remise_affichee", cip, avant: { remise_affichee: avant }, apres: { remise_affichee: r }, resultat: "ok",
      message: `remise affichée sur la page : ${avant == null ? "défaut" : `${avant} %`} → ${r == null ? "défaut (50 %, 20 % dès 500 €)" : r === 0 ? "aucune" : `${r} %`} (aucune écriture Odoo)` });
    return { ok: true, cip, remise_affichee: r };
  }
  // Prix habituel de produits absents de la page (paniers enregistrés : ligne péremption dont le produit a quitté la page) ;
  // public, comme odoo-catalog : prix et paliers, ni stock ni lot
  async function prixHorsPage(cips) {
    const rows = await catalogueDe(cips.slice(0, 50));
    return { produits: rows.map(c => ({ cip: c.cip, name: c.name, list_price: num(c.list_price), discounted_price: num(c.discounted_price), discount_pct: num(c.discount_pct), price_tiers: c.price_tiers ?? null })) };
  }

  // ── Page des pharmacies et carte de l'accueil (§ 8, § 10) : sans coût, sans marge ──
  // Base : la fenêtre d'odoo_catalog ; produits « fantômes » (faits de moins de 24 h : aucune boîte courte) retirés de la
  // liste mais renvoyés dans « masques » avec leur prix actuel (une ligne péremption d'un panier enregistré y repasse au prix
  // habituel) ; remise facturée seulement si elle l'est (estAffichee) ; retirees : remises finies depuis 7 jours (prix actuel).
  // Règle du 21/10/2026 : chaque produit porte remise_admin (expiry_discounts, null = défaut) et son offre (offreAffichee :
  // −50 %, −20 % dès 500 €, remise de l'admin ou règle Odoo facturée), la même que la page et le panier recalculent.
  // Remise plus annoncée mais prix du site encore au prix de la remise (Odoo injoignable pendant l'étape A) : la page montre
  // le prix habituel figé à la décision (jamais un prix plus bas que la facture).
  async function etatPublic() {
    const t = maintenant();
    const cat = await sb(`odoo_catalog?select=cip,name,list_price,discounted_price,discount_pct,price_tiers,in_stock,available,earliest_expiry,lots,updated_at&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=gte.${fenetre(t).min}&earliest_expiry=lte.${fenetre(t).max}&order=earliest_expiry.asc&limit=1000`, { anon: true });
    const rows = (Array.isArray(cat) ? cat : []).filter(r => r?.cip).map(r => ({ ...r, lots: Array.isArray(r.lots) ? r.lots : lireJson(r.lots, []) || [] }));
    let R = null, faits = [], decisions = [], regles = [], fins = [], etat = "ok";
    const remises = await lireRemisesAdmin().catch(e => { console.error("[peremption] remises affichées :", court(e)); return {}; });
    try {
      R = await lireReglages();
      const cips = rows.map(r => r.cip);
      [faits, decisions] = await Promise.all([
        cips.length ? sb(`peremption_faits?cip=in.${enc(liste(cips))}&select=cip,court_qte,long_qte,autre_qte,lu_at`) : [],
        decisionsOuvertes(),
      ]);
      regles = await reglesDe(decisions.filter(d => d.statut === "facturee").map(d => d.id));
      fins = (await sb(`peremption_decisions?statut=in.(retrait_demande,retiree)&cachee_at=gte.${enc(iso(t - RETRAIT_VISIBLE_MS))}&simulee=eq.false&select=cip,cachee_at&limit=500`).catch(() => [])) || [];
    } catch (e) { etat = tableAbsente(e) ? "non_installe" : "indisponible"; console.error("[peremption] page :", court(e)); }
    const parCipFait = new Map((faits || []).map(f => [f.cip, f]));
    const parCipDec = new Map((decisions || []).map(d => [d.cip, d]));
    const prixCourant = (c) => ({ cip: c.cip, name: c.name, list_price: num(c.list_price), discounted_price: num(c.discounted_price), discount_pct: num(c.discount_pct), price_tiers: c.price_tiers ?? null, prix: prixAffiche(c) });
    const produits = [], masques = [];
    for (const r0 of rows) {
      const f = parCipFait.get(r0.cip);
      const frais = f && t - Date.parse(f.lu_at) < FAITS_FRAIS_MS;
      const d = parCipDec.get(r0.cip);
      let r = r0;
      const hab = d ? num(lireJson(d.prix_habituel, {})?.[LISTE_SITE]) : null;
      const affichee = R ? estAffichee(d, regles, r0, R.listes, t) : false;
      if (d && !affichee && !d.simulee && d.facturee_at && d.statut !== "modifiee_odoo" && hab > 0 && prixAffiche(r0) < hab - 0.005) {
        const lp = num(r0.list_price);
        r = { ...r0, ...(lp > 0 && hab < lp - 0.004 ? { discounted_price: hab, discount_pct: Math.round((1 - hab / lp) * 1000) / 10 } : { discounted_price: null, discount_pct: 0 }) };
      }
      if (frais && !(f.court_qte >= 1)) { masques.push(prixCourant(r)); continue; }   // « fantôme » : plus aucune boîte courte vendable
      const p = { cip: r.cip, name: r.name, available: r.available, earliest_expiry: r.earliest_expiry, lots: r.lots, list_price: num(r.list_price),
        discounted_price: num(r.discounted_price), discount_pct: num(r.discount_pct), price_tiers: r.price_tiers ?? null, updated_at: r.updated_at,
        court_qte: frais ? f.court_qte : null, prix_base: num(r.list_price), prix: prixAffiche(r), facturee: affichee, remise_admin: remises[r.cip] ?? null };
      if (affichee) {
        // base « % du prix habituel (liste 5) » : la page barre le prix habituel (la remise annoncée s'y rapporte) ; sinon le
        // prix de base, comme la facture (« PU = prix de base, Remise X % »)
        const base = lireJson(d.apercu, {})?.base === "prix_liste5" ? "prix_liste5" : "prix_base";
        Object.assign(p, { remise_pct: d.remise_pct, prix_habituel: hab, prix_barre: base === "prix_liste5" ? hab : num(r.list_price), base_remise: base,
          force_lot_long: !!d.force_lot_long, fin_remise: d.date_fin_regle });
      }
      const o = offreAffichee(p);
      p.offre = { pn: o.pn, base: o.base, remise: o.remise, source: o.source, facture_odoo: o.facture_odoo };
      produits.push(p);
    }
    // remises finies (7 j) : prix actuel du CIP, pour remonter les lignes de panier enregistrées au prix de la remise
    const finis = [...new Set((fins || []).map(x => x.cip))].filter(c => !produits.some(p => p.cip === c && p.facturee));
    const prixFinis = finis.length ? await catalogueDe(finis).catch(() => []) : [];
    const retirees = prixFinis.map(prixCourant);
    return { produits, total: produits.length, facturees: produits.filter(p => p.facturee).length, remises: produits.filter(p => p.offre.remise >= 1).length,
      masques, retirees, etat, seuil_annonce_pct: R?.seuil_annonce_pct ?? 5, maj: iso(t) };
  }

  // ── État de l'admin (§ 7) ──
  async function etatAdmin() {
    const t = maintenant();
    const R = await lireReglages();
    const cat = await catalogueFenetre(t);
    const decisions = await decisionsOuvertes();
    const cips = [...new Set([...cat.map(c => c.cip), ...decisions.map(d => d.cip)])];
    const [faits, regles, recentes, passages, alertes, resume, filets, remisesAdmin] = await Promise.all([
      cips.length ? sb(`peremption_faits?cip=in.${enc(liste(cips))}&select=*`) : [],
      reglesDe(decisions.map(d => d.id)),
      sb(`peremption_decisions?statut=eq.retiree&retiree_at=gte.${enc(iso(t - RETRAIT_VISIBLE_MS))}&select=*&order=retiree_at.desc&limit=200`).catch(() => []),
      sb("peremption_passages?select=id,acteur,mode,debut,fin,statut,resume,curseur,erreurs&order=debut.desc&limit=5").catch(() => []),
      sb(`peremption_journal?action=eq.alerte&at=gte.${enc(iso(t - 7 * 864e5))}&select=at,cip,message,resultat,apres&order=id.desc&limit=50`).catch(() => []),
      sb(`peremption_journal?action=eq.resume&select=at,message,resultat,apres&order=id.desc&limit=1`).catch(() => []),
      sb(`peremption_passages?acteur=eq.filet&statut=in.(fini,erreur)&select=debut,statut,erreurs&order=debut.desc&limit=48`).catch(() => []),
      lireRemisesAdmin().catch(() => ({})),
    ]);
    const catParCip = new Map(cat.map(c => [c.cip, c]));
    const faitsParCip = new Map((faits || []).map(f => [f.cip, f]));
    const catDec = decisions.length ? await catalogueDe(decisions.map(d => d.cip).filter(c => !catParCip.has(c))) : [];
    for (const c of catDec) catParCip.set(c.cip, c);
    const nbPorteuses = decisions.filter(d => !d.simulee && PORTEUSES.includes(d.statut)).length;
    const produits = cips.map(cip => {
      const c = catParCip.get(cip) || null, f = faitsParCip.get(cip) || null, d = decisions.find(x => x.cip === cip) || null;
      const rs = d ? regles.filter(r => r.decision_id === d.id) : [];
      const affichee = estAffichee(d, regles, c, R.listes, t);
      // éligibilité de repère (proposition « À remiser », raisons) : prix habituels figés à la décision s'il y en a une
      const el = f ? eligibilite(f, R, t, { nbFacturees: nbPorteuses, habituels: d ? lireJson(d.prix_habituel, null) : null }) : null;
      const m = d ? lireJson(d.modification, null) : null;
      const frais = f && t - Date.parse(f.lu_at) < FAITS_FRAIS_MS;
      let etat;
      if (d) etat = affichee ? "facture" : d.statut === "facturee" ? "facture_site" : d.statut === "voulue" && m?.baisse ? "baisse" : { voulue: d.simulee ? "simule" : "en_cours", partielle: "partiel", erreur: "erreur", modifiee_odoo: "modifie_odoo", retrait_demande: "retrait" }[d.statut] || d.statut;
      else if (!f) etat = "faits_absents";
      else if ((f.exclusions || []).length) etat = "exclu";
      else if (el?.propose) etat = "a_remiser";
      else etat = el?.statut === "court_epuise" ? "court_epuise" : el?.statut === "sortie_date" ? "sortie_date" : "non_facture";
      // perte prévue sur les faits du jour : boîtes courtes (et longues forcées) × (coût − prix péremption)
      const att = d ? num(lireJson(d.prix_attendu, {})?.[LISTE_SITE]) : null;
      const qte = f ? (f.court_qte || 0) + (d?.force_lot_long ? (f.long_qte || 0) + (f.autre_qte || 0) : 0) : 0;
      const cout = num(f?.cout);
      // offre de la page (règle du 21/10/2026) : remise affichée (défaut, admin) ou règle Odoo facturée ; produit hors de la page
      // (hors de la fenêtre, ou « fantôme » : faits frais sans boîte courte, retiré de la page des pharmacies) : null
      const surPage = cat.some(x => x.cip === cip) && !(frais && !(f.court_qte >= 1));
      const remiseAdm = remisesAdmin[cip] ?? null;
      const o = c && surPage ? offreAffichee({ ...c, remise_admin: remiseAdm, facturee: affichee, remise_pct: d?.remise_pct, prix_base: num(c.list_price),
        prix_barre: d && lireJson(d.apercu, {})?.base === "prix_liste5" ? num(lireJson(d.prix_habituel, {})?.[LISTE_SITE]) : num(c.list_price) }) : null;
      return { cip, nom: f?.nom || c?.name || d?.nom || cip, catalogue: c ? { list_price: num(c.list_price), discounted_price: num(c.discounted_price), discount_pct: num(c.discount_pct), earliest_expiry: c.earliest_expiry, available: c.available } : null,
        remise_admin: remiseAdm, affichage: o ? { pn: o.pn, base: o.base, remise: o.remise, source: o.source, facture_odoo: o.facture_odoo, motif: o.motif } : null,
        faits: f, decision: d ? { ...d, regles: rs.map(r => ({ id: r.id, liste: r.pricelist_id, odoo_item_id: r.odoo_item_id, statut: r.statut, verifiee_at: r.verifiee_at, prix_verifie: num(r.prix_verifie), erreur: r.erreur, date_start: r.date_start, date_end: r.date_end, percent_price: num(r.percent_price) })) } : null,
        etat, affichee, masque: !!(frais && !(f.court_qte >= 1)), propose: !!el?.propose, raisons: el?.raisons || [],
        perte: d && att != null && cout > 0 ? round2(qte * Math.max(0, cout - att)) : null, valeur_cout: d && cout > 0 ? round2(qte * cout) : null };
    });
    const facturees = produits.filter(p => ["facture", "facture_site"].includes(p.etat));
    const sansDecision = produits.filter(p => ["non_facture", "exclu", "a_remiser", "faits_absents"].includes(p.etat));
    const compteurs = { page: cat.length, masques: produits.filter(p => p.masque && catParCip.has(p.cip) && cat.some(c => c.cip === p.cip)).length,
      facturees: produits.filter(p => p.etat === "facture").length, a_remiser: produits.filter(p => p.etat === "a_remiser").length,
      non_facturees: sansDecision.length, en_cours: produits.filter(p => ["en_cours", "baisse", "facture_site"].includes(p.etat)).length,
      en_retrait: produits.filter(p => p.etat === "retrait").length, en_erreur: produits.filter(p => ["erreur", "partiel", "modifie_odoo"].includes(p.etat)).length,
      simulees: produits.filter(p => p.etat === "simule").length,
      remises_affichees: produits.filter(p => p.affichage?.remise >= 1 && !p.masque).length,
      perte_prevue: round2(facturees.reduce((s, p) => s + (p.perte || 0), 0)),
      valeur_court_cout: round2(facturees.reduce((s, p) => s + (p.valeur_cout || 0), 0)) };
    compteurs.visibles = compteurs.page - compteurs.masques;
    // filet horaire : en échec depuis… (passages « erreur » depuis le dernier passage réussi)
    const derniersFilets = filets || [];
    const iOk = derniersFilets.findIndex(x => x.statut === "fini");
    const echecs = iOk === -1 ? derniersFilets : derniersFilets.slice(0, iOk);
    const filet = { dernier_ok: iOk === -1 ? null : derniersFilets[iOk].debut, echec_depuis: echecs.length ? echecs.at(-1).debut : null, erreur: echecs[0]?.erreurs?.[0]?.erreur || null };
    const v = verrous(R, env);
    return { reglages: { ...R, verrou_jusqua: undefined, verrou_passage: undefined, verrou_appel: undefined }, verrous: v, compteurs, produits, retirees_recemment: recentes || [], passages: passages || [], alertes: alertes || [],
      resume_nuit: resume?.[0] || null, filet, verrou: await quiTientLeVerrou(), fenetre: fenetre(t), maj: iso(t) };
  }
  async function journalDe({ cip = null, limit = 100 } = {}) {
    const filtre = cip ? `cip=eq.${enc(cip)}&` : "";
    return (await sb(`peremption_journal?${filtre}select=*&order=id.desc&limit=${Math.min(500, Math.max(1, Number(limit) || 100))}`)) || [];
  }

  return { lireReglages, lireFaits, enregistrerFaits, eligibilite, apercu, appliquer, etape, retirer, reessayer, changerMode, changerReglages, reconcilier, passageNuit,
    etatPublic, etatAdmin, journalDe, droits, ecarts, ecartsResume, changerStatutEcarts, lignesEcarts, remiseAffichee, lireRemisesAdmin, prixHorsPage, commandesEnCours, majPrixSite, prixSiteCalcule, adopterOrphelines, listesEnUsage, planifier, actionDecision,
    creerRegles, retirerRegles, cacher, verifierDecision, decisionsOuvertes, reglesDe, prendreVerrou, rendreVerrou, sb, journal, apercuRetrait, balayerOrphelines,
    signalerEchec,
    // porte d'écriture unique, pour l'essai T1 (scripts/essai-dates-peremption.mjs) : mêmes verrous, même journal
    ecrireOdoo };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
