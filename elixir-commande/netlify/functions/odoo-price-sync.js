// ── Sync prix remisés — utilise pid_to_cip + cip_to_price depuis kv_store ──
// GET /odoo-price-sync?offset=0 → charge 500 règles Odoo, match via kv_store, PATCH Supabase
// Prérequis : lancer le sync stock d'abord (remplit pid_to_cip et cip_to_price dans kv_store)
import { authenticate, odooCall } from "./odoo.js";

const PRICELIST_ID = 5;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const BATCH_SIZE = 500;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const offset = parseInt(event.queryStringParameters?.offset || "0");

  try {
    // 1. Charger les mappings depuis kv_store (instantané)
    const [pidRes, priceRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.pid_to_cip&select=value`, { headers: SB }),
      fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.cip_to_price&select=value`, { headers: SB }),
    ]);
    const pidRows = await pidRes.json();
    const priceRows = await priceRes.json();

    if (!pidRows?.[0]?.value) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Mapping pid_to_cip non trouvé. Lancez le sync stock d'abord." }) };
    }

    const pidToCip = JSON.parse(pidRows[0].value);    // { "43077": "3400930230008", ... }
    const cipToPrice = JSON.parse(priceRows?.[0]?.value || "{}"); // { "3400930230008": 1.68, ... }
    const totalMappings = Object.keys(pidToCip).length;

    // 2. Charger un batch de règles de prix depuis Odoo
    const uid = await authenticate();
    const items = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", PRICELIST_ID]],
      { fields: ["product_id", "fixed_price"], limit: BATCH_SIZE, offset }
    );
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: true, offset, updated: 0, mappings: totalMappings }) };
    }

    // 3. Matcher et calculer les remises
    let updated = 0, matched = 0;
    for (const item of items) {
      const pid = parseInt(item.product_id);
      const fixedPrice = parseFloat(item.fixed_price) || 0;
      if (!pid || fixedPrice <= 0) continue;

      const cip = pidToCip[String(pid)];
      if (!cip) continue;
      matched++;

      const listPrice = cipToPrice[cip] || 0;
      if (listPrice <= 0 || fixedPrice >= listPrice) continue;

      const discountPct = Math.round((1 - fixedPrice / listPrice) * 1000) / 10;

      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${cip}`, {
        method: "PATCH", headers: SB,
        body: JSON.stringify({ discounted_price: fixedPrice, discount_pct: discountPct }),
      });
      if (res.ok) updated++;
    }

    const nextOffset = offset + items.length;
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      done: items.length < BATCH_SIZE, offset, next_offset: nextOffset,
      batch_rules: items.length, matched, updated, mappings: totalMappings,
    })};

  } catch (err) {
    console.error("[price-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
