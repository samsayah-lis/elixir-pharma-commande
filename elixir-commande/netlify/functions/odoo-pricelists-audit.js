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

    // 3. Comparaison #5 vs #15 (et listes détectées) sur des produits témoins
    const sampleProds = await odooCall(uid, "product.product", "search_read",
      [["default_code", "!=", false], ["list_price", ">", 10]],
      { fields: ["id", "default_code", "name", "list_price"], limit: 8 });
    const sampleIds = sampleProds.map(p => parseInt(p.id));

    const listsToCompare = [...new Set([5, 15, ...usageSorted.slice(0, 3).map(u => u.pricelist_id)])];
    const rowByListPid = {}; // plId → { pid → item }
    for (const plId of listsToCompare) {
      const items = await odooCall(uid, "product.pricelist.item", "search_read",
        [["pricelist_id", "=", plId], ["product_id", "in", sampleIds]],
        { fields: ["product_id", "fixed_price", "compute_price", "percent_price", "price_discount", "min_quantity"], limit: 60 });
      const m = {};
      (Array.isArray(items) ? items : []).forEach(it => {
        const pid = parseInt(it.product_id);
        const mq = parseFloat(it.min_quantity) || 0;
        if (!m[pid] || mq < (parseFloat(m[pid].min_quantity) || 0)) m[pid] = it;
      });
      rowByListPid[plId] = m;
    }

    const comparison = sampleProds.map(p => {
      const pid = parseInt(p.id);
      const row = { cip: p.default_code, name: (p.name || "").slice(0, 40), list_price: p.list_price };
      listsToCompare.forEach(plId => {
        const it = rowByListPid[plId]?.[pid];
        row[`liste_${plId}`] = it
          ? (it.compute_price === "fixed" ? `${it.fixed_price} €` : `${it.compute_price} disc=${it.price_discount} pct=${it.percent_price}`)
          : "—";
      });
      return row;
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      partners_scanned: scanned,
      usage: usageSorted,
      lists_compared: listsToCompare.map(id => ({ id, name: nameOf(id) })),
      comparison,
      note: "Pour chaque produit : prix catalogue + prix dans chaque liste (— = pas de règle). Dites-moi quelle colonne (liste_5, liste_15…) correspond au VRAI prix remisé attendu.",
    }, null, 2) };
  } catch (err) {
    console.error("[pricelists-audit]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
