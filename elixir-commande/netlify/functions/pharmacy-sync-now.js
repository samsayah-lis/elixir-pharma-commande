// Endpoint HTTP pour déclencher la sync pharmacies manuellement
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  // Protection basique
  const token = event.queryStringParameters?.token;
  if (token !== "elixir2026") {
    return { statusCode: 403, body: "Forbidden" };
  }

  try {
    const uid = await authenticate();
    const results = [];
    let offset = 0;
    while (true) {
      const page = await odooCall(uid, "res.partner", "search_read",
        [["customer_rank", ">", 0], ["email", "!=", false], ["active", "=", true]],
        { fields: ["id", "name", "email", "ref", "street", "zip", "city", "phone", "mobile"], limit: 500, offset }
      );
      if (!Array.isArray(page) || page.length === 0) break;
      results.push(...page);
      if (page.length < 500) break;
      offset += 500;
    }

    const rows = results.map(p => ({
      email: p.email.trim().toLowerCase(),
      name: p.name || "",
      cip: p.ref || "",
      street: p.street || "",
      cp: p.zip || "",
      ville: p.city || "",
      tel: p.phone || p.mobile || "",
      odoo_id: p.id,
      updated_at: new Date().toISOString(),
    }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows),
    });

    if (!res.ok) throw new Error("Supabase: " + await res.text());

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, count: rows.length, message: `${rows.length} pharmacies synchronisées` })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
