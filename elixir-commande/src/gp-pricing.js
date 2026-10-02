// ── Moteur de prix des commandes groupées ───────────────────────────────
// Partagé entre l'écran (React) et les fonctions Netlify : les deux calculent
// exactement de la même façon.
//
// Conventions (décidées avec Zineb le 30/09/2026)
// - La pharmacie saisit des unités FACTURÉES. Les unités gratuites (UG) sont
//   calculées par le site et ajoutées : « 12 + 2 » = 2 offertes par tranche de
//   12 facturées, la pharmacie reçoit 14 unités et en paie 12.
// - Paliers de remise et d'UG évalués sur les unités facturées : total du groupe
//   (mode collectif) ou de la pharmacie (mode individuel).
// - Mode collectif : les UG obtenues par le groupe sont réparties entre les
//   pharmacies au prorata de leurs unités facturées, en unités entières, au plus
//   fort reste (aucune UG perdue). Puis, pour chaque pharmacie, entre ses dates de
//   livraison de la même façon.
// - Montant payé = unités facturées × prix après remise sur facture, RFA et
//   coopération, plus les frais de traitement (ce ne sont pas des remises).
// - Dans Odoo, une ligne porte les unités REÇUES (facturées + gratuites) au prix
//   brut, avec une remise sur facture unique qui redonne exactement ce montant.

export const IMMEDIATE_SLOT = "immediat";

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const sortTiers = (tiers, key = "min_qty") =>
  (Array.isArray(tiers) ? tiers : [])
    .map(t => ({ ...t, [key]: num(t[key]) }))
    .filter(t => t[key] > 0)
    .sort((a, b) => a[key] - b[key]);

// ── Remise sur facture : jusqu'à 3 remises par produit ─────────────────
// Remise 1 : colonnes discount_mode / discount_pct / discount_tiers.
// Remises 2 et 3 : extra_discounts = [{ mode, pct, tiers, combine }].
// Chaque remise est un taux fixe (« unitaire ») ou des paliers de quantité (« paliers »).
// Elles se combinent dans l'ordre 1, 2, 3 : « cascade » = appliquée sur le prix déjà
// remisé (30 % puis 10 % → 37 %) ; « additionnelle » = taux ajouté au cumul (30 % + 10 % → 40 %).
const DISCOUNT_MODES = ["aucune", "unitaire", "paliers"];
export function lineDiscounts(line) {
  const first = { mode: line.discount_mode, pct: line.discount_pct, tiers: line.discount_tiers, combine: null };
  const extra = (Array.isArray(line.extra_discounts) ? line.extra_discounts : []).slice(0, 2)
    .map(d => ({ mode: d?.mode, pct: d?.pct, tiers: d?.tiers, combine: d?.combine === "additionnelle" ? "additionnelle" : "cascade" }));
  return [first, ...extra];
}
function oneDiscount(d, basis) {
  const mode = DISCOUNT_MODES.includes(d.mode) ? d.mode : "aucune";
  if (mode === "unitaire") return { pct: Math.max(0, num(d.pct)), tier: null, next: null };
  if (mode !== "paliers") return { pct: 0, tier: null, next: null };
  const tiers = sortTiers(d.tiers).map(t => ({ min_qty: t.min_qty, pct: num(t.pct) }));
  const reached = tiers.filter(t => basis >= t.min_qty).pop() || null;
  const next = tiers.find(t => t.min_qty > basis && t.pct > (reached ? reached.pct : 0)) || null;
  return { pct: reached ? reached.pct : 0, tier: reached, next: next ? { ...next, missing: next.min_qty - basis } : null };
}
// Cumul des remises (en %), dans l'ordre
export function combineDiscounts(parts) {
  let total = 0;
  for (const p of parts) total = p.combine === "additionnelle" ? total + p.pct : total + p.pct - total * p.pct / 100;
  return Math.min(100, Math.max(0, total));
}
export function invoiceDiscount(line, basis) {
  const parts = lineDiscounts(line).map((d, i) => ({ rank: i + 1, combine: d.combine, ...oneDiscount(d, basis) }));
  const pct = combineDiscounts(parts);
  // prochain palier le plus proche (toutes remises confondues), avec la remise totale qu'il donnerait
  let next = null;
  for (const p of parts) {
    if (!p.next || (next && p.next.missing >= next.missing)) continue;
    const totalPct = combineDiscounts(parts.map(q => (q.rank === p.rank ? { ...q, pct: p.next.pct } : q)));
    if (totalPct > pct) next = { rank: p.rank, min_qty: p.next.min_qty, pct: p.next.pct, missing: p.next.missing, totalPct };
  }
  return { pct, parts, tier: parts[0].tier, next };
}

