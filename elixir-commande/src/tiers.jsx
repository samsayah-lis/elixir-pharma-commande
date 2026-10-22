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
import { tone, R, fmtEur, fmtPct } from "./theme.js";
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

// ── Jauge des paliers (22/10/2026 ; Zineb, capture d'un autre site de commande : « est ce que tu peux presenter la partie
// des paliers comme ça ») : seuils sur une piste, quantité en cours, pointillés jusqu'au palier suivant, « Plus que N pour
// bénéficier de −X % » et tableau du détail. Charte Elixir (sarcelle, or des remises, Inter), rien du site d'origine.
// Affichage seulement : tout prix montré est celui d'applyTiers pour la quantité (celui que le panier facture) ; le clic
// sur un palier passe par la fonction de quantité de l'appelant (setQty, setItemQty, quantité de la Saisie arrondie à
// l'ajout), avec une quantité déjà au pas du colis et au minimum.
// Remise : sur le prix de base affiché sur la ligne (prix catalogue barré : pv, list_price), comme le badge de remise de
// la ligne et le pct des paliers en base (odoo-price-sync : 1 − prix / list_price) ; sans prix de base plus élevé, sur le
// prix sans palier. Économie : par rapport au prix sans palier, pour la quantité du palier.
const arrondi = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// → null (aucun palier utile) ou { q, base, ref, pctBase, prix, pct, etapes: [{ seuil, qte, prix, pct, economie }],
// atteinte, prochaine, manque }. pas / min : règle de quantité de la ligne (colis, minimum) ; max : plafond (péremption).
// Étapes : seuils où le prix d'applyTiers change (deux paliers au même prix n'en font qu'une), plafond respecté.
export function jaugePaliers({ base, pv, tiers, qte, pas = 1, min = 0, max = null }) {
  const b = Number(base);
  if (!(b > 0) || !Array.isArray(tiers)) return null;
  const q = Math.max(0, parseInt(qte) || 0);
  const ref = Number(pv) > b ? Number(pv) : b;
  const remise = (prix) => { const r = (1 - prix / ref) * 100; return arrondi(r, r < 0.05 ? 2 : 1); };
  const m = pas > 1 ? pas : 1;
  const seuils = [...new Set(tiers.filter(t => t && t.min_qty >= 2 && t.price > 0 && t.price < b).map(t => t.min_qty))].sort((x, y) => x - y);
  const etapes = [];
  let precedent = b;
  for (const seuil of seuils) {
    const prix = applyTiers(b, tiers, seuil).pn;
    const qc = Math.max(min > 0 ? min : 0, Math.ceil(seuil / m) * m);   // plus petite quantité commandable qui atteint le seuil
    if (Math.abs(prix - precedent) < 1e-9 || (max != null && qc > max)) continue;
    etapes.push({ seuil, qte: qc, prix, pct: remise(prix), economie: arrondi((b - applyTiers(b, tiers, qc).pn) * qc) });
    precedent = prix;
  }
  if (!etapes.length) return null;
  const prix = applyTiers(b, tiers, q).pn;
  const prochaine = etapes.find(e => e.seuil > q && e.prix < prix) || null;
  return { q, base: b, ref, pctBase: ref > b ? remise(b) : 0, prix, pct: remise(prix), etapes,
    atteinte: etapes.filter(e => e.seuil <= q).pop() || null, prochaine, manque: prochaine ? prochaine.qte - q : 0 };
}

// Position (en %) d'une quantité sur la piste : étapes à intervalles réguliers (la dernière à 84 %, place pour son
// étiquette), linéaire entre deux étapes, au-delà de la dernière jusqu'à 100 % (une fois et demie son seuil).
export function positionJauge(etapes, q) {
  const n = etapes.length, xs = [0, ...etapes.map((e, i) => 84 * (i + 1) / n)], qs = [0, ...etapes.map(e => e.seuil)];
  for (let i = 1; i <= n; i++) if (q <= qs[i]) return xs[i - 1] + (xs[i] - xs[i - 1]) * (q - qs[i - 1]) / (qs[i] - qs[i - 1]);
  return Math.min(100, 84 + 16 * (q - qs[n]) / (qs[n] / 2));
}

// Texte d'incitation (aussi lu par les lecteurs d'écran : zone aria-live). Le composant est dans
// src/components/JaugePaliers.jsx : ce fichier reste sans icônes ni rendu (des tests l'empaquettent sans React).
export const texteJauge = (j) => j.prochaine ? `Plus que ${j.manque} pour bénéficier de ${fmtPct(j.prochaine.pct)}` : `Meilleur prix atteint : ${fmtPct(j.pct)}`;
