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
    // NB: on n'accepte PAS user_metadata.role — il est modifiable par
    // l'utilisateur lui-même (self-promotion possible). Seuls app_metadata.role
    // (écrit côté serveur uniquement) et la liste ADMIN_EMAILS font foi.
    const isAdmin = user.app_metadata?.role === "admin" ||
                    ADMIN_EMAILS.includes(user.email?.toLowerCase());
    // Pour une pharmacie (non-admin), on résout le CIP à partir de l'email
    // VÉRIFIÉ du jeton → impossible d'usurper le CIP d'une autre pharmacie.
    let cip = null;
    if (!isAdmin && user.email) {
      try {
        const pr = await fetch(
          `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(user.email.toLowerCase())}&select=cip&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const rows = await pr.json();
        cip = Array.isArray(rows) ? (rows[0]?.cip || null) : null;
      } catch { /* cip reste null */ }
    }
    return { id: user.id, email: user.email, isAdmin, cip };
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

// Autorise un appel automatisé (cron GitHub Actions) via un secret partagé.
// Renvoie false si CRON_SECRET n'est pas configuré → aucun contournement possible.
export function isCronAuthorized(event) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = event.headers || {};
  const provided = h["x-cron-secret"] || h["X-Cron-Secret"] || "";
  return provided === secret;
}
