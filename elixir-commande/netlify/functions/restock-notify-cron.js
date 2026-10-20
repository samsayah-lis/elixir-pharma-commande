// ── Alertes « M'avertir du retour » : passage planifié (netlify.toml, « 50 */3 * * * », heure UTC) ──
// 50 min après chaque synchro rapide du stock de la GitHub Action (« 0 */3 * * * ») : celle-ci appelle déjà
// restock-notify à la fin de ses étapes de stock (en général vers h:10 – h:30, GitHub démarrant souvent en retard) ;
// ce passage est le filet (Action en échec, en retard, reste laissé par ses 5 s de travail par appel, synchro lancée
// depuis l'admin). Envois entre 7 h et 21 h, heure de Paris ; hors de cette fenêtre, seules les clôtures sont faites
// (demandes de plus de 60 jours, adresses plus rattachées) et les e-mails partent au premier passage du matin.
// Logique : _restock.js ; 20 s de travail (fonction planifiée : 30 s au plus).
import { passage, menageJournal, chiffres } from "./_restock.js";

export function creerHandler(deps = {}) {
  return async () => {
    try {
      const b = await passage({ source: "planifie", budgetMs: 20000, ...deps });
      await menageJournal().catch(e => console.error("[restock-notify-cron] ménage du journal", e.message));
      return { statusCode: 200, body: JSON.stringify(chiffres(b)) };
    } catch (e) {
      console.error("[restock-notify-cron]", e?.message || e);
      return { statusCode: 500, body: "" };
    }
  };
}

export const handler = creerHandler();
