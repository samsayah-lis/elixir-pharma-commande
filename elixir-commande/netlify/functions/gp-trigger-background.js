// ── Commandes groupées : création des devis Odoo d'une livraison (arrière-plan) ─
// Lancée par gp-admin (action « trigger »), jusqu'à 15 min. Pour chaque pharmacie
// ayant des quantités à cette date : devis brouillon dans Odoo, au prix brut de
// l'offre avec une remise unique regroupant remise sur facture, UG, RFA et
// coopération, frais de traitement inclus. Avancement dans kv_store
// (gp_trigger:<opération>:<date>).
// Sans doublon : (1) réservation gp_triggers avant la création, (2) repère
// [CG-xxxxxxxx-date] dans la référence client, retrouvé si un essai a été coupé.
import { isCronAuthorized } from "./auth.js";
import { sb, sbAll, eq, odoo, loadOperation, summarize, COMPANY_ID } from "./_gp.js";
import { priceOrder, odooLine, IMMEDIATE_SLOT } from "../../src/gp-pricing.js";
import { kvSet } from "./_kv.js";

const lineLabel = (l) => l.cip ? `[${l.cip}] ${l.name}` : l.name;

export const handler = async (event) => {
  if (!isCronAuthorized(event)) return { statusCode: 403, body: "" };
  const { id, slot_id: slotId } = JSON.parse(event.body || "{}");
  if (!id || !slotId) return { statusCode: 400, body: "" };
  const key = `gp_trigger:${id}:${slotId}`;
  const report = { status: "en_cours", started_at: new Date().toISOString(), created: [], errors: [], skipped: 0, total: 0 };
  const save = () => kvSet(key, report);
  try {
    const data = await loadOperation(id);
    if (!data) throw new Error("Opération introuvable");
    const { op, lines } = data;
    const slot = (op.delivery_slots || []).find(s => s.id === slotId);
    if (slotId !== IMMEDIATE_SLOT && !slot) throw new Error("Date de livraison inconnue");
    report.slot = slotId === IMMEDIATE_SLOT ? "livraison immédiate" : (slot.label || slot.date);
    const date = slotId === IMMEDIATE_SLOT ? null : slot.date;
    const s = summarize(data);
    const targets = s.pharmacies.filter(p => p.order?.status === "confirmee" && Object.values(p.bySlot).some(sl => (sl[slotId] || 0) > 0));
    report.total = targets.length;
    const marker = `CG-${id.slice(0, 8)}-${slotId}`;
    const ctx = { context: { allowed_company_ids: [COMPANY_ID] } };
    const existing = Object.fromEntries((await sbAll(`gp_triggers?operation_id=eq.${id}&slot_id=${eq(slotId)}`)).map(t => [t.pharmacy_id, t]));
    await save();

    for (const p of targets) {
      const t = existing[p.id];
      if (t?.odoo_sale_order_id) { report.skipped++; continue; }
      if (!t) {
        const ins = await sb("gp_triggers?on_conflict=operation_id,slot_id,pharmacy_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
          body: { operation_id: id, slot_id: slotId, pharmacy_id: p.id } });
        if (!ins?.length) { report.skipped++; continue; }   // réservée par un autre passage
      }
      try {
        const partnerId = Number(p.id);
        if (!partnerId) throw new Error("fiche client Odoo inconnue");
        // Rattrapage : devis déjà créé par un essai interrompu ?
        const [found] = await odoo("sale.order", "search_read", [[["partner_id", "=", partnerId], ["client_order_ref", "ilike", `[${marker}]`],
          ["company_id", "=", COMPANY_ID], ["state", "!=", "cancel"]]], { fields: ["id", "name", "amount_untaxed"], limit: 1 });
        let so = found;
        if (!so) {
          const sum = priceOrder(op, lines, s.perPharmacyTotal[p.id] || {}, s.group, { free: s.free[p.id] || {}, groupNetAfterRfa: s.groupNetAfterRfa, feePct: p.fee_pct ?? op.fee_pct });
          const orderLines = [], expected = [];
          for (const r of sum.rows) {
            const billed = p.bySlot[r.line.id]?.[slotId] || 0;
            if (!billed) continue;
            if (!r.line.odoo_product_id) throw new Error(`produit ${r.line.cip} sans fiche Odoo`);
            // unités reçues (facturées + gratuites de cette livraison) au prix brut, remise = montant dû
            const free = p.freeBySlot?.[r.line.id]?.[slotId] || 0;
            const l = odooLine(r.gross, billed + free, billed * r.unitWithFee);
            orderLines.push([0, 0, { product_id: r.line.odoo_product_id, name: lineLabel(r.line) + (free ? ` (dont ${free} UG)` : ""), product_uom_qty: l.qty, price_unit: l.price_unit, discount: l.discount }]);
            expected.push({ price: l.price_unit, discount: l.discount });
          }
          if (!orderLines.length) { report.skipped++; await sb(`gp_triggers?operation_id=eq.${id}&slot_id=${eq(slotId)}&pharmacy_id=${eq(p.id)}&odoo_sale_order_id=is.null`, { method: "DELETE" }); continue; }
          const soId = await odoo("sale.order", "create", [{ partner_id: partnerId, company_id: COMPANY_ID,
            client_order_ref: `Commande groupée ${op.name}`.slice(0, 180) + ` [${marker}]`,
            origin: `Commande groupée — ${op.name} — ${report.slot}`.slice(0, 250),
            ...(date ? { commitment_date: `${date} 08:00:00` } : {}), order_line: orderLines }], ctx);
          // Garde-fou : les prix passés à la création doivent être ceux enregistrés (lignes dans l'ordre de création)
          const sol = await odoo("sale.order.line", "search_read", [[["order_id", "=", soId], ["display_type", "=", false]]],
            { fields: ["id", "price_unit", "discount"], order: "sequence,id" });
          const fixes = sol.map((l, i) => expected[i] && (Math.abs(l.price_unit - expected[i].price) > 0.001 || Math.abs(l.discount - expected[i].discount) > 0.001)
            ? [1, l.id, { price_unit: expected[i].price, discount: expected[i].discount }] : null).filter(Boolean);
          if (fixes.length) await odoo("sale.order", "write", [[soId], { order_line: fixes }], ctx);
          [so] = await odoo("sale.order", "read", [[soId]], { fields: ["id", "name", "amount_untaxed"] });
        }
        await sb(`gp_triggers?operation_id=eq.${id}&slot_id=${eq(slotId)}&pharmacy_id=${eq(p.id)}`, { method: "PATCH", body: { odoo_sale_order_id: so.id } });
        report.created.push({ id: p.id, name: p.name, so_id: so.id, so_name: so.name, amount_ht: so.amount_untaxed, recovered: !!found });
      } catch (e) {
        await sb(`gp_triggers?operation_id=eq.${id}&slot_id=${eq(slotId)}&pharmacy_id=${eq(p.id)}&odoo_sale_order_id=is.null`, { method: "DELETE" }).catch(() => {});
        report.errors.push({ id: p.id, name: p.name, error: e.message });
      }
      await save();
    }
    report.status = "termine";
  } catch (e) {
    console.error("gp-trigger", e);
    report.status = "erreur";
    report.error = e.message || String(e);
  }
  report.finished_at = new Date().toISOString();
  await save().catch(() => {});
  return { statusCode: 200, body: "" };
};
