// Recherche une pharmacie : Supabase d'abord, fallback Odoo direct si pas trouvée
import { authenticate, odooCall } from "./odoo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
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

  const emailNorm = email.trim().toLowerCase();

  // ── 1. Chercher dans Supabase (cache) ─────────────────────────────────────
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(emailNorm)}&limit=1`,
    { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
  );

  if (res.ok) {
    const rows = await res.json();
    if (rows && rows.length > 0) {
      const p = rows[0];
      console.log(`[pharmacy-lookup] ✓ Supabase: ${p.name}`);
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        found: true,
        pharmacy: { name: p.name, email: p.email, cip: p.cip||"", street: p.street||"", cp: p.cp||"", ville: p.ville||"", tel: p.tel||"" }
      })};
    }
  }

  // ── 2. Fallback : interroger Odoo directement ──────────────────────────────
  console.log(`[pharmacy-lookup] Pas dans Supabase, fallback Odoo pour: ${emailNorm}`);
  try {
    const uid = await authenticate();
    const partners = await odooCall(uid, "res.partner", "search_read",
      [["email", "ilike", emailNorm], ["active", "=", true]],
      { fields: ["id", "name", "email", "ref", "street", "zip", "city", "phone", "mobile"], limit: 5 }
    );

    // Cherche une correspondance exacte sur l'email
    const match = (partners || []).find(p => p.email?.trim().toLowerCase() === emailNorm);
    if (!match) {
      console.log(`[pharmacy-lookup] Introuvable dans Odoo: ${emailNorm}`);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
    }

    const pharmacy = {
      name:   match.name || "",
      email:  emailNorm,
      cip:    match.ref  || "",
      street: match.street || "",
      cp:     match.zip  || "",
      ville:  match.city || "",
      tel:    match.mobile || match.phone || "",
    };

    // ── 3. Sauvegarder dans Supabase pour les prochaines fois ─────────────
    await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(pharmacy),
    });

    console.log(`[pharmacy-lookup] ✓ Odoo+cache: ${pharmacy.name} (CIP=${pharmacy.cip})`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: true, pharmacy }) };

  } catch (e) {
    console.error("[pharmacy-lookup] Odoo fallback error:", e.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
  }
};
