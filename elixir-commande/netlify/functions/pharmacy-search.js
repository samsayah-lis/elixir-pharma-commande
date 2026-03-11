const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

exports.handler = async (event) => {
  const q = (event.queryStringParameters?.q || "").trim().toLowerCase();
  if (!q) return { statusCode: 400, body: JSON.stringify({ error: "q manquant" }) };

  const isEmail = q.includes("@");
  let query;
  if (isEmail) {
    query = supabase.from("elixir_pharmacies").select("*").ilike("email", `%${q}%`).limit(20);
  } else {
    query = supabase.from("elixir_pharmacies").select("*").ilike("name", `%${q}%`).limit(20);
  }
  const { data, error } = await query;
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || []) };
};
