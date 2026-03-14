// ── Auth middleware — JWT sans dépendance externe ────────────────────────
import { createHmac } from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_NETLIFY_ENV_VARS";

function base64url(str) { return Buffer.from(str).toString("base64url"); }
function hmac(data, secret) { return createHmac("sha256", secret).update(data).digest("base64url"); }

export function signToken(payload, expiresInHours = 24 * 7) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInHours * 3600 }));
  return `${header}.${body}.${hmac(`${header}.${body}`, JWT_SECRET)}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig) return null;
  if (sig !== hmac(`${header}.${body}`, JWT_SECRET)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export function verifyAuth(event) {
  if (event.httpMethod === "OPTIONS") return { error: { statusCode: 200, headers: CORS, body: "" } };
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const payload = verifyToken(token);
  if (!payload) return { error: { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Non authentifié" }) } };
  return { user: payload, error: null };
}

export function verifyAdmin(event) {
  if (event.httpMethod === "OPTIONS") return { error: { statusCode: 200, headers: CORS, body: "" } };
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const payload = verifyToken(authHeader.replace(/^Bearer\s+/i, ""));
  if (!payload?.isAdmin) return { error: { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Accès admin requis" }) } };
  return { admin: payload, error: null };
}
