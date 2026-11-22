import { getCors } from "./cors.js";
import { ROLES } from "./_crm-regles.js";
export const reponseCrm = (event, statusCode, data) => ({ statusCode,
  headers: { ...getCors(event), "Cache-Control": "no-store" }, body: data === undefined ? "" : JSON.stringify(data) });
export function roleCrm(user, deps = {}) {
  if (ROLES.includes(user?.app_metadata?.role)) return user.app_metadata.role;
  const admins = (deps.adminEmail ?? process.env.ADMIN_EMAIL ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (user?.email && admins.includes(user.email.toLowerCase())) return "admin";
  return null;
}
export async function verifierCrm(event, deps = {}) {
  const erreur = (s, message) => ({ error: reponseCrm(event, s, { error: message }) });
  if (event.httpMethod === "OPTIONS") return { error: reponseCrm(event, 200) };
  const token = (event.headers?.authorization || event.headers?.Authorization || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return erreur(401, "Jeton absent ou invalide.");
  try {
    const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.authCle ?? process.env.SUPABASE_KEY;
    if (!url || !cle) return erreur(503, "Authentification indisponible.");
    const res = await (deps.fetch || fetch)(`${url}/auth/v1/user`, {
      headers: { apikey: cle, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (res.status >= 500 || res.status === 429) return erreur(503, "Authentification indisponible.");
    if (!res.ok) return erreur(401, "Jeton absent ou invalide.");
    const user = await res.json();
    if (!user?.id || !user?.email) return erreur(401, "Jeton absent ou invalide.");
    const role = roleCrm(user, deps);
    if (!role) return erreur(403, "Rôle CRM requis.");
    return { utilisateur: { id: user.id, email: user.email.toLowerCase(), role } };
  } catch { return erreur(503, "Authentification indisponible."); }
}
