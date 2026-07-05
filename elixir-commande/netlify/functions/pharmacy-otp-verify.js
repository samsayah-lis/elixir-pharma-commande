// ── OTP pharmacie : vérification du code ───────────────────────────────
// POST /pharmacy-otp-verify { email, token }  (token = code à 6 chiffres)
// Renvoie un jeton de session Supabase + la fiche pharmacie (nom, CIP).
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // anon key

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };
  const rl = rateLimit(event, 10, 60); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const email = (body.email || "").trim().toLowerCase();
  const otp = String(body.token || body.otp || "").trim();
  if (!email || !otp) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Email et code requis" }) };

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", email, token: otp }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: err.msg || "Code invalide ou expiré" }) };
    }
    const data = await res.json();

    // Résout la fiche pharmacie (nom + CIP) pour pré-remplir la session côté front
    let pharmacy = null;
    try {
      const p = await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(email)}&select=cip,name&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await p.json();
      pharmacy = Array.isArray(rows) ? rows[0] || null : null;
    } catch {}

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true,
      token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      pharmacy,
    })};
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
