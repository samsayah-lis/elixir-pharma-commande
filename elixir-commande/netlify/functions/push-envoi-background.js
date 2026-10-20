// ── Notifications de l'appli Elixir : envoi d'une annonce « Offres et nouveautés » (fonction d'arrière-plan, 15 min max) ──
// Lancée par push-admin.js (action « envoyer » ou « relancer ») avec x-cron-secret, comme chat.js → chat-tour-background.
// POST { annonce: <uuid> } : passe l'annonce de « en_file » à « en_cours » par une écriture conditionnelle (un double
// lancement ne l'envoie qu'une fois), puis diffuserAnnonce (_push.js) : appareils des pharmacies abonnées aux offres,
// ouverture et audience respectées, plafond par pharmacie sur 7 jours glissants, 20 envois en parallèle (5 s au plus
// chacun), une ligne push_envois par pharmacie, compteurs et statut de l'annonce, purge des envois de plus de 90 jours.
import { isCronAuthorized } from "./auth.js";
import { diffuserAnnonce, estUuid } from "./_push.js";

// deps (doublures des tests) : autoriser, stock, config, transport, hotesEssai, maintenant, journal
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  return async (event) => {
    if (!(deps.autoriser || isCronAuthorized)(event)) return { statusCode: 403, body: "" };
    let id = null;
    try { id = JSON.parse(event.body || "{}").annonce; } catch { /* corps illisible */ }
    if (!estUuid(id)) return { statusCode: 400, body: "" };
    const r = await diffuserAnnonce(id, { stock: deps.stock, config: deps.config ? deps.config() : undefined, transport: deps.transport,
      hotesEssai: deps.hotesEssai, maintenant: deps.maintenant, journal });
    journal({ evt: "push_annonce", annonce: String(id).slice(0, 8), lancee: r.lancee, statut: r.statut || null,
      envoyes: r.envoyes ?? null, echecs: r.echecs ?? null, retires: r.retires ?? null });
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
