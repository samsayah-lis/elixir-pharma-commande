// ── Notifications de l'appli Elixir : messages programmés et événements différés (fonction planifiée toutes les 5 minutes,
// netlify.toml ; docs/notifications.md § 5 et § 6) ──
// 1. traiterProgrammes() de _push-messages.js : messages dont l'heure est passée → « en file » (une seule fois, même si deux
//    passages se croisent) puis push-envoi-background ; dû depuis plus de 3 h (service arrêté) → jamais envoyé, erreur
//    expliquée dans l'historique ; message resté « en file » (lancement perdu, autre diffusion plafonnée en cours) → relancé
//    tant que son heure prévue date de moins de 3 h, jamais le soir, la nuit ni le dimanche ; au-delà → erreur.
//    Annulation : admin, tant que le message est « programmé » ou « en file ».
// 2. traiterDifferes() : événements de l'outil entrepôt reçus le soir, la nuit ou le dimanche, envoyés au prochain matin 8 h
//    (heure de Paris). Rien d'autre n'est lu ni envoyé ici.
import { configPush } from "./_push.js";
import { traiterProgrammes, traiterDifferes } from "./_push-messages.js";

// deps (doublures des tests) : stock, lancer, maintenant, journal, config, transport, hotesEssai
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  return async () => {
    const conf = deps.config ? deps.config() : configPush();
    if (!conf.service.cle_serveur) { journal({ evt: "push_programmes", code: "configuration" }); return { statusCode: 200, body: "" }; }
    try { await traiterProgrammes({ stock: deps.stock, lancer: deps.lancer, maintenant: deps.maintenant, journal }); }
    catch (e) { journal({ evt: "push_programmes", code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) }); }
    // événements différés : seulement si l'envoi est possible (clés VAPID) ; sinon ils attendent
    if (conf.ok) {
      try {
        const b = await traiterDifferes({ stock: deps.stock, config: conf, transport: deps.transport, hotesEssai: deps.hotesEssai, maintenant: deps.maintenant, journal });
        if (b.differes) journal({ evt: "push_differes", ...b });
      } catch (e) { journal({ evt: "push_differes", code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) }); }
    }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
