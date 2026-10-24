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
// des paliers comme ça ») : seuils sur une piste, quantité en cours, pointillés jusqu'au palier suivant, incitation avec le
// prix unitaire et tableau du détail. Charte Elixir (sarcelle, or des remises, Inter), rien du site d'origine.
// Affichage seulement : tout prix montré est celui d'applyTiers (celui que le panier facture) ; le clic sur un palier passe
// par la fonction de quantité de l'appelant (setQty, applyQty, setItemQty, Saisie), avec une quantité au pas du colis.
// Remise : sur le prix catalogue de la ligne (pv, list_price), comme le badge de remise et le pct des paliers en base
// (odoo-price-sync : 1 − prix / list_price) ; toujours écrite à côté du prix unitaire (revue : le % seul grossissait un gain
// de quelques centimes). Économie : gain total au palier par rapport au prix de la première quantité commandable.
const arrondi = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// → null (aucune étape à viser : l'appelant garde le petit badge) ou { q, base, ref, depart: { qte, prix, pct }, prix, pct,
// etapes: [{ seuil, qte, prix, pct, economie }], atteinte, prochaine, manque }.
// qte : quantité qui partira au panier (déjà arrondie au colis par l'appelant) ; pas / min : règle de la ligne ; max : plafond.
// Étape (revue du 22/10) : plus petite quantité commandable qui atteint le seuil (qte : au pas, au minimum) et prix d'applyTiers
// À CETTE quantité (celui du clic). Pas d'étape pour un palier déjà atteint par la première quantité commandable (colis Stratège
// de 160 et palier à 160 : palier inévitable), ni au même prix ou à la même quantité que la précédente, ni au-delà du plafond.
export function jaugePaliers({ base, pv, tiers, qte, pas = 1, min = 0, max = null }) {
  const b = Number(base);
  if (!(b > 0) || !Array.isArray(tiers)) return null;
  const q = Math.max(0, parseInt(qte) || 0);
  const ref = Number(pv) > b ? Number(pv) : b;
  const remise = (prix) => { const r = (1 - prix / ref) * 100; return arrondi(r, r < 0.05 ? 2 : 1); };
  const m = pas > 1 ? pas : 1, premiere = Math.max(min > 0 ? min : 0, m), depart = applyTiers(b, tiers, premiere).pn;
  const etapes = [];
  let prec = { qte: premiere, prix: depart };
  for (const seuil of [...new Set(tiers.filter(t => t && t.min_qty >= 2 && t.price > 0 && t.price < b).map(t => t.min_qty))].sort((x, y) => x - y)) {
    const qc = Math.max(premiere, Math.ceil(seuil / m) * m), prix = applyTiers(b, tiers, qc).pn;
    if (qc <= prec.qte || Math.abs(prix - prec.prix) < 1e-9 || (max != null && qc > max)) continue;
    etapes.push(prec = { seuil, qte: qc, prix, pct: remise(prix), economie: arrondi((depart - prix) * qc) });
  }
  if (!etapes.length) return null;
  const prix = applyTiers(b, tiers, q).pn, prochaine = etapes.find(e => e.seuil > q && e.prix < prix) || null;
  return { q, base: b, ref, depart: { qte: premiere, prix: depart, pct: depart < ref ? remise(depart) : 0 }, prix, pct: remise(prix), etapes,
    atteinte: etapes.filter(e => e.seuil <= q).pop() || null, prochaine, manque: prochaine ? prochaine.qte - q : 0 };
}

// Étapes posées sur la piste (revue : étiquettes qui se chevauchaient) : n au plus — mini 1, compacte 2, complète 3 —, à partir
// du palier atteint (sinon de la prochaine) ; au meilleur prix, les dernières jusqu'au palier atteint. Toutes au détail.
export function vuesJauge(j, n) {
  const k = j.etapes.length, i = j.prochaine ? j.etapes.indexOf(j.prochaine) - (n > 1 && j.atteinte ? 1 : 0)
    : (j.atteinte ? j.etapes.indexOf(j.atteinte) : k - 1) - n + 1;
  const s = Math.max(0, Math.min(i, k - n));
  return j.etapes.slice(s, s + n);
}

