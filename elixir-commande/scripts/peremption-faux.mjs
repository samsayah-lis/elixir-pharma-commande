// ── Péremption courte (« Odoo facture la remise ») : faux Odoo et faux Supabase, en mémoire ──
// Servent à scripts/test-peremption-odoo.mjs et au banc d'essai (scripts/banc/peremption-banc.mjs). Aucun appel réseau.
//
// Faux Odoo : produits, quants, lots, emplacements, règles de prix (product.pricelist.item), ventes, rapport des listes
// (report.product.report_pricelist.get_html, même HTML que l'Odoo d'Elixir relevé le 20/10/2026). Le prix facturé d'une
// liste est le MINIMUM du prix de la liste sans les règles ajoutées (barème global d'odoo-price-sync pour la liste 5,
// prix relevé dans Odoo pour les autres) et de TOUTES les règles applicables de la liste : produit ou modèle, quantité
// minimale ≤ quantité, et fenêtre de dates (date_start ≤ date de la commande ≤ date_end, en date-heure UTC). Une création
// sans applied_on ou compute_price prend les défauts d'Odoo (3_global, fixed), comme le vrai.
// Contrôles : interdireEcritures (la simulation ne doit faire AUCUN create/write/unlink : toute tentative lève et est
// comptée), refuserListes (Odoo refuse la création sur ces listes), perdreReponse (la création aboutit mais la réponse se
// perd : coupure entre create et l'enregistrement), modifierALaMain / supprimerALaMain.
//
// Faux Supabase : sous-ensemble de PostgREST (select, eq, neq, gt, gte, lt, lte, like, in, is, not.is, or, order, limit,
// offset ; POST avec on_conflict et merge-duplicates ; PATCH ; return=representation) ; index uniques partiels de
// sql/peremption.sql (409, code 23505) ; journal en ajout seul (déclencheur) ; RLS : la clé anon ne lit ni n'écrit les
// tables peremption_* (lecture vide, écriture 401 code 42501).
import { randomUUID } from "node:crypto";

const round2 = (n) => Math.round(n * 100) / 100;
// arrondi d'Odoo (float_round, demi supérieur avec correction epsilon) : 6,35 × 0,7 = 4,4449999… → 4,45
export const arrondiOdoo = (v) => { const n = v * 100; if (!n) return 0; const eps = 2 ** (Math.log2(Math.abs(n)) - 52); return Math.round(n + Math.sign(n) * eps) / 100; };
const m2o = (v) => (Array.isArray(v) ? v[0] : v || null);
// barème global de la liste 5 (copie de globalPrice d'odoo-price-sync.js)
export const bareme5 = (lp) => (lp < 4.63 ? round2(lp - 0.23) : lp <= 500 ? round2(lp * (1 - 4.51 / 100)) : round2(lp - 25.1));
const versOdoo = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
const depuisOdoo = (s) => Date.parse(String(s).replace(" ", "T") + "Z");

// ── Domaines Odoo (préfixes « | », « & », « ! » ; feuilles [champ, opérateur, valeur]) ──
function evalDomaine(rec, domaine, champ) {
  const pile = [...(domaine || [])];
  const suivant = () => {
    const x = pile.shift();
    if (x === "|") { const a = suivant(), b = suivant(); return a || b; }
    if (x === "&") { const a = suivant(), b = suivant(); return a && b; }
    if (x === "!") return !suivant();
    const [f, op, v] = x;
    const val = champ(rec, f);
    const cmp = (a) => (a == null || a === false ? null : Array.isArray(a) ? a[0] : a);
    const a = cmp(val);
    switch (op) {
      case "=": return v === false ? a == null : a === v || (a != null && String(a) === String(v));
      case "!=": return v === false ? a != null : !(a === v || String(a) === String(v));
      case "in": return v.map(String).includes(String(a));
      case "not in": return !v.map(String).includes(String(a));
      case ">": return a != null && a > v;
      case ">=": return a != null && a >= v;
      case "<": return a != null && a < v;
      case "<=": return a != null && a <= v;
      case "=like": return a != null && new RegExp(`^${String(v).replace(/_/g, ".").replace(/%/g, ".*")}$`).test(String(a));
      default: throw new Error(`faux Odoo : opérateur ${op}`);
    }
  };
  let ok = true;
  while (pile.length) ok = suivant() && ok;
  return ok;
}

