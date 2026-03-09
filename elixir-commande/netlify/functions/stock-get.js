import { authenticate, odooCall } from "./odoo.js";
import { CATALOG_CIPS } from "./cips.js";

export const handler = async () => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();

    // Recherche produits par CIP + récupère qty_available directement
    const orCips = [];
    for (let i = 0; i < CATALOG_CIPS.length - 1; i++) orCips.push("|");
    CATALOG_CIPS.forEach(cip => orCips.push(["default_code", "=", cip]));

    const products = await odooCall(uid, "product.product", "search_read", orCips, {
      fields: ["id", "default_code", "qty_available", "virtual_available"], limit: 500
    });
    console.log("[stock-get] " + products.length + " produits trouvés sur " + CATALOG_CIPS.length + " CIPs");

    const stocks = {};
    const cipMap = {};
    products.forEach(p => { cipMap[p.default_code] = p; });

    CATALOG_CIPS.forEach(cip => {
      const p = cipMap[cip];
      if (!p) {
        stocks[cip] = { dispo: 1, stock: 0 }; // inconnu = dispo par défaut
        return;
      }
      const qty = parseFloat(p.qty_available || 0);
      stocks[cip] = { dispo: qty > 0 ? 1 : 0, stock: Math.round(qty) };
    });

    const ruptures = Object.values(stocks).filter(s => s.dispo === 0).length;
    console.log("[stock-get] ✓ " + (CATALOG_CIPS.length - ruptures) + " dispo · " + ruptures + " rupture(s)");
    // Log exemple
    const ex = products.find(p => p.default_code === "3400930425657");
    if (ex) console.log("[stock-get] Angispray qty_available=" + ex.qty_available);

    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks, updatedAt: new Date().toISOString() }) };
  } catch (err) {
    console.error("[stock-get] ERREUR:", err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
