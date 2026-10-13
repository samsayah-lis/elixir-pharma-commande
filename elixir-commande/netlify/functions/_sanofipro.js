// ── Commandes Sanofi Pro (Dupixent) : traitement automatique ─────────────
// Les pharmacies commandent sur Sanofi Pro en choisissant Elixir comme grossiste ; les commandes
// arrivent sur le portail grossiste https://sanofipro.expepharma.com (connexion e-mail + mot de
// passe, variables SANOFIPRO_EMAIL / SANOFIPRO_PASSWORD).
// Traitement d'une commande = DEUX actions, comme le fait l'équipe à la main :
//   1. la commande est créée dans PharmaML (InfoSoft), d'où le connecteur Odoo la reprend (~4 min) :
//      même envoi que le site de commande (POST commandes.php, « Commande importée via API »),
//      référence PharmaML « SP<référence Sanofi> » ; elle est ensuite retrouvée sur le portail PharmaML ;
//   2. seulement alors, « Traiter » sur le portail Sanofi Pro (POST /api/consignments) : réponse à
//      Sanofi (quantités expédiées). ⚠ « Traiter » NE crée PAS de commande PharmaML (constaté le
//      13/10/2026 : 2 commandes traitées automatiquement, rien dans PharmaML).
// Décisions de Zineb : traitement automatique (12/10/2026), par PharmaML (13/10/2026), quand la pharmacie
// est cliente Elixir et que le stock libre Odoo couvre la quantité ; sinon la commande reste sur le
// portail (traitement à la main) et un e-mail prévient.
//
// Anti-doublon (une 2e commande PharmaML = Dupixent livré deux fois) :
//   - un seul passage à la fois (verrou sp:lock, plus long que la vie d'une fonction) ; les actions
//     admin sur une commande prennent le même verrou ;
//   - état de la commande (sp:ord:<référence Sanofi>) réservé par écriture conditionnelle AVANT l'envoi ;
//     l'envoi PharmaML est noté dans l'état AVANT d'être fait, et n'est jamais refait automatiquement ;
//   - commande relue sur le portail Sanofi Pro juste avant : jamais si elle a déjà un envoi, n'est plus
//     « pending », a changé ou si sa référence apparaît plusieurs fois ;
//   - PharmaML relu juste avant : jamais si la pharmacie y a déjà une commande de ce produit depuis la
//     commande Sanofi (saisie à la main par l'équipe, ou par la pharmacie) → à traiter à la main ;
//   - issue incertaine (panne, délai, envoi non retrouvé) : reprise humaine confirmée seulement.
//
// Stockage kv_store : sp:config, sp:ord:<réf>, sp:ids (documents vus par référence), sp:lock,
// sp:dernier_passage, sp:dernier_complet, sp:alerte_tech, sp:alerte_arret.
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { sb, kvGet, kvGetBrut, kvSet, kvSetSi, kvList, kvCreate, fichePharmacie, esc, dateLongue, jourParis, MAIL_DE, lignesProduit, parisVersDate } from "./_lab-justif.js";

export const PORTAIL_SP = "https://sanofipro.expepharma.com";
const API = (process.env.SANOFIPRO_API || `${PORTAIL_SP}/api`).replace(/\/$/, "");
export const VERROU = "sp:lock";
export const VERROU_MS = 16 * 60e3;     // > 15 min (vie maximale d'une fonction d'arrière-plan)
export const CLE = (ref) => `sp:ord:${ref}`;
const ctx = { allowed_company_ids: [COMPANY_ID], company_id: COMPANY_ID, lang: "fr_FR" };
const TVA = 2.1;                        // taux appliqué par le portail (médicaments remboursables)
const SUIVI_ODOO_H = 48;                // recherche de la commande Odoo pendant 48 h après le traitement
const AVANCE_ODOO_MS = 2 * 60e3;        // tolérance d'horloge pour retrouver la commande Odoo
export const ALERTE_TECH_H = 6;         // panne : un e-mail au plus toutes les 6 h
const MENAGE_JOURS = 400;               // états effacés après ~13 mois (sauf commande encore en attente)
const ABSENCES_MAX = 3;                 // absente de 3 lectures de suite → considérée supprimée du portail
const ENVOI_MAX_MS = 8.5 * 60e3;        // plus de nouvelle réservation après 8 min 30 de passage
const ENVOI_POST_MAX_MS = 9.5 * 60e3;   // plus aucun envoi PharmaML après 9 min 30 (la suite peut durer ~4 min 30 ; fonction tuée à 15 min)
const PHARMAML_URL = (process.env.PHARMAML_URL || "https://pharmaml.elixirpharma.fr").replace(/\/$/, "");
const AVANT_COMMANDE_MS = 15 * 60e3;    // commande PharmaML de la pharmacie depuis (commande Sanofi − 15 min) = déjà saisie ?
export const refPML = (ref) => `SP${ref}`;

// ── Réglages (onglet admin « Sanofi Pro ») ──────────────────────────────
// mode : arret (aucune nouvelle commande) | simulation (aucun envoi ; décisions affichées) | auto_pml (PharmaML puis
// réponse à Sanofi). Dans tous les modes, les commandes déjà envoyées restent suivies (surveillance, Odoo, alertes).
// L'ancien mode « auto » (12/10/2026, « Traiter » seul) n'existe plus : relu comme « simulation ».
export const CONFIG_DEFAUT = { mode: "simulation", ageMaxHeures: 48, maxQteLigne: 3, plafondJour: 30, delaiOdooMin: 45, alertes: "pharmacien@elixirpharma.fr" };
export const MODES = ["arret", "simulation", "auto_pml"];
export const AUTO = "auto_pml";
export async function lireConfig() {
  const c = { ...CONFIG_DEFAUT, ...((await kvGet("sp:config")) || {}) };
  if (!MODES.includes(c.mode)) c.mode = "simulation";
  return c;
}
export const adresses = (s) => [...new Set(String(s || "").toLowerCase().split(/[\s,;]+/).filter(Boolean))];
export const adresseValide = (a) => /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(a);
export function validerConfig(c) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const n = (v, min, max, nom) => { const x = Number(v); if (!Number.isInteger(x) || x < min || x > max) throw bad(`${nom} : entier entre ${min} et ${max}`); return x; };
  if (!MODES.includes(c?.mode)) throw bad("mode inconnu");
  const alertes = adresses(c.alertes);
  if (!alertes.length || alertes.some(a => !adresseValide(a))) throw bad("adresse(s) d'alerte invalide(s)");
  return {
    mode: c.mode, ageMaxHeures: n(c.ageMaxHeures, 1, 168, "Âge maximum (heures)"), maxQteLigne: n(c.maxQteLigne, 1, 50, "Quantité maximum par ligne"),
    plafondJour: n(c.plafondJour, 1, 200, "Plafond par jour"), delaiOdooMin: n(c.delaiOdooMin, 10, 600, "Délai d'arrivée dans Odoo (minutes)"),
    alertes: alertes.join(", "),
  };
}

// ── États d'une commande (sp:ord:<réf>) ─────────────────────────────────
//   nouvelle        reprise demandée depuis l'admin (réexamen, même ancienne)
//   en_attente      pas traitée automatiquement (motif) ; réexaminée à chaque passage jusqu'à l'âge maximum
//   a_traiter_main  trop ancienne, toujours bloquée à l'âge maximum, réapparue ou en double : à traiter sur le portail
//   en_cours        réservée, envoi en cours (etape : pharmaml puis sanofi)
//   a_repondre      commande créée dans PharmaML, mais « Traiter » sur Sanofi Pro a échoué : à faire à la main
//   traitee         commande dans PharmaML + « Traiter » fait ; on attend la commande Odoo
//   dans_odoo       commande Odoo retrouvée
//   absente_odoo    pas de commande Odoo après le délai (alerte) ; on continue de chercher 48 h
//   incertaine      issue inconnue (panne, délai, refus d'identification, envoi non retrouvé) : vérification humaine
//   erreur          refusée (PharmaML ou portail Sanofi Pro), rien de retrouvé
//   portail         traitée, refusée ou supprimée directement sur le portail
//   ignoree         écartée depuis l'admin
// Marqueurs permanents (toute reprise exige alors une confirmation explicite, même après « ignorer ») :
//   issueInconnue  un envoi automatique a eu une issue incertaine ;
//   pml.envoyeA    un envoi PharmaML a été tenté ;
//   envoiPortail   la commande a été traitée sur le portail (COMPLETED / PARTIALLY_COMPLETED / boîtes expédiées) ;
//   plusieursDocs  la référence a été vue avec plusieurs documents sur le portail.
export const OUVERTS = new Set(["en_attente", "nouvelle"]);
export const SUIVIS = new Set(["traitee", "absente_odoo"]);

