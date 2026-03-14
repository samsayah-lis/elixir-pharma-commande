// ── Sync péremptions : lots croisés avec quants Elixir (company_id=2) ───
// Pour chaque produit en stock :
// 1. Charge les quants Elixir (internes) → extrait les lot_id
// 2. Charge les stock.lot correspondants → récupère expiration_date
// Ainsi seuls les lots physiquement en stock chez Elixir sont inclus
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const t0 = Date.now();
  const log = (msg) => console.log(`[expiry-sync] ${msg} (${Date.now()-t0}ms)`);

  try {
    // ── 1. Produits en stock depuis Supabase ────────────────────────────
    const stockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name&in_stock=eq.true`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": "0-999" } }
    );
    const inStockProducts = await stockRes.json();
    if (!Array.isArray(inStockProducts) || inStockProducts.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: "0 produits en stock" }) };
    }
    log(`${inStockProducts.length} produits en stock`);

    const uid = await authenticate();
    log("Auth OK");

    // ── 2. Mapper CIP → PID Odoo ───────────────────────────────────────
    const cips = inStockProducts.map(p => p.cip);
    const products = await odooCall(uid, "product.product", "search_read",
      [["default_code", "in", cips]],
      { fields: ["id", "default_code"], limit: 1000 }
    );
    const cipToPid = {};
    (Array.isArray(products) ? products : []).forEach(p => { cipToPid[p.default_code] = parseInt(p.id); });
    log(`${Object.keys(cipToPid).length} CIP→PID mappés`);

    // ── 3. Charger TOUS les quants internes Elixir avec lot_id ──────────
    // UNE seule requête pour tous les quants, on filtre en JS
    const allQuants = [];
    let offset = 0;
    while (true) {
      const page = await odooCall(uid, "stock.quant", "search_read",
        [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"]],
        { fields: ["product_id", "lot_id", "quantity"], limit: 500, offset }
      );
      if (!Array.isArray(page) || page.length === 0) break;
      allQuants.push(...page);
      if (page.length < 500) break;
      offset += 500;
    }
    log(`${allQuants.length} quants internes Elixir chargés`);

    // Extraire les lot_id par product_id (seulement qty > 0)
    const lotIdsByPid = {}; // { pid: Set(lotId) }
    let quantsWithLot = 0;
    allQuants.forEach(q => {
      const qty = parseFloat(q.quantity || 0);
      if (qty <= 0) return;
      const lotId = parseInt(q.lot_id);
      if (!lotId || lotId <= 0) return;
      const pid = parseInt(q.product_id);
      if (!pid) return;
      if (!lotIdsByPid[pid]) lotIdsByPid[pid] = new Set();
      lotIdsByPid[pid].add(lotId);
      quantsWithLot++;
    });
    log(`${quantsWithLot} quants avec lot, ${Object.keys(lotIdsByPid).length} produits avec lots`);

    // ── 4. Pour chaque produit, charger les lots avec péremption ────────
    const updates = [];
    let lotCount = 0;

    for (const prod of inStockProducts) {
      const pid = cipToPid[prod.cip];
      if (!pid) continue;
      const validLotIds = lotIdsByPid[pid];
      if (!validLotIds || validLotIds.size === 0) continue;

      try {
        // Charger les lots de ce produit avec expiration_date
        const lots = await odooCall(uid, "stock.lot", "search_read",
          [["product_id", "=", pid], ["expiration_date", "!=", false]],
          { fields: ["id", "name", "expiration_date"], limit: 50 }
        );

        if (!Array.isArray(lots) || lots.length === 0) continue;

        // Ne garder QUE les lots dont l'ID est dans les quants Elixir
        const filtered = lots.filter(l => validLotIds.has(parseInt(l.id)));

        const parsed = filtered.map(l => ({
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
      } catch (e) {
        log(`Lot error for ${prod.cip}: ${e.message?.substring(0, 80)}`);
      }
    }
    log(`${updates.length} produits avec péremption Elixir, ${lotCount} lots`);

    // ── 5. Mettre à jour Supabase ───────────────────────────────────────
    let saved = 0;
    const now = new Date().toISOString();
    for (const upd of updates) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${upd.cip}`,
        {
          method: "PATCH",
          headers: SB,
          body: JSON.stringify({ earliest_expiry: upd.earliest_expiry, lots: upd.lots, updated_at: now }),
        }
      );
      if (res.ok) saved++;
    }

    log(`✓ ${saved} produits mis à jour`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, products_checked: inStockProducts.length,
      quants_with_lot: quantsWithLot, products_with_lots: Object.keys(lotIdsByPid).length,
      with_expiry: updates.length, lots: lotCount, saved, elapsed_ms: Date.now()-t0,
    })};

  } catch (err) {
    console.error("[expiry-sync] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, elapsed_ms: Date.now()-t0 }) };
  }
};