// ── Unités gratuites ────────────────────────────────────────────────────
// billed : unités facturées (du groupe en collectif). Meilleur palier = celui qui
// donne le plus d'UG ; « next » = prochain seuil qui en donne davantage.
export function ugFor(line, billed) {
  const b = Math.max(0, Math.floor(num(billed)));
  const tiers = sortTiers(line.ug_tiers).map(t => ({ min_qty: Math.floor(t.min_qty), free_qty: Math.floor(num(t.free_qty)) })).filter(t => t.min_qty > 0 && t.free_qty > 0);
  let best = null;
  for (const t of tiers) {
    if (b < t.min_qty) continue;
    const free = Math.floor(b / t.min_qty) * t.free_qty;
    if (!best || free > best.free) best = { ...t, free };
  }
  const current = best ? best.free : 0;
  let next = null;
  for (const t of tiers) {
    const at = (Math.floor(b / t.min_qty) + 1) * t.min_qty;
    const free = Math.floor(at / t.min_qty) * t.free_qty;
    if (free <= current) continue;
    if (!next || at < next.at || (at === next.at && free > next.free)) next = { ...t, at, free, missing: at - b, gain: free - current };
  }
  return { tier: best, free: current, next };
}
export const ugLabel = (t) => `${t.min_qty} + ${t.free_qty} UG : ${t.free_qty} offerte${t.free_qty > 1 ? "s" : ""} par tranche de ${t.min_qty} facturées`;

// ── Répartition entière au plus fort reste ─────────────────────────────
// entries : [{ key, weight }] → { key: entier } ; la somme vaut exactement total.
// Égalités départagées par poids décroissant puis clé croissante (même ordre partout).
export function splitInteger(total, entries) {
  const T = Math.max(0, Math.floor(num(total)));
  const list = (entries || []).map(e => ({ key: String(e.key), weight: Math.max(0, num(e.weight)) }));
  const out = Object.fromEntries(list.map(e => [e.key, 0]));
  const W = list.reduce((s, e) => s + e.weight, 0);
  if (T <= 0 || W <= 0) return out;
  let given = 0;
  const rest = list.map(e => { const exact = T * e.weight / W, base = Math.floor(exact + 1e-9); out[e.key] = base; given += base; return { ...e, frac: exact - base }; });
  rest.filter(e => e.weight > 0)
    .sort((a, b) => (b.frac - a.frac) || (b.weight - a.weight) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, T - given).forEach(e => { out[e.key] += 1; });
  return out;
}

// Les clés des pharmacies (ordre de départage des UG) sont calculées côté serveur avec un
// secret (voir _gp.js, pharmacyKey) : l'écran les reçoit toutes faites et ne peut pas en
// déduire l'identité des autres pharmacies.

