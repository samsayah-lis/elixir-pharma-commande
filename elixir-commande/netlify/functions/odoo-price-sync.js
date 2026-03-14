// ── Sync prix remisés — 2 phases efficaces ──────────────────────────────
// Phase 1 : GET /odoo-price-sync?step=compute  → charge produits + règles de prix depuis Odoo,
//           calcule les prix remisés, sauve dans kv_store
// Phase 2 : GET /odoo-price-sync?offset=0      → applique les prix depuis kv_store vers odoo_catalog
import { authenticate, odooCall } from "./odoo.js";

const PRICELIST_ID = 5;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

async function odooFetchAll(uid, model, domain, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 1000, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  return all;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  try {
    // ══ PHASE 1 : Compute all prices ════════════════════════════════════
    if (params.step === "compute") {
      const uid = await authenticate();

      // 1. Charger TOUS les produits CIP13 avec list_price
      const rawProducts = await odooFetchAll(uid, "product.product",
        [["active", "=", true], ["default_code", "!=", false]],
        ["id", "default_code", "list_price"]
      );
      const pidToCip = {};
      const cipToListPrice = {};
      rawProducts.forEach(p => {
        const cip = p.default_code || "";
        if (/^\d{13}$/.test(cip)) {
          pidToCip[parseInt(p.id)] = cip;
          cipToListPrice[cip] = parseFloat(p.list_price) || 0;
        }
      });
      console.log(`[price-sync] ${Object.keys(pidToCip).length} produits CIP13`);

      // 2. Charger TOUTES les règles de la liste de prix EUR 2
      const allItems = await odooFetchAll(uid, "product.pricelist.item",
        [["pricelist_id", "=", PRICELIST_ID]],
        ["product_id", "fixed_price"]
      );
      console.log(`[price-sync] ${allItems.length} règles de prix`);

      // 3. Construire le mapping CIP → { discounted_price, discount_pct }
      const priceMap = {};
      allItems.forEach(item => {
        const pid = parseInt(item.product_id);
        const cip = pidToCip[pid];
        if (!cip) return;
        const fixedPrice = parseFloat(item.fixed_price) || 0;
        if (fixedPrice <= 0) return;
        const listPrice = cipToListPrice[cip] || 0;
        if (listPrice <= 0 || fixedPrice >= listPrice) return;
        const discountPct = Math.round((1 - fixedPrice / listPrice) * 1000) / 10;
        priceMap[cip] = { dp: fixedPrice, pct: discountPct };
      });
      console.log(`[price-sync] ${Object.keys(priceMap).length} prix remisés calculés`);

      // 4. Sauver dans kv_store
      await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST",
        headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "price_map", value: JSON.stringify(priceMap), updated_at: new Date().toISOString() }),
      });

      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "compute", products_cip13: Object.keys(pidToCip).length,
        pricelist_rules: allItems.length, prices_computed: Object.keys(priceMap).length,
      })};
    }

    // ══ PHASE 2 : Appliquer les prix dans odoo_catalog ══════════════════
    const batchOffset = parseInt(params.offset || "0");
    const BATCH_SIZE = 100;

    // Charger le price map
    const mapRes = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.price_map&select=value`, { headers: SB });
    const mapRows = await mapRes.json();
    if (!Array.isArray(mapRows) || mapRows.length === 0) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Price map non trouvé. Lancez d'abord step=compute." }) };
    }
    const priceMap = JSON.parse(mapRows[0].value);
    const allCips = Object.keys(priceMap);
    const totalPrices = allCips.length;

    // Traiter un batch de CIPs
    const batchCips = allCips.slice(batchOffset, batchOffset + BATCH_SIZE);
    if (batchCips.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: true, offset: batchOffset, updated: 0, total: totalPrices }) };
    }

    let updated = 0;
    for (const cip of batchCips) {
      const { dp, pct } = priceMap[cip];
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${cip}`, {
        method: "PATCH", headers: SB,
        body: JSON.stringify({ discounted_price: dp, discount_pct: pct }),
      });
      if (res.ok) updated++;
    }

    const nextOffset = batchOffset + batchCips.length;
    const done = nextOffset >= totalPrices;

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      done, offset: batchOffset, next_offset: done ? null : nextOffset,
      batch_size: batchCips.length, updated, total: totalPrices,
    })};

  } catch (err) {
    console.error("[price-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
