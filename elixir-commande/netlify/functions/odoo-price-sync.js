// ── Sync prix remisés — utilise odoo_pid stocké dans odoo_catalog ────────
// GET /odoo-price-sync?offset=0    → traite les règles 0-499
// Chaque batch : charge 500 règles Odoo → lookup CIP dans Supabase par odoo_pid → PATCH prix
// Pas besoin de charger les produits depuis Odoo !
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
    const uid = await authenticate();

    // 1. Charger un batch de règles de prix depuis Odoo
    const items = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", PRICELIST_ID]],
      { fields: ["product_id", "fixed_price"], limit: BATCH_SIZE, offset }
    );
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: true, offset, updated: 0 }) };
    }

    // 2. Extraire les product_ids valides
    const pidToFixedPrice = {};
    items.forEach(item => {
      const pid = parseInt(item.product_id);
      const fp = parseFloat(item.fixed_price) || 0;
      if (pid > 0 && fp > 0) pidToFixedPrice[pid] = fp;
    });
    const pids = Object.keys(pidToFixedPrice);

    if (pids.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        done: items.length < BATCH_SIZE, offset, next_offset: offset + items.length,
        batch_rules: items.length, updated: 0,
      })};
    }

    // 3. Lookup CIP + list_price depuis Supabase par odoo_pid
    // Supabase filter: odoo_pid=in.(43077,48223,...)
    const pidList = pids.join(",");
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,odoo_pid,list_price&odoo_pid=in.(${pidList})`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const lookupRows = await lookupRes.json();
    
    // Map odoo_pid → { cip, list_price }
    const pidLookup = {};
    (Array.isArray(lookupRows) ? lookupRows : []).forEach(r => {
      if (r.odoo_pid) pidLookup[r.odoo_pid] = { cip: r.cip, listPrice: parseFloat(r.list_price) || 0 };
    });

    // 4. Construire les updates et PATCH Supabase
    let updated = 0;
    for (const [pid, fixedPrice] of Object.entries(pidToFixedPrice)) {
      const lookup = pidLookup[pid];
      if (!lookup || !lookup.cip) continue;
      if (fixedPrice >= lookup.listPrice || lookup.listPrice <= 0) continue;

      const discountPct = Math.round((1 - fixedPrice / lookup.listPrice) * 1000) / 10;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${lookup.cip}`, {
        method: "PATCH", headers: SB,
        body: JSON.stringify({ discounted_price: fixedPrice, discount_pct: discountPct }),
      });
      if (res.ok) updated++;
    }

    const nextOffset = offset + items.length;
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      done: items.length < BATCH_SIZE, offset, next_offset: nextOffset,
      batch_rules: items.length, pids_with_price: pids.length,
      matched_in_catalog: Object.keys(pidLookup).length, updated,
    })};

  } catch (err) {
    console.error("[price-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
