// ── Debug : teste le chargement de la liste de prix et le calcul des remises ──
import { authenticate, odooCall } from "./odoo.js";
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const diag = { timestamp: new Date().toISOString(), steps: [] };

  try {
    const uid = await authenticate();
    diag.steps.push({ step: "1. Auth", uid });

    // 2. Charger les items de la liste de prix EUR 2 (id=5)
    const items = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", 5]],
      { fields: ["id", "product_tmpl_id", "product_id", "categ_id", "compute_price", "fixed_price", "percent_price", "price_discount", "price_surcharge", "applied_on", "min_quantity", "base"], limit: 20 }
    );
    diag.steps.push({
      step: "2. Pricelist items (id=5, limit 20)",
      count: Array.isArray(items) ? items.length : 0,
      raw: Array.isArray(items) ? items.slice(0, 10) : items,
    });

    // 3. Compter le total
    const allItems = await odooCall(uid, "product.pricelist.item", "search",
      [["pricelist_id", "=", 5]],
      { limit: false }
    );
    diag.steps.push({
      step: "3. Total items pricelist 5",
      count: Array.isArray(allItems) ? allItems.length : allItems,
    });

    // 4. Tester avec un produit connu — WEGOVY 0,25mg (CIP 3400938258620)
    const wegovy = await odooCall(uid, "product.product", "search_read",
      [["default_code", "=", "3400938258620"]],
      { fields: ["id", "name", "list_price", "price"], limit: 1 }
    );
    diag.steps.push({ step: "4. WEGOVY list_price vs price (sans contexte)", raw: wegovy });

    // 5. Tester avec contexte pricelist
    const wegovyPl = await odooCall(uid, "product.product", "search_read",
      [["default_code", "=", "3400938258620"]],
      { fields: ["id", "name", "list_price", "price"], limit: 1, context: { pricelist: 5 } }
    );
    diag.steps.push({ step: "5. WEGOVY avec context pricelist=5", raw: wegovyPl });

    // 6. Tester avec context en string
    const wegovyPl2 = await odooCall(uid, "product.product", "search_read",
      [["default_code", "=", "3400938258620"]],
      { fields: ["id", "name", "list_price", "price", "lst_price"], limit: 1, context: { "pricelist": 5 } }
    );
    diag.steps.push({ step: "6. WEGOVY context pricelist=5 + lst_price", raw: wegovyPl2 });

    // 7. Lister les listes de prix disponibles
    const pricelists = await odooCall(uid, "product.pricelist", "search_read",
      [],
      { fields: ["id", "name", "active"], limit: 10 }
    );
    diag.steps.push({ step: "7. Toutes les listes de prix", raw: pricelists });

  } catch (e) {
    diag.steps.push({ step: "ERROR", error: e.message });
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify(diag, null, 2) };
};
