// ── Accueil « La Tête de gondole » : classement planifié (netlify.toml, toutes les 3 h de 6 h 40 à 21 h 40) ──
// Produits les plus commandés (commandes servies, 15 jours, société Elixir), règle de _accueil-selection.js, lectures
// Odoo seules (_accueil-donnees.js). Écrit kv « accueil:offres » (diapositives et réserves) et « accueil:dernier_passage »
// (journal). Odoo injoignable, erreur ou classement vide : le cache précédent est GARDÉ (jamais écrasé), seul le journal
// est écrit ; le GET le déclare périmé au-delà de 36 h (vitrine masquée, accueil sans erreur).
import { creerSources, calculerClassement, CLE_CACHE, CLE_JOURNAL } from "./_accueil-donnees.js";

export function creerHandler(deps = {}) {
  return async () => {
    const src = creerSources(deps, { delaiOdoo: 8000 });   // 8 s par appel : le catch écrit le journal avant la limite de 30 s
    const journal = [];
    const debut = src.maintenant();
    try {
      const { cache, journal: exclus } = await calculerClassement(src);
      if (!cache.slides.length) journal.push("Aucune diapositive après la règle : cache précédent conservé");
      else {
        await src.kvSet(CLE_CACHE, cache);
        journal.push(`${cache.slides.length} diapositive(s), ${cache.reserves.length} réserve(s) : ${cache.slides.map(d => d.famille).join(", ")}`);
      }
      journal.push(...exclus.slice(0, 40).map(x => `écarté ${x}`));
    } catch (e) {
      journal.push(`Erreur (cache précédent conservé) : ${String(e?.message || e).slice(0, 300)}`);
    }
    journal.push(`durée ${Math.round((src.maintenant() - debut) / 100) / 10} s`);
    await src.kvSet(CLE_JOURNAL, { at: new Date(debut).toISOString(), journal }).catch(() => {});
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
