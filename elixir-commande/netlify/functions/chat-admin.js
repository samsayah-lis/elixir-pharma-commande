// ── Assistant Elixir : API de l'onglet admin « Assistant » (verifyAdmin sur toutes les routes) ──
// GET  ?vue=conversations&jours=30 → { conversations: [{ id, odoo_id, pharmacie, admin_email, statut, nb_messages, created_at, updated_at }] }
// GET  ?vue=conversation&id=       → { conversation: { id, odoo_id, pharmacie, admin_email, modele, statut, created_at }, messages }
//      (textes visibles seulement — jamais réflexion, appels ni résultats d'outils — et, pour chaque réponse de
//      l'assistant, les noms des outils appelés)
// GET  ?vue=demandes&statut=       → { demandes: [{ id, type, statut, odoo_id, pharmacie, conversation_id, created_at, confirmee_at,
//                                       transmise_at, cible_ref, numero, resume, brouillon, erreur }] }
// POST { action: "demande_statut", id, statut: "traitee" | "rejetee" | "transmise" } → { ok }
// GET  ?vue=couts&jours=30         → { budget_jour_eur, jours: [{ jour, tours, cout_eur, replis, erreurs, refus }] }
// GET  ?vue=reglages               → { valeur (fusionnée avec REGLAGES_DEFAUT), updated_at, modeles, efforts, pilote_fiches: [{ odoo_id, nom, ville }] }
// POST { action: "reglages", valeur, base (updated_at lu) } → { ok, updated_at } | 409 { conflit: true, valeur, updated_at }
// Les textes restent bruts : l'onglet les affiche échappés (React), jamais en HTML.
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import { creerStock } from "./_chat-stock.js";
import { odoo } from "./_odoo-rpc.js";
import { lireReglages, fusionnerReglages, verifierReglages, oublierReglages, jourParis, debutJourParisIso, journalJson, MODELES, EFFORTS } from "./_chat-config.js";

