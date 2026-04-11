// ── Admin login via Supabase Auth ─────────────────────────────────────
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // anon key

export const handler = async (event) => {
  const CORS = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { email, password } = body;
  if (!email || !password) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: "Email et mot de passe requis" }) };
  }

  try {
    // Authenticate via Supabase Auth
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        success: false,
        error: err.error_description || err.msg || "Identifiants incorrects",
      })};
    }

    const data = await res.json();

    // Check admin role in user metadata
    const isAdmin = data.user?.app_metadata?.role === "admin" ||
                    data.user?.user_metadata?.role === "admin" ||
                    data.user?.email === (process.env.ADMIN_EMAIL || "pharmacien@elixirpharma.fr");

    if (!isAdmin) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: false, error: "Ce compte n'a pas les droits administrateur" }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      success: true,
      token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      user: { email: data.user.email, id: data.user.id },
    })};

  } catch (e) {
    console.error("[admin-login]", e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
