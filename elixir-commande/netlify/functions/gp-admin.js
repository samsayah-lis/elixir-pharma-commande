// ── Commandes groupées : administration ─────────────────────────────────
// GET  ?action=list | get&id= | access | pharmacies&q= | suppliers&q= | trigger_status&id=&slot_id=
// POST { action: save | delete | status | access_add | access_remove | lookup | order_save | po_create | trigger }
import crypto from "node:crypto";
import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
import { json, sb, sbAll, inList, eq, odoo, productInfo, loadOperation, summarize, saveOrder, refreshOrderStatus, today, fail, COMPANY_ID } from "./_gp.js";
import { labUnitNet, round2, IMMEDIATE_SLOT } from "../../src/gp-pricing.js";

// Le statut ne change que par l'action « status » (ou la création du bon labo), jamais par « save »
const OP_FIELDS = ["name", "supplier_name", "supplier_odoo_id", "start_date", "end_date", "tier_mode", "fee_pct",
  "centralizer_type", "centralizer_id", "centralizer_name", "objective_type", "objective_value", "delivery_slots",
  "rfa_pct", "coop_mode", "coop_amount", "coop_label", "conditions_text", "notes"];
const TRANSITIONS = { brouillon: ["ouverte"], ouverte: ["cloturee", "annulee"], cloturee: ["ouverte", "annulee"], commandee: ["terminee", "annulee"], terminee: [], annulee: [] };
const LOCKED = ["commandee", "terminee", "annulee"];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k] === "" ? null : o[k]]));
const num = (v, def = 0) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : def; };
const slotOf = (op, slotId) => (op.delivery_slots || []).find(s => s.id === slotId);
const slotLabel = (op, slotId) => slotId === IMMEDIATE_SLOT ? ((op.delivery_slots || []).length ? "livraison immédiate" : "livraison à réception") : (slotOf(op, slotId)?.label || `livraison du ${slotOf(op, slotId)?.date || ""}`);
const lineLabel = (l) => l.cip ? `[${l.cip}] ${l.name}` : l.name;
const newSlotId = () => crypto.randomUUID().slice(0, 8);
// Ligne gp_lines avec toujours les mêmes colonnes (PostgREST refuse un envoi groupé aux clés différentes)
const lineRow = (l, opId, position) => ({
  id: l.id, operation_id: opId, position, cip: l.cip, name: l.name,
  odoo_product_id: l.odoo_product_id || null, price_gross: num(l.price_gross, 0),
  discount_mode: ["aucune", "unitaire", "paliers"].includes(l.discount_mode) ? l.discount_mode : "aucune",
  discount_pct: num(l.discount_pct, 0),
  discount_tiers: (Array.isArray(l.discount_tiers) ? l.discount_tiers : []).map(t => ({ min_qty: num(t.min_qty), pct: num(t.pct) })).filter(t => t.min_qty > 0 && t.pct > 0),
  ug_tiers: (Array.isArray(l.ug_tiers) ? l.ug_tiers : []).map(t => ({ min_qty: num(t.min_qty), free_qty: num(t.free_qty) })).filter(t => t.min_qty > 0 && t.free_qty > 0),
  weight: num(l.weight, 1) || 1, vat_rate: l.vat_rate == null || l.vat_rate === "" ? null : num(l.vat_rate, null), notes: l.notes || null,
});

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
    if (!e.status) console.error("gp-admin", e);
    return json(cors, e.status || 500, { error: e.message || String(e), ...(e.extra || {}) });
  }
};

// ── Livraisons restant à déclencher (pharmacies avec quantités − devis créés) ──
function slotProgress(op, qtyRows, confirmedIds, triggers) {
  const out = {};
  const need = {};
  for (const r of qtyRows) if (r.operation_id === op.id && confirmedIds.has(r.pharmacy_id)) (need[r.slot_id] ||= new Set()).add(r.pharmacy_id);
  const done = {};
  for (const t of triggers) if (t.operation_id === op.id && t.odoo_sale_order_id) (done[t.slot_id] ||= new Set()).add(t.pharmacy_id);
  for (const [slot, set] of Object.entries(need)) out[slot] = { pharmacies: set.size, done: [...set].filter(id => done[slot]?.has(id)).length };
  return out;
}

