const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const { id } = event.queryStringParameters || {};
  let url;
  if (id) {
    url = `${SUPABASE_URL}/rest/v1/elixir_campaigns?id=eq.${encodeURIComponent(id)}&limit=1`;
  } else {
    url = `${SUPABASE_URL}/rest/v1/elixir_campaigns?active=eq.true&order=created_at`;
  }
  const res = await fetch(url, { headers: H });
  const data = await res.json();
  if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: data }) };
  return { statusCode: 200, headers: cors, body: JSON.stringify(id ? (data[0] || null) : (data || [])) };
};
