// ── Catalogue Odoo — lecture paginée depuis Supabase ────────────────────
// GET /odoo-catalog                  → tous les produits
// GET /odoo-catalog?expiry_months=4  → péremption courte
// GET /odoo-catalog?refresh=1        → déclenche sync background
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

// Supabase retourne max 1000 lignes par requête — il faut paginer
async function fetchAllFromSupabase(url) {
  const allRows = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": `${offset}-${offset + pageSize - 1}`,
      }
    });
    if (!res.ok) throw new Error("Supabase: " + await res.text());
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  // ── Refresh : fire-and-forget vers la background function ─────────────
  if (params.refresh === "1") {
    try {
      const host = event.headers?.host || "commandes-elixir.netlify.app";
      const proto = host.includes("localhost") ? "http" : "https";
      fetch(`${proto}://${host}/.netlify/functions/odoo-catalog-sync-background`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
    } catch (e) { /* ignore */ }
    return { statusCode: 202, headers: cors, body: JSON.stringify({ refreshing: true }) };
  }

  // ── Lecture paginée depuis Supabase ────────────────────────────────────
  try {
    let url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=*&order=name.asc`;

    const expiryMonths = parseInt(params.expiry_months) || 0;
    if (expiryMonths > 0) {
      const threshold = new Date(Date.now() + expiryMonths * 30 * 86400000).toISOString().slice(0, 10);
      url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=*&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=lte.${threshold}&order=earliest_expiry.asc`;
    }

    const rows = await fetchAllFromSupabase(url);

    const products = rows.map(r => ({
      ...r,
      lots: (() => { try { return JSON.parse(r.lots || "[]"); } catch { return []; } })(),
    }));

    const updatedAt = products.length > 0
      ? products.reduce((latest, p) => (p.updated_at || "") > latest ? p.updated_at : latest, "")
      : null;

    return { statusCode: 200, headers: cors, body: JSON.stringify({ products, total: products.length, updated_at: updatedAt }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
