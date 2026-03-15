// ── Debug : vérifie le contenu de elixir_products ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  try {
    // Count all
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?select=cip`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-0", "Prefer": "count=exact" } }
    );
    const total = countRes.headers.get("content-range")?.split("/")?.[1] || "0";

    // Count active
    const activeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?select=cip&active=eq.true`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-0", "Prefer": "count=exact" } }
    );
    const totalActive = activeRes.headers.get("content-range")?.split("/")?.[1] || "0";

    // Last 5 added
    const recentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?select=cip,name,section,active,source,created_at&order=created_at.desc&limit=5`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const recent = await recentRes.json();

    // By section
    const allRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?select=section,active&active=eq.true`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-9999" } }
    );
    const all = await allRes.json();
    const bySection = {};
    (Array.isArray(all) ? all : []).forEach(p => {
      bySection[p.section] = (bySection[p.section] || 0) + 1;
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ total, totalActive, bySection, recent }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
