// ── API des pharmacies : calcul des prix d'UNE liste de prix (fonction d'arrière-plan, 15 min au plus) ──
// Lancée par api-cron.js (la nuit, ou dans le quart d'heure qui suit une demande) et par l'admin (onglet 🔌 API,
// « Recalculer ») avec x-cron-secret, comme push-admin → push-envoi-background. POST { liste_id }.
//   1. prise de la liste par une écriture conditionnelle (api_prix_listes : pas de double calcul ; un calcul coupé est repris
//      après 20 min) ;
//   2. catalogue du site (odoo_catalog, tous les CIP13) ; prix demandés à Odoo par son rapport de liste de prix (MIN des
//      règles, comme la facture), quantité 1 puis chaque palier de la liste (_api-prix.js), lots de 60, appels l'un après
//      l'autre (charge d'Odoo bornée), arrêt propre avant 13 min ;
//   3. api_prix réécrite pour cette liste, lignes des produits sortis du catalogue supprimées (seulement après un calcul
//      complet) ; état « pret » (ou « erreur », message court sans donnée).
// Lectures Odoo seulement. Aucune autre table que api_prix et api_prix_listes n'est écrite.
import { isCronAuthorized } from "./auth.js";
import { creerStockApi } from "./_api-stock.js";
import { calculerListe, lecteurOdoo } from "./_api-prix.js";
import { jourParis } from "./_api-config.js";

// deps (doublures des tests) : autoriser, stock, odoo, maintenant, horloge, journal, budgetMs
export function creerHandler(deps = {}) {
  const journal = deps.journal || ((o) => console.log(JSON.stringify({ fn: "api-prix-background", ...o })));
  const maintenant = deps.maintenant || (() => new Date());
  return async (event) => {
    if (!(deps.autoriser || isCronAuthorized)(event)) return { statusCode: 403, body: "" };
    let listeId = null;
    try { listeId = Number(JSON.parse(event.body || "{}").liste_id); } catch { /* corps illisible */ }
    if (!Number.isInteger(listeId) || listeId <= 0) return { statusCode: 400, body: "" };
    const stock = deps.stock || creerStockApi();
    const pris = await stock.prixListes.commencer(listeId).catch((e) => { journal({ code: "prise", liste: listeId, erreur: String(e?.message || e).slice(0, 120) }); return null; });
    if (!pris) { journal({ code: "deja_en_cours", liste: listeId }); return { statusCode: 200, body: "" }; }
    const debut = maintenant().toISOString();
    try {
      const catalogue = await stock.catalogue.pourPrix();
      const r = await calculerListe({ listeId, catalogue, lire: lecteurOdoo(deps.odoo), jour: jourParis(maintenant()), horloge: deps.horloge, budgetMs: deps.budgetMs });
      const calcule_le = maintenant().toISOString();
      await stock.prix.ecrire(r.lignes.map(l => ({ liste_id: listeId, cip: l.cip, prix_ht: l.prix_ht, paliers: l.paliers, calcule_le })));
      if (!r.tronque) await stock.prix.purger(listeId, debut);
      await stock.prixListes.terminer(listeId, { etat: r.tronque ? "erreur" : "pret", fin_le: calcule_le, produits: r.produits, sans_prix: r.sans_prix, appels: r.appels,
        erreur: r.tronque ? "calcul interrompu (temps dépassé) : prix partiels, nouvel essai au prochain passage" : null });
      journal({ code: r.tronque ? "tronque" : "ok", liste: listeId, produits: r.produits, sans_prix: r.sans_prix, appels: r.appels });
    } catch (e) {
      const message = e?.code === "liste_introuvable" ? "liste de prix introuvable dans Odoo" : e?.code === "schema" ? "tables de l'API absentes (sql/api-schema.sql)"
        : "calcul impossible (Odoo ou base injoignable) : nouvel essai au prochain passage";
      journal({ code: "erreur", liste: listeId, erreur: String(e?.message || e).slice(0, 160) });
      await stock.prixListes.terminer(listeId, { etat: "erreur", fin_le: maintenant().toISOString(), erreur: message }).catch(() => {});
    }
    return { statusCode: 200, body: "" };
  };
}

export const handler = creerHandler();
