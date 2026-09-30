// ── Fiches produits Odoo : création d'un produit absent ─────────────────
// Même forme que les fiches existantes : produit partagé entre sociétés, stockable,
// suivi par lots avec dates de péremption, route « Achat », TVA de vente et d'achat
// d'Elixir (société 2), CIP7, prix public, tarif du fournisseur de l'opération.
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";

let taxCache = null, buyRoute;
// Taxes d'Elixir par taux : { sale: { 20: id, … }, purchase: { … } } (hors TTC, EU, export, exonéré)
async function elixirTaxes() {
  if (taxCache) return taxCache;
  const rows = await odoo("account.tax", "search_read", [[["company_id", "=", COMPANY_ID], ["type_tax_use", "in", ["sale", "purchase"]],
    ["amount_type", "=", "percent"], ["price_include", "=", false], ["active", "=", true]]], { fields: ["id", "name", "amount", "type_tax_use"], order: "id" });
  const ok = (t) => !/\b(EU|EX|EXEMPT|S|R E|INC)\b/.test(t.name);
  taxCache = { sale: {}, purchase: {} };
  for (const t of rows.filter(ok)) {
    const k = String(Number(t.amount));
    const bucket = taxCache[t.type_tax_use];
    if (!bucket[k] || / G$/.test(t.name)) bucket[k] = t.id;   // la taxe « … G » (générale) en priorité
  }
  return taxCache;
}
async function buyRouteId() {
  if (buyRoute !== undefined) return buyRoute;
  const [r] = await odoo("stock.route", "search_read", [[["name", "in", ["Buy", "Acheter", "Achat"]]]], { fields: ["id"], limit: 1 });
  return (buyRoute = r ? r.id : null);
}

// Recherche d'un produit par code (y compris archivé) ; null si absent
export async function findProduct(code) {
  const [p] = await odoo("product.product", "search_read", [["|", ["default_code", "=", code], ["barcode", "=", code]]],
    { fields: ["id", "name", "active"], limit: 1, context: { active_test: false, allowed_company_ids: [COMPANY_ID] } });
  return p || null;
}

// Crée la fiche si elle n'existe pas. Renvoie { id, created, archived }.
// p : { cip, name, vat, list_price, supplier_id, supplier_price, cip7, public_price }
export async function ensureOdooProduct(p) {
  const existing = await findProduct(p.cip);
  if (existing) return { id: existing.id, created: false, archived: !existing.active };
  const taxes = await elixirTaxes();
  const k = String(Number(p.vat));
  if (!["2.1", "5.5", "10", "20"].includes(k) || !taxes.sale[k] || !taxes.purchase[k]) throw new Error(`TVA ${p.vat} % non prise en charge (2,1 / 5,5 / 10 / 20 %)`);
  const route = await buyRouteId();
  const vals = {
    name: String(p.name).trim().slice(0, 200), default_code: p.cip, detailed_type: "product", categ_id: 1,
    list_price: Number(p.list_price) || 0, sale_ok: true, purchase_ok: true,
    tracking: "lot", use_expiration_date: true,
    taxes_id: [[6, 0, [taxes.sale[k]]]], supplier_taxes_id: [[6, 0, [taxes.purchase[k]]]],
    ...(route ? { route_ids: [[6, 0, [route]]] } : {}),
    ...(p.cip7 ? { cip_seven: p.cip7 } : {}),
    ...(p.public_price ? { public_price: p.public_price } : {}),
    ...(p.supplier_id ? { seller_ids: [[0, 0, { partner_id: p.supplier_id, price: Number(p.supplier_price) || 0, min_qty: 0, company_id: COMPANY_ID }]] } : {}),
  };
  const tmplId = await odoo("product.template", "create", [vals], { context: { allowed_company_ids: [COMPANY_ID] } });
  const [t] = await odoo("product.template", "read", [[tmplId]], { fields: ["product_variant_id"] });
  return { id: t.product_variant_id[0], created: true, archived: false };
}
