// ── Sync prix — charge toutes les règles (batch 200) + matching complet ──
// step=load&offset=0  → charge 200 règles Odoo, accumule dans kv_store
// step=apply&offset=0 → applique aux produits (product > template > catégorie > global)
import { authenticate, odooCall } from "./odoo.js";

const PRICELIST_ID = 5;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};
  const step = params.step || "load";

  try {
    // ══ STEP LOAD : charger les règles par batch de 200 ═════════════════
    if (step === "load") {
      const offset = parseInt(params.offset || "0");
      const uid = await authenticate();

      const items = await odooCall(uid, "product.pricelist.item", "search_read",
        [["pricelist_id", "=", PRICELIST_ID]],
        { fields: ["product_id", "product_tmpl_id", "categ_id", "fixed_price", "percent_price", "price_discount", "compute_price", "applied_on"], limit: 200, offset }
      );
      if (!Array.isArray(items) || items.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ step: "load", done: true, offset }) };
      }

      // Lire les règles existantes (ou commencer vide si offset=0)
      let allRules = [];
      if (offset > 0) {
        try {
          const existing = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.pricelist_rules&select=value`, { headers: SB });
          const rows = await existing.json();
          if (rows?.[0]?.value) allRules = JSON.parse(rows[0].value);
        } catch (e) { /* start fresh */ }
      }

      // Ajouter les nouvelles
      items.forEach(item => {
        allRules.push({
          pid: parseInt(item.product_id) || 0,
          tid: parseInt(item.product_tmpl_id) || 0,
          cid: parseInt(item.categ_id) || 0,
          ap: item.applied_on || "",
          cp: item.compute_price || "",
          fp: parseFloat(item.fixed_price) || 0,
          pp: parseFloat(item.percent_price) || parseFloat(item.price_discount) || 0,
        });
      });

      // Sauver
      await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "pricelist_rules", value: JSON.stringify(allRules), updated_at: new Date().toISOString() }),
      });

      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "load", done: items.length < 200,
        offset, next_offset: offset + items.length, total_rules: allRules.length,
      })};
    }

    // ══ STEP APPLY : appliquer les règles aux produits ══════════════════
    if (step === "apply") {
      const offset = parseInt(params.offset || "0");

      // Charger les règles
      const rulesRes = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.pricelist_rules&select=value`, { headers: SB });
      const rulesRows = await rulesRes.json();
      if (!rulesRows?.[0]?.value) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Lancez step=load d'abord" }) };
      }
      const allRules = JSON.parse(rulesRows[0].value);

      // Indexer les règles par type
      const byPid = {};    // product_id → rule
      const byTid = {};    // product_tmpl_id → rule
      const byCid = {};    // categ_id → rule
      const globals = [];  // applied_on = 3_global
      allRules.forEach(r => {
        if (r.pid > 0) byPid[r.pid] = r;
        else if (r.tid > 0) byTid[r.tid] = r;
        else if (r.cid > 0) byCid[r.cid] = r;
        else if (r.ap.includes("3")) globals.push(r);
      });

      // Charger 200 produits
      const prodRes = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,odoo_pid,odoo_tmpl_id,categ_id,list_price&order=cip.asc`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": `${offset}-${offset + 199}`, "Prefer": "count=exact" } }
      );
      const total = parseInt(prodRes.headers.get("content-range")?.split("/")?.[1] || "0");
      const products = await prodRes.json();
      if (!Array.isArray(products) || products.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ step: "apply", done: true, offset, total }) };
      }

      // Appliquer les prix avec priorité
      let updated = 0;
      for (const p of products) {
        const listPrice = parseFloat(p.list_price) || 0;
        if (listPrice <= 0) continue;

        // Priorité : produit > template > catégorie > règle globale Elixir
        const rule = (p.odoo_pid ? byPid[p.odoo_pid] : null)
          || (p.odoo_tmpl_id ? byTid[p.odoo_tmpl_id] : null)
          || (p.categ_id ? byCid[p.categ_id] : null)
          || null;

        let discountedPrice = null;

        if (rule) {
          // Règle spécifique (produit, template, catégorie)
          if (rule.cp === "fixed" && rule.fp > 0) {
            discountedPrice = rule.fp;
          } else if (rule.pp > 0) {
            discountedPrice = Math.round(listPrice * (1 - rule.pp / 100) * 100) / 100;
          }
        } else {
          // Règle globale Elixir (3 paliers)
          if (listPrice < 4.63) {
            // Forfait 0,23€ de remise par boîte
            discountedPrice = Math.round((listPrice - 0.23) * 100) / 100;
          } else if (listPrice <= 463) {
            // 4,51% de remise
            discountedPrice = Math.round(listPrice * (1 - 4.51 / 100) * 100) / 100;
          } else {
            // Forfait 25€ de remise par boîte
            discountedPrice = Math.round((listPrice - 25) * 100) / 100;
          }
        }

        if (!discountedPrice || discountedPrice >= listPrice || discountedPrice <= 0) continue;

        const discountPct = Math.round((1 - discountedPrice / listPrice) * 1000) / 10;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${p.cip}`, {
          method: "PATCH", headers: SB,
          body: JSON.stringify({ discounted_price: discountedPrice, discount_pct: discountPct }),
        });
        if (res.ok) updated++;
      }

      const nextOffset = offset + products.length;
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "apply", done: nextOffset >= total,
        offset, next_offset: nextOffset, updated, total,
        rules_by_product: Object.keys(byPid).length,
        rules_by_template: Object.keys(byTid).length,
        rules_by_category: Object.keys(byCid).length,
        rules_global: globals.length,
      })};
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "step=load ou step=apply" }) };
  } catch (err) {
    console.error("[price-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
