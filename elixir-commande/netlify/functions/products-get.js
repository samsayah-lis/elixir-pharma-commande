import { getCors } from "./cors.js";
// Produits du catalogue curaté, avec prix remisé auto depuis odoo_catalog (liste #5).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_products?active=eq.true&order=section.asc,name.asc&select=*`,
    { headers: { ...SB, "Range": "0-4999" } }
  );
  if (!res.ok) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
  }
  const products = await res.json();

  // Prix remisé Odoo (liste #5, auto-synchronisée) par CIP
  const cips = [...new Set((Array.isArray(products) ? products : []).map(p => p.cip).filter(Boolean))];
  const odoo = {};
  for (let i = 0; i < cips.length; i += 200) {
    const chunk = cips.slice(i, i + 200).map(c => encodeURIComponent(c)).join(",");
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?cip=in.(${chunk})&select=cip,list_price,discounted_price,discount_pct`,
        { headers: SB }
      );
      if (!r.ok) continue;
      const rows = await r.json();
      (Array.isArray(rows) ? rows : []).forEach(row => { odoo[row.cip] = row; });
    } catch { /* on garde le prix manuel pour ce lot */ }
  }

  // Surcharge le prix curaté par le prix Odoo #5 quand un CIP correspond.
  // (produit absent d'Odoo → on garde le prix manuel comme repli)
  const merged = (Array.isArray(products) ? products : []).map(p => {
    const o = p.cip && odoo[p.cip];
    const pv = o ? parseFloat(o.list_price) : NaN;
    const pn = o ? parseFloat(o.discounted_price) : NaN;
    if (o && !isNaN(pn) && pn > 0 && !isNaN(pv) && pv > 0) {
      return {
        ...p,
        pv,
        pn,
        pct: o.discount_pct != null ? parseFloat(o.discount_pct) : p.pct,
        remise_eur: Math.round((pv - pn) * 100) / 100,
        _price_source: "odoo",
      };
    }
    return p;
  });

  return { statusCode: 200, headers: cors, body: JSON.stringify({ products: merged }) };
};
