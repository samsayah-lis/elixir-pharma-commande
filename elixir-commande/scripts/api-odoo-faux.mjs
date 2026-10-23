// ── API des pharmacies, phase 2 : faux Odoo des lectures (tests et banc d'essai) ──
// Hors ligne, données FICTIVES (CIP 3400000000011…, « PRODUIT EXEMPLE … »). Il complète le faux Odoo de l'Assistant
// (scripts/test-chat-perimetre.mjs : domaines évalués, commandes, factures, bons de livraison) avec :
//  • les listes de prix et leurs règles (product.pricelist, product.pricelist.item, product.category) ;
//  • le rapport de liste de prix (report.product.report_pricelist.get_html) qui applique la règle de facturation d'Elixir :
//    prix = le PLUS BAS des prix donnés par les règles applicables (variante, modèle, catégorie et ses parents, barème
//    global ; règle en vigueur ; quantité minimale atteinte ; formule appuyée sur le prix de base ou sur une autre liste),
//    prix de base sans règle ; rendu HTML au format d'Odoo 17 (une cellule par quantité, montants « 1 417,48 ») ;
//  • le stock libre (product.product.free_qty) et la liste de prix des fiches (res.partner.property_product_pricelist).
// Toute méthode d'écriture lève une erreur ; chaque appel est noté (appels).
import { creerFauxOdoo } from "./test-chat-perimetre.mjs";

const ECRITURES = new Set(["create", "write", "unlink", "copy", "toggle_active", "action_archive", "send", "message_post"]);
const m2o = (v) => (Array.isArray(v) ? v[0] : Number(v) || 0);
const round2 = (n) => Math.round(n * 100) / 100;
const jourDe = (v) => /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""))?.[1] || "";

// montant comme le widget monétaire d'Odoo en français : 1417.48 → « 1 417,48 » (espace fine insécable)
export const montantOdoo = (x) => {
  const [e, d] = Math.abs(x).toFixed(2).split(".");
  return `${x < 0 ? "-" : ""}${e.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${d}`;
};

// donnees : tables du faux Odoo de l'Assistant, complétées de product.pricelist, product.pricelist.item, product.category,
// product.product (list_price, product_tmpl_id, categ_id, free_qty), product.template, ir.property (contingents) ;
// jour() → « AAAA-MM-JJ » (règles en vigueur) ; lenteurMs : délai de chaque réponse (essais de coupure)
export function creerOdooApi(donnees, { jour = () => "2026-10-20" } = {}) {
  const base = creerFauxOdoo(donnees);
  const etat = { panne: false, lenteurMs: 0, appels: [] };
  const T = base.tables;
  const produit = (pid) => (T["product.product"] || []).find(p => p.id === pid);
  const parents = (categ) => { const ids = []; for (let c = categ, n = 0; c && n < 20; n++) { ids.push(c); c = m2o((T["product.category"] || []).find(x => x.id === c)?.parent_id); } return ids; };
  // prix facturé d'un produit sur une liste pour une quantité : MIN des règles applicables (règle d'Elixir)
  function prix(listeId, pid, qte, profondeur = 0) {
    const p = produit(pid);
    if (!p) return null;
    const lp = Number(p.list_price) || 0;
    const j = jour();
    const cats = parents(m2o(p.categ_id));
    const regles = (T["product.pricelist.item"] || []).filter(r => m2o(r.pricelist_id) === listeId && (Number(r.min_quantity) || 0) <= qte
      && (!jourDe(r.date_start) || jourDe(r.date_start) <= j) && (!jourDe(r.date_end) || jourDe(r.date_end) >= j)
      && (r.applied_on === "3_global" || (r.applied_on === "0_product_variant" && m2o(r.product_id) === pid)
        || (r.applied_on === "1_product" && m2o(r.product_tmpl_id) === m2o(p.product_tmpl_id)) || (r.applied_on === "2_product_category" && cats.includes(m2o(r.categ_id)))));
    if (!regles.length) return round2(lp);
    const valeurs = regles.map(r => {
      const b = r.base === "pricelist" && m2o(r.base_pricelist_id) && profondeur < 3 ? prix(m2o(r.base_pricelist_id), pid, qte, profondeur + 1) : lp;
      if (r.compute_price === "fixed") return Number(r.fixed_price);
      if (r.compute_price === "percentage") return b * (1 - (Number(r.percent_price) || 0) / 100);
      return b * (1 - (Number(r.price_discount) || 0) / 100) + (Number(r.price_surcharge) || 0);
    });
    return round2(Math.min(...valeurs));
  }
  function rapport({ active_model, active_ids, pricelist_id, quantities }) {
    if (active_model !== "product.product") throw new Error("faux Odoo : rapport attendu sur product.product");
    // comme Odoo : une liste inconnue est remplacée par une autre (search limit 1) — d'où le contrôle d'existence de l'API
    const liste = (T["product.pricelist"] || []).find(l => l.id === Number(pricelist_id)) || (T["product.pricelist"] || [])[0];
    const qs = quantities?.length ? quantities : [1];
    const lignes = active_ids.map(produit).filter(Boolean).map(p => `
                                <tr>
                                    <td>
                                        <a href="#" class="o_action" data-model="product.product" data-res-id="${p.id}">
                                            <span>[${p.default_code}] ${p.name}</span>
                                        </a>
                                    </td>${qs.map(q => `
                                        <td class="text-end">
                                            <span data-oe-type="monetary" data-oe-expression="product[&#39;price&#39;][qty]"><span class="oe_currency_value">${montantOdoo(prix(liste.id, p.id, q))}</span> €</span>
                                        </td>`).join("")}
                                </tr>`).join("");
    return `<div class="container bg-white p-4 my-4"><table class="table table-sm"><thead><th class="text-end" colspan="100%">Quantités (prix)</th><tr><th>Produits</th>${qs.map(q => `<th class="text-end"><span>${q}</span></th>`).join("")}</tr></thead><tbody>${lignes}
                        </tbody></table></div>`;
  }
  async function odoo(model, method, args, kwargs = {}, opts = {}) {
    etat.appels.push({ model, method, args: structuredClone(args), kwargs: structuredClone(kwargs), opts });
    if (etat.lenteurMs) await new Promise(r => setTimeout(r, etat.lenteurMs));
    if (etat.panne) throw new TypeError("fetch failed");
    if (ECRITURES.has(method)) throw new Error(`faux Odoo : écriture interdite (${model}.${method})`);
    if (model === "report.product.report_pricelist" && method === "get_html") return rapport(args[0]);
    return base.odoo(model, method, args, kwargs, opts);
  }
  // le même faux Odoo en JSON-RPC (fetch global : _odoo-rpc.js, appelé par _quota.js et quota-status.js)
  async function jsonrpc(body) {
    const b = JSON.parse(body).params;
    if (b.service === "common") return { result: 7 };
    const [, , , model, method, args, kwargs] = b.args;
    try { return { result: await odoo(model, method, args, kwargs, {}) }; } catch (e) { return { error: { message: e.message, data: { message: e.message } } }; }
  }
  return { odoo, jsonrpc, prix, etat, tables: T, appelsChat: base.appels };
}
