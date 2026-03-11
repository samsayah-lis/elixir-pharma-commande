const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

exports.handler = async (event) => {
  const { id } = event.queryStringParameters || {};
  let query = supabase.from("elixir_campaigns").select("*").eq("active", true).order("created_at");
  if (id) query = supabase.from("elixir_campaigns").select("*").eq("id", id).single();
  const { data, error } = await query;
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? data : (data || [])) };
};