async function get(q) {
  switch (q.action) {
    case "list": {
      const ops = await sbAll("gp_operations?order=created_at.desc");
      const [parts, orders] = await Promise.all([sbAll("gp_participants?select=operation_id,pharmacy_id"), sbAll("gp_orders?status=eq.confirmee&select=operation_id,pharmacy_id")]);
      const active = ops.filter(o => ["cloturee", "commandee"].includes(o.status)).map(o => o.id);
      const [qty, trig] = active.length ? await Promise.all([
        sbAll(`gp_order_lines?operation_id=in.${encodeURIComponent(inList(active))}&qty=gt.0&select=operation_id,pharmacy_id,slot_id`),
        sbAll(`gp_triggers?operation_id=in.${encodeURIComponent(inList(active))}&select=operation_id,slot_id,pharmacy_id,odoo_sale_order_id`),
      ]) : [[], []];
      const limit = new Date(Date.now() + 2 * 86400e3).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
      return { operations: ops.map(op => {
        const pIds = new Set(parts.filter(p => p.operation_id === op.id).map(p => p.pharmacy_id));
        const conf = new Set(orders.filter(o => o.operation_id === op.id && pIds.has(o.pharmacy_id)).map(o => o.pharmacy_id));
        const prog = active.includes(op.id) ? slotProgress(op, qty, conf, trig) : {};
        const pending = (op.delivery_slots || []).filter(s => s.date && s.date <= limit && prog[s.id] && prog[s.id].done < prog[s.id].pharmacies).map(s => s.id);
        if (prog[IMMEDIATE_SLOT] && prog[IMMEDIATE_SLOT].done < prog[IMMEDIATE_SLOT].pharmacies) pending.push(IMMEDIATE_SLOT);
        return { ...op, participants_count: pIds.size, orders_count: conf.size, pending_slots: pending };
      }) };
    }
    case "get": {
      const data = await loadOperation(q.id);
      if (!data) throw fail("Opération introuvable", 404);
      const [products, triggers] = await Promise.all([
        productInfo(data.lines.map(l => l.cip)).catch(e => ({ _error: e.message })),
        sbAll(`gp_triggers?operation_id=eq.${data.op.id}`),
      ]);
      return { ...data, products, triggers, summary: summarize(data) };
    }
    case "access":
      return { access: await sbAll("gp_access?order=pharmacy_name.asc") };
    case "pharmacies": {
      // Comptes pharmacies du site = clients Elixir uniquement (voir pharmacy-sync-now), regroupés par fiche Odoo
      const s = String(q.q || "").trim().replace(/[*,()"\\:]/g, " ").trim();
      if (s.length < 2) return { pharmacies: [] };
      const v = encodeURIComponent(`*${s}*`);
      const rows = await sb(`elixir_pharmacies?or=(name.ilike.${v},ville.ilike.${v},email.ilike.${v},cip.ilike.${v})&odoo_id=not.is.null&select=cip,name,email,ville,odoo_id&order=name.asc&limit=80`);
      const by = new Map();
      for (const r of rows || []) {
        const k = String(r.odoo_id);
        if (!by.has(k)) by.set(k, { id: k, name: r.name, ville: r.ville, cip: r.cip && r.cip !== "0" ? r.cip : "", email: r.email, emails: [] });
        by.get(k).emails.push(r.email);
      }
      return { pharmacies: [...by.values()].slice(0, 30) };
    }
    case "suppliers": {
      const s = String(q.q || "").trim();
      if (s.length < 2) return { suppliers: [] };
      const rows = await odoo("res.partner", "search_read", [[["supplier_rank", ">", 0], ["name", "ilike", s], ["company_id", "in", [false, COMPANY_ID]]]],
        { fields: ["id", "name"], limit: 20, order: "supplier_rank desc" });
      return { suppliers: rows };
    }
    case "trigger_status": {
      const [row] = await sb(`kv_store?key=${eq(`gp_trigger:${q.id}:${q.slot_id}`)}&select=value`);
      if (!row) return { status: "aucun" };
      const v = row.value;
      // fonction d'arrière-plan tuée ou jamais démarrée : on rend la main (la relance ne crée pas de doublon)
      if (v.status === "en_cours" && Date.now() - Date.parse(v.started_at) > 16 * 60e3) return { ...v, status: "erreur", error: "Création interrompue : relancez (les devis déjà créés ne seront pas dupliqués)" };
      return v;
    }
    default:
      throw fail("Action inconnue");
  }
}

async function post(b, event) {
  switch (b.action) {
    case "save": return saveOperation(b);
    case "delete": {
      const [op] = await sb(`gp_operations?id=${eq(b.id)}&select=status`);
      if (!op) throw fail("Opération introuvable", 404);
      if (op.status !== "brouillon") throw fail("Seule une opération en brouillon peut être supprimée ; sinon, annulez-la.");
      await sb(`gp_operations?id=${eq(b.id)}`, { method: "DELETE" });
      return { ok: true };
    }
    case "status": return changeStatus(b.id, b.status);
    case "access_add": {
      const rows = (b.pharmacies || []).filter(p => p.id).map(p => ({ pharmacy_id: String(p.id), pharmacy_name: p.name || null, email: p.email || null, pharmacy_cip: p.cip || null }));
      if (rows.length) await sb("gp_access?on_conflict=pharmacy_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows });
      return { access: await sbAll("gp_access?order=pharmacy_name.asc") };
    }
    case "access_remove":
      await sb(`gp_access?pharmacy_id=${eq(b.id)}`, { method: "DELETE" });
      return { access: await sbAll("gp_access?order=pharmacy_name.asc") };
    case "lookup":
      return { products: await productInfo(b.cips || []) };
    case "order_save": {
      // saisie par Elixir pour le compte d'une pharmacie (commande reçue par téléphone, mail…)
      const data = await loadOperation(b.id);
      if (!data) throw fail("Opération introuvable", 404);
      if (!["ouverte", "cloturee"].includes(data.op.status)) throw fail("Les commandes ne sont plus modifiables à ce stade");
      const part = data.participants.find(p => p.pharmacy_id === String(b.pharmacy_id));
      if (!part) throw fail("Cette pharmacie ne participe pas à l'opération");
      const r = await saveOrder({ data, pharmacy: { id: part.pharmacy_id, name: part.pharmacy_name, email: part.email }, entries: b.entries, source: "formulaire" });
      return { ok: true, ...r };
    }
    case "po_create": return createPurchaseOrder(b.id);
    case "trigger": return startTrigger(b.id, b.slot_id, event);
    default:
      throw fail("Action inconnue");
  }
}

// ── Changement de statut ────────────────────────────────────────────────
async function changeStatus(id, status) {
  const data = await loadOperation(id);
  if (!data) throw fail("Opération introuvable", 404);
  const { op, lines, participants } = data;
  if (!(TRANSITIONS[op.status] || []).includes(status)) throw fail(`Passage de « ${op.status} » à « ${status} » impossible`);
  if (status === "ouverte") {
    const problems = [];
    if (!lines.length) problems.push("aucun produit");
    if (!participants.length) problems.push("aucune pharmacie participante");
    if (!op.end_date) problems.push("date de fin (clôture) manquante");
    const noPrice = lines.filter(l => !(Number(l.price_gross) > 0)).map(l => l.name);
    if (noPrice.length) problems.push(`prix brut manquant : ${noPrice.slice(0, 5).join(", ")}${noPrice.length > 5 ? "…" : ""}`);
    const noOdoo = lines.filter(l => !l.odoo_product_id).map(l => l.cip);
    if (noOdoo.length) problems.push(`produits sans fiche Odoo : ${noOdoo.slice(0, 5).join(", ")}${noOdoo.length > 5 ? "…" : ""}`);
    if ((op.delivery_slots || []).some(s => !s.date)) problems.push("une date de livraison n'a pas de date");
    if (op.status === "cloturee") {
      const trig = await sb(`gp_triggers?operation_id=eq.${id}&select=slot_id&limit=1`);
      if (op.po_odoo_id || op.po_created_at || trig.length) problems.push("le bon labo ou des devis ont déjà été créés");
    }
    if (problems.length) throw fail(`Impossible d'ouvrir l'opération : ${problems.join(" ; ")}`);
  }
  const [saved] = await sb(`gp_operations?id=eq.${id}&status=${eq(op.status)}`, { method: "PATCH", prefer: "return=representation",
    body: { status, updated_at: new Date().toISOString() } });
  if (!saved) throw fail("Le statut a été modifié entre-temps : rechargez l'opération", 409, { code: "stale" });
  return { operation: saved };
}

// ── Création / mise à jour d'une opération, de ses produits et participants ──
async function saveOperation(b) {
  const opIn = b.operation || {};
  const isNew = !opIn.id;
  const id = opIn.id || crypto.randomUUID();
  const force = !!b.force;
  const now = new Date().toISOString();
  const cur = isNew ? { op: null, lines: [], qty: [], participants: [], orders: [] } : await loadOperation(id);
  if (!cur) throw fail("Opération introuvable", 404);
  if (!isNew && b.loaded_updated_at && cur.op.updated_at !== b.loaded_updated_at)
    throw fail("Cette opération a été modifiée ailleurs (autre onglet ou autre personne) : rechargez-la avant d'enregistrer.", 409, { code: "stale" });
  const status = cur.op?.status || "brouillon";

  // Opération verrouillée : seules les notes et les conditions restent modifiables
  if (LOCKED.includes(status)) {
    const [saved] = await sb(`gp_operations?id=eq.${id}`, { method: "PATCH", prefer: "return=representation",
      body: { notes: opIn.notes ?? cur.op.notes, conditions_text: opIn.conditions_text ?? cur.op.conditions_text, updated_at: now } });
    return { operation: saved, locked: true };
  }

  // ── Opération ──
  const op = { id, ...pick(opIn, OP_FIELDS), updated_at: now };
  if (!String(op.name || "").trim()) throw fail("Nom de l'opération requis");
  for (const [k, def] of [["fee_pct", 2], ["rfa_pct", 0], ["coop_amount", 0]]) if (k in op) op[k] = op[k] == null ? def : num(op[k], def);
  if ("objective_value" in op) op.objective_value = op.objective_value == null ? null : num(op.objective_value, null);
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && !isNaN(Date.parse(d + "T00:00:00Z"));
  for (const k of ["start_date", "end_date"]) if (op[k] != null && !isDate(op[k])) throw fail(`Date invalide : ${op[k]}`);
  if (op.start_date && op.end_date && op.end_date < op.start_date) throw fail("La date de fin est avant la date de début");
  const triggers = isNew ? [] : await sb(`gp_triggers?operation_id=eq.${id}&select=slot_id`);
  let removedSlots = [];
  if (Array.isArray(op.delivery_slots)) {
    op.delivery_slots = op.delivery_slots.map(s => ({ id: s.id || newSlotId(), date: s.date || null, label: s.label || null }));
    if (op.delivery_slots.some(s => !s.date)) throw fail("Chaque livraison doit avoir une date");
    const bad = op.delivery_slots.filter(s => !isDate(s.date));
    if (bad.length) throw fail(`Date de livraison invalide : ${bad.map(s => s.date).join(", ")}`);
    const keepSlots = new Set(op.delivery_slots.map(s => s.id));
    removedSlots = (cur.op?.delivery_slots || []).filter(s => !keepSlots.has(s.id));
    const trig = removedSlots.filter(s => triggers.some(t => t.slot_id === s.id));
    if (trig.length) throw fail(`Livraison déjà déclenchée, impossible de la supprimer : ${trig.map(s => s.label || s.date).join(", ")}`);
  }

  // ── Produits ──
  const byIdCur = new Map(cur.lines.map(l => [l.id, l]));
  let lines = (b.lines || []).map(l => ({ ...l, cip: String(l.cip || "").replace(/\s/g, ""), name: String(l.name || "").trim() })).filter(l => l.cip || l.name);
  const noCip = lines.filter(l => !l.cip);
  if (noCip.length) throw fail(`CIP manquant pour : ${noCip.map(l => l.name).join(", ")}`);
  const seen = new Set(), dups = new Set();
  for (const l of lines) { if (seen.has(l.cip)) dups.add(l.cip); seen.add(l.cip); }
  if (dups.size) throw fail(`Produit en double dans l'opération : ${[...dups].join(", ")}`);
  // CIP modifié sur une ligne existante : la fiche Odoo et la TVA de l'ancien produit ne valent plus
  lines = lines.map(l => { const prev = l.id && byIdCur.get(l.id); return prev && prev.cip !== l.cip ? { ...l, odoo_product_id: null, vat_rate: null } : l; });
  const toResolve = lines.filter(l => !l.odoo_product_id || l.vat_rate == null || l.vat_rate === "" || !l.name).map(l => l.cip);
  const info = toResolve.length ? await productInfo(toResolve).catch(() => ({})) : {};
  const noName = [];
  lines = lines.map((l, i) => {
    const x = info[l.cip] || {};
    const name = l.name || x.odoo_name || "";
    if (!name) noName.push(l.cip);
    const price = num(l.price_gross, 0);
    return lineRow({ ...l, name, price_gross: price,
      id: l.id && /^[0-9a-f-]{36}$/i.test(l.id) ? l.id : crypto.randomUUID(),
      odoo_product_id: l.odoo_product_id || x.odoo_product_id || null,
      vat_rate: l.vat_rate === "" || l.vat_rate == null ? (x.vat_rate ?? null) : num(l.vat_rate, null) }, id, i);
  });
  if (noName.length) throw fail(`Désignation manquante (produit introuvable dans Odoo) pour : ${noName.join(", ")}`);
  if (status !== "brouillon") {
    const noPrice = lines.filter(l => !(l.price_gross > 0)).map(l => l.name);
    if (noPrice.length) throw fail(`Prix brut manquant pour : ${noPrice.join(", ")}`);
    const noOdoo = lines.filter(l => !l.odoo_product_id).map(l => `${l.name} (${l.cip})`);
    if (noOdoo.length) throw fail(`Produit sans fiche Odoo, impossible une fois l'opération ouverte : ${noOdoo.join(", ")}. Créez d'abord la fiche dans Odoo.`);
  }
  // Suppressions : seulement les lignes que l'écran connaissait (un produit ajouté ailleurs n'est pas effacé)
  const known = new Set(Array.isArray(b.loaded_line_ids) ? b.loaded_line_ids : cur.lines.map(l => l.id));
  const keepLines = new Set(lines.map(l => l.id));
  const goneLines = cur.lines.filter(l => known.has(l.id) && !keepLines.has(l.id));
  const extra = cur.lines.filter(l => !known.has(l.id) && !keepLines.has(l.id));
  for (const l of extra) lines.push(lineRow(l, id, lines.length));

  // ── Participants ──
  let wanted = null, goneParts = [];
  if (Array.isArray(b.participants)) {
    wanted = b.participants.filter(p => p.id).map(p => ({ operation_id: id, pharmacy_id: String(p.id), pharmacy_name: p.name || null, email: p.email || null,
      pharmacy_cip: p.cip || null, fee_pct: p.fee_pct === "" || p.fee_pct == null ? null : num(p.fee_pct, null) }));
    const keepP = new Set(wanted.map(w => w.pharmacy_id));
    goneParts = cur.participants.filter(p => !keepP.has(p.pharmacy_id));
  }
  if (op.centralizer_type === "pharmacie" && op.centralizer_id && wanted && !wanted.some(w => w.pharmacy_id === String(op.centralizer_id)))
    throw fail("La pharmacie centralisatrice doit faire partie des participantes");

  // ── Quantités touchées : confirmation explicite requise ──
  const goneLineIds = new Set(goneLines.map(l => l.id)), goneSlotIds = new Set(removedSlots.map(s => s.id)), gonePartIds = new Set(goneParts.map(p => p.pharmacy_id));
  const hit = cur.qty.filter(r => goneLineIds.has(r.line_id) || goneSlotIds.has(r.slot_id) || gonePartIds.has(r.pharmacy_id));
  if (hit.length) {
    const units = (rows) => rows.reduce((s, r) => s + r.qty, 0);
    const phs = (rows) => new Set(rows.map(r => r.pharmacy_id)).size;
    const details = [
      ...goneLines.map(l => { const r = hit.filter(x => x.line_id === l.id); return r.length ? `produit « ${l.name} » : ${units(r)} u. commandées par ${phs(r)} pharmacie(s)` : null; }),
      ...removedSlots.map(s => { const r = hit.filter(x => x.slot_id === s.id); return r.length ? `livraison « ${s.label || s.date} » : ${units(r)} u. commandées par ${phs(r)} pharmacie(s)` : null; }),
      ...goneParts.map(p => { const r = hit.filter(x => x.pharmacy_id === p.pharmacy_id); return r.length ? `pharmacie « ${p.pharmacy_name} » : ${units(r)} u. commandées` : null; }),
    ].filter(Boolean);
    // Suppression forcée seulement si elle porte exactement sur ce qui a été annoncé à l'écran
    if (!force || b.confirmed_details !== JSON.stringify(details))
      throw fail(force ? "Des quantités ont changé depuis votre confirmation" : "Ces modifications effacent des quantités déjà commandées", 409, { code: "confirm", details });
  }

  // ── Écritures ──
  let saved;
  if (isNew) {
    [saved] = await sb("gp_operations", { method: "POST", prefer: "return=representation", body: { ...op, status: "brouillon" } });
  } else {
    [saved] = await sb(`gp_operations?id=eq.${id}&updated_at=${eq(cur.op.updated_at)}`, { method: "PATCH", prefer: "return=representation", body: op });
    if (!saved) throw fail("Cette opération a été modifiée ailleurs : rechargez-la avant d'enregistrer.", 409, { code: "stale" });
  }
  if (hit.length) {
    for (const lid of goneLineIds) await sb(`gp_order_lines?operation_id=eq.${id}&line_id=eq.${lid}`, { method: "DELETE" });
    for (const sid of goneSlotIds) await sb(`gp_order_lines?operation_id=eq.${id}&slot_id=${eq(sid)}`, { method: "DELETE" });
    for (const pid of gonePartIds) await sb(`gp_order_lines?operation_id=eq.${id}&pharmacy_id=${eq(pid)}`, { method: "DELETE" });
  }
  if (goneLines.length) await sb(`gp_lines?id=in.${encodeURIComponent(inList(goneLines.map(l => l.id)))}`, { method: "DELETE" });
  if (lines.length) await sb("gp_lines?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: lines });
  if (wanted) {
    if (goneParts.length) {
      await sb(`gp_orders?operation_id=eq.${id}&pharmacy_id=in.${encodeURIComponent(inList([...gonePartIds]))}`, { method: "DELETE" });
      await sb(`gp_participants?operation_id=eq.${id}&pharmacy_id=in.${encodeURIComponent(inList([...gonePartIds]))}`, { method: "DELETE" });
    }
    if (wanted.length) await sb("gp_participants?on_conflict=operation_id,pharmacy_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: wanted });
    // seules les NOUVELLES participantes reçoivent l'accès à l'onglet (un retrait d'accès reste acquis)
    const before = new Set(cur.participants.map(p => p.pharmacy_id));
    const added = wanted.filter(w => !before.has(w.pharmacy_id));
    if (added.length) await sb("gp_access?on_conflict=pharmacy_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: added.map(w => ({ pharmacy_id: w.pharmacy_id, pharmacy_name: w.pharmacy_name, email: w.email, pharmacy_cip: w.pharmacy_cip })) });
  }
  if (hit.length) await refreshOrderStatus(id, [...new Set(hit.map(r => r.pharmacy_id))].filter(pid => !gonePartIds.has(pid)));
  return { operation: saved, id };
}

// ── Bon de commande au laboratoire (Odoo, brouillon) ────────────────────
// Une ligne par produit et par date de livraison ; prix brut + remise = remise
// sur facture et UG converties (la RFA et la coopération ne sont pas sur le bon).
// Protégé contre les doublons : réservation en base, puis repère dans l'origine du bon.
async function createPurchaseOrder(id) {
  const data = await loadOperation(id);
  if (!data) throw fail("Opération introuvable", 404);
  const { op, lines } = data;
  if (op.status !== "cloturee") throw fail("Clôturez l'opération avant de créer le bon de commande");
  if (!op.supplier_odoo_id) throw fail("Choisissez d'abord le fournisseur Odoo de l'opération");
  const sumCheck = summarize(data);
  const missing = lines.filter(l => (sumCheck.group[l.id] || 0) > 0 && !l.odoo_product_id).map(l => `${l.name} (${l.cip})`);
  if (missing.length) throw fail(`Produits commandés sans fiche Odoo : ${missing.join(", ")}. Créez les fiches dans Odoo et reliez-les avant de créer le bon.`);
  // Réservation ; une réservation de plus de 2 min sans bon enregistré vient d'un essai coupé : on la reprend
  // (horodatage entre guillemets : « . » et « : » sont réservés dans un filtre or=(…) de PostgREST)
  const staleClaim = new Date(Date.now() - 2 * 60e3).toISOString();
  const [claimed] = await sb(`gp_operations?id=eq.${id}&status=eq.cloturee&po_odoo_id=is.null&or=${encodeURIComponent(`(po_created_at.is.null,po_created_at.lt."${staleClaim}")`)}`,
    { method: "PATCH", prefer: "return=representation", body: { po_created_at: new Date().toISOString() } });
  if (!claimed) throw fail("Le bon de commande est déjà créé ou en cours de création (réessayez dans 2 minutes si rien ne se passe)");
  const marker = `CG-${id.slice(0, 8)}`;
  try {
    const s = summarize(data);
    const pids = lines.map(l => l.odoo_product_id).filter(Boolean);
    const uoms = pids.length ? await odoo("product.product", "read", [pids], { fields: ["uom_id"] }) : [];
    const uomOf = Object.fromEntries(uoms.map(p => [p.id, p.uom_id?.[0]]));
    const orderLines = [], skipped = [];
    for (const l of lines) {
      const total = s.group[l.id] || 0;
      if (!total) continue;
      if (!l.odoo_product_id) { skipped.push(l.cip); continue; }
      const gross = Number(l.price_gross) || 0;
      const net = labUnitNet(op, l, total, s.perPharmacyTotal);
      const discount = gross > 0 ? round2(Math.max(0, (1 - net / gross) * 100)) : 0;
      for (const [slotId, q] of Object.entries(s.groupBySlot[l.id] || {})) {
        if (!q) continue;
        const date = slotId === IMMEDIATE_SLOT ? (op.end_date || today()) : (slotOf(op, slotId)?.date || op.end_date || today());
        orderLines.push([0, 0, { product_id: l.odoo_product_id, name: lineLabel(l), product_qty: q, price_unit: gross, discount,
          date_planned: `${date} 08:00:00`, ...(uomOf[l.odoo_product_id] ? { product_uom: uomOf[l.odoo_product_id] } : {}) }]);
      }
    }
    if (!orderLines.length) throw fail("Aucune quantité confirmée à commander");
    const ctx = { context: { allowed_company_ids: [COMPANY_ID] } };
    const [already] = await odoo("purchase.order", "search_read", [[["origin", "ilike", `[${marker}]`], ["company_id", "=", COMPANY_ID], ["state", "!=", "cancel"]]], { fields: ["id"], limit: 1 });
    const poId = already?.id || await odoo("purchase.order", "create", [{ partner_id: op.supplier_odoo_id, company_id: COMPANY_ID,
      origin: `Commande groupée — ${op.name}`.slice(0, 200) + ` [${marker}]`, order_line: orderLines }], ctx);
    const [po] = await odoo("purchase.order", "read", [[poId]], { fields: ["name", "amount_untaxed"] });
    await sb(`gp_operations?id=eq.${id}`, { method: "PATCH", body: { po_odoo_id: poId, status: "commandee", updated_at: new Date().toISOString() } });
    return { ok: true, po_id: poId, po_name: po?.name, amount_ht: po?.amount_untaxed, lines: orderLines.length, skipped, reused: !!already };
  } catch (e) {
    await sb(`gp_operations?id=eq.${id}&po_odoo_id=is.null`, { method: "PATCH", body: { po_created_at: null } }).catch(() => {});
    throw e;
  }
}

// ── Déclenchement d'une livraison : devis Odoo créés en arrière-plan ─────
async function startTrigger(id, slotId, event) {
  const data = await loadOperation(id);
  if (!data) throw fail("Opération introuvable", 404);
  const { op } = data;
  if (!["cloturee", "commandee", "terminee"].includes(op.status)) throw fail("Clôturez l'opération avant de créer les commandes des pharmacies");
  if (slotId !== IMMEDIATE_SLOT && !slotOf(op, slotId)) throw fail("Date de livraison inconnue");
  if (!process.env.CRON_SECRET) throw fail("CRON_SECRET absent des variables Netlify : impossible de lancer la création en arrière-plan", 500);
  const key = `gp_trigger:${id}:${slotId}`;
  const [row] = await sb(`kv_store?key=${eq(key)}&select=value`);
  if (row?.value?.status === "en_cours" && Date.now() - Date.parse(row.value.started_at) < 16 * 60e3) return { job: { id, slot_id: slotId }, already_running: true };
  await sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { key, value: { status: "en_cours", started_at: new Date().toISOString(), slot: slotLabel(op, slotId), created: [], errors: [], skipped: 0 } } });
  // le secret n'est envoyé qu'à une adresse du site, jamais à un hôte tiré de la requête
  const h = String(event.headers?.host || "").toLowerCase();
  const base = `https://${["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"].includes(h) || /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/.test(h) ? h : "commandes-elixir.netlify.app"}`;
  let r;
  try {
    r = await fetch(`${base}/.netlify/functions/gp-trigger-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET }, body: JSON.stringify({ id, slot_id: slotId }),
    });
  } catch (e) { r = { ok: false, status: e.message }; }
  if (!r.ok && r.status !== 202) {
    await sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key, value: { status: "erreur", error: `Lancement impossible (HTTP ${r.status})` } } });
    throw fail(`Lancement impossible (HTTP ${r.status})`, 500);
  }
  return { job: { id, slot_id: slotId } };
}
