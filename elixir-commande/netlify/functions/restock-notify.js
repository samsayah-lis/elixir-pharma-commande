import { getCors } from "./cors.js";
import { verifyAdmin, isCronAuthorized } from "./auth.js";
import { passage, apercu, relancer, chiffres, changerActif } from "./_restock.js";
// ── Alertes « M'avertir du retour » : envois et tableau de bord (logique : _restock.js, docs/alertes-retour.md) ──
// GitHub Action (run-sync.mjs, fin des étapes de stock), en-tête x-cron-secret :
//   GET|POST ?action=envoyer               → un passage (envois 7 h – 21 h, si les envois automatiques sont activés) ;
//                                            { done: false } : rappeler
// Admin (jeton) :
//   GET                                    → tableau de bord (produits attendus, prêts à partir, demandes traitées, journal ;
//                                            adresse e-mail des seuls envois à vérifier, pour la recherche dans Resend)
//   POST { action: "envoyer" }             → « Envoyer maintenant » : un passage, à toute heure, même envois automatiques
//                                            suspendus ; { done: false } : rappeler
//   POST { action: "activer", actif }      → envois automatiques activés (true) ou suspendus (false) ; la première
//                                            activation fixe la date de mise en service
//   POST { action: "relancer", pharmacy_cip, cip } → envoi incertain vérifié non reçu, ou refusé 3 fois : la demande repart
// Réponses d'envoi : chiffres seulement (ni nom ni adresse : les journaux de la GitHub Action peuvent être lus de tous).
// Passage planifié : restock-notify-cron.js (netlify.toml).
// Fonction HTTP : 10 s au plus → nouvelles opérations pendant 4 s, aucune qui pourrait finir après 9 s (un envoi : 4 s
// d'attente de Resend au plus, plus la réservation et le compte rendu).
const BUDGET_MS = 4000;
const LIMITE_MS = 9000;

export function creerHandler(deps = {}) {
  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
    const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
    let body = {};
    if (event.httpMethod === "POST" && event.body) {
      try { body = JSON.parse(event.body) || {}; } catch { return json(400, { error: "JSON invalide" }); }
    }
    const action = String(body.action || event.queryStringParameters?.action || "");
    const opts = { budgetMs: BUDGET_MS, limiteMs: LIMITE_MS, ...deps };
    try {
      if (isCronAuthorized(event)) {
        if (action !== "envoyer") return json(400, { error: "action=envoyer attendue" });
        return json(200, chiffres(await passage({ source: "synchro", ...opts })));
      }
      const { error } = await verifyAdmin(event);
      if (error) return { ...error, headers: { ...error.headers, ...cors } };
      if (event.httpMethod === "GET") return json(200, await apercu(deps.maintenant ? { maintenant: deps.maintenant() } : {}));
      if (event.httpMethod !== "POST") return json(405, { error: "Méthode non permise" });
      if (action === "envoyer") return json(200, chiffres(await passage({ source: "admin", horsFenetre: true, ...opts })));
      if (action === "activer") {
        if (typeof body.actif !== "boolean") return json(400, { error: "actif (true ou false) requis" });
        const v = await changerActif(body.actif, deps.maintenant ? deps.maintenant() : Date.now());
        console.log(`[restock-notify] envois automatiques ${v.actif ? "activés" : "suspendus"} (mise en service : ${v.mise_en_service || "—"})`);
        return json(200, { success: true, actif: v.actif, mise_en_service: v.mise_en_service });
      }
      if (action === "relancer") {
        const r = await relancer({ pharmacy_cip: body.pharmacy_cip, cip: body.cip });
        return r.ok ? json(200, { success: true }) : json(r.statut, { error: r.error });
      }
      return json(400, { error: "action inconnue" });
    } catch (e) {
      console.error("[restock-notify]", e?.message || e);
      return json(500, { error: String(e?.message || e).slice(0, 300) });
    }
  };
}

export const handler = creerHandler();
