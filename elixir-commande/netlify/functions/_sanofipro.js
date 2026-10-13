// ── Commandes Sanofi Pro (Dupixent) : traitement automatique ─────────────
// Les pharmacies commandent sur Sanofi Pro en choisissant Elixir comme grossiste ; les commandes
// arrivent sur le portail grossiste https://sanofipro.expepharma.com (connexion e-mail + mot de
// passe, variables SANOFIPRO_EMAIL / SANOFIPRO_PASSWORD).
// « Traiter » sur ce portail (POST /api/consignments, quantités expédiées) répond à Sanofi ET envoie
// la commande dans PharmaML : même seconde pour les 43 commandes traitées du 01 au 12/10/2026 ; le
// connecteur Odoo la reprend ensuite (~4 min). On ne passe donc PAS par la synchro du site.
// Décision de Zineb (12/10/2026) : traiter automatiquement une nouvelle commande quand la pharmacie
// est cliente Elixir et que le stock libre Odoo couvre la quantité ; sinon elle reste sur le portail
// (traitement à la main) et un e-mail prévient.
//
// Anti-doublon (un 2e « Traiter » = une 2e commande PharmaML) :
//   - un seul passage à la fois (verrou sp:lock, plus long que la vie d'une fonction) ; les actions
//     admin sur une commande prennent le même verrou ;
//   - état de la commande (sp:ord:<référence Sanofi>) réservé par écriture conditionnelle AVANT l'envoi ;
//   - commande relue sur le portail juste avant : jamais si elle a déjà un envoi, n'est plus « pending »,
//     a changé ou si sa référence apparaît plusieurs fois ;
//   - jamais de second envoi automatique : ni après un refus d'identification, ni après une issue
//     incertaine (panne, délai, envoi non retrouvé) ; reprise humaine confirmée seulement.
//
// Stockage kv_store : sp:config, sp:ord:<réf>, sp:ids (documents vus par référence), sp:lock,
// sp:dernier_passage, sp:dernier_complet, sp:alerte_tech, sp:alerte_arret.
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { sb, kvGet, kvGetBrut, kvSet, kvSetSi, kvList, kvCreate, fichePharmacie, esc, dateLongue, jourParis, MAIL_DE } from "./_lab-justif.js";

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
const ENVOI_MAX_MS = 11 * 60e3;         // plus aucun envoi après 11 min de passage (fonction tuée à 15 min)

// ── Réglages (onglet admin « Sanofi Pro ») ──────────────────────────────
// mode : arret | simulation (rien n'est écrit sur le portail, aucun e-mail) | auto
export const CONFIG_DEFAUT = { mode: "simulation", ageMaxHeures: 48, maxQteLigne: 3, plafondJour: 30, delaiOdooMin: 45, alertes: "pharmacien@elixirpharma.fr" };
export const MODES = ["arret", "simulation", "auto"];
export async function lireConfig() { return { ...CONFIG_DEFAUT, ...((await kvGet("sp:config")) || {}) }; }
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
//   en_cours        réservée, envoi en cours
//   traitee         « Traiter » fait par Elixir automatiquement ; on attend la commande Odoo
//   dans_odoo       commande Odoo retrouvée
//   absente_odoo    pas de commande Odoo après le délai (alerte) ; on continue de chercher 48 h
//   incertaine      issue inconnue (panne, délai, refus d'identification, envoi non retrouvé) : vérification humaine
//   erreur          refusée par le portail, aucun envoi enregistré
//   portail         traitée, refusée ou supprimée directement sur le portail
//   ignoree         écartée depuis l'admin
// Marqueurs permanents (toute reprise exige alors une confirmation explicite, même après « ignorer ») :
//   issueInconnue  un envoi automatique a eu une issue incertaine ;
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
// traitée (au moins en partie) sur le portail : donc déjà envoyée dans PharmaML
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
  ref: String(o.sanofiOrderReference), id: o._id, cip: String(o.cipCode || ""), pharmacien: String(o.pharmacistName || "").trim(),
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
    parProduit.set(p.id, (parProduit.get(p.id) || 0) + Number(e.quantity));
    sortie.push({ code, nom: p.nom, qte: Number(e.quantity), produitId: p.id });
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
export async function suiviOdoo(etats, maintenantMs = Date.now()) {
  const parPharmacie = new Map();
  for (const [ref, { st }] of etats) {
    // toute commande envoyée consomme ses lignes (même « ignorée » après vérification) ; seules les suivies sont créditées
    if (!st?.traiteeA || !st.pharmacie?.odooId) continue;
    if (maintenantMs - new Date(st.traiteeA).getTime() > SUIVI_ODOO_H * 3600e3) continue;
    const k = Number(st.pharmacie.odooId);
    parPharmacie.set(k, [...(parPharmacie.get(k) || []), { ref, st }]);
  }
  const credits = [];   // { ref, so: [noms] }
  for (const [odooId, liste] of parPharmacie) {
    if (!liste.some(x => SUIVIS.has(x.st.etat))) continue;
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
      if (SUIVIS.has(st.etat)) credits.push({ ref, so: [...new Set(pris.map(([l]) => l.so))] });
    }
  }
  return credits;
}

