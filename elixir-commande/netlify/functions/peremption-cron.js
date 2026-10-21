// ── Péremption courte : filet (fonction planifiée Netlify, netlify.toml « 10,25,40,55 * * * * ») ──
// À h:25 : filet complet. Décisions ouvertes seulement : faits frais (stock et dates, sans le rapport des prix), retraits A
// et B (date de fin proche, stock court épuisé, lot long reçu), baisses de remise en attente, prix habituel remis aux
// produits en retrait et aux remises retirées depuis 24 h, règles orphelines, réservations à adopter. Aucune création de
// décision. Aux autres quarts d'heure : seulement s'il reste des retraits immédiats (« Tout retirer », « tout de suite »)
// que le navigateur n'a pas finis. Pourquoi : la chaîne de nuit (GitHub Action) part avec plusieurs heures de retard, le
// respect de date_end par Odoo reste à prouver (essai T1), et « Tout retirer » doit finir même navigateur fermé.
// Mode « Simulation » (défaut) : plan journalisé, aucune écriture Odoo (docs/peremption-odoo.md).
// Erreur : seule l'absence d'installation (tables, clé) est tue ; toute autre erreur laisse le passage « erreur » (bandeau
// de l'admin) et une alerte au journal (e-mail si les verrous sont ouverts, une par jour).
import { creerPeremption } from "./_peremption.js";

const nonInstalle = (e) => e?.code === "configuration" || e?.pg === "42P01";

export async function filet({ peremption = creerPeremption(), maintenant = Date.now() } = {}) {
  const minute = new Date(maintenant).getUTCMinutes();
  const complet = minute >= 20 && minute < 35;
  try {
    if (!complet) {
      const immediats = (await peremption.sb("peremption_decisions?statut=eq.retrait_demande&retrait_immediat=eq.true&select=cip&limit=500")) || [];
      if (!immediats.length) return { rien: true };
      return await peremption.reconcilier({ acteur: "filet", etendue: "filet", budgetMs: 20000, cips: [...new Set(immediats.map(d => d.cip))] });
    }
    return await peremption.reconcilier({ acteur: "filet", etendue: "filet", budgetMs: 20000 });
  } catch (e) {
    if (nonInstalle(e)) return { non_installe: true };
    await peremption.signalerEchec(e, "filet").catch(() => {});
    return { erreur: String(e?.message || e).slice(0, 300) };
  }
}

export const handler = async () => {
  const r = await filet();
  console.log("[peremption-cron]", JSON.stringify({ passage: r.passage_id || null, fini: r.fini ?? null, executes: r.curseur ?? null, total: r.total ?? null,
    disjoncteur: r.disjoncteur || null, verrou: r.verrou?.acteur || null, rien: !!r.rien, non_installe: !!r.non_installe, erreur: r.erreur || null }));
  return { statusCode: r.erreur ? 500 : 200, body: r.erreur ? "erreur" : "ok" };
};
