// ── Debug catalogue : diagnostic péremption + stock + lots ──────────────
import { authenticate, odooCall } from "./odoo.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const diag = { timestamp: new Date().toISOString(), steps: [] };

  // 1. Supabase odoo_catalog stats
  try {
    const [totalRes, stockRes, expiryRes, sampleRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&in_stock=eq.true`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&earliest_expiry=not.is.null`, { headers: { ...SB, Range: "0-0", Prefer: "count=exact" } }),
      fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,in_stock,available,earliest_expiry,lots&in_stock=eq.true&earliest_expiry=not.is.null&order=earliest_expiry.asc&limit=5`, { headers: SB }),
    ]);
    const total = totalRes.headers.get("content-range")?.split("/")?.[1] || "?";
    const inStock = stockRes.headers.get("content-range")?.split("/")?.[1] || "?";
    const withExpiry = expiryRes.headers.get("content-range")?.split("/")?.[1] || "?";
    const sample = await sampleRes.json();
    diag.steps.push({
      step: "1. Supabase odoo_catalog",
      total, in_stock: inStock, with_expiry: withExpiry,
      sample_expiry_products: Array.isArray(sample) ? sample : [],
    });
  } catch (e) { diag.steps.push({ step: "1. Supabase", error: e.message }); }

  // 2. Supabase — produits en stock SANS date de péremption (le problème potentiel)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,available,earliest_expiry,lots&in_stock=eq.true&earliest_expiry=is.null&limit=5`, { headers: SB });
    const rows = await res.json();
    diag.steps.push({
      step: "2. Produits en stock SANS péremption",
      sample: Array.isArray(rows) ? rows.slice(0, 5) : [],
    });
  } catch (e) { diag.steps.push({ step: "2", error: e.message }); }

  // 3. Supabase — produits avec lots non vides
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,lots&lots=not.eq.[]&limit=5`, { headers: SB });
    const rows = await res.json();
    diag.steps.push({
      step: "3. Produits avec lots non vides",
      count: Array.isArray(rows) ? rows.length : 0,
      sample: Array.isArray(rows) ? rows.slice(0, 3) : [],
    });
  } catch (e) { diag.steps.push({ step: "3", error: e.message }); }

  // 4. Odoo direct — quelques lots avec expiration_date
  try {
    const uid = await authenticate();
    const lots = await odooCall(uid, "stock.lot", "search_read",
      [["expiration_date", "!=", false]],
      { fields: ["id", "name", "product_id", "expiration_date"], limit: 10 }
    );
    diag.steps.push({
      step: "4. Odoo stock.lot avec expiration_date",
      count: Array.isArray(lots) ? lots.length : 0,
      sample: (Array.isArray(lots) ? lots : []).slice(0, 5).map(l => ({
        id: l.id, name: l.name, product_id: l.product_id, expiration_date: l.expiration_date,
      })),
    });

    // 5. Essayer use_date et life_date aussi
    const lotsUse = await odooCall(uid, "stock.lot", "search_read",
      [["use_date", "!=", false]],
      { fields: ["id", "name", "use_date"], limit: 5 }
    );
    const lotsLife = await odooCall(uid, "stock.lot", "search_read",
      [["life_date", "!=", false]],
      { fields: ["id", "name", "life_date"], limit: 5 }
    );
    diag.steps.push({
      step: "5. Odoo lots — autres champs date",
      use_date_count: Array.isArray(lotsUse) ? lotsUse.length : 0,
      use_date_sample: (Array.isArray(lotsUse) ? lotsUse : []).slice(0, 2),
      life_date_count: Array.isArray(lotsLife) ? lotsLife.length : 0,
      life_date_sample: (Array.isArray(lotsLife) ? lotsLife : []).slice(0, 2),
    });

    // 6. Un lot spécifique avec TOUS les champs pour voir la structure
    const lotAll = await odooCall(uid, "stock.lot", "search_read",
      [["name", "!=", false]],
      { fields: ["id", "name", "product_id", "expiration_date", "use_date", "life_date", "removal_date", "alert_date", "create_date"], limit: 3 }
    );
    diag.steps.push({
      step: "6. Structure complète d'un lot Odoo",
      sample: Array.isArray(lotAll) ? lotAll.slice(0, 3) : lotAll,
    });

  } catch (e) { diag.steps.push({ step: "4-6. Odoo lots", error: e.message }); }

  return { statusCode: 200, headers: cors, body: JSON.stringify(diag, null, 2) };
};
