// ── Contingentement : liste des produits contingentés d'Elixir (pastille de la ligne d'article, docs/contingentement-ligne.md) ──
// GET + jeton (pharmacie, ou admin en saisie pour une pharmacie) → { produits: { <CIP ou EAN>: { quota, period, days } } }
// Règles seules, les mêmes pour toutes les pharmacies : quotaProducts de _quota.js (même lecture, même cache de 10 min par
// instance que quota-status), rien d'autre — ni commandes, ni fiche de la pharmacie, ni dispense. Le site n'appelle
// quota-status (reste de la pharmacie, dispense deny_quota) qu'à l'affichage d'un produit de cette liste : aucune lecture
// Odoo de plus pour une pharmacie qui n'en voit aucun. Réponse gardée 10 min par le navigateur (privée : jamais par un
// cache partagé). Sans jeton valide : 401, rien lu ; Supabase Auth en panne : 503 ; Odoo injoignable : 502 (pas de pastille).
import { getCors } from "./cors.js";
import { jetonVerifie } from "./_gp.js";
import { reponseIndisponible } from "./auth.js";
import { quotaProducts } from "./_quota.js";
import { rateLimit } from "./rate-limit.js";

export const handler = async (event) => {
  const cors = getCors(event);
  const rep = (statusCode, corps, cache = "no-store") => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": cache }, body: JSON.stringify(corps) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "GET") return rep(405, { error: "Méthode non autorisée" });
  const limited = rateLimit(event, 30, 60);
  if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
  try {
    // identité : jeton vérifié, avant toute lecture
    if (!(await jetonVerifie(event))) return rep(401, { error: "reconnexion", message: "Session expirée : reconnectez-vous avec le code reçu par e-mail." });
    const produits = {};
    for (const q of await quotaProducts()) {
      const regle = { quota: q.quota, period: q.period, days: q.days };
      produits[q.cip] = regle;
      if (q.barcode) produits[q.barcode] = regle;   // même clé que quota-status (CIP et EAN)
    }
    return rep(200, { produits }, "private, max-age=600");
  } catch (e) {
    if (e?.indisponible) return reponseIndisponible(cors);   // Supabase Auth en panne : jamais 401
    console.error("quota-liste", e);
    return rep(502, { error: e.message || String(e) });
  }
};