// ── Faux Odoo ──
// donnees : { produits:[{id, cip, nom, tmpl, list_price, cout, variantes?, categ?}], quants:[{pid, lot?, exp?, qte, reserve?, loc?}],
//   prixListes:{ [liste]: { [pid]: prix sans les règles ajoutées } } (liste 5 : barème si absent), regles:[{liste, tmpl|pid, fixe|pct, mq?, ds?, de?}],
//   ventes:[{pid, qte, ref, date?, prix?, remise?, commande?}], commandesListes:[{liste, nom, n}], exclus:[ids d'emplacements] }
export function fauxOdoo(donnees = {}, { maintenant = () => Date.now() } = {}) {
  const produits = new Map((donnees.produits || []).map(p => [p.id, p]));
  const parCip = new Map([...produits.values()].map(p => [p.cip, p]));
  const lots = new Map();
  const quants = [];
  let idLot = 900000, idQuant = 1;
  const LOC_STOCK = 8, LOC_QUARANTAINE = 1789;
  const emplacements = [{ id: LOC_STOCK, usage: "internal", do_not_export: false, scrap_location: false }, { id: LOC_QUARANTAINE, usage: "internal", do_not_export: true, scrap_location: false },
    ...(donnees.exclus || []).map(id => ({ id, usage: "internal", do_not_export: true, scrap_location: false }))];
  const ajouterQuant = (q) => {
    let lot = false;
    if (q.lot !== false && (q.exp || q.lot)) {
      const id = ++idLot;
      lots.set(id, { id, name: q.lot || `L${id}`, expiration_date: q.exp ? `${q.exp} 22:59:59` : false });
      lot = [id, q.lot || `L${id}`];
    }
    const p = produits.get(q.pid);
    quants.push({ id: idQuant++, product_id: [q.pid, `[${p?.cip}] ${p?.nom}`], lot_id: lot, location_id: [q.loc || LOC_STOCK, "WH/Stock"], quantity: q.qte, reserved_quantity: q.reserve || 0, company_id: [2, "Elixir"] });
  };
  (donnees.quants || []).forEach(ajouterQuant);
  const NOMS = { 2: "Liste de prix EUR", 4: "Export", 5: "Liste de prix EUR 2", 15: "Expepharma", 1110: "CA >50k mensuel", 1112: "Cluster 78", 1114: "VIP", 25: "Liste de prix EUR par défaut" };
  const items = new Map();
  let idItem = 20000;
  const nouvelleRegle = (v, { site = false } = {}) => {
    const id = ++idItem;
    const p = v.product_tmpl_id ? [...produits.values()].find(x => x.tmpl === m2o(v.product_tmpl_id)) : null;
    const it = { id, pricelist_id: [m2o(v.pricelist_id), `${NOMS[m2o(v.pricelist_id)] || "Liste"} (EUR)`], applied_on: v.applied_on ?? "3_global", compute_price: v.compute_price ?? "fixed",
      product_tmpl_id: v.product_tmpl_id ? [m2o(v.product_tmpl_id), p ? `[${p.cip}] ${p.nom}` : "?"] : false, product_id: v.product_id ? [m2o(v.product_id), "?"] : false, categ_id: v.categ_id ? [m2o(v.categ_id), "?"] : false,
      fixed_price: v.fixed_price ?? 0, percent_price: v.percent_price ?? 0, price_discount: v.price_discount ?? 0, price_surcharge: v.price_surcharge ?? 0, price_round: 0,
      base: v.base ?? "list_price", min_quantity: v.min_quantity ?? 0, date_start: v.date_start || false, date_end: v.date_end || false, company_id: [2, "Elixir"], currency_id: [126, "EUR"],
      price_min: 0, price_max: 999999999, create_uid: [10, "Sam Sayah"], _site: site };
    items.set(id, it);
    return id;
  };
  for (const r of donnees.regles || []) nouvelleRegle({ pricelist_id: r.liste, applied_on: r.pid ? "0_product_variant" : "1_product", product_tmpl_id: r.tmpl || produits.get(r.pid)?.tmpl,
    product_id: r.pid || false, compute_price: r.fixe != null ? "fixed" : "percentage", fixed_price: r.fixe ?? 0, percent_price: r.pct ?? 0, min_quantity: r.mq ?? 0,
    date_start: r.ds || false, date_end: r.de || false });
  const ventes = (donnees.ventes || []).map((v, i) => { const p = produits.get(v.pid); return { id: 70000 + i, product_id: [v.pid, `[${p?.cip}] ${p?.nom}`], product_uom_qty: v.qte,
    pml_order_ref: v.ref || false, date_order: v.date || versOdoo(maintenant() - 5 * 864e5), state: v.state || "sale", company_id: [2, "Elixir"],
    price_unit: v.pu ?? p?.list_price ?? 0, discount: v.remise ?? 0, price_subtotal: round2((v.pu ?? p?.list_price ?? 0) * (1 - (v.remise ?? 0) / 100) * v.qte),
    order_id: [80000 + i, v.commande || `S${300000 + i}`], invoice_status: v.facturation || "invoiced", _liste: v.liste || 5 }; });

  // prix facturé : MIN du prix sans les règles ajoutées et des règles applicables (quantité, dates)
  function prixFacture(pid, liste, qte = 1, t = maintenant()) {
    const p = produits.get(pid);
    if (!p) return null;
    const lp = p.list_price;
    const base = donnees.prixListes?.[liste]?.[pid] ?? (liste === 5 ? bareme5(lp) : lp);
    const candidats = [base];
    for (const it of items.values()) {
      if (m2o(it.pricelist_id) !== liste) continue;
      const vise = it.applied_on === "0_product_variant" ? m2o(it.product_id) === pid : it.applied_on === "1_product" ? m2o(it.product_tmpl_id) === p.tmpl : it.applied_on === "3_global";
      if (!vise) continue;
      if (Number(it.min_quantity) > qte) continue;
      if (!donnees.ignorerDates && it.date_start && depuisOdoo(it.date_start) > t) continue;   // ignorerDates : Odoo qui ne respecterait pas les dates (essai T1)
      if (!donnees.ignorerDates && it.date_end && depuisOdoo(it.date_end) < t) continue;
      const v = it.compute_price === "fixed" ? it.fixed_price : it.compute_price === "percentage" ? lp * (1 - it.percent_price / 100) : lp * (1 - it.price_discount / 100) + it.price_surcharge;
      candidats.push(v);
    }
    return arrondiOdoo(Math.min(...candidats));
  }
  const html = (ids, liste) => `<div class="article"><table class="table"><thead><tr><th>Produits</th><th class="text-end">1 Unités</th></tr></thead>
                        <tbody>${ids.map(pid => { const p = produits.get(pid); if (!p) return ""; const v = prixFacture(pid, liste);
    const t = v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `
                                <tr>
                                    <td>
                                        <a href="#" class="o_action" data-model="product.product" data-res-id="${pid}">
                                            <span>[${p.cip}] ${p.nom}</span>
                                        </a>
                                    </td>
                                        <td class="text-end">
                                            <span data-oe-type="monetary" data-oe-expression="product[&#39;price&#39;][qty]"><span class="oe_currency_value">${t}</span> €</span>
                                        </td>
                                </tr>`; }).join("")}
                        </tbody></table></div>`;

  const etat = { appels: [], ecritures: [], ecrituresRefusees: 0, interdireEcritures: false, refuserListes: new Set(), perdreReponse: 0, couperAvant: 0, mails: [], panne: null };
  const lecture = (fields, r) => (fields?.length ? Object.fromEntries([["id", r.id], ...fields.map(f => [f, r[f] ?? false])]) : { ...r });
  const champProduit = (r, f) => f === "default_code" ? r.default_code : r[f];
  const recProduit = (p) => ({ id: p.id, default_code: p.cip, barcode: p.cip, name: `[${p.cip}] ${p.nom}`, product_tmpl_id: [p.tmpl, `[${p.cip}] ${p.nom}`], list_price: p.list_price,
    standard_price: p.cout ?? 0, product_variant_count: p.variantes || 1, active: true, categ_id: [p.categ || 1, "All"] });
  const pagine = (rows, kw) => rows.slice(kw.offset || 0, kw.limit ? (kw.offset || 0) + kw.limit : undefined);

  async function odoo(model, method, args = [], kwargs = {}) {
    etat.appels.push({ model, method });
    if (etat.panne && etat.panne(model, method)) throw new Error(`Odoo indisponible (${model}.${method})`);
    const ecriture = ["create", "write", "unlink"].includes(method) || (model === "mail.mail" && method === "send");
    if (ecriture) {
      if (etat.interdireEcritures) { etat.ecrituresRefusees++; throw new Error(`faux Odoo : ÉCRITURE INTERDITE (${model}.${method})`); }
      etat.ecritures.push({ model, method, args: JSON.parse(JSON.stringify(args)), at: maintenant() });
    }
    const kw = kwargs || {};
    switch (`${model}.${method}`) {
      case "product.product.search_read": return pagine([...produits.values()].map(recProduit).filter(r => evalDomaine(r, args[0], champProduit)), kw).map(r => lecture(kw.fields, r));
      case "product.product.read": return args[0].map(id => produits.get(id)).filter(Boolean).map(recProduit).map(r => lecture(args[1], r));
      case "product.category.read": return args[0].map(id => ({ id, parent_path: id === 1 ? "1/" : `1/${id}/` }));
      case "stock.location.search_read": return emplacements.filter(l => evalDomaine(l, args[0], (r, f) => r[f])).map(l => ({ id: l.id }));
      case "stock.quant.search_read": {
        const loc = new Map(emplacements.map(l => [l.id, l]));
        const rows = quants.filter(q => evalDomaine(q, args[0], (r, f) => f === "location_id.usage" ? loc.get(m2o(r.location_id))?.usage : r[f]));
        return pagine(rows, kw).map(r => lecture(kw.fields, r));
      }
      case "stock.lot.read": return args[0].map(id => lots.get(id)).filter(Boolean).map(l => lecture(args[1], l));
      case "report.product.report_pricelist.get_html": { const d = args[0]; return html(d.active_ids, d.pricelist_id); }
      case "sale.order.line.search_read": {
        const rows = ventes.filter(v => evalDomaine(v, args[0], (r, f) => f === "order_id.date_order" ? r.date_order : r[f]));
        return pagine(rows, kw).map(r => lecture(kw.fields, r));
      }
      case "sale.order.read": return args[0].map(id => { const v = ventes.find(x => m2o(x.order_id) === id); return v ? { id, pricelist_id: [v._liste || 5, `${NOMS[v._liste || 5] || "Liste"} (EUR)`] } : null; }).filter(Boolean);
      case "sale.order.read_group": return (donnees.commandesListes || []).map(c => ({ pricelist_id: [c.liste, c.nom || `${NOMS[c.liste] || "Liste"} (EUR)`], __count: c.n }));
      case "res.users.context_get": return { lang: "fr_FR", tz: "Europe/Paris", uid: 10 };
      case "res.users.read": return [{ id: 10, login: donnees.login || "pharmacien@elixirpharma.fr", name: "Sam Sayah", company_ids: donnees.societes || [1, 2, 3] }];
      case "product.pricelist.item.check_access_rights": return donnees.droits?.[args[0]] ?? true;
      case "product.pricelist.item.check_access_rule": if (donnees.refusRegle) throw new Error("Accès refusé (règle multisociété)"); return null;
      case "product.pricelist.item.search_read": {
        const rows = [...items.values()].filter(r => evalDomaine(r, args[0], (x, f) => x[f]));
        return pagine(rows, kw).map(r => lecture(kw.fields, r));
      }
      case "product.pricelist.item.search_count": return [...items.values()].filter(r => evalDomaine(r, args[0], (x, f) => x[f])).length;
      case "product.pricelist.item.read": return args[0].map(id => items.get(id)).filter(Boolean).map(r => lecture(args[1], r));
      case "product.pricelist.item.create": {
        const vals = Array.isArray(args[0]) ? args[0] : [args[0]];
        for (const v of vals) if (etat.refuserListes.has(m2o(v.pricelist_id))) throw new Error(`ValidationError : création refusée sur la liste ${m2o(v.pricelist_id)} (essai)`);
        if (etat.couperAvant > 0) { etat.couperAvant--; const e = new Error("fetch failed (coupure avant la création)"); e.name = "TimeoutError"; throw e; }
        const ids = vals.map(v => nouvelleRegle(v, { site: true }));
        if (etat.perdreReponse > 0) { etat.perdreReponse--; const e = new Error("fetch failed (réponse perdue après la création)"); e.name = "TimeoutError"; throw e; }
        return Array.isArray(args[0]) ? ids : ids[0];
      }
      case "product.pricelist.item.write": {
        for (const id of args[0]) { const it = items.get(id); if (!it) throw new Error(`MissingError : règle ${id} supprimée`); Object.assign(it, args[1]); }
        return true;
      }
      case "product.pricelist.item.unlink": { for (const id of args[0]) items.delete(id); return true; }
      case "mail.mail.create": { etat.mails.push(args[0]); return 500 + etat.mails.length; }
      case "mail.mail.send": return true;
      default: throw new Error(`faux Odoo : appel inattendu ${model}.${method}`);
    }
  }
  return {
    odoo, etat, items, produits, parCip, quants, lots, prixFacture,
    ajouterQuant, viderStockCourt: (pid) => { for (const q of quants) if (m2o(q.product_id) === pid && q.lot_id) q.quantity = 0; },
    mettreEnQuarantaine: (pid) => { for (const q of quants) if (m2o(q.product_id) === pid) q.location_id = [LOC_QUARANTAINE, "EP/Quarantaine"]; },
    reglesSite: () => [...items.values()].filter(r => r._site),
    reglesDatees: () => [...items.values()].filter(r => r.date_start),
    modifierALaMain: (id, champs) => Object.assign(items.get(id), champs),
    supprimerALaMain: (id) => items.delete(id),
    ajouterRegleALaMain: (v) => nouvelleRegle(v),
    ajouterVente: (v) => { const p = produits.get(v.pid); ventes.push({ id: 70000 + ventes.length, product_id: [v.pid, `[${p?.cip}] ${p?.nom}`], product_uom_qty: v.qte, pml_order_ref: v.ref || false,
      date_order: v.date || versOdoo(maintenant()), state: "sale", company_id: [2, "Elixir"], price_unit: v.pu ?? p?.list_price, discount: v.remise ?? 0,
      price_subtotal: round2((v.pu ?? p?.list_price) * (1 - (v.remise ?? 0) / 100) * v.qte), order_id: [80000 + ventes.length, v.commande || "S1"], invoice_status: "to invoice", _liste: v.liste || 5 }); },
  };
}

