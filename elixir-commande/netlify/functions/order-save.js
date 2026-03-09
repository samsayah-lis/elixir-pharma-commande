// Sauvegarde une commande dans Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let order;
  try { order = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const row = {
    id: order.id,
    date: order.date || new Date().toISOString(),
    pharmacy_name: order.pharmacyName,
    pharmacy_email: order.pharmacyEmail,
    pharmacy_cip: order.pharmacyCip || null,
    is_client: order.isClient ?? true,
    items: order.items,
    total_ht: order.totalHt,
    nb_lignes: order.nbLignes,
    csv: order.csv || null,
    processed: false,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[order-save] Supabase error:", err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
  }

  console.log(`[order-save] ✓ Commande ${order.id} sauvegardée (${order.pharmacyName})`);
  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
};