// UG d'une ligne pour chaque pharmacie. billedByKey : { clé: unités facturées }.
// Collectif : chaque pharmacie garde AU MOINS ses propres gratuités (celles de sa quantité
// seule) ; le surplus obtenu grâce au groupe est réparti au prorata des unités qui n'ont pas
// encore donné de gratuité, au plus fort reste. Une pharmacie qui rejoint le groupe ne fait
// donc jamais baisser la part des autres sous leurs propres gratuités.
export function allocateFree(op, line, billedByKey) {
  const entries = Object.entries(billedByKey || {}).map(([key, q]) => ({ key, weight: Math.max(0, Math.floor(num(q))) }));
  const own = Object.fromEntries(entries.map(e => [e.key, ugFor(line, e.weight).free]));
  if (op.tier_mode === "individuel") return own;
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const groupFree = ugFor(line, total).free;
  const surplus = groupFree - Object.values(own).reduce((s, n) => s + n, 0);
  // plusieurs paliers d'UG : la somme des gratuités individuelles peut dépasser celles du groupe ;
  // on ne distribue jamais plus que ce que le labo livre (répartition au prorata)
  if (surplus < 0) return splitInteger(groupFree, entries);
  if (surplus === 0) return own;
  // unités non encore récompensées : facturées − tranches complètes du meilleur palier individuel
  const leftover = entries.map(e => { const t = ugFor(line, e.weight).tier; return { key: e.key, weight: t ? e.weight - Math.floor(e.weight / t.min_qty) * t.min_qty : e.weight }; });
  const extra = splitInteger(surplus, leftover.some(e => e.weight > 0) ? leftover : entries);
  return Object.fromEntries(entries.map(e => [e.key, own[e.key] + (extra[e.key] || 0)]));
}

// UG d'une pharmacie réparties entre ses dates de livraison (ordre : immédiat, puis les dates)
export function freeBySlot(free, billedBySlot, slotOrder) {
  const order = [...new Set([...(slotOrder || []), ...Object.keys(billedBySlot || {})])];
  const byIndex = splitInteger(free, order.map((s, i) => ({ key: String(i).padStart(4, "0"), weight: num(billedBySlot?.[s]) })));
  return Object.fromEntries(order.map((s, i) => [s, byIndex[String(i).padStart(4, "0")]]).filter(([, f]) => f > 0));
}

// ── Prix unitaire d'une ligne (par unité facturée) ─────────────────────
export function priceLine(op, line, pharmacyBilled, groupBilled) {
  const basis = op.tier_mode === "individuel" ? num(pharmacyBilled) : num(groupBilled);
  const gross = num(line.price_gross);
  const inv = invoiceDiscount(line, basis);
  const ug = ugFor(line, basis);
  const rfa = num(op.rfa_pct);
  const afterInvoice = gross * (1 - inv.pct / 100);
  const afterRfa = afterInvoice * (1 - rfa / 100);
  return { basis, gross, invoicePct: inv.pct, invoiceTier: inv.tier, nextInvoiceTier: inv.next,
    ug, rfaPct: rfa, unitAfterInvoice: afterInvoice, unitAfterRfa: afterRfa };
}

// ── Récapitulatif d'une commande de pharmacie ───────────────────────────
// myBilled    : { lineId: unités facturées (toutes dates) } de la pharmacie
// groupBilled : { lineId: unités facturées du groupe } (inclut la pharmacie)
// ctx         : { free: { lineId: UG attribuées } (sinon : individuel exact, collectif
//                 estimé au prorata arrondi), groupNetAfterRfa, feePct }
export function priceOrder(op, lines, myBilled, groupBilled, ctx = {}) {
  const rows = [];
  let gross = 0, afterInvoice = 0, afterRfa = 0, ugValue = 0;
  const vatBase = {};
  for (const line of lines) {
    const q = Math.max(0, Math.floor(num(myBilled[line.id])));
    if (q <= 0) continue;
    const G = Math.max(num(groupBilled[line.id]), q);
    const p = priceLine(op, line, q, G);
    const free = ctx.free && ctx.free[line.id] != null ? Math.max(0, Math.floor(num(ctx.free[line.id])))
      : op.tier_mode === "individuel" ? ugFor(line, q).free : Math.floor(ugFor(line, G).free * q / G);
    const row = { line, qty: q, free, received: q + free, ...p,
      totalGross: p.gross * q, totalAfterInvoice: p.unitAfterInvoice * q, totalAfterRfa: p.unitAfterRfa * q,
      ugValue: p.unitAfterInvoice * free };
    rows.push(row);
    gross += row.totalGross; afterInvoice += row.totalAfterInvoice; afterRfa += row.totalAfterRfa; ugValue += row.ugValue;
  }
  // Coopération commerciale convertie en remise
  let coop = 0;
  if (rows.length && op.coop_mode === "par_pharmacie") coop = num(op.coop_amount);
  else if (rows.length && op.coop_mode === "total") {
    const groupNet = num(ctx.groupNetAfterRfa);
    coop = groupNet > 0 ? num(op.coop_amount) * (afterRfa / groupNet) : 0;
  }
  coop = Math.min(coop, afterRfa);
  const coopPct = afterRfa > 0 ? coop / afterRfa : 0;
  const net = afterRfa - coop;
  const feePct = ctx.feePct != null ? num(ctx.feePct) : num(op.fee_pct);
  const fee = net * feePct / 100;
  for (const r of rows) {
    r.unitNet = r.unitAfterRfa * (1 - coopPct);              // par unité facturée
    r.totalNet = r.unitNet * r.qty;
    r.unitWithFee = r.unitNet * (1 + feePct / 100);          // par unité facturée, frais compris
    r.totalWithFee = r.unitWithFee * r.qty;
    r.receivedUnitNet = r.received > 0 ? r.totalNet / r.received : 0;   // par unité reçue
    r.totalDiscountPct = r.gross > 0 && r.received > 0 ? (1 - r.totalNet / (r.received * r.gross)) * 100 : 0;
    const v = r.line.vat_rate == null ? "?" : String(num(r.line.vat_rate));
    vatBase[v] = (vatBase[v] || 0) + r.totalWithFee;
  }
  const vat = Object.entries(vatBase).reduce((s, [rate, base]) => s + (rate === "?" ? 0 : base * num(rate) / 100), 0);
  const units = rows.reduce((s, r) => s + r.qty, 0), freeUnits = rows.reduce((s, r) => s + r.free, 0);
  return { rows, totals: {
    gross, invoiceDiscount: gross - afterInvoice, rfaValue: afterInvoice - afterRfa,
    coop, net, feePct, fee, totalHT: net + fee, vat, totalTTC: net + fee + vat, vatBase,
    units, freeUnits, receivedUnits: units + freeUnits, ugValue,
  } };
}