// ── Faux Supabase (PostgREST) ──
const TABLES_PRIVEES = /^peremption_/;
const UNIQUES = {
  peremption_reglages: [{ cols: ["id"] }],
  peremption_faits: [{ cols: ["cip"] }],
  peremption_decisions: [{ cols: ["id"] }, { cols: ["cip"], si: (r) => ["voulue", "partielle", "facturee", "retrait_demande", "erreur", "modifiee_odoo"].includes(r.statut) }],
  peremption_regles: [{ cols: ["id"] }, { cols: ["cip", "pricelist_id"], si: (r) => ["reservee", "active", "a_retirer", "modifiee_odoo"].includes(r.statut) }, { cols: ["odoo_item_id"], si: (r) => r.odoo_item_id != null }],
  peremption_passages: [{ cols: ["id"] }],
  odoo_catalog: [{ cols: ["cip"] }],
  kv_store: [{ cols: ["key"] }],
  ec_config: [{ cols: ["key"] }],
};
const DEFAUTS = {
  peremption_reglages: () => ({ id: 1, mode: "simulation", listes: [5, 15, 1110, 1112, 1114, 25], base_remise: "prix_base", remise_auto_pct: null, remise_max_pct: 90, sous_cout: "confirmation",
    perte_max_produit: null, budget_perte_mensuel: null, lot_long_recu: "retrait", ventes_lgo_max: null, plafond_produits_par_lot: 40, plafond_produits_factures: 120,
    plafond_regles_par_passage: 60, seuil_annonce_pct: 5, delai_retrait_min: 120, disjoncteur_sortie_pct: 30, filet_dates_odoo: "a_prouver", droits: null, verrou_jusqua: null, verrou_passage: null, verrou_appel: null, updated_by: null }),
  peremption_decisions: (t) => ({ id: randomUUID(), force_lot_long: false, long_qte_accepte: null, sous_cout_confirme: false, simulee: false, apercu: null, raison_fin: null, retrait_immediat: false,
    decide_at: t, facturee_at: null, cachee_at: null, retiree_at: null, essais: 0, erreur: null, modification: null, updated_at: t }),
  peremption_regles: (t) => ({ id: randomUUID(), odoo_item_id: null, verifiee_at: null, prix_verifie: null, instantane: null, cible: null, created_at: t, retiree_at: null, erreur: null }),
  peremption_passages: (t) => ({ id: randomUUID(), debut: t, fin: null, statut: null, plan: null, resume: null, erreurs: null, curseur: 0 }),
  peremption_journal: (t) => ({ at: t }),
  peremption_faits: () => ({ exclusions: [] }),
};
const estDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (estDate(a) && estDate(b)) return Date.parse(a.length === 10 ? `${a}T00:00:00Z` : a) - Date.parse(b.length === 10 ? `${b}T00:00:00Z` : b);
  const na = Number(a), nb = Number(b);
  if (typeof a !== "boolean" && a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}
