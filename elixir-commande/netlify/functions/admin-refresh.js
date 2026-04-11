// ── Refresh token admin via Supabase Auth ─────────────────────────────
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { refresh_token } = body;
  if (!refresh_token) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "refresh_token manquant" }) };

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });

    if (!res.ok) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: "Session expirée — reconnexion requise" }) };
    }

    const data = await res.json();
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true,
      token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    })};
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
