// ── API des pharmacies : prix de la liste de chaque pharmacie, calculés par Odoo lui-même ──
// Décision de Zineb (24/10/2026, « 5. a) ») : l'API donne les prix de la liste de prix Odoo DE LA FICHE, calculés comme Odoo
// les facture, c'est-à-dire le MINIMUM des règles applicables (produit, modèle, catégories, barème global : vérifié le
// 15/10/2026 sur les ventes réelles, voir odoo-price-sync.js). Plutôt que de recopier ce calcul pour chaque liste (le barème
// global de la liste n° 5 est figé dans odoo-price-sync.js, ses plages ne sont pas lisibles en RPC), on demande le prix à
// Odoo par son rapport de liste de prix (report.product.report_pricelist.get_html), comme le contrôle des écarts de la
// péremption (_peremption.js, lireRapport et prixFactures) : par lots de 60 produits, quantité 1 puis chaque quantité de
// palier de la liste. Résultat : api_prix (une ligne par liste et par CIP), « prix HT de votre liste, hors offres du site ».
// Les offres du site seul (menus promo, précommandes, péremption −50 % de la page, commandes groupées, U-Labs, justificatifs)
// ne sont pas dans la V1. Une règle Odoo datée (ex. remise péremption facturée par Odoo) est prise telle qu'Odoo la facture
// au moment du calcul (de nuit) : d'où la mention « indicatif » et la date de calcul rendue avec chaque prix.
//
// Lectures Odoo seulement (search_read, get_html), contexte société 2 imposé, aucune écriture possible ici.
import { odoo as odooReel, COMPANY_ID } from "./_odoo-rpc.js";
import { PRIX } from "./_api-config.js";

const ECRITURES = new Set(["create", "write", "unlink", "copy", "toggle_active", "action_archive", "send", "message_post"]);
const CTX = { allowed_company_ids: [COMPANY_ID], company_id: COMPANY_ID, lang: "fr_FR" };
const round2 = (n) => Math.round(n * 100) / 100;
const m2o = (v) => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);
const jourDe = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "")); return m ? m[1] : ""; };
const enVigueur = (r, jour) => { const ds = jourDe(r.date_start), de = jourDe(r.date_end); return (!ds || ds <= jour) && (!de || de >= jour); };

// Lecture Odoo de l'API : société 2 imposée dans le contexte, méthodes d'écriture refusées, coupure (défaut 30 s : nuit)
export function lecteurOdoo(odoo = odooReel, timeoutMs = 30000) {
  return (model, method, args, kwargs = {}) => {
    if (ECRITURES.has(method)) throw new Error(`API des pharmacies : écriture Odoo interdite (${model}.${method})`);
    return odoo(model, method, args, { ...kwargs, context: { ...CTX, ...(kwargs.context || {}) } }, { timeoutMs });
  };
}

