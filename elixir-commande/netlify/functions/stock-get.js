import { authenticate, odooCall } from "./odoo.js";

const CATALOG_CIPS = [
  "3400930083048","3400930260494","3400930073537","3400930073544","3400930067314",
  "3400930167267","3400930229385","3400926783501","3400930283325","3400930076279",
  "3400930141434","3400930141441","3400930075296","3400930075302","3400930075272",
  "3400930182482","3400930182505","3400930156162","3400930156179","3400930144824",
  "3400930091753","3400930108765","3400930091777","3400930108772","3400930091791",
  "3400930091807","3400930091814","3400930256527","3400930256534","3400930256541",
  "3400930256558","3400930138939","3400930175484","3400930175491","3400930064382",
  "3400930258620","3400930317815","3400930258644","3400930260241","3400930258668",
  "3400930292907","3400930292914","3400930292938","3400930292945","3400930292952","3400930292976",
  "3400930141861","3400930198087","3400930021972","3400930056296","3400930122044",
  "3400930139905","3400930179123","3400930150405","3400930164259","3400930177459",
  "3400930180644","3400930168332",
];

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();

    const domain = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) domain.push("|");
    CATALOG_CIPS.forEach(cip => domain.push(["default_code", "=", cip]));

    const products = await odooCall(uid, "product.product", "search_read", domain, {
      fields: ["id", "default_code"], limit: 200
    });

    const productIds = products.map(p => parseInt(p.id)).filter(Boolean);
    const cipByPid = {};
    products.forEach(p => { cipByPid[parseInt(p.id)] = p.default_code; });

    let quants = [];
    if (productIds.length > 0) {
      const qDomain = [];
      for (let i = 0; i < productIds.length - 1; i++) qDomain.push("|");
      productIds.forEach(id => qDomain.push(["product_id", "=", id]));
      quants = await odooCall(uid, "stock.quant", "search_read", qDomain, {
        fields: ["product_id", "quantity", "reserved_quantity"], limit: 2000
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
      const isKnown = products.some(p => p.default_code === cip);
      const s = stockByCip[cip];
      if (s !== undefined) {
        stocks[cip] = { dispo: s > 0 ? 1 : 0, stock: Math.round(s) };
      } else {
        stocks[cip] = { dispo: isKnown ? 0 : 1, stock: 0 };
      }
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log("[stock-get] ✓ " + (CATALOG_CIPS.length - ruptures) + " en stock · " + ruptures + " rupture(s)");

    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks, updatedAt: new Date().toISOString() }) };
  } catch (err) {
    console.error("[stock-get] ERREUR:", err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
