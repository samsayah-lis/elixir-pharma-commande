// ── Commandes groupées : administration ─────────────────────────────────
// GET  ?action=list | get&id= | access | pharmacies&q= | suppliers&q= | import_status&job=
// POST { action: save | delete | status | access_add | access_remove | participants |
//        lookup | order_save | po_create | trigger }
import crypto from "node:crypto";
import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
import { json, sb, inList, odoo, productInfo, loadOperation, summarize, saveOrder, today, COMPANY_ID } from "./_gp.js";
import { priceLine, priceOrder, round2, IMMEDIATE_SLOT } from "../../src/gp-pricing.js";

const OP_FIELDS = ["name", "supplier_name", "supplier_odoo_id", "status", "start_date", "end_date", "tier_mode", "fee_pct",
  "centralizer_type", "centralizer_cip", "centralizer_name", "objective_type", "objective_value", "delivery_slots",
  "rfa_pct", "coop_mode", "coop_amount", "coop_label", "conditions_text", "notes"];
const LINE_FIELDS = ["cip", "name", "odoo_product_id", "price_gross", "discount_mode", "discount_pct", "discount_tiers",
  "ug_tiers", "weight", "vat_rate", "notes"];
const STATUSES = ["brouillon", "ouverte", "cloturee", "commandee", "terminee", "annulee"];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k] === "" ? null : o[k]]));
const slotDate = (op, slotId) => slotId === IMMEDIATE_SLOT ? today() : ((op.delivery_slots || []).find(s => s.id === slotId)?.date || op.end_date || today());
const slotLabel = (op, slotId) => slotId === IMMEDIATE_SLOT ? "livraison immédiate" : ((op.delivery_slots || []).find(s => s.id === slotId)?.label || `livraison du ${slotDate(op, slotId)}`);
const lineLabel = (l) => l.cip ? `[${l.cip}] ${l.name}` : l.name;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;
  try {
    if (event.httpMethod === "GET") return json(cors, 200, await get(event.queryStringParameters || {}));
    if (event.httpMethod === "POST") return json(cors, 200, await post(JSON.parse(event.body || "{}"), event));
    return json(cors, 405, { error: "Méthode non autorisée" });
  } catch (e) {
    console.error("gp-admin", e);
    return json(cors, e.status || 500, { error: e.message || String(e) });
  }
};

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function get(q) {
  switch (q.action) {
    case "list": {
      const [ops, parts, orders] = await Promise.all([
        sb("gp_operations?order=created_at.desc"),
        sb("gp_participants?select=operation_id"),
        sb("gp_orders?status=eq.confirmee&select=operation_id"),
      ]);
      const count = (rows) => rows.reduce((m, r) => (m[r.operation_id] = (m[r.operation_id] || 0) + 1, m), {});
      const p = count(parts || []), o = count(orders || []);
      const trig = await sb("gp_triggers?select=operation_id,slot_id");
      const done = new Set((trig || []).map(t => `${t.operation_id}|${t.slot_id}`));
      return { operations: (ops || []).map(op => ({ ...op, participants_count: p[op.id] || 0, orders_count: o[op.id] || 0,
        pending_slots: pendingSlots(op, done) })) };
    }
    case "get": {
      const data = await loadOperation(q.id);
      if (!data) throw fail("Opération introuvable", 404);
      const [products, triggers] = await Promise.all([
        productInfo(data.lines.map(l => l.cip)).catch(e => ({ _error: e.message })),
        sb(`gp_triggers?operation_id=eq.${data.op.id}`),
      ]);
      return { ...data, products, triggers, summary: summarize(data) };
    }
    case "access":
      return { access: await sb("gp_access?order=pharmacy_name.asc") };
    case "pharmacies": {
      const s = String(q.q || "").trim().replace(/[*,()]/g, " ");
      if (s.length < 2) return { pharmacies: [] };
      const f = /^\d+$/.test(s) ? `cip=like.${encodeURIComponent(s)}*` : `or=(name.ilike.*${encodeURIComponent(s)}*,ville.ilike.*${encodeURIComponent(s)}*,email.ilike.*${encodeURIComponent(s)}*)`;
      return { pharmacies: await sb(`elixir_pharmacies?${f}&select=cip,name,email,ville,odoo_id&order=name.asc&limit=25`) };
    }
    case "suppliers": {
      const s = String(q.q || "").trim();
      if (s.length < 2) return { suppliers: [] };
      const rows = await odoo("res.partner", "search_read", [[["supplier_rank", ">", 0], ["name", "ilike", s], ["company_id", "in", [false, COMPANY_ID]]]],
        { fields: ["id", "name"], limit: 20, order: "supplier_rank desc" });
      return { suppliers: rows };
    }
    case "import_status": {
      const [row] = await sb(`kv_store?key=eq.${encodeURIComponent("gp_import:" + q.job)}&select=value`);
      return row ? row.value : { status: "inconnu" };
    }
    default:
      throw fail("Action inconnue");
  }
}

