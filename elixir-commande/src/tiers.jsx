import React from "react";
// ── Paliers de quantité (liste de prix Odoo #5, colonne odoo_catalog.price_tiers) ──
// tiers = [{ min_qty, price, pct }] triés par seuil croissant, tous < prix unitaire.

const eur = (n) => Number(n).toFixed(2).replace(".", ",") + " €";

// Prix unitaire applicable pour une quantité : le palier atteint le plus élevé
// (comme Odoo, qui prend la règle de plus grande quantité minimale satisfaite),
// et le prochain palier à viser pour l'incitation.
export function applyTiers(basePn, tiers, qty) {
  const list = Array.isArray(tiers) ? tiers.filter(t => t && t.min_qty >= 2 && t.price > 0) : [];
  if (!list.length || basePn == null) return { pn: basePn, tier: null, next: null };
  const reached = list.filter(t => qty >= t.min_qty && t.price < basePn).sort((a, b) => b.min_qty - a.min_qty)[0] || null;
  const pn = reached ? reached.price : basePn;
  const next = list.filter(t => t.min_qty > qty && t.price < pn).sort((a, b) => a.min_qty - b.min_qty)[0] || null;
  return { pn, tier: reached, next };
}

// Refonte charte (lot 4) : ton « tier » de src/theme.js (fond or en teinte, texte encre, filet or). Import placé
// ici et non en tête : le haut du fichier (jusqu'à applyTiers) est une zone protégée (scripts/verifie-zones.mjs).
// Les import sont remontés par le module : l'emplacement ne change rien à l'exécution.
import { tone, R, fmtEur } from "./theme.js";
const TON_PALIER = tone("tier");
// Lot 8 : montants du badge au format français commun (fmtEur : « 1 234,50 € », espace insécable avant €), affichage
// seulement. L'ancien « eur » du haut du fichier est laissé tel quel (zone protégée) mais ne sert plus.

// Badge « 1,60 € dès 60 » affiché à côté d'un prix unitaire ; « bloc » : sous le prix, calé à droite (colonnes
// de prix des tableaux : la colonne ne s'élargit plus pour le badge, la largeur va à la désignation).
export function TierBadge({ tiers, pn, compact, bloc }) {
  const list = Array.isArray(tiers) ? tiers.filter(t => t && t.price > 0 && (pn == null || t.price < pn)) : [];
  if (!list.length) return null;
  const t = list[0];
  return (
    <span title={list.map(x => `${fmtEur(x.price)} dès ${x.min_qty} unités`).join(" · ")}
      style={{ display: bloc ? "table" : "inline-block", margin: bloc ? "3px 0 0 auto" : `0 0 0 ${compact ? 4 : 6}px`, fontSize: 11, fontWeight: 700, lineHeight: 1.35, color: TON_PALIER.fg,
               background: TON_PALIER.bg, border: `1px solid ${TON_PALIER.border}`, borderRadius: R.pill, padding: "0 6px",
               whiteSpace: "nowrap", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" }}>
      {fmtEur(t.price)} dès {t.min_qty}
    </span>
  );
}
