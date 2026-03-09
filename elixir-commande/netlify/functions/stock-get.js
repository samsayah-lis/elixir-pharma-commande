// Lit les stocks depuis Supabase (instantané)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks?select=cip,dispo,stock,updated_at`, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) throw new Error("Supabase error: " + await res.text());
    const rows = await res.json();

    if (!rows || rows.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null }) };
    }

    const stocks = {};
    let updatedAt = null;
    rows.forEach(r => {
      stocks[r.cip] = { dispo: r.dispo, stock: r.stock };
      if (!updatedAt || r.updated_at > updatedAt) updatedAt = r.updated_at;
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0 || s.dispo === false).length;
    console.log("[stock-get] ✓ " + rows.length + " produits · " + ruptures + " rupture(s) depuis Supabase");

    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks, updatedAt }) };
  } catch (err) {
    console.error("[stock-get] ERREUR:", err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
