// ── ML Engine — Cross-sell, Re-order, Segmentation ──────────────────────
import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
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

  return { computed: patterns.length };
}

// ── RUPTURE PREDICTION : vélocité de vente vs stock actuel ──────────
async function computeRuptures() {
  // 1. Charger les commandes des 90 derniers jours
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?select=items,date&date=gte.${since}&order=date.asc`, { headers: { ...H, Range: "0-4999" } });
  const orders = await res.json();
  if (!Array.isArray(orders) || orders.length === 0) return { computed: 0, reason: "Pas de commandes récentes" };

  // 2. Calculer la vélocité par CIP (unités/jour)
  const cipData = {};
  const now = Date.now();
  for (const o of orders) {
    const d = new Date(o.date).getTime();
    (Array.isArray(o.items) ? o.items : []).forEach(it => {
      if (!it.cip) return;
      if (!cipData[it.cip]) cipData[it.cip] = { total_qty: 0, first_date: d, last_date: d, order_count: 0 };
      cipData[it.cip].total_qty += parseInt(it.qty) || 0;
      cipData[it.cip].order_count++;
      if (d < cipData[it.cip].first_date) cipData[it.cip].first_date = d;
      if (d > cipData[it.cip].last_date) cipData[it.cip].last_date = d;
    });
  }

  // 3. Charger le stock actuel
  const cips = Object.keys(cipData);
  if (cips.length === 0) return { computed: 0 };
  const stockMap = {};
  for (let i = 0; i < cips.length; i += 200) {
    const batch = cips.slice(i, i + 200);
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=in.(${batch.join(",")})&select=cip,name,available,list_price`, { headers: H });
    const rows = await sRes.json();
    if (Array.isArray(rows)) rows.forEach(r => { stockMap[r.cip] = r; });
  }

  // 4. Calculer les prédictions
  const predictions = [];
  for (const [cip, data] of Object.entries(cipData)) {
    const days_span = Math.max(1, (data.last_date - data.first_date) / 86400000);
    const velocity = data.total_qty / days_span; // unités/jour
    if (velocity <= 0) continue;
    const stock = parseInt(stockMap[cip]?.available) || 0;
    const days_before_rupture = stock > 0 ? Math.round(stock / velocity) : 0;
    const level = days_before_rupture <= 0 ? "rupture" : days_before_rupture <= 7 ? "critical" : days_before_rupture <= 14 ? "warning" : "ok";
    if (level === "ok") continue; // ne stocker que les alertes

    predictions.push({
      cip,
      name: stockMap[cip]?.name || "",
      stock,
      velocity: Math.round(velocity * 100) / 100,
      days_before_rupture,
      level,
      order_count: data.order_count,
      list_price: stockMap[cip]?.list_price || 0,
      updated_at: new Date().toISOString(),
    });
  }

  // 5. Sauver dans Supabase
  if (predictions.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/ec_rupture_predictions?updated_at=lt.${new Date().toISOString()}`, { method: "DELETE", headers: H });
    for (let i = 0; i < predictions.length; i += 100)
      await fetch(`${SUPABASE_URL}/rest/v1/ec_rupture_predictions`, {
        method: "POST", headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify(predictions.slice(i, i + 100)),
      });
  }

  const critical = predictions.filter(p => p.level === "critical").length;
  const rupture = predictions.filter(p => p.level === "rupture").length;
  return { computed: predictions.length, rupture, critical, warning: predictions.length - rupture - critical };
}

// ── SEGMENTATION K-MEANS (simplifié : scoring + clustering) ────────
async function computeSegments() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?select=pharmacy_cip,pharmacy_name,total_ht,items,date&pharmacy_cip=not.is.null&order=date.asc`, { headers: { ...H, Range: "0-9999" } });
  const orders = await res.json();
  if (!Array.isArray(orders) || orders.length < 5) return { computed: 0 };

  const pharma = {};
  for (const o of orders) {
    const pc = o.pharmacy_cip;
    if (!pc || pc === "0") continue;
    if (!pharma[pc]) pharma[pc] = { name: o.pharmacy_name, orders: [], total_ca: 0, cips: new Set() };
    pharma[pc].orders.push(o.date);
    pharma[pc].total_ca += parseFloat(o.total_ht) || 0;
    (Array.isArray(o.items) ? o.items : []).forEach(it => { if (it.cip) pharma[pc].cips.add(it.cip); });
  }

  const segments = [];
  for (const [cip, data] of Object.entries(pharma)) {
    const n = data.orders.length;
    const ca = data.total_ca;
    const panier = ca / n;
    const diversite = data.cips.size;
    const dates = data.orders.map(d => new Date(d).getTime()).sort();
    const recence = Math.round((Date.now() - dates[dates.length - 1]) / 86400000);
    const freq = dates.length >= 2 ? Math.round((dates[dates.length - 1] - dates[0]) / 86400000 / (n - 1)) : null;

    // Score composite (0-100)
    const score_freq = Math.min(100, n * 10); // 10 commandes = 100
    const score_ca = Math.min(100, ca / 50); // 5000€ = 100
    const score_div = Math.min(100, diversite * 5); // 20 produits = 100
    const score_rec = Math.max(0, 100 - recence * 2); // 0j = 100, 50j = 0
    const score = Math.round((score_freq + score_ca + score_div + score_rec) / 4);

    // Segment
    let segment;
    if (n <= 1) segment = "nouveau";
    else if (ca > 3000 && diversite > 10) segment = "gros_generaliste";
    else if (panier > 500) segment = "specialiste_cher";
    else if (diversite > 8) segment = "parapharmacie";
    else if (recence > 30) segment = "dormant";
    else segment = "regulier";

    segments.push({
      pharmacy_cip: cip, pharmacy_name: data.name, segment, score,
      total_orders: n, total_ca: Math.round(ca * 100) / 100, avg_basket: Math.round(panier * 100) / 100,
      product_diversity: diversite, days_since_last: recence, avg_interval_days: freq,
      updated_at: new Date().toISOString(),
    });
  }

  if (segments.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/ec_pharmacy_segments?updated_at=lt.${new Date().toISOString()}`, { method: "DELETE", headers: H });
    for (let i = 0; i < segments.length; i += 100)
      await fetch(`${SUPABASE_URL}/rest/v1/ec_pharmacy_segments`, {
        method: "POST", headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify(segments.slice(i, i + 100)),
      });
  }

  const bySegment = {};
  segments.forEach(s => { bySegment[s.segment] = (bySegment[s.segment] || 0) + 1; });
  return { computed: segments.length, segments: bySegment };
}

// ── QUERY helpers ───────────────────────────────────────────────────────
async function getRecs(cip, limit = 5) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/product_associations?or=(cip_a.eq.${encodeURIComponent(cip)},cip_b.eq.${encodeURIComponent(cip)})&order=lift.desc&limit=${limit}`, { headers: H });
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pharmacy_patterns?pharmacy_cip=eq.${encodeURIComponent(pharmacyCip)}&confidence=gte.0.4&order=confidence.desc,avg_qty.desc&limit=${limit}`, { headers: H });
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
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  if (event.httpMethod === "POST") {
    const auth = await verifyAdmin(event);
    if (auth.error) return auth.error;
    const body = JSON.parse(event.body || "{}");
    if (body.action === "compute") {
      const [assoc, pats, rupt, seg] = await Promise.all([
        computeAssociations(), computePatterns(), computeRuptures(), computeSegments()
      ]);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, associations: assoc, patterns: pats, ruptures: rupt, segments: seg }) };
    }
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "action inconnue" }) };
  }

  // GET ruptures
  if (params.mode === "ruptures") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_rupture_predictions?order=days_before_rupture.asc&limit=50`, { headers: H });
    const data = await res.json();
    return { statusCode: 200, headers: cors, body: JSON.stringify({ predictions: Array.isArray(data) ? data : [] }) };
  }

  // GET segments
  if (params.mode === "segments") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_pharmacy_segments?order=score.desc&limit=100`, { headers: H });
    const data = await res.json();
    return { statusCode: 200, headers: cors, body: JSON.stringify({ segments: Array.isArray(data) ? data : [] }) };
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
