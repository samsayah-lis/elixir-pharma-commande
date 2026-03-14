// ── Debug : vérifie l'état du catalogue Odoo et du cache Supabase ────────
// GET /debug-catalog → diagnostic complet
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const diag = { timestamp: new Date().toISOString(), steps: [] };

  // ── 1. Vérifier Supabase : table odoo_catalog existe ? ────────────────
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,name,available,earliest_expiry&limit=5`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "count=exact" }
    });
    const count = res.headers.get("content-range")?.split("/")?.[1] || "?";
    const rows = await res.json();
    diag.steps.push({
      step: "1. Supabase odoo_catalog",
      status: res.ok ? "OK" : `HTTP ${res.status}`,
      count,
      sample: Array.isArray(rows) ? rows.slice(0, 3) : rows,
    });
  } catch (e) {
    diag.steps.push({ step: "1. Supabase odoo_catalog", status: "ERREUR", error: e.message });
  }

  // ── 2. Vérifier Odoo : connexion ─────────────────────────────────────
  let uid = null;
  try {
    uid = await authenticate();
    diag.steps.push({ step: "2. Odoo auth", status: "OK", uid });
  } catch (e) {
    diag.steps.push({ step: "2. Odoo auth", status: "ERREUR", error: e.message });
    return { statusCode: 200, headers: cors, body: JSON.stringify(diag) };
  }

  // ── 3. Compter les produits Odoo ─────────────────────────────────────
  try {
    const prods = await odooCall(uid, "product.product", "search_read",
      [["active", "=", true]],
      { fields: ["id", "name", "default_code", "barcode"], limit: 10 }
    );
    diag.steps.push({
      step: "3. Odoo produits (sans filtre CIP, limit 10)",
      status: "OK",
      count: Array.isArray(prods) ? prods.length : 0,
      sample: (Array.isArray(prods) ? prods : []).slice(0, 5).map(p => ({
        id: p.id, name: p.name, default_code: p.default_code, barcode: p.barcode
      })),
    });
  } catch (e) {
    diag.steps.push({ step: "3. Odoo produits", status: "ERREUR", error: e.message });
  }

  // ── 4. Produits avec default_code OU barcode ─────────────────────────
  try {
    const prods2 = await odooCall(uid, "product.product", "search_read",
      [["active", "=", true], "|", ["default_code", "!=", false], ["barcode", "!=", false]],
      { fields: ["id", "name", "default_code", "barcode"], limit: 10 }
    );
    diag.steps.push({
      step: "4. Odoo produits avec default_code OU barcode",
      status: "OK",
      count: Array.isArray(prods2) ? prods2.length : 0,
      sample: (Array.isArray(prods2) ? prods2 : []).slice(0, 5).map(p => ({
        id: p.id, name: p.name, default_code: p.default_code, barcode: p.barcode
      })),
    });
  } catch (e) {
    diag.steps.push({ step: "4. Odoo produits filtrés", status: "ERREUR", error: e.message });
  }

  // ── 5. Emplacements stock internes ───────────────────────────────────
  try {
    const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");
    const locs = await odooCall(uid, "stock.location", "search_read",
      [["usage", "=", "internal"], ["company_id", "=", COMPANY_ID]],
      { fields: ["id", "name", "complete_name"], limit: 20 }
    );
    diag.steps.push({
      step: `5. Odoo stock.location internes (company_id=${COMPANY_ID})`,
      status: "OK",
      count: Array.isArray(locs) ? locs.length : 0,
      sample: (Array.isArray(locs) ? locs : []).slice(0, 5),
    });
  } catch (e) {
    diag.steps.push({ step: "5. Odoo stock.location", status: "ERREUR", error: e.message });
  }

  // ── 6. Variables d'env présentes ─────────────────────────────────────
  diag.steps.push({
    step: "6. Variables d'environnement",
    SUPABASE_URL: SUPABASE_URL ? "✓ défini" : "✗ MANQUANT",
    SUPABASE_KEY: SUPABASE_KEY ? "✓ défini" : "✗ MANQUANT",
    ODOO_URL: process.env.ODOO_URL ? "✓ défini" : "✗ MANQUANT (fallback utilisé)",
    ODOO_DB: process.env.ODOO_DB ? "✓ défini" : "✗ MANQUANT (fallback utilisé)",
    ODOO_USER: process.env.ODOO_USER ? "✓ défini" : "✗ MANQUANT (fallback utilisé)",
    ODOO_APIKEY: (process.env.ODOO_APIKEY || process.env.ODOO_PASS) ? "✓ défini" : "✗ MANQUANT",
    ODOO_COMPANY: process.env.ODOO_COMPANY || "2 (défaut)",
  });

  return { statusCode: 200, headers: cors, body: JSON.stringify(diag, null, 2) };
};