const valeurListe = (s) => s.replace(/^\(|\)$/g, "").split(",").map(x => x.trim().replace(/^"|"$/g, ""));
function filtre(col, expr) {
  const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|in|is)\.(.*)$/s.exec(expr);
  if (!m) throw new Error(`faux Supabase : filtre ${col}=${expr}`);
  const [, non, op, v0] = m;
  const v = /^".*"$/s.test(v0) ? v0.slice(1, -1) : v0;   // valeur entre guillemets (or=(…) : « . » et « : » réservés)
  const f = (r) => {
    const x = r[col];
    switch (op) {
      case "eq": return x != null && (String(x) === v || (typeof x === "boolean" && String(x) === v) || compare(x, v) === 0);
      case "neq": return !(x != null && compare(x, v) === 0);
      case "gt": return x != null && compare(x, v) > 0;
      case "gte": return x != null && compare(x, v) >= 0;
      case "lt": return x != null && compare(x, v) < 0;
      case "lte": return x != null && compare(x, v) <= 0;
      case "like": return x != null && new RegExp(`^${v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(String(x));
      case "in": return valeurListe(v).includes(String(x));
      case "is": return v === "null" ? x == null : v === "true" ? x === true : x === false;
      default: return false;
    }
  };
  return non ? (r) => !f(r) : f;
}
function filtreOu(expr) {
  const parties = [];
  let prof = 0, cur = "";
  for (const c of expr.replace(/^\(|\)$/g, "")) { if (c === "(") prof++; if (c === ")") prof--; if (c === "," && !prof) { parties.push(cur); cur = ""; } else cur += c; }
  if (cur) parties.push(cur);
  const fs = parties.map(p => { const i = p.indexOf("."); return filtre(p.slice(0, i), p.slice(i + 1)); });
  return (r) => fs.some(f => f(r));
}
export function fauxSupabase({ maintenant = () => Date.now(), cleService = "cle-service", cleAnon = "cle-anon", tables = {} } = {}) {
  const T = new Map(Object.entries({ peremption_reglages: [DEFAUTS.peremption_reglages()], peremption_faits: [], peremption_decisions: [], peremption_regles: [], peremption_journal: [],
    peremption_passages: [], odoo_catalog: [], kv_store: [], ec_config: [], elixir_products: [], elixir_campaigns: [], elixir_orders: [], ...tables }));
  let idJournal = 0;
  const etat = { requetes: [], panne: null, anonVues: 0 };
  const rep = (corps, status = 200) => new Response(status === 204 ? null : JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });
  const conflit = (table, lignes, exclure = new Set()) => {
    for (const u of UNIQUES[table] || []) {
      const vues = new Map();
      for (const r of [...(T.get(table) || []).filter(x => !exclure.has(x)), ...lignes]) {
        if (u.si && !u.si(r)) continue;
        if (u.cols.some(c => r[c] == null)) continue;
        const k = u.cols.map(c => String(r[c])).join("|");
        if (vues.has(k)) return u.cols.join(",");
        vues.set(k, r);
      }
    }
    return null;
  };
  async function fetchFaux(url, opts = {}) {
    const u = new URL(String(url));
    const methode = (opts.method || "GET").toUpperCase();
    const table = u.pathname.replace(/^\/rest\/v1\//, "");
    const cle = String(opts.headers?.apikey || "");
    etat.requetes.push({ methode, table, url: String(url), cle: cle === cleService ? "service" : cle === cleAnon ? "anon" : "autre" });
    if (etat.panne && etat.panne(table, methode)) return rep({ message: "Supabase indisponible" }, 503);
    if (cle !== cleService && cle !== cleAnon) return rep({ message: "Invalid API key" }, 401);
    if (!T.has(table)) return rep({ code: "42P01", message: `relation "${table}" does not exist` }, 404);
    const anon = cle === cleAnon;
    if (anon && TABLES_PRIVEES.test(table)) { etat.anonVues++; if (methode === "GET") return rep([]); return rep({ code: "42501", message: "new row violates row-level security policy" }, 401); }
    const prefer = String(opts.headers?.Prefer || "");
    const filtres = [];
    let select = null, order = null, limit = null, offset = 0, onConflict = null;
    for (const [k, v] of u.searchParams) {
      if (k === "select") select = v; else if (k === "order") order = v; else if (k === "limit") limit = Number(v); else if (k === "offset") offset = Number(v);
      else if (k === "on_conflict") onConflict = v.split(","); else if (k === "or") filtres.push(filtreOu(v)); else filtres.push(filtre(k, v));
    }
    const rows = T.get(table);
    const correspond = (r) => filtres.every(f => f(r));
    const projette = (r) => (!select || select === "*" ? { ...r } : Object.fromEntries(select.split(",").map(c => [c, r[c] ?? null])));
    const t = new Date(maintenant()).toISOString();
    const copie = (x) => JSON.parse(JSON.stringify(x));
    if (methode === "GET") {
      let out = rows.filter(correspond);
      if (order) for (const o of order.split(",").reverse()) { const [c, sens] = o.split("."); out = [...out].sort((a, b) => (sens === "desc" ? -1 : 1) * compare(a[c], b[c])); }
      out = out.slice(offset, limit != null ? offset + limit : undefined);
      return rep(copie(out.map(projette)));
    }
    if (methode === "POST") {
      const corps = JSON.parse(opts.body);
      const lignes = (Array.isArray(corps) ? corps : [corps]).map(x => ({ ...(DEFAUTS[table]?.(t) || {}), ...copie(x) }));
      if (table === "peremption_journal") lignes.forEach(l => { l.id = ++idJournal; });
      if (table === "kv_store") lignes.forEach(l => { l.updated_at ||= t; });
      const fusion = /merge-duplicates/.test(prefer);
      if (fusion) {
        const cols = onConflict || (UNIQUES[table]?.[0]?.cols) || [];
        const ecrites = [];
        for (const l of lignes) {
          const ex = rows.find(r => cols.every(c => String(r[c]) === String(l[c])));
          if (ex) { Object.assign(ex, l); ecrites.push(ex); } else { rows.push(l); ecrites.push(l); }
        }
        return /return=representation/.test(prefer) ? rep(copie(ecrites.map(projette)), 201) : rep(null, 201);
      }
      const c = conflit(table, lignes);
      if (c) return rep({ code: "23505", message: `duplicate key value violates unique constraint (${table} : ${c})` }, 409);
      rows.push(...lignes);
      return /return=representation/.test(prefer) ? rep(copie(lignes.map(projette)), 201) : rep(null, 201);
    }
    if (methode === "PATCH") {
      if (table === "peremption_journal") return rep({ code: "P0001", message: "peremption_journal : ajout seul (ni modification ni suppression)" }, 400);
      const corps = JSON.parse(opts.body);
      const cibles = rows.filter(correspond);
      const apres = cibles.map(r => ({ ...r, ...copie(corps) }));
      const c = conflit(table, apres, new Set(cibles));
      if (c) return rep({ code: "23505", message: `duplicate key value violates unique constraint (${table} : ${c})` }, 409);
      cibles.forEach((r, i) => Object.assign(r, apres[i]));
      return /return=representation/.test(prefer) ? rep(copie(cibles.map(projette))) : rep(null, 204);
    }
    if (methode === "DELETE") {
      if (table === "peremption_journal") return rep({ code: "P0001", message: "peremption_journal : ajout seul (ni modification ni suppression)" }, 400);
      const garde = rows.filter(r => !correspond(r));
      T.set(table, garde);
      return rep(null, 204);
    }
    return rep({ message: "méthode" }, 405);
  }
  return { fetch: fetchFaux, T, etat, table: (n) => T.get(n), cleService, cleAnon, url: "https://supabase.faux" };
}

// ── Monde construit d'après le relevé Odoo du 20/10/2026 (q3-produits.json) et la page (odoo-catalog?expiry_months=4) ──
// releve : { rows: [{ cip, pid, tmpl, name, lp, cout, factures:{liste: prix}, court, long, sansLot, lotsCourts, lotsLongs, regles:[{l, cp, fixe, pct, mq}] }] }
// page : produits d'odoo_catalog (fenêtre) ; ventes : { [pid]: { lgo, site } } (facultatif)
export function mondeDepuisReleve(releve, page, { ventes = {} } = {}) {
  const rows = (releve?.rows || []).filter(r => !r.absent);
  const produits = rows.map(r => ({ id: r.pid, cip: r.cip, nom: r.name, tmpl: r.tmpl, list_price: r.lp, cout: r.cout }));
  const quants = [];
  for (const r of rows) {
    if (r.court > 0) quants.push({ pid: r.pid, exp: r.lotsCourts?.[0] || "2027-01-31", qte: r.court });
    if (r.long > 0) quants.push({ pid: r.pid, exp: r.lotsLongs?.[0] || "2028-06-30", qte: r.long });
    if (r.sansLot > 0) quants.push({ pid: r.pid, lot: false, qte: r.sansLot });
    if (r.exclu > 0) quants.push({ pid: r.pid, exp: r.lotsCourts?.[0] || "2027-01-31", qte: r.exclu, loc: 1789 });
  }
  const prixListes = {};
  for (const r of rows) for (const [l, p] of Object.entries(r.factures || {})) { if (Number(l) === 5) continue; (prixListes[l] ||= {})[r.pid] = p; }
  // liste 5 : barème du site + règles relevées (le site affiche bien la liste 5 : discounted_price = rapport)
  const regles = rows.flatMap(r => (r.regles || []).map(x => ({ liste: x.l, tmpl: r.tmpl, ...(x.cp === "fixed" ? { fixe: x.fixe } : { pct: x.pct }), mq: x.mq })));
  for (const r of rows) {
    const f5 = r.factures?.["5"];
    if (f5 != null && f5 < bareme5(r.lp) - 0.005 && !regles.some(x => x.liste === 5 && x.tmpl === r.tmpl && x.fixe != null && Math.abs(x.fixe - f5) < 0.005)) regles.push({ liste: 5, tmpl: r.tmpl, fixe: f5 });
  }
  const v = [];
  for (const r of rows) { const x = ventes[r.pid]; if (!x) continue; if (x.lgo) v.push({ pid: r.pid, qte: x.lgo, ref: "LGO-123" }); if (x.site) v.push({ pid: r.pid, qte: x.site, ref: "1792000000001" }); }
  const catalogue = (page || []).map(p => { const r = rows.find(x => x.cip === p.cip); return { ...p, odoo_pid: r?.pid ?? p.odoo_pid, odoo_tmpl_id: r?.tmpl ?? p.odoo_tmpl_id, categ_id: p.categ_id ?? 1 }; });
  return { produits, quants, prixListes, regles, ventes: v, catalogue, commandesListes: [{ liste: 5, n: 6628 }, { liste: 15, n: 62 }, { liste: 25, n: 10 }, { liste: 1110, n: 112 }, { liste: 1112, n: 192 }, { liste: 1114, n: 74 }] };
}
