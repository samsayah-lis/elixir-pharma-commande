// ── Test expiry sync : même logique mais limit 5 produits, résultat visible ──
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const t0 = Date.now();
  const logs = [];
  const log = (msg) => { console.log(`[test-expiry] ${msg}`); logs.push(msg); };

  try {
    // 1. Quelques produits en stock
    const stockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name&in_stock=eq.true&order=cip.asc`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-4" } }
    );
    const inStock = await stockRes.json();
    log(`${Array.isArray(inStock) ? inStock.length : 0} produits en stock (limit 5)`);
    if (!Array.isArray(inStock) || inStock.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ logs, error: "0 produits en stock" }) };
    }

    const uid = await authenticate();
    log(`Auth OK uid=${uid}`);

    // 2. CIP → PID
    const cips = inStock.map(p => p.cip);
    const products = await odooCall(uid, "product.product", "search_read",
      [["default_code", "in", cips]],
      { fields: ["id", "default_code"], limit: 10 }
    );
    const cipToPid = {};
    (Array.isArray(products) ? products : []).forEach(p => { cipToPid[p.default_code] = parseInt(p.id); });
    log(`${Object.keys(cipToPid).length} CIP→PID`);

    // 3. Quants avec lot_id pour ces produits
    const pids = Object.values(cipToPid);
    const quants = await odooCall(uid, "stock.quant", "search_read",
      [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"], ["product_id", "in", pids]],
      { fields: ["product_id", "lot_id", "quantity", "reserved_quantity"], limit: 100 }
    );
    log(`${Array.isArray(quants) ? quants.length : 0} quants`);

    // Log les quants bruts pour voir le format lot_id
    const quantDetails = (Array.isArray(quants) ? quants : []).slice(0, 10).map(q => ({
      product_id: q.product_id,
      lot_id_raw: q.lot_id,
      lot_id_type: typeof q.lot_id,
      lot_id_parsed: parseInt(q.lot_id),
      quantity: q.quantity,
      reserved_quantity: q.reserved_quantity,
    }));
    log(`Quant details: ${JSON.stringify(quantDetails)}`);

    // 4. Filtrer les lot_id valides
    const lotIdsByPid = {};
    const lotQty = {};
    (Array.isArray(quants) ? quants : []).forEach(q => {
      const qty = parseFloat(q.quantity || 0);
      const reserved = parseFloat(q.reserved_quantity || 0);
      const available = qty - reserved;
      if (available < 1) return;
      const lotId = parseInt(q.lot_id);
      if (!lotId || lotId <= 0) return;
      const pid = parseInt(q.product_id);
      if (!pid) return;
      if (!lotIdsByPid[pid]) lotIdsByPid[pid] = new Set();
      lotIdsByPid[pid].add(lotId);
      lotQty[lotId] = (lotQty[lotId] || 0) + Math.round(available);
    });
    log(`lotIdsByPid: ${JSON.stringify(Object.fromEntries(Object.entries(lotIdsByPid).map(([k,v]) => [k, [...v]])))}`);
    log(`lotQty: ${JSON.stringify(lotQty)}`);

    // 5. Charger les lots pour chaque produit
    const results = [];
    for (const prod of inStock) {
      const pid = cipToPid[prod.cip];
      if (!pid) { results.push({ cip: prod.cip, skip: "no PID" }); continue; }
      const validLotIds = lotIdsByPid[pid];
      if (!validLotIds || validLotIds.size === 0) { results.push({ cip: prod.cip, pid, skip: "no lots in quants" }); continue; }

      const lots = await odooCall(uid, "stock.lot", "search_read",
        [["product_id", "=", pid], ["expiration_date", "!=", false]],
        { fields: ["id", "name", "expiration_date"], limit: 20 }
      );
      const allLots = (Array.isArray(lots) ? lots : []).map(l => ({
        id: parseInt(l.id), name: l.name, expiry: l.expiration_date, in_quant: validLotIds.has(parseInt(l.id)),
      }));
      const filtered = allLots.filter(l => l.in_quant);

      results.push({
        cip: prod.cip, name: prod.name, pid,
        quant_lot_ids: [...validLotIds],
        all_lots_from_odoo: allLots,
        filtered_lots: filtered,
        would_update: filtered.length > 0,
      });
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ logs, results, elapsed: Date.now()-t0 }, null, 2) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ logs, error: err.message }) };
  }
};
