const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const q = (event.queryStringParameters?.q || "").trim().toLowerCase();
  if (!q) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "q manquant" }) };

  const isEmail = q.includes("@");
  const field = isEmail ? "email" : "name";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_pharmacies?${field}=ilike.*${encodeURIComponent(q)}*&limit=20`,
    { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(Array.isArray(data) ? data : []) };
};