// ── E-mails (Odoo, depuis pharmacien@elixirpharma.fr) ───────────────────
const heure = (s) => s ? dateLongue(new Date(s)) : "";
export function mailAlertes(items) {
  const n = items.length;
  const sujet = n === 1 ? `Sanofi Pro : commande ${items[0].ref} — ${items[0].titre}` : `Sanofi Pro : ${n} commandes à vérifier`;
  const td = 'style="border:1px solid #d6dde3;padding:5px 8px;vertical-align:top"';
  const lignes = items.map(i => `<tr><td ${td}>${esc(heure(i.date))}</td><td ${td}>${esc(i.ref)}</td><td ${td}>${esc(i.pharmacien)}<br><span style="color:#64748b">CIP ${esc(i.cip)}</span></td>
    <td ${td}>${(i.lignes || []).map(l => `${esc(l.qte)} × ${esc(l.nom)}`).join("<br>")}</td><td ${td}><b>${esc(i.titre)}</b><br>${esc(i.detail || "")}</td></tr>`).join("");
  const corps = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000">
<p>Bonjour,</p>
<p>${n === 1 ? "Cette commande Sanofi Pro demande" : "Ces commandes Sanofi Pro demandent"} votre attention : le traitement automatique ne l'a pas fait${n > 1 ? " pour elles" : ""}, ou son résultat est à vérifier.</p>
<table style="border-collapse:collapse;font-size:10pt"><tr style="background:#f1f5f9"><th ${td}>Commande du</th><th ${td}>Réf. Sanofi</th><th ${td}>Pharmacie</th><th ${td}>Produits</th><th ${td}>Situation</th></tr>${lignes}</table>
<p>Portail : <a href="${PORTAIL_SP}/new-orders">${PORTAIL_SP}/new-orders</a> — suivi : admin du site de commande, onglet « Sanofi Pro ».</p>
<p style="color:#64748b;font-size:9pt">Rappel : « Traiter » sur le portail envoie aussi la commande dans PharmaML. Une commande déjà traitée ne doit jamais l'être une seconde fois.</p>
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

// ── Un passage (planifié toutes les 10 min, ou « Vérifier maintenant ») ──
// À appeler sous le verrou sp:lock (VERROU_MS). Tous les écrivains de sp:ord:* (passages, actions
// admin) passent par ce verrou : les écritures du passage n'écrasent donc jamais une décision prise
// pendant qu'il tourne.
export async function passage({ budgetMs = 10 * 60e3, portail = new PortailSP(), maintenant = () => new Date() } = {}) {
  const t0 = Date.now();
  const cfg = await lireConfig();
  const journal = [];
  const stats = { vues: 0, traitees: 0, attente: 0, main: 0, incertaines: 0, simulees: 0 };
  if (cfg.mode === "arret") return { mode: cfg.mode, journal: ["Traitement automatique arrêté (réglage)"], stats };
  // SUSPENDU le 13/10/2026 : les 2 premiers « Traiter » automatiques (07:38) n'ont créé AUCUNE commande
  // PharmaML — la corrélation observée venait de la saisie faite par la personne qui traite, pas du portail.
  // Le mode « auto » se comporte comme une simulation tant que l'envoi PharmaML n'est pas automatisé.
  const auto = false;
  const anomalies = [];       // statuts inconnus, références illisibles → alerte technique
  // simulation : décision qui serait prise pour chaque commande en attente sur le portail (affichée dans l'admin)
  const apercu = [];
  const simuler = (base, decision, motif, pharmacieOdoo = null) =>
    apercu.push({ ref: base.ref, date: base.date, pharmacien: base.pharmacien, cip: base.cip, par: base.par, lignes: base.lignes, decision, motif, pharmacieOdoo });

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
    st.etat = "incertaine"; st.motif = motif; st.issueInconnue = st.issueInconnue || new Date().toISOString();
    histo(st, "incertaine", motif); alerter(st, "issue inconnue", detail); stats.incertaines++;
  };

  // 1. États ouverts ou interrompus dont la commande a changé sur le portail
  for (const [ref, { st }] of etats) {
    if (!st || !(OUVERTS.has(st.etat) || st.etat === "a_traiter_main" || st.etat === "en_cours")) continue;
    const ds = docs.get(ref) || [];
    if (st.etat === "en_cours") {
      // passage précédent mort pendant l'envoi (le verrou dure plus longtemps qu'une fonction : il ne tourne plus)
      if (ds.some(envoiExpedie)) { histo(st, "traitee", "envoi retrouvé sur le portail après un passage interrompu"); st.etat = "traitee"; st.traiteeA = st.traiteeA || st.reserveeA || new Date().toISOString(); }
      else incertaine(st, "passage interrompu pendant l'envoi", "Le traitement automatique a été interrompu pendant l'envoi. Vérifiez sur le portail et dans PharmaML avant toute action.");
      await ecrire(ref, st);
      continue;
    }
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

  // 2. Suivi : les commandes traitées sont-elles arrivées dans Odoo ?
  let suiviOk = true;
  try {
    const credits = await suiviOdoo(etats);
    for (const { ref, so } of credits) { const st = etats.get(ref).st; histo(st, "dans_odoo", so.join(", ")); st.etat = "dans_odoo"; st.odoo = so; delete st.alerteDue; await ecrire(ref, st); }
  } catch (e) { suiviOk = false; journal.push(`Suivi Odoo impossible : ${e.message}`); }
  // traitée sans commande Odoo retrouvée après le délai → alerte (aussi si le suivi a été impossible longtemps)
  for (const [ref, { st }] of etats) {
    if (st?.etat !== "traitee") continue;
    const ageMin = (Date.now() - new Date(st.traiteeA).getTime()) / 60e3;
    if (ageMin <= cfg.delaiOdooMin || (!suiviOk && ageMin <= SUIVI_ODOO_H * 60)) continue;
    histo(st, "absente_odoo"); st.etat = "absente_odoo";
    alerter(st, `absente d'Odoo ${Math.round(ageMin)} min après le traitement`,
      "Traitée automatiquement sur le portail (donc envoyée dans PharmaML), mais pas de commande Odoo correspondante pour cette pharmacie et ce produit. Vérifiez le portail PharmaML avant de la saisir à la main (ses boîtes restent décomptées du stock libre 48 h).");
    await ecrire(ref, st);
  }

  // 3. Nouvelles commandes (plus anciennes d'abord)
  let panneControle = null;     // Odoo injoignable : alerte technique
  // stock déjà promis : commandes traitées pas encore retrouvées dans Odoo
  const enVol = new Map();
  for (const { st } of etats.values()) {
    if (!SUIVIS.has(st?.etat) || !(Date.now() - new Date(st.traiteeA).getTime() <= SUIVI_ODOO_H * 3600e3)) continue;   // au-delà, free_qty d'Odoo en tient compte
    for (const l of st.lignes || []) if (l.produitId) enVol.set(l.produitId, (enVol.get(l.produitId) || 0) + Number(l.qte || 0));
  }
  const cache = nouveauCache(enVol);
  const aujourdHui = jourParis(maintenant());
  for (const { st } of etats.values()) if (st?.traiteeA && jourParis(new Date(st.traiteeA)) === aujourdHui) cache.traitesJour++;
  for (const o of commandes) if (classer(o) === "inconnu" && !etats.has(String(o.sanofiOrderReference))) anomalies.push(`${o.sanofiOrderReference} : statut « ${o.status} »`);

  const candidates = commandes.filter(aTraiter).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)));
  for (const o of candidates) {
    const ref = String(o.sanofiOrderReference);
    if (!REF_OK.test(ref)) { anomalies.push(`référence illisible « ${ref.slice(0, 40)} »`); continue; }
    stats.vues++;
    const cur = etats.get(ref);
    const st0 = cur?.st;
    const nDocs = (docs.get(ref) || []).length;
    const base = { ...resume(o), ...(st0 ? { historique: st0.historique, forcer: st0.forcer, motif: st0.motif, cle: st0.cle, alerteCle: st0.alerteCle, alerteDue: st0.alerteDue, alerteA: st0.alerteA,
      vueA: st0.vueA, issueInconnue: st0.issueInconnue, envoiPortail: st0.envoiPortail, statutPortail: st0.statutPortail, plusieursDocs: st0.plusieursDocs, traiteeA: st0.traiteeA }
      : { vueA: new Date().toISOString() }) };
    // déjà décidée (traitée, incertaine, à la main, ignorée…) : rien à faire, sauf « portail » redevenue en attente
    if (st0 && !OUVERTS.has(st0.etat) && st0.etat !== "portail") continue;
    // à la main (jamais automatique) : en double sur le portail, ou réapparue « pending » après « portail »
    const nAutres = autresDocs(ref, o._id);
    const aLaMain = nDocs > 1 ? `référence présente ${nDocs} fois sur le portail`
      : nAutres ? `référence déjà vue sur le portail avec ${nAutres} autre(s) document(s)`
      : st0?.etat === "portail" ? `de nouveau « pending » sur le portail (était : ${st0.statutPortail ? `statut ${st0.statutPortail}` : st0.motif || "traitée sur le portail"})` : null;
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
    if (!auto) { journal.push(`SIMULATION ${ref} ${base.pharmacien} (${ev.pharmacie.nom}) : serait traitée — ${ev.lignes.map(l => `${l.qte} × ${l.nom}`).join(", ")}`); simuler(base, "serait_traitee", null, ev.pharmacie.nom); stats.simulees++; decompter(cache, ev); continue; }

    // ── traitement ──
    // arrêt demandé pendant le passage, ou passage trop long : on s'arrête avant de réserver
    const mode = (await kvGet("sp:config").catch(() => ({ mode: "?" })))?.mode;
    if (mode !== "auto") { journal.push("Mode automatique quitté pendant le passage : commandes restantes laissées au prochain passage"); break; }
    if (Date.now() - t0 > ENVOI_MAX_MS) { journal.push("Passage trop long : envois reportés au prochain passage"); break; }
    const st = { ...base, etat: "en_cours", pharmacie: ev.pharmacie, lignes: ev.lignes, reserveeA: new Date().toISOString(), motif: null, cle: null };
    delete st.alerteDue;     // ancienne alerte « non traitée » devenue sans objet
    histo(st, "en_cours");
    st.maj = new Date().toISOString();
    let majLue = cur?.maj;
    if (cur && !majLue) majLue = (await kvGetBrut(CLE(ref)).catch(() => null))?.maj;   // état réécrit plus tôt dans ce passage
    if (cur && !majLue) { journal.push(`${ref} : version de l'état illisible — prochain passage`); continue; }
    const pris = cur ? await kvSetSi(CLE(ref), st, majLue) : await kvCreate(CLE(ref), st);
    if (!pris) { journal.push(`${ref} : modifiée pendant le passage — prochain passage`); continue; }
    etats.set(ref, { st, maj: null });
    const remettre = async (etat, motif) => { st.etat = etat; st.motif = motif; histo(st, etat, motif); await ecrire(ref, st); };
    // relecture juste avant l'envoi : quelqu'un a pu la traiter sur le portail entre-temps
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
    if (signature(frais) !== signature(o) || String(frais.cipCode) !== String(o.cipCode)) { await remettre("en_attente", "commande modifiée sur le portail : réexamen au prochain passage"); continue; }

    const res = await portail.traiter(payloadTraitement(frais, maintenant()));
    let verif = null;
    try { verif = (await portail.commandes()).find(x => x._id === o._id) || null; } catch { verif = undefined; }
    const envoiVu = !!verif && envoiExpedie(verif);
    st.reponse = { http: res.status, message: res.message, statutApres: verif?.status ?? null };
    if (envoiVu) {
      st.etat = "traitee"; st.traiteeA = new Date().toISOString(); histo(st, "traitee", res.ok ? null : `réponse HTTP ${res.status} mais envoi enregistré`);
      decompter(cache, ev); stats.traitees++;
      journal.push(`✓ ${ref} ${base.pharmacien} : traitée — ${ev.lignes.map(l => `${l.qte} × ${l.nom}`).join(", ")}`);
    } else if (res.status >= 400 && res.status < 500 && ![401, 403, 408].includes(res.status) && verif) {
      // refus explicite (validation) et commande relue sans envoi
      st.etat = "erreur"; st.motif = `refusée par le portail (HTTP ${res.status}${res.message ? ` : ${res.message}` : ""})`;
      histo(st, "erreur", st.motif);
      alerter(st, "refusée par le portail", `${st.motif}. Aucun envoi enregistré sur le portail : à traiter à la main (vérifiez PharmaML).`);
    } else {
      const motif = res.ok ? "réponse positive du portail mais aucun envoi enregistré sur la commande"
        : `${res.status ? `HTTP ${res.status}` : "pas de réponse"}${res.message ? ` : ${res.message}` : ""}${verif === undefined ? " ; relecture impossible" : verif === null ? " ; commande disparue de la liste" : ""}`;
      incertaine(st, motif, `${motif}. Vérifiez sur le portail et dans PharmaML avant toute action : pas de nouvel essai automatique.`);
    }
    await ecrire(ref, st);
  }

  // 4. Alertes : un e-mail groupé pour toutes les alertes dues (y compris celles d'un passage
  //    précédent dont l'e-mail n'est pas parti) ; effacées seulement si l'e-mail est parti
  const dues = [...etats.entries()].filter(([, v]) => v.st?.alerteDue).map(([ref, v]) => ({ ref, st: v.st }));
  if (auto && dues.length) {
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
  if (auto && (panneControle || anomalies.length)) {
    const err = new Error([panneControle && `contrôles Odoo impossibles : ${panneControle.message}`,
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
