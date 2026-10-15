import { verifyAdmin, isCronAuthorized } from "./auth.js";
// ── Sync prix — réplique fidèlement la liste de prix Odoo #5 ─────────────
// step=load           → charge toutes les règles de #5 + l'arbre des catégories
// step=apply&offset=0 → calcule le prix par produit et l'écrit (upsert groupé)
//
// Prix unité (min_quantity ≤ 1) = le PLUS BAS des prix donnés par les règles applicables : produit,
// modèle, catégories (toute la hiérarchie) et barème GLOBAL — c'est ce que l'Odoo d'Elixir facture
// (vérifié le 15/10/2026 sur les ventes réelles et le rapport de liste de prix d'Odoo : ex. Daktarin
// règle produit 5,04 € mais facturé 1,78 € au barème global). Avant, la règle la plus spécifique
// l'emportait et le site affichait parfois un prix plus haut que la facture.
import { authenticate, odooCall } from "./odoo.js";
import { getCors } from "./cors.js";

const PRICELIST_ID = parseInt(process.env.PRICELIST_ID || "5");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

const round2 = (n) => Math.round(n * 100) / 100;

// Barème global par palier (bornes 4,63 / 500 — champ de plage non lisible en RPC,
// valeurs stables issues de la config #5). Priorité au + spécifique ci-dessous.
function globalPrice(lp) {
  if (lp < 4.63) return round2(lp - 0.23);
  if (lp <= 500) return round2(lp * (1 - 4.51 / 100));
  return round2(lp - 25.1);
}

// Applique une règle Odoo (fixed / percentage / formula) à un prix catalogue.
function applyRule(r, lp) {
  if (r.cp === "fixed") return r.fp > 0 ? round2(r.fp) : null;
  if (r.cp === "percentage") return round2(lp * (1 - (r.pp || 0) / 100));
  if (r.cp === "formula") return round2(lp * (1 - (r.pd || 0) / 100) + (r.ps || 0));
  return null;
}

const enVigueur = (r, jour) => (!r.ds || r.ds <= jour) && (!r.de || r.de >= jour);

// Index des règles en vigueur : prix unité (mq ≤ 1) par cible, paliers de quantité (règles produit mq ≥ 2) à part
export function indexRegles(rules, jour = new Date().toISOString().slice(0, 10)) {
  const ix = { byPid: {}, byTid: {}, byCid: {}, tiersByPid: {}, tiersByTid: {} };
  for (const r of rules) {
    if (!enVigueur(r, jour)) continue;
    if (r.mq > 1) {
      if (!Number.isInteger(r.mq) || r.mq < 2) continue; // ex. « 5,92 » : saisie erronée
      if (r.pid > 0) (ix.tiersByPid[r.pid] ||= []).push(r);
      else if (r.tid > 0) (ix.tiersByTid[r.tid] ||= []).push(r);
      continue;
    }
    if (r.ao.includes("3")) continue; // barème global : globalPrice()
    if (r.pid > 0) (ix.byPid[r.pid] ||= []).push(r);
    else if (r.tid > 0) (ix.byTid[r.tid] ||= []).push(r);
    else if (r.cid > 0) (ix.byCid[r.cid] ||= []).push(r);
  }
  return ix;
}

