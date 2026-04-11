// Recherche une pharmacie : Supabase cache → Odoo fallback → met à jour le cache
import { authenticate, odooCall } from "./odoo.js";
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const validCip = (cip) => cip && cip !== "0" && cip !== "false" && cip !== "";

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { email } = body;
  if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "email manquant" }) };

  const emailNorm = email.trim().toLowerCase();

  // ── 1. Chercher dans Supabase (cache) ─────────────────────────────────────
  let cached = null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(emailNorm)}&limit=1`,
      { headers: SB }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows?.length > 0) cached = rows[0];
    }
  } catch {}

  // Si le cache a un CIP valide, on le renvoie
  if (cached && validCip(cached.cip)) {
    console.log(`[pharmacy-lookup] ✓ Supabase cache: ${cached.name} (CIP=${cached.cip})`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      found: true,
      pharmacy: { name: cached.name, email: cached.email, cip: cached.cip, street: cached.street||"", cp: cached.cp||"", ville: cached.ville||"", tel: cached.tel||"" }
    })};
  }

  // ── 2. Cache absent ou CIP invalide → interroger Odoo ────────────────────
  console.log(`[pharmacy-lookup] ${cached ? "Cache CIP invalide" : "Pas en cache"}, fallback Odoo pour: ${emailNorm}`);
  try {
    const uid = await authenticate();
    const partners = await odooCall(uid, "res.partner", "search_read",
      [["email", "ilike", emailNorm], ["active", "=", true]],
      { fields: ["id", "name", "email", "ref", "cip", "street", "zip", "city", "phone", "mobile"], limit: 5 }
    );

    const match = (partners || []).find(p => p.email?.trim().toLowerCase() === emailNorm);
    if (!match) {
      console.log(`[pharmacy-lookup] Introuvable dans Odoo: ${emailNorm}`);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
    }

    // Priorité : cip > ref (ref contient souvent "0")
    const cipValue = validCip(match.cip) ? match.cip : validCip(match.ref) ? match.ref : "";

    const pharmacy = {
      name:   match.name || "",
      email:  emailNorm,
      cip:    cipValue,
      street: match.street || "",
      cp:     match.zip  || "",
      ville:  match.city || "",
      tel:    match.mobile || match.phone || "",
    };

    // ── 3. Sauvegarder / mettre à jour le cache Supabase ────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies`, {
      method: "POST",
      headers: { ...SB, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(pharmacy),
    });

    console.log(`[pharmacy-lookup] ✓ Odoo→cache: ${pharmacy.name} (CIP=${pharmacy.cip})`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: true, pharmacy }) };

  } catch (e) {
    console.error("[pharmacy-lookup] Odoo error:", e.message);
    // Si on a un cache même avec CIP mauvais, le renvoyer quand même (mieux que rien)
    if (cached) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        found: true,
        pharmacy: { name: cached.name, email: cached.email, cip: cached.cip||"", street: cached.street||"", cp: cached.cp||"", ville: cached.ville||"", tel: cached.tel||"" }
      })};
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
  }
};
