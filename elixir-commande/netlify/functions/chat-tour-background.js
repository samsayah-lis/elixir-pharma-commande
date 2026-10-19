// ── Assistant Elixir : un tour de conversation (fonction d'arrière-plan, 15 min max ; tour borné à 90 s) ──
// Lancée par chat.js (action « message ») avec x-cron-secret, comme gp-upload → gp-extract-background.
// POST { tour } : passe le tour de « en_attente » à « en_cours » par une écriture conditionnelle (un double lancement
// ne le joue qu'une fois), relit l'identité vérifiée par chat.js (chat_tours.ctx, table serveur), joue la boucle du
// modèle (_chat-moteur.js) avec les 7 outils (_chat-outils.js), écrit l'étape à chaque outil, puis :
//  1. ajoute les nouveaux messages à l'historique, seulement s'il n'a pas changé depuis le début du tour (un tour
//     déclaré perdu entre-temps par chat.js n'écrit plus rien) ;
//  2. clôt le tour (texte, cartes, jetons, coût) : le navigateur, qui interroge le tour, voit alors la réponse.
// Clé : CHATBOT_ANTHROPIC_API_KEY (espace de travail dédié, plafonné), à défaut ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { isCronAuthorized } from "./auth.js";
import { creerStock, ajouterAuTexte } from "./_chat-stock.js";
import { lireReglages, journalJson } from "./_chat-config.js";
import { SYSTEME, PROMPT_VERSION } from "./_chat-systeme.js";
import { jouerTour, reparerFin, TEXTES } from "./_chat-moteur.js";
import { creerDemandes, surveiller } from "./_chat-demandes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// codes de fin de tour comptés comme des erreurs (service d'IA, historique, exception) ; refus et limites = réponses
const ECHEC = (code) => code === "exception" || code === "historique" || String(code).startsWith("api_");

// deps (doublures des tests) : stock, client, outils ({ OUTILS, ETAPES, executerOutil }), creerDemandes, perimetre,
// autoriser, maintenant, journal, limites, envoyerMail
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStock());
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || journalJson;

  return async (event) => {
    if (!(deps.autoriser || isCronAuthorized)(event)) return { statusCode: 403, body: "" };
    let id = null;
    try { id = JSON.parse(event.body || "{}").tour; } catch { /* corps illisible */ }
    if (!UUID.test(String(id || ""))) return { statusCode: 400, body: "" };
    const stock = stockDe();
    let conv = null, r = null;
    try {
      if (!await stock.tours.demarrer(id)) { journal({ evt: "tour", tour: id, code: "deja_lance" }); return { statusCode: 200, body: "" }; }
      const tour = await stock.tours.lireServeur(id);
      const ctx = tour?.ctx;
      if (!ctx?.odooId || Number(ctx.odooId) !== Number(tour.odoo_id)) throw Object.assign(new Error("identité du tour illisible"), { code: "identite" });
      conv = await stock.conversations.lire(tour.conversation_id, tour.odoo_id);
      if (!conv) throw Object.assign(new Error("conversation introuvable"), { code: "conversation" });
      r = await lireReglages({ stock, maintenant });
      const outils = deps.outils || await import("./_chat-outils.js");
      // déploiement entre le message et le tour : prompt ou outils changés, l'historique ne se rejoue pas avec eux
      if (outils.VERSION_OUTILS && conv.prompt_version !== `${PROMPT_VERSION}+${outils.VERSION_OUTILS}`) {
        throw Object.assign(new Error("version du prompt ou des outils changée"), { code: "version" });
      }
      const cle = process.env.CHATBOT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      const client = deps.client || (cle ? new Anthropic({ apiKey: cle, maxRetries: 1 }) : null);
      if (!client) throw Object.assign(new Error("CHATBOT_ANTHROPIC_API_KEY (ou ANTHROPIC_API_KEY) absente des variables Netlify"), { code: "cle" });
      // demandes rattachées à cette conversation ; outils : périmètre de la fiche appliqué par _chat-outils
      const demandes = (deps.creerDemandes || creerDemandes)({ stock, reglages: r, conversationId: conv.id, maintenant, perimetre: deps.perimetre || {}, journal });
      const depsOutils = { ...(deps.perimetre || {}), stock, demandes, maintenant, reglages: r, conversation_id: conv.id };

      const res = await jouerTour({
        client, messages: conv.messages, modele: conv.modele, effort: r.effort, systeme: SYSTEME, outils: outils.OUTILS,
        executer: (nom, entree) => outils.executerOutil(nom, entree, ctx, depsOutils),
        etapes: outils.ETAPES || {}, surEtape: (texte) => stock.tours.etape(id, texte),
        infos: r, journal, ids: { conv: conv.id, tour: id }, limites: deps.limites || {},
      });

      // 1. historique (ajout seulement, et seulement s'il est resté celui du début du tour)
      const affiche = { id: `a-${id}`, role: "assistant", texte: res.texte, ui_actions: res.ui_actions, at: maintenant().toISOString(), outils: res.outils };
      let ajoute = false;
      await stock.conversations.modifier(conv.id, conv.odoo_id, (c) => {
        ajoute = c.messages_texte === conv.messages_texte;
        return ajoute ? { messages: ajouterAuTexte(c.messages_texte, res.nouveaux), affichage: JSON.stringify([...c.affichage, affiche]) } : null;
      });
      // 2. clôture du tour
      const bilan = { texte: res.texte, ui_actions: res.ui_actions, outils: res.outils, usage: res.usage, cout_eur: res.cout_eur, appels: res.appels,
        repli: res.repli, refus: res.refus, code: res.code, duree_ms: res.duree_ms };
      const clos = !ajoute ? await stock.tours.erreur(id, "historique_modifie", { ...bilan, texte: TEXTES.interrompu() })
        : ECHEC(res.code) ? await stock.tours.erreur(id, res.code, bilan) : await stock.tours.terminer(id, bilan);
      journal({ evt: "tour", conv: conv.id, tour: id, code: ajoute ? res.code : "historique_modifie", clos, appels: res.appels, outils: res.outils.length,
        repli: res.repli, refus: res.refus, usage: res.usage, duree_ms: res.duree_ms, alerte_paiement: res.alerte_paiement });
      await surveiller({ stock, reglages: r, maintenant, journal, ...(deps.envoyerMail ? { envoyerMail: deps.envoyerMail } : {}) })
        .catch(e => journal({ evt: "alerte", code: "surveillance_impossible", erreur: String(e?.message || e).slice(0, 80) }));
    } catch (e) {
      journal({ evt: "tour", tour: id, code: e?.code || "exception", erreur: String(e?.message || e).slice(0, 120) });
      const texte = e?.code === "version" ? "L'assistant vient d'être mis à jour : ouvrez une nouvelle conversation pour continuer." : TEXTES.erreur(r || {});
      try {
        // l'historique se termine par une réponse, puis le tour est clos en erreur (le navigateur voit le message)
        if (conv) {
          await stock.conversations.modifier(conv.id, conv.odoo_id, (c) => {
            const rep = reparerFin(c.messages, texte);
            return rep.length ? { messages: ajouterAuTexte(c.messages_texte, rep),
              affichage: JSON.stringify([...c.affichage, { id: `a-${id}`, role: "assistant", texte, ui_actions: [], at: maintenant().toISOString() }]) } : null;
          });
        }
        await stock.tours.erreur(id, e?.code || "exception", { texte });
      } catch (e2) {
        journal({ evt: "tour", tour: id, code: "erreur_non_enregistree", erreur: String(e2?.message || e2).slice(0, 80) });
      }
    }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
