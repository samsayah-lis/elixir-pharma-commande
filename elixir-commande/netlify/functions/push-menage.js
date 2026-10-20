// ── Notifications de l'appli Elixir : ménage quotidien (fonction planifiée, netlify.toml ; docs/notifications.md § 8) ──
// menage() de _push.js : envois de plus de 90 jours ; appareils de pharmacie sans ouverture du site depuis 12 mois ;
// appareils dont l'e-mail du compte n'est plus rattaché au CIP de l'abonnement (pharmacie retirée, e-mail corrigé, ancien
// salarié) ; annonce restée « en cours » (fonction coupée) ; services push refusés de plus de 90 jours.
// Rien n'est envoyé. Clé serveur absente ou tables non créées : rien à faire, sans erreur bloquante.
import { menage, configPush } from "./_push.js";

// deps (doublures des tests) : stock, maintenant, journal, config
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  return async () => {
    const conf = deps.config ? deps.config() : configPush();
    if (!conf.service.cle_serveur) { journal({ evt: "push_menage", code: "configuration" }); return { statusCode: 200, body: "" }; }
    const bilan = await menage({ stock: deps.stock, maintenant: deps.maintenant, journal });
    journal({ evt: "push_menage", code: Object.values(bilan).includes("erreur") ? "partiel" : "ok", ...bilan });
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
