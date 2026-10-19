// ── Assistant Elixir : purge quotidienne et surveillance (fonction planifiée, netlify.toml) ──
// - conversations sans activité depuis conservation_jours (90 par défaut) supprimées, avec leurs tours ;
//   tours plus anciens supprimés ; les demandes sont gardées (dossier qualité), leur lien de conversation passe à null ;
// - brouillons de retour expirés (30 min) passés en « expirée » ; autorisations de téléchargement périmées supprimées ;
// - budget du jour (80 % et 100 %) et pannes répétées : alerte à GP_ADMIN_MAIL, sans contenu de conversation
//   (aussi vérifiés après chaque tour par chat-tour-background) ;
// - demandes confirmées dont l'envoi a été interrompu (fonction coupée) : envoi repris (aussi après chaque tour).
import { creerStock } from "./_chat-stock.js";
import { lireReglages, journalJson } from "./_chat-config.js";
import { surveiller, creerDemandes } from "./_chat-demandes.js";

export function creerHandler(deps = {}) {
  return async () => {
    const stock = deps.stock || creerStock();
    const maintenant = deps.maintenant || (() => new Date());
    const journal = deps.journal || journalJson;
    try {
      const r = await lireReglages({ stock, maintenant, sansCache: true });
      const avantIso = new Date(maintenant().getTime() - r.conservation_jours * 86400e3).toISOString();
      const bilan = await stock.purger({ avantIso });
      journal({ evt: "purge", code: "ok", ...bilan });
      const alertes = await surveiller({ stock, reglages: r, maintenant, journal, ...(deps.envoyerMail ? { envoyerMail: deps.envoyerMail } : {}) });
      const reprises = await (deps.creerDemandes || creerDemandes)({ stock, reglages: r, maintenant, journal, ...(deps.envoyerMail ? { envoyerMail: deps.envoyerMail } : {}) })
        .relancerEnvois({ limite: 50 }).catch(e => { journal({ evt: "demande", code: "relance_impossible", erreur: String(e?.message || e).slice(0, 80) }); return 0; });
      return { statusCode: 200, body: JSON.stringify({ ...bilan, alertes, reprises }) };
    } catch (e) {
      journal({ evt: "purge", code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      return { statusCode: 500, body: "" };
    }
  };
}

export const handler = creerHandler();
