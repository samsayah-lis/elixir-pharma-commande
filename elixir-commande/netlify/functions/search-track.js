import { rateLimit } from "./rate-limit.js";
import { getCors } from "./cors.js";
// ── Search tracking — log des recherches + analytics ──────────────────
// POST /search-track  { query, pharmacy_cip, results_count, clicked_cip, added_to_cart }
// GET  /search-track?trending=1          → top 20 recherches 7 derniers jours
// GET  /search-track?zero_results=1      → recherches sans résultat (produits demandés mais absents)
// GET  /search-track?funnel=1            → taux conversion recherche → clic → panier
// GET  /search-track?stats=1             → statistiques globales
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const rl = rateLimit(event); if (rl) return rl;

  // ── POST : logger une recherche ──────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

    const { query, pharmacy_cip, results_count, clicked_cip, added_to_cart } = body;
    if (!query || query.trim().length < 2) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };

    const row = {
      query: query.trim().toLowerCase().substring(0, 100),
      pharmacy_cip: pharmacy_cip || null,
      results_count: parseInt(results_count) || 0,
      clicked_cip: clicked_cip || null,
      added_to_cart: !!added_to_cart,
    };

    await fetch(`${SUPABASE_URL}/rest/v1/ec_search_patterns`, {
      method: "POST",
      headers: { ...SB, "Prefer": "return=minimal" },
      body: JSON.stringify(row),
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  // ── GET : analytics ──────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};

    // Trending : top 20 recherches des 7 derniers jours
    if (params.trending === "1") {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/ec_search_trending`,
        {
          method: "POST", headers: SB,
          body: JSON.stringify({ since_date: since, max_results: 20 }),
        }
      );
      if (!res.ok) {
        // Fallback si la RPC n'existe pas encore : requête directe
        const fallbackRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ec_search_patterns?select=query,results_count&created_at=gte.${since}&order=created_at.desc&limit=500`,
          { headers: SB }
        );
        const rows = await fallbackRes.json();
        // Agrégation côté JS
        const counts = {};
        (Array.isArray(rows) ? rows : []).forEach(r => {
          const q = r.query;
          if (!counts[q]) counts[q] = { query: q, count: 0, avg_results: 0, total_results: 0 };
          counts[q].count++;
          counts[q].total_results += r.results_count || 0;
        });
        const trending = Object.values(counts)
          .map(c => ({ ...c, avg_results: Math.round(c.total_results / c.count) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ trending }) };
      }
      const data = await res.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify({ trending: data }) };
    }

    // Zero results : recherches sans résultat
    if (params.zero_results === "1") {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ec_search_patterns?select=query&results_count=eq.0&created_at=gte.${since}&order=created_at.desc&limit=500`,
        { headers: SB }
      );
      const rows = await res.json();
      const counts = {};
      (Array.isArray(rows) ? rows : []).forEach(r => {
        counts[r.query] = (counts[r.query] || 0) + 1;
      });
      const zero = Object.entries(counts)
        .map(([query, count]) => ({ query, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ zero_results: zero }) };
    }

    // Funnel : conversion recherche → clic → panier
    if (params.funnel === "1") {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ec_search_patterns?select=query,clicked_cip,added_to_cart&created_at=gte.${since}&limit=2000`,
        { headers: SB }
      );
      const rows = await res.json();
      const total = (Array.isArray(rows) ? rows : []).length;
      const withResults = rows.filter(r => r.results_count > 0).length;
      const clicked = rows.filter(r => r.clicked_cip).length;
      const addedToCart = rows.filter(r => r.added_to_cart).length;
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        funnel: {
          total_searches: total,
          with_results: withResults,
          clicked: clicked,
          added_to_cart: addedToCart,
          click_rate: total > 0 ? Math.round(clicked / total * 1000) / 10 : 0,
          cart_rate: total > 0 ? Math.round(addedToCart / total * 1000) / 10 : 0,
        }
      })};
    }

    // Stats globales
    if (params.stats === "1") {
      const [totalRes, todayRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/ec_search_patterns?select=id`, { headers: { ...SB, "Range": "0-0", "Prefer": "count=exact" } }),
        fetch(`${SUPABASE_URL}/rest/v1/ec_search_patterns?select=id&created_at=gte.${new Date().toISOString().slice(0, 10)}`, { headers: { ...SB, "Range": "0-0", "Prefer": "count=exact" } }),
      ]);
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        total: parseInt(totalRes.headers.get("content-range")?.split("/")?.[1] || "0"),
        today: parseInt(todayRes.headers.get("content-range")?.split("/")?.[1] || "0"),
      })};
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Paramètre manquant: trending, zero_results, funnel ou stats" }) };
  }

  return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
};
