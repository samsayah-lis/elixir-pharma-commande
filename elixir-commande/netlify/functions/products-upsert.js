// Crée ou met à jour un produit dans Supabase avec historique
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

  const { product, action, author } = body;
  if (!product?.cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip manquant" }) };

  const now = new Date().toISOString();

  // Récupère l'historique existant si c'est une mise à jour
  let history = [];
  if (action !== "create") {
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${product.cip}&select=history`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await existing.json();
    if (rows?.[0]?.history) {
      try { history = JSON.parse(rows[0].history); } catch {}
    }
  }

  // Ajoute l'entrée d'historique
  history.push({
    action: action || "update",
    date: now,
    author: author || "admin",
    changes: product._changes || null,
  });

  const row = {
    cip: product.cip,
    name: product.name,
    section: product.section,
    pv: product.pv ?? null,
    pct: product.pct ?? null,
    pn: product.pn ?? null,
    remise_eur: product.remise_eur ?? null,
    colis: product.colis ?? null,
    carton: product.carton ?? null,
    note: product.note ?? null,
    active: product.active ?? true,
    source: product.source || "admin",
    history: JSON.stringify(history),
    updated_at: now,
    ...(action === "create" ? { created_at: now } : {}),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[products-upsert] Supabase error:", err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
  }

  console.log(`[products-upsert] ✓ ${action || "update"} — ${product.name} (${product.cip})`);
  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
};
