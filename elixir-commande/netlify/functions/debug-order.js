// Test de création de commande Odoo — à supprimer après validation
import { authenticate, odooCall, ODOO_COMPANY } from "./odoo.js";

export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const uid = await authenticate();

    // Simule une commande test avec IBRANCE 75MG (CIP connu)
    const testCip = "3400930075272"; // IBRANCE 75MG
    const testEmail = event.queryStringParameters?.email || "";
    const testName  = event.queryStringParameters?.name  || "";

    // 1. Cherche le partenaire
    let partnerId = null;
    let partnerFound = null;
    if (testEmail) {
      const p = await odooCall(uid, "res.partner", "search_read",
        [["email", "=", testEmail]], { fields: ["id", "name", "email"], limit: 1 });
      if (p.length > 0) { partnerId = parseInt(p[0].id); partnerFound = p[0]; }
    }
    if (!partnerId && testName) {
      const p = await odooCall(uid, "res.partner", "search_read",
        [["name", "ilike", testName]], { fields: ["id", "name", "email"], limit: 3 });
      if (p.length > 0) { partnerId = parseInt(p[0].id); partnerFound = p[0]; }
    }

    // 2. Cherche le produit
    const products = await odooCall(uid, "product.product", "search_read",
      [["default_code", "=", testCip]], { fields: ["id", "name", "default_code"], limit: 1 });
    const product = products[0] || null;

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        step: "dry_run — aucune commande créée",
        company_id: ODOO_COMPANY,
        partner_searched: { email: testEmail, name: testName },
        partner_found: partnerFound,
        product_found: product,
        ready_to_create: !!(partnerId && product),
        next: partnerId && product
          ? "Appelle ?create=1 pour créer la commande test"
          : "Partenaire ou produit introuvable — corrige les paramètres"
      }, null, 2)
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
