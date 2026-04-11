import { getCors } from "./cors.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const q = (event.queryStringParameters?.q || "").trim();
  if (!q) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "q manquant" }) };

  const field = q.includes("@") ? "email" : "name";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_pharmacies?${field}=ilike.*${encodeURIComponent(q)}*&limit=20`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(data) ? data : []) };
};
