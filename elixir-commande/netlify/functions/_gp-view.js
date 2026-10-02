// ── Commandes groupées : ce qu'une participante voit de l'opération ─────
// Partagé par gp-pharmacy (la pharmacie connectée) et gp-admin (saisie par Elixir pour une
// participante, dont Elixir elle-même pour son stock). Aucune donnée nominative des autres.
import { productInfo, countedQty, aggregate, today, pharmacyKey } from "./_gp.js";
import { priceOrder, objectiveContribution, objectiveIsAdditive, objectiveFrom, ugFor, allocateFree, freeBySlot, slotOrder, isElixir, ELIXIR_ID } from "../../src/gp-pricing.js";

export const isOpenNow = (op) => { const t = today(); return op.status === "ouverte" && (!op.start_date || t >= op.start_date) && (!op.end_date || t <= op.end_date); };
// Statut vu par la pharmacie : une opération ouverte dont la date est passée est présentée comme clôturée
export const phase = (op) => { const t = today(); if (op.status !== "ouverte") return op.status; if (op.start_date && t < op.start_date) return "a_venir"; if (op.end_date && t > op.end_date) return "cloturee"; return "ouverte"; };


// Ce que la pharmacie voit de l'opération (aucune donnée nominative des autres pharmacies)
export const publicOp = (op) => ({ id: op.id, name: op.name, supplier_name: op.supplier_name, status: op.status, phase: phase(op), start_date: op.start_date, end_date: op.end_date,
  tier_mode: op.tier_mode, fee_pct: op.fee_pct, objective_type: op.objective_type, objective_value: op.objective_value, delivery_slots: op.delivery_slots,
  rfa_pct: op.rfa_pct, coop_mode: op.coop_mode, coop_amount: op.coop_amount, coop_label: op.coop_label, conditions_text: op.conditions_text,
  centralizer_type: op.centralizer_type, centralizer_name: op.centralizer_name });

export async function view(data, ph) {
  const { op, lines } = data;
  const me = data.participants.find(p => p.pharmacy_id === ph.id);
  const order = data.orders.find(o => o.pharmacy_id === ph.id) || null;
  const bySlot = {};
  for (const r of data.qty) if (r.pharmacy_id === ph.id) (bySlot[r.line_id] ||= {})[r.slot_id] = r.qty;
  const mine = Object.fromEntries(Object.entries(bySlot).map(([k, sl]) => [k, Object.values(sl).reduce((a, q) => a + q, 0)]));
  // Autres pharmacies (quantités confirmées comptées), sans moi
  const { counted } = countedQty(data);
  const others = aggregate(counted.filter(r => r.pharmacy_id !== ph.id));
  const collectif = op.tier_mode !== "individuel";
  // Elixir (commande pour son stock) : ni frais ni coopération ; ses quantités comptent pour le groupe
  const meElixir = isElixir(ph.id);
  const opMe = meElixir ? { ...op, coop_mode: "aucune" } : op;
  const feePct = meElixir ? 0 : (me?.fee_pct ?? op.fee_pct);
  // Coopération « montant global » réservée aux pharmacies : la base du prorata exclut Elixir
  // (transmis à l'écran uniquement en collectif + coopération « montant global », seul cas où le calcul en direct en a besoin)
  const elixirQty = meElixir ? {} : (others.perPharmacyTotal[ELIXIR_ID] || {});
  const coopExcluded = collectif && op.coop_mode === "total" && Number(op.coop_amount) > 0 ? elixirQty : {};
  // Coopération « montant global » : en collectif l'écran recalcule exactement la base (même prix
  // unitaire pour tous) ; en individuel, le net des autres ne dépend pas de ma saisie.
  let othersNet = null;
  if (!collectif && op.coop_mode === "total") {
    othersNet = 0;
    for (const [pid, qs] of Object.entries(others.perPharmacyTotal)) if (!isElixir(pid)) othersNet += priceOrder({ ...op, coop_mode: "aucune" }, lines, qs, qs).totals.net;
  }
  // Objectif : part des autres quand elle s'additionne ; sinon l'écran calcule sur le total du groupe
  let objectiveOthers = null;
  if (objectiveIsAdditive(op) && objectiveFrom(op, 0)) {
    objectiveOthers = 0;
    for (const qs of Object.values(others.perPharmacyTotal)) objectiveOthers += objectiveContribution(op, lines, qs);
  }
  const group = Object.fromEntries(lines.map(l => [l.id, (others.group[l.id] || 0) + (mine[l.id] || 0)]));
  const noCoop = priceOrder({ ...op, coop_mode: "aucune" }, lines, mine, group, { feePct });
  const groupNet = collectif ? lines.reduce((sum, l) => sum + priceOrder({ ...op, coop_mode: "aucune" }, lines, { [l.id]: Math.max(0, (group[l.id] || 0) - (elixirQty[l.id] || 0)) }, group).totals.net, 0)
    : (othersNet || 0) + noCoop.totals.net;
  // Unités gratuites de la pharmacie (répartition exacte avec les autres, clés anonymes) ;
  // l'écran refait le même calcul en direct à partir de ug_others et my_key.
  const myKey = pharmacyKey(op.id, ph.id), ugOthers = {}, myFree = {};
  for (const l of lines) {
    if (!(l.ug_tiers || []).length) continue;
    const q = mine[l.id] || 0;
    if (!collectif) { myFree[l.id] = ugFor(l, q).free; continue; }
    const byKey = {};
    for (const [pid, qs] of Object.entries(others.perPharmacyTotal)) if ((qs[l.id] || 0) > 0) byKey[pharmacyKey(op.id, pid)] = qs[l.id];
    ugOthers[l.id] = byKey;
    myFree[l.id] = q > 0 ? (allocateFree(op, l, { ...byKey, [myKey]: q })[myKey] || 0) : 0;
  }
  const myFreeSlots = Object.fromEntries(Object.entries(myFree).filter(([, f]) => f > 0).map(([lid, f]) => [lid, freeBySlot(f, bySlot[lid] || {}, slotOrder(op))]));
  const summary = priceOrder(opMe, lines, mine, group, { free: myFree, groupNetAfterRfa: groupNet, feePct });
  const products = await productInfo(lines.map(l => l.cip)).catch(() => ({}));
  return {
    operation: publicOp(opMe),
    lines: lines.map(l => ({ id: l.id, cip: l.cip, name: l.name, price_gross: l.price_gross, discount_mode: l.discount_mode, discount_pct: l.discount_pct,
      discount_tiers: l.discount_tiers, extra_discounts: l.extra_discounts || [], ug_tiers: l.ug_tiers, weight: l.weight, vat_rate: l.vat_rate, notes: l.notes, pack_size: l.pack_size ?? null, pack_rule: l.pack_rule || "aucune" })),
    products: Object.fromEntries(Object.entries(products).map(([cip, p]) => [cip, { in_stock: !!p.in_stock }])),
    group_others: collectif ? others.group : {},
    ug_others: ugOthers,
    my_key: myKey,
    others_net: othersNet,
    coop_excluded: coopExcluded,   // quantités d'Elixir : hors base de la coopération « montant global »
    objective_others: objectiveOthers,
    participants_count: data.participants.filter(p => !isElixir(p.pharmacy_id)).length,
    fee_pct: feePct,
    my_order: { status: order?.status || null, confirmed_at: order?.confirmed_at || null, email_sent_at: order?.email_sent_at || null, updated_at: order?.updated_at || null, bySlot, freeBySlot: myFreeSlots },
    my_summary: summary,
    pharmacy: { name: ph.name, email: ph.email },
  };
}
