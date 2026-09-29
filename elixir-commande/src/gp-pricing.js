// ── Moteur de prix des commandes groupées ───────────────────────────────
// Partagé entre l'écran (React) et les fonctions Netlify : les deux calculent
// exactement de la même façon.
//
// Conventions
// - Les quantités sont des unités REÇUES par la pharmacie.
// - Les paliers (remise et UG) s'évaluent sur la quantité « base » :
//   total du groupe (mode collectif) ou quantité de la pharmacie (individuel).
// - UG « 12 + 2 » = 2 gratuites pour 12 facturées, soit une tranche de 14 unités.
//   Les UG sont converties en remise équivalente (gratuites ÷ unités reçues),
//   appliquée à toutes les unités : à la commande Odoo, toutes les remises hors
//   facture (UG, RFA, coopération) deviennent une remise sur facture.
// - Frais de traitement : ajoutés APRÈS toutes les remises (ce ne sont pas des remises).

export const IMMEDIATE_SLOT = "immediat";

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const sortTiers = (tiers, key = "min_qty") =>
  (Array.isArray(tiers) ? tiers : [])
    .map(t => ({ ...t, [key]: num(t[key]) }))
    .filter(t => t[key] > 0)
    .sort((a, b) => a[key] - b[key]);

// ── Remise sur facture ──────────────────────────────────────────────────
export function invoiceDiscount(line, basis) {
  if (line.discount_mode === "unitaire") return { pct: num(line.discount_pct), tier: null, next: null };
  if (line.discount_mode !== "paliers") return { pct: 0, tier: null, next: null };
  const tiers = sortTiers(line.discount_tiers).map(t => ({ min_qty: t.min_qty, pct: num(t.pct) }));
  const reached = tiers.filter(t => basis >= t.min_qty).pop() || null;
  const next = tiers.find(t => t.min_qty > basis && t.pct > (reached ? reached.pct : 0)) || null;
  return { pct: reached ? reached.pct : 0, tier: reached, next: next ? { ...next, missing: next.min_qty - basis } : null };
}

// ── Unités gratuites ────────────────────────────────────────────────────
// Meilleur palier = celui qui donne le plus d'UG pour la quantité base.
export function ugFor(line, basis) {
  const tiers = sortTiers(line.ug_tiers).map(t => ({ min_qty: t.min_qty, free_qty: num(t.free_qty) })).filter(t => t.free_qty > 0);
  let best = null;
  for (const t of tiers) {
    const block = t.min_qty + t.free_qty;
    if (basis < block) continue;
    const free = Math.floor(basis / block) * t.free_qty;
    if (!best || free > best.free) best = { ...t, block, free };
  }
  const equivPct = best && basis > 0 ? (best.free / basis) * 100 : 0;
  // prochain palier : plus petite tranche non encore atteinte qui apporterait plus d'UG
  const next = tiers
    .map(t => ({ ...t, block: t.min_qty + t.free_qty }))
    .filter(t => t.block > basis)
    .sort((a, b) => a.block - b.block)[0] || null;
  return { tier: best, free: best ? best.free : 0, equivPct, next: next ? { ...next, missing: next.block - basis } : null };
}
export const ugLabel = (t) => `${t.min_qty} + ${t.free_qty} UG (soit ${t.min_qty + t.free_qty} unités, −${round2((t.free_qty / (t.min_qty + t.free_qty)) * 100)} %)`;

// ── Prix unitaire d'une ligne ───────────────────────────────────────────
export function priceLine(op, line, pharmacyQty, groupQty) {
  const basis = op.tier_mode === "individuel" ? num(pharmacyQty) : num(groupQty);
  const gross = num(line.price_gross);
  const inv = invoiceDiscount(line, basis);
  const ug = ugFor(line, basis);
  const rfa = num(op.rfa_pct);
  const afterInvoice = gross * (1 - inv.pct / 100);
  const afterUg = afterInvoice * (1 - ug.equivPct / 100);
  const afterRfa = afterUg * (1 - rfa / 100);
  return { basis, gross, invoicePct: inv.pct, invoiceTier: inv.tier, nextInvoiceTier: inv.next,
    ug, rfaPct: rfa, unitAfterInvoice: afterInvoice, unitAfterUg: afterUg, unitAfterRfa: afterRfa };
}

