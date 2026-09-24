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

// Badge « 1,60 € dès 60 » affiché à côté d'un prix unitaire.
export function TierBadge({ tiers, pn, compact }) {
  const list = Array.isArray(tiers) ? tiers.filter(t => t && t.price > 0 && (pn == null || t.price < pn)) : [];
  if (!list.length) return null;
  const t = list[0];
  return (
    <span title={list.map(x => `${eur(x.price)} dès ${x.min_qty} unités`).join(" · ")}
      style={{ display: "inline-block", marginLeft: compact ? 4 : 6, fontSize: 10, fontWeight: 700, color: "#92400e",
               background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4, padding: "1px 5px",
               whiteSpace: "nowrap", verticalAlign: "middle" }}>
      {eur(t.price)} dès {t.min_qty}
    </span>
  );
}
