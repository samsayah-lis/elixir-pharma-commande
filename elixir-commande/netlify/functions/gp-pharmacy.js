// ── Commandes groupées : côté pharmacie ─────────────────────────────────
// POST { action: access | list | get | save, cip, email, ... }
// Identité : jeton de connexion (Authorization) ou e-mail du compte pharmacie de la session.
import { getCors } from "./cors.js";
import { json, sb, sbAll, eq, productInfo, identifyPharmacy, loadOperation, summarize, saveOrder, countedQty, aggregate, today, fail } from "./_gp.js";
import { priceOrder, objectiveContribution, objectiveIsAdditive, objectiveFrom } from "../../src/gp-pricing.js";
import { sendMail, confirmationEmail, cancellationEmail, ADMIN_MAIL } from "./_gp-mail.js";
import { rateLimit } from "./rate-limit.js";

const VISIBLE = ["ouverte", "cloturee", "commandee", "terminee"];
const RESEND_DELAY = 2 * 60e3;   // « Renvoyer la confirmation » : au plus toutes les 2 minutes

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
  try {
    const b = JSON.parse(event.body || "{}");
    const ph = await identifyPharmacy(event, b.cip, b.email);
    const [acc] = ph ? await sb(`gp_access?pharmacy_id=${eq(ph.id)}&limit=1`) : [];
    if (!ph || !acc) return b.action === "access" ? json(cors, 200, { allowed: false }) : json(cors, 403, { error: "Accès aux commandes groupées non activé pour ce compte" });
    switch (b.action) {
      case "access": {
        const open = (await myOperations(ph.id, ["ouverte"])).filter(isOpenNow);
        return json(cors, 200, { allowed: true, open_count: open.length });
      }
      case "list": {
        const ops = await myOperations(ph.id, VISIBLE);
        const orders = ops.length ? await sbAll(`gp_orders?pharmacy_id=${eq(ph.id)}&select=operation_id,status,confirmed_at`) : [];
        const byOp = Object.fromEntries(orders.map(o => [o.operation_id, o]));
        return json(cors, 200, { operations: ops.map(op => ({ ...publicOp(op), my_order: byOp[op.id] || null })) });
      }
      case "get": {
        const data = await loadForPharmacy(b.id, ph.id);
        return json(cors, 200, await view(data, ph));
      }
      case "save": {
        const limited = rateLimit(event, 20, 60);
        if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
        const data = await loadForPharmacy(b.id, ph.id);
        if (!isOpenNow(data.op)) throw fail("L'opération n'est plus ouverte aux commandes");
        const prevOrder = data.orders.find(o => o.pharmacy_id === ph.id);
        const r = await saveOrder({ data, pharmacy: ph, entries: b.entries, source: b.source === "fichier" ? "fichier" : "formulaire", fileName: b.file_name || null,
          loadedUpdatedAt: "loaded_updated_at" in b ? b.loaded_updated_at : undefined });
        const fresh = await loadOperation(data.op.id);
        const v = await view(fresh, ph);
        let mail = { sent: false, reason: "commande vide" };
        if (r.total > 0) {
          const lastSent = prevOrder?.email_sent_at ? Date.parse(prevOrder.email_sent_at) : 0;
          // confirmation jamais partie (ou antérieure à la dernière modification) : on la renvoie
          const owed = !prevOrder?.email_sent_at || (prevOrder.confirmed_at && lastSent < Date.parse(prevOrder.confirmed_at));
          if (r.changed || owed || (b.resend && Date.now() - lastSent > RESEND_DELAY)) {
            const stockByLine = Object.fromEntries(fresh.lines.map(l => [l.id, !!v.products[l.cip]?.in_stock]));
            const m = confirmationEmail({ op: fresh.op, summary: v.my_summary, bySlot: v.my_order.bySlot, stockByLine });
            mail = await sendMail({ to: ph.email, subject: m.subject, html: m.html });
            if (mail.sent) await sb(`gp_orders?operation_id=eq.${data.op.id}&pharmacy_id=${eq(ph.id)}`, { method: "PATCH", body: { email_sent_at: new Date().toISOString() } });
            if (r.changed || owed) await sendMail({ to: ADMIN_MAIL, subject: `[Commande groupée] ${ph.name} — ${fresh.op.name}`,
              html: `<p>${esc(ph.name)} (${esc(ph.email)}) vient de ${r.wasConfirmed ? "modifier" : "confirmer"} sa ${m.kind}.</p>${m.html}` }).catch(() => {});
          } else mail = { sent: false, reason: "aucune modification depuis le dernier envoi" };
        } else if (r.wasConfirmed) {
          const m = cancellationEmail({ op: fresh.op });
          mail = await sendMail({ to: ph.email, subject: m.subject, html: m.html });
          await sendMail({ to: ADMIN_MAIL, subject: `[Commande groupée] ${ph.name} a annulé sa commande — ${fresh.op.name}`,
            html: `<p>${esc(ph.name)} (${esc(ph.email)}) a retiré toutes ses quantités de l'opération <b>${esc(fresh.op.name)}</b>.</p>` }).catch(() => {});
        }
        return json(cors, 200, { ok: true, total: r.total, changed: r.changed, cancelled: r.wasConfirmed && r.total === 0, mail, ...v });
      }
      default:
        throw fail("Action inconnue");
    }
  } catch (e) {
    if (!e.status) console.error("gp-pharmacy", e);
    return json(cors, e.status || 500, { error: e.message || String(e), ...(e.extra || {}) });
  }
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isOpenNow = (op) => { const t = today(); return op.status === "ouverte" && (!op.start_date || t >= op.start_date) && (!op.end_date || t <= op.end_date); };
// Statut vu par la pharmacie : une opération ouverte dont la date est passée est présentée comme clôturée
const phase = (op) => { const t = today(); if (op.status !== "ouverte") return op.status; if (op.start_date && t < op.start_date) return "a_venir"; if (op.end_date && t > op.end_date) return "cloturee"; return "ouverte"; };

