// ── Notifications de l'appli Elixir : envoi d'un message de l'admin (fonction d'arrière-plan, 15 min max) ──
// Lancée par push-admin.js (action « envoyer » ou « relancer ») et par push-programmes.js (messages programmés) avec
// x-cron-secret, comme chat.js → chat-tour-background. POST { annonce: <uuid> } : passe le message de « en_file » à
// « en_cours » par une écriture conditionnelle (un double lancement ne l'envoie qu'une fois ; un seul message plafonné à la
// fois), puis diffuserAnnonce (_push.js) : appareils des pharmacies abonnées à la catégorie du type (offres, infos,
// commandes), ouverture et audience respectées, plafond par pharmacie, 20 envois en parallèle (5 s au plus chacun), une
// ligne push_envois par pharmacie, e-mail de secours d'un message unitaire (creerRepli, _push-messages.js), compteurs et
// statut du message, purge des envois de plus de 90 jours.
import { isCronAuthorized } from "./auth.js";
import { diffuserAnnonce, estUuid, creerStockPush } from "./_push.js";
import { creerRepli } from "./_push-messages.js";

// deps (doublures des tests) : autoriser, stock, config, transport, hotesEssai, maintenant, journal, envoyerEmail
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  return async (event) => {
    if (!(deps.autoriser || isCronAuthorized)(event)) return { statusCode: 403, body: "" };
    let id = null;
    try { id = JSON.parse(event.body || "{}").annonce; } catch { /* corps illisible */ }
    if (!estUuid(id)) return { statusCode: 400, body: "" };
    const stock = deps.stock || creerStockPush();
    const repli = creerRepli({ stock, journal, ...(deps.envoyerEmail ? { envoyer: deps.envoyerEmail } : {}) });
    const r = await diffuserAnnonce(id, { stock, config: deps.config ? deps.config() : undefined, transport: deps.transport,
      hotesEssai: deps.hotesEssai, maintenant: deps.maintenant, journal, repli });
    journal({ evt: "push_annonce", annonce: String(id).slice(0, 8), lancee: r.lancee, statut: r.statut || null,
      envoyes: r.envoyes ?? null, echecs: r.echecs ?? null, retires: r.retires ?? null, ...(r.email ? { email: r.email } : {}) });
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
