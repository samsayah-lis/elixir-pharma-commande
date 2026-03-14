// ── Admin login — vérifie le password côté serveur, retourne un JWT ──
import { signToken, CORS } from "./auth.js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // PAS de fallback — doit être défini dans Netlify

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  if (!ADMIN_PASSWORD) {
    console.error("[admin-login] ⚠ ADMIN_PASSWORD non défini dans les variables Netlify");
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: "Configuration serveur incomplète" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "JSON invalide" }) }; }

  if (!body.password || body.password !== ADMIN_PASSWORD) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: false, error: "Mot de passe incorrect" }) };
  }

  const token = signToken({ isAdmin: true, name: "admin" }, 24);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, token }) };
};
