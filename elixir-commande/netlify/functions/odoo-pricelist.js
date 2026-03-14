// ── Listes de prix Odoo : règles de prix par pharmacie ──────────────────
// GET /odoo-pricelist?pharmacy_cip=XXX   → règles de prix de cette pharmacie
// GET /odoo-pricelist?pricelist_id=3     → règles d'une liste de prix spécifique
// GET /odoo-pricelist                    → toutes les listes de prix
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

async function fetchAll(uid, model, domain, fields) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 500, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }
  return results;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  try {
    const uid = await authenticate();
    const DEFAULT_PRICELIST_ID = 5; // "Liste de prix EUR 2" dans Odoo Elixir

    // ── 1. Si pharmacy_cip fourni, trouver sa liste de prix ─────────────
    let pricelistId = params.pricelist_id ? parseInt(params.pricelist_id) : null;
    let pharmacyName = null;

    if (params.pharmacy_cip && !pricelistId) {
      // Chercher le partenaire par son ref (CIP)
      const partners = await odooCall(uid, "res.partner", "search_read",
        [["ref", "=", params.pharmacy_cip], ["active", "=", true]],
        { fields: ["id", "name", "property_product_pricelist"], limit: 1 }
      );
      if (Array.isArray(partners) && partners.length > 0) {
        pricelistId = parseInt(partners[0].property_product_pricelist) || null;
        pharmacyName = partners[0].name;
        console.log(`[odoo-pricelist] Pharmacie ${pharmacyName} → pricelist ${pricelistId}`);
      }
    }

    // Fallback : liste de prix par défaut Elixir Pharma
    if (!pricelistId) {
      pricelistId = DEFAULT_PRICELIST_ID;
      console.log(`[odoo-pricelist] Pas de liste spécifique, fallback → pricelist ${DEFAULT_PRICELIST_ID}`);
    }

    // ── 2. Charger la/les liste(s) de prix ──────────────────────────────
    let pricelists = [];
    if (pricelistId) {
      pricelists = await odooCall(uid, "product.pricelist", "search_read",
        [["id", "=", pricelistId]],
        { fields: ["id", "name", "currency_id", "company_id"], limit: 1 }
      );
    } else {
      // Toutes les listes actives de l'entreprise
      pricelists = await fetchAll(uid, "product.pricelist",
        [["company_id", "in", [ODOO_COMPANY, false]]],
        ["id", "name", "currency_id"]
      );
    }
    console.log(`[odoo-pricelist] ${pricelists.length} liste(s) de prix`);

    // ── 3. Charger les règles de prix ───────────────────────────────────
    const plIds = pricelists.map(pl => parseInt(pl.id)).filter(Boolean);
    let items = [];
    if (plIds.length > 0) {
      const domain = plIds.length === 1
        ? [["pricelist_id", "=", plIds[0]]]
        : (() => {
            const d = [];
            for (let i = 0; i < plIds.length - 1; i++) d.push("|");
            plIds.forEach(id => d.push(["pricelist_id", "=", id]));
            return d;
          })();

      items = await fetchAll(uid, "product.pricelist.item", domain,
        ["id", "pricelist_id", "product_tmpl_id", "product_id", "categ_id",
         "compute_price", "fixed_price", "percent_price", "price_discount",
         "price_surcharge", "base", "min_quantity", "date_start", "date_end",
         "applied_on", "name"]
      );
    }
    console.log(`[odoo-pricelist] ${items.length} règle(s) de prix`);

    // ── 4. Charger les products pour mapper product_tmpl_id → CIP ──────
    const tmplIds = [...new Set(items.map(i => parseInt(i.product_tmpl_id)).filter(id => id > 0))];
    const prodIds = [...new Set(items.map(i => parseInt(i.product_id)).filter(id => id > 0))];
    let prodMap = {}; // id → {cip, name}

    if (prodIds.length > 0) {
      const orPids = [];
      for (let i = 0; i < prodIds.length - 1; i++) orPids.push("|");
      prodIds.forEach(id => orPids.push(["id", "=", id]));
      const prods = await fetchAll(uid, "product.product", orPids, ["id", "default_code", "name"]);
      prods.forEach(p => { prodMap[parseInt(p.id)] = { cip: p.default_code, name: p.name }; });
    }

    // ── 5. Formater les règles ──────────────────────────────────────────
    const now = new Date().toISOString().slice(0, 10);
    const rules = items.map(item => {
      // Vérifier validité temporelle
      if (item.date_start && item.date_start > now) return null;
      if (item.date_end && item.date_end < now) return null;

      const productId = parseInt(item.product_id) || null;
      const tmplId = parseInt(item.product_tmpl_id) || null;
      const prod = productId ? prodMap[productId] : null;

      // Type de calcul
      let type = "unknown";
      let discount = 0;
      let fixedPrice = null;

      const computePrice = item.compute_price || "";
      if (computePrice === "fixed" || parseFloat(item.fixed_price) > 0) {
        type = "fixed";
        fixedPrice = parseFloat(item.fixed_price) || 0;
      } else if (computePrice === "percentage" || parseFloat(item.percent_price) > 0) {
        type = "percentage";
        discount = parseFloat(item.percent_price) || parseFloat(item.price_discount) || 0;
      } else if (computePrice === "formula") {
        type = "formula";
        discount = parseFloat(item.price_discount) || 0;
      }

      // applied_on : 3_global, 2_product_category, 1_product, 0_product_variant
      const appliedOn = item.applied_on || "";

      return {
        id: parseInt(item.id),
        pricelist_id: parseInt(item.pricelist_id) || null,
        product_id: productId,
        product_tmpl_id: tmplId,
        cip: prod?.cip || null,
        product_name: prod?.name || item.name || null,
        categ_id: parseInt(item.categ_id) || null,
        applied_on: appliedOn,
        type,
        discount,
        fixed_price: fixedPrice,
        surcharge: parseFloat(item.price_surcharge) || 0,
        min_quantity: parseFloat(item.min_quantity) || 0,
        base: item.base || "list_price",
      };
    }).filter(Boolean);

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        pharmacy_cip: params.pharmacy_cip || null,
        pharmacy_name: pharmacyName,
        pricelist_id: pricelistId,
        pricelists: pricelists.map(pl => ({ id: parseInt(pl.id), name: pl.name })),
        rules,
        total_rules: rules.length,
      })
    };

  } catch (err) {
    console.error("[odoo-pricelist] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