// Prix unité facturé par Odoo : minimum des règles applicables et du barème global
export function prixUnitaire(p, ix, parentMap) {
  const lp = parseFloat(p.list_price) || 0;
  if (lp <= 0) return null;
  const regles = [...(ix.byPid[p.odoo_pid] || []), ...(ix.byTid[p.odoo_tmpl_id] || [])];
  let c = parseInt(p.categ_id) || 0, garde = 0;
  while (c > 0 && garde++ < 20) { regles.push(...(ix.byCid[c] || [])); c = parentMap[c] || 0; }
  const prix = regles.map(r => applyRule(r, lp)).filter(x => x != null && x > 0);
  prix.push(globalPrice(lp));
  return Math.min(...prix);
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (!isCronAuthorized(event)) {
    const auth = await verifyAdmin(event);
    if (auth.error) return auth.error;
  }
  const params = event.queryStringParameters || {};
  const step = params.step || "load";

  try {
    // ══ STEP LOAD : règles de #5 + arbre des catégories → kv_store ═══════
    if (step === "load") {
      const uid = await authenticate();

      const rules = [];
      let offset = 0;
      while (true) {
        const items = await odooCall(uid, "product.pricelist.item", "search_read",
          [["pricelist_id", "=", PRICELIST_ID]],
          { fields: ["applied_on", "compute_price", "fixed_price", "percent_price", "price_discount", "price_surcharge", "min_quantity", "product_id", "product_tmpl_id", "categ_id", "date_start", "date_end"], limit: 500, offset });
        if (!Array.isArray(items) || items.length === 0) break;
        items.forEach(it => rules.push({
          ao: it.applied_on || "",
          cp: it.compute_price || "",
          fp: parseFloat(it.fixed_price) || 0,
          pp: parseFloat(it.percent_price) || 0,
          pd: parseFloat(it.price_discount) || 0,
          ps: parseFloat(it.price_surcharge) || 0,
          mq: parseFloat(it.min_quantity) || 0,
          pid: parseInt(it.product_id) || 0,
          tid: parseInt(it.product_tmpl_id) || 0,
          cid: parseInt(it.categ_id) || 0,
          ds: it.date_start ? String(it.date_start).slice(0, 10) : "",
          de: it.date_end ? String(it.date_end).slice(0, 10) : "",
        }));
        if (items.length < 500) break;
        offset += 500;
      }

      // Arbre des catégories (pour la hiérarchie)
      const cats = await odooCall(uid, "product.category", "search_read", [],
        { fields: ["id", "parent_id"], limit: 1000 });
      const parentMap = {};
      (Array.isArray(cats) ? cats : []).forEach(c => { parentMap[parseInt(c.id)] = parseInt(c.parent_id) || 0; });

      await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/kv_store`, { method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ key: "pricelist_rules", value: JSON.stringify(rules), updated_at: new Date().toISOString() }) }),
        fetch(`${SUPABASE_URL}/rest/v1/kv_store`, { method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ key: "category_parents", value: JSON.stringify(parentMap), updated_at: new Date().toISOString() }) }),
      ]);

      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "load", done: true, pricelist: PRICELIST_ID, total_rules: rules.length,
        categories: Object.keys(parentMap).length,
      })};
    }

    // ══ STEP APPLY : calcul du prix par produit (upsert groupé) ═════════
    if (step === "apply") {
      const offset = parseInt(params.offset || "0");
      const BATCH = 500;

      const [rulesRes, parRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.pricelist_rules&select=value`, { headers: SB }),
        fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.category_parents&select=value`, { headers: SB }),
      ]);
      const rulesRows = await rulesRes.json();
      if (!rulesRows?.[0]?.value) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Lancez step=load d'abord" }) };
      }
      const rules = JSON.parse(rulesRows[0].value);
      const parRows = await parRes.json();
      const parentMap = parRows?.[0]?.value ? JSON.parse(parRows[0].value) : {};

      const ix = indexRegles(rules);
      const { tiersByPid, tiersByTid } = ix;

      const prodRes = await fetch(
        `${SUPABASE_URL}/rest/v1/odoo_catalog?select=cip,odoo_pid,odoo_tmpl_id,categ_id,list_price,discounted_price&order=cip.asc`,
        { headers: { ...SB, "Range": `${offset}-${offset + BATCH - 1}`, "Prefer": "count=exact" } }
      );
      const total = parseInt(prodRes.headers.get("content-range")?.split("/")?.[1] || "0");
      const products = await prodRes.json();
      if (!Array.isArray(products) || products.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ step: "apply", done: true, offset, total }) };
      }

      const rows = [];
      for (const p of products) {
        const lp = parseFloat(p.list_price) || 0;
        if (lp <= 0) continue;

        // Minimum des règles applicables (produit, modèle, catégories, barème global)
        const price = prixUnitaire(p, ix, parentMap);

        // Garde-fous : prix valable et < prix catalogue, sinon pas de remise.
        // discount_pct est NOT NULL en base : on efface avec 0, jamais null
        // (un null faisait rejeter le lot entier de 500 → étape prix à l'arrêt).
        // Paliers de quantité (« moins cher dès N unités ») : règles produit mq ≥ 2,
        // on ne garde que celles STRICTEMENT meilleures que le prix unitaire.
        const unit = (price != null && price > 0 && price < lp) ? price : lp;
        const tiers = [];
        for (const r of [...(tiersByPid[p.odoo_pid] || []), ...(tiersByTid[p.odoo_tmpl_id] || [])]) {
          const tp = applyRule(r, lp);
          if (tp == null || tp <= 0 || tp >= unit) continue;
          const prev = tiers.find(t => t.min_qty === r.mq);
          if (prev) { if (tp < prev.price) prev.price = tp; }
          else tiers.push({ min_qty: r.mq, price: tp });
        }
        tiers.sort((a, b) => a.min_qty - b.min_qty);
        tiers.forEach(t => { t.pct = Math.round((1 - t.price / lp) * 1000) / 10; });
        const priceTiers = tiers.length ? tiers : null;

        // Chaque ligne est réécrite (remise ou effacement) → plus de valeur périmée.
        if (price == null || price <= 0 || price >= lp) {
          rows.push({ cip: p.cip, discounted_price: null, discount_pct: 0, price_tiers: priceTiers });
          continue;
        }
        const discountPct = Math.round((1 - price / lp) * 1000) / 10;
        rows.push({ cip: p.cip, discounted_price: price, discount_pct: discountPct, price_tiers: priceTiers });
      }

      let updated = 0;
      const failed = [];
      let tiersColumnMissing = false;
      if (rows.length > 0) {
        const upsert = (body) => fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog`, {
          method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(body),
        });
        let upRes = await upsert(rows);
        let firstErr = upRes.ok ? "" : (await upRes.text()).slice(0, 200);
        if (!upRes.ok && /price_tiers/.test(firstErr)) {
          // Colonne pas encore créée (alter table odoo_catalog add column price_tiers jsonb)
          // → on écrit sans les paliers plutôt que de bloquer les prix.
          tiersColumnMissing = true;
          rows.forEach(r => { delete r.price_tiers; });
          upRes = await upsert(rows);
          firstErr = upRes.ok ? "" : (await upRes.text()).slice(0, 200);
        }
        if (upRes.ok) {
          updated = rows.length;
        } else {
          // Lot refusé : on réessaie ligne par ligne pour isoler la ou les
          // lignes fautives au lieu de perdre les 500 autres prix.
          for (const r of rows) {
            const one = await upsert([r]);
            if (one.ok) updated++;
            else failed.push({ cip: r.cip, error: (await one.text()).slice(0, 160) });
          }
          if (updated === 0) {
            return { statusCode: 502, headers: cors, body: JSON.stringify({ error: `upsert prix échoué: ${firstErr}`, step: "apply", offset, failed: failed.slice(0, 5) }) };
          }
        }
      }

      const nextOffset = offset + products.length;
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        step: "apply", done: nextOffset >= total, offset, next_offset: nextOffset, updated, total,
        ...(failed.length ? { failed_count: failed.length, failed: failed.slice(0, 10) } : {}),
        ...(tiersColumnMissing ? { tiers_column_missing: true } : {}),
      })};
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "step=load ou step=apply" }) };
  } catch (err) {
    console.error("[price-sync]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