// ── Portail Sanofi Pro ──────────────────────────────────────────────────
const NON_TRAITABLES = new Set(["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "CANCELED", "REJECTED"]);
// fait : déjà traitée / refusée / annulée ; candidate : nouvelle ; inconnu : statut jamais vu (aucune décision)
export function classer(o) {
  const s = String(o?.status || "");
  if ((o?.consignments || []).length || NON_TRAITABLES.has(s.toUpperCase())) return "fait";
  if (s.toLowerCase() === "pending") return "candidate";
  return "inconnu";
}
export const aTraiter = (o) => classer(o) === "candidate";
// envoi avec au moins une boîte expédiée (un refus du portail crée un envoi à 0)
export const envoiExpedie = (o) => (o?.consignments || []).some(c => (c?.consignmentEntries || []).some(e => Number(e?.shippedQuantity) > 0));
// traitée (au moins en partie) sur le portail Sanofi Pro (la personne a aussi saisi la commande PharmaML)
const expediee = (o) => envoiExpedie(o) || ["COMPLETED", "PARTIALLY_COMPLETED"].includes(String(o?.status || "").toUpperCase());
export const REF_OK = /^[0-9A-Za-z_-]{3,40}$/;

export class PortailSP {
  constructor() { this.jeton = null; }
  // requête complète (en-têtes ET corps) sous délai
  async brut(url, init, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { ...init, signal: ac.signal });
      return { status: r.status, ok: r.ok, texte: await r.text() };
    } finally { clearTimeout(t); }
  }
  async connexion() {
    const email = process.env.SANOFIPRO_EMAIL, password = process.env.SANOFIPRO_PASSWORD;
    if (!email || !password) throw new Error("Identifiants Sanofi Pro absents (variables SANOFIPRO_EMAIL / SANOFIPRO_PASSWORD)");
    const r = await this.brut(`${API}/auth/signin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }, 20000);
    let j = {}; try { j = JSON.parse(r.texte); } catch { /* corps illisible */ }
    if (!r.ok || !j.accessToken) throw new Error(`Connexion au portail Sanofi Pro refusée (HTTP ${r.status}${j.message ? ` : ${String(j.message).slice(0, 120)}` : ""})`);
    this.jeton = j.accessToken;
  }
  // rejouer401 : seulement pour les lectures (un POST n'est jamais renvoyé)
  async requete(methode, chemin, corps, ms, rejouer401 = methode === "GET") {
    if (!this.jeton) await this.connexion();
    const go = () => this.brut(`${API}${chemin}`, { method: methode,
      headers: { Authorization: `Bearer ${this.jeton}`, ...(corps ? { "Content-Type": "application/json" } : {}) },
      body: corps ? JSON.stringify(corps) : undefined }, ms);
    let r = await go();
    if (r.status === 401 && rejouer401) { await this.connexion(); r = await go(); }
    return r;
  }
  // Toutes les commandes (le portail les renvoie en un bloc, plus récentes d'abord ; ~1,5 Mo)
  async commandes() {
    const r = await this.requete("GET", "/orders", null, 45000);
    if (!r.ok) throw new Error(`Portail Sanofi Pro : liste des commandes indisponible (HTTP ${r.status})`);
    let j; try { j = JSON.parse(r.texte); } catch { throw new Error("Portail Sanofi Pro : réponse illisible"); }
    if (!Array.isArray(j)) throw new Error("Portail Sanofi Pro : format de liste inattendu");
    if (!j.length) throw new Error("Portail Sanofi Pro : liste des commandes vide (anomalie du portail)");
    return j;
  }
  // « Traiter » : même requête que le bouton du portail, envoyée UNE fois. Ne lève jamais : { ok, status, message }
  async traiter(payload) {
    try {
      const r = await this.requete("POST", "/consignments", payload, 30000, false);
      let msg = ""; try { msg = JSON.parse(r.texte)?.message || ""; } catch { msg = r.texte; }
      return { ok: r.ok, status: r.status, message: String(Array.isArray(msg) ? msg.join(" ; ") : msg || "").slice(0, 300) };
    } catch (e) { return { ok: false, status: 0, message: e.name === "AbortError" ? "délai dépassé" : String(e.message || e).slice(0, 300) }; }
  }
}

// ── PharmaML (InfoSoft) ─────────────────────────────────────────────────
// Envoi : même requête que le site (submit-order.js, agent local) : POST commandes.php (identifiants
// PHARMAML_USER / PHARMAML_PASS), « Commande importée via API ». Lecture : écran « Produits commandés ›
// Par clients » du portail (session web, lecture seule, comme le module des justificatifs labos).
export class PharmaML {
  async envoyer(corps) {
    if (!process.env.PHARMAML_PASS) return { ok: false, refus: true, status: 0, message: "PHARMAML_PASS non configuré sur Netlify" };
    const url = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(process.env.PHARMAML_USER || "admin")}&P=${encodeURIComponent(process.env.PHARMAML_PASS)}`;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corps), signal: ac.signal, redirect: "manual" });
      const texte = await r.text();
      let j = null; try { j = JSON.parse(texte); } catch { /* HTML ou texte */ }
      const json = !!j && typeof j === "object" && !Array.isArray(j);
      const msg = json ? (j.message || j.errors?.[0]?.message || "") : `réponse non JSON${r.status >= 300 && r.status < 400 ? " (redirection)" : ""} : ${texte.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`;
      // refus explicite : HTTP 4xx ou { status: "error" } (même lecture que submit-order) ; succès : JSON en 2xx
      const refus = (r.status >= 400 && r.status < 500) || (json && j.status === "error");
      return { ok: r.status >= 200 && r.status < 300 && json && j.status !== "error", refus, status: r.status, message: String(msg || "").slice(0, 300), commandes: json ? (j.commandes ?? null) : null };
    } catch (e) { return { ok: false, refus: false, status: 0, message: e.name === "AbortError" ? "délai dépassé" : String(e.message || e).slice(0, 300) }; }
    finally { clearTimeout(t); }
  }
  // lignes commandées d'une pharmacie (CIP) pour des produits (CIP13), depuis une date
  async lignes(cip, codes, termes, depuis) {
    const out = [];
    for (const terme of termes) for (const l of await lignesProduit(terme, depuis, new Date())) {
      if (String(l.Identifiant) !== String(cip) || !codes.includes(String(l.CodeProduit))) continue;
      if (parisVersDate(l.DateCommande).getTime() < depuis.getTime()) continue;
      if (!out.some(x => x.ReferenceCommande === l.ReferenceCommande && x.CodeProduit === l.CodeProduit && x.DateCommande === l.DateCommande)) out.push(l);
    }
    return out;
  }
  // essai sans commande (liste vide) : PharmaML accepte-t-il un envoi venant de Netlify ?
  async essai() { return this.envoyer([]); }
}
// Notre commande PharmaML couvre-t-elle toute la commande Sanofi (chaque produit, commandé ET servi) ?
export function couverture(miennes, lignesSt) {
  if (!miennes.length) return { etat: "absente" };
  if (new Set(miennes.map(l => l.DateCommande)).size > 1) return { etat: "double", detail: `notre référence apparaît dans ${new Set(miennes.map(l => l.DateCommande)).size} commandes PharmaML` };
  const besoin = new Map(); for (const l of lignesSt) besoin.set(l.code, (besoin.get(l.code) || 0) + Number(l.qte || 0));
  const manques = [];
  for (const [code, q] of besoin) {
    const ls = miennes.filter(l => String(l.CodeProduit) === code);
    const cmd = ls.reduce((n, l) => n + (Number(l.QuantiteCommandee) || 0), 0);
    const liv = ls.reduce((n, l) => n + (Number(l.QuantiteLivree) || 0), 0);
    if (cmd < q || liv < q) manques.push(`${code} : commandé ${cmd}, servi ${liv} sur ${q}`);
  }
  const commandees = Object.fromEntries([...besoin.keys()].map(code => [code, miennes.filter(l => String(l.CodeProduit) === code).reduce((n, l) => n + (Number(l.QuantiteCommandee) || 0), 0)]));
  return manques.length ? { etat: "partielle", detail: manques.join(" ; "), commandees } : { etat: "complete" };
}
// termes de recherche du portail PharmaML (le filtre ne marche que sur le libellé) : 1er mot du produit
const termes = (o) => [...new Set((o.orderEntries || []).map(e => (String(e.productName || "").match(/[A-Za-zÀ-ÿ]{3,}/) || [""])[0].toUpperCase()).filter(Boolean))];
const corpsPML = (cip, ref, lignes) => [{ identifiantPML: String(cip), referenceCommande: ref,
  lignes: lignes.map(l => ({ CIP: l.code, libelle: String(l.nom || "").substring(0, 50), quantiteCommandee: l.qte, quantiteLivree: l.qte, prix: l.prix })) }];

// Corps envoyé par le bouton « Traiter » du portail (composant app-treat-order), toutes les lignes
// expédiées en totalité. Reproduit à l'identique, y compris le total TVA 2,1 %.
export function payloadTraitement(o, maintenant = new Date()) {
  const ref = String(o.sanofiOrderReference);
  const lignes = o.orderEntries || [];
  const d = lignes.map(c => {
    const q = Number(c.quantity || 0);
    return { shippedQuantity: String(q), orderEntry: { productCode: c.productCode, quantity: String(c.quantity), confirmedQuantity: String(q),
      basePrice: Number(c.price || 0).toFixed(2), totalPrice: (Number(c.price || 0) * q).toFixed(2) } };
  });
  const f = lignes.map(c => ({ shippedQuantity: String(Number(c.quantity || 0)), productCode: c.productCode, quantity: String(c.quantity) }));
  const jour = maintenant.toISOString().split("T")[0] + "T00:00:00";
  const consignments = lignes.map((N, B) => ({ code: `${ref}_${B + 1}`, trackingID: `${ref}_${B + 1}`, shippingDate: jour,
    consignmentEntries: d.filter(x => x.orderEntry.productCode === N.productCode), status: { code: "SHIPPED" } }));
  const sousTotal = lignes.reduce((s, N) => s + Number(N.price || 0) * Number(N.quantity || 0), 0);
  const taxe = sousTotal * (TVA / 100);
  return {
    sanofiOrderUpdate: { totalTax: taxe.toFixed(2), currency: { isocode: o.currency }, sanofiOrderReference: o.sanofiOrderReference,
      status: { code: "COMPLETED" }, purchaseOrderNumber: o.sanofiOrderReference, totalPrice: (sousTotal + taxe).toFixed(2), subtotal: sousTotal.toFixed(2),
      consignments, wholesalerOrderReference: o.sanofiOrderReference, deliveryCost: "0" },
    consignmentToCreate: { sanofiOrderReference: o.sanofiOrderReference, order: o._id, shippingDate: maintenant.toISOString(), status: "CREATED", consignmentEntries: f },
  };
}

