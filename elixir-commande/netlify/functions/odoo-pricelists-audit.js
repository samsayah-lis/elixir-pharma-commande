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

    // 3. Détail complet des règles de #5 (globales + catégories) + arbre des catégories
    const PL = parseInt(event.queryStringParameters?.pl) || 5;
    const items = await odooCall(uid, "product.pricelist.item", "search_read",
      [["pricelist_id", "=", PL]],
      { fields: ["applied_on", "compute_price", "base", "fixed_price", "percent_price", "price_discount", "price_surcharge", "min_quantity", "categ_id", "product_id"], limit: 2000 });
    const arr = Array.isArray(items) ? items : [];
    const isApplied = (r, code) => String(r.applied_on || "").includes(code);
    const global_rules = arr.filter(r => isApplied(r, "3"));
    const category_rules = arr.filter(r => isApplied(r, "2"));
    const product_rules = arr.filter(r => isApplied(r, "0") || isApplied(r, "1"));

    const categTree = await odooCall(uid, "product.category", "search_read", [],
      { fields: ["id", "parent_id", "complete_name"], limit: 500 });

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      pricelist: PL,
      total_rules: arr.length,
      counts: { global: global_rules.length, category: category_rules.length, product: product_rules.length },
      global_rules,
      category_rules,
      product_rules_sample: product_rules.slice(0, 6),
      category_tree: (Array.isArray(categTree) ? categTree : []).map(c => ({ id: parseInt(c.id), parent_id: parseInt(c.parent_id) || null, name: c.complete_name })),
      note: "global_rules = barème par palier de prix ; category_rules = remises par catégorie (+ arbre pour la hiérarchie) ; product_rules = prix spécifiques. Sert à répliquer exactement le calcul de #5.",
    }, null, 2) };
  } catch (err) {
    console.error("[pricelists-audit]", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
