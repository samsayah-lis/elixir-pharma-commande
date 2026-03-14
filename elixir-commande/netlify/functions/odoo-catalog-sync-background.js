// ── Sync catalogue Odoo → Supabase ──────────────────────────────────────
// GET/POST /odoo-catalog-refresh → charge les produits pharma + stock + lots
// Ne charge QUE les produits avec un CIP13 valide (commence par 3400)
// Utilise le cache elixir_stocks existant pour le stock de base
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

async function fetchAll(uid, model, domain, fields) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 500, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }
  return results;
}

function orDomain(field, ids) {
  if (ids.length === 0) return null;
  if (ids.length === 1) return [[field, "=", ids[0]]];
  const d = [];
  for (let i = 0; i < ids.length - 1; i++) d.push("|");
  ids.forEach(id => d.push([field, "=", id]));
  return d;
}

const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const t0 = Date.now();

  try {
    // ── 1. Produits Odoo : UNIQUEMENT ceux avec CIP13 valide (3400...) ──
    const uid = await authenticate();
    console.log(`[catalog-refresh] Auth OK (${Date.now()-t0}ms)`);

    // Filtre Odoo : default_code de exactement 13 caractères (=like '____________' = 13 underscores en SQL LIKE)
    const rawProducts = await fetchAll(uid, "product.product",
      [["active", "=", true], ["default_code", "=like", "_____________"]],
      ["id", "name", "default_code", "barcode", "list_price", "categ_id"]
    );
    // Filtre JS : uniquement les codes 100% numériques (exclut les codes avec lettres)
    const products = rawProducts.filter(p => /^\d{13}$/.test(p.default_code));
    console.log(`[catalog-refresh] ${rawProducts.length} produits 13 chars → ${products.length} CIP13 numériques (${Date.now()-t0}ms)`);

    if (products.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: `0 CIP13 valides (${rawProducts.length} à 13 chars)`, elapsed: Date.now()-t0 }) };
    }

    // Map pid → product
    const pidMap = {};
    products.forEach(p => { pidMap[parseInt(p.id)] = p; });
    const productIds = Object.keys(pidMap).map(Number);

    // ── 2. Stock depuis le cache Supabase (elixir_stocks, instantané) ───
    let stockMap = {}; // { cip: { dispo, stock } }
    try {
      const stockRes = await fetch(`${SUPABASE_URL}/rest/v1/elixir_stocks?select=cip,dispo,stock`, {
        headers: { ...SB, Range: "0-4999" }
      });
      const stockRows = await stockRes.json();
      if (Array.isArray(stockRows)) stockRows.forEach(r => { stockMap[r.cip] = r; });
      console.log(`[catalog-refresh] ${Object.keys(stockMap).length} stocks depuis Supabase (${Date.now()-t0}ms)`);
    } catch (e) {
      console.warn("[catalog-refresh] Stock cache indisponible:", e.message);
    }

    // ── 3. Lots avec péremption (seulement les produits en stock) ────────
    const inStockPids = productIds.filter(pid => {
      const cip = pidMap[pid]?.default_code;
      return cip && stockMap[cip]?.dispo;
    });
    console.log(`[catalog-refresh] ${inStockPids.length} produits en stock pour requête lots (${Date.now()-t0}ms)`);

    let lotsByPid = {}; // { pid: [{ lot_name, qty, expiry }] }
    if (inStockPids.length > 0 && inStockPids.length <= 500) {
      try {
        // Quants pour les produits en stock
        const domain = orDomain("product_id", inStockPids);
        const quants = await fetchAll(uid, "stock.quant", domain,
          ["product_id", "lot_id", "quantity", "reserved_quantity", "location_id"]
        );
        console.log(`[catalog-refresh] ${quants.length} quants (${Date.now()-t0}ms)`);

        // Emplacements internes
        const locs = await fetchAll(uid, "stock.location",
          [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]], ["id"]
        );
        const locIds = new Set(locs.map(l => parseInt(l.id)));

        // Lots
        const lotIds = [...new Set(quants.map(q => parseInt(q.lot_id)).filter(id => id > 0))];
        const lotMap = {};
        if (lotIds.length > 0) {
          for (let b = 0; b < lotIds.length; b += 300) {
            const d = orDomain("id", lotIds.slice(b, b + 300));
            if (d) {
              const lots = await fetchAll(uid, "stock.lot", d,
                ["id", "name", "expiration_date", "use_date", "life_date"]
              );
              lots.forEach(l => {
                lotMap[parseInt(l.id)] = { name: l.name || "", expiry: l.expiration_date || l.use_date || l.life_date || null };
              });
            }
          }
        }
        console.log(`[catalog-refresh] ${Object.keys(lotMap).length} lots (${Date.now()-t0}ms)`);

        // Agrège lots par produit
        quants.forEach(q => {
          const locId = parseInt(q.location_id) || 0;
          if (!locIds.has(locId)) return;
          const pid = parseInt(q.product_id);
          const lotId = parseInt(q.lot_id);
          const netQty = Math.round(parseFloat(q.quantity || 0) - parseFloat(q.reserved_quantity || 0));
          if (netQty <= 0 || !lotMap[lotId]) return;
          if (!lotsByPid[pid]) lotsByPid[pid] = [];
          lotsByPid[pid].push({ lot_name: lotMap[lotId].name, qty: netQty, expiry: lotMap[lotId].expiry });
        });
      } catch (e) {
        console.warn("[catalog-refresh] Lots error:", e.message);
      }
    }

    // ── 4. Construction des rows ────────────────────────────────────────
    const now = new Date().toISOString();
    const rows = products.map(p => {
      const cip = p.default_code;
      const stock = stockMap[cip] || {};
      const available = stock.stock || 0;
      const lots = (lotsByPid[parseInt(p.id)] || []).sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
      const earliestExpiry = lots.find(l => l.expiry)?.expiry || null;

      return {
        cip,
        barcode: p.barcode && p.barcode !== "0" ? p.barcode : cip,
        name: p.name || "",
        list_price: parseFloat(p.list_price) || 0,
        category: p.categ_id || "",
        in_stock: available > 0 || stock.dispo === 1,
        available: Math.max(0, available),
        total_qty: Math.max(0, available),
        reserved: 0,
        earliest_expiry: earliestExpiry,
        lots: JSON.stringify(lots.slice(0, 10)),
        updated_at: now,
      };
    });

    // ── 5. Upsert Supabase par batch ────────────────────────────────────
    let saved = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog`, {
        method: "POST",
        headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(batch),
      });
      if (res.ok) saved += batch.length;
      else console.error(`[catalog-refresh] Supabase batch error:`, await res.text());
    }

    const elapsed = Date.now() - t0;
    console.log(`[catalog-refresh] ✓ ${saved} produits sauvés (${elapsed}ms)`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, products: saved, in_stock_with_lots: inStockPids.length,
      lots_count: Object.keys(lotsByPid).length, elapsed_ms: elapsed,
    })};

  } catch (err) {
    console.error("[catalog-refresh] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, elapsed_ms: Date.now()-t0 }) };
  }
};
