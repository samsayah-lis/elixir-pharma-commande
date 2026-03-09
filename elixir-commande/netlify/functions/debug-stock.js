// Endpoint temporaire de debug — à supprimer après diagnostic
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    // 1. Lire les données brutes de Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks?select=cip,dispo,stock,updated_at&limit=10`, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    });
    const rows = await res.json();

    // 2. Compter les ruptures avec différentes méthodes de comparaison
    const total = rows.length;
    const ruptures_strict_0    = rows.filter(r => r.dispo === 0).length;
    const ruptures_strict_false = rows.filter(r => r.dispo === false).length;
    const ruptures_loose_0     = rows.filter(r => r.dispo == 0).length;
    const ruptures_falsy       = rows.filter(r => !r.dispo).length;

    // 3. Voir le type exact de dispo sur les premières lignes
    const sample = rows.slice(0, 5).map(r => ({
      cip: r.cip,
      dispo: r.dispo,
      dispo_type: typeof r.dispo,
      dispo_value: JSON.stringify(r.dispo),
      stock: r.stock,
      updated_at: r.updated_at
    }));

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        total_rows_in_supabase: total,
        ruptures_strict_0,
        ruptures_strict_false,
        ruptures_loose_0,
        ruptures_falsy,
        sample_data: sample
      }, null, 2)
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
