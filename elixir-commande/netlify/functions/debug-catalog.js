// ── Debug : détaille les règles globales de la pricelist ────────────────
import { authenticate, odooCall } from "./odoo.js";
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  try {
    const uid = await authenticate();
    
    // Charger les règles globales avec TOUS les champs
    const globals = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", 5], ["applied_on", "=", "3_global"]],
      { fields: ["id", "name", "compute_price", "fixed_price", "percent_price", "price_discount", "price_surcharge", "price_round", "base", "base_pricelist_id", "applied_on", "min_quantity", "date_start", "date_end"], limit: 10 }
    );

    // Charger aussi les règles par catégorie
    const cats = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", 5], ["applied_on", "=", "2_product_category"]],
      { fields: ["id", "name", "categ_id", "compute_price", "fixed_price", "percent_price", "price_discount", "price_surcharge", "base", "min_quantity"], limit: 10 }
    );

    // Compter combien de produits ont chaque categ_id
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const categCounts = {};
    for (const c of (Array.isArray(cats) ? cats : [])) {
      const cid = parseInt(c.categ_id) || 0;
      if (cid > 0) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&categ_id=eq.${cid}`, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-0", "Prefer": "count=exact" }
        });
        categCounts[cid] = parseInt(res.headers.get("content-range")?.split("/")?.[1] || "0");
      }
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      global_rules: globals,
      category_rules: cats,
      products_per_category: categCounts,
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
