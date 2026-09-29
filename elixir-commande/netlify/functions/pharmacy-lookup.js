// Recherche une pharmacie : Supabase cache → Odoo fallback → met à jour le cache
import { findElixirPharmacy } from "./_pharmacies.js";
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
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      found: true,
      pharmacy: { name: cached.name, email: cached.email, cip: cached.cip, street: cached.street||"", cp: cached.cp||"", ville: cached.ville||"", tel: cached.tel||"" }
    })};
  }

  // ── 2. Cache absent ou CIP invalide → fiche cliente Elixir (société 2) dans Odoo ──
  const found = (p) => ({ statusCode: 200, headers: cors, body: JSON.stringify({ found: true,
    pharmacy: { name: p.name, email: p.email, cip: p.cip || "", street: p.street || "", cp: p.cp || "", ville: p.ville || "", tel: p.tel || "" } }) });
  try {
    const row = await findElixirPharmacy(emailNorm);
    if (!row) {
      // Aucune fiche Elixir ne porte cette adresse : le cache, tenu par la synchronisation
      // (clients Elixir uniquement), fait foi — ancienne adresse d'une pharmacie Elixir ou ajout manuel.
      if (cached) return found(cached);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
    }
    // ── 3. Mettre à jour le cache Supabase ──────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies?on_conflict=email`, {
      method: "POST",
      headers: { ...SB, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(row),
    });
    return found(row);
  } catch (e) {
    console.error("[pharmacy-lookup] Odoo error:", e.message);
    // Si on a un cache même avec CIP mauvais, le renvoyer quand même (mieux que rien)
    if (cached) return found(cached);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ found: false }) };
  }
};
