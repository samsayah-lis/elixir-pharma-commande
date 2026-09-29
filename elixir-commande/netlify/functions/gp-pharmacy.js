// ── Commandes groupées : côté pharmacie ─────────────────────────────────
// POST { action: access | list | get | save, cip, email, ... }
// Identité : jeton OTP (Authorization) ou couple CIP + e-mail de la fiche pharmacie.
import { getCors } from "./cors.js";
import { json, sb, productInfo, identifyPharmacy, loadOperation, summarize, saveOrder, today } from "./_gp.js";
import { priceOrder } from "../../src/gp-pricing.js";
import { sendMail, confirmationEmail, ADMIN_MAIL } from "./_gp-mail.js";
import { rateLimit } from "./rate-limit.js";

const VISIBLE = ["ouverte", "cloturee", "commandee", "terminee"];
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
  try {
    const b = JSON.parse(event.body || "{}");
    const ph = await identifyPharmacy(event, b.cip, b.email);
    if (!ph) return json(cors, b.action === "access" ? 200 : 403, b.action === "access" ? { allowed: false } : { error: "Pharmacie non reconnue" });
    const [acc] = await sb(`gp_access?pharmacy_cip=eq.${encodeURIComponent(ph.cip)}&limit=1`);
    if (!acc) return json(cors, b.action === "access" ? 200 : 403, b.action === "access" ? { allowed: false } : { error: "Accès aux commandes groupées non activé" });
    switch (b.action) {
      case "access": {
        const open = await myOperations(ph.cip, ["ouverte"]);
        return json(cors, 200, { allowed: true, open_count: open.length });
      }
      case "list": {
        const ops = await myOperations(ph.cip, VISIBLE);
        const orders = ops.length ? await sb(`gp_orders?pharmacy_cip=eq.${encodeURIComponent(ph.cip)}&select=operation_id,status,confirmed_at`) : [];
        const byOp = Object.fromEntries((orders || []).map(o => [o.operation_id, o]));
        return json(cors, 200, { operations: ops.map(op => ({ ...publicOp(op), my_order: byOp[op.id] || null })) });
      }
      case "get": {
        const data = await loadForPharmacy(b.id, ph.cip);
        return json(cors, 200, await view(data, ph));
      }
      case "save": {
        const limited = rateLimit(event, 20, 60);
        if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
        const data = await loadForPharmacy(b.id, ph.cip);
        const t = today();
        if (data.op.status !== "ouverte" || (data.op.start_date && t < data.op.start_date) || (data.op.end_date && t > data.op.end_date))
          throw fail("L'opération n'est plus ouverte aux commandes");
        const wasConfirmed = data.orders.some(o => o.pharmacy_cip === ph.cip && o.status === "confirmee");
        const r = await saveOrder({ data, pharmacy: ph, entries: b.entries, source: b.source === "fichier" ? "fichier" : "formulaire", fileName: b.file_name || null });
        const fresh = await loadOperation(data.op.id);
        const v = await view(fresh, ph);
        let mail = { sent: false, reason: "commande vide" };
        if (r.total > 0) {
          const stockByLine = Object.fromEntries(fresh.lines.map(l => [l.id, !!v.products[l.cip]?.in_stock]));
          const m = confirmationEmail({ op: fresh.op, pharmacy: ph, summary: v.my_summary, bySlot: v.my_order.bySlot, stockByLine });
          mail = await sendMail({ to: ph.email, subject: m.subject, html: m.html });
          if (mail.sent) await sb(`gp_orders?operation_id=eq.${data.op.id}&pharmacy_cip=eq.${encodeURIComponent(ph.cip)}`, { method: "PATCH", body: { email_sent_at: new Date().toISOString() } });
          // copie à Elixir
          await sendMail({ to: ADMIN_MAIL, subject: `[Commande groupée] ${ph.name} — ${fresh.op.name}`, html: `<p>${ph.name} (CIP ${ph.cip}) vient de ${wasConfirmed ? "modifier" : "confirmer"} sa ${m.kind}.</p>${m.html}` }).catch(() => {});
        }
        return json(cors, 200, { ok: true, total: r.total, mail, ...v });
      }
      default:
        throw fail("Action inconnue");
    }
  } catch (e) {
    console.error("gp-pharmacy", e);
    return json(cors, e.status || 500, { error: e.message || String(e) });
  }
};

