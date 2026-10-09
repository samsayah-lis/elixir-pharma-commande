// ── Références d'un même produit fournisseur (plusieurs CIP pour un article) ──
// GET ?codes=BR1538205,BR1538206[&cips=3662050045676]
// Un article livré sous un nouveau CIP garde le même « code du produit du fournisseur »
// (product.supplierinfo.product_code) : on retrouve ainsi toutes les références qui cohabitent,
// avec stock et prix du catalogue du site (odoo_catalog). Lecture seule, sans données client.
// → { refs: { <code>: [ligne catalogue…] }, byCip: { <cip>: ligne catalogue } }
import { getCors } from "./cors.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FIELDS = "cip,name,list_price,discounted_price,discount_pct,price_tiers,in_stock,available";
const cache = new Map();   // code fournisseur → { at, cips } (10 min par instance)

const cipOf = (p) => [p.default_code, p.barcode].map(x => String(x || "").trim()).find(x => /^\d{13}$/.test(x)) || null;

async function cipsByCode(codes) {
  const todo = codes.filter(c => !(cache.get(c) && Date.now() - cache.get(c).at < 10 * 60e3));
  if (todo.length) {
    const si = await odoo("product.supplierinfo", "search_read", [[["product_code", "in", todo]]],
      { fields: ["product_code", "product_tmpl_id", "product_id"], context: { allowed_company_ids: [COMPANY_ID] } });
    const tids = [...new Set(si.map(s => s.product_tmpl_id?.[0]).filter(Boolean))];
    const variants = tids.length ? await odoo("product.product", "search_read", [[["product_tmpl_id", "in", tids], ["active", "=", true]]],
      { fields: ["id", "default_code", "barcode", "product_tmpl_id"] }) : [];
    const found = Object.fromEntries(todo.map(c => [c, new Set()]));
    for (const s of si) for (const v of variants) {
      if (v.product_tmpl_id?.[0] !== s.product_tmpl_id?.[0]) continue;
      if (s.product_id && s.product_id[0] !== v.id) continue;   // tarif propre à une variante
      const cip = cipOf(v);
      if (cip) found[s.product_code]?.add(cip);
    }
    for (const c of todo) cache.set(c, { at: Date.now(), cips: [...found[c]] });
  }
  return Object.fromEntries(codes.map(c => [c, cache.get(c)?.cips || []]));
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  try {
    const q = event.queryStringParameters || {};
    const codes = [...new Set(String(q.codes || "").split(",").map(s => s.trim()).filter(s => /^[A-Za-z0-9._-]{2,40}$/.test(s)))].slice(0, 20);
    const extra = [...new Set(String(q.cips || "").split(",").map(s => s.trim()).filter(s => /^\d{7,14}$/.test(s)))].slice(0, 20);
    const byCode = codes.length ? await cipsByCode(codes) : {};
    const all = [...new Set([...Object.values(byCode).flat(), ...extra])];
    const rows = all.length ? await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=in.(${all.join(",")})&select=${FIELDS}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }).then(r => r.json()) : [];
    const byCip = Object.fromEntries((Array.isArray(rows) ? rows : []).map(r => [r.cip, r]));
    const refs = Object.fromEntries(Object.entries(byCode).map(([c, cips]) => [c, cips.map(x => byCip[x]).filter(Boolean)]));
    return json(200, { refs, byCip });
  } catch (e) {
    console.error("supplier-code-refs", e);
    return json(502, { error: e.message || String(e) });
  }
};
