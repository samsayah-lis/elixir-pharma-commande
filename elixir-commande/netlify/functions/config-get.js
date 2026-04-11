// GET  /config-get?key=display_config     → { value: {...} }
// POST /config-get  { key, value }        → sauvegarde (admin only)
import { verifyAdmin } from "./auth.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  // GET — lecture publique
  if (event.httpMethod === "GET") {
    const key = event.queryStringParameters?.key;
    if (!key) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "key manquant" }) };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ec_config?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: SB }
    );
    const rows = await res.json();
    const value = rows?.[0]?.value ?? null;
    return { statusCode: 200, headers: cors, body: JSON.stringify({ key, value }) };
  }

  // POST — écriture admin (JWT requis)
  if (event.httpMethod === "POST") {
    const auth = verifyAdmin(event);
    if (auth.error) return auth.error;

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

    const { key, value } = body;
    if (!key) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "key manquant" }) };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_config`, {
      method: "POST",
      headers: { ...SB, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, key }) };
  }

  return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
};
