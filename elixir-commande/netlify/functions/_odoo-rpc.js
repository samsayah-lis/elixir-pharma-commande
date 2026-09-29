// ── Odoo en JSON-RPC ────────────────────────────────────────────────────
// Réponses natives (many2one = [id, nom], many2many complets), contrairement
// au parseur XML-RPC de odoo.js qui aplatit ces champs.
const ODOO_URL  = (process.env.ODOO_URL || "https://odoo.elixir-pharma.fr").replace(/\/$/, "");
const ODOO_DB   = process.env.ODOO_DB   || "healthsoft-sas-lispharma-main-13622653";
const ODOO_USER = process.env.ODOO_USER || "pharmacien@elixirpharma.fr";
const ODOO_KEY  = process.env.ODOO_APIKEY || "";
export const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");

let uidCache = null;
async function rpc(service, method, args) {
  const r = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
  });
  const j = await r.json();
  if (j.error) throw new Error(String(j.error?.data?.message || j.error?.message || "Erreur Odoo").slice(0, 300));
  return j.result;
}

export async function odoo(model, method, args, kwargs = {}) {
  if (!uidCache) uidCache = await rpc("common", "login", [ODOO_DB, ODOO_USER, ODOO_KEY]);
  if (!uidCache) throw new Error("Authentification Odoo refusée");
  return rpc("object", "execute_kw", [ODOO_DB, uidCache, ODOO_KEY, model, method, args, kwargs]);
}

// search_read paginé, sans plafond
export async function odooAll(model, domain, kwargs = {}, page = 1000) {
  const out = [];
  for (let offset = 0; ; offset += page) {
    const rows = await odoo(model, "search_read", [domain], { ...kwargs, limit: page, offset });
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