// Résumé d'une commande du portail gardé dans son état (pas d'adresse ni de téléphone)
export const resume = (o) => ({
  ref: String(o.sanofiOrderReference), id: o._id, cip: String(o.cipCode || "").trim(), pharmacien: String(o.pharmacistName || "").trim(),
  date: o.orderDate, par: o.placedBy || "",
  lignes: (o.orderEntries || []).map(e => ({ code: String(e.productCode || ""), nom: String(e.productName || "").trim(), qte: Number(e.quantity), prix: Number(e.price) })),
});
const signature = (o) => (o.orderEntries || []).map(e => `${e.productCode}x${e.quantity}`).sort().join("+");

// ── Contrôles avant traitement ──────────────────────────────────────────
// cache d'un passage : fiches, produits, stock libre restant (moins les commandes traitées pas encore
// arrivées dans Odoo, puis décompté au fil des traitements)
export const nouveauCache = (enVol = new Map()) => ({ pharmacies: new Map(), produits: new Map(), libre: new Map(), enVol, traitesJour: 0 });

async function produitOdoo(code, cache) {
  if (cache.produits.has(code)) return cache.produits.get(code);
  const champs = ["id", "display_name", "free_qty", "qty_available", "active"];
  let [p] = await odoo("product.product", "search_read", [[["barcode", "=", code]]], { fields: champs, limit: 1, context: ctx });
  if (!p) [p] = await odoo("product.product", "search_read", [[["default_code", "=", code]]], { fields: champs, limit: 1, context: ctx });
  const v = p ? { id: p.id, nom: String(p.display_name || "").replace(/^\[\d+\]\s*/, ""), libre: Number(p.free_qty ?? p.qty_available ?? 0) } : null;
  cache.produits.set(code, v);
  if (v && !cache.libre.has(v.id)) cache.libre.set(v.id, v.libre - (cache.enVol.get(v.id) || 0));
  return v;
}

