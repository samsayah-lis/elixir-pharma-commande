// ── Sync catalogue : produits + stock seulement (pas de lots) ───────────
// Les lots/péremptions sont gérés par odoo-expiry-sync séparément
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

async function odooFetchAll(uid, model, domain, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 500, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }
  return all;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const t0 = Date.now();
  const log = (msg) => console.log(`[catalog-sync] ${msg} (${Date.now()-t0}ms)`);

  try {
    const uid = await authenticate();
    log("Auth OK");

    // 1. Produits
    const rawProducts = await odooFetchAll(uid, "product.product",
      [["active", "=", true], ["default_code", "!=", false]],
      ["id", "name", "default_code", "barcode", "list_price"]
    );
    const products = rawProducts.filter(p =>
      /^\d{13}$/.test(p.default_code || "") || /^\d{13}$/.test(p.barcode || "")
    );
    products.forEach(p => {
      if (!/^\d{13}$/.test(p.default_code) && /^\d{13}$/.test(p.barcode)) p.default_code = p.barcode;
    });
    log(`${products.length} CIP13`);
    if (products.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: "0 CIP13" }) };
    }

    const pidMap = {};
    products.forEach(p => { pidMap[parseInt(p.id)] = p; });

    // 2. Stock
    const allQuants = await odooFetchAll(uid, "stock.quant",
      [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"]],
      ["product_id", "quantity", "reserved_quantity"]
    );
    log(`${allQuants.length} quants`);

    const stockByCip = {};
    allQuants.forEach(q => {
      const p = pidMap[parseInt(q.product_id)];
      if (!p) return;
      const cip = p.default_code;
      if (!stockByCip[cip]) stockByCip[cip] = 0;
      stockByCip[cip] += parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0);
    });
    const inStock = Object.entries(stockByCip).filter(([, v]) => v > 0).length;
    log(`${inStock} en stock`);

    // 3. Build rows (sans lots/péremption — géré par odoo-expiry-sync)
    const now = new Date().toISOString();
    const rows = products.map(p => {
      const cip = p.default_code;
      const available = Math.round(Math.max(0, stockByCip[cip] || 0));
      return {
        cip,
        barcode: p.barcode && p.barcode !== "0" ? p.barcode : cip,
        name: p.name || "",
        list_price: parseFloat(p.list_price) || 0,
        odoo_pid: parseInt(p.id) || 0,
        in_stock: available > 0,
        available,
        updated_at: now,
      };
    });

    // 4. Upsert Supabase — ATTENTION : ne PAS écraser earliest_expiry/lots s'ils existent déjà
    // On utilise un upsert qui ne touche pas ces champs
    let saved = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog`, {
        method: "POST",
        headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(batch),
      });
      if (res.ok) saved += batch.length;
      else log(`Batch ${i} error: ${await res.text()}`);
    }

    log(`✓ ${saved} produits sauvés, ${inStock} en stock`);

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, products: saved, in_stock: inStock, elapsed_ms: Date.now()-t0,
    })};
  } catch (err) {
    console.error("[catalog-sync] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
