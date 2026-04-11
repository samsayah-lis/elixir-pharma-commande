import { getCors } from "./cors.js";
// Retourne tous les produits actifs depuis Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_products?active=eq.true&order=section.asc,name.asc&select=*`,
    {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": "0-4999",
      }
    }
  );

  if (!res.ok) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
  }

  const products = await res.json();
  return { statusCode: 200, headers: cors, body: JSON.stringify({ products }) };
};