// Prix net envoyé à PharmaML (il devient le prix de la commande Odoo) : celui du site de commande
// (odoo_catalog, liste de prix Odoo n°5 « EUR 2 », synchronisée chaque nuit)
async function prixNet(code, cache) {
  if (!cache.prix) cache.prix = new Map();
  if (!cache.prix.has(code)) {
    const [r] = (await sb(`odoo_catalog?cip=eq.${encodeURIComponent(code)}&select=discounted_price&limit=1`)) || [];
    const v = Number(r?.discounted_price);
    cache.prix.set(code, Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
  }
  return cache.prix.get(code);
}

// → { motif (null = traitable), cle (motif sans chiffre variable : une alerte par cle), pharmacie, lignes }
export async function evaluer(o, cfg, cache) {
  const lignes = o.orderEntries || [];
  if (!lignes.length) return { motif: "commande sans ligne", cle: "lignes" };
  for (const e of lignes) {
    const q = Number(e.quantity);
    if (!Number.isInteger(q) || q < 1) return { motif: `quantité illisible (${e.quantity})`, cle: "qte-illisible" };
    if (q > cfg.maxQteLigne) return { motif: `quantité inhabituelle : ${q} (maximum automatique ${cfg.maxQteLigne} par ligne)`, cle: "qte" };
  }
  const cip = String(o.cipCode || "").trim();
  if (!/^\d{7}$/.test(cip)) return { motif: `CIP de la pharmacie illisible (${cip || "vide"})`, cle: "cip" };
  if (!cache.pharmacies.has(cip)) cache.pharmacies.set(cip, await fichePharmacie({ cip }));
  const f = cache.pharmacies.get(cip);
  if (!f) return { motif: `pharmacie inconnue chez Elixir (CIP ${cip}) : pas de fiche client Elixir avec ce CIP (absente, client bloqué ou autre société)`, cle: `pharmacie:${cip}` };
  const pharmacie = { odooId: f.odooId, nom: f.nom, cip };
  if (f.bloque) return { motif: "client bloqué dans Odoo (fiche archivée ou sans CIP)", cle: `bloque:${cip}`, pharmacie };
  const parProduit = new Map();
  const sortie = [];
  for (const e of lignes) {
    const code = String(e.productCode || "").trim();
    const p = /^\d{13}$/.test(code) ? await produitOdoo(code, cache) : null;
    if (!p) return { motif: `produit inconnu dans Odoo (${code || "code vide"})`, cle: `produit:${code}`, pharmacie };
    const prix = await prixNet(code, cache);
    if (!prix) return { motif: `prix net introuvable pour ${p.nom} (catalogue Odoo du site)`, cle: `prix:${code}`, pharmacie };
    parProduit.set(p.id, (parProduit.get(p.id) || 0) + Number(e.quantity));
    sortie.push({ code, nom: p.nom, qte: Number(e.quantity), produitId: p.id, prix });
  }
  for (const [pid, q] of parProduit) {
    const libre = cache.libre.get(pid) ?? 0;
    if (libre < q) return { motif: `stock libre insuffisant : ${sortie.find(l => l.produitId === pid).nom} (libre ${Math.max(0, libre)}, demandé ${q})`, cle: `stock:${pid}`, pharmacie, lignes: sortie };
  }
  if (cache.traitesJour >= cfg.plafondJour) return { motif: `plafond de ${cfg.plafondJour} traitements automatiques par jour atteint`, cle: "plafond", pharmacie, lignes: sortie };
  return { motif: null, pharmacie, lignes: sortie, parProduit };
}
const decompter = (cache, ev) => { for (const [pid, q] of ev.parProduit || []) cache.libre.set(pid, (cache.libre.get(pid) ?? 0) - q); cache.traitesJour++; };

// ── Suivi : commandes Odoo correspondantes (connecteur PharmaML) ────────
// Par pharmacie : les lignes Odoo (produit, quantité demandée) créées après chaque traitement sont
// attribuées aux commandes traitées dans l'ordre chronologique ; une ligne ne sert qu'une fois
// (deux commandes Sanofi Pro du même produit = deux lignes, ou une ligne de quantité cumulée).
const dateOdoo = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const msOdoo = (s) => new Date(String(s).replace(" ", "T") + "Z").getTime();
// âge d'un envoi pour les fenêtres de suivi (48 h Odoo, 1 h de surveillance) : à partir de la vérification la plus récente
export const repere = (st) => Math.max(new Date(st?.traiteeA || 0).getTime(), new Date(st?.pml?.vu || 0).getTime()) || 0;
export async function suiviOdoo(etats, maintenantMs = Date.now()) {
  const parPharmacie = new Map();
  for (const [ref, { st }] of etats) {
    // toute commande envoyée consomme ses lignes (même « ignorée » après vérification) ; seules les suivies sont créditées
    if (!st?.traiteeA || !st.pharmacie?.odooId) continue;
    if (maintenantMs - repere(st) > SUIVI_ODOO_H * 3600e3) continue;
    const k = Number(st.pharmacie.odooId);
    parPharmacie.set(k, [...(parPharmacie.get(k) || []), { ref, st }]);
  }
  const credits = [];   // { ref, so: [noms] }
  for (const [odooId, liste] of parPharmacie) {
    if (!liste.some(x => SUIVIS.has(x.st.etat) || x.st.etat === "a_repondre")) continue;
    liste.sort((a, b) => String(a.st.traiteeA).localeCompare(String(b.st.traiteeA)) || a.ref.localeCompare(b.ref));
    const pids = [...new Set(liste.flatMap(x => (x.st.lignes || []).map(l => l.produitId)).filter(Boolean))];
    const debut = Math.min(...liste.map(x => new Date(x.st.traiteeA).getTime())) - AVANCE_ODOO_MS;
    const lignes = await odoo("sale.order.line", "search_read", [[
      ["company_id", "=", COMPANY_ID], ["product_id", "in", pids], ["order_id.partner_id", "child_of", [odooId]],
      ["create_date", ">=", dateOdoo(debut)], ["state", "!=", "cancel"],
    ]], { fields: ["order_id", "product_id", "product_uom_qty", "pharmaml_ordered_qty", "create_date"], order: "create_date asc, id asc", limit: 300, context: ctx });
    const reste = lignes.map(l => ({ so: l.order_id?.[1] || "?", pid: l.product_id?.[0], t: msOdoo(l.create_date), q: Number(l.pharmaml_ordered_qty) || Number(l.product_uom_qty) || 0 }));
    for (const { ref, st } of liste) {
      const besoin = new Map();
      for (const l of st.lignes || []) besoin.set(l.produitId, (besoin.get(l.produitId) || 0) + Number(l.qte || 0));
      // commande PharmaML partielle : Odoo recevra ce que PharmaML a enregistré
      if (st.qtePML) for (const l of st.lignes || []) if (st.qtePML[l.code] != null) besoin.set(l.produitId, Number(st.qtePML[l.code]));
      const depuis = new Date(st.traiteeA).getTime() - AVANCE_ODOO_MS;
      const pris = [];   // [ligne, quantité prise] — rendus si la commande n'est pas couverte
      let couverte = true;
      for (const [pid, q] of besoin) {
        let manque = q;
        for (const l of reste) {
          if (manque <= 0) break;
          if (l.pid !== pid || l.t < depuis || l.q <= 0) continue;
          const x = Math.min(l.q, manque); l.q -= x; manque -= x; pris.push([l, x]);
        }
        if (manque > 0) couverte = false;
      }
      if (!couverte) { for (const [l, x] of pris) l.q += x; continue; }
      if (SUIVIS.has(st.etat) || (st.etat === "a_repondre" && !st.odoo)) credits.push({ ref, so: [...new Set(pris.map(([l]) => l.so))], garder: st.etat === "a_repondre" });
    }
  }
  return credits;
}

// ── E-mails (Odoo, depuis pharmacien@elixirpharma.fr) ───────────────────
const heure = (s) => s ? dateLongue(new Date(s)) : "";
export function mailAlertes(items) {
  const n = items.length;
  const urgent = items.filter(i => /DOUBLON|annulée/i.test(i.titre || ""));
  const sujet = (urgent.length ? `⚠ ${urgent.map(i => `${/DOUBLON/i.test(i.titre) ? "DOUBLON PharmaML" : "ANNULÉE chez Sanofi"} ${i.ref}`).join(", ")} — ` : "")
    + (n === 1 ? `Sanofi Pro : commande ${items[0].ref} — ${items[0].titre}` : `Sanofi Pro : ${n} commandes à vérifier`);
  const td = 'style="border:1px solid #d6dde3;padding:5px 8px;vertical-align:top"';
  const lignes = items.map(i => `<tr><td ${td}>${esc(heure(i.date))}</td><td ${td}>${esc(i.ref)}</td><td ${td}>${esc(i.pharmacien)}<br><span style="color:#64748b">CIP ${esc(i.cip)}</span></td>
    <td ${td}>${(i.lignes || []).map(l => `${esc(l.qte)} × ${esc(l.nom)}`).join("<br>")}</td><td ${td}><b>${esc(i.titre)}</b><br>${esc(i.detail || "")}</td></tr>`).join("");
  const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000">
<p>Bonjour,</p>
<p>${n === 1 ? "Cette commande Sanofi Pro demande" : "Ces commandes Sanofi Pro demandent"} votre attention : le traitement automatique ne l'a pas fait${n > 1 ? " pour elles" : ""}, ou son résultat est à vérifier.</p>
<table style="border-collapse:collapse;font-size:10pt"><tr style="background:#f1f5f9"><th ${td}>Commande du</th><th ${td}>Réf. Sanofi</th><th ${td}>Pharmacie</th><th ${td}>Produits</th><th ${td}>Situation</th></tr>${lignes}</table>
<p>Portail : <a href="${PORTAIL_SP}/new-orders">${PORTAIL_SP}/new-orders</a> — suivi : admin du site de commande, onglet « Sanofi Pro ».</p>
<p style="color:#64748b;font-size:9pt">Rappel : « Traiter » sur le portail Sanofi Pro ne fait que répondre à Sanofi ; la commande doit aussi être dans PharmaML, une seule fois (les envois automatiques ont la référence PharmaML « SP » + référence Sanofi).</p>
</div>`;
  return { sujet, corps };
}
export async function envoyerMail(cfg, sujet, corps) {
  const to = adresses(cfg.alertes).filter(adresseValide).join(", ");
  if (!to) throw new Error("aucune adresse d'alerte");
  const id = await odoo("mail.mail", "create", [{ subject: sujet, body_html: corps, email_from: MAIL_DE, email_to: to, auto_delete: false }]);
  await odoo("mail.mail", "send", [[id]]);
  const [m] = await odoo("mail.mail", "read", [[id], ["state", "failure_reason"]]);
  if (m?.state !== "sent") throw new Error(`e-mail d'alerte non parti : ${m?.failure_reason || m?.state || "état inconnu"}`);
}
// Panne (portail, Odoo, statut inconnu…) : un e-mail au plus toutes les 6 h par clé
export async function alerteTechnique(cfg, err, { cle = "sp:alerte_tech", sujet = "Sanofi Pro : traitement automatique en panne" } = {}) {
  const der = await kvGet(cle).catch(() => null);
  if (der?.at && Date.now() - new Date(der.at).getTime() < ALERTE_TECH_H * 3600e3) return false;
  const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt"><p>Bonjour,</p>
<p>Le traitement automatique des commandes Sanofi Pro a un problème :</p><p><b>${esc(String(err?.message || err).slice(0, 600))}</b></p>
<p>Les commandes concernées restent sur le portail (<a href="${PORTAIL_SP}/new-orders">${PORTAIL_SP}/new-orders</a>) : traitez-les à la main en attendant. Prochain e-mail dans ${ALERTE_TECH_H} h au plus tôt si le problème dure.</p></div>`;
  await envoyerMail(cfg, sujet, corps);
  await kvSet(cle, { at: new Date().toISOString(), erreur: String(err?.message || err).slice(0, 300) });
  return true;
}

// des envois réels sont-ils encore suivis (48 h) ? → alertes même hors du mode automatique
export const etatsSuivis = (etats) => [...etats.values()].some(({ st }) => st?.etat === "en_cours"
  || (st?.pml?.ref && Date.now() - Math.max(repere(st), new Date(st.pml.envoyeA || 0).getTime()) < SUIVI_ODOO_H * 3600e3));

export const suiviEnCours = async () => etatsSuivis(new Map((await kvList("sp:ord:", 500)).map(r => [r.key, { st: r.value }])));

// ── Un passage (planifié toutes les 10 min, ou « Vérifier maintenant ») ──
// À appeler sous le verrou sp:lock (VERROU_MS). Tous les écrivains de sp:ord:* (passages, actions
// admin) passent par ce verrou : les écritures du passage n'écrasent donc jamais une décision prise
// pendant qu'il tourne.
export async function passage({ budgetMs = 10 * 60e3, portail = new PortailSP(), pml = new PharmaML(), maintenant = () => new Date(),
  attendre = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const t0 = Date.now();
  const cfg = await lireConfig();
  const journal = [];
  const stats = { vues: 0, traitees: 0, attente: 0, main: 0, incertaines: 0, erreurs: 0, aRepondre: 0, doublons: 0, simulees: 0 };
  // arrêt : aucune nouvelle commande, mais le suivi des envois déjà faits continue (surveillance, Odoo, alertes)
  const arret = cfg.mode === "arret";
  const auto = cfg.mode === AUTO;
  const anomalies = [];       // statuts inconnus, références illisibles → alerte technique
  // simulation : décision qui serait prise pour chaque commande en attente sur le portail (affichée dans l'admin)
  const apercu = [];
  const simuler = (base, decision, motif, pharmacieOdoo = null, lignes = null) =>
    apercu.push({ ref: base.ref, date: base.date, pharmacien: base.pharmacien, cip: base.cip, par: base.par, lignes: lignes || base.lignes, decision, motif, pharmacieOdoo });

  const commandes = await portail.commandes();
  if (commandes.length >= 1000) journal.push(`⚠ Le portail renvoie ${commandes.length} commandes : liste peut-être tronquée`);
  const docs = new Map();     // référence → documents du portail (normalement un seul)
  for (const o of commandes) { const r = String(o.sanofiOrderReference); docs.set(r, [...(docs.get(r) || []), o]); }
  const etats = new Map((await kvList("sp:ord:", 3000)).map(r => [r.key.slice(7), { st: r.value, maj: r.updated_at }]));
  // documents vus par référence au fil des passages (une liste incomplète peut cacher un double)
  const ids = (await kvGet("sp:ids").catch(() => null)) || {};
  let idsModifies = false;
  for (const [r, ds] of docs) {
    const vus = new Set(ids[r] || []);
    for (const d of ds) if (d._id && !vus.has(d._id)) { vus.add(d._id); idsModifies = true; }
    ids[r] = [...vus];
  }
  if (idsModifies) await kvSet("sp:ids", ids).catch(() => {});
  const autresDocs = (ref, id) => (ids[ref] || []).filter(x => x !== id).length;
  const ecrire = async (ref, st) => { st.maj = new Date().toISOString(); await kvSet(CLE(ref), st); etats.set(ref, { st, maj: null }); };
  const histo = (st, etat, motif) => { st.historique = [...(st.historique || []), { at: new Date().toISOString(), etat, ...(motif ? { motif } : {}) }].slice(-20); };
  // alerte gardée dans l'état jusqu'à ce que l'e-mail parte (nouvel essai au passage suivant sinon)
  const alerter = (st, titre, detail, cle = null) => { st.alerteDue = { titre, detail, cle, at: new Date().toISOString() }; };
  const incertaine = (st, motif, detail) => {
    st.etat = "incertaine"; st.motif = motif; delete st.etape; st.issueInconnue = st.issueInconnue || new Date().toISOString();
    histo(st, "incertaine", motif); alerter(st, "issue inconnue", detail); stats.incertaines++;
    journal.push(`⚠ ${st.ref} ${st.pharmacien} : issue inconnue — ${motif}`);
  };
  const aRepondre = (st, motif, partielle = false) => {
    st.etat = "a_repondre"; st.motif = motif; delete st.etape; histo(st, "a_repondre", motif); stats.aRepondre++;
    alerter(st, partielle ? "servie partiellement dans PharmaML : répondre à Sanofi à la main" : "à « Traiter » sur le portail Sanofi Pro",
      partielle ? `${motif}. La commande est dans PharmaML (réf. ${st.pml?.ref}) mais pas en totalité : sur Sanofi Pro, « Traiter » avec les quantités réellement servies. Ne pas la ressaisir dans PharmaML.`
        : `${motif}. La commande est déjà dans PharmaML (réf. ${st.pml?.ref}) : ne pas la ressaisir, seulement cliquer « Traiter » sur Sanofi Pro.`);
    journal.push(`${st.ref} ${st.pharmacien} : dans PharmaML (${st.pml?.ref}), réponse à Sanofi à faire à la main — ${motif}`);
  };
  // deux commandes PharmaML pour une seule commande Sanofi : à annuler avant expédition
  const doublon = (st, lignes, contexte) => {
    const avant = ["a_repondre", "annulee_sanofi"].includes(st.etat) ? { etat: st.etat, motif: st.motif } : null;
    if (avant) st.avantDoublon = avant;
    st.doublon = lignes.slice(0, 5).map(l => ({ ref: l.ReferenceCommande, date: l.DateCommande, qte: l.QuantiteCommandee }));
    st.etat = "doublon_pml"; st.motif = `doublon PharmaML probable : ${contexte}`; delete st.etape; histo(st, "doublon_pml", st.motif); stats.doublons++;
    const plus = avant?.etat === "a_repondre" ? ` EN PLUS : Sanofi Pro n'a PAS encore été répondu (${avant.motif}) — « Traiter » une seule fois après avoir annulé le doublon.`
      : avant?.etat === "annulee_sanofi" ? ` EN PLUS : commande ${st.statutPortail} chez Sanofi Pro — ne livrer AUCUNE des commandes PharmaML avant vérification.` : "";
    alerter(st, `DOUBLON PharmaML probable${avant?.etat === "a_repondre" ? " + « Traiter » à faire" : avant ? " + annulée chez Sanofi" : ""}`,
      `${contexte}. Commandes PharmaML de la pharmacie pour ce produit : ${[st.pml?.ref, ...st.doublon.map(d => `${d.ref} (${d.date})`)].filter(Boolean).join(", ")}. Annuler l'une des deux (PharmaML ou commande Odoo) AVANT expédition.${plus}`);
    journal.push(`⚠⚠ ${st.ref} ${st.pharmacien} : doublon PharmaML probable — ${contexte}`);
  };
  const annuleeSanofi = (st, statut) => {
    st.etat = "annulee_sanofi"; st.statutPortail = statut; st.motif = `${statut} sur Sanofi Pro alors que la commande est dans PharmaML`; delete st.etape;
    histo(st, "annulee_sanofi", st.motif);
    alerter(st, "annulée sur Sanofi Pro mais déjà dans PharmaML", `Commande dans PharmaML (réf. ${st.pml?.ref}) mais ${statut} sur Sanofi Pro : retenir ou annuler la commande Odoo avant expédition.`);
    journal.push(`⚠ ${st.ref} ${st.pharmacien} : ${st.motif}`);
  };
  // lecture PharmaML pour une commande : nos lignes (réf. SP…) et celles d'une autre origine (même pharmacie,
  // mêmes produits, depuis la commande Sanofi − 15 min) ; nos envois pour d'autres commandes Sanofi ne comptent pas
  const lirePML = async (st, refP) => {
    const lignes = await pml.lignes(st.cip, (st.lignes || []).map(l => l.code), st.termes?.length ? st.termes : ["DUPIXENT"],
      new Date(new Date(st.date).getTime() - AVANT_COMMANDE_MS));
    const nos = new Set([...etats.entries()].filter(([r]) => r !== st.ref).map(([, v]) => v.st?.pml?.ref).filter(Boolean));
    const miennes = lignes.filter(l => l.ReferenceCommande === refP);
    return { miennes, etrangeres: lignes.filter(l => l.ReferenceCommande !== refP && !nos.has(l.ReferenceCommande)), couv: couverture(miennes, st.lignes || []) };
  };
  // moment où notre commande est arrivée dans PharmaML (pour retrouver la commande Odoo)
  const arrivee = (st, miennes) => {
    const t = miennes.map(l => parisVersDate(l.DateCommande).getTime()).filter(Number.isFinite);
    return st.pml?.envoyeA || (t.length ? new Date(Math.min(...t)).toISOString() : null) || new Date().toISOString();
  };
  let panneControle = null;     // Odoo / PharmaML injoignable : alerte technique

  // 1. États ouverts, interrompus ou à surveiller dont la commande a changé
  for (const [ref, { st }] of etats) {
    if (!st) continue;
    const ds = docs.get(ref) || [];
    if (st.etat === "en_cours") {
      // passage précédent mort pendant le traitement (le verrou dure plus longtemps qu'une fonction : il ne tourne plus)
      if (st.pml?.envoyeA || st.etape === "sanofi") {
        let r;
        try { r = await lirePML(st, st.pml?.ref); }
        catch (e) {
          panneControle = panneControle || e;
          journal.push(`${ref} : PharmaML illisible après un passage interrompu (${e.message})`);
          const depuis = (Date.now() - new Date(st.pml?.envoyeA || st.reserveeA).getTime()) / 60e3;
          if (depuis > 30) incertaine(st, `passage interrompu après l'envoi PharmaML et portail PharmaML illisible (${e.message})`, `La commande est peut-être déjà dans PharmaML (réf. ${st.pml?.ref}) : vérifiez avant toute action, ne pas la ressaisir.`);
          else if (!st.alerteIllisibleA) { st.alerteIllisibleA = new Date().toISOString(); alerter(st, "envoi PharmaML à vérifier", `Passage interrompu après l'envoi PharmaML (réf. ${st.pml?.ref}) et portail PharmaML illisible : la commande est peut-être déjà dans PharmaML, ne pas la ressaisir.`); }
          await ecrire(ref, st);
          continue;
        }
        if (r.etrangeres.length) doublon(st, r.etrangeres, "passage interrompu : une autre commande PharmaML de la pharmacie existe pour ce produit");
        else if (r.couv.etat === "double") doublon(st, r.miennes, r.couv.detail);
        else if (r.couv.etat === "absente") incertaine(st, "passage interrompu pendant l'envoi PharmaML", `Envoi PharmaML (réf. ${st.pml?.ref}) tenté mais commande non retrouvée sur le portail PharmaML. Vérifiez PharmaML avant toute action.`);
        else {
          st.pml.vu = st.pml.vu || new Date().toISOString(); st.traiteeA = st.traiteeA || arrivee(st, r.miennes);
          if (r.couv.etat === "partielle") aRepondre(st, `passage interrompu ; ${r.couv.detail}`, true);
          else if (ds.length === 1 && classer(ds[0]) === "fait") {
            if (!expediee(ds[0])) annuleeSanofi(st, ds[0].status);
            else if (st.etape === "sanofi") { histo(st, "traitee", "réponse à Sanofi retrouvée après un passage interrompu"); st.etat = "traitee"; delete st.etape; }
            // « Traiter » fait par quelqu'un pendant l'interruption : l'équipe a peut-être aussi saisi la commande
            else doublon(st, [], "commande traitée à la main sur Sanofi Pro pendant un passage interrompu, après notre envoi PharmaML : vérifiez qu'elle n'a pas été saisie une 2e fois");
          } else aRepondre(st, "passage interrompu après l'envoi PharmaML");
        }
      } else if (ds.length === 1 && classer(ds[0]) === "fait") {
        // rien n'a été envoyé par l'automate, mais la commande a été traitée sur le portail entre-temps
        histo(st, "portail", `traitée sur le portail (statut ${ds[0].status})`); st.etat = "portail"; st.statutPortail = ds[0].status; delete st.etape;
        if (expediee(ds[0])) st.envoiPortail = st.envoiPortail || new Date().toISOString();
      } else { histo(st, "en_attente", "passage interrompu avant tout envoi"); st.etat = "en_attente"; st.motif = "passage interrompu avant tout envoi : réexamen"; delete st.etape; }
      await ecrire(ref, st);
      continue;
    }
    // surveillance 1 h après l'envoi : une saisie manuelle de la même commande, ou une 2e copie de la nôtre = doublon
    if (["traitee", "absente_odoo", "dans_odoo", "a_repondre"].includes(st.etat) && st.pml?.ref && !st.doublon && Date.now() - repere(st) < 60 * 60e3) {
      try {
        const r = await lirePML(st, st.pml.ref);
        if (r.etrangeres.length) { doublon(st, r.etrangeres, "une autre commande PharmaML de la pharmacie pour ce produit est apparue après notre envoi"); await ecrire(ref, st); continue; }
        if (r.couv.etat === "double") { doublon(st, r.miennes, r.couv.detail); await ecrire(ref, st); continue; }
      } catch (e) { journal.push(`${ref} : surveillance PharmaML impossible (${e.message})`); }
    }
    // envoi en issue inconnue / refusé / ignoré : notre commande peut arriver tard dans PharmaML (48 h de surveillance)
    if (["incertaine", "erreur", "ignoree"].includes(st.etat) && st.pml?.envoyeA && !st.pml.vu && !st.traiteeA && !st.doublon && !st.arriveeTardive
      && Date.now() - new Date(st.pml.envoyeA).getTime() < SUIVI_ODOO_H * 3600e3) {
      try {
        const r = await lirePML(st, st.pml.ref);
        if (r.couv.etat !== "absente") {
          st.arriveeTardive = new Date().toISOString(); st.pml.vu = st.pml.vu || st.arriveeTardive;
          if (r.etrangeres.length || r.couv.etat === "double") doublon(st, r.etrangeres.length ? r.etrangeres : r.miennes, "notre envoi PharmaML (issue inconnue) est arrivé tardivement alors qu'une autre commande PharmaML existe");
          else if (ds.length === 1 && classer(ds[0]) === "fait") {
            if (expediee(ds[0])) doublon(st, [], `notre envoi PharmaML (réf. ${st.pml.ref}) est arrivé tardivement alors que la commande a été traitée à la main sur Sanofi Pro : vérifiez qu'elle n'a pas été saisie une 2e fois`);
            else { st.traiteeA = st.traiteeA || arrivee(st, r.miennes); annuleeSanofi(st, ds[0].status); }
          } else {
            st.traiteeA = st.traiteeA || arrivee(st, r.miennes);
            if (r.couv.etat === "partielle") { st.qtePML = r.couv.commandees; aRepondre(st, `arrivée tardive dans PharmaML ; ${r.couv.detail}`, true); }
            else aRepondre(st, "notre envoi PharmaML (issue inconnue) est arrivé tardivement : la commande est dans PharmaML");
          }
          await ecrire(ref, st);
          continue;
        }
      } catch (e) { journal.push(`${ref} : surveillance PharmaML impossible (${e.message})`); }
    }
    if (st.etat === "a_repondre") {
      if (ds.length === 1 && classer(ds[0]) === "fait") {
        if (expediee(ds[0])) {
          histo(st, "traitee", `réponse à Sanofi faite sur le portail (statut ${ds[0].status})`); st.etat = "traitee"; st.statutPortail = ds[0].status; delete st.alerteDue;
          if (st.odoo?.length) { histo(st, "dans_odoo", st.odoo.join(", ")); st.etat = "dans_odoo"; }
        } else annuleeSanofi(st, ds[0].status);
        await ecrire(ref, st);
      }
      continue;
    }
    if (!(OUVERTS.has(st.etat) || st.etat === "a_traiter_main")) continue;
    if (!ds.length) {
      // absente de la liste : suppression, ou liste incomplète du portail → plusieurs lectures avant de conclure
      st.absences = (st.absences || 0) + 1;
      if (st.absences >= ABSENCES_MAX) { histo(st, "portail", `absente de ${st.absences} lectures du portail (supprimée ?)`); st.etat = "portail"; st.motif = "supprimée du portail"; delete st.alerteDue; }
      await ecrire(ref, st);
      continue;
    }
    if (st.absences) { delete st.absences; await ecrire(ref, st); }
    if (ds.length > 1) continue;                                      // référence en double : traitée à l'étape 3
    const c = classer(ds[0]);
    if (c === "fait") {
      histo(st, "portail", `traitée sur le portail (statut ${ds[0].status})`); st.etat = "portail"; st.statutPortail = ds[0].status; delete st.alerteDue;
      if (expediee(ds[0])) st.envoiPortail = st.envoiPortail || new Date().toISOString();
      await ecrire(ref, st);
    }
    else if (c === "inconnu") anomalies.push(`${ref} : statut « ${ds[0].status} »`);
  }

  // 2. Suivi : les commandes envoyées sont-elles arrivées dans Odoo ?
  let suiviOk = true;
  try {
    const credits = await suiviOdoo(etats);
    for (const { ref, so, garder } of credits) {
      const st = etats.get(ref).st;
      st.odoo = so;
      if (garder) histo(st, st.etat, `commande Odoo ${so.join(", ")} (réponse à Sanofi toujours à faire)`);
      else { histo(st, "dans_odoo", so.join(", ")); st.etat = "dans_odoo"; delete st.alerteDue; }
      await ecrire(ref, st);
    }
  } catch (e) { suiviOk = false; journal.push(`Suivi Odoo impossible : ${e.message}`); }
  // envoyée sans commande Odoo retrouvée après le délai → alerte (aussi si le suivi a été impossible longtemps)
  for (const [ref, { st }] of etats) {
    if (st?.etat !== "traitee") continue;
    if (st.odoo?.length) { histo(st, "dans_odoo", st.odoo.join(", ")); st.etat = "dans_odoo"; await ecrire(ref, st); continue; }
    const ageMin = (Date.now() - repere(st)) / 60e3;
    if (ageMin <= cfg.delaiOdooMin || (!suiviOk && ageMin <= SUIVI_ODOO_H * 60)) continue;
    histo(st, "absente_odoo"); st.etat = "absente_odoo";
    alerter(st, `absente d'Odoo ${Math.round(ageMin)} min après l'envoi PharmaML`,
      `Envoyée dans PharmaML${st.pml?.ref ? ` (réf. ${st.pml.ref})` : ""}, mais pas de commande Odoo correspondante pour cette pharmacie et ce produit. Vérifiez le portail PharmaML (commande « En attente » ou perdue par le connecteur) avant de la saisir à la main.`);
    await ecrire(ref, st);
  }

  // 3. Nouvelles commandes (plus anciennes d'abord)
  // stock déjà promis : commandes envoyées (ou peut-être envoyées) pas encore retrouvées dans Odoo
  const enVol = new Map();
  for (const { st } of etats.values()) {
    const promise = SUIVIS.has(st?.etat) || st?.etat === "a_repondre" || (st?.etat === "incertaine" && st.pml?.envoyeA);
    const t = Math.max(repere(st), new Date(st?.pml?.envoyeA || 0).getTime());
    if (!promise || st.odoo || !(Date.now() - t <= SUIVI_ODOO_H * 3600e3)) continue;   // au-delà, free_qty d'Odoo en tient compte
    for (const l of st.lignes || []) if (l.produitId) enVol.set(l.produitId, (enVol.get(l.produitId) || 0) + Number(l.qte || 0));
  }
  const cache = nouveauCache(enVol);
  const aujourdHui = jourParis(maintenant());
  // plafond : tout envoi PharmaML du jour compte, quelle qu'en soit l'issue
  for (const { st } of etats.values()) { const t = st?.pml?.envoyeA || st?.traiteeA; if (t && jourParis(new Date(t)) === aujourdHui) cache.traitesJour++; }
  for (const o of commandes) if (classer(o) === "inconnu" && !etats.has(String(o.sanofiOrderReference))) anomalies.push(`${o.sanofiOrderReference} : statut « ${o.status} »`);

  const candidates = arret ? [] : commandes.filter(aTraiter).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)));
  if (arret) journal.push("Traitement automatique arrêté (réglage) : seul le suivi des commandes déjà envoyées continue");
  for (const o of candidates) {
    const ref = String(o.sanofiOrderReference);
    if (!REF_OK.test(ref)) { anomalies.push(`référence illisible « ${ref.slice(0, 40)} »`); continue; }
    stats.vues++;
    const cur = etats.get(ref);
    const st0 = cur?.st;
    const nDocs = (docs.get(ref) || []).length;
    const base = { ...resume(o), termes: termes(o), ...(st0 ? { historique: st0.historique, forcer: st0.forcer, motif: st0.motif, cle: st0.cle, alerteCle: st0.alerteCle, alerteDue: st0.alerteDue, alerteA: st0.alerteA,
      vueA: st0.vueA, issueInconnue: st0.issueInconnue, envoiPortail: st0.envoiPortail, statutPortail: st0.statutPortail, plusieursDocs: st0.plusieursDocs, traiteeA: st0.traiteeA, pml: st0.pml }
      : { vueA: new Date().toISOString() }) };
    // déjà décidée (traitée, incertaine, à la main, ignorée…) : rien à faire, sauf « portail » redevenue en attente
    if (st0 && !OUVERTS.has(st0.etat) && st0.etat !== "portail") continue;
    // à la main (jamais automatique) : en double sur le portail, réapparue « pending » après « portail »,
    // ou envoi PharmaML déjà tenté (une reprise confirmée efface ce blocage)
    const nAutres = autresDocs(ref, o._id);
    const aLaMain = nDocs > 1 ? `référence présente ${nDocs} fois sur le portail`
      : nAutres ? `référence déjà vue sur le portail avec ${nAutres} autre(s) document(s)`
      : st0?.etat === "portail" ? `de nouveau « pending » sur le portail (était : ${st0.statutPortail ? `statut ${st0.statutPortail}` : st0.motif || "traitée sur le portail"})`
      : st0?.pml?.envoyeA && !st0.forcer ? `envoi PharmaML déjà tenté le ${dateLongue(new Date(st0.pml.envoyeA))} (réf. ${st0.pml.ref})` : null;
    if (aLaMain) {
      if (nDocs > 1 || nAutres) base.plusieursDocs = true;
      if (!auto) { journal.push(`SIMULATION ${ref} : à traiter à la main — ${aLaMain}`); simuler(base, "a_traiter_main", aLaMain); stats.main++; continue; }
      const st = { ...base, etat: "a_traiter_main", motif: aLaMain }; histo(st, "a_traiter_main", aLaMain);
      alerter(st, "à traiter à la main", `${aLaMain} : vérifiez avant tout traitement`);
      await ecrire(ref, st); stats.main++;
      continue;
    }
    if (Date.now() - t0 > budgetMs) { journal.push("Temps du passage écoulé : suite au prochain passage"); break; }
    const ageH = (maintenant().getTime() - new Date(o.orderDate).getTime()) / 3600e3;

    // trop ancienne pour un traitement automatique (mise en route, ou bloquée depuis trop longtemps)
    if (!(ageH <= cfg.ageMaxHeures) && !st0?.forcer) {
      const motif = st0 ? `toujours en attente après ${cfg.ageMaxHeures} h (${st0.motif || "?"})` : `commande de plus de ${cfg.ageMaxHeures} h, laissée au traitement manuel`;
      if (!auto) { journal.push(`SIMULATION ${ref} : à traiter à la main — ${motif}`); simuler(base, "a_traiter_main", motif); stats.main++; continue; }
      const st = { ...base, etat: "a_traiter_main", motif }; histo(st, "a_traiter_main", motif);
      alerter(st, "à traiter à la main", motif);
      await ecrire(ref, st); stats.main++;
      continue;
    }

    const ev = await evaluer(o, cfg, cache).catch(e => ({ motif: null, erreur: e }));
    if (ev.erreur) { journal.push(`${ref} : contrôle impossible (${ev.erreur.message}) — prochain passage`); panneControle = panneControle || ev.erreur; continue; }
    if (ev.motif) {
      stats.attente++;
      if (!auto) { journal.push(`SIMULATION ${ref} ${base.pharmacien} : resterait en attente — ${ev.motif}`); simuler(base, "en_attente", ev.motif, ev.pharmacie?.nom); continue; }
      const st = { ...base, etat: "en_attente", motif: ev.motif, cle: ev.cle, pharmacie: ev.pharmacie || base.pharmacie, lignes: ev.lignes || base.lignes };
      const nouvelleCle = !st0 || st0.etat !== "en_attente" || st0.cle !== ev.cle;
      if (nouvelleCle) histo(st, "en_attente", ev.motif);
      // une alerte par cause (le stock affiché peut varier sans nouvel e-mail)
      const aAlerter = st.alerteCle !== ev.cle && st.alerteDue?.cle !== ev.cle;
      if (aAlerter) alerter(st, "non traitée automatiquement", ev.motif, ev.cle);
      if (nouvelleCle || aAlerter || st0.motif !== ev.motif) await ecrire(ref, st);
      continue;
    }
    // termes de recherche PharmaML : libellé Sanofi, sinon nom Odoo ; aucun → on ne peut pas vérifier, rien n'est envoyé
    if (!base.termes.length) base.termes = [...new Set(ev.lignes.map(l => (String(l.nom).match(/[A-Za-zÀ-ÿ]{3,}/) || [""])[0].toUpperCase()).filter(Boolean))];
    if (!base.termes.length) { anomalies.push(`${ref} : aucun libellé pour chercher la commande dans PharmaML`); continue; }
    const vue = { ...base, lignes: ev.lignes };
    // PharmaML : la pharmacie y a-t-elle déjà une commande de ce produit depuis la commande Sanofi ?
    // (équipe qui l'a saisie à la main, ou pharmacie qui a aussi commandé depuis son logiciel)
    let pre;
    try { pre = await lirePML(vue, refPML(ref)); }
    catch (e) { journal.push(`${ref} : portail PharmaML illisible (${e.message}) — prochain passage`); panneControle = panneControle || e; continue; }
    const motifEtranger = (l0) => `la pharmacie a déjà une commande PharmaML de ce produit depuis la commande Sanofi (réf. ${l0.ReferenceCommande}, ${l0.DateCommande}) : déjà saisie à la main ? Si oui, il ne reste qu'à cliquer « Traiter » sur Sanofi Pro`;
    if (pre.etrangeres.length) {
      const motif = motifEtranger(pre.etrangeres[0]);
      if (!auto) { journal.push(`SIMULATION ${ref} : à traiter à la main — ${motif}`); simuler(base, "a_traiter_main", motif, ev.pharmacie.nom, ev.lignes); stats.main++; continue; }
      const st = { ...base, etat: "a_traiter_main", motif, pharmacie: ev.pharmacie, lignes: ev.lignes, deja: pre.etrangeres.slice(0, 5).map(l => ({ ref: l.ReferenceCommande, date: l.DateCommande, qte: l.QuantiteCommandee })) };
      histo(st, "a_traiter_main", motif); alerter(st, "à traiter à la main", motif);
      await ecrire(ref, st); stats.main++;
      continue;
    }
    const detail = ev.lignes.map(l => `${l.qte} × ${l.nom} à ${l.prix.toFixed(2)} €`).join(", ");
    if (!auto) {
      const dejaEnv = pre.couv.etat !== "absente";
      journal.push(`SIMULATION ${ref} ${base.pharmacien} (${ev.pharmacie.nom}) : ${dejaEnv ? `déjà dans PharmaML (réf. ${refPML(ref)}, ${pre.couv.etat}) : serait seulement traitée sur Sanofi Pro` : `serait envoyée dans PharmaML (réf. ${refPML(ref)}) puis traitée`} — ${detail}`);
      simuler(base, "serait_traitee", dejaEnv ? "déjà dans PharmaML : « Traiter » seulement" : null, ev.pharmacie.nom, ev.lignes); stats.simulees++; decompter(cache, ev); continue;
    }

    // coupe-circuit : un envoi automatique en échec (issue inconnue, refus PharmaML, doublon) non encore vu par
    // quelqu'un suspend tous les envois automatiques (« Ignorer » ou « Traiter automatiquement » le lève)
    const bloquant = [...etats.entries()].find(([r, v]) => r !== ref && v.st?.pml?.ref && ["incertaine", "erreur", "doublon_pml"].includes(v.st.etat));
    if (bloquant) {
      const motif = `envois automatiques suspendus : la commande ${bloquant[0]} (${bloquant[1].st.pharmacien}) est « ${bloquant[1].st.etat} » — à vérifier dans l'onglet Sanofi Pro (Ignorer ou Traiter automatiquement)`;
      stats.attente++;
      const st = { ...base, etat: "en_attente", motif, cle: "suspendu", pharmacie: ev.pharmacie, lignes: ev.lignes };
      const nouvelle = !st0 || st0.etat !== "en_attente" || st0.cle !== "suspendu";
      if (nouvelle) histo(st, "en_attente", motif);
      const aAlerter = st.alerteCle !== "suspendu" && st.alerteDue?.cle !== "suspendu";
      if (aAlerter) alerter(st, "non traitée automatiquement", motif, "suspendu");
      if (nouvelle || aAlerter || st0.motif !== motif) await ecrire(ref, st);
      continue;
    }

    // ── traitement ──
    // arrêt demandé pendant le passage, ou passage trop long : on s'arrête avant de réserver
    const mode = (await kvGet("sp:config").catch(() => ({ mode: "?" })))?.mode;
    if (mode !== AUTO) { journal.push("Mode automatique quitté pendant le passage : commandes restantes laissées au prochain passage"); break; }
    if (Date.now() - t0 > ENVOI_MAX_MS) { journal.push("Passage trop long : envois reportés au prochain passage"); break; }
    const st = { ...base, etat: "en_cours", etape: "pharmaml", pharmacie: ev.pharmacie, lignes: ev.lignes, reserveeA: new Date().toISOString(), motif: null, cle: null };
    delete st.alerteDue;     // ancienne alerte « non traitée » devenue sans objet
    histo(st, "en_cours");
    st.maj = new Date().toISOString();
    let majLue = cur?.maj;
    if (cur && !majLue) majLue = (await kvGetBrut(CLE(ref)).catch(() => null))?.maj;   // état réécrit plus tôt dans ce passage
    if (cur && !majLue) { journal.push(`${ref} : version de l'état illisible — prochain passage`); continue; }
    const pris = cur ? await kvSetSi(CLE(ref), st, majLue) : await kvCreate(CLE(ref), st);
    if (!pris) { journal.push(`${ref} : modifiée pendant le passage — prochain passage`); continue; }
    etats.set(ref, { st, maj: null });
    const remettre = async (etat, motif) => { st.etat = etat; st.motif = motif; delete st.etape; histo(st, etat, motif); await ecrire(ref, st); };
    // relecture Sanofi Pro juste avant : quelqu'un a pu la traiter sur le portail entre-temps
    let memes;
    try { memes = (await portail.commandes()).filter(x => String(x.sanofiOrderReference) === ref); }
    catch (e) { await remettre("en_attente", `relecture du portail impossible juste avant l'envoi (${e.message})`); journal.push(`${ref} : relecture impossible, rien envoyé`); continue; }
    if (!memes.length) { await remettre("en_attente", "introuvable à la relecture du portail : réexamen au prochain passage"); continue; }
    if (memes.length > 1 || memes[0]._id !== o._id || autresDocs(ref, o._id)) { await remettre("en_attente", "référence en double ou document changé sur le portail : réexamen au prochain passage"); continue; }
    const frais = memes[0];
    if (!aTraiter(frais)) {
      st.statutPortail = frais.status; if (expediee(frais)) st.envoiPortail = st.envoiPortail || new Date().toISOString();
      await remettre("portail", `traitée sur le portail entre-temps (statut ${frais.status})`); continue;
    }
    if (signature(frais) !== signature(o) || String(frais.cipCode).trim() !== String(o.cipCode).trim()) { await remettre("en_attente", "commande modifiée sur le portail : réexamen au prochain passage"); continue; }
    // PharmaML relu juste avant l'envoi (une saisie manuelle a pu arriver pendant la relecture Sanofi Pro)
    let re;
    try { re = await lirePML(st, refPML(ref)); }
    catch (e) { panneControle = panneControle || e; await remettre("en_attente", `portail PharmaML illisible juste avant l'envoi (${e.message})`); continue; }
    if (re.etrangeres.length) {
      st.deja = re.etrangeres.slice(0, 5).map(l => ({ ref: l.ReferenceCommande, date: l.DateCommande, qte: l.QuantiteCommandee }));
      const motif = motifEtranger(re.etrangeres[0]);
      alerter(st, "à traiter à la main", motif); await remettre("a_traiter_main", motif); stats.main++;
      continue;
    }

    // 1/2 — PharmaML : envoi noté AVANT d'être fait (jamais refait automatiquement), puis retrouvé sur le portail
    let r = re, envoi = null, etrangeresVues = [];
    if (re.couv.etat !== "absente") {
      // déjà dans PharmaML avec NOTRE référence (envoi d'un passage précédent arrivé tard) : jamais renvoyée
      st.pml = { ...(st.pml || {}), ref: refPML(ref), retrouveeAvantEnvoi: new Date().toISOString() };
      histo(st, "en_cours", `déjà dans PharmaML (réf. ${st.pml.ref}) : pas de nouvel envoi`);
    } else {
      if (Date.now() - t0 > ENVOI_POST_MAX_MS) { await remettre("en_attente", "passage trop long : envoi PharmaML reporté au prochain passage"); journal.push("Passage trop long : envois reportés au prochain passage"); break; }
      st.pml = { ref: refPML(ref), envoyeA: new Date().toISOString() };
      await ecrire(ref, st);
      // une ligne PharmaML par produit (deux lignes Sanofi du même produit sont regroupées)
      const parCode = Object.values(ev.lignes.reduce((m, l) => { (m[l.code] ||= { ...l, qte: 0 }).qte += l.qte; return m; }, {}));
      envoi = await pml.envoyer(corpsPML(base.cip, st.pml.ref, parCode));
      st.pml.reponse = { http: envoi.status, message: envoi.message, commandes: envoi.commandes };
      decompter(cache, ev);    // stock et plafond comptés dès l'envoi, quelle qu'en soit l'issue
      let lectureOk = false;
      for (const ms of [1500, 4000, 8000, 15000]) {
        await attendre(ms);
        try { r = await lirePML(st, st.pml.ref); lectureOk = true; } catch (e) { journal.push(`${ref} : lecture PharmaML impossible (${e.message})`); continue; }
        if (r.etrangeres.length) etrangeresVues = r.etrangeres;
        if (r.couv.etat === "complete" || r.couv.etat === "double") break;
      }
      if (!lectureOk || r.couv.etat === "absente") {
        if (envoi.refus && lectureOk) {
          st.etat = "erreur"; st.motif = `PharmaML a refusé l'envoi (HTTP ${envoi.status}${envoi.message ? ` : ${envoi.message}` : ""})`;
          delete st.etape; histo(st, "erreur", st.motif); stats.erreurs++;
          alerter(st, "refusée par PharmaML", `${st.motif}. Commande non retrouvée dans PharmaML : à traiter à la main (saisie PharmaML puis « Traiter »).`);
          journal.push(`⚠ ${ref} ${base.pharmacien} : ${st.motif} — à traiter à la main`);
        } else {
          const motif = `envoi PharmaML ${envoi.ok ? "accepté" : envoi.status ? `HTTP ${envoi.status}` : "sans réponse"}${envoi.message ? ` (${envoi.message})` : ""} mais commande non retrouvée sur le portail PharmaML${lectureOk ? "" : " (portail illisible)"}`;
          incertaine(st, motif, `${motif}. Vérifiez PharmaML (réf. ${st.pml.ref}) avant toute action : pas de nouvel envoi automatique.`);
        }
        await ecrire(ref, st);
        journal.push("Envoi PharmaML en échec : plus aucun envoi dans ce passage");
        break;
      }
    }
    if (r.couv.etat === "double") { doublon(st, r.miennes, r.couv.detail); await ecrire(ref, st); continue; }
    st.pml.vu = new Date().toISOString(); st.traiteeA = arrivee(st, r.miennes);
    if (!envoi) decompter(cache, ev);
    if (r.couv.etat === "partielle") {
      st.qtePML = r.couv.commandees;
      aRepondre(st, `commande PharmaML ${st.pml.ref} incomplète : ${r.couv.detail}`, true);
      if (etrangeresVues.length) doublon(st, etrangeresVues, "une autre commande PharmaML de la pharmacie pour ce produit est apparue pendant l'envoi");
      await ecrire(ref, st);
      continue;
    }
    st.etape = "sanofi";
    await ecrire(ref, st);

    // 2/2 — réponse à Sanofi (« Traiter »), une seule fois
    const res = await portail.traiter(payloadTraitement(frais, maintenant()));
    let verif = null;
    try { verif = (await portail.commandes()).find(x => x._id === o._id) || null; } catch { verif = undefined; }
    st.reponse = { http: res.status, message: res.message, statutApres: verif?.status ?? null };
    delete st.etape;
    if (verif && envoiExpedie(verif)) {
      st.etat = "traitee"; histo(st, "traitee", res.ok ? `PharmaML ${st.pml.ref} + réponse à Sanofi` : `PharmaML ${st.pml.ref} ; réponse HTTP ${res.status} mais envoi enregistré`);
      stats.traitees++;
      journal.push(`✓ ${ref} ${base.pharmacien} : PharmaML ${st.pml.ref} + « Traiter » — ${detail}`);
    } else if (verif && expediee(verif)) {
      st.etat = "traitee"; st.statutPortail = verif.status; stats.traitees++;
      histo(st, "traitee", `PharmaML ${st.pml.ref} ; « Traiter » : statut ${verif.status} sans envoi visible (HTTP ${res.status})`);
      alerter(st, "réponse à Sanofi à vérifier", `Commande dans PharmaML (réf. ${st.pml.ref}) ; statut ${verif.status} sur Sanofi Pro mais aucun envoi visible : vérifiez la réponse sur le portail. Ne pas ressaisir dans PharmaML, ne pas annuler la commande Odoo.`);
      journal.push(`${ref} ${base.pharmacien} : PharmaML ${st.pml.ref} ; statut ${verif.status} sans envoi visible — à vérifier`);
    } else if (verif && classer(verif) === "fait") annuleeSanofi(st, verif.status);
    else aRepondre(st, `« Traiter » sur Sanofi Pro a échoué (${res.ok ? "réponse positive mais aucun envoi enregistré" : res.status ? `HTTP ${res.status}${res.message ? ` : ${res.message}` : ""}` : res.message || "pas de réponse"}${verif === undefined ? " ; relecture impossible" : ""})`);
    // dernière lecture PharmaML : une saisie manuelle arrivée pendant « Traiter » est signalée tout de suite
    let fin = null;
    try { fin = await lirePML(st, st.pml.ref); } catch { /* surveillance au passage suivant */ }
    if (!etrangeresVues.length && fin) etrangeresVues = fin.etrangeres;
    if (etrangeresVues.length) doublon(st, etrangeresVues, "une autre commande PharmaML de la pharmacie pour ce produit est apparue pendant l'envoi");
    else if (fin?.couv.etat === "double") doublon(st, fin.miennes, fin.couv.detail);
    await ecrire(ref, st);
  }

  // 4. Alertes : un e-mail groupé pour toutes les alertes dues (y compris celles d'un passage
  //    précédent dont l'e-mail n'est pas parti) ; effacées seulement si l'e-mail est parti
  const dues = [...etats.entries()].filter(([, v]) => v.st?.alerteDue).map(([ref, v]) => ({ ref, st: v.st }));
  if (dues.length) {
    try {
      const { sujet, corps } = mailAlertes(dues.map(({ st }) => ({ ...st, titre: st.alerteDue.titre, detail: st.alerteDue.detail })));
      await envoyerMail(cfg, sujet, corps);
      for (const { ref, st } of dues) {
        if (st.alerteDue.cle) st.alerteCle = st.alerteDue.cle;
        st.alerteA = new Date().toISOString(); delete st.alerteDue;
        await ecrire(ref, st);
      }
      journal.push(`E-mail d'alerte : ${dues.length} commande(s)`);
    } catch (e) { journal.push(`⚠ E-mail d'alerte non envoyé (nouvel essai au prochain passage) : ${e.message}`); }
  }
  if (anomalies.length) journal.push(`⚠ ${anomalies.length} commande(s) non examinée(s) : ${anomalies.slice(0, 5).join(" ; ")}`);
  if ((auto || etatsSuivis(etats)) && (panneControle || anomalies.length)) {
    const err = new Error([panneControle && `contrôles impossibles (Odoo ou PharmaML) : ${panneControle.message}`,
      anomalies.length && `commandes non examinées (format inattendu du portail) : ${anomalies.slice(0, 10).join(" ; ")}`].filter(Boolean).join(" — "));
    await alerteTechnique(cfg, err).catch(e => journal.push(`⚠ Alerte technique non envoyée : ${e.message}`));
  }
  // 5. Ménage des vieux états (jamais celui d'une commande encore en attente sur le portail)
  try {
    const limite = new Date(Date.now() - MENAGE_JOURS * 86400e3).toISOString();
    const vieux = (await sb(`kv_store?key=like.${encodeURIComponent("sp:ord:")}*&updated_at=lt.${encodeURIComponent(limite)}&select=key&limit=200`)) || [];
    const aGarder = new Set(commandes.filter(o => classer(o) !== "fait").map(o => CLE(String(o.sanofiOrderReference))));
    const aEffacer = vieux.map(r => r.key).filter(k => !aGarder.has(k));
    if (aEffacer.length) await sb(`kv_store?key=in.(${aEffacer.map(k => `"${encodeURIComponent(k)}"`).join(",")})`, { method: "DELETE" });
  } catch { /* le ménage ne bloque jamais un passage */ }
  if (!journal.length) journal.push(stats.vues ? `${stats.vues} commande(s) en attente examinée(s), rien de nouveau` : "Aucune nouvelle commande");
  return { mode: cfg.mode, journal, stats, apercu: auto ? null : apercu.slice(0, 200) };
}
