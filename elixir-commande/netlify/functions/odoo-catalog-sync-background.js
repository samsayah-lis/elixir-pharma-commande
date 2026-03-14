// ── Sync catalogue Odoo → Supabase (background, 15min timeout) ─────────
// Charge produits + stock DIRECT Odoo + lots + péremptions
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

const COMPANY_ID = ODOO_COMPANY || 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

async function fetchAll(uid, model, domain, fields, extraKwargs = {}) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, model, "search_read", domain, { fields, limit: 500, offset, ...extraKwargs });
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
  const log = (msg) => console.log(`[catalog-sync] ${msg} (${Date.now()-t0}ms)`);

  try {
    const uid = await authenticate();
    log("Auth OK");

    // ── 1. TOUS les produits actifs avec default_code + prix liste de prix ─
    // Le champ "price" est calculé par Odoo selon la liste de prix dans le contexte
    const PRICELIST_ID = 5; // "Liste de prix EUR 2"
    const rawProducts = await fetchAll(uid, "product.product",
      [["active", "=", true], ["default_code", "!=", false]],
      ["id", "name", "default_code", "barcode", "list_price", "price", "categ_id"],
      { context: { pricelist: PRICELIST_ID } }
    );
    log(`${rawProducts.length} produits bruts Odoo (avec prix pricelist ${PRICELIST_ID})`);

    // Filtre JS : CIP13 = exactement 13 chiffres (dans default_code OU barcode)
    const products = rawProducts.filter(p => {
      return /^\d{13}$/.test(p.default_code || "") || /^\d{13}$/.test(p.barcode || "");
    });
    products.forEach(p => {
      if (!/^\d{13}$/.test(p.default_code) && /^\d{13}$/.test(p.barcode)) p.default_code = p.barcode;
    });
    log(`${products.length} produits CIP13 valides`);

    if (products.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: `0 CIP13 sur ${rawProducts.length} bruts` }) };
    }

    // Map pid → product
    const pidMap = {};
    products.forEach(p => { pidMap[parseInt(p.id)] = p; });
    const productIds = Object.keys(pidMap).map(Number);

    // ── 2. Emplacements internes Elixir ─────────────────────────────────
    const locations = await fetchAll(uid, "stock.location",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]], ["id"]
    );
    const locationIds = new Set(locations.map(l => parseInt(l.id)));
    log(`${locationIds.size} emplacements internes`);

    // ── 3. Stock DIRECT depuis Odoo (stock.quant) par batch ─────────────
    let allQuants = [];
    for (let b = 0; b < productIds.length; b += 300) {
      const batch = productIds.slice(b, b + 300);
      const domain = orDomain("product_id", batch);
      if (domain) {
        const q = await fetchAll(uid, "stock.quant", domain,
          ["product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]
        );
        allQuants.push(...q);
      }
      if (b > 0 && b % 1500 === 0) log(`Quants batch ${b}/${productIds.length}`);
    }
    log(`${allQuants.length} quants chargés`);

    // Agrège stock par CIP (filtré par emplacement interne)
    const stockByCip = {};
    allQuants.forEach(q => {
      const locId = parseInt(q.location_id) || 0;
      if (!locationIds.has(locId)) return;
      const pid = parseInt(q.product_id);
      const p = pidMap[pid];
      if (!p) return;
      const cip = p.default_code;
      if (!stockByCip[cip]) stockByCip[cip] = { qty: 0, reserved: 0, available: 0, lots: [] };
      const rawQty = parseFloat(q.quantity || 0);
      const rawRes = parseFloat(q.reserved_quantity || 0);
      stockByCip[cip].qty += rawQty;
      stockByCip[cip].reserved += rawRes;
      stockByCip[cip].available += (rawQty - rawRes);
    });
    const inStockCount = Object.values(stockByCip).filter(s => s.available > 0).length;
    log(`${inStockCount} produits en stock`);

    // ── 4. Lots avec péremption — requête DIRECTE par product_id ─────────
    // On ne passe plus par quant.lot_id (parsing Many2one cassé)
    // On charge tous les lots qui ont une expiration_date pour les produits en stock
    const inStockPids = productIds.filter(pid => {
      const cip = pidMap[pid]?.default_code;
      return cip && stockByCip[cip] && stockByCip[cip].available > 0;
    });
    log(`${inStockPids.length} PIDs en stock → chargement lots`);

    const lotsByPid = {}; // { pid: [{ lot_name, expiry }] }
    if (inStockPids.length > 0) {
      for (let b = 0; b < inStockPids.length; b += 200) {
        const batch = inStockPids.slice(b, b + 200);
        // stock.lot avec expiration_date non vide pour ces produits
        const domain = [];
        domain.push(["expiration_date", "!=", false]);
        // Ajout du filtre OR sur product_id
        if (batch.length === 1) {
          domain.push(["product_id", "=", batch[0]]);
        } else {
          for (let i = 0; i < batch.length - 1; i++) domain.push("|");
          batch.forEach(id => domain.push(["product_id", "=", id]));
        }
        try {
          const lots = await fetchAll(uid, "stock.lot", domain,
            ["id", "name", "product_id", "expiration_date"]
          );
          lots.forEach(l => {
            const lpid = parseInt(l.product_id) || 0;
            if (!lpid || !l.expiration_date) return;
            if (!lotsByPid[lpid]) lotsByPid[lpid] = [];
            // Parser la date (Odoo retourne "2025-05-31 21:59:59")
            const expiry = l.expiration_date.split(" ")[0] || l.expiration_date;
            lotsByPid[lpid].push({ lot_name: l.name || "", expiry });
          });
        } catch (e) {
          log(`Lots batch ${b} error: ${e.message}`);
        }
        if (b > 0 && b % 1000 === 0) log(`Lots batch ${b}/${inStockPids.length}`);
      }
    }
    const totalLots = Object.values(lotsByPid).reduce((s, arr) => s + arr.length, 0);
    log(`${totalLots} lots chargés pour ${Object.keys(lotsByPid).length} produits`);

    // Injecter les lots dans stockByCip
    Object.entries(lotsByPid).forEach(([pid, lots]) => {
      const cip = pidMap[parseInt(pid)]?.default_code;
      if (cip && stockByCip[cip]) {
        stockByCip[cip].lots = lots.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
      }
    });

    // ── 5. Construction des rows — prix remisé directement depuis Odoo ──
    // Le champ "price" a été calculé par Odoo avec le contexte pricelist=5
    const now = new Date().toISOString();
    const rows = products.map(p => {
      const cip = p.default_code;
      const stock = stockByCip[cip] || { qty: 0, reserved: 0, available: 0, lots: [] };
      const available = Math.round(stock.available);
      const earliestExpiry = stock.lots.find(l => l.expiry)?.expiry || null;
      const listPrice = parseFloat(p.list_price) || 0;
      const pricelistPrice = parseFloat(p.price) || 0;

      // Calcul remise : si price < list_price → il y a une remise
      let discounted_price = null;
      let discount_pct = 0;
      if (pricelistPrice > 0 && listPrice > 0 && pricelistPrice < listPrice) {
        discounted_price = Math.round(pricelistPrice * 100) / 100;
        discount_pct = Math.round((1 - pricelistPrice / listPrice) * 1000) / 10; // 1 décimale
      }

      return {
        cip,
        barcode: p.barcode && p.barcode !== "0" ? p.barcode : cip,
        name: p.name || "",
        list_price: listPrice,
        discounted_price,
        discount_pct,
        category: p.categ_id || "",
        in_stock: available > 0,
        available: Math.max(0, available),
        total_qty: Math.round(Math.max(0, stock.qty)),
        reserved: Math.round(Math.max(0, stock.reserved)),
        earliest_expiry: earliestExpiry,
        lots: JSON.stringify(stock.lots.slice(0, 10)),
        updated_at: now,
      };
    });
    log(`${rows.length} rows à sauvegarder`);

    // ── 6. Upsert Supabase par batch de 200 ────────────────────────────
    let saved = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog`, {
        method: "POST",
        headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(batch),
      });
      if (res.ok) saved += batch.length;
      else log(`Supabase batch ${i} error: ${await res.text()}`);
    }

    log(`✓ ${saved} produits sauvés, ${inStockCount} en stock`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, products: saved, in_stock: inStockCount,
      lots: Object.keys(lotMap).length, elapsed_ms: Date.now() - t0,
    })};

  } catch (err) {
    console.error("[catalog-sync] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, elapsed_ms: Date.now()-t0 }) };
  }
};
