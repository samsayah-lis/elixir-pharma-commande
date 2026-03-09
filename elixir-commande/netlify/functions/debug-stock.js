import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const cip = event.queryStringParameters?.cip || "3400930260494";

  try {
    // 1. Supabase
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks?cip=eq.${cip}&select=cip,dispo,stock,updated_at`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    });
    const sRows = await sRes.json();

    // 2. Odoo — chercher le produit
    const uid = await authenticate();
    const byCode = await odooCall(uid, "product.product",
      "search_read", [["default_code", "=", cip]], { fields: ["id", "default_code", "barcode", "name"], limit: 5 });
    const byBarcode = await odooCall(uid, "product.product",
      "search_read", [["barcode", "=", cip]], { fields: ["id", "default_code", "barcode", "name"], limit: 5 });

    // 3. Si trouvé, chercher les quants
    const all = [...byCode, ...byBarcode];
    let quants = [];
    if (all.length > 0) {
      const pid = parseInt(all[0].id);
      quants = await odooCall(uid, "stock.quant",
        "search_read", [["product_id", "=", pid]], 
        { fields: ["location_id", "quantity", "reserved_quantity"], limit: 20 });
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      cip,
      supabase: sRows,
      odoo_by_default_code: byCode,
      odoo_by_barcode: byBarcode,
      odoo_quants: quants
    }, null, 2)};
  } catch(err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
