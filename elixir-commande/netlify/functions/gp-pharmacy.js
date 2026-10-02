// ── Commandes groupées : côté pharmacie ─────────────────────────────────
// POST { action: access | list | get | save, cip, email, ... }
// Identité : jeton de connexion (Authorization) ou e-mail du compte pharmacie de la session.
import { getCors } from "./cors.js";
import { json, sb, sbAll, eq, identifyPharmacy, loadOperation, saveOrder, fail, slotIds } from "./_gp.js";
import { view, publicOp, isOpenNow } from "./_gp-view.js";
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
        const inOps = `operation_id=in.(${ops.map(o => o.id).join(",")})`;
        const [orders, qty, lines] = ops.length ? await Promise.all([
          sbAll(`gp_orders?pharmacy_id=${eq(ph.id)}&${inOps}&select=operation_id,status,confirmed_at`),
          sbAll(`gp_order_lines?pharmacy_id=${eq(ph.id)}&${inOps}&qty=gt.0&select=operation_id,line_id,slot_id,qty&order=operation_id.asc,line_id.asc,slot_id.asc`),
          sbAll(`gp_lines?${inOps}&select=id,operation_id&order=id.asc`),
        ]) : [[], [], []];
        const byOp = Object.fromEntries(orders.map(o => [o.operation_id, o]));
        // Liste : unités commandées (produits et dates encore présents) et nombre de produits par opération
        const lineOp = Object.fromEntries(lines.map(l => [l.id, l.operation_id]));
        const slotsOf = Object.fromEntries(ops.map(op => [op.id, slotIds(op)]));
        const units = {}, nProducts = {};
        for (const l of lines) nProducts[l.operation_id] = (nProducts[l.operation_id] || 0) + 1;
        for (const r of qty) if (lineOp[r.line_id] === r.operation_id && slotsOf[r.operation_id]?.has(r.slot_id)) units[r.operation_id] = (units[r.operation_id] || 0) + r.qty;
        return json(cors, 200, { operations: ops.map(op => ({ ...publicOp(op), products_count: nProducts[op.id] || 0,
          my_order: byOp[op.id] ? { ...byOp[op.id], units: units[op.id] || 0 } : null })) });
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
            const m = confirmationEmail({ op: fresh.op, summary: v.my_summary, bySlot: v.my_order.bySlot, freeBySlot: v.my_order.freeBySlot, stockByLine });
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

