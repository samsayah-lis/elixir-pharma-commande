// ── Catalogue Odoo — recherche côté serveur dans Supabase ──────────────
// GET /odoo-catalog?q=EYLEA&limit=50     → recherche par nom ou CIP
// GET /odoo-catalog?count=1              → nombre total de produits
// GET /odoo-catalog?expiry_months=4      → péremption courte (avec lots)
// GET /odoo-catalog?refresh=1            → déclenche sync background
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  // ── Refresh → background function ──
  if (params.refresh === "1") {
    const host = event.headers?.host || "commandes-elixir.netlify.app";
    fetch(`https://${host}/.netlify/functions/odoo-catalog-sync-background`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }).catch(() => {});
    return { statusCode: 202, headers: cors, body: JSON.stringify({ refreshing: true }) };
  }

  try {
    // ── Count → nombre total de produits ──
    if (params.count === "1") {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip`, {
        headers: { ...SB, "Range": "0-0", "Prefer": "count=exact" }
      });
      const total = parseInt(res.headers.get("content-range")?.split("/")?.[1] || "0");
      const stockRes = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip&in_stock=eq.true`, {
        headers: { ...SB, "Range": "0-0", "Prefer": "count=exact" }
      });
      const inStock = parseInt(stockRes.headers.get("content-range")?.split("/")?.[1] || "0");
      // Date de dernière mise à jour
      const dateRes = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=updated_at&order=updated_at.desc&limit=1`, { headers: SB });
      const dateRows = await dateRes.json();
      const updatedAt = Array.isArray(dateRows) && dateRows[0] ? dateRows[0].updated_at : null;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ total, in_stock: inStock, updated_at: updatedAt }) };
    }

    // ── Péremption courte (avec lots) ──
    if (params.expiry_months) {
      const months = parseInt(params.expiry_months) || 4;
      const threshold = new Date(Date.now() + months * 30 * 86400000).toISOString().slice(0, 10);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,barcode,name,list_price,in_stock,available,earliest_expiry,lots,updated_at&in_stock=eq.true&earliest_expiry=not.is.null&earliest_expiry=lte.${threshold}&order=earliest_expiry.asc`,
        { headers: { ...SB, "Range": "0-999" } }
      );
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      const products = (Array.isArray(rows) ? rows : []).map(r => ({
        ...r, lots: (() => { try { return JSON.parse(r.lots || "[]"); } catch { return []; } })(),
      }));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ products, total: products.length }) };
    }

    // ── Recherche par nom ou CIP ──
    const q = (params.q || "").trim();
    const stockOnly = params.stock_only === "1";
    const limit = Math.min(parseInt(params.limit) || 50, 200);

    if (q.length < 2) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ products: [], total: 0, message: "min 2 caractères" }) };
    }

    // Supabase full-text : ilike pour recherche partielle
    let url;
    const isNumeric = /^\d+$/.test(q);
    if (isNumeric) {
      // Recherche par CIP (commence par)
      url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,barcode,name,list_price,in_stock,available,earliest_expiry,updated_at&or=(cip.like.${q}*,barcode.like.${q}*)`;
    } else {
      // Recherche par nom (contient)
      url = `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,barcode,name,list_price,in_stock,available,earliest_expiry,updated_at&name=ilike.*${encodeURIComponent(q)}*`;
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
