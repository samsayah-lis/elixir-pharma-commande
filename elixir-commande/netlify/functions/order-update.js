// Met à jour le statut processed d'une commande, ou la supprime
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { id, action, processed } = body;
  if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "id manquant" }) };

  if (action === "delete") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  // Update processed
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ processed: processed ?? true })
  });

  if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
};
