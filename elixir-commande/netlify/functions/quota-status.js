// ── Contingentement : reste à commander pour la pharmacie connectée ──────
// POST { cip, email } (+ jeton pharmacie en Authorization si présent)
// → { exempt, products: { <CIP>: { name, quota, period, days, label, used, used_odoo, used_site,
//      remaining, start, end } } }
// Déjà commandé = commandes Odoo de la pharmacie dans la période (toutes origines, hors
// annulées) + commandes du site pas encore transmises à PharmaML (pas encore dans Odoo).
import { getCors } from "./cors.js";
import { json, sb, identifyPharmacy } from "./_gp.js";
import { odoo, COMPANY_ID } from "./_odoo-rpc.js";
import { quotaProducts, odooUsage, lastPharmamlImport, currentPeriod, quotaLabel, parisDate } from "./_quota.js";
import { rateLimit } from "./rate-limit.js";
import { verifyAdmin } from "./auth.js";

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(cors, 405, { error: "Méthode non autorisée" });
  const limited = rateLimit(event, 30, 60);
  if (limited) return { ...limited, headers: { ...cors, ...limited.headers } };
  try {
    const b = JSON.parse(event.body || "{}");
    const products = await quotaProducts();
    if (!products.length) return json(cors, 200, { exempt: false, products: {} });
    // Admin qui commande à la place d'une pharmacie : identité donnée par la fiche Odoo choisie
    let ph = null;
    if (b.odoo_id && /^\d+$/.test(String(b.odoo_id))) {
      const auth = await verifyAdmin(event);
      if (auth.error) return json(cors, 403, { error: "Accès admin requis" });
      ph = { id: String(b.odoo_id), email: String(b.email || "").trim().toLowerCase(), cip: String(b.cip || "").trim() };
    } else ph = await identifyPharmacy(event, b.cip, b.email);
    const mail = ph?.email || String(b.email || "").trim().toLowerCase();
    if (ph) {
      const [p] = await odoo("res.partner", "read", [[Number(ph.id)]], { fields: ["deny_quota"], context: { allowed_company_ids: [COMPANY_ID] } });
      if (p?.deny_quota) return json(cors, 200, { exempt: true, products: {} });
    }
    const today = parisDate();
    const [usedOdoo, lastImport] = ph ? await Promise.all([odooUsage(ph.id, products, today), lastPharmamlImport(ph.id)]) : [{}, 0];
    // Commandes du site pas encore dans Odoo (toutes les adresses de connexion de la pharmacie) :
    //  - lignes non transmises : comptées quelle que soit leur date (Odoo les datera de leur import,
    //    au plus tôt maintenant, donc dans la période en cours) ;
    //  - lignes transmises (commande traitée, ou envoi partiel synced_at) depuis la dernière commande
    //    PharmaML importée dans Odoo pour cette pharmacie (48 h au plus) : pas encore importées.
    const usedSite = {};
    const emails = ph ? (await sb(`elixir_pharmacies?odoo_id=eq.${Number(ph.id)}&select=email`)).map(r => String(r.email || "").toLowerCase()).filter(Boolean) : [];
    if (!b.odoo_id && mail.includes("@") && !emails.includes(mail)) emails.push(mail);   // saisie admin : adresses de compte de la fiche seulement
    // commandes du site de la pharmacie : par adresse de connexion, ou par CIP (commande saisie par Elixir
    // pour une pharmacie sans compte)
    const cipKnown = /^\d{7,13}$/.test(String(ph?.cip || "")) ? String(ph.cip) : null;
    if (emails.length || cipKnown) {
      // fenêtre de 7 jours : la synchro manuelle se fait dans la journée ; au-delà, commande oubliée ou abandonnée
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const orFilter = [...emails.map(e => `pharmacy_email.ilike.${JSON.stringify(e)}`), ...(cipKnown ? [`pharmacy_cip.eq.${cipKnown}`] : [])].join(",");
      const orders = await sb(`elixir_orders?date=gte.${encodeURIComponent(since)}&or=(${encodeURIComponent(orFilter)})&select=date,items,processed&order=date.desc&limit=300`);
      const byCip = {};
      for (const q of products) { byCip[q.cip] = q; if (q.barcode) byCip[q.barcode] = q; }
      const recent = Date.now() - 48 * 3600e3;
      for (const o of orders || []) {
        let items = o.items;
        if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
        for (const it of Array.isArray(items) ? items : []) {
          const q = byCip[String(it?.cip || "")];
          if (!q || it.handled_at) continue;   // traitée sans envoi par l'admin (saisie dans Odoo, annulée…) : pas à compter ici
          const sentAt = it.synced_at ? Date.parse(it.synced_at) : o.processed ? Date.parse(o.date) : null;   // envoi auto : juste après la création
          if (sentAt != null && !(sentAt > lastImport && sentAt > recent)) continue;   // déjà dans Odoo (ou trop ancienne)
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
    return json(cors, 200, { exempt: false, identified: !!ph, today, products: out });
  } catch (e) {
    console.error("quota-status", e);
    return json(cors, 502, { error: e.message || String(e) });
  }
};
