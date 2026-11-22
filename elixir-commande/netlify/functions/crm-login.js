import { z } from "zod";
import { rateLimit } from "./rate-limit.js";
import { reponseCrm, roleCrm } from "./_crm-acces.js";
import { email, valider } from "./_crm-regles.js";
export function creerHandlerLogin(deps = {}) {
  return async event => {
    const rep = (s, d) => reponseCrm(event, s, d);
    if (event.httpMethod === "OPTIONS") return rep(200);
    if (event.httpMethod !== "POST") return rep(405, { error: "Méthode POST requise." });
    const rl = (deps.rateLimit || rateLimit)(event, 10, 60);
    if (rl) return { ...rl, headers: { ...rep(200).headers, ...rl.headers } };
    try {
      let body;
      try { body = JSON.parse(event.body); } catch { return rep(400, { error: "JSON invalide." }); }
      const data = valider(z.strictObject({ email, password: z.string().min(1).max(1024) }), body);
      const url = deps.url ?? process.env.SUPABASE_URL, cle = deps.authCle ?? process.env.SUPABASE_KEY;
      if (!url || !cle) return rep(503, { error: "Authentification indisponible." });
      const res = await (deps.fetch || fetch)(`${url}/auth/v1/token?grant_type=password`, { method: "POST",
        headers: { apikey: cle, "Content-Type": "application/json" }, body: JSON.stringify(data), signal: AbortSignal.timeout(6000) });
      if (res.status >= 500 || res.status === 429) return rep(503, { error: "Authentification indisponible." });
      if (!res.ok) return rep(401, { error: "Identifiants incorrects." });
      const session = await res.json(), role = roleCrm(session.user, deps);
      if (!session.user?.id || !session.access_token) return rep(503, { error: "Réponse d’authentification illisible." });
      if (!role) return rep(403, { error: "Rôle CRM requis." });
      return rep(200, { success: true, token: session.access_token, refresh_token: session.refresh_token,
        expires_in: session.expires_in, role, utilisateur: { id: session.user.id, email: session.user.email, role } });
    } catch (e) { return rep(e.status === 400 ? 400 : 503, { error: e.status === 400 ? e.message : "Authentification indisponible." }); }
  };
}
export const handler = creerHandlerLogin();
