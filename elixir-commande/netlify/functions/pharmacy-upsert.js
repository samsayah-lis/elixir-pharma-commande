import { getCors } from "./cors.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "POST only" };

  const body = JSON.parse(event.body || "{}");
  if (!body.email || !body.name) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "email et name requis" }) };
  body.email = body.email.trim().toLowerCase();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: data }) };
  return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(data) ? data[0] : data) };
};
