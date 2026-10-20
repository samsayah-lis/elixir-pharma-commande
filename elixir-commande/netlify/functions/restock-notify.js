import { getCors } from "./cors.js";
import { verifyAdmin, isCronAuthorized } from "./auth.js";
import { passage, apercu, relancer, chiffres } from "./_restock.js";
// ── Alertes « M'avertir du retour » : envois et tableau de bord (logique : _restock.js, docs/alertes-retour.md) ──
// GitHub Action (run-sync.mjs, fin des étapes de stock), en-tête x-cron-secret :
//   GET|POST ?action=envoyer               → un passage (5 s de travail, envois 7 h – 21 h) ; { done: false } : rappeler
// Admin (jeton) :
//   GET                                    → tableau de bord (produits attendus, prêts à partir, avertis récemment, journal)
//   POST { action: "envoyer" }             → « Envoyer maintenant » : un passage, à toute heure ; { done: false } : rappeler
//   POST { action: "relancer", pharmacy_cip, cip } → envoi interrompu vérifié non reçu : la demande repart
// Réponses d'envoi : chiffres seulement (ni nom ni adresse : les journaux de la GitHub Action peuvent être lus de tous).
// Passage planifié : restock-notify-cron.js (netlify.toml).
const BUDGET_MS = 5000;   // nouveaux envois commencés pendant 5 s : la fonction HTTP (10 s au plus) garde la marge des lectures, du dernier envoi et du journal

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
    try {
      if (isCronAuthorized(event)) {
        if (action !== "envoyer") return json(400, { error: "action=envoyer attendue" });
        return json(200, chiffres(await passage({ source: "synchro", budgetMs: BUDGET_MS, ...deps })));
      }
      const { error } = await verifyAdmin(event);
      if (error) return { ...error, headers: { ...error.headers, ...cors } };
      if (event.httpMethod === "GET") return json(200, await apercu());
      if (event.httpMethod !== "POST") return json(405, { error: "Méthode non permise" });
      if (action === "envoyer") return json(200, chiffres(await passage({ source: "admin", budgetMs: BUDGET_MS, horsFenetre: true, ...deps })));
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
