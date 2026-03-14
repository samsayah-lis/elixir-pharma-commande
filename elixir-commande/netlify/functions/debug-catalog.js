// ── Debug : teste le parsing lot_id depuis les quants Elixir ────────────
import { authenticate, odooCall } from "./odoo.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const diag = { timestamp: new Date().toISOString(), steps: [] };

  try {
    const uid = await authenticate();

    // 1. ULTRA-LEVURE pid
    const prod = await odooCall(uid, "product.product", "search_read",
      [["default_code", "=", "3400922096612"]],
      { fields: ["id", "name"], limit: 1 }
    );
    const pid = Array.isArray(prod) && prod[0] ? parseInt(prod[0].id) : null;
    diag.steps.push({ step: "1. ULTRA-LEVURE", pid, product: prod?.[0] });

    // 2. Quants Elixir pour ce produit AVEC lot_id
    if (pid) {
      const quants = await odooCall(uid, "stock.quant", "search_read",
        [["product_id", "=", pid], ["company_id", "=", 2], ["location_id.usage", "=", "internal"]],
        { fields: ["id", "lot_id", "quantity", "reserved_quantity", "location_id"], limit: 20 }
      );
      diag.steps.push({
        step: "2. Quants Elixir pour ULTRA-LEVURE (avec lot_id)",
        count: Array.isArray(quants) ? quants.length : 0,
        raw: Array.isArray(quants) ? quants.slice(0, 5) : quants,
      });

      // 3. Extraire les lot_id parsés
      const lotIds = (Array.isArray(quants) ? quants : [])
        .map(q => ({ lot_id_raw: q.lot_id, lot_id_parsed: parseInt(q.lot_id), qty: q.quantity }))
        .filter(q => parseFloat(q.qty) > 0);
      diag.steps.push({ step: "3. lot_id parsing", parsed: lotIds });

      // 4. Si on a des lot_ids, charger les lots correspondants
      const validLotIds = lotIds.map(l => l.lot_id_parsed).filter(id => id > 0);
      if (validLotIds.length > 0) {
        const lots = await odooCall(uid, "stock.lot", "search_read",
          [["id", "in", validLotIds]],
          { fields: ["id", "name", "expiration_date", "company_id"], limit: 20 }
        );
        diag.steps.push({
          step: "4. Lots trouvés par lot_id depuis quants",
          count: Array.isArray(lots) ? lots.length : 0,
          lots: Array.isArray(lots) ? lots : [],
        });
      } else {
        diag.steps.push({ step: "4. Aucun lot_id valide parsé", validLotIds });
      }

      // 5. AUSSI : tous les lots de ce produit (pour comparer)
      const allLots = await odooCall(uid, "stock.lot", "search_read",
        [["product_id", "=", pid], ["expiration_date", "!=", false]],
        { fields: ["id", "name", "expiration_date", "company_id"], limit: 10 }
      );
      diag.steps.push({
        step: "5. TOUS les lots du produit (toutes sociétés)",
        count: Array.isArray(allLots) ? allLots.length : 0,
        lots: Array.isArray(allLots) ? allLots : [],
      });
    }

    // 6. Supabase état péremption
    const [expiryRes, sampleRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&earliest_expiry=not.is.null`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,earliest_expiry,lots&earliest_expiry=not.is.null&order=earliest_expiry.asc&limit=3`, { headers: SB }),
    ]);
    diag.steps.push({
      step: "6. Supabase produits avec péremption",
      count: expiryRes.headers.get("content-range")?.split("/")?.[1] || "0",
      sample: await sampleRes.json(),
    });

  } catch (e) { diag.steps.push({ step: "error", error: e.message }); }

  return { statusCode: 200, headers: cors, body: JSON.stringify(diag, null, 2) };
};
