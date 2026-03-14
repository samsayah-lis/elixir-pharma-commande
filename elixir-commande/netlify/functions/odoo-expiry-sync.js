// ── Sync péremptions par batch — function normale (10s timeout) ─────────
// GET /odoo-expiry-sync?offset=0  → traite les produits 0-14 en stock
// GET /odoo-expiry-sync?offset=15 → traite les produits 15-29 en stock
// Retourne { done, offset, next_offset, updated, total_in_stock }
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const BATCH_SIZE = 15; // ~3s pour 5 produits → 15 en ~9s (sous les 10s)

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const offset = parseInt(event.queryStringParameters?.offset || "0");

  try {
    // 1. Produits en stock depuis Supabase (juste ce batch)
    const stockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name&in_stock=eq.true&order=cip.asc`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": `${offset}-${offset + BATCH_SIZE - 1}`, "Prefer": "count=exact" } }
    );
    const totalInStock = parseInt(stockRes.headers.get("content-range")?.split("/")?.[1] || "0");
    const batch = await stockRes.json();
    if (!Array.isArray(batch) || batch.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: true, offset, total_in_stock: totalInStock, updated: 0 }) };
    }

    const uid = await authenticate();

    // 2. CIP → PID
    const cips = batch.map(p => p.cip);
    const products = await odooCall(uid, "product.product", "search_read",
      [["default_code", "in", cips]],
      { fields: ["id", "default_code"], limit: BATCH_SIZE + 5 }
    );
    const cipToPid = {};
    (Array.isArray(products) ? products : []).forEach(p => { cipToPid[p.default_code] = parseInt(p.id); });

    // 3. Quants avec lot_id pour ces produits
    const pids = Object.values(cipToPid);
    const quants = await odooCall(uid, "stock.quant", "search_read",
      [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"], ["product_id", "in", pids]],
      { fields: ["product_id", "lot_id", "quantity", "reserved_quantity"], limit: 500 }
    );

    // Extraire lot_id par PID
    const lotIdsByPid = {};
    const lotQty = {};
    (Array.isArray(quants) ? quants : []).forEach(q => {
      const qty = parseFloat(q.quantity || 0);
      const reserved = parseFloat(q.reserved_quantity || 0);
      if (qty - reserved < 1) return;
      const lotId = parseInt(q.lot_id);
      if (!lotId || lotId <= 0) return;
      const pid = parseInt(q.product_id);
      if (!pid) return;
      if (!lotIdsByPid[pid]) lotIdsByPid[pid] = new Set();
      lotIdsByPid[pid].add(lotId);
      lotQty[lotId] = (lotQty[lotId] || 0) + Math.round(qty - reserved);
    });

    // 4. Charger les lots et mettre à jour Supabase
    let updated = 0;
    const now = new Date().toISOString();

    for (const prod of batch) {
      const pid = cipToPid[prod.cip];
      if (!pid) continue;
      const validLotIds = lotIdsByPid[pid];
      if (!validLotIds || validLotIds.size === 0) continue;

      try {
        const lots = await odooCall(uid, "stock.lot", "search_read",
          [["product_id", "=", pid], ["expiration_date", "!=", false]],
          { fields: ["id", "name", "expiration_date"], limit: 50 }
        );
        if (!Array.isArray(lots) || lots.length === 0) continue;

        const filtered = lots.filter(l => validLotIds.has(parseInt(l.id)));
        const parsed = filtered.map(l => ({
          lot_name: l.name || "",
          qty: lotQty[parseInt(l.id)] || 0,
          expiry: (l.expiration_date || "").split(" ")[0],
        })).filter(l => l.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry));

        if (parsed.length > 0) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${prod.cip}`, {
            method: "PATCH", headers: SB,
            body: JSON.stringify({ earliest_expiry: parsed[0].expiry, lots: JSON.stringify(parsed.slice(0, 10)), updated_at: now }),
          });
          if (res.ok) updated++;
        }
      } catch (e) { /* skip this product */ }
    }

    const nextOffset = offset + batch.length;
    const done = nextOffset >= totalInStock;

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      done, offset, next_offset: done ? null : nextOffset,
      batch_size: batch.length, updated, total_in_stock: totalInStock,
    })};

  } catch (err) {
    console.error("[expiry-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
