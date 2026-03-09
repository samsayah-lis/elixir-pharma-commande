import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");

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
  const cors = { "Access-Control-Allow-Origin": "*" };
  const step = event.queryStringParameters?.step || "all";

  try {
    // STEP 1 : Supabase — compter toutes les lignes
    if (step === "supabase" || step === "all") {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks?select=cip,dispo,stock`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "count=exact" }
      });
      const rows = await res.json();
      const total = rows.length;
      const ruptures = rows.filter(r => r.dispo === 0).length;
      // Check which catalogue CIPs are missing from Supabase
      const supabaseCips = new Set(rows.map(r => r.cip));
      const missingFromSupabase = CATALOG_CIPS.filter(c => !supabaseCips.has(c));

      if (step === "supabase") {
        return { statusCode: 200, headers: cors, body: JSON.stringify({
          supabase_total: total,
          catalog_total: CATALOG_CIPS.length,
          ruptures_in_supabase: ruptures,
          missing_from_supabase: missingFromSupabase.length,
          missing_cips_sample: missingFromSupabase.slice(0, 10)
        }, null, 2)};
      }
    }

    // STEP 2 : Odoo — chercher les produits par default_code et barcode
    const uid = await authenticate();

    // Cherche via default_code
    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));
    const byCode = await fetchAll(uid, "product.product", orCips, ["id", "default_code", "barcode"]);

    // Cherche via barcode
    const orBarcodes = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orBarcodes.push("|");
    CATALOG_CIPS.forEach(cip => orBarcodes.push(["barcode", "=", cip]));
    const byBarcode = await fetchAll(uid, "product.product", orBarcodes, ["id", "default_code", "barcode"]);

    const foundCodes = new Set(byCode.map(p => p.default_code));
    const foundBarcodes = new Set(byBarcode.map(p => p.barcode));
    const notFoundAnywhere = CATALOG_CIPS.filter(c => !foundCodes.has(c) && !foundBarcodes.has(c));

    // Emplacements
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]], ["id", "complete_name"]
    );

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      catalog_total: CATALOG_CIPS.length,
      found_via_default_code: byCode.length,
      found_via_barcode: byBarcode.length,
      not_found_anywhere: notFoundAnywhere.length,
      not_found_sample: notFoundAnywhere.slice(0, 10),
      sample_default_code: byCode.slice(0, 3).map(p => ({ id: p.id, code: p.default_code, barcode: p.barcode })),
      sample_barcode: byBarcode.slice(0, 3).map(p => ({ id: p.id, code: p.default_code, barcode: p.barcode })),
      odoo_internal_locations: locations.length,
      location_sample: locations.slice(0, 5).map(l => ({ id: l.id, name: l.complete_name }))
    }, null, 2)};

  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
