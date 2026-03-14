// ── Background function : sync catalogue Odoo → Supabase ───────────────
// Appelée manuellement ou par cron — timeout 15min (background)
// Charge produits + stocks + lots + péremptions depuis Odoo et cache dans Supabase
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

export const config = { type: "background" }; // Netlify background function — 15min timeout

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

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  // Accepte aussi un appel direct GET/POST pour lancer le refresh
  console.log("[odoo-catalog-refresh] Démarrage sync Odoo → Supabase...");

  try {
    const uid = await authenticate();
    console.log(`[odoo-catalog-refresh] Auth OK uid=${uid}`);

    // ── 1. Tous les produits actifs ──────────────────────────────────────
    const products = await fetchAll(uid, "product.product",
      [["active", "=", true], "|", ["default_code", "!=", false], ["barcode", "!=", false]],
      ["id", "name", "default_code", "barcode", "list_price", "categ_id"]
    );
    console.log(`[odoo-catalog-refresh] ${products.length} produits`);

    const pidToCip = {};
    products.forEach(p => {
      const cip = p.default_code || p.barcode || null;
      if (cip) pidToCip[parseInt(p.id)] = cip;
    });
    const productIds = Object.keys(pidToCip).map(Number);

    // ── 2. Emplacements internes Elixir ─────────────────────────────────
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]],
      ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));
    console.log(`[odoo-catalog-refresh] ${locationIds.size} emplacements`);

    // ── 3. Stock quants (par batch de 300) ──────────────────────────────
    let quants = [];
    for (let b = 0; b < productIds.length; b += 300) {
      const batch = productIds.slice(b, b + 300);
      const domain = orDomain("product_id", batch);
      if (domain) {
        const q = await fetchAll(uid, "stock.quant", domain,
          ["product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]
        );
        quants.push(...q);
      }
    }
    console.log(`[odoo-catalog-refresh] ${quants.length} quants`);

    // ── 4. Lots avec péremption ─────────────────────────────────────────
    const lotIds = [...new Set(quants.map(q => parseInt(q.lot_id)).filter(id => id > 0))];
    const lotMap = {};
    for (let b = 0; b < lotIds.length; b += 300) {
      const domain = orDomain("id", lotIds.slice(b, b + 300));
      if (domain) {
        const lots = await fetchAll(uid, "stock.lot", domain,
          ["id", "name", "product_id", "expiration_date", "use_date", "life_date"]
        );
        lots.forEach(l => {
          lotMap[parseInt(l.id)] = {
            name: l.name || "",
            expiry: l.expiration_date || l.use_date || l.life_date || null,
          };
        });
      }
    }
    console.log(`[odoo-catalog-refresh] ${Object.keys(lotMap).length} lots`);

    // ── 5. Agrégation stock par CIP ─────────────────────────────────────
    const stockByCip = {};
    quants.forEach(q => {
      const locId = typeof q.location_id === "number" ? q.location_id : parseInt(q.location_id);
      if (!locationIds.has(locId)) return;
      const pid = typeof q.product_id === "number" ? q.product_id : parseInt(q.product_id);
      const cip = pidToCip[pid];
      if (!cip) return;
      if (!stockByCip[cip]) stockByCip[cip] = { qty: 0, reserved: 0, available: 0, lots: [] };
      const rawQty = parseFloat(q.quantity || 0);
      const rawRes = parseFloat(q.reserved_quantity || 0);
      stockByCip[cip].qty += rawQty;
      stockByCip[cip].reserved += rawRes;
      stockByCip[cip].available += (rawQty - rawRes);
      const lotId = parseInt(q.lot_id);
      if (lotId > 0 && lotMap[lotId]) {
        stockByCip[cip].lots.push({
          lot_name: lotMap[lotId].name,
          qty: Math.round(rawQty - rawRes),
          expiry: lotMap[lotId].expiry,
        });
      }
    });

    // ── 6. Construire les rows pour Supabase ────────────────────────────
    const now = new Date().toISOString();
    const rows = products.map(p => {
      const cip = p.default_code || p.barcode || "";
      if (!cip) return null;
      const stock = stockByCip[cip] || { qty: 0, reserved: 0, available: 0, lots: [] };
      const available = Math.round(stock.available);
      const activeLots = stock.lots.filter(l => l.qty > 0);
      activeLots.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
      const earliestExpiry = activeLots.find(l => l.expiry)?.expiry || null;

      return {
        cip,
        barcode: p.barcode || cip,
        name: p.name || "",
        list_price: parseFloat(p.list_price) || 0,
        category: p.categ_id || "",
        in_stock: available > 0,
        available,
        total_qty: Math.round(stock.qty),
        reserved: Math.round(stock.reserved),
        earliest_expiry: earliestExpiry,
        lots: JSON.stringify(activeLots.slice(0, 10)), // top 10 lots
        updated_at: now,
      };
    }).filter(Boolean);

    console.log(`[odoo-catalog-refresh] ${rows.length} produits à sauvegarder`);

    // ── 7. Upsert dans Supabase par batch de 200 ───────────────────────
    let saved = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog`, {
        method: "POST",
        headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[odoo-catalog-refresh] Supabase batch ${i} error:`, err);
      } else {
        saved += batch.length;
      }
    }

    console.log(`[odoo-catalog-refresh] ✓ ${saved} produits sauvés dans Supabase`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, products: saved }) };

  } catch (err) {
    console.error("[odoo-catalog-refresh] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