// Livraisons (hors immédiat) dont la date est atteinte et pas encore déclenchées
function pendingSlots(op, done) {
  if (!["cloturee", "commandee"].includes(op.status)) return [];
  const limit = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  return (op.delivery_slots || []).filter(s => s.date && s.date <= limit && !done.has(`${op.id}|${s.id}`)).map(s => s.id);
}

async function post(b, event) {
  switch (b.action) {
    case "save": return saveOperation(b.operation || {}, b.lines || []);
    case "delete":
      await sb(`gp_operations?id=eq.${encodeURIComponent(b.id)}`, { method: "DELETE" });
      return { ok: true };
    case "status": {
      if (!STATUSES.includes(b.status)) throw fail("Statut invalide");
      const [op] = await sb(`gp_operations?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", prefer: "return=representation",
        body: { status: b.status, updated_at: new Date().toISOString() } });
      return { operation: op };
    }
    case "access_add": {
      const rows = (b.pharmacies || []).filter(p => p.cip).map(p => ({ pharmacy_cip: String(p.cip), pharmacy_name: p.name || null, email: p.email || null }));
      if (rows.length) await sb("gp_access?on_conflict=pharmacy_cip", { method: "POST", prefer: "resolution=merge-duplicates", body: rows });
      return { access: await sb("gp_access?order=pharmacy_name.asc") };
    }
    case "access_remove":
      await sb(`gp_access?pharmacy_cip=eq.${encodeURIComponent(b.cip)}`, { method: "DELETE" });
      return { access: await sb("gp_access?order=pharmacy_name.asc") };
    case "participants": {
      const id = b.id;
      const wanted = (b.pharmacies || []).filter(p => p.cip).map(p => ({ operation_id: id, pharmacy_cip: String(p.cip),
        pharmacy_name: p.name || null, email: p.email || null, fee_pct: p.fee_pct === "" || p.fee_pct == null ? null : Number(p.fee_pct) }));
      const current = await sb(`gp_participants?operation_id=eq.${id}&select=pharmacy_cip`);
      const keep = new Set(wanted.map(w => w.pharmacy_cip));
      const gone = (current || []).map(c => c.pharmacy_cip).filter(c => !keep.has(c));
      if (gone.length) await sb(`gp_participants?operation_id=eq.${id}&pharmacy_cip=in.${inList(gone)}`, { method: "DELETE" });
      if (wanted.length) await sb("gp_participants?on_conflict=operation_id,pharmacy_cip", { method: "POST", prefer: "resolution=merge-duplicates", body: wanted });
      // un participant voit forcément l'onglet
      if (wanted.length) await sb("gp_access?on_conflict=pharmacy_cip", { method: "POST", prefer: "resolution=ignore-duplicates",
        body: wanted.map(w => ({ pharmacy_cip: w.pharmacy_cip, pharmacy_name: w.pharmacy_name, email: w.email })) });
      return { participants: await sb(`gp_participants?operation_id=eq.${id}&order=pharmacy_name.asc`) };
    }
    case "lookup":
      return { products: await productInfo(b.cips || []) };
    case "order_save": {
      // saisie par Elixir pour le compte d'une pharmacie (commande reçue par téléphone, mail…)
      const data = await loadOperation(b.id);
      if (!data) throw fail("Opération introuvable", 404);
      const part = data.participants.find(p => p.pharmacy_cip === b.cip);
      if (!part) throw fail("Cette pharmacie ne participe pas à l'opération");
      const r = await saveOrder({ data, pharmacy: { cip: part.pharmacy_cip, name: part.pharmacy_name, email: part.email }, entries: b.entries, source: "formulaire" });
      return { ok: true, ...r };
    }
    case "po_create": return createPurchaseOrder(b.id);
    case "trigger": return triggerSlot(b.id, b.slot_id);
    default:
      throw fail("Action inconnue");
  }
}

// ── Création / mise à jour d'une opération et de ses lignes ─────────────
async function saveOperation(opIn, linesIn) {
  const id = opIn.id || crypto.randomUUID();
  const op = { id, ...pick(opIn, OP_FIELDS), updated_at: new Date().toISOString() };
  if (!op.name) throw fail("Nom de l'opération requis");
  for (const [k, def] of [["fee_pct", 2], ["rfa_pct", 0], ["coop_amount", 0]]) if (k in op) op[k] = op[k] == null || isNaN(Number(op[k])) ? def : Number(op[k]);
  if ("objective_value" in op) op.objective_value = op.objective_value == null || isNaN(Number(op.objective_value)) ? null : Number(op.objective_value);
  if (op.status && !STATUSES.includes(op.status)) delete op.status;
  if (op.delivery_slots) op.delivery_slots = (op.delivery_slots || []).map(s => ({ id: s.id || crypto.randomUUID().slice(0, 8), date: s.date || null, label: s.label || null }));
  // fiches Odoo manquantes (id produit, TVA) complétées automatiquement
  const missing = linesIn.filter(l => l.cip && (!l.odoo_product_id || l.vat_rate == null || l.vat_rate === "")).map(l => l.cip);
  const info = missing.length ? await productInfo(missing).catch(() => ({})) : {};
  const lines = linesIn.filter(l => String(l.cip || "").trim() && String(l.name || "").trim()).map((l, i) => {
    const x = info[String(l.cip).trim()] || {};
    return { id: l.id || crypto.randomUUID(), operation_id: id, position: i, ...pick(l, LINE_FIELDS),
      cip: String(l.cip).trim(),
      odoo_product_id: l.odoo_product_id || x.odoo_product_id || null,
      vat_rate: l.vat_rate === "" || l.vat_rate == null ? (x.vat_rate ?? null) : Number(l.vat_rate),
      price_gross: Number(l.price_gross) || 0, discount_pct: Number(l.discount_pct) || 0, weight: Number(l.weight) || 1,
      discount_mode: l.discount_mode || "aucune", discount_tiers: l.discount_tiers || [], ug_tiers: l.ug_tiers || [] };
  });
  const [saved] = await sb("gp_operations?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: op });
  const current = await sb(`gp_lines?operation_id=eq.${id}&select=id`);
  const keep = new Set(lines.map(l => l.id));
  const gone = (current || []).map(c => c.id).filter(x => !keep.has(x));
  if (gone.length) await sb(`gp_lines?id=in.${inList(gone)}`, { method: "DELETE" });
  if (lines.length) await sb("gp_lines?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates", body: lines });
  return { operation: saved, lines: await sb(`gp_lines?operation_id=eq.${id}&order=position.asc`) };
}

// ── Bon de commande au laboratoire (Odoo, brouillon) ────────────────────
// Une ligne par produit et par date de livraison ; prix brut + remise = remise
// sur facture et UG converties (la RFA et la coopération ne sont pas sur le bon).
async function createPurchaseOrder(id) {
  const data = await loadOperation(id);
  if (!data) throw fail("Opération introuvable", 404);
  const { op, lines } = data;
  if (op.po_odoo_id) throw fail(`Bon de commande déjà créé (Odoo #${op.po_odoo_id})`);
  if (!op.supplier_odoo_id) throw fail("Choisissez d'abord le fournisseur Odoo de l'opération");
  const s = summarize(data);
  const noRfa = { ...op, rfa_pct: 0 };
  const pids = lines.map(l => l.odoo_product_id).filter(Boolean);
  const uoms = pids.length ? await odoo("product.product", "read", [pids], { fields: ["uom_id"] }) : [];
  const uomOf = Object.fromEntries(uoms.map(p => [p.id, p.uom_id?.[0]]));
  const orderLines = [], skipped = [];
  for (const l of lines) {
    const total = s.group[l.id] || 0;
    if (!total) continue;
    if (!l.odoo_product_id) { skipped.push(l.cip); continue; }
    // prix net labo moyen (mode individuel : chaque pharmacie a son propre palier)
    let value = 0;
    if (op.tier_mode === "individuel") for (const qs of Object.values(s.perPharmacyTotal)) { const q = qs[l.id] || 0; if (q) value += q * priceLine(noRfa, l, q, q).unitAfterUg; }
    else value = total * priceLine(noRfa, l, total, total).unitAfterUg;
    const gross = Number(l.price_gross) || 0;
    const discount = gross > 0 ? round2(Math.max(0, (1 - value / total / gross) * 100)) : 0;
    for (const [slotId, q] of Object.entries(s.groupBySlot[l.id] || {})) {
      if (!q) continue;
      const slot = slotId === IMMEDIATE_SLOT ? (op.end_date || today()) : slotDate(op, slotId);
      orderLines.push([0, 0, { product_id: l.odoo_product_id, name: lineLabel(l), product_qty: q, price_unit: gross, discount,
        date_planned: `${slot} 08:00:00`, ...(uomOf[l.odoo_product_id] ? { product_uom: uomOf[l.odoo_product_id] } : {}) }]);
    }
  }
  if (!orderLines.length) throw fail("Aucune quantité confirmée à commander");
  const ctx = { context: { allowed_company_ids: [COMPANY_ID] } };
  const poId = await odoo("purchase.order", "create", [{ partner_id: op.supplier_odoo_id, company_id: COMPANY_ID,
    origin: `Commande groupée — ${op.name}`.slice(0, 250), order_line: orderLines }], ctx);
  const [po] = await odoo("purchase.order", "read", [[poId]], { fields: ["name", "amount_untaxed"] });
  await sb(`gp_operations?id=eq.${op.id}`, { method: "PATCH", body: { po_odoo_id: poId, po_created_at: new Date().toISOString(), status: "commandee", updated_at: new Date().toISOString() } });
  return { ok: true, po_id: poId, po_name: po?.name, amount_ht: po?.amount_untaxed, lines: orderLines.length, skipped };
}

// ── Déclenchement d'une livraison : devis Odoo par pharmacie ────────────
// Toutes les remises hors facture (UG, RFA, coopération) sont converties en
// remise sur facture ; les frais de traitement sont inclus dans le prix net.
async function triggerSlot(id, slotId) {
  const data = await loadOperation(id);
  if (!data) throw fail("Opération introuvable", 404);
  const { op, lines } = data;
  if (slotId !== IMMEDIATE_SLOT && !(op.delivery_slots || []).some(s => s.id === slotId)) throw fail("Date de livraison inconnue");
  const s = summarize(data);
  const done = new Set((await sb(`gp_triggers?operation_id=eq.${op.id}&slot_id=eq.${encodeURIComponent(slotId)}`) || []).map(t => t.pharmacy_cip));
  const targets = s.pharmacies.filter(p => p.order?.status === "confirmee" && Object.values(p.bySlot).some(sl => (sl[slotId] || 0) > 0) && !done.has(p.cip));
  if (!targets.length) return { ok: true, created: [], errors: [], already: done.size };
  const partners = await sb(`elixir_pharmacies?cip=in.${inList(targets.map(t => t.cip))}&select=cip,odoo_id`);
  const odooId = Object.fromEntries((partners || []).map(p => [p.cip, p.odoo_id]));
  const ctx = { context: { allowed_company_ids: [COMPANY_ID] } };
  const created = [], errors = [];
  for (const p of targets) {
    try {
      if (!odooId[p.cip]) throw new Error("fiche client Odoo absente (odoo_id)");
      const mine = s.perPharmacyTotal[p.cip] || {};
      const sum = priceOrder(op, lines, mine, s.group, { groupNetAfterRfa: s.groupNetAfterRfa, feePct: p.fee_pct ?? op.fee_pct });
      const orderLines = [], expected = [];
      for (const r of sum.rows) {
        const q = p.bySlot[r.line.id]?.[slotId] || 0;
        if (!q) continue;
        if (!r.line.odoo_product_id) throw new Error(`produit ${r.line.cip} sans fiche Odoo`);
        let price = r.gross, discount = r.gross > 0 ? round2((1 - r.unitWithFee / r.gross) * 100) : 0;
        if (discount < 0) { price = round2(r.unitWithFee); discount = 0; }   // frais > remises : pas de remise négative
        orderLines.push([0, 0, { product_id: r.line.odoo_product_id, name: lineLabel(r.line), product_uom_qty: q, price_unit: price, discount }]);
        expected.push({ product_id: r.line.odoo_product_id, price, discount });
      }
      if (!orderLines.length) continue;
      const soId = await odoo("sale.order", "create", [{ partner_id: odooId[p.cip], company_id: COMPANY_ID,
        client_order_ref: `CG ${op.name}`.slice(0, 250), origin: `Commande groupée — ${op.name} — ${slotLabel(op, slotId)}`.slice(0, 250),
        commitment_date: `${slotDate(op, slotId)} 08:00:00`, order_line: orderLines }], ctx);
      // garde-fou : la liste de prix du client ne doit pas écraser nos prix
      const sol = await odoo("sale.order.line", "search_read", [[["order_id", "=", soId]]], { fields: ["id", "product_id", "price_unit", "discount"] });
      for (const l of sol) {
        const e = expected.find(x => x.product_id === l.product_id?.[0]);
        if (e && (Math.abs(l.price_unit - e.price) > 0.001 || Math.abs(l.discount - e.discount) > 0.001)) {
          await odoo("sale.order.line", "write", [[l.id], { price_unit: e.price, discount: e.discount }], ctx);
        }
      }
      const [so] = await odoo("sale.order", "read", [[soId]], { fields: ["name", "amount_untaxed"] });
      await sb("gp_triggers", { method: "POST", body: { operation_id: op.id, slot_id: slotId, pharmacy_cip: p.cip, odoo_sale_order_id: soId } });
      created.push({ cip: p.cip, name: p.name, so_id: soId, so_name: so?.name, amount_ht: so?.amount_untaxed });
    } catch (e) {
      errors.push({ cip: p.cip, name: p.name, error: e.message });
    }
  }
  return { ok: errors.length === 0, created, errors, already: done.size };
}
