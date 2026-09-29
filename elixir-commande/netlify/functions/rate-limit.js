// ── Rate limiter — protection DoS basique ──────────────────────────────
// Limites par IP : 60 requêtes/minute pour les endpoints publics
// Les fonctions Netlify sont stateless, donc ce rate limiter
// ne fonctionne que par instance (reset à chaque cold start).
// Pour un rate limiting plus robuste, utiliser Supabase ou KV store.

const store = new Map(); // IP → { count, resetAt }

const DEFAULT_LIMIT = 60;   // requêtes max
const DEFAULT_WINDOW = 60;  // secondes

// IP du client : en-tête posé par Netlify (non falsifiable par le navigateur) en priorité ;
// x-forwarded-for peut être prérempli par le client, il ne sert qu'en repli.
export function clientIp(event) {
  const h = event.headers || {};
  return String(h["x-nf-client-connection-ip"] || "").trim()
      || String(h["x-forwarded-for"] || "").split(",")[0].trim()
      || String(h["client-ip"] || "").trim()
      || "unknown";
}

export function rateLimit(event, limit = DEFAULT_LIMIT, windowSec = DEFAULT_WINDOW) {
  const ip = clientIp(event);

  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowSec * 1000 });
    return null; // OK
  }

  entry.count++;

  if (entry.count > limit) {
    return {
      statusCode: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
      },
      body: JSON.stringify({ error: "Trop de requêtes — réessayez dans quelques secondes" }),
    };
  }

  return null; // OK
}

// Cleanup : supprime les entrées expirées toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store) {
    if (now > entry.resetAt) store.delete(ip);
  }
}, 5 * 60 * 1000);