// ── Ligne Odoo : unités reçues au prix brut, remise unique = montant attendu ──
// Montant à quelques centimes près : Odoo arrondit la remise à 2 décimales (écart borné
// par unités × prix × 0,005 %). Si le montant dépasse le brut (frais sans remise), pas de
// remise négative : prix net au centime supérieur et petite remise pour tomber juste.
export function odooLine(gross, received, amount) {
  const r = Math.max(0, num(received)), a = num(amount);
  let price = round2(num(gross));                              // prix réellement envoyé à Odoo
  if (r <= 0) return { qty: 0, price_unit: price, discount: 0 };
  if (price <= 0 || a > r * price) price = Math.ceil((a / r) * 100 - 1e-9) / 100;   // frais > remises : prix net au centime supérieur
  const discount = price > 0 ? Math.max(0, round2((1 - a / (r * price)) * 100)) : 0;
  return { qty: r, price_unit: price, discount };
}

// ── Objectif du groupe (sur les unités facturées) ──────────────────────
// perPharmacy : { pharmacie: { lineId: unités facturées } } — nécessaire en mode individuel
export function objectiveProgress(op, lines, groupBilled, perPharmacy = null) {
  const target = num(op.objective_value);
  if (!op.objective_type || op.objective_type === "aucun" || target <= 0) return null;
  let value = 0;
  if (op.objective_type === "unites") {
    for (const l of lines) value += num(groupBilled[l.id]) * (num(l.weight) || 1);
  } else if (op.objective_type === "montant_brut") {
    for (const l of lines) value += num(groupBilled[l.id]) * num(l.price_gross);
  } else if (op.objective_type === "montant_net") {
    // montant facturé par le labo : unités facturées × prix après remise sur facture
    const add = (l, q, basis) => { if (q > 0) value += q * priceLine({ ...op, rfa_pct: 0 }, l, basis, basis).unitAfterInvoice; };
    if (op.tier_mode === "individuel" && perPharmacy) {
      for (const qs of Object.values(perPharmacy)) for (const l of lines) add(l, num(qs[l.id]), num(qs[l.id]));
    } else for (const l of lines) add(l, num(groupBilled[l.id]), num(groupBilled[l.id]));
  }
  return objectiveFrom(op, value);
}

