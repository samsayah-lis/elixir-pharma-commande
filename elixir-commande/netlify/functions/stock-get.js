import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();

    const domain = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) domain.push("|");
    CATALOG_CIPS.forEach(cip => domain.push(["default_code", "=", cip]));

    const products = await odooCall(uid, "product.product", "search_read", domain, {
      fields: ["id", "default_code"], limit: 500
    });
    console.log("[stock-get] " + products.length + " produits trouvés sur " + CATALOG_CIPS.length + " CIPs");

    const cipByPid = {};
    products.forEach(p => { cipByPid[parseInt(p.id)] = p.default_code; });
    const productIds = products.map(p => parseInt(p.id));

    let quants = [];
    if (productIds.length > 0) {
      const qDomain = [];
      for (let i = 0; i < productIds.length - 1; i++) qDomain.push("|");
      productIds.forEach(id => qDomain.push(["product_id", "=", id]));
      quants = await odooCall(uid, "stock.quant", "search_read", qDomain, {
        fields: ["product_id", "quantity", "reserved_quantity"], limit: 5000
      });
    }

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
      // Rupture seulement si quant explicite ≤ 0
      // Pas de quant = disponible par défaut (produit sur commande)
      stocks[cip] = s !== undefined
        ? { dispo: s > 0 ? 1 : 0, stock: Math.round(s) }
        : { dispo: 1, stock: 0 };
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log("[stock-get] ✓ " + (CATALOG_CIPS.length - ruptures) + " en stock · " + ruptures + " rupture(s)");

    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks, updatedAt: new Date().toISOString() }) };
  } catch (err) {
    console.error("[stock-get] ERREUR:", err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
