// ── Catalogue Odoo — lecture rapide depuis le cache Supabase ────────────
// GET /odoo-catalog                  → tous les produits (depuis cache Supabase)
// GET /odoo-catalog?expiry_months=4  → péremption courte uniquement
// GET /odoo-catalog?refresh=1        → déclenche un refresh background Odoo → Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  // ── Refresh : déclenche le sync background ────────────────────────────
  if (params.refresh === "1") {
    try {
      // Appelle la background function (retourne 202 immédiatement)
      await fetch(
        `https://${event.headers.host}/.netlify/functions/odoo-catalog-refresh`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      ).catch(() => {}); // fire-and-forget
    } catch (e) { /* ignore */ }
    return { statusCode: 202, headers: cors, body: JSON.stringify({ message: "Refresh Odoo lancé en arrière-plan" }) };
  }

  try {
    // ── Lecture depuis Supabase (instantanée) ────────────────────────────
    let url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=*&order=name.asc`;

    // Filtre péremption courte
    const expiryMonths = parseInt(params.expiry_months) || 0;
    if (expiryMonths > 0) {
      const threshold = new Date(Date.now() + expiryMonths * 30 * 86400000).toISOString().slice(0, 10);
      url += `&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=lte.${threshold}&order=earliest_expiry.asc`;
    }

    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": "0-4999",
      }
    });

    if (!res.ok) throw new Error("Supabase: " + await res.text());
    const rows = await res.json();

    // Dé-sérialiser le champ lots (JSON string → array)
    const products = (Array.isArray(rows) ? rows : []).map(r => ({
      ...r,
      lots: (() => { try { return JSON.parse(r.lots || "[]"); } catch { return []; } })(),
    }));

    // Trouver la date de dernière mise à jour
    const updatedAt = products.length > 0
      ? products.reduce((latest, p) => p.updated_at > latest ? p.updated_at : latest, "")
      : null;

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        products,
        total: products.length,
        updated_at: updatedAt,
        source: "supabase_cache",
      })
    };

  } catch (err) {
    console.error("[odoo-catalog] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
