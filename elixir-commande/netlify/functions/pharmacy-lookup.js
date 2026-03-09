// Recherche une pharmacie dans Supabase (cache Odoo)
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

  const { email } = body;
  if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "email manquant" }) };

  const emailNorm = email.trim().toLowerCase();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(emailNorm)}&limit=1`,
    {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      }
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[pharmacy-lookup] Supabase error:", err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
  }

  const rows = await res.json();

  if (!rows || rows.length === 0) {
    console.log(`[pharmacy-lookup] Aucun résultat pour : ${emailNorm}`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
  }

  const p = rows[0];
  const pharmacy = {
    name: p.name,
    email: p.email,
    cip: p.cip || "",
    street: p.street || "",
    cp: p.cp || "",
    ville: p.ville || "",
    tel: p.tel || "",
  };

  console.log(`[pharmacy-lookup] ✓ ${pharmacy.name} (CIP7=${pharmacy.cip})`);
  return { statusCode: 200, headers: cors, body: JSON.stringify({ found: true, pharmacy }) };
};
