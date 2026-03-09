const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks?select=cip,dispo,stock,updated_at`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Range-Unit": "items",
      "Range": "0-999"
    }
  });
  const rows = await res.json();
  const ruptures = rows.filter(r => r.dispo === 0);
  return {
    statusCode: 200, headers: cors,
    body: JSON.stringify({
      total_fetched: rows.length,
      ruptures_count: ruptures.length,
      ruptures_cips: ruptures.map(r => r.cip),
    }, null, 2)
  };
};
