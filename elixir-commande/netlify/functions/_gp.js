// ── Commandes groupées : aides communes aux fonctions gp-* ────────────────
import { verifyTokenAsync } from "./auth.js";
import { priceOrder, objectiveProgress } from "../../src/gp-pricing.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ODOO_URL  = (process.env.ODOO_URL || "https://odoo.elixir-pharma.fr").replace(/\/$/, "");
const ODOO_DB   = process.env.ODOO_DB   || "healthsoft-sas-lispharma-main-13622653";
const ODOO_USER = process.env.ODOO_USER || "pharmacien@elixirpharma.fr";
const ODOO_KEY  = process.env.ODOO_APIKEY || "";
export const COMPANY_ID = parseInt(process.env.ODOO_COMPANY || "2");

export const json = (cors, statusCode, body) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
export const today = () => new Date().toISOString().slice(0, 10);

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
export const inList = (arr) => `(${arr.map(v => `"${String(v).replace(/"/g, "")}"`).join(",")})`;

// ── Odoo (JSON-RPC : parsing natif, many2many complets) ────────────────
let uidCache = null;
async function rpc(service, method, args) {
  const r = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
  });
  const j = await r.json();
  if (j.error) throw new Error(String(j.error?.data?.message || j.error?.message || "Erreur Odoo").slice(0, 300));
  return j.result;
}
export async function odoo(model, method, args, kwargs = {}) {
  if (!uidCache) uidCache = await rpc("common", "login", [ODOO_DB, ODOO_USER, ODOO_KEY]);
  if (!uidCache) throw new Error("Authentification Odoo refusée");
  return rpc("object", "execute_kw", [ODOO_DB, uidCache, ODOO_KEY, model, method, args, kwargs]);
}

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
    const rows = await sb(`odoo_catalog?cip=in.${inList(list.slice(i, i + 150))}&select=cip,in_stock,available,discounted_price`);
    for (const r of rows || []) out[r.cip] = { ...(out[r.cip] || {}), in_stock: !!r.in_stock, available: r.available ?? 0, elixir_price: r.discounted_price };
  }
  return out;
}

// ── Pharmacie : identité vérifiée ───────────────────────────────────────
// Jeton OTP si présent (CIP issu de l'e-mail vérifié), sinon couple CIP + e-mail
// qui doit correspondre à une fiche de elixir_pharmacies.
export async function identifyPharmacy(event, cip, email) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  if (tok) {
    const u = await verifyTokenAsync(tok);
    if (u?.cip) {
      const [p] = await sb(`elixir_pharmacies?cip=eq.${encodeURIComponent(u.cip)}&select=cip,name,email,odoo_id&limit=1`);
      return p ? { cip: p.cip, name: p.name, email: (u.email || p.email || "").toLowerCase(), odoo_id: p.odoo_id } : null;
    }
  }
  const c = String(cip || "").trim(), m = String(email || "").trim().toLowerCase();
  if (!c || !m) return null;
  const rows = await sb(`elixir_pharmacies?cip=eq.${encodeURIComponent(c)}&select=cip,name,email,odoo_id`);
  const p = (rows || []).find(r => String(r.email || "").trim().toLowerCase() === m);
  return p ? { cip: p.cip, name: p.name, email: m, odoo_id: p.odoo_id } : null;
}