const STATUTS = ["brouillon", "confirmee", "transmise", "echec", "expiree", "annulee", "traitee", "rejetee"];
// changements de statut posés par l'équipe : statut visé → statuts de départ acceptés
const TRANSITIONS = { traitee: ["confirmee", "transmise", "echec"], transmise: ["confirmee", "echec"], rejetee: ["confirmee", "transmise", "echec"] };
// hôte d'aperçu (deploy preview, branch deploy) : fonctions branchées sur la production, donc aucune écriture (contrat, règle 6)
const APERCU = /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/;
const json = (cors, statusCode, corps) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(corps) });
const borne = (v, min, max, defaut) => { const n = parseInt(v, 10); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : defaut; };
const jourAvant = (jour, n) => new Date(Date.parse(`${jour}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
// noms des fiches du pilote (affichage de l'admin seulement) : lecture Odoo ; sans réponse, l'admin affiche « n° 595 »
async function nomsFichesOdoo(ids) {
  if (!ids.length) return [];
  const rows = await odoo("res.partner", "search_read", [[["id", "in", ids]]], { fields: ["name", "city"], limit: ids.length, context: { active_test: false } }, { timeoutMs: 6000 });
  return (rows || []).map(p => ({ odoo_id: p.id, nom: String(p.name || "").replace(/\s+/g, " ").trim(), ville: p.city || null }));
}

export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStock());
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || journalJson;
  const nomsFiches = deps.nomsFiches || nomsFichesOdoo;

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    const { error } = await (deps.verifierAdmin || verifyAdmin)(event);
    if (error) return { ...error, headers: { ...cors, ...(error.headers || {}), "Cache-Control": "no-store" } };
    const stock = stockDe();
    try {
      if (event.httpMethod === "GET") {
        const q = event.queryStringParameters || {};
        switch (q.vue) {
          case "conversations": {
            const jours = borne(q.jours, 1, 365, 30);
            const rows = await stock.conversations.lister({ depuisIso: new Date(maintenant().getTime() - jours * 86400e3).toISOString() });
            return json(cors, 200, { conversations: rows.map(c => ({ id: c.id, odoo_id: c.odoo_id, pharmacie: c.pharmacie, admin_email: c.admin_email,
              statut: c.statut, nb_messages: c.nb_messages, created_at: c.created_at, updated_at: c.updated_at })) });
          }
          case "conversation": {
            const c = await stock.conversations.lireAdmin(q.id);
            if (!c) return json(cors, 404, { error: "Conversation introuvable" });
            return json(cors, 200, {
              conversation: { id: c.id, odoo_id: c.odoo_id, pharmacie: c.pharmacie, admin_email: c.admin_email, modele: c.modele, statut: c.statut, created_at: c.created_at },
              messages: (c.affichage || []).map(m => ({ id: String(m.id), role: m.role === "pharmacie" ? "pharmacie" : "assistant", texte: String(m.texte ?? ""),
                ui_actions: Array.isArray(m.ui_actions) ? m.ui_actions : [], at: m.at,
                ...(m.role === "pharmacie" ? {} : { outils: (Array.isArray(m.outils) ? m.outils : []).map(String) }) })),
            });
          }
          case "demandes": {
            const statut = STATUTS.includes(q.statut) ? q.statut : null;
            const rows = await stock.demandes.lister({ statut, limite: 500 });
            return json(cors, 200, { demandes: rows.map(d => ({ id: d.id, type: d.type, statut: d.statut, odoo_id: d.odoo_id, pharmacie: d.pharmacie,
              conversation_id: d.conversation_id, created_at: d.created_at, confirmee_at: d.confirmee_at, transmise_at: d.transmise_at,
              cible_ref: d.cible_ref, numero: d.numero, resume: d.resume, brouillon: d.brouillon, erreur: d.erreur })) });
          }
          case "couts": {
            const jours = borne(q.jours, 1, 90, 30);
            const aujourdhui = jourParis(maintenant());
            const premier = jourAvant(aujourdhui, jours - 1);
            const [r, tours] = await Promise.all([lireReglages({ stock, maintenant }), stock.tours.lister({ depuisIso: debutJourParisIso(premier) })]);
            const parJour = new Map();
            for (let i = jours - 1; i >= 0; i--) { const j = jourAvant(aujourdhui, i); parJour.set(j, { jour: j, tours: 0, cout_eur: 0, replis: 0, erreurs: 0, refus: 0 }); }
            for (const t of tours) {
              const l = parJour.get(jourParis(t.created_at));
              if (!l) continue;
              l.tours++;
              l.cout_eur += Number(t.cout_eur) || 0;
              if (t.repli) l.replis++;
              if (t.statut === "erreur") l.erreurs++;
              if (t.refus) l.refus++;
            }
            return json(cors, 200, { budget_jour_eur: r.budget_jour_eur, jours: [...parJour.values()].map(l => ({ ...l, cout_eur: Math.round(l.cout_eur * 1e4) / 1e4 })) });
          }
          case "reglages": {
            const lu = await stock.reglages.lire();
            const valeur = fusionnerReglages(lu.valeur);
            const pilote_fiches = await nomsFiches(valeur.pilote.slice(0, 200)).catch((e) => { journal({ evt: "admin", code: "noms_pilote", erreur: String(e?.message || e).slice(0, 80) }); return []; });
            // modeles / efforts : choix acceptés par le serveur (l'admin grise les autres)
            return json(cors, 200, { valeur, updated_at: lu.updated_at, modeles: MODELES, efforts: EFFORTS, pilote_fiches });
          }
          default: return json(cors, 400, { error: "Vue inconnue" });
        }
      }

      if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
      if (APERCU.test(String(event.headers?.host || event.headers?.Host || "").toLowerCase())) return json(cors, 403, { error: "Aperçu : aucune modification n'est enregistrée ici." });
      let b;
      try { b = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "Requête illisible" }); }
      switch (b.action) {
        case "demande_statut": {
          const de = TRANSITIONS[b.statut];
          if (!de) return json(cors, 400, { error: "Statut inconnu" });
          const d = await stock.demandes.passer(String(b.id || ""), de, b.statut, b.statut === "transmise" ? { transmise_at: maintenant().toISOString() } : {});
          if (!d) return json(cors, 409, { error: "Cette demande a changé entre-temps : actualisez la liste." });
          journal({ evt: "admin", action: "demande_statut", demande: d.id, code: b.statut });
          return json(cors, 200, { ok: true });
        }
        case "reglages": {
          const { valeur, erreurs } = verifierReglages(b.valeur);
          if (erreurs.length) return json(cors, 400, { error: erreurs.join(" "), erreurs });
          const res = await stock.reglages.ecrire(valeur, b.base || null);
          if (res.conflit) return json(cors, 409, { conflit: true, valeur: fusionnerReglages(res.valeur), updated_at: res.updated_at });
          oublierReglages(stock);
          journal({ evt: "admin", action: "reglages", code: "ok" });
          return json(cors, 200, { ok: true, updated_at: res.updated_at });
        }
        default: return json(cors, 400, { error: "Action inconnue" });
      }
    } catch (e) {
      journal({ evt: "admin", code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      return json(cors, e?.code === "configuration" ? 503 : 500, { error: e?.code === "configuration" ? e.message : "Erreur du serveur : réessayez." });
    }
  };
}

export const handler = creerHandler();
