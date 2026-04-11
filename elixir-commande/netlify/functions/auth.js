// ── Auth middleware — vérifie les tokens Supabase Auth ────────────────
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || "pharmacien@elixirpharma.fr";
const ADMIN_EMAILS = ADMIN_EMAIL.split(",").map(e => e.trim().toLowerCase()).concat(["sam.sayah@elixir-pharma.fr"]);

// Vérifie un token Supabase en appelant /auth/v1/user
async function verifySupabaseToken(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id) return null;
    return {
      id: user.id,
      email: user.email,
      isAdmin: user.app_metadata?.role === "admin" ||
               user.user_metadata?.role === "admin" ||
               ADMIN_EMAILS.includes(user.email?.toLowerCase()),
    };
  } catch { return null; }
}

export function verifyToken(token) {
  // Kept for backward compatibility — synchronous check not possible with Supabase
  // Use verifyTokenAsync instead
  return null;
}

export async function verifyTokenAsync(token) {
  return verifySupabaseToken(token);
}

export async function verifyAuth(event) {
  const CORS = getCors(event);
  if (event.httpMethod === "OPTIONS") return { error: { statusCode: 200, headers: CORS, body: "" } };
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const user = await verifySupabaseToken(token);
  if (!user) return { error: { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Non authentifié" }) } };
  return { user, error: null };
}

export async function verifyAdmin(event) {
  const CORS = getCors(event);
  if (event.httpMethod === "OPTIONS") return { error: { statusCode: 200, headers: CORS, body: "" } };
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const user = await verifySupabaseToken(token);
  if (!user?.isAdmin) return { error: { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Accès admin requis" }) } };
  return { admin: user, error: null };
}
