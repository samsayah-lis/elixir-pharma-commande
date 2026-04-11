import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const auth = verifyAdmin(event);
  if (auth.error) return auth.error;

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
