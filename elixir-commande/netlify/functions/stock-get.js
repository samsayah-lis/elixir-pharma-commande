import { getCors } from "./cors.js";
// Stock des produits du catalogue curaté, lu depuis odoo_catalog
// (auto-synchronisé toutes les 3 h) — remplace l'ancienne table morte elixir_stocks.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

export const handler = async (event) => {
  const cors = getCors(event);
  try {
    // 1. CIP demandés (?cips=a,b — lignes d'une commande, 300 max) ou ceux du catalogue curaté
    const asked = String(event.queryStringParameters?.cips || "").split(",").map(c => c.trim()).filter(c => /^\d{7,14}$/.test(c)).slice(0, 300);
    let cips = asked;
    if (!asked.length) {
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_products?active=eq.true&select=cip`,
        { headers: { ...SB, "Range": "0-9999" } }
      );
      const prods = await pr.json();
      cips = [...new Set((Array.isArray(prods) ? prods : []).map(p => p.cip).filter(Boolean))];
    }
    if (cips.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null }) };
    }

    // 2. Stock depuis odoo_catalog pour ces CIP (par lots, pour la longueur d'URL)
    const stocks = {};
    let updatedAt = null;
    for (let i = 0; i < cips.length; i += 200) {
      const chunk = cips.slice(i, i + 200).map(c => encodeURIComponent(c)).join(",");
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?cip=in.(${chunk})&select=cip,in_stock,available,updated_at`,
        { headers: SB }
      );
      if (!res.ok) continue;
      const rows = await res.json();
      (Array.isArray(rows) ? rows : []).forEach(r => {
        // CIP demandés : disponibilité seulement (pas les quantités exactes du stock)
        stocks[r.cip] = asked.length ? { dispo: r.in_stock ? 1 : 0 } : { dispo: r.in_stock ? 1 : 0, stock: r.available || 0 };
        if (!updatedAt || (r.updated_at && r.updated_at > updatedAt)) updatedAt = r.updated_at;
      });
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks, updatedAt }) };
  } catch (err) {
    console.error("[stock-get] ERREUR:", err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