// ── Récapitulatif d'une commande de pharmacie ───────────────────────────
// myQty    : { lineId: quantité totale (toutes dates) } de la pharmacie
// groupQty : { lineId: quantité totale du groupe } (inclut la pharmacie)
// ctx      : { groupNetAfterRfa, orderingPharmacies, feePct } pour la coopération « total »
export function priceOrder(op, lines, myQty, groupQty, ctx = {}) {
  const rows = [];
  let gross = 0, afterInvoice = 0, afterUg = 0, afterRfa = 0;
  const vatBase = {};
  for (const line of lines) {
    const q = num(myQty[line.id]);
    if (q <= 0) continue;
    const p = priceLine(op, line, q, Math.max(num(groupQty[line.id]), q));
    const row = { line, qty: q, ...p,
      totalGross: p.gross * q, totalAfterInvoice: p.unitAfterInvoice * q,
      totalAfterUg: p.unitAfterUg * q, totalAfterRfa: p.unitAfterRfa * q };
    rows.push(row);
    gross += row.totalGross; afterInvoice += row.totalAfterInvoice; afterUg += row.totalAfterUg; afterRfa += row.totalAfterRfa;
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
  // Remise globale équivalente par ligne (pour la commande Odoo) et base TVA
  for (const r of rows) {
    r.unitNet = r.unitAfterRfa * (1 - coopPct);
    r.totalNet = r.unitNet * r.qty;
    r.totalDiscountPct = r.gross > 0 ? (1 - r.unitNet / r.gross) * 100 : 0;
    r.unitWithFee = r.unitNet * (1 + feePct / 100);
    const v = r.line.vat_rate == null ? "?" : String(num(r.line.vat_rate));
    vatBase[v] = (vatBase[v] || 0) + r.totalNet * (1 + feePct / 100);
  }
  const vat = Object.entries(vatBase).reduce((s, [rate, base]) => s + (rate === "?" ? 0 : base * num(rate) / 100), 0);
  return { rows, totals: {
    gross, invoiceDiscount: gross - afterInvoice, ugValue: afterInvoice - afterUg, rfaValue: afterUg - afterRfa,
    coop, net, feePct, fee, totalHT: net + fee, vat, totalTTC: net + fee + vat, vatBase,
    units: rows.reduce((s, r) => s + r.qty, 0),
  } };
}

// ── Objectif du groupe ──────────────────────────────────────────────────
// perPharmacy : { cip: { lineId: quantité } } — nécessaire en mode individuel
export function objectiveProgress(op, lines, groupQty, perPharmacy = null) {
  const target = num(op.objective_value);
  if (!op.objective_type || op.objective_type === "aucun" || target <= 0) return null;
  let value = 0;
  if (op.objective_type === "unites") {
    for (const l of lines) value += num(groupQty[l.id]) * (num(l.weight) || 1);
  } else if (op.objective_type === "montant_brut") {
    for (const l of lines) value += num(groupQty[l.id]) * num(l.price_gross);
  } else if (op.objective_type === "montant_net") {
    // montant facturé par le labo : après remise sur facture et UG
    const add = (l, q, basis) => { if (q > 0) value += q * priceLine({ ...op, rfa_pct: 0 }, l, basis, basis).unitAfterUg; };
    if (op.tier_mode === "individuel" && perPharmacy) {
      for (const qs of Object.values(perPharmacy)) for (const l of lines) add(l, num(qs[l.id]), num(qs[l.id]));
    } else for (const l of lines) add(l, num(groupQty[l.id]), num(groupQty[l.id]));
  }
  return { type: op.objective_type, value, target, pct: Math.min(100, (value / target) * 100), reached: value >= target, missing: Math.max(0, target - value) };
}

// ── Aides ───────────────────────────────────────────────────────────────
// { lineId: { slotId: qty } } → { lineId: total }
export const sumSlots = (bySlot) => Object.fromEntries(Object.entries(bySlot || {}).map(([k, s]) => [k, Object.values(s || {}).reduce((a, q) => a + num(q), 0)]));

// Date du jour à Paris (AAAA-MM-JJ) : ouverture et clôture s'entendent en heure française
export const parisToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// Prix net labo moyen d'un produit (remise sur facture + UG, sans RFA ni coopération) :
// en mode individuel chaque pharmacie a son propre palier, d'où une moyenne pondérée.
// perPharmacyTotals : { pharmacie: { lineId: quantité } }
export function labUnitNet(op, line, groupTotal, perPharmacyTotals) {
  const noRfa = { ...op, rfa_pct: 0 };
  const total = num(groupTotal);
  if (total <= 0) return priceLine(noRfa, line, 0, 0).unitAfterUg;
  if (op.tier_mode !== "individuel") return priceLine(noRfa, line, total, total).unitAfterUg;
  let value = 0, qty = 0;
  for (const qs of Object.values(perPharmacyTotals || {})) { const q = num(qs[line.id]); if (q > 0) { value += q * priceLine(noRfa, line, q, q).unitAfterUg; qty += q; } }
  return qty > 0 ? value / qty : priceLine(noRfa, line, total, total).unitAfterUg;
}

// Contribution d'une pharmacie à l'objectif, quand elle s'additionne (tout sauf
// « montant remisé » en paliers collectifs, qui dépend du total du groupe)
export function objectiveContribution(op, lines, myQty) {
  let v = 0;
  for (const l of lines) {
    const q = num(myQty[l.id]);
    if (q <= 0) continue;
    if (op.objective_type === "unites") v += q * (num(l.weight) || 1);
    else if (op.objective_type === "montant_brut") v += q * num(l.price_gross);
    else if (op.objective_type === "montant_net") v += q * priceLine({ ...op, rfa_pct: 0 }, l, q, q).unitAfterUg;
  }
  return v;
}
export const objectiveIsAdditive = (op) => op.objective_type !== "montant_net" || op.tier_mode === "individuel";
export function objectiveFrom(op, value) {
  const target = num(op.objective_value);
  if (!op.objective_type || op.objective_type === "aucun" || target <= 0) return null;
  return { type: op.objective_type, value, target, pct: Math.min(100, (value / target) * 100), reached: value >= target, missing: Math.max(0, target - value) };
}
