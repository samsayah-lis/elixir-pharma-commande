// Fonction background + scheduled (timeout 15min) — toutes les 30min
// Lit les stocks Odoo et les stocke dans Supabase
import { schedule } from "@netlify/functions";
import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function fetchAll(uid, model, domain, fields) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 500, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }
  return results;
}

async function saveToSupabase(stocks) {
  const rows = Object.entries(stocks).map(([cip, s]) => ({
    cip,
    dispo: s.dispo,
    stock: s.stock,
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

    // Emplacements internes Elixir
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]], ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));
    console.log("[stock-refresh] " + locationIds.size + " emplacements");

    // Produits par CIP
    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));
    const products = await fetchAll(uid, "product.product", orCips, ["id", "default_code"]);
    console.log("[stock-refresh] " + products.length + " produits");

    const cipByPid = {};
    const cipFoundInOdoo = new Set(); // CIPs effectivement trouvés dans Odoo
    products.forEach(p => {
      cipByPid[parseInt(p.id)] = p.default_code;
      cipFoundInOdoo.add(p.default_code);
    });
    const productIds = products.map(p => parseInt(p.id));

    // Quants
    let quants = [];
    if (productIds.length > 0) {
      const orPids = [];
      for (let i = 0; i < productIds.length - 1; i++) orPids.push("|");
      productIds.forEach(id => orPids.push(["product_id", "=", id]));
      quants = await fetchAll(uid, "stock.quant", orPids,
        ["product_id", "location_id", "quantity", "reserved_quantity"]
      );
    }
    console.log("[stock-refresh] " + quants.length + " quants");

    // Agrège par CIP + filtre location
    const stockByCip = {};
    quants.forEach(q => {
      const locId = typeof q.location_id === "number" ? q.location_id : parseInt(q.location_id);
      if (!locationIds.has(locId)) return;
      const pid = typeof q.product_id === "number" ? q.product_id : parseInt(q.product_id);
      const cip = cipByPid[pid];
      if (!cip) return;
      const net = parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0);
      stockByCip[cip] = (stockByCip[cip] || 0) + net;
    });

    const stocks = {};
    CATALOG_CIPS.forEach(cip => {
      const s = stockByCip[cip];
      if (s !== undefined) {
        // Produit trouvé dans les emplacements internes
        stocks[cip] = { dispo: s > 0 ? 1 : 0, stock: Math.round(s) };
      } else if (cipFoundInOdoo.has(cip)) {
        // Produit dans Odoo mais 0 stock en interne → rupture
        stocks[cip] = { dispo: 0, stock: 0 };
      } else {
        // Produit absent d'Odoo → on ne sait pas, on laisse disponible par défaut
        stocks[cip] = { dispo: 1, stock: 0 };
      }
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log("[stock-refresh] " + ruptures + " rupture(s)");

    const saved = await saveToSupabase(stocks);
    console.log("[stock-refresh] ✓ " + saved + " lignes sauvées dans Supabase");

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, ruptures }) };
  } catch (err) {
    console.error("[stock-refresh] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

// Scheduled: toutes les 30 minutes
export const handler = schedule("*/30 * * * *", refreshHandler);
