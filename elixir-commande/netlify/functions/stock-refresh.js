// Fonction background — lit stocks Odoo → Supabase
// FIX BUG-02 : charge les CIP depuis Supabase au lieu du fichier cips.js (vide)
import { authenticate, odooCall } from "./odoo.js";

const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

async function loadCatalogCips() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_products?active=eq.true&select=cip&cip=not.is.null`,
    { headers: { ...SB, Range: "0-1999" } }
  );
  if (!res.ok) throw new Error("Supabase CIP fetch: " + await res.text());
  const rows = await res.json();
  const cips = [...new Set(rows.map(r => r.cip?.trim()).filter(c => c && /^3\d{12}$/.test(c)))];
  console.log(`[stock-refresh] ${cips.length} CIP chargés depuis Supabase`);
  return cips;
}

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
    cip, dispo: s.dispo, stock: s.stock, updated_at: new Date().toISOString()
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks`, {
      method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(batch)
    });
    if (!res.ok) throw new Error("Supabase save: " + await res.text());
  }
  return rows.length;
}

async function saveStockSnapshot(stocks) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = Object.entries(stocks).map(([cip, s]) => ({
    cip, date: today, stock: s.stock, dispo: s.dispo
  }));
  try {
    for (let i = 0; i < rows.length; i += 200) {
      await fetch(`${SUPABASE_URL}/rest/v1/stock_history`, {
        method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(rows.slice(i, i + 200))
      });
    }
    console.log(`[stock-refresh] ✓ Snapshot quotidien sauvé (${rows.length} lignes)`);
  } catch (e) { console.warn("[stock-refresh] Snapshot error:", e.message); }
}

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const CATALOG_CIPS = await loadCatalogCips();
    if (CATALOG_CIPS.length === 0) {
      console.warn("[stock-refresh] ⚠ Aucun CIP actif dans Supabase");
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: "No active CIPs" }) };
    }
    const uid = await authenticate();
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]], ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));

    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));
    const products = await fetchAll(uid, "product.product", orCips, ["id", "default_code"]);

    const cipByPid = {};
    products.forEach(p => { cipByPid[parseInt(p.id)] = p.default_code; });
    const productIds = products.map(p => parseInt(p.id));

    let quants = [];
    if (productIds.length > 0) {
      const orPids = [];
      for (let i = 0; i < productIds.length - 1; i++) orPids.push("|");
      productIds.forEach(id => orPids.push(["product_id", "=", id]));
      quants = await fetchAll(uid, "stock.quant", orPids,
        ["product_id", "location_id", "quantity", "reserved_quantity"]
      );
    }

    const stockByCip = {};
    quants.forEach(q => {
      const locId = typeof q.location_id === "number" ? q.location_id : parseInt(q.location_id);
      if (!locationIds.has(locId)) return;
      const pid = typeof q.product_id === "number" ? q.product_id : parseInt(q.product_id);
      const cip = cipByPid[pid];
      if (!cip) return;
      stockByCip[cip] = (stockByCip[cip] || 0) + (parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0));
    });

    const stocks = {};
    CATALOG_CIPS.forEach(cip => {
      const s = stockByCip[cip];
      stocks[cip] = s !== undefined ? { dispo: s > 0 ? 1 : 0, stock: Math.round(s) } : { dispo: 1, stock: 0 };
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    const saved = await saveToSupabase(stocks);
    await saveStockSnapshot(stocks);
    console.log(`[stock-refresh] ✓ ${saved} lignes, ${ruptures} ruptures`);

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, count: saved, ruptures }) };
  } catch (err) {
    console.error("[stock-refresh] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
