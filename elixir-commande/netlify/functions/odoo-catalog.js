// ── Catalogue Odoo — recherche côté serveur avec prix remisés ───────────
// GET /odoo-catalog?q=EYLEA&limit=100          → recherche
// GET /odoo-catalog?q=EYLEA&stock_only=1       → que les produits en stock
// GET /odoo-catalog?count=1                    → stats catalogue
// GET /odoo-catalog?expiry_months=4            → péremption courte
// GET /odoo-catalog?refresh=1                  → trigger sync background
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  // ── Refresh ──
  if (params.refresh === "1") {
    const host = event.headers?.host || "commandes-elixir.netlify.app";
    fetch(`https://${host}/.netlify/functions/odoo-catalog-sync-background`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }).catch(() => {});
    return { statusCode: 202, headers: cors, body: JSON.stringify({ refreshing: true }) };
  }

  try {
    // ── Count ──
    if (params.count === "1") {
      const [totalRes, stockRes, dateRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip`, { headers: { ...SB, "Range": "0-0", "Prefer": "count=exact" } }),
        fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&in_stock=eq.true`, { headers: { ...SB, "Range": "0-0", "Prefer": "count=exact" } }),
        fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=updated_at&order=updated_at.desc&limit=1`, { headers: SB }),
      ]);
      const total = parseInt(totalRes.headers.get("content-range")?.split("/")?.[1] || "0");
      const inStock = parseInt(stockRes.headers.get("content-range")?.split("/")?.[1] || "0");
      const dateRows = await dateRes.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        total, in_stock: inStock, updated_at: Array.isArray(dateRows) && dateRows[0] ? dateRows[0].updated_at : null,
      })};
    }

    // ── Péremption courte : entre J+30 et fin du 4e mois ──
    if (params.expiry_months) {
      const months = parseInt(params.expiry_months) || 4;
      // Minimum : encore valide 30 jours (pas les expirés ni ceux qui expirent dans <30j)
      const minDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      // Maximum : fin du 4e mois à partir d'aujourd'hui
      const now = new Date();
      const maxDate = new Date(now.getFullYear(), now.getMonth() + months + 1, 0).toISOString().slice(0, 10);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?select=*&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=gte.${minDate}&earliest_expiry=lte.${maxDate}&order=earliest_expiry.asc`,
        { headers: { ...SB, "Range": "0-999" } }
      );
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      const products = (Array.isArray(rows) ? rows : []).map(r => ({
        ...r, lots: (() => { try { return JSON.parse(r.lots || "[]"); } catch { return []; } })(),
      }));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ products, total: products.length }) };
    }

    // ── Recherche ──
    const q = (params.q || "").trim();
    const stockOnly = params.stock_only === "1";
    const limit = Math.min(parseInt(params.limit) || 50, 200);

    if (q.length < 2) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ products: [], total: 0 }) };
    }

    // Champs retournés : inclut discounted_price et discount_pct (calculés pendant le sync)
    const fields = "cip,barcode,name,list_price,discounted_price,discount_pct,in_stock,earliest_expiry,updated_at";
    let url;
    if (/^\d+$/.test(q)) {
      url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=${fields}&or=(cip.like.${q}*,barcode.like.${q}*)`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=${fields}&name=ilike.*${encodeURIComponent(q)}*`;
    }
    if (stockOnly) url += "&in_stock=eq.true";
    url += `&order=name.asc&limit=${limit}`;

    const res = await fetch(url, { headers: SB });
    if (!res.ok) throw new Error(await res.text());
    const products = await res.json();

    return { statusCode: 200, headers: cors, body: JSON.stringify({ products: Array.isArray(products) ? products : [], total: products.length }) };
  } catch (err) {
    console.error("[odoo-catalog]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
