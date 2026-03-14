// ── Construit les mappings pid_to_cip et cip_to_price depuis Supabase ────
// GET /build-mappings → lit odoo_catalog, sauve dans kv_store. Pas d'appel Odoo.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  try {
    const pidToCip = {};
    const cipToPrice = {};
    let offset = 0;

    while (true) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,odoo_pid,list_price&odoo_pid=not.is.null&order=cip.asc`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Range": `${offset}-${offset + 999}` } }
      );
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      rows.forEach(r => {
        if (r.odoo_pid) pidToCip[r.odoo_pid] = r.cip;
        if (r.list_price > 0) cipToPrice[r.cip] = r.list_price;
      });
      if (rows.length < 1000) break;
      offset += 1000;
    }

    const now = new Date().toISOString();
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "pid_to_cip", value: JSON.stringify(pidToCip), updated_at: now }),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "cip_to_price", value: JSON.stringify(cipToPrice), updated_at: now }),
      }),
    ]);

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true, pid_to_cip: Object.keys(pidToCip).length, cip_to_price: Object.keys(cipToPrice).length,
    })};
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
