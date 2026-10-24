// ── API des pharmacies : passage planifié des commandes (netlify.toml, toutes les 2 min) ──
//  1. commandes réelles dont le délai d'annulation est écoulé (api_commandes « recue », envoi_apres passé) : chacune est
//     confiée à api-envoi-background (x-cron-secret), qui la prend par une transition conditionnelle (un seul envoi) ;
//  2. réservations restées « en_cours » plus de 10 min (fonction coupée, client qui n'a pas rejoué la requête) :
//       - rien de préparé → supprimée (la même Idempotency-Key repart de zéro) ;
//       - commande de test préparée → terminée comme prévu ;
//       - commande réelle préparée et bien enregistrée dans elixir_orders → terminée « à vérifier » (motif reprise : Elixir
//         confirme avec la pharmacie) ; préparée mais absente → supprimée (rien n'a été enregistré) ;
//     envois restés « envoi_demande » plus de 20 min (fonction d'arrière-plan coupée) → « à vérifier » (envoi_a_verifier) :
//     l'état du relais (onglet Commandes) dit ce qui est parti.
// Lectures et écritures dans api_commandes seulement (et lecture d'elixir_orders) ; aucune lecture Odoo.
import { creerStockApi } from "./_api-stock.js";
import { siteBaseEnv } from "./_api-http.js";

const lireJson = (t, d) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return d; } };
const RESERVATION_MS = 10 * 60e3, ENVOI_MS = 20 * 60e3;

// Lancement de l'envoi d'une commande (api-envoi-background) → null si parti, sinon la raison
export async function lancerEnvoi(base, id, { secret = process.env.CRON_SECRET, http = (...a) => fetch(...a) } = {}) {
  if (!secret) return "CRON_SECRET absent";
  try {
    const r = await http(`${base}/.netlify/functions/api-envoi-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ id }), signal: AbortSignal.timeout(6000) });
    return r.ok || r.status === 202 ? null : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "délai dépassé" : "injoignable";
  }
}

// deps (doublures des tests) : stock, maintenant, lancer(id), journal
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-commandes-cron", ...o })));
  const maintenant = deps.maintenant || (() => new Date());
  return async () => {
    const stock = deps.stock || creerStockApi();
    const now = maintenant();
    const bilan = { lancees: 0, echecs: 0, reprises: 0, liberees: 0, envois_a_verifier: 0 };
    try {
      // 1. envois dus, lancés par paquets de 5 (une fonction planifiée est coupée à 30 s ; un lancement rend 202 aussitôt)
      const dues = await stock.commandes.dues(now.toISOString(), 20);
      for (let k = 0; k < dues.length; k += 5) {
        const issues = await Promise.all(dues.slice(k, k + 5).map(async (c) => [c, await (deps.lancer ? deps.lancer(c.id) : lancerEnvoi(siteBaseEnv(), c.id))]));
        for (const [c, raison] of issues) { if (raison) { bilan.echecs++; journal({ code: "lancement", id: c.id, raison }); } else bilan.lancees++; }
      }
      // 2. en suspens
      for (const c of await stock.commandes.enSuspens(new Date(now.getTime() - RESERVATION_MS).toISOString())) {
        if (c.etat === "envoi_demande") {
          if (now.getTime() - Date.parse(c.updated_at) < ENVOI_MS) continue;
          if (await stock.commandes.ecrire(c, { etat: "a_verifier", motif: "envoi_a_verifier", envoi_resultat: "fonction d'envoi interrompue : vérifier l'état du relais" })) bilan.envois_a_verifier++;
          continue;
        }
        const corps = lireJson(c.reponse, null);
        const prepare = c.order_id && corps?.id === c.order_id;
        if (prepare && c.test) {
          const garde = corps.etat === "en_attente_elixir";
          if (await stock.commandes.ecrire(c, { etat: garde ? "a_verifier" : "recue", motif: garde ? corps.motif : null, statut_http: 201, reponse: c.reponse,
            envoi_apres: garde || !corps.annulable_jusqu_a ? null : new Date(Date.parse(corps.annulable_jusqu_a)).toISOString() })) bilan.reprises++;
          continue;
        }
        const enregistree = prepare && !c.test ? await stock.site.lire(c.order_id) : null;
        if (enregistree && enregistree.source === "api") {
          if (await stock.commandes.ecrire(c, { etat: "a_verifier", motif: "reprise", statut_http: 201, reponse: c.reponse,
            envoi_resultat: "réservation reprise par le passage planifié : à confirmer avec la pharmacie" })) bilan.reprises++;
          continue;
        }
        // rien d'enregistré : la réservation disparaît (conditionnelle : seulement si personne ne l'a reprise entre-temps)
        if (await stock.commandes.supprimerReservation(c)) bilan.liberees++;
      }
      journal({ code: "ok", ...bilan });
    } catch (e) {
      journal({ code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 160), ...bilan });
    }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
