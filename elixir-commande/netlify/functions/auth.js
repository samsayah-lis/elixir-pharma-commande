// ── Auth middleware — vérifie les tokens Supabase Auth ────────────────
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || "pharmacien@elixirpharma.fr";
const ADMIN_EMAILS = ADMIN_EMAIL.split(",").map(e => e.trim().toLowerCase()).concat(["sam.sayah@elixir-pharma.fr"]);

// Vérifie un token Supabase en appelant /auth/v1/user
// → utilisateur { id, email, isAdmin, cip } | null (jeton absent, refusé ou expiré).
// Supabase Auth injoignable (panne 5xx, 429, délai dépassé, réseau, réponse illisible) : exception `indisponible`
// (correctif de sécurité du 19/10/2026) — le jeton n'est pas jugé ; avant, la panne passait pour un jeton invalide
// et le site demandait à la pharmacie de se reconnecter par code, alors que la connexion par code dépend du même service.
const indisponible = (detail) => Object.assign(new Error("Connexion momentanément indisponible : réessayez dans un instant."),
  { status: 503, indisponible: true, detail: String(detail || "").slice(0, 200) });
async function verifySupabaseToken(token) {
  if (!token) return null;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),   // sous le délai d'une fonction Netlify (10 s)
    });
  } catch (e) { throw indisponible(e.message); }
  if (res.status >= 500 || res.status === 429) throw indisponible(`HTTP ${res.status}`);
  if (!res.ok) return null;   // 401, 403… : jeton refusé
  let user;
  try { user = await res.json(); } catch (e) { throw indisponible(e.message); }
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
}

export function verifyToken(token) {
  // Kept for backward compatibility — synchronous check not possible with Supabase
  // Use verifyTokenAsync instead
  return null;
}

// Utilisateur | null ; Supabase Auth en panne → null aussi : refus, comme un jeton invalide (aucun accès). Pour les
// appelants qui n'ont pas à distinguer la panne (ml-recommend, lab-justif, restock-alert, submit-order).
export async function verifyTokenAsync(token) {
  try { return await verifySupabaseToken(token); } catch { return null; }
}

// Utilisateur | null ; Supabase Auth en panne → exception { status: 503, indisponible: true } (aucun accès non plus) :
// l'appelant répond reponseIndisponible (503 « indisponible ») au lieu d'un 401 qui ferait demander une reconnexion.
export async function verifierJeton(token) {
  return verifySupabaseToken(token);
}
export const reponseIndisponible = (cors) => ({ statusCode: 503, headers: { ...cors, "Cache-Control": "no-store", "Retry-After": "30" },
  body: JSON.stringify({ success: false, error: "indisponible", message: "Connexion momentanément indisponible : réessayez dans un instant." }) });

export async function verifyAuth(event) {
  const CORS = getCors(event);
  if (event.httpMethod === "OPTIONS") return { error: { statusCode: 200, headers: CORS, body: "" } };
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let user;
  try { user = await verifySupabaseToken(token); } catch (e) { if (e.indisponible) return { error: reponseIndisponible(CORS) }; throw e; }
  if (!user) return { error: { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Non authentifié" }) } };
  return { user, error: null };
}

export async function verifyAdmin(event) {
  const CORS = getCors(event);
  if (event.httpMethod === "OPTIONS") return { error: { statusCode: 200, headers: CORS, body: "" } };
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let user;
  try { user = await verifySupabaseToken(token); } catch (e) { if (e.indisponible) return { error: reponseIndisponible(CORS) }; throw e; }
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
