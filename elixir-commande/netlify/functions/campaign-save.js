const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  if (event.httpMethod === "DELETE") {
    const { id } = event.queryStringParameters || {};
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "id requis" }) };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_campaigns?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: H });
    if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  const body = JSON.parse(event.body || "{}");
  const { id, ...fields } = body;
  if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "id requis" }) };
  fields.updated_at = new Date().toISOString();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_campaigns`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id, ...fields }),
  });
  const data = await res.json();
  if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: data }) };
  return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(data) ? data[0] : data) };
};
