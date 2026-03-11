const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod === "DELETE") {
    const { id } = event.queryStringParameters || {};
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id requis" }) };
    const { error } = await supabase.from("elixir_campaigns").delete().eq("id", id);
    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }
  const body = JSON.parse(event.body || "{}");
  const { id, ...fields } = body;
  if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id requis" }) };
  fields.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("elixir_campaigns").upsert({ id, ...fields }, { onConflict: "id" }).select().single();
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
};
