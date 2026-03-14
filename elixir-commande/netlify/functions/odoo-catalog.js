// ── Catalogue complet Odoo : produits + stock + lots + dates de péremption ──
// GET /odoo-catalog                → tous les produits avec stock
// GET /odoo-catalog?expiry_months=4 → filtre péremption courte
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

async function fetchAll(uid, model, domain, fields, limit = 2000) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 500, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < 500 || results.length >= limit) break;
    offset += 500;
  }
  return results;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  try {
    const uid = await authenticate();

    // ── 1. Tous les produits actifs avec un default_code (CIP) ──────────
    const products = await fetchAll(uid, "product.product",
      [["active", "=", true], ["default_code", "!=", false], ["company_id", "=", COMPANY_ID]],
      ["id", "name", "default_code", "barcode", "list_price", "categ_id", "type"]
    );
    console.log(`[odoo-catalog] ${products.length} produits`);

    const pidToCip = {};
    products.forEach(p => { pidToCip[parseInt(p.id)] = p.default_code; });
    const productIds = products.map(p => parseInt(p.id));

    // ── 2. Emplacements internes ────────────────────────────────────────
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]],
      ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));

    // ── 3. Stock quants avec lot_id ─────────────────────────────────────
    let quants = [];
    if (productIds.length > 0) {
      // Construire un domain OR pour tous les product_ids
      const orPids = [];
      for (let i = 0; i < Math.min(productIds.length, 500) - 1; i++) orPids.push("|");
      productIds.slice(0, 500).forEach(id => orPids.push(["product_id", "=", id]));
      quants = await fetchAll(uid, "stock.quant", orPids,
        ["product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]
      );
      // Si plus de 500 produits, faire un second batch
      if (productIds.length > 500) {
        const orPids2 = [];
        for (let i = 0; i < productIds.slice(500).length - 1; i++) orPids2.push("|");
        productIds.slice(500).forEach(id => orPids2.push(["product_id", "=", id]));
        const q2 = await fetchAll(uid, "stock.quant", orPids2,
          ["product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]
        );
        quants.push(...q2);
      }
    }
    console.log(`[odoo-catalog] ${quants.length} quants`);

    // ── 4. Lots avec dates de péremption ────────────────────────────────
    const lotIds = [...new Set(quants.map(q => parseInt(q.lot_id)).filter(id => id > 0))];
    let lots = [];
    if (lotIds.length > 0) {
      const orLots = [];
      for (let i = 0; i < Math.min(lotIds.length, 500) - 1; i++) orLots.push("|");
      lotIds.slice(0, 500).forEach(id => orLots.push(["id", "=", id]));
      lots = await fetchAll(uid, "stock.lot", orLots,
        ["id", "name", "product_id", "expiration_date", "use_date", "life_date"]
      );
      if (lotIds.length > 500) {
        const orLots2 = [];
        for (let i = 0; i < lotIds.slice(500).length - 1; i++) orLots2.push("|");
        lotIds.slice(500).forEach(id => orLots2.push(["id", "=", id]));
        lots.push(...await fetchAll(uid, "stock.lot", orLots2,
          ["id", "name", "product_id", "expiration_date", "use_date", "life_date"]
        ));
      }
    }
    console.log(`[odoo-catalog] ${lots.length} lots`);

    const lotMap = {};
    lots.forEach(l => {
      lotMap[parseInt(l.id)] = {
        name: l.name || "",
        expiry: l.expiration_date || l.use_date || l.life_date || null,
      };
    });

    // ── 5. Agrégation stock par produit (CIP) ───────────────────────────
    const stockByCip = {}; // { cip: { qty, reserved, available, lots: [{lot_name, qty, expiry}] } }

    quants.forEach(q => {
      const locId = typeof q.location_id === "number" ? q.location_id : parseInt(q.location_id);
      if (!locationIds.has(locId)) return;
      const pid = typeof q.product_id === "number" ? q.product_id : parseInt(q.product_id);
      const cip = pidToCip[pid];
      if (!cip) return;

      if (!stockByCip[cip]) stockByCip[cip] = { qty: 0, reserved: 0, available: 0, lots: [] };
      const rawQty = parseFloat(q.quantity || 0);
      const rawRes = parseFloat(q.reserved_quantity || 0);
      stockByCip[cip].qty += rawQty;
      stockByCip[cip].reserved += rawRes;
      stockByCip[cip].available += (rawQty - rawRes);

      const lotId = parseInt(q.lot_id);
      if (lotId > 0 && lotMap[lotId]) {
        stockByCip[cip].lots.push({
          lot_name: lotMap[lotId].name,
          qty: Math.round(rawQty - rawRes),
          expiry: lotMap[lotId].expiry,
        });
      }
    });

    // ── 6. Construction du résultat ─────────────────────────────────────
    const now = new Date();
    const expiryMonths = parseInt(params.expiry_months) || 0;
    const expiryThreshold = expiryMonths > 0
      ? new Date(now.getFullYear(), now.getMonth() + expiryMonths, now.getDate()).toISOString().slice(0, 10)
      : null;

    const catalog = products.map(p => {
      const cip = p.default_code;
      const stock = stockByCip[cip] || { qty: 0, reserved: 0, available: 0, lots: [] };
      const available = Math.round(stock.available);

      // Trouver la date de péremption la plus proche parmi les lots en stock
      const activeLots = stock.lots.filter(l => l.qty > 0 && l.expiry);
      const earliestExpiry = activeLots.length > 0
        ? activeLots.sort((a, b) => (a.expiry || "9999") < (b.expiry || "9999") ? -1 : 1)[0].expiry
        : null;

      return {
        id: parseInt(p.id),
        cip,
        barcode: p.barcode || cip,
        name: p.name,
        list_price: parseFloat(p.list_price) || 0,
        category: p.categ_id || "",
        in_stock: available > 0,
        available,
        total_qty: Math.round(stock.qty),
        reserved: Math.round(stock.reserved),
        earliest_expiry: earliestExpiry,
        lots: activeLots.sort((a, b) => (a.expiry || "9999") < (b.expiry || "9999") ? -1 : 1),
      };
    });

    // Filtre péremption courte si demandé
    let result = catalog;
    if (expiryThreshold) {
      result = catalog.filter(p =>
        p.in_stock && p.earliest_expiry && p.earliest_expiry <= expiryThreshold
      );
      result.sort((a, b) => (a.earliest_expiry || "9999").localeCompare(b.earliest_expiry || "9999"));
      console.log(`[odoo-catalog] ${result.length} produits en péremption courte (<${expiryMonths} mois)`);
    }

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        products: result,
        total: result.length,
        updated_at: new Date().toISOString(),
      })
    };

  } catch (err) {
    console.error("[odoo-catalog] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
