// ── Catalogue Odoo — lecture rapide depuis Supabase, refresh via background fn ──
// GET /odoo-catalog                  → lecture cache Supabase (instantané)
// GET /odoo-catalog?expiry_months=4  → péremption courte
// GET /odoo-catalog?refresh=1        → déclenche la background function puis retourne 202
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  // ── Refresh : déclenche la background function (retourne 202 immédiatement) ──
  if (params.refresh === "1") {
    try {
      const host = event.headers?.host || "commandes-elixir.netlify.app";
      const proto = host.includes("localhost") ? "http" : "https";
      // La function -background retourne 202 instantanément, tourne en arrière-plan 15min max
      fetch(`${proto}://${host}/.netlify/functions/odoo-catalog-sync-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {}); // fire-and-forget
    } catch (e) { /* ignore */ }
    return { statusCode: 202, headers: cors, body: JSON.stringify({ refreshing: true, message: "Sync Odoo lancé en arrière-plan" }) };
  }

  // ── Lecture depuis Supabase ──
  try {
    let url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=*&order=name.asc`;

    const expiryMonths = parseInt(params.expiry_months) || 0;
    if (expiryMonths > 0) {
      const threshold = new Date(Date.now() + expiryMonths * 30 * 86400000).toISOString().slice(0, 10);
      url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=*&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=lte.${threshold}&order=earliest_expiry.asc`;
    }

    const res = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-4999" }
    });
    if (!res.ok) throw new Error("Supabase: " + await res.text());
    const rows = await res.json();

    const products = (Array.isArray(rows) ? rows : []).map(r => ({
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
