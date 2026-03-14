// ── Sync prix remisés par batch — charge les règles de la liste de prix EUR 2 ──
// GET /odoo-price-sync?offset=0  → traite les règles 0-199
// GET /odoo-price-sync?offset=200 → traite les règles 200-399
// Retourne { done, offset, next_offset, updated, total_rules }
import { authenticate, odooCall } from "./odoo.js";

const PRICELIST_ID = 5; // "Liste de prix EUR 2"
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const BATCH_SIZE = 200;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const offset = parseInt(event.queryStringParameters?.offset || "0");

  try {
    const uid = await authenticate();

    // 1. Charger un batch de règles de prix
    const items = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", PRICELIST_ID]],
      { fields: ["product_id", "fixed_price", "compute_price", "percent_price", "price_discount"], limit: BATCH_SIZE, offset }
    );
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: true, offset, updated: 0, total_rules: offset }) };
    }

    // 2. Extraire les product_ids et chercher les CIP correspondants
    const pidToPrice = {};
    items.forEach(item => {
      const pid = parseInt(item.product_id);
      if (!pid) return;
      const cp = item.compute_price || "";
      if (cp === "fixed") {
        pidToPrice[pid] = parseFloat(item.fixed_price) || 0;
      } else if (cp === "percentage") {
        // On stockera le pourcentage, mais on a besoin du list_price pour calculer
        pidToPrice[pid] = { pct: parseFloat(item.percent_price) || parseFloat(item.price_discount) || 0 };
      }
    });

    const pids = Object.keys(pidToPrice).map(Number);
    if (pids.length === 0) {
      const nextOffset = offset + items.length;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: false, offset, next_offset: nextOffset, updated: 0 }) };
    }

    // 3. Chercher les CIP (default_code) pour ces product_ids
    const products = await odooCall(uid, "product.product", "search_read",
      [["id", "in", pids]],
      { fields: ["id", "default_code", "list_price"], limit: BATCH_SIZE + 10 }
    );

    // 4. Construire les updates pour Supabase
    const updates = [];
    (Array.isArray(products) ? products : []).forEach(p => {
      const cip = p.default_code;
      if (!cip || !/^\d{13}$/.test(cip)) return;
      const pid = parseInt(p.id);
      const priceInfo = pidToPrice[pid];
      if (!priceInfo) return;

      const listPrice = parseFloat(p.list_price) || 0;
      let discountedPrice, discountPct;

      if (typeof priceInfo === "number") {
        // Prix fixe
        discountedPrice = priceInfo;
        discountPct = listPrice > 0 ? Math.round((1 - priceInfo / listPrice) * 1000) / 10 : 0;
      } else {
        // Pourcentage
        discountPct = priceInfo.pct;
        discountedPrice = Math.round(listPrice * (1 - priceInfo.pct / 100) * 100) / 100;
      }

      if (discountedPrice > 0 && discountedPrice < listPrice) {
        updates.push({ cip, discounted_price: discountedPrice, discount_pct: Math.max(0, discountPct) });
      }
    });

    // 5. Batch update Supabase
    let updated = 0;
    for (const upd of updates) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${upd.cip}`, {
        method: "PATCH", headers: SB,
        body: JSON.stringify({ discounted_price: upd.discounted_price, discount_pct: upd.discount_pct }),
      });
      if (res.ok) updated++;
    }

    const nextOffset = offset + items.length;
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      done: items.length < BATCH_SIZE, offset, next_offset: nextOffset,
      batch_rules: items.length, matched_cips: updates.length, updated,
    })};

  } catch (err) {
    console.error("[price-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