// Position (en %) d'une quantité sur la piste : étapes (à leur quantité commandable) à intervalles réguliers, la dernière à
// 84 % (place pour son étiquette), linéaire entre deux étapes, au-delà de la dernière jusqu'à 100 % (une fois et demie).
export function positionJauge(etapes, q) {
  const n = etapes.length, xs = [0, ...etapes.map((e, i) => 84 * (i + 1) / n)], qs = [0, ...etapes.map(e => e.qte)];
  for (let i = 1; i <= n; i++) if (q <= qs[i]) return xs[i - 1] + (xs[i] - xs[i - 1]) * (q - qs[i - 1]) / (qs[i] - qs[i - 1]);
  return Math.min(100, 84 + 16 * (q - qs[n]) / (qs[n] / 2));
}

// ── Curseur à glisser (24/10/2026 ; Zineb : « je voudrais pouvoir bouger le curseur pour augmenter la quantité à commander ») ──
// Quantité sous le doigt : réciproque de positionJauge (x en % de la piste), aimantée à une étape à 2 % près (le prix change au
// palier : le viser ne doit pas se jouer à une unité près), puis bornée par borneJauge. Bout de la piste : une fois et demie la
// dernière étape montrée, comme positionJauge.
export function quantiteJauge(etapes, x, regle = {}) {
  const n = etapes.length, xs = [0, ...etapes.map((e, i) => 84 * (i + 1) / n)], qs = [0, ...etapes.map(e => e.qte)];
  const v = Math.max(0, Math.min(100, x)), m = regle.pas > 1 ? regle.pas : 1, bout = Math.floor(qs[n] * 1.5 / m) * m;
  const aimant = etapes.find((e, i) => Math.abs(xs[i + 1] - v) <= 2);
  if (aimant) return borneJauge(aimant.qte, regle);
  let i = 1;
  while (i <= n && v > xs[i]) i++;
  const brut = i <= n ? qs[i - 1] + (qs[i] - qs[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1]) : qs[n] + (qs[n] / 2) * (v - 84) / 16;
  return borneJauge(Math.min(bout, Math.round(brut / m) * m), regle, brut);
}

// Quantité commandable la plus proche, comme les fonctions de quantité des appelants (setQty, applyQty : au pas, puis au
// minimum ; sous la moitié du minimum, 0), au plus le plafond (péremption, justificatif), au moins plancher (Saisie : déjà au panier).
export function borneJauge(q, { pas = 1, min = 0, max = null, plancher = 0 } = {}, brut = q) {
  const m = pas > 1 ? pas : 1;
  let r = Math.round(q / m) * m;
  if (r > 0 && min > 0 && r < min) r = brut < min / 2 ? 0 : min;
  if (max != null && r > max) r = Math.floor(max / m) * m;
  return Math.max(plancher, r);
}

// Clavier du curseur (role="slider") : flèches d'un colis (« + » de la Saisie : au minimum d'abord), Pages d'un palier à l'autre,
// Début / Fin : plancher et dernier palier (jamais en arrière). → quantité, ou null pour une autre touche.
export function toucheJauge(j, touche, regle = {}) {
  const { pas = 1, min = 0, plancher = 0 } = regle, m = pas > 1 ? pas : 1, q = j.q, plus = q < min ? min : q + m, moins = q - m < min ? 0 : q - m;
  const n = { ArrowRight: plus, ArrowUp: plus, ArrowLeft: moins, ArrowDown: moins,
    PageUp: (j.etapes.find(e => e.qte > q) || { qte: q }).qte, PageDown: ([...j.etapes].reverse().find(e => e.qte < q) || { qte: plancher }).qte,
    Home: plancher, End: Math.max(q, j.etapes[j.etapes.length - 1].qte) }[touche];
  return n == null ? null : borneJauge(n, regle);
}

// Incitation, en toutes lettres (titre, tests) : prix unitaire et remise ; « Dès N » tant que rien n'est commandé (revue : « Plus
// que 20 » sonnait faux à 0), « Plus que N pour … » ensuite, « Prix palier appliqué » au meilleur prix. Le composant est dans
// src/components/JaugePaliers.jsx : ce fichier reste sans icônes ni rendu (des tests l'empaquettent sans React).
const prixU = (e) => `${fmtEur(e.prix)} HT l'unité (${fmtPct(e.pct)})`;
export const texteJauge = (j) => !j.prochaine ? `Prix palier appliqué : ${prixU(j)}`
  : j.q > 0 ? `Plus que ${j.manque} pour ${prixU(j.prochaine)}` : `Dès ${j.prochaine.qte} : ${prixU(j.prochaine)}`;
