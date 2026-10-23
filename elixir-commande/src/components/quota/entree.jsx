// ── Contingentement dans la ligne de l'article (docs/contingentement-ligne.md) : seule partie du bundle des pharmacies ──
// App fournit le contexte (liste des produits contingentés, reste lu par quota-status, panier, lecture à la demande) ;
// la pastille et ses textes (PastilleQuota.jsx, src/quota-ligne.js) sont chargés EN MÊME TEMPS que la liste (App attend les
// deux) : la pastille s'affiche au premier rendu, sans attente ni saut. Échec du chargement (connexion, nouvelle version en
// ligne) : rien jusqu'au nouvel essai d'App (2 min) — le panier contrôle toujours.
import React, { createContext, useContext } from "react";

export const ContexteQuota = createContext(null);
let Pastille = null;
// → true une fois chargée, false en échec (App réessaie avec la liste)
export const chargerPastille = () => import("./PastilleQuota.jsx").then(m => !!(Pastille = m.default), () => false);

// <Quota cip={…} saisie={quantité qui partira, pas encore au panier} tape={quantité tapée} pas={colis, lot} forme="moyenne"|"courte" as="li" />
export function Quota(props) {
  const c = useContext(ContexteQuota);
  return Pastille && c?.liste?.[props.cip] ? <Pastille {...props} c={c} /> : null;
}

// Paliers de prix à montrer (jauge, badge) : ceux qu'on peut encore atteindre sans dépasser le reste du contingentement — la
// ligne (quantité `base`, déjà comptée au panier) peut monter jusqu'à base + reste − panier ; au pas du colis. Reste pas lu,
// produit non contingenté, pharmacie dispensée : paliers inchangés. Affichage seulement (le panier facture applyTiers).
export function tiersQuota(c, cip, tiers, base, pas) {
  const q = c?.liste?.[cip] && c.quota?.products?.[cip], m = pas > 1 ? pas : 1;
  if (!q || !Array.isArray(tiers)) return tiers;
  const max = base + Math.max(0, q.remaining - (c.check?.inCart?.[cip] || 0));
  return tiers.filter(t => Math.ceil(t.min_qty / m) * m <= max);
}
