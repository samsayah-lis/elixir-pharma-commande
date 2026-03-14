// ── Debug prix : vérifie le contenu de kv_store et le step=compute ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const diag = {};

  try {
    // 1. Vérifier kv_store
    const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.price_map&select=key,updated_at`, { headers: SB });
    const rows = await res.json();
    diag.kv_store_exists = Array.isArray(rows) && rows.length > 0;
    diag.kv_store_updated = rows?.[0]?.updated_at || null;

    // 2. Si price_map existe, compter les entrées
    if (diag.kv_store_exists) {
      const valRes = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.price_map&select=value`, { headers: SB });
      const valRows = await valRes.json();
      if (valRows?.[0]?.value) {
        const map = JSON.parse(valRows[0].value);
        const entries = Object.entries(map);
        diag.price_map_count = entries.length;
        diag.price_map_sample = entries.slice(0, 5).map(([cip, v]) => ({ cip, ...v }));
      }
    }

    // 3. Vérifier combien de produits dans odoo_catalog ont un discounted_price
    const dpRes = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&discounted_price=not.is.null&discount_pct=gt.0`, {
      headers: { ...SB, Range: "0-0", Prefer: "count=exact" }
    });
    diag.products_with_discount = dpRes.headers.get("content-range")?.split("/")?.[1] || "0";

    // 4. Sample de produits avec remise
    const sampleRes = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,list_price,discounted_price,discount_pct&discounted_price=not.is.null&discount_pct=gt.0&limit=5`, { headers: SB });
    diag.sample_discounted = await sampleRes.json();

  } catch (e) { diag.error = e.message; }

  return { statusCode: 200, headers: cors, body: JSON.stringify(diag, null, 2) };
};
