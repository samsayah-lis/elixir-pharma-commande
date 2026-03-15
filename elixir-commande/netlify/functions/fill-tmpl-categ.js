// ── Remplir odoo_tmpl_id + categ_id pour les produits existants ──────────
// GET /fill-tmpl-categ?offset=0 → batch de 200 CIPs, lookup dans Odoo, PATCH Supabase
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const offset = parseInt(event.queryStringParameters?.offset || "0");

  try {
    // 1. Charger 200 produits sans odoo_tmpl_id
    const prodRes = await fetch(
      `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,odoo_pid&odoo_pid=not.is.null&or=(odoo_tmpl_id.is.null,odoo_tmpl_id.eq.0)&order=cip.asc`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": `0-199`, "Prefer": "count=exact" } }
    );
    const total = parseInt(prodRes.headers.get("content-range")?.split("/")?.[1] || "0");
    const products = await prodRes.json();
    if (!Array.isArray(products) || products.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ done: true, remaining: 0 }) };
    }

    const uid = await authenticate();

    // 2. Lookup dans Odoo par product_id
    const pids = products.map(p => p.odoo_pid).filter(Boolean);
    const odooProds = await odooCall(uid, "product.product", "search_read",
      [["id", "in", pids]],
      { fields: ["id", "product_tmpl_id", "categ_id"], limit: 250 }
    );

    const pidInfo = {};
    (Array.isArray(odooProds) ? odooProds : []).forEach(p => {
      pidInfo[parseInt(p.id)] = {
        tmpl: parseInt(p.product_tmpl_id) || 0,
        categ: parseInt(p.categ_id) || 0,
      };
    });

    // 3. PATCH Supabase
    let updated = 0;
    for (const p of products) {
      const info = pidInfo[p.odoo_pid];
      if (!info) continue;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${p.cip}`, {
        method: "PATCH", headers: SB,
        body: JSON.stringify({ odoo_tmpl_id: info.tmpl, categ_id: info.categ }),
      });
      if (res.ok) updated++;
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      done: false, batch: products.length, updated, remaining: total - products.length,
    })};
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
