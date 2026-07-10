// ── Diagnostic listes de prix Odoo (lecture seule) ─────────────────────
// GET /odoo-pricelists-audit  (admin ou x-cron-secret)
// Renvoie : listes de prix, usage par les pharmacies, et test de calcul
// du prix par liste (via le champ `price` recalculé avec la liste en contexte).
import { verifyAdmin, isCronAuthorized } from "./auth.js";
import { authenticate, odooCall } from "./odoo.js";
import { getCors } from "./cors.js";

export const handler = async (event) => {
  const cors = getCors(event);
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

    // 3. Test du calcul de prix : 3 produits témoins, prix sous chaque liste utilisée
    const sampleProds = await odooCall(uid, "product.product", "search_read",
      [["default_code", "!=", false], ["list_price", ">", 20], ["sale_ok", "=", true]],
      { fields: ["id", "default_code", "name", "list_price"], limit: 3 });
    const sampleIds = sampleProds.map(p => parseInt(p.id));

    const priceTest = {};
    const topPls = usageSorted.slice(0, 6).map(u => u.pricelist_id);
    for (const plId of topPls) {
      const priced = await odooCall(uid, "product.product", "search_read",
        [["id", "in", sampleIds]],
        { fields: ["default_code", "list_price", "price"], limit: 5, context: { pricelist: plId } });
      priceTest[plId] = {
        name: nameOf(plId),
        products: (priced || []).map(p => ({
          cip: p.default_code, list_price: p.list_price, price_liste: p.price,
        })),
      };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      pricelists: pricelists.map(p => ({ id: parseInt(p.id), name: p.name })),
      partners_scanned: scanned,
      usage: usageSorted,
      sample_products: sampleProds.map(p => ({ cip: p.default_code, name: p.name, list_price: p.list_price })),
      price_test: priceTest,
      note: "price_liste = prix calculé par Odoo pour cette liste (champ `price` avec la liste en contexte). S'il diffère de list_price, le calcul par contexte fonctionne.",
    }, null, 2) };
  } catch (err) {
    console.error("[pricelists-audit]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
