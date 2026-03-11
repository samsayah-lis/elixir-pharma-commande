const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const body = JSON.parse(event.body || "{}");
  if (!body.email || !body.name) return { statusCode: 400, body: JSON.stringify({ error: "email et name requis" }) };
  body.email = body.email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("elixir_pharmacies")
    .upsert(body, { onConflict: "email" })
    .select().single();
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
};