// Nombre d'un rapport Odoo en français : « 1 417,48 » → 1417.48 (même règle que lireRapport de _peremption.js)
export function nombreRapport(s) {
  let t = String(s ?? "").replace(/[\s  ]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
// Rapport de liste de prix → Map(product.product id → [prix à chaque quantité demandée, dans l'ordre]). Une ligne dont le
// nombre de montants ne correspond pas au nombre de quantités est écartée (présentation inattendue : pas de prix plutôt
// qu'un prix faux).
export function lireRapportQuantites(html, nbQuantites) {
  const out = new Map();
  for (const ligne of String(html || "").split(/<tr>/).slice(1)) {
    const m = ligne.match(/data-res-id="(\d+)"/);
    if (!m) continue;
    const v = [...ligne.matchAll(/oe_currency_value">([^<]+)</g)].map(x => nombreRapport(x[1]));
    if (v.length === nbQuantites && v.every(x => x != null)) out.set(Number(m[1]), v);
  }
  return out;
}

// prix lus (quantité 1 puis paliers croissants) → { prix_ht, paliers } : prix ≤ 0 → aucun prix ; un palier n'est gardé que
// s'il fait baisser le prix (strictement) par rapport au palier précédent
export function prixEtPaliers(valeurs, quantites) {
  const unit = Number(valeurs?.[0]);
  if (!(unit > 0)) return { prix_ht: null, paliers: [] };
  const paliers = [];
  let meilleur = round2(unit);
  for (let i = 1; i < quantites.length; i++) {
    const p = round2(Number(valeurs[i]));
    if (p > 0 && p < meilleur) { paliers.push({ a_partir_de: quantites[i], prix_ht: p }); meilleur = p; }
  }
  return { prix_ht: round2(unit), paliers };
}

// Quantités de palier de la liste (et des listes dont elle dérive, base = pricelist) : règles en vigueur à min_quantity ≥ 2
// (entier), par produit selon leur cible (variante, modèle, catégorie et ses sous-catégories, toute la liste).
// produits : [{ pid, tmpl, categ }] → Map(pid → [quantités croissantes], PRIX.paliers_max au plus)
export async function quantitesDePaliers(lire, listeId, produits, jour) {
  const listes = [Number(listeId)];
  // listes de base (règles « formule » appuyées sur une autre liste) : leurs paliers changent aussi le prix
  for (let i = 0; i < listes.length && listes.length < 4; i++) {
    const bases = await lire("product.pricelist.item", "search_read", [[["pricelist_id", "=", listes[i]], ["base", "=", "pricelist"]]],
      { fields: ["base_pricelist_id"], limit: 500 });
    for (const b of bases || []) { const id = m2o(b.base_pricelist_id); if (id && !listes.includes(id) && listes.length < 4) listes.push(id); }
  }
  const regles = ((await lire("product.pricelist.item", "search_read", [[["pricelist_id", "in", listes], ["min_quantity", ">", 1]]],
    { fields: ["applied_on", "product_id", "product_tmpl_id", "categ_id", "min_quantity", "date_start", "date_end"], limit: 20000 })) || [])
    .filter(r => enVigueur(r, jour) && Number.isInteger(Number(r.min_quantity)) && Number(r.min_quantity) >= 2);
  const out = new Map();
  if (!regles.length) return out;
  const parents = new Map();
  if (regles.some(r => r.applied_on === "2_product_category")) {
    for (const c of (await lire("product.category", "search_read", [[]], { fields: ["id", "parent_id"], limit: 5000 })) || []) parents.set(c.id, m2o(c.parent_id));
  }
  const chaine = (categ) => { const ids = []; for (let c = Number(categ) || 0, n = 0; c > 0 && n < 20; n++) { ids.push(c); c = parents.get(c) || 0; } return ids; };
  for (const p of produits) {
    const qs = new Set();
    const cats = parents.size ? new Set(chaine(p.categ)) : null;
    for (const r of regles) {
      const ok = r.applied_on === "3_global" || (r.applied_on === "0_product_variant" && m2o(r.product_id) === p.pid)
        || (r.applied_on === "1_product" && m2o(r.product_tmpl_id) === p.tmpl) || (r.applied_on === "2_product_category" && cats?.has(m2o(r.categ_id)));
      if (ok) qs.add(Number(r.min_quantity));
    }
    if (qs.size) out.set(p.pid, [...qs].sort((a, b) => a - b).slice(0, PRIX.paliers_max));
  }
  return out;
}

// Calcul complet d'une liste : catalogue = [{ cip, odoo_pid, odoo_tmpl_id?, categ_id?, list_price }]
// → { lignes: [{ cip, prix_ht, paliers }], produits, sans_prix, appels, tronque }
// budgetMs : arrêt propre avant la limite de la fonction d'arrière-plan (lignes déjà calculées gardées, tronque = true)
export async function calculerListe({ listeId, catalogue, lire, jour, horloge = () => Date.now(), budgetMs = 13 * 60e3, parAppel = PRIX.par_appel_rapport }) {
  const t0 = horloge();
  const produits = (catalogue || []).filter(c => /^\d{13}$/.test(String(c.cip || "")) && Number(c.odoo_pid) > 0)
    .map(c => ({ cip: String(c.cip), pid: Number(c.odoo_pid), tmpl: Number(c.odoo_tmpl_id) || 0, categ: Number(c.categ_id) || 0, lp: Number(c.list_price) || 0 }));
  const lignes = [];
  let appels = 0, tronque = false;
  const lireCompte = (...a) => { appels++; return lire(...a); };
  // Le rapport d'Odoo prend une AUTRE liste quand celle demandée n'existe pas (search limit 1) : on vérifie qu'elle existe
  const [liste] = (await lireCompte("product.pricelist", "search_read", [[["id", "=", Number(listeId)]]], { fields: ["id"], limit: 1, context: { active_test: false } })) || [];
  if (!liste) throw Object.assign(new Error(`liste de prix n° ${Number(listeId)} introuvable dans Odoo`), { code: "liste_introuvable" });
  // sans prix de base : pas de prix (comme le site, odoo-price-sync.js)
  for (const p of produits.filter(x => !(x.lp > 0))) lignes.push({ cip: p.cip, prix_ht: null, paliers: [] });
  const aCalculer = produits.filter(x => x.lp > 0);
  const paliers = await quantitesDePaliers(lireCompte, listeId, aCalculer, jour);
  // produits regroupés par jeu de quantités (un appel du rapport par lot de 60 d'un même jeu)
  const groupes = new Map();
  for (const p of aCalculer) {
    const qs = [1, ...(paliers.get(p.pid) || [])];
    const k = qs.join(",");
    if (!groupes.has(k)) groupes.set(k, { qs, produits: [] });
    groupes.get(k).produits.push(p);
  }
  for (const { qs, produits: ps } of groupes.values()) {
    for (let i = 0; i < ps.length; i += parAppel) {
      const lot = ps.slice(i, i + parAppel);
      if (horloge() - t0 > budgetMs) { tronque = true; break; }
      const html = await lireCompte("report.product.report_pricelist", "get_html", [{ active_model: "product.product", active_ids: lot.map(p => p.pid),
        pricelist_id: Number(listeId), quantities: qs, is_visible_title: false }]);
      const lus = lireRapportQuantites(html, qs.length);
      for (const p of lot) lignes.push({ cip: p.cip, ...(lus.has(p.pid) ? prixEtPaliers(lus.get(p.pid), qs) : { prix_ht: null, paliers: [] }) });
    }
    if (tronque) break;
  }
  return { lignes, produits: produits.length, sans_prix: lignes.filter(l => l.prix_ht == null).length, appels, tronque };
}

// Liste de prix de fiches (propriété par société : contexte société 2) → Map(odoo_id → liste_id)
export async function listesDesFiches(lire, odooIds) {
  const ids = [...new Set((odooIds || []).map(Number))].filter(n => Number.isInteger(n) && n > 0);
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await lire("res.partner", "search_read", [[["id", "in", ids.slice(i, i + 200)], ["company_id", "in", [COMPANY_ID, false]]]],
      { fields: ["property_product_pricelist"], limit: 200, context: { active_test: false } });
    for (const r of rows || []) { const l = m2o(r.property_product_pricelist); if (l) out.set(r.id, l); }
  }
  return out;
}
