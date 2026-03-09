import { schedule } from "@netlify/functions";
import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function fetchAll(uid, model, domain, fields, ctx) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, {
      fields, limit: 500, offset,
      context: ctx
    });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }
  return results;
}

async function saveToSupabase(stocks) {
  const rows = Object.entries(stocks).map(([cip, s]) => ({
    cip, dispo: s.dispo, stock: s.stock,
    updated_at: new Date().toISOString()
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error("Supabase error: " + await res.text());
  return rows.length;
}

const refreshHandler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();
    const ctx = { allowed_company_ids: [COMPANY_ID] };

    // Récupère qty_available directement depuis product.product, filtré par société
    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));

    const products = await fetchAll(uid, "product.product", orCips,
      ["default_code", "qty_available"], ctx
    );
    console.log("[stock-refresh] " + products.length + " produits trouvés dans Odoo");

    // Map CIP → qty_available
    const stockByCip = {};
    products.forEach(p => {
      const qty = parseFloat(p.qty_available || 0);
      stockByCip[p.default_code] = qty;
    });

    const foundCips = new Set(products.map(p => p.default_code));

    const stocks = {};
    CATALOG_CIPS.forEach(cip => {
      if (foundCips.has(cip)) {
        const qty = stockByCip[cip];
        stocks[cip] = { dispo: qty > 0 ? 1 : 0, stock: Math.round(qty) };
      } else {
        // Absent d'Odoo → disponible par défaut (produit non géré)
        stocks[cip] = { dispo: 1, stock: 0 };
      }
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log("[stock-refresh] " + ruptures + " rupture(s)");

    const saved = await saveToSupabase(stocks);
    console.log("[stock-refresh] ✓ " + saved + " lignes sauvées dans Supabase");

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, ruptures, total: saved }) };
  } catch (err) {
    console.error("[stock-refresh] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = schedule("*/30 * * * *", refreshHandler);
