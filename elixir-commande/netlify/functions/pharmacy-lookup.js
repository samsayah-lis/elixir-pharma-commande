// Recherche une pharmacie dans Odoo par email
import { authenticate, odooCall } from "./odoo.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { email } = body;
  if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "email manquant" }) };

  try {
    const uid = await authenticate();

    // Cherche le partenaire par email dans Odoo
    const partners = await odooCall(uid, "res.partner", "search_read",
      [["email", "=ilike", email.trim()]],
      {
        fields: ["id", "name", "email", "ref", "street", "zip", "city", "phone", "mobile", "customer_rank"],
        limit: 5
      }
    );

    if (!partners || partners.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
    }

    // Prend le premier résultat (ou le client si plusieurs)
    const p = partners.find(p => parseInt(p.customer_rank) > 0) || partners[0];

    const pharmacy = {
      name: p.name || "",
      email: p.email || email,
      cip: p.ref || "",           // Le CIP7 est stocké dans la référence interne Odoo
      street: p.street || "",
      cp: p.zip || "",
      ville: p.city || "",
      tel: p.phone || p.mobile || "",
    };

    console.log(`[pharmacy-lookup] ✓ Trouvé : ${pharmacy.name} (ref=${pharmacy.cip})`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: true, pharmacy }) };

  } catch (err) {
    console.error("[pharmacy-lookup] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