async function myOperations(cip, statuses) {
  const parts = await sb(`gp_participants?pharmacy_cip=eq.${encodeURIComponent(cip)}&select=operation_id`);
  const ids = (parts || []).map(p => p.operation_id);
  if (!ids.length) return [];
  return (await sb(`gp_operations?id=in.(${ids.join(",")})&status=in.(${statuses.join(",")})&order=end_date.asc.nullslast`)) || [];
}

async function loadForPharmacy(id, cip) {
  if (!id) throw fail("Opération manquante");
  const data = await loadOperation(id);
  if (!data || !VISIBLE.includes(data.op.status) || !data.participants.some(p => p.pharmacy_cip === cip)) throw fail("Opération introuvable", 404);
  return data;
}

// Ce que la pharmacie voit de l'opération (pas de données des autres pharmacies)
const publicOp = (op) => ({ id: op.id, name: op.name, supplier_name: op.supplier_name, status: op.status, start_date: op.start_date, end_date: op.end_date,
  tier_mode: op.tier_mode, fee_pct: op.fee_pct, objective_type: op.objective_type, objective_value: op.objective_value, delivery_slots: op.delivery_slots,
  rfa_pct: op.rfa_pct, coop_mode: op.coop_mode, coop_amount: op.coop_amount, coop_label: op.coop_label, conditions_text: op.conditions_text,
  centralizer_type: op.centralizer_type, centralizer_name: op.centralizer_name });

async function view(data, ph) {
  const s = summarize(data);
  const me = data.participants.find(p => p.pharmacy_cip === ph.cip);
  const order = data.orders.find(o => o.pharmacy_cip === ph.cip) || null;
  // quantités de la pharmacie, y compris un éventuel brouillon
  const bySlot = {};
  for (const r of data.qty) if (r.pharmacy_cip === ph.cip) (bySlot[r.line_id] ||= {})[r.slot_id] = r.qty;
  const mine = Object.fromEntries(Object.entries(bySlot).map(([k, sl]) => [k, Object.values(sl).reduce((a, q) => a + q, 0)]));
  // total du groupe HORS pharmacie : l'écran y ajoute la saisie en cours
  const others = {};
  for (const [lineId, q] of Object.entries(s.group)) others[lineId] = q - (order?.status === "confirmee" ? (mine[lineId] || 0) : 0);
  // part de la pharmacie dans la base de répartition de la coopération (montant après RFA, avant coopération)
  const myNet = order?.status === "confirmee" ? priceOrder({ ...data.op, coop_mode: "aucune" }, data.lines, mine, s.group).totals.net : 0;
  const feePct = me?.fee_pct ?? data.op.fee_pct;
  const summary = priceOrder(data.op, data.lines, mine, s.group, { groupNetAfterRfa: s.groupNetAfterRfa, feePct });
  const products = await productInfo(data.lines.map(l => l.cip)).catch(() => ({}));
  return {
    operation: publicOp(data.op),
    lines: data.lines.map(l => ({ id: l.id, cip: l.cip, name: l.name, price_gross: l.price_gross, discount_mode: l.discount_mode, discount_pct: l.discount_pct,
      discount_tiers: l.discount_tiers, ug_tiers: l.ug_tiers, weight: l.weight, vat_rate: l.vat_rate, notes: l.notes })),
    products: Object.fromEntries(Object.entries(products).map(([cip, p]) => [cip, { in_stock: !!p.in_stock, available: p.available ?? 0 }])),
    group_others: others,
    group_net_others: Math.max(0, s.groupNetAfterRfa - myNet),
    participants_count: data.participants.length,
    fee_pct: feePct,
    objective: s.objective,
    my_order: { status: order?.status || null, confirmed_at: order?.confirmed_at || null, email_sent_at: order?.email_sent_at || null, bySlot },
    my_summary: summary,
    pharmacy: { cip: ph.cip, name: ph.name, email: ph.email },
  };
}
