// ── Debug : teste la même logique que le sync mais avec des limites réduites ──
import { authenticate, odooCall } from "./odoo.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const diag = { timestamp: new Date().toISOString(), steps: [] };

  // 1. Supabase odoo_catalog état actuel
  try {
    const [totalR, stockR, expiryR, sampleR] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&in_stock=eq.true`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&earliest_expiry=not.is.null`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,available,earliest_expiry,lots&earliest_expiry=not.is.null&order=earliest_expiry.asc&limit=3`, { headers: SB }),
    ]);
    diag.steps.push({
      step: "1. Supabase odoo_catalog",
      total: totalR.headers.get("content-range")?.split("/")?.[1] || "?",
      in_stock: stockR.headers.get("content-range")?.split("/")?.[1] || "?",
      with_expiry: expiryR.headers.get("content-range")?.split("/")?.[1] || "?",
      sample: await sampleR.json(),
    });
  } catch (e) { diag.steps.push({ step: "1", error: e.message }); }

  try {
    const uid = await authenticate();
    diag.steps.push({ step: "2. Odoo auth", uid });

    // 3. Lots avec expiration_date (test simple, limit 5)
    const lots = await odooCall(uid, "stock.lot", "search_read",
      [["expiration_date", "!=", false]],
      { fields: ["id", "name", "product_id", "expiration_date"], limit: 5 }
    );
    diag.steps.push({
      step: "3. stock.lot avec expiration_date (limit 5)",
      count: Array.isArray(lots) ? lots.length : 0,
      sample: (Array.isArray(lots) ? lots : []).slice(0, 3),
    });

    // 4. Combien de lots au total avec expiration_date ?
    // On utilise search (count) au lieu de search_read
    let lotCount = "?";
    try {
      const countResult = await odooCall(uid, "stock.lot", "search",
        [["expiration_date", "!=", false]],
        { limit: false }
      );
      lotCount = Array.isArray(countResult) ? countResult.length : countResult;
    } catch (e) {
      lotCount = "error: " + e.message.substring(0, 100);
    }
    diag.steps.push({ step: "4. Total lots avec expiration", count: lotCount });

    // 5. Quants — test simple
    const quants = await odooCall(uid, "stock.quant", "search_read",
      [["company_id", "=", 2], ["location_id.usage", "=", "internal"]],
      { fields: ["product_id", "quantity", "reserved_quantity"], limit: 5 }
    );
    diag.steps.push({
      step: "5. stock.quant internes (limit 5)",
      count: Array.isArray(quants) ? quants.length : 0,
      sample: (Array.isArray(quants) ? quants : []).slice(0, 3),
    });

    // 6. Teste un produit en stock spécifique — ULTRA-LEVURE (CIP 3400922096612)
    const testProd = await odooCall(uid, "product.product", "search_read",
      [["default_code", "=", "3400922096612"]],
      { fields: ["id", "name", "default_code", "list_price"], limit: 1 }
    );
    if (Array.isArray(testProd) && testProd.length > 0) {
      const testPid = parseInt(testProd[0].id);
      // Lots de ce produit
      const testLots = await odooCall(uid, "stock.lot", "search_read",
        [["product_id", "=", testPid]],
        { fields: ["id", "name", "expiration_date"], limit: 5 }
      );
      diag.steps.push({
        step: "6. Test ULTRA-LEVURE (en stock, pid=" + testPid + ")",
        product: testProd[0],
        lots: Array.isArray(testLots) ? testLots : [],
      });
    }

  } catch (e) { diag.steps.push({ step: "2+", error: e.message }); }

  return { statusCode: 200, headers: cors, body: JSON.stringify(diag, null, 2) };
};
