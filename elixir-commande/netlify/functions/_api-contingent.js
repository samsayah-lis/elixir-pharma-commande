// ── API des pharmacies : contingentement, même calcul que le panier du site (quota-status.js) ──
// quota-status.js n'est PAS modifié (fonction protégée, en production) : ce module en reprend le calcul, branche « saisie
// Elixir pour une pharmacie » (fiche Odoo et CIP connus, adresses de compte de la fiche), avec les mêmes fonctions de
// _quota.js (produits contingentés, commandes Odoo de la période, dernier import PharmaML, périodes, libellés).
// scripts/test-api-lecture.mjs exécute quota-status.js ET ce module sur les mêmes données et exige le même résultat :
// toute évolution de quota-status.js qui ne serait pas reportée ici fait échouer le test.
// Déjà commandé = commandes Odoo de la période (toutes origines, hors annulées) + commandes du site (et de l'API, rangées
// dans elixir_orders) pas encore dans Odoo. Une fiche dispensée (deny_quota) n'a aucun contingent.
// Lectures seules : Odoo (_quota.js) et Supabase (elixir_pharmacies, elixir_orders) par la fonction sb injectée.
import { odoo as odooReel, COMPANY_ID } from "./_odoo-rpc.js";
import { quotaProducts, odooUsage, lastPharmamlImport, currentPeriod, quotaLabel, parisDate, PERIODS } from "./_quota.js";

// Période d'un contingent dans l'API : code stable (ASCII, snake_case, comme les autres énumérations) ; le libellé en
// français reste dans « libelle ». Toute période connue de _quota.js (PERIODS) doit avoir son code ici.
export const CODES_PERIODE = { "-1": "semaine", "-2": "decade", "-3": "quinzaine", "-4": "mois", "1": "jours_glissants" };
export const periodeConnue = (p) => !!PERIODS[p];

// → { exempt, today, products: { <CIP ou EAN>: { name, quota, period, days, label, used, used_odoo, used_site, remaining, start, end } } }
// (forme de la réponse de quota-status) ; sb(path) → JSON (lecture) ; odoo : _odoo-rpc.js (fiche dispensée)
export async function resteContingents({ odooId, cip }, { sb, odoo = odooReel, maintenant = () => new Date() } = {}) {
  const products = await quotaProducts();
  if (!products.length) return { exempt: false, products: {} };
  const ph = { id: String(odooId), cip: String(cip || "").trim() };
  const [p] = await odoo("res.partner", "read", [[Number(ph.id)]], { fields: ["deny_quota"], context: { allowed_company_ids: [COMPANY_ID] } });
  if (p?.deny_quota) return { exempt: true, products: {} };
  const now = maintenant();
  const today = parisDate(now);
  const [usedOdoo, lastImport] = await Promise.all([odooUsage(ph.id, products, today), lastPharmamlImport(ph.id)]);
  const usedSite = {};
  // adresses de compte de la fiche, telles qu'enregistrées et en minuscules (comparaison exacte)
  const emails = [...new Set(((await sb(`elixir_pharmacies?odoo_id=eq.${Number(ph.id)}&select=email`)) || [])
    .flatMap(r => { const e = String(r.email || "").trim(); return [e, e.toLowerCase()]; }).filter(Boolean))];
  const cipKnown = /^\d{7,13}$/.test(ph.cip) ? ph.cip : null;
  if (emails.length || cipKnown) {
    const since = new Date(now.getTime() - 7 * 864e5).toISOString();
    const orFilter = [...emails.map(e => `pharmacy_email.eq.${JSON.stringify(e)}`), ...(cipKnown ? [`pharmacy_cip.eq.${cipKnown}`] : [])].join(",");
    const orders = await sb(`elixir_orders?date=gte.${encodeURIComponent(since)}&or=(${encodeURIComponent(orFilter)})&select=date,items,processed&order=date.desc&limit=300`);
    const byCip = {};
    for (const q of products) { byCip[q.cip] = q; if (q.barcode) byCip[q.barcode] = q; }
    const recent = now.getTime() - 48 * 3600e3;
    for (const o of orders || []) {
      let items = o.items;
      if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
      for (const it of Array.isArray(items) ? items : []) {
        const q = byCip[String(it?.cip || "")];
        if (!q || it.handled_at) continue;
        const sentAt = it.synced_at ? Date.parse(it.synced_at) : o.processed ? Date.parse(o.date) : null;
        if (sentAt != null && !(sentAt > lastImport && sentAt > recent)) continue;
        usedSite[q.cip] = (usedSite[q.cip] || 0) + (parseInt(it.qty) || 0);
      }
    }
  }
  const out = {};
  for (const q of products) {
    const per = currentPeriod(q.period, q.days, today);
    const uo = usedOdoo[q.product_id] || 0, us = usedSite[q.cip] || 0;
    const row = { name: q.name, quota: q.quota, period: q.period, days: q.days, label: quotaLabel(q), used: uo + us, used_odoo: uo, used_site: us,
      remaining: Math.max(0, q.quota - uo - us), start: per.start, end: per.end };
    out[q.cip] = row;
    if (q.barcode && q.barcode !== q.cip) out[q.barcode] = row;
  }
  return { exempt: false, today, products: out };
}

// Produits contingentés (règles seules, cache de 10 min de _quota.js) → Set des CIP et EAN
export async function cipsContingentes() {
  const s = new Set();
  for (const q of await quotaProducts()) { if (q.cip) s.add(String(q.cip)); if (q.barcode) s.add(String(q.barcode)); }
  return s;
}

const jourAvant = (jour, n = 1) => new Date(Date.parse(`${jour}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
// Réponse de /v1/contingents : un produit par ligne (CIP13 de préférence), période en jours compris (fin incluse)
export function formerContingents(r) {
  const vus = new Set(), donnees = [];
  for (const [code, row] of Object.entries(r.products || {})) {
    if (vus.has(row)) continue;
    vus.add(row);
    const codes = Object.entries(r.products).filter(([, x]) => x === row).map(([c]) => c);
    const cip = codes.find(c => /^\d{13}$/.test(c)) || code;
    donnees.push({ cip, nom: row.name || null, quota: row.quota, periode: CODES_PERIODE[row.period] || null, jours_glissants: row.period === "1" ? row.days : null,
      libelle: row.label, debut: row.start, fin: row.end ? jourAvant(row.end) : r.today || null, deja_commande: row.used, reste: row.remaining });
  }
  donnees.sort((a, b) => a.cip.localeCompare(b.cip));
  return { exempte: !!r.exempt, jour: r.today || null, donnees };
}
