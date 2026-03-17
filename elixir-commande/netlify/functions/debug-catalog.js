// ── Debug : vérifie les commandes dans Supabase ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  try {
    // Count total
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_orders?select=id`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-0", "Prefer": "count=exact" } }
    );
    const total = countRes.headers.get("content-range")?.split("/")?.[1] || "0";

    // Last 5 orders
    const recentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_orders?select=id,date,pharmacy_name,pharmacy_email,total_ht,nb_lignes,processed,source&order=date.desc&limit=5`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const recent = await recentRes.json();

    // Also test the order-list endpoint directly
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_orders?select=*&order=date.desc`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-499" } }
    );
    const listStatus = listRes.status;
    const listCount = (await listRes.json()).length;

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      total_orders: total,
      list_status: listStatus,
      list_count: listCount,
      recent_orders: recent,
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
