// ── API des pharmacies : parcours de test (conception § 9) ──
// Une clé de production (elx_live_) ne se crée qu'après le test validé (api_acces.test_valide_le). Il est posé ici, sans
// intervention d'Elixir, quand une clé de TEST de la pharmacie a réussi les six étapes :
//   etat (GET /v1/etat), simulation (POST /v1/commandes/simulation), commande (POST /v1/commandes, 201),
//   relecture (GET /v1/commandes/{T…}), annulation (DELETE /v1/commandes/{T…}), rejeu (même Idempotency-Key →
//   Idempotent-Replayed). L'admin peut toujours passer outre (« Valider le test », tracé).
// Rien n'est noté sur un hôte d'aperçu (une clé de production y est traitée comme une clé de test) ni pour une clé de
// production. La colonne api_acces.test_parcours est lue et écrite à part : tant que sql/api-schema.sql n'est pas rejoué,
// l'écriture échoue sans effet sur la réponse.
export const ETAPES_TEST = ["etat", "simulation", "commande", "relecture", "annulation", "rejeu"];
export const LIBELLES_ETAPES = {
  etat: "Tester la connexion (GET /v1/etat)", simulation: "Simuler une commande (POST /v1/commandes/simulation)",
  commande: "Passer une commande de test (POST /v1/commandes)", relecture: "Relire son état (GET /v1/commandes/{id})",
  annulation: "L'annuler pendant le délai (DELETE /v1/commandes/{id})", rejeu: "Renvoyer la même commande avec la même Idempotency-Key (réponse rejouée, sans doublon)",
};
// étapes vues par la pharmacie (« Accès API ») → [{ etape, libelle, faite }] ; null si la colonne n'existe pas encore
export async function parcoursPublic(stock, odooId) {
  try {
    const p = await stock.acces.parcours(odooId);
    if (!p) return null;
    return ETAPES_TEST.map(e => ({ etape: e, libelle: LIBELLES_ETAPES[e], faite: !!p.etapes?.[e] }));
  } catch { return null; }
}
const vus = new Map();   // fiche → étapes déjà notées (par instance : épargne la base)

export async function noterParcours({ stock, acces, cle, environnement, apercu, maintenant }, etape) {
  if (!ETAPES_TEST.includes(etape) || environnement !== "test" || apercu || cle?.environnement !== "test" || acces?.test_valide_le) return null;
  const k = acces.odoo_id;
  if (vus.get(k)?.has(etape)) return null;
  try {
    const p = await stock.acces.parcours(k);
    if (!p || p.test_valide_le) { vus.set(k, new Set(ETAPES_TEST)); return null; }
    const etapes = { ...p.etapes };
    if (!etapes[etape]) etapes[etape] = maintenant.toISOString();
    const complet = ETAPES_TEST.every(e => etapes[e]);
    const valide = await stock.acces.noterParcours(k, etapes, complet ? maintenant.toISOString() : null, complet ? `parcours de test (clé ${cle.prefixe})` : null);
    if (vus.size > 5000) vus.clear();
    vus.set(k, new Set(Object.keys(etapes)));
    if (complet && valide) {
      await stock.evenements.ajouter({ type: "test_valide", odoo_id: k, cle_id: cle.id, par: cle.prefixe, role: "systeme", detail: { etapes } }).catch(() => {});
      return "valide";
    }
    return "note";
  } catch {
    return null;   // colonne absente ou base injoignable : la réponse n'en dépend jamais
  }
}