async function myOperations(pharmacyId, statuses) {
  const parts = await sbAll(`gp_participants?pharmacy_id=${eq(pharmacyId)}&select=operation_id`);
  const ids = parts.map(p => p.operation_id).filter(x => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return [];
  return sbAll(`gp_operations?id=in.(${ids.join(",")})&status=in.(${statuses.join(",")})&order=end_date.asc.nullslast`);
}

async function loadForPharmacy(id, pharmacyId) {
  if (!id) throw fail("Opération manquante");
  const data = await loadOperation(id);
  if (!data || !VISIBLE.includes(data.op.status) || !data.participants.some(p => p.pharmacy_id === pharmacyId)) throw fail("Opération introuvable", 404);
  return data;
}

// Ce que la pharmacie voit de l'opération (aucune donnée nominative des autres pharmacies)
const publicOp = (op) => ({ id: op.id, name: op.name, supplier_name: op.supplier_name, status: op.status, phase: phase(op), start_date: op.start_date, end_date: op.end_date,
  tier_mode: op.tier_mode, fee_pct: op.fee_pct, objective_type: op.objective_type, objective_value: op.objective_value, delivery_slots: op.delivery_slots,
  rfa_pct: op.rfa_pct, coop_mode: op.coop_mode, coop_amount: op.coop_amount, coop_label: op.coop_label, conditions_text: op.conditions_text,
  centralizer_type: op.centralizer_type, centralizer_name: op.centralizer_name });

async function view(data, ph) {
  const { op, lines } = data;
  const s = summarize(data);
  const me = data.participants.find(p => p.pharmacy_id === ph.id);
  const order = data.orders.find(o => o.pharmacy_id === ph.id) || null;
  const bySlot = {};
  for (const r of data.qty) if (r.pharmacy_id === ph.id) (bySlot[r.line_id] ||= {})[r.slot_id] = r.qty;
  const mine = Object.fromEntries(Object.entries(bySlot).map(([k, sl]) => [k, Object.values(sl).reduce((a, q) => a + q, 0)]));
  // Autres pharmacies (quantités confirmées comptées), sans moi
  const { counted } = countedQty(data);
  const others = aggregate(counted.filter(r => r.pharmacy_id !== ph.id));
  const collectif = op.tier_mode !== "individuel";
  const feePct = me?.fee_pct ?? op.fee_pct;
  // Coopération « montant global » : en collectif l'écran recalcule exactement la base (même prix
  // unitaire pour tous) ; en individuel, le net des autres ne dépend pas de ma saisie.
  let othersNet = null;
  if (!collectif && op.coop_mode === "total") {
    othersNet = 0;
    for (const qs of Object.values(others.perPharmacyTotal)) othersNet += priceOrder({ ...op, coop_mode: "aucune" }, lines, qs, qs).totals.net;
  }
  // Objectif : part des autres quand elle s'additionne ; sinon l'écran calcule sur le total du groupe
  let objectiveOthers = null;
  if (objectiveIsAdditive(op) && objectiveFrom(op, 0)) {
    objectiveOthers = 0;
    for (const qs of Object.values(others.perPharmacyTotal)) objectiveOthers += objectiveContribution(op, lines, qs);
  }
  const group = Object.fromEntries(lines.map(l => [l.id, (others.group[l.id] || 0) + (mine[l.id] || 0)]));
  const noCoop = priceOrder({ ...op, coop_mode: "aucune" }, lines, mine, group, { feePct });
  const groupNet = collectif ? lines.reduce((sum, l) => sum + priceOrder({ ...op, coop_mode: "aucune" }, lines, { [l.id]: group[l.id] || 0 }, group).totals.net, 0)
    : (othersNet || 0) + noCoop.totals.net;
  const summary = priceOrder(op, lines, mine, group, { groupNetAfterRfa: groupNet, feePct });
  const products = await productInfo(lines.map(l => l.cip)).catch(() => ({}));
  return {
    operation: publicOp(op),
    lines: lines.map(l => ({ id: l.id, cip: l.cip, name: l.name, price_gross: l.price_gross, discount_mode: l.discount_mode, discount_pct: l.discount_pct,
      discount_tiers: l.discount_tiers, ug_tiers: l.ug_tiers, weight: l.weight, vat_rate: l.vat_rate, notes: l.notes })),
    products: Object.fromEntries(Object.entries(products).map(([cip, p]) => [cip, { in_stock: !!p.in_stock }])),
    group_others: collectif ? others.group : {},
    others_net: othersNet,
    objective_others: objectiveOthers,
    participants_count: data.participants.length,
    fee_pct: feePct,
    my_order: { status: order?.status || null, confirmed_at: order?.confirmed_at || null, email_sent_at: order?.email_sent_at || null, updated_at: order?.updated_at || null, bySlot },
    my_summary: summary,
    pharmacy: { name: ph.name, email: ph.email },
  };
}
