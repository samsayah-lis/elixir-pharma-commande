// Liste les commandes depuis Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_orders?select=*&order=date.desc`,
    {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": "0-499"
      }
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
  }

  const rows = await res.json();

  // Reformate pour correspondre au format attendu par AdminPanel
  const orders = rows.map(r => ({
    id: r.id,
    date: r.date,
    pharmacyName: r.pharmacy_name,
    pharmacyEmail: r.pharmacy_email,
    pharmacyCip: r.pharmacy_cip,
    isClient: r.is_client,
    items: r.items,
    totalHt: r.total_ht,
    nbLignes: r.nb_lignes,
    csv: r.csv,
    processed: r.processed,
  }));

  return { statusCode: 200, headers: cors, body: JSON.stringify({ orders }) };
};
