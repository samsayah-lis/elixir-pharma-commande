// ── OTP pharmacie : envoi du code à 6 chiffres ─────────────────────────
// POST /pharmacy-otp-send { email }
// Ne déclenche l'envoi que si l'email correspond à une pharmacie connue.
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // anon key

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };
  const rl = rateLimit(event, 5, 60); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Email invalide" }) };
  }

  // Seules les pharmacies déjà en base peuvent recevoir un code
  try {
    const chk = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(email)}&select=cip&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await chk.json();
    if (!Array.isArray(rows) || !rows[0]) {
      // unknown:true → le front bascule sur le flux « nouveau client »
      return { statusCode: 404, headers: cors, body: JSON.stringify({ success: false, unknown: true, error: "Email non reconnu" }) };
    }
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }

  // Déclenche l'envoi du code OTP via Supabase Auth
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: err.msg || err.error_description || "Envoi du code impossible" }) };
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
