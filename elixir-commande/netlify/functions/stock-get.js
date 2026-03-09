import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();

    // Recherche produits par CIP (default_code)
    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));

    const products = await odooCall(uid, "product.product", "search_read", orCips, {
      fields: ["id", "default_code"], limit: 500
    });
    console.log("[stock-get] " + products.length + " produits trouvés sur " + CATALOG_CIPS.length + " CIPs");

    const cipByPid = {};
    products.forEach(p => { cipByPid[parseInt(p.id)] = p.default_code; });
    const productIds = products.map(p => parseInt(p.id));

    let quants = [];
    if (productIds.length > 0) {
      const qOrIds = [];
      for (let i = 0; i < productIds.length - 1; i++) qOrIds.push("|");
      productIds.forEach(id => qOrIds.push(["product_id", "=", id]));
      // Filtre emplacement interne uniquement (exclut virtuel/ajustements/clients)
      const qDomain = ["&", ["location_id.usage", "=", "internal"], ...qOrIds];
      quants = await odooCall(uid, "stock.quant", "search_read", qDomain, {
        fields: ["product_id", "quantity", "reserved_quantity"], limit: 5000
      });
    }
    console.log("[stock-get] " + quants.length + " lignes stock");

    const stockByCip = {};
    quants.forEach(q => {
      const pid = typeof q.product_id === "number" ? q.product_id : parseInt(q.product_id);
      const cip = cipByPid[pid];
      if (!cip) return;
      const net = parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0);
      stockByCip[cip] = (stockByCip[cip] || 0) + net;
    });

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
