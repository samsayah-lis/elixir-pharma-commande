import { authenticate, odooCall } from "./odoo.js";
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const email = event.queryStringParameters?.email || "pharmaciedesprinces@orange.fr";

  try {
    const uid = await authenticate();

    // 1. Recherche par email
    const byEmail = await odooCall(uid, "res.partner", "search_read",
      [["email", "ilike", email.trim()], ["active", "=", true]],
      { fields: ["id", "name", "email", "ref", "cip", "street", "zip", "city", "phone", "mobile", "is_company", "customer_rank"], limit: 5 }
    );

    // 2. Recherche par nom aussi
    const byName = await odooCall(uid, "res.partner", "search_read",
      [["name", "ilike", "princes"], ["active", "=", true]],
      { fields: ["id", "name", "email", "ref", "cip", "street", "zip", "city"], limit: 5 }
    );

    // 3. Vérifier les champs disponibles sur res.partner liés au CIP
    const fields = await odooCall(uid, "res.partner", "fields_get",
      [],
      { attributes: ["string", "type"] }
    );
    const cipFields = Object.entries(fields || {}).filter(([k, v]) => {
      const s = (v.string || "").toLowerCase();
      return s.includes("cip") || k.includes("cip") || s.includes("identifiant") || k.includes("pml");
    });

    // 4. Check Supabase elixir_pharmacies
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    let supabaseResult = null;
    if (SUPABASE_URL) {
      const sbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&limit=5`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
      );
      supabaseResult = await sbRes.json();
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      search_email: email,
      odoo_by_email: byEmail,
      odoo_by_name: byName,
      cip_related_fields: cipFields.map(([k, v]) => ({ field: k, label: v.string, type: v.type })),
      supabase_pharmacies: supabaseResult,
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
