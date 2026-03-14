// ── Sync péremptions : charge les lots UNIQUEMENT pour les produits en stock ──
// GET/POST /odoo-expiry-sync → sync les dates de péremption
// Lit les produits en stock depuis Supabase, requête les lots un par un depuis Odoo
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const t0 = Date.now();
  const log = (msg) => console.log(`[expiry-sync] ${msg} (${Date.now()-t0}ms)`);

  try {
    // ── 1. Lire les produits en stock depuis Supabase ────────────────────
    const stockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name&in_stock=eq.true`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-999" } }
    );
    const inStockProducts = await stockRes.json();
    if (!Array.isArray(inStockProducts) || inStockProducts.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: "0 produits en stock dans Supabase" }) };
    }
    log(`${inStockProducts.length} produits en stock`);

    // ── 2. Trouver les PIDs Odoo correspondants ─────────────────────────
    const uid = await authenticate();
    log("Auth OK");

    // Charger les produits par CIP pour avoir le PID
    const cips = inStockProducts.map(p => p.cip);
    const products = await odooCall(uid, "product.product", "search_read",
      [["default_code", "in", cips]],
      { fields: ["id", "default_code"], limit: 1000 }
    );
    log(`${Array.isArray(products) ? products.length : 0} produits matchés dans Odoo`);

    const cipToPid = {};
    (Array.isArray(products) ? products : []).forEach(p => {
      cipToPid[p.default_code] = parseInt(p.id);
    });

    // ── 3. Pour chaque produit en stock, requêter ses lots ──────────────
    const updates = []; // [{ cip, earliest_expiry, lots }]
    let lotCount = 0;

    for (const prod of inStockProducts) {
      const pid = cipToPid[prod.cip];
      if (!pid) continue;

      try {
        const lots = await odooCall(uid, "stock.lot", "search_read",
          [["product_id", "=", pid], ["expiration_date", "!=", false], ["company_id", "=", 2]],
          { fields: ["name", "expiration_date"], limit: 20 }
        );

        if (Array.isArray(lots) && lots.length > 0) {
          const parsed = lots.map(l => ({
            lot_name: l.name || "",
            expiry: (l.expiration_date || "").split(" ")[0],
          })).filter(l => l.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry));

          if (parsed.length > 0) {
            updates.push({
              cip: prod.cip,
              earliest_expiry: parsed[0].expiry,
              lots: JSON.stringify(parsed.slice(0, 10)),
            });
            lotCount += parsed.length;
          }
        }
      } catch (e) {
        // Lot query failed for this product, skip
      }
    }
    log(`${updates.length} produits avec péremption, ${lotCount} lots total`);

    // ── 4. Mettre à jour Supabase ───────────────────────────────────────
    let saved = 0;
    const now = new Date().toISOString();
    for (const upd of updates) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${upd.cip}`,
        {
          method: "PATCH",
          headers: SB,
          body: JSON.stringify({
            earliest_expiry: upd.earliest_expiry,
            lots: upd.lots,
            updated_at: now,
          }),
        }
      );
      if (res.ok) saved++;
    }

    log(`✓ ${saved} produits mis à jour avec péremption`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, products_checked: inStockProducts.length,
      with_expiry: updates.length, lots: lotCount, saved, elapsed_ms: Date.now()-t0,
    })};

  } catch (err) {
    console.error("[expiry-sync] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, elapsed_ms: Date.now()-t0 }) };
  }
};
