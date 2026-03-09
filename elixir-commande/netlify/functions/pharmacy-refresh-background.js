import { schedule } from "@netlify/functions";
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function fetchAllCustomers(uid) {
  const results = [];
  let offset = 0;
  while (true) {
    const page = await odooCall(uid, "res.partner", "search_read",
      [["customer_rank", ">", 0], ["email", "!=", false], ["active", "=", true]],
      {
        fields: ["id", "name", "email", "ref", "street", "zip", "city", "phone", "mobile"],
        limit: 500,
        offset,
      }
    );
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < 500) break;
    offset += 500;
  }
  return results;
}

async function saveToSupabase(pharmacies) {
  const rows = pharmacies.map(p => ({
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
  if (!res.ok) throw new Error("Supabase error: " + await res.text());
  return rows.length;
}

const refreshHandler = async () => {
  console.log("[pharmacy-refresh] Démarrage sync pharmacies Odoo → Supabase");
  try {
    const uid = await authenticate();
    const partners = await fetchAllCustomers(uid);
    console.log(`[pharmacy-refresh] ${partners.length} clients trouvés dans Odoo`);
    const count = await saveToSupabase(partners);
    console.log(`[pharmacy-refresh] ✓ ${count} pharmacies synchronisées`);
    return { statusCode: 200, body: JSON.stringify({ success: true, count }) };
  } catch (err) {
    console.error("[pharmacy-refresh] ERREUR:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = schedule("0 * * * *", refreshHandler);