// ── Chargement complet d'une opération ──────────────────────────────────
export async function loadOperation(id) {
  const [op] = await sb(`gp_operations?id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!op) return null;
  const [lines, participants, orders, qty] = await Promise.all([
    sb(`gp_lines?operation_id=eq.${id}&order=position.asc`),
    sb(`gp_participants?operation_id=eq.${id}&order=pharmacy_name.asc`),
    sb(`gp_orders?operation_id=eq.${id}`),
    sb(`gp_order_lines?operation_id=eq.${id}&qty=gt.0`, { range: "0-49999" }),
  ]);
  return { op, lines, participants, orders, qty };
}

// Quantités : par pharmacie { cip: { lineId: { slotId: qty } } } et totaux du groupe { lineId: qty }
export function aggregate(qtyRows) {
  const perPharmacy = {}, perPharmacyTotal = {}, group = {}, groupBySlot = {};
  for (const r of qtyRows || []) {
    ((perPharmacy[r.pharmacy_cip] ||= {})[r.line_id] ||= {})[r.slot_id] = r.qty;
    (perPharmacyTotal[r.pharmacy_cip] ||= {})[r.line_id] = ((perPharmacyTotal[r.pharmacy_cip] ||= {})[r.line_id] || 0) + r.qty;
    group[r.line_id] = (group[r.line_id] || 0) + r.qty;
    (groupBySlot[r.line_id] ||= {})[r.slot_id] = ((groupBySlot[r.line_id] ||= {})[r.slot_id] || 0) + r.qty;
  }
  return { perPharmacy, perPharmacyTotal, group, groupBySlot };
}

// ── Tableau de bord d'une opération ─────────────────────────────────────
// Seules les commandes CONFIRMÉES comptent dans les totaux du groupe.
export function summarize(data) {
  const { op, lines, participants, orders } = data;
  const confirmed = new Set((orders || []).filter(o => o.status === "confirmee").map(o => o.pharmacy_cip));
  const qty = (data.qty || []).filter(r => confirmed.has(r.pharmacy_cip));
  const agg = aggregate(qty);
  const feeOf = (cip) => { const p = (participants || []).find(x => x.pharmacy_cip === cip); return p?.fee_pct ?? op.fee_pct; };
  // 1er passage sans coopération : montant net après RFA de chaque pharmacie (base du prorata « total »)
  let groupNetAfterRfa = 0;
  for (const cip of Object.keys(agg.perPharmacyTotal)) {
    groupNetAfterRfa += priceOrder({ ...op, coop_mode: "aucune" }, lines, agg.perPharmacyTotal[cip], agg.group).totals.net;
  }
  const byCip = Object.fromEntries((orders || []).map(o => [o.pharmacy_cip, o]));
  const pharmacies = (participants || []).map(p => {
    const mine = agg.perPharmacyTotal[p.pharmacy_cip] || {};
    const s = confirmed.has(p.pharmacy_cip) ? priceOrder(op, lines, mine, agg.group, { groupNetAfterRfa, feePct: feeOf(p.pharmacy_cip) }) : null;
    return { cip: p.pharmacy_cip, name: p.pharmacy_name, email: p.email, fee_pct: p.fee_pct,
      order: byCip[p.pharmacy_cip] || null, bySlot: agg.perPharmacy[p.pharmacy_cip] || {}, totals: s?.totals || null };
  });
  const objective = objectiveProgress(op, lines, agg.group, agg.perPharmacyTotal);
  return { ...agg, groupNetAfterRfa, pharmacies, objective };
}

// ── Enregistrement de la commande d'une pharmacie ───────────────────────
// entries : [{ line_id, slot_id, qty }] = grille complète envoyée par l'écran
export async function saveOrder({ data, pharmacy, entries, source = "formulaire", fileName = null }) {
  const { op, lines } = data;
  const lineIds = new Set(lines.map(l => l.id));
  const slotIds = new Set(["immediat", ...(op.delivery_slots || []).map(s => s.id)]);
  const clean = new Map();
  for (const e of entries || []) {
    const q = Math.max(0, Math.floor(Number(e.qty) || 0));
    if (!lineIds.has(e.line_id) || !slotIds.has(e.slot_id)) continue;
    clean.set(`${e.line_id}|${e.slot_id}`, q);
  }
  const cip = pharmacy.cip;
  const existing = (data.qty || []).filter(r => r.pharmacy_cip === cip);
  for (const r of existing) if (!clean.has(`${r.line_id}|${r.slot_id}`)) clean.set(`${r.line_id}|${r.slot_id}`, 0);
  const rows = [...clean.entries()].map(([k, q]) => { const [line_id, slot_id] = k.split("|"); return { operation_id: op.id, pharmacy_cip: cip, line_id, slot_id, qty: q }; });
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const now = new Date().toISOString();
  await sb("gp_orders?on_conflict=operation_id,pharmacy_cip", { method: "POST", prefer: "resolution=merge-duplicates",
    body: { operation_id: op.id, pharmacy_cip: cip, pharmacy_name: pharmacy.name, email: pharmacy.email,
      status: total > 0 ? "confirmee" : "brouillon", source, file_name: fileName, confirmed_at: total > 0 ? now : null, updated_at: now } });
  if (rows.length) await sb("gp_order_lines?on_conflict=operation_id,pharmacy_cip,line_id,slot_id", { method: "POST", prefer: "resolution=merge-duplicates", body: rows });
  await sb(`gp_order_lines?operation_id=eq.${op.id}&pharmacy_cip=eq.${encodeURIComponent(cip)}&qty=eq.0`, { method: "DELETE" });
  return { total };
}
