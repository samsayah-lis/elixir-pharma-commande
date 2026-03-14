// ── Sync catalogue & stock par batch ─────────────────────────────────────
// step=products&offset=0  → charge 500 produits Odoo, filtre CIP13, upsert Supabase
// step=stock              → charge TOUS les quants Odoo, compute stock, sauve dans kv_store
// step=apply&offset=0     → applique les stocks depuis kv_store → odoo_catalog
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};
  const step = params.step || "products";

  try {
    // ══ STEP 1 : Charger les produits par batch de 500 ══════════════════
    if (step === "products") {
      const offset = parseInt(params.offset || "0");
      const uid = await authenticate();

      const page = await odooCall(uid, "product.product", "search_read",
        [["active", "=", true], ["default_code", "!=", false]],
        { fields: ["id", "name", "default_code", "barcode", "list_price"], limit: 500, offset }
      );
      if (!Array.isArray(page) || page.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ step: "products", done: true, offset }) };
      }

      // Filtrer CIP13
      const now = new Date().toISOString();
      const rows = [];
      page.forEach(p => {
        let cip = p.default_code || "";
        if (!/^\d{13}$/.test(cip)) {
          if (/^\d{13}$/.test(p.barcode || "")) cip = p.barcode;
          else return;
        }
        rows.push({
          cip,
          barcode: p.barcode && p.barcode !== "0" ? p.barcode : cip,
          name: p.name || "",
          list_price: parseFloat(p.list_price) || 0,
          odoo_pid: parseInt(p.id) || 0,
          updated_at: now,
        });
      });

      // Upsert Supabase
      if (rows.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog`, {
          method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(rows),
        });
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "products", done: page.length < 500,
        offset, next_offset: offset + page.length,
        odoo_loaded: page.length, cip13_saved: rows.length,
      })};
    }

    // ══ STEP 2 : Charger tous les quants et calculer le stock ═══════════
    if (step === "stock") {
      const uid = await authenticate();

      // Charger tous les quants internes Elixir
      const allQuants = [];
      let qOffset = 0;
      while (true) {
        const page = await odooCall(uid, "stock.quant", "search_read",
          [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"]],
          { fields: ["product_id", "quantity", "reserved_quantity"], limit: 500, offset: qOffset }
        );
        if (!Array.isArray(page) || page.length === 0) break;
        allQuants.push(...page);
        if (page.length < 500) break;
        qOffset += 500;
      }

      // Charger le mapping pid→cip depuis Supabase
      const pidMap = {};
      let sbOffset = 0;
      while (true) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,odoo_pid&odoo_pid=not.is.null&order=cip.asc`,
          { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": `${sbOffset}-${sbOffset + 999}` } }
        );
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        rows.forEach(r => { if (r.odoo_pid) pidMap[r.odoo_pid] = r.cip; });
        if (rows.length < 1000) break;
        sbOffset += 1000;
      }

      // Agréger stock par CIP
      const stockByCip = {};
      allQuants.forEach(q => {
        const pid = parseInt(q.product_id);
        const cip = pidMap[pid];
        if (!cip) return;
        if (!stockByCip[cip]) stockByCip[cip] = 0;
        stockByCip[cip] += parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0);
      });

      // Sauver dans kv_store
      await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "stock_map", value: JSON.stringify(stockByCip), updated_at: new Date().toISOString() }),
      });

      const inStock = Object.values(stockByCip).filter(v => v > 0).length;
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "stock", quants: allQuants.length, products_mapped: Object.keys(pidMap).length,
        cips_with_stock: Object.keys(stockByCip).length, in_stock: inStock,
      })};
    }

    // ══ STEP 3 : Appliquer le stock depuis kv_store ═════════════════════
    if (step === "apply") {
      const offset = parseInt(params.offset || "0");
      const BATCH = 200;

      const mapRes = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.stock_map&select=value`, { headers: SB });
      const mapRows = await mapRes.json();
      if (!Array.isArray(mapRows) || mapRows.length === 0) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "stock_map non trouvé. Lancez step=stock d'abord." }) };
      }
      const stockByCip = JSON.parse(mapRows[0].value);
      const allCips = Object.keys(stockByCip);
      const batch = allCips.slice(offset, offset + BATCH);

      if (batch.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ step: "apply", done: true, offset, total: allCips.length }) };
      }

      let updated = 0;
      for (const cip of batch) {
        const available = Math.round(Math.max(0, stockByCip[cip]));
        const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${cip}`, {
          method: "PATCH", headers: SB,
          body: JSON.stringify({ available, in_stock: available > 0 }),
        });
        if (res.ok) updated++;
      }

      const nextOffset = offset + batch.length;
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "apply", done: nextOffset >= allCips.length,
        offset, next_offset: nextOffset, updated, total: allCips.length,
      })};
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "step invalide" }) };
  } catch (err) {
    console.error("[stock-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, step }) };
  }
};
