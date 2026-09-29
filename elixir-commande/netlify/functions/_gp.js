// ── Commandes groupées : aides communes aux fonctions gp-* ────────────────
// Une pharmacie est identifiée par sa fiche client Odoo Elixir (fiche commerciale,
// colonne pharmacy_id), jamais par son CIP : la plupart des fiches ont un CIP vide ou « 0 ».
import { verifyTokenAsync } from "./auth.js";
import { priceOrder, objectiveProgress, parisToday, IMMEDIATE_SLOT } from "../../src/gp-pricing.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";

export { odoo, COMPANY_ID };
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const json = (cors, statusCode, body) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
export const today = parisToday;
export const fail = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, extra });

// ── Supabase (PostgREST) ────────────────────────────────────────────────
export async function sb(path, { method = "GET", body, prefer, range } = {}) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  if (range) headers.Range = range;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]} : ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
// Lecture complète : PostgREST plafonne chaque réponse (1000 lignes par défaut)
export async function sbAll(path, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const rows = await sb(path, { range: `${from}-${from + page - 1}` });
    out.push(...(rows || []));
    if (!rows || rows.length < page) return out;
  }
}
export const inList = (arr) => `(${arr.map(v => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;
export const eq = (v) => `eq.${encodeURIComponent(String(v))}`;

// Produits par CIP : fiche Odoo (id, TVA Elixir, prix catalogue) + stock du site (odoo_catalog)
export async function productInfo(cips) {
  const list = [...new Set(cips.map(c => String(c || "").trim()).filter(Boolean))];
  if (!list.length) return {};
  const ctx = { allowed_company_ids: [COMPANY_ID] };
  const prods = await odoo("product.product", "search_read",
    [["|", ["default_code", "in", list], ["barcode", "in", list]]],
    { fields: ["id", "name", "default_code", "barcode", "list_price", "taxes_id", "active"], context: ctx });
  const taxIds = [...new Set(prods.flatMap(p => p.taxes_id || []))];
  const taxes = taxIds.length ? await odoo("account.tax", "read", [taxIds], { fields: ["amount", "amount_type", "type_tax_use", "company_id"], context: { active_test: false } }) : [];
  const rate = {}; for (const t of taxes) if (t.type_tax_use === "sale" && t.amount_type === "percent" && t.company_id?.[0] === COMPANY_ID) rate[t.id] = t.amount;
  const out = {};
  for (const p of prods) {
    const vats = (p.taxes_id || []).map(i => rate[i]).filter(v => v != null);
    const info = { odoo_product_id: p.id, odoo_name: p.name, list_price: p.list_price, vat_rate: vats.length ? Math.max(...vats) : null };
    for (const k of [p.default_code, p.barcode]) if (k && list.includes(k) && !out[k]) out[k] = { ...info };
  }
  for (let i = 0; i < list.length; i += 150) {
    const rows = await sb(`odoo_catalog?cip=in.${encodeURIComponent(inList(list.slice(i, i + 150)))}&select=cip,in_stock,available,discounted_price`);
    for (const r of rows || []) out[r.cip] = { ...(out[r.cip] || {}), in_stock: !!r.in_stock, available: r.available ?? 0, elixir_price: r.discounted_price };
  }
  return out;
}

// ── Pharmacie : identité ────────────────────────────────────────────────
// Jeton de connexion (e-mail vérifié) si présent, sinon e-mail de la session du site,
// qui doit être celui d'un compte pharmacie (elixir_pharmacies ne contient que des
// clients Elixir, voir pharmacy-sync-now). Renvoie { id, cip, name, email } ou null.
export async function identifyPharmacy(event, cip, email) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  let mail = "";
  if (tok) {
    const u = await verifyTokenAsync(tok);
    if (u && !u.isAdmin && u.email) mail = u.email.toLowerCase();
  }
  if (!mail) mail = String(email || "").trim().toLowerCase();
  if (!mail.includes("@")) return null;
  const [p] = await sb(`elixir_pharmacies?email=${eq(mail)}&select=cip,name,email,odoo_id&limit=1`);
  if (!p || !p.odoo_id) return null;
  // cohérence avec la session : un CIP réel fourni doit être celui du compte
  const c = String(cip || "").trim();
  if (c && c !== "0" && p.cip && p.cip !== "0" && c !== p.cip) return null;
  return { id: String(p.odoo_id), cip: p.cip || "", name: p.name, email: mail };
}

// ── Chargement complet d'une opération ──────────────────────────────────
export async function loadOperation(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const [op] = await sb(`gp_operations?id=eq.${id}&limit=1`);
  if (!op) return null;
  const [lines, participants, orders, qty] = await Promise.all([
    sbAll(`gp_lines?operation_id=eq.${id}&order=position.asc,id.asc`),
    sbAll(`gp_participants?operation_id=eq.${id}&order=pharmacy_name.asc,pharmacy_id.asc`),
    sbAll(`gp_orders?operation_id=eq.${id}&order=pharmacy_id.asc`),
    sbAll(`gp_order_lines?operation_id=eq.${id}&qty=gt.0&order=pharmacy_id.asc,line_id.asc,slot_id.asc`),
  ]);
  return { op, lines, participants, orders, qty };
}

export const slotIds = (op) => new Set([IMMEDIATE_SLOT, ...(op.delivery_slots || []).map(s => s.id)]);

// Quantités : par pharmacie { id: { lineId: { slotId: qty } } } et totaux du groupe { lineId: qty }
export function aggregate(qtyRows) {
  const perPharmacy = {}, perPharmacyTotal = {}, group = {}, groupBySlot = {};
  for (const r of qtyRows || []) {
    const ph = r.pharmacy_id;
    ((perPharmacy[ph] ||= {})[r.line_id] ||= {})[r.slot_id] = r.qty;
    (perPharmacyTotal[ph] ||= {})[r.line_id] = (perPharmacyTotal[ph][r.line_id] || 0) + r.qty;
    group[r.line_id] = (group[r.line_id] || 0) + r.qty;
    (groupBySlot[r.line_id] ||= {})[r.slot_id] = (groupBySlot[r.line_id][r.slot_id] || 0) + r.qty;
  }
  return { perPharmacy, perPharmacyTotal, group, groupBySlot };
}

// Quantités qui comptent : commandes CONFIRMÉES de pharmacies encore participantes,
// sur un produit et une date de livraison qui existent toujours. Le reste est signalé.
export function countedQty(data) {
  const parts = new Set((data.participants || []).map(p => p.pharmacy_id));
  const confirmed = new Set((data.orders || []).filter(o => o.status === "confirmee" && parts.has(o.pharmacy_id)).map(o => o.pharmacy_id));
  const lineIds = new Set((data.lines || []).map(l => l.id));
  const slots = slotIds(data.op);
  const counted = [], orphans = [];
  for (const r of data.qty || []) {
    if (!confirmed.has(r.pharmacy_id)) continue;
    (lineIds.has(r.line_id) && slots.has(r.slot_id) ? counted : orphans).push(r);
  }
  return { counted, orphans, confirmed };
}

// ── Tableau de bord d'une opération ─────────────────────────────────────
export function summarize(data) {
  const { op, lines, participants, orders } = data;
  const { counted, orphans, confirmed } = countedQty(data);
  const agg = aggregate(counted);
  const feeOf = (id) => { const p = (participants || []).find(x => x.pharmacy_id === id); return p?.fee_pct ?? op.fee_pct; };
  // 1er passage sans coopération : montant net après RFA de chaque pharmacie (base du prorata « total »)
  let groupNetAfterRfa = 0;
  for (const id of Object.keys(agg.perPharmacyTotal)) {
    groupNetAfterRfa += priceOrder({ ...op, coop_mode: "aucune" }, lines, agg.perPharmacyTotal[id], agg.group).totals.net;
  }
  const byId = Object.fromEntries((orders || []).map(o => [o.pharmacy_id, o]));
  const pharmacies = (participants || []).map(p => {
    const mine = agg.perPharmacyTotal[p.pharmacy_id] || {};
    const s = confirmed.has(p.pharmacy_id) ? priceOrder(op, lines, mine, agg.group, { groupNetAfterRfa, feePct: feeOf(p.pharmacy_id) }) : null;
    return { id: p.pharmacy_id, cip: p.pharmacy_cip, name: p.pharmacy_name, email: p.email, fee_pct: p.fee_pct,
      order: byId[p.pharmacy_id] || null, bySlot: agg.perPharmacy[p.pharmacy_id] || {}, totals: s?.totals || null, rows: s?.rows || [] };
  });
  const objective = objectiveProgress(op, lines, agg.group, agg.perPharmacyTotal);
  return { ...agg, groupNetAfterRfa, pharmacies, objective, orphans: orphans.length };
}

// ── Enregistrement de la commande d'une pharmacie ───────────────────────
// entries : [{ line_id, slot_id, qty }] = grille complète envoyée par l'écran.
// Quantités écrites d'abord, en-tête ensuite : un échec au milieu ne laisse
// jamais une commande « confirmée » sans ses quantités.
// loadedUpdatedAt : updated_at de la commande quand l'écran l'a chargée (undefined = pas de contrôle,
// null = l'écran n'avait pas de commande). Refus si elle a changé entre-temps (autre compte, saisie par Elixir).
export async function saveOrder({ data, pharmacy, entries, source = "formulaire", fileName = null, loadedUpdatedAt }) {
  const { op, lines } = data;
  const id = pharmacy.id;
  const prev = (data.orders || []).find(o => o.pharmacy_id === id);
  if (loadedUpdatedAt !== undefined && (prev?.updated_at || null) !== (loadedUpdatedAt || null))
    throw fail("Votre commande a été modifiée entre-temps (autre poste ou saisie par Elixir) : rechargez la page avant d'enregistrer.", 409, { code: "stale" });
  const lineIds = new Set(lines.map(l => l.id));
  const slots = slotIds(op);
  const clean = new Map(), dropped = [];
  for (const e of entries || []) {
    const q = Math.min(100000, Math.max(0, Math.floor(Number(e.qty) || 0)));
    if (!lineIds.has(e.line_id) || !slots.has(e.slot_id)) { if (q > 0) dropped.push(e); continue; }
    clean.set(`${e.line_id}|${e.slot_id}`, q);
  }
  // Un produit ou une date retirés depuis l'affichage : rien n'est écrit, la pharmacie recharge
  if (dropped.length) throw fail("L'opération a changé depuis l'affichage (produit ou date de livraison retirés) : rechargez la page.", 409, { code: "stale" });
  const existing = (data.qty || []).filter(r => r.pharmacy_id === id);
  for (const r of existing) if (!clean.has(`${r.line_id}|${r.slot_id}`)) clean.set(`${r.line_id}|${r.slot_id}`, 0);
  const rows = [...clean.entries()].map(([k, q]) => { const [line_id, slot_id] = k.split("|"); return { operation_id: op.id, pharmacy_id: id, line_id, slot_id, qty: q }; });
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const before = Object.fromEntries(existing.map(r => [`${r.line_id}|${r.slot_id}`, r.qty]));
  const changed = rows.some(r => (before[`${r.line_id}|${r.slot_id}`] || 0) !== r.qty);
  if (rows.length) await sb("gp_order_lines?on_conflict=operation_id,pharmacy_id,line_id,slot_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows });
  await sb(`gp_order_lines?operation_id=eq.${op.id}&pharmacy_id=${eq(id)}&qty=eq.0`, { method: "DELETE" });
  const now = new Date().toISOString();
  await sb("gp_orders?on_conflict=operation_id,pharmacy_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { operation_id: op.id, pharmacy_id: id, pharmacy_name: pharmacy.name, email: pharmacy.email,
      status: total > 0 ? "confirmee" : "brouillon", source, file_name: fileName,
      confirmed_at: total > 0 ? (changed || !prev?.confirmed_at ? now : prev.confirmed_at) : null, updated_at: now } });
  return { total, changed, wasConfirmed: prev?.status === "confirmee" };
}

// Une pharmacie qui n'a plus aucune quantité repasse en brouillon
export async function refreshOrderStatus(opId, pharmacyIds) {
  for (const id of pharmacyIds) {
    const left = await sb(`gp_order_lines?operation_id=eq.${opId}&pharmacy_id=${eq(id)}&qty=gt.0&select=qty&limit=1`);
    if (!left.length) await sb(`gp_orders?operation_id=eq.${opId}&pharmacy_id=${eq(id)}`, { method: "PATCH", body: { status: "brouillon", confirmed_at: null, updated_at: new Date().toISOString() } });
  }
}