// Contribution d'une pharmacie à l'objectif, quand elle s'additionne (tout sauf
// « montant remisé » en paliers collectifs, qui dépend du total du groupe)
export function objectiveContribution(op, lines, myBilled) {
  let v = 0;
  for (const l of lines) {
    const q = num(myBilled[l.id]);
    if (q <= 0) continue;
    if (op.objective_type === "unites") v += q * (num(l.weight) || 1);
    else if (op.objective_type === "montant_brut") v += q * num(l.price_gross);
    else if (op.objective_type === "montant_net") v += q * priceLine({ ...op, rfa_pct: 0 }, l, q, q).unitAfterInvoice;
  }
  return v;
}
export const objectiveIsAdditive = (op) => op.objective_type !== "montant_net" || op.tier_mode === "individuel";
export function objectiveFrom(op, value) {
  const target = num(op.objective_value);
  if (!op.objective_type || op.objective_type === "aucun" || target <= 0) return null;
  return { type: op.objective_type, value, target, pct: Math.min(100, (value / target) * 100), reached: value >= target, missing: Math.max(0, target - value) };
}

// ── Aides ───────────────────────────────────────────────────────────────
// { lineId: { slotId: qty } } → { lineId: total }
export const sumSlots = (bySlot) => Object.fromEntries(Object.entries(bySlot || {}).map(([k, s]) => [k, Object.values(s || {}).reduce((a, q) => a + num(q), 0)]));

// Date du jour à Paris (AAAA-MM-JJ) : ouverture et clôture s'entendent en heure française
export const parisToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// Ordre des colonnes de livraison d'une opération
export const slotOrder = (op) => [IMMEDIATE_SLOT, ...((op && op.delivery_slots) || []).map(s => s.id)];

// ── Colisage ────────────────────────────────────────────────────────────
// pack_size = unités par colis ; pack_rule : « aucune » (indicatif), « minimum » (au moins
// 1 colis), « multiple » (colis entiers). Règle appliquée à CHAQUE livraison, sur la quantité
// saisie (unités facturées, sans les UG) ; 0 = produit non commandé, toujours permis.
export const PACK_RULES = ["aucune", "minimum", "multiple"];
export const packSize = (line) => { const n = Math.floor(num(line && line.pack_size)); return n >= 1 ? n : null; };
export function packCheck(line, qty) {
  const size = packSize(line), q = Math.floor(num(qty));
  const rule = line && line.pack_rule;
  if (!size || size < 2 || q <= 0 || (rule !== "minimum" && rule !== "multiple")) return null;
  if (rule === "minimum" && q < size) return { rule, size, qty: q, suggestion: size, text: `minimum ${size}` };
  if (rule === "multiple" && q % size) return { rule, size, qty: q, suggestion: Math.ceil(q / size) * size, text: `par ${size}` };
  return null;
}
// Libellé pour la pharmacie : « Colis de 12 · par 12 » / « Colis de 12 · minimum 12 »
export const packLabel = (line) => {
  const size = packSize(line);
  if (!size) return "";
  const rule = line.pack_rule;
  return `Colis de ${size}` + (size >= 2 && rule === "multiple" ? ` · commande par ${size}` : size >= 2 && rule === "minimum" ? ` · minimum ${size}` : "");
};
// Toutes les quantités hors colisage d'une commande { ligne: { livraison: qté } }
export function packIssues(lines, bySlot) {
  const out = [];
  for (const l of lines || []) for (const [slot, q] of Object.entries((bySlot && bySlot[l.id]) || {})) {
    const pb = packCheck(l, q);
    if (pb) out.push({ line: l, slot_id: slot, ...pb });
  }
  return out;
}

// ── Elixir participante (commande pour son stock) ───────────────────────
// Identifiant réservé dans gp_participants / gp_orders. Ses quantités comptent pour les
// paliers, l'objectif et les UG (sa part, comme une pharmacie) ; elle ne paie ni frais ni
// ne prend de coopération (réservée aux pharmacies) ; pas de devis client (bon labo seulement).
export const ELIXIR_ID = "elixir";
export const ELIXIR_NAME = "Elixir Pharma (stock)";
export const isElixir = (id) => String(id) === ELIXIR_ID;
