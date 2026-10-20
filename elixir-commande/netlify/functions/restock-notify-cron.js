// ── Alertes « M'avertir du retour » : passage planifié (netlify.toml, « 50 */3 * * * », heure UTC) ──
// 50 min après chaque synchro rapide du stock de la GitHub Action (« 0 */3 * * * ») : celle-ci appelle déjà
// restock-notify à la fin de ses étapes de stock (en général vers h:10 – h:30, GitHub démarrant souvent en retard) ;
// ce passage est le filet (Action en échec, en retard, reste laissé par ses 4 s de travail par appel, synchro lancée
// depuis l'admin). Envois entre 7 h et 21 h, heure de Paris, et seulement une fois les envois automatiques activés dans
// l'admin ; sinon seules les clôtures sont faites (demandes trop anciennes, adresses plus rattachées).
// Logique : _restock.js. Fonction planifiée : 30 s au plus → passage (nouvelles opérations jusqu'à 15 s, aucune au-delà
// de 20 s), puis copie des groupes d'articles sous plusieurs CIP (Odoo, une fois par jour, 6 s au plus), puis ménage.
import { passage, menageJournal, chiffres, rafraichirGroupes } from "./_restock.js";

const DELAI_GROUPES_MS = 6000;

export function creerHandler(deps = {}) {
  const { chargerGroupes, ...opts } = deps;
  return async () => {
    try {
      const b = await passage({ source: "planifie", budgetMs: 15000, limiteMs: 20000, ...opts });
      let minuterie;
      await Promise.race([
        rafraichirGroupes({ ...(chargerGroupes ? { charger: chargerGroupes } : {}), ...(opts.maintenant ? { maintenant: opts.maintenant() } : {}) }),
        new Promise((_, non) => { minuterie = setTimeout(() => non(new Error("délai dépassé")), DELAI_GROUPES_MS); }),
      ]).catch(e => console.error("[restock-notify-cron] groupes d'articles (plusieurs CIP) non rafraîchis :", e?.message || e))
        .finally(() => clearTimeout(minuterie));
      await menageJournal().catch(e => console.error("[restock-notify-cron] ménage du journal", e.message));
      return { statusCode: 200, body: JSON.stringify(chiffres(b)) };
    } catch (e) {
      console.error("[restock-notify-cron]", e?.message || e);
      return { statusCode: 500, body: "" };
    }
  };
}

export const handler = creerHandler();
