// ── Sync catalogue Odoo → Supabase (background, 15min) ─────────────────
// Approche ultra-simple : requêtes Odoo les plus basiques possibles
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
  const log = (msg) => console.log(`[sync] ${msg} (${Date.now()-t0}ms)`);

  try {
    const uid = await authenticate();
    log("Auth OK");

    // ═══ ÉTAPE 1 : Produits ═══════════════════════════════════════════
    const rawProducts = await odooFetchAll(uid, "product.product",
      [["active", "=", true], ["default_code", "!=", false]],
      ["id", "name", "default_code", "barcode", "list_price"]
    );
    log(`${rawProducts.length} produits bruts`);

    // Filtre CIP13 (13 chiffres exactement)
    const products = rawProducts.filter(p =>
      /^\d{13}$/.test(p.default_code || "") || /^\d{13}$/.test(p.barcode || "")
    );
    products.forEach(p => {
      if (!/^\d{13}$/.test(p.default_code) && /^\d{13}$/.test(p.barcode)) p.default_code = p.barcode;
    });
    log(`${products.length} CIP13 valides`);
    if (products.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: "0 CIP13" }) };
    }

    const pidMap = {};
    products.forEach(p => { pidMap[parseInt(p.id)] = p; });

    // ═══ ÉTAPE 2 : Stock (emplacements internes) ═════════════════════
    const locations = await odooFetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]], ["id"]
    );
    const locIds = new Set(locations.map(l => parseInt(l.id)));
    log(`${locIds.size} emplacements`);

    // Charge TOUS les quants internes de la société (pas de filtre product_id)
    const allQuants = await odooFetchAll(uid, "stock.quant",
      [["company_id", "=", COMPANY_ID], ["location_id.usage", "=", "internal"]],
      ["product_id", "location_id", "quantity", "reserved_quantity"]
    );
    log(`${allQuants.length} quants`);

    // Agrège stock par PID → CIP
    const stockByCip = {};
    allQuants.forEach(q => {
      const pid = parseInt(q.product_id);
      const p = pidMap[pid];
      if (!p) return;
      const cip = p.default_code;
      if (!stockByCip[cip]) stockByCip[cip] = { available: 0 };
      stockByCip[cip].available += parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0);
    });
    const inStockCount = Object.values(stockByCip).filter(s => s.available > 0).length;
    log(`${inStockCount} produits en stock`);

    // ═══ ÉTAPE 3 : TOUS les lots avec date d'expiration ══════════════
    // Requête la plus simple possible — pas de filtre par produit
    const allLots = await odooFetchAll(uid, "stock.lot",
      [["expiration_date", "!=", false]],
      ["id", "name", "product_id", "expiration_date"]
    );
    log(`${allLots.length} lots avec expiration_date`);

    // Index par product_id
    const lotsByPid = {};
    allLots.forEach(l => {
      const pid = parseInt(l.product_id);
      if (!pid || !pidMap[pid]) return; // lot d'un produit non-CIP13 → on ignore
      const expiry = (l.expiration_date || "").split(" ")[0]; // "2025-05-31 21:59:59" → "2025-05-31"
      if (!expiry) return;
      if (!lotsByPid[pid]) lotsByPid[pid] = [];
      lotsByPid[pid].push({ lot_name: l.name || "", expiry });
    });
    // Trier par date d'expiration
    Object.values(lotsByPid).forEach(arr => arr.sort((a, b) => a.expiry.localeCompare(b.expiry)));
    const prodsWithLots = Object.keys(lotsByPid).length;
    log(`${prodsWithLots} produits avec lots datés`);

    // ═══ ÉTAPE 4 : Construction des rows ═════════════════════════════
    const now = new Date().toISOString();
    const rows = products.map(p => {
      const cip = p.default_code;
      const stock = stockByCip[cip];
      const available = stock ? Math.round(Math.max(0, stock.available)) : 0;
      const lots = lotsByPid[parseInt(p.id)] || [];
      const earliestExpiry = lots.length > 0 ? lots[0].expiry : null;

      return {
        cip,
        barcode: p.barcode && p.barcode !== "0" ? p.barcode : cip,
        name: p.name || "",
        list_price: parseFloat(p.list_price) || 0,
        discounted_price: null,
        discount_pct: 0,
        category: "",
        in_stock: available > 0,
        available,
        total_qty: available,
        reserved: 0,
        earliest_expiry: earliestExpiry,
        lots: JSON.stringify(lots.slice(0, 10)),
        updated_at: now,
      };
    });

    const withExpiry = rows.filter(r => r.earliest_expiry).length;
    log(`${rows.length} rows, ${withExpiry} avec péremption, ${inStockCount} en stock`);

    // ═══ ÉTAPE 5 : Upsert Supabase ══════════════════════════════════
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

    log(`✓ TERMINÉ — ${saved} sauvés, ${inStockCount} en stock, ${withExpiry} avec péremption`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, products: saved, in_stock: inStockCount,
      with_expiry: withExpiry, lots_total: allLots.length, elapsed_ms: Date.now()-t0,
    })};

  } catch (err) {
    console.error("[sync] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, elapsed_ms: Date.now()-t0 }) };
  }
};
