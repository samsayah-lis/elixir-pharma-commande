// ── Catalogue complet Odoo : produits + stock + lots + dates de péremption ──
// GET /odoo-catalog                → tous les produits avec stock
// GET /odoo-catalog?expiry_months=4 → filtre péremption courte
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

async function fetchAll(uid, model, domain, fields, limit = 5000) {
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

// Construit un domain OR pour une liste d'IDs
function orDomain(field, ids, batchSize = 400) {
  if (ids.length === 0) return null;
  const batch = ids.slice(0, batchSize);
  if (batch.length === 1) return [[field, "=", batch[0]]];
  const d = [];
  for (let i = 0; i < batch.length - 1; i++) d.push("|");
  batch.forEach(id => d.push([field, "=", id]));
  return d;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  try {
    const uid = await authenticate();
    console.log(`[odoo-catalog] Auth OK, uid=${uid}`);

    // ── 1. Tous les produits actifs (PAS de filtre company_id — les produits sont partagés dans Odoo) ──
    // On prend ceux qui ont soit un default_code soit un barcode
    const products = await fetchAll(uid, "product.product",
      [["active", "=", true], "|", ["default_code", "!=", false], ["barcode", "!=", false]],
      ["id", "name", "default_code", "barcode", "list_price", "categ_id", "type"]
    );
    console.log(`[odoo-catalog] ${products.length} produits trouvés`);

    if (products.length === 0) {
      // Debug : essayer sans filtre pour voir s'il y a des produits
      const testAll = await odooCall(uid, "product.product", "search_read",
        [["active", "=", true]],
        { fields: ["id", "name", "default_code", "barcode"], limit: 5 }
      );
      console.log(`[odoo-catalog] DEBUG — test sans filtre: ${Array.isArray(testAll) ? testAll.length : 0} produits`);
      if (Array.isArray(testAll) && testAll.length > 0) {
        console.log(`[odoo-catalog] DEBUG — ex: ${JSON.stringify(testAll[0])}`);
      }
    }

    // Mapper pid → CIP (priorité default_code, fallback barcode)
    const pidToCip = {};
    const productMap = {};
    products.forEach(p => {
      const pid = parseInt(p.id);
      const cip = p.default_code || p.barcode || null;
      if (cip) {
        pidToCip[pid] = cip;
        productMap[cip] = p;
      }
    });
    const productIds = Object.keys(pidToCip).map(Number);
    console.log(`[odoo-catalog] ${productIds.length} produits avec CIP/barcode`);

    // ── 2. Emplacements internes de la société Elixir ──────────────────
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]],
      ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));
    console.log(`[odoo-catalog] ${locationIds.size} emplacements internes`);

    // ── 3. Stock quants avec lot_id ─────────────────────────────────────
    let quants = [];
    if (productIds.length > 0) {
      // Par batch de 400 produits
      for (let b = 0; b < productIds.length; b += 400) {
        const batch = productIds.slice(b, b + 400);
        const domain = orDomain("product_id", batch);
        if (domain) {
          const q = await fetchAll(uid, "stock.quant", domain,
            ["product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]
          );
          quants.push(...q);
        }
      }
    }
    console.log(`[odoo-catalog] ${quants.length} quants`);

    // ── 4. Lots avec dates de péremption ────────────────────────────────
    const lotIds = [...new Set(quants.map(q => parseInt(q.lot_id)).filter(id => id > 0))];
    let lotMap = {};
    if (lotIds.length > 0) {
      for (let b = 0; b < lotIds.length; b += 400) {
        const domain = orDomain("id", lotIds.slice(b, b + 400));
        if (domain) {
          const lots = await fetchAll(uid, "stock.lot", domain,
            ["id", "name", "product_id", "expiration_date", "use_date", "life_date"]
          );
          lots.forEach(l => {
            lotMap[parseInt(l.id)] = {
              name: l.name || "",
              expiry: l.expiration_date || l.use_date || l.life_date || null,
            };
          });
        }
      }
    }
    console.log(`[odoo-catalog] ${Object.keys(lotMap).length} lots`);

    // ── 5. Agrégation stock par CIP ─────────────────────────────────────
    const stockByCip = {};
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
    const expiryMonths = parseInt(params.expiry_months) || 0;
    const expiryThreshold = expiryMonths > 0
      ? new Date(Date.now() + expiryMonths * 30 * 86400000).toISOString().slice(0, 10)
      : null;

    const catalog = products.map(p => {
      const cip = p.default_code || p.barcode || "";
      if (!cip) return null;
      const stock = stockByCip[cip] || { qty: 0, reserved: 0, available: 0, lots: [] };
      const available = Math.round(stock.available);
      const activeLots = stock.lots.filter(l => l.qty > 0 && l.expiry);
      const earliestExpiry = activeLots.length > 0
        ? activeLots.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"))[0].expiry
        : null;

      return {
        id: parseInt(p.id),
        cip,
        barcode: p.barcode || cip,
        name: p.name || "",
        list_price: parseFloat(p.list_price) || 0,
        category: p.categ_id || "",
        in_stock: available > 0,
        available,
        total_qty: Math.round(stock.qty),
        reserved: Math.round(stock.reserved),
        earliest_expiry: earliestExpiry,
        lots: activeLots.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999")),
      };
    }).filter(Boolean);

    // Filtre péremption courte si demandé
    let result = catalog;
    if (expiryThreshold) {
      result = catalog.filter(p =>
        p.in_stock && p.earliest_expiry && p.earliest_expiry <= expiryThreshold
      );
      result.sort((a, b) => (a.earliest_expiry || "9999").localeCompare(b.earliest_expiry || "9999"));
      console.log(`[odoo-catalog] ${result.length} produits péremption courte (<${expiryMonths} mois)`);
    }

    console.log(`[odoo-catalog] ✓ ${result.length} produits retournés`);
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ products: result, total: result.length, updated_at: new Date().toISOString() })
    };

  } catch (err) {
    console.error("[odoo-catalog] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
