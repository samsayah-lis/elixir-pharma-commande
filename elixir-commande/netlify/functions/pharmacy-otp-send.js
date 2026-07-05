// ── OTP pharmacie : envoi du code à 6 chiffres ─────────────────────────
// POST /pharmacy-otp-send { email }
// Ne déclenche l'envoi que si l'email correspond à une pharmacie connue.
// Parité avec pharmacy-lookup : cache Supabase PUIS fallback Odoo.
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // anon key
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const validCip = (cip) => cip && cip !== "0" && cip !== "false" && cip !== "";

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

  // 1. Cache Supabase
  let known = false;
  try {
    const chk = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(email)}&select=cip&limit=1`,
      { headers: SB }
    );
    const rows = await chk.json();
    if (Array.isArray(rows) && rows[0]) known = true;
  } catch { /* on tente Odoo ci-dessous */ }

  // 2. Fallback Odoo (comme pharmacy-lookup) + mise en cache
  if (!known) {
    try {
      const uid = await authenticate();
      const partners = await odooCall(uid, "res.partner", "search_read",
        [["email", "ilike", email], ["active", "=", true]],
        { fields: ["name", "email", "ref", "cip", "street", "zip", "city", "phone", "mobile"], limit: 5 }
      );
      const match = (partners || []).find(p => p.email?.trim().toLowerCase() === email);
      if (match) {
        known = true;
        const cipValue = validCip(match.cip) ? match.cip : validCip(match.ref) ? match.ref : "";
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies`, {
            method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify({
              name: match.name || "", email, cip: cipValue,
              street: match.street || "", cp: match.zip || "", ville: match.city || "",
              tel: match.mobile || match.phone || "",
            }),
          });
        } catch { /* le cache n'est pas bloquant */ }
      }
    } catch (e) { console.warn("[otp-send] Odoo lookup:", e.message); }
  }

  if (!known) {
    // unknown:true → le front bascule sur le flux « nouveau client »
    return { statusCode: 404, headers: cors, body: JSON.stringify({ success: false, unknown: true, error: "Email non reconnu" }) };
  }

  // 3. Déclenche l'envoi du code OTP via Supabase Auth
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: err.msg || err.error_description || `Envoi du code impossible (HTTP ${res.status})` }) };
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
