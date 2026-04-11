// ── CORS helper — restreint aux domaines autorisés ───────────────────────
const ALLOWED_ORIGINS = [
  "https://elixir-commande.expepharma.com",
  "https://commandes-elixir.netlify.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

export function getCors(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };
}
