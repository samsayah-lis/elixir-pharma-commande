import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");

async function fetchAll(uid, model, domain, fields) {
  const results = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: pageSize, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return results;
}

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();

    // 1. Tous les emplacements internes Elixir (paginé)
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]],
      ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));
    console.log("[stock-get] " + locationIds.size + " emplacements internes company=" + COMPANY_ID);

    // 2. Produits par CIP (paginé)
    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));
    const products = await fetchAll(uid, "product.product", orCips, ["id", "default_code"]);
    console.log("[stock-get] " + products.length + " produits trouvés");

    const cipByPid = {};
    products.forEach(p => { cipByPid[parseInt(p.id)] = p.default_code; });
    const productIds = products.map(p => parseInt(p.id));

    // 3. Quants pour ces produits (paginé)
    let quants = [];
    if (productIds.length > 0) {
      const orPids = [];
      for (let i = 0; i < productIds.length - 1; i++) orPids.push("|");
      productIds.forEach(id => orPids.push(["product_id", "=", id]));
      quants = await fetchAll(uid, "stock.quant", orPids,
        ["product_id", "location_id", "quantity", "reserved_quantity"]
      );
    }
    console.log("[stock-get] " + quants.length + " quants total");

    // 4. Filtre location en JS + agrège
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

    console.log("[stock-get] Angispray=" + (stockByCip["3400930425657"] ?? "non trouvé"));

    const stocks = {};
    CATALOG_CIPS.forEach(cip => {
      const s = stockByCip[cip];
      stocks[cip] = s !== undefined
        ? { dispo: s > 0 ? 1 : 0, stock: Math.round(s) }
        : { dispo: 1, stock: 0 };
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log("[stock-get] ✓ " + (CATALOG_CIPS.length - ruptures) + " dispo · " + ruptures + " rupture(s)");

    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks, updatedAt: new Date().toISOString() }) };
  } catch (err) {
    console.error("[stock-get] ERREUR:", err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
