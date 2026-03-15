// ── Debug : affiche les règles de prix chargées dans kv_store ────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.pricelist_rules&select=value,updated_at`, { headers: SB });
    const rows = await res.json();
    if (!rows?.[0]?.value) return { statusCode: 200, headers: cors, body: JSON.stringify({ error: "Pas de règles dans kv_store" }) };

    const rules = JSON.parse(rows[0].value);

    // Stats
    const byType = { global: [], product_specific: [], category: [], template: [], other: [] };
    rules.forEach(r => {
      if (r.ap.includes("3")) byType.global.push(r);
      else if (r.ap.includes("0") && r.pid > 0) byType.product_specific.push(r);
      else if (r.ap.includes("2")) byType.category.push(r);
      else if (r.ap.includes("1") && r.tid > 0) byType.template.push(r);
      else byType.other.push(r);
    });

    // Compute price types
    const byCompute = {};
    rules.forEach(r => {
      const key = r.cp || "empty";
      if (!byCompute[key]) byCompute[key] = 0;
      byCompute[key]++;
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      updated_at: rows[0].updated_at,
      total_rules: rules.length,
      by_applied_on: {
        global: byType.global.length,
        product_specific: byType.product_specific.length,
        category: byType.category.length,
        template: byType.template.length,
        other: byType.other.length,
      },
      by_compute_price: byCompute,
      sample_global: byType.global.slice(0, 5),
      sample_product_specific: byType.product_specific.slice(0, 5),
      sample_category: byType.category.slice(0, 3),
      sample_template: byType.template.slice(0, 3),
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
