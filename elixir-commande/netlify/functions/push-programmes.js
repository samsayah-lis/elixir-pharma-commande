// ── Notifications de l'appli Elixir : messages programmés (fonction planifiée toutes les 5 minutes, netlify.toml ;
// docs/notifications.md § 5) ──
// traiterProgrammes() de _push-messages.js : messages dont l'heure est passée → « en file » (une seule fois, même si deux
// passages se croisent) puis push-envoi-background ; dû depuis plus de 3 h (service arrêté) → jamais envoyé, erreur
// expliquée dans l'historique ; message resté « en file » 2 minutes à 24 heures (lancement perdu, autre diffusion plafonnée
// en cours) → relancé. Annulation : admin, tant que le message est « programmé ». Rien d'autre n'est lu ni envoyé ici.
import { configPush } from "./_push.js";
import { traiterProgrammes } from "./_push-messages.js";

// deps (doublures des tests) : stock, lancer, maintenant, journal, config
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  return async () => {
    const conf = deps.config ? deps.config() : configPush();
    if (!conf.service.cle_serveur) { journal({ evt: "push_programmes", code: "configuration" }); return { statusCode: 200, body: "" }; }
    try { await traiterProgrammes({ stock: deps.stock, lancer: deps.lancer, maintenant: deps.maintenant, journal }); }
    catch (e) { journal({ evt: "push_programmes", code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) }); }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
