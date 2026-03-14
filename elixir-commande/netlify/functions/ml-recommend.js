// ── ML Engine — Cross-sell, Re-order, Segmentation ──────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

// ── CROSS-SELL : co-occurrence + Lift ────────────────────────────────────
async function computeAssociations() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?select=items&order=date.desc`, { headers: { ...H, Range: "0-4999" } });
  const orders = await res.json();
  if (!Array.isArray(orders) || orders.length === 0) return { computed: 0 };

  const baskets = orders.map(o => [...new Set((Array.isArray(o.items) ? o.items : []).map(i => i.cip).filter(Boolean))]).filter(b => b.length >= 2);
  const N = baskets.length;
  if (N < 5) return { computed: 0, reason: "Pas assez de commandes" };

  const single = {}, pair = {};
  for (const b of baskets) {
    const s = [...b].sort();
    for (const c of s) single[c] = (single[c] || 0) + 1;
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++)
        pair[`${s[i]}|${s[j]}`] = (pair[`${s[i]}|${s[j]}`] || 0) + 1;
  }

  const associations = [];
  for (const [key, cnt] of Object.entries(pair)) {
    if (cnt < 2) continue;
    const [a, b] = key.split("|");
    const lift = (cnt / N) / ((single[a] / N) * (single[b] / N));
    if (lift >= 1.2) associations.push({
      cip_a: a, cip_b: b,
      lift: Math.round(lift * 100) / 100,
      support: Math.round((cnt / N) * 1000) / 1000,
      confidence: Math.round(Math.max(cnt / single[a], cnt / single[b]) * 100) / 100,
      last_computed: new Date().toISOString(),
    });
  }

  if (associations.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/product_associations?last_computed=lt.${new Date().toISOString()}`, { method: "DELETE", headers: H });
    for (let i = 0; i < associations.length; i += 100)
      await fetch(`${SUPABASE_URL}/rest/v1/product_associations`, {
        method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(associations.slice(i, i + 100))
      });
  }
  console.log(`[ml] ✓ ${associations.length} associations depuis ${N} commandes`);
  return { computed: associations.length, baskets: N };
}

// ── PHARMACY PATTERNS ───────────────────────────────────────────────────
async function computePatterns() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?select=pharmacy_cip,items,date&pharmacy_cip=not.is.null&order=date.asc`, { headers: { ...H, Range: "0-9999" } });
  const orders = await res.json();
  if (!Array.isArray(orders) || orders.length === 0) return { computed: 0 };

  const byPharm = {};
  for (const o of orders) {
    const pc = o.pharmacy_cip;
    if (!pc) continue;
    if (!byPharm[pc]) byPharm[pc] = [];
    byPharm[pc].push({ date: new Date(o.date), items: (Array.isArray(o.items) ? o.items : []).filter(i => i.cip) });
  }

  const patterns = [];
  for (const [pharmacyCip, po] of Object.entries(byPharm)) {
    const byProd = {};
    for (const ord of po) for (const it of ord.items) {
      if (!it.cip) continue;
      if (!byProd[it.cip]) byProd[it.cip] = [];
      byProd[it.cip].push({ date: ord.date, qty: parseInt(it.qty) || 0 });
    }
    for (const [cip, occ] of Object.entries(byProd)) {
      if (occ.length < 2) continue;
      const avgQty = Math.round(occ.reduce((s, o) => s + o.qty, 0) / occ.length);
      const intervals = [];
      for (let i = 1; i < occ.length; i++) {
        const d = (occ[i].date - occ[i - 1].date) / 86400000;
        if (d > 0 && d < 365) intervals.push(d);
      }
      const avgInt = intervals.length > 0 ? Math.round(intervals.reduce((s, d) => s + d, 0) / intervals.length) : null;
      let conf = 0.5;
      if (intervals.length >= 2) {
        const m = intervals.reduce((s, d) => s + d, 0) / intervals.length;
        const std = Math.sqrt(intervals.reduce((s, d) => s + (d - m) ** 2, 0) / intervals.length);
        conf = Math.min(1, Math.max(0, 1 - std / m));
      }
      patterns.push({
        pharmacy_cip: pharmacyCip, cip, avg_qty: avgQty, avg_interval_days: avgInt,
        last_order_date: occ[occ.length - 1].date.toISOString(),
        confidence: Math.round(conf * 100) / 100, order_count: occ.length,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (patterns.length > 0)
    for (let i = 0; i < patterns.length; i += 100)
      await fetch(`${SUPABASE_URL}/rest/v1/pharmacy_patterns`, {
        method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(patterns.slice(i, i + 100))
      });

  console.log(`[ml] ✓ ${patterns.length} patterns pharmacie`);
  return { computed: patterns.length };
}

// ── QUERY helpers ───────────────────────────────────────────────────────
async function getRecs(cip, limit = 5) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/product_associations?or=(cip_a.eq.${cip},cip_b.eq.${cip})&order=lift.desc&limit=${limit}`, { headers: H });
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const recs = rows.map(r => ({ cip: r.cip_a === cip ? r.cip_b : r.cip_a, lift: r.lift, confidence: r.confidence }));
  const cipList = recs.map(r => r.cip).join(",");
  const prRes = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=in.(${cipList})&select=cip,name,section,pn,image_url`, { headers: H });
  const prods = await prRes.json();
  const pm = {}; if (Array.isArray(prods)) prods.forEach(p => pm[p.cip] = p);
  return recs.map(r => ({ ...r, name: pm[r.cip]?.name, section: pm[r.cip]?.section, pn: pm[r.cip]?.pn, image_url: pm[r.cip]?.image_url }));
}

async function getReorder(pharmacyCip, limit = 20) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pharmacy_patterns?pharmacy_cip=eq.${pharmacyCip}&confidence=gte.0.4&order=confidence.desc,avg_qty.desc&limit=${limit}`, { headers: H });
  const pats = await res.json();
  if (!Array.isArray(pats) || pats.length === 0) return [];
  const cipList = pats.map(p => p.cip).join(",");
  const prRes = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=in.(${cipList})&select=cip,name,section,pn`, { headers: H });
  const prods = await prRes.json();
  const pm = {}; if (Array.isArray(prods)) prods.forEach(p => pm[p.cip] = p);
  return pats.map(p => {
    const days = p.last_order_date ? Math.round((Date.now() - new Date(p.last_order_date).getTime()) / 86400000) : null;
    return {
      cip: p.cip, name: pm[p.cip]?.name, section: pm[p.cip]?.section, pn: pm[p.cip]?.pn,
      suggested_qty: p.avg_qty, avg_interval_days: p.avg_interval_days,
      days_since_last: days, should_reorder: p.avg_interval_days && days ? days >= p.avg_interval_days * 0.8 : false,
      confidence: p.confidence, order_count: p.order_count,
    };
  });
}

// ── HANDLER ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    if (body.action === "compute") {
      const [assoc, pats] = await Promise.all([computeAssociations(), computePatterns()]);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, associations: assoc, patterns: pats }) };
    }
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "action inconnue" }) };
  }

  if (params.mode === "reorder" && params.pharmacy_cip) {
    const suggestions = await getReorder(params.pharmacy_cip, parseInt(params.limit) || 20);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ suggestions }) };
  }
  if (params.cip) {
    const recommendations = await getRecs(params.cip, parseInt(params.limit) || 5);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ recommendations }) };
  }
  return { statusCode: 200, headers: cors, body: JSON.stringify({ status: "ok", usage: "?cip=XXX or ?pharmacy_cip=XXX&mode=reorder" }) };
};
