// ── Diagnostic listes de prix Odoo (lecture seule) ─────────────────────
// GET /odoo-pricelists-audit  (admin ou x-cron-secret)
// Renvoie : listes de prix, usage par les pharmacies, et test de calcul
// du prix par liste (via le champ `price` recalculé avec la liste en contexte).
import { verifyAdmin, isCronAuthorized } from "./auth.js";
import { authenticate, odooCall } from "./odoo.js";
import { getCors } from "./cors.js";

export const handler = async (event) => {
  const cors = { ...getCors(event), "Cache-Control": "no-store", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  // Diagnostic lecture seule : secret via header (cron) OU via ?secret= (navigateur), sinon admin.
  const qsSecret = event.queryStringParameters?.secret;
  const secretOk = isCronAuthorized(event) || (process.env.CRON_SECRET && qsSecret === process.env.CRON_SECRET);
  if (!secretOk) {
    const auth = await verifyAdmin(event);
    if (auth.error) return auth.error;
  }

  try {
    const uid = await authenticate();

    // 1. Toutes les listes de prix
    const pricelists = await odooCall(uid, "product.pricelist", "search_read", [],
      { fields: ["id", "name"], limit: 200 });

    // 2. Usage par les pharmacies (échantillon de partenaires avec un CIP)
    const usage = {}; // pricelist_id → count
    let scanned = 0;
    for (let off = 0; off < 4000; off += 500) {
      const partners = await odooCall(uid, "res.partner", "search_read",
        [["ref", "!=", false]],
        { fields: ["ref", "property_product_pricelist"], limit: 500, offset: off });
      if (!Array.isArray(partners) || partners.length === 0) break;
      scanned += partners.length;
      partners.forEach(p => {
        const pl = parseInt(p.property_product_pricelist);
        if (pl > 0) usage[pl] = (usage[pl] || 0) + 1;
      });
      if (partners.length < 500) break;
    }
    const nameOf = (id) => (pricelists.find(pl => parseInt(pl.id) === id)?.name) || `#${id}`;
    const usageSorted = Object.entries(usage)
      .map(([id, count]) => ({ pricelist_id: parseInt(id), name: nameOf(parseInt(id)), pharmacies: count }))
      .sort((a, b) => b.pharmacies - a.pharmacies);

    // 3. Prendre des produits QUI ONT une règle dans #15, + compter les règles par liste
    const [rules15, rules5] = await Promise.all([
      odooCall(uid, "product.pricelist.item", "search_read", [["pricelist_id", "=", 15]],
        { fields: ["product_id", "fixed_price", "compute_price", "percent_price", "price_discount", "min_quantity", "applied_on"], limit: 2000 }),
      odooCall(uid, "product.pricelist.item", "search_read", [["pricelist_id", "=", 5]],
        { fields: ["product_id", "fixed_price", "compute_price", "min_quantity"], limit: 2000 }),
    ]);
    const count15 = Array.isArray(rules15) ? rules15.length : 0;
    const count5 = Array.isArray(rules5) ? rules5.length : 0;

    const price5 = {};
    (Array.isArray(rules5) ? rules5 : []).forEach(it => {
      const pid = parseInt(it.product_id);
      if (pid && it.compute_price === "fixed") price5[pid] = it.fixed_price;
    });

    const sample15 = (Array.isArray(rules15) ? rules15 : [])
      .filter(it => parseInt(it.product_id) > 0 && it.compute_price === "fixed")
      .slice(0, 12);
    const pids15 = sample15.map(it => parseInt(it.product_id));
    const prods = pids15.length ? await odooCall(uid, "product.product", "search_read",
      [["id", "in", pids15]], { fields: ["id", "default_code", "name", "list_price"], limit: 50 }) : [];
    const prodById = {};
    (Array.isArray(prods) ? prods : []).forEach(p => { prodById[parseInt(p.id)] = p; });

    const comparison = sample15.map(it => {
      const pid = parseInt(it.product_id);
      const p = prodById[pid] || {};
      const lp = parseFloat(p.list_price) || null;
      const f15 = parseFloat(it.fixed_price);
      return {
        cip: p.default_code || `pid:${pid}`,
        name: (p.name || "").slice(0, 40),
        list_price: p.list_price,
        prix_liste15: `${it.fixed_price} €`,
        remise_15_pct: (lp && f15) ? Math.round((1 - f15 / lp) * 1000) / 10 : null,
        prix_liste5: price5[pid] != null ? `${price5[pid]} €` : "—",
      };
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      partners_scanned: scanned,
      usage: usageSorted,
      rule_counts: { liste_5: count5 >= 2000 ? "2000+" : count5, liste_15: count15 >= 2000 ? "2000+" : count15 },
      comparison,
      note: "comparison = produits qui ONT un prix dans #15 : prix négocié #15 (+ remise %) vs #5. Dites-moi si prix_liste15 correspond au VRAI prix remisé attendu.",
    }, null, 2) };
  } catch (err) {
    console.error("[pricelists-audit]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
