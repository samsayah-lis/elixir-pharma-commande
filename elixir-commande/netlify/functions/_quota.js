// ── Contingentement des ventes (module Odoo edi_healthsoft) ─────────────
// Fiche produit, onglet « Pharma ML » : quota (Contingentement), quota_period
// (0 pas de quota, -1 semaine, -2 décade, -3 quinzaine, -4 mois, 1 jours glissants)
// et quota_slippery_days (nombre de jours glissants). Champs PAR SOCIÉTÉ : lus pour
// Elixir (société 2). Un client coché « Deny Quota » (res.partner.deny_quota) en est dispensé.
// Odoo l'applique aux commandes PharmaML ; le site contrôle le panier avec la même règle.
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";

export const PERIODS = { "-1": "semaine", "-2": "décade", "-3": "quinzaine", "-4": "mois", "1": "jours glissants" };

// Dates « AAAA-MM-JJ » (heure de Paris), arithmétique en UTC pour éviter les changements d'heure
const D = (s) => new Date(s + "T00:00:00Z");
const S = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const firstOfNextMonth = (s) => { const d = D(s); return S(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))); };
export const parisDate = (t = new Date()) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// Période en cours : { start (inclus), end (exclu, null en jours glissants) }
export function currentPeriod(period, days, today = parisDate()) {
  const d = D(today), day = d.getUTCDate(), ym = today.slice(0, 8);
  switch (String(period)) {
    case "-1": { const dow = (d.getUTCDay() + 6) % 7; const start = addDays(today, -dow); return { start, end: addDays(start, 7) }; }   // lundi → dimanche
    case "-2": return day <= 10 ? { start: ym + "01", end: ym + "11" } : day <= 20 ? { start: ym + "11", end: ym + "21" } : { start: ym + "21", end: firstOfNextMonth(today) };
    case "-3": return day <= 15 ? { start: ym + "01", end: ym + "16" } : { start: ym + "16", end: firstOfNextMonth(today) };
    case "-4": return { start: ym + "01", end: firstOfNextMonth(today) };
    case "1": { const n = Math.max(1, Math.floor(Number(days) || 1)); return { start: addDays(today, -(n - 1)), end: null }; }   // n derniers jours, aujourd'hui compris
    default: return null;
  }
}

export const quotaLabel = (q) => q.period === "1"
  ? `${q.quota} sur ${q.days} jour${q.days > 1 ? "s" : ""} glissant${q.days > 1 ? "s" : ""}`
  : `${q.quota} par ${PERIODS[q.period]}`;

// Produits contingentés d'Elixir (cache 10 min par instance de fonction)
let cache = null;
export async function quotaProducts() {
  if (cache && Date.now() - cache.at < 10 * 60e3) return cache.list;
  const ctx = { allowed_company_ids: [COMPANY_ID], active_test: false };
  const props = await odoo("ir.property", "search_read", [[["name", "=", "quota"], ["company_id", "=", COMPANY_ID], ["value_integer", ">", 0]]], { fields: ["res_id"], context: ctx });
  const ids = props.map(p => Number(String(p.res_id || "").split(",")[1])).filter(Boolean);
  const tmpls = ids.length ? await odoo("product.template", "read", [ids], { fields: ["default_code", "barcode", "name", "quota", "quota_period", "quota_slippery_days", "product_variant_id", "active"], context: ctx }) : [];
  const list = tmpls.filter(t => t.active && t.quota > 0 && PERIODS[String(t.quota_period)] && t.product_variant_id)
    .map(t => ({ cip: t.default_code || t.barcode || "", barcode: t.barcode || "", name: t.name, quota: t.quota, period: String(t.quota_period),
      days: String(t.quota_period) === "1" ? Math.max(1, t.quota_slippery_days || 1) : 0, product_id: t.product_variant_id[0] }))
    .filter(q => q.cip);
  cache = { at: Date.now(), list };
  return list;
}

// Dernière commande PharmaML créée dans Odoo pour la pharmacie (ms) : une commande du site
// transmise APRÈS cette date n'est pas encore importée (cycle du connecteur : 4 min, parfois des heures)
export async function lastPharmamlImport(partnerId) {
  if (!partnerId) return 0;
  const [o] = await odoo("sale.order", "search_read", [[["partner_id", "child_of", Number(partnerId)], ["from_pharmaml", "=", true], ["company_id", "=", COMPANY_ID]]],
    { fields: ["create_date"], order: "create_date desc", limit: 1, context: { allowed_company_ids: [COMPANY_ID] } });
  return o ? Date.parse(String(o.create_date).replace(" ", "T") + "Z") : 0;
}

// Quantités déjà commandées dans Odoo par la pharmacie (fiche commerciale et ses adresses),
// toutes origines, devis annulés exclus, chacune dans la période de son produit.
export async function odooUsage(partnerId, products, today = parisDate()) {
  const used = Object.fromEntries(products.map(q => [q.product_id, 0]));
  if (!partnerId || !products.length) return used;
  const starts = Object.fromEntries(products.map(q => [q.product_id, currentPeriod(q.period, q.days, today).start]));
  const earliest = Object.values(starts).sort()[0];
  const lines = await odoo("sale.order.line", "search_read", [[["product_id", "in", products.map(q => q.product_id)], ["order_id.partner_id", "child_of", Number(partnerId)],
    ["company_id", "=", COMPANY_ID], ["state", "!=", "cancel"], ["order_id.date_order", ">=", `${addDays(earliest, -1)} 00:00:00`]]],
    { fields: ["product_id", "product_uom_qty", "order_id"], context: { allowed_company_ids: [COMPANY_ID] } });
  if (!lines.length) return used;
  const orders = await odoo("sale.order", "read", [[...new Set(lines.map(l => l.order_id[0]))]], { fields: ["date_order"], context: { allowed_company_ids: [COMPANY_ID] } });
  const dateOf = Object.fromEntries(orders.map(o => [o.id, parisDate(String(o.date_order).replace(" ", "T") + "Z")]));
  for (const l of lines) {
    const pid = l.product_id[0];
    if (dateOf[l.order_id[0]] >= starts[pid]) used[pid] += Number(l.product_uom_qty) || 0;
  }
  return used;
}
