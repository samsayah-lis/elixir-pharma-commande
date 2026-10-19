// Recherche une pharmacie : Supabase cache → Odoo fallback → met à jour le cache
// Sert UNIQUEMENT l'ancienne connexion sans code (pharmacy_auth_mode = "legacy"), avant connexion : publique,
// donc (lot 0, 16/10/2026) limitée par IP et réduite à ce que l'écran « Est-ce bien votre pharmacie ? » affiche
// et à ce que la session garde (nom, e-mail saisi, CIP, code postal, ville : ni rue ni téléphone).
// En mode code (OTP, production depuis le 07/07/2026), ou si le mode ne peut pas être lu : aucune recherche,
// réponse { found: false, otp: true } — le site passe alors par pharmacy-otp-send (seul à dire si l'adresse est connue).
import { findElixirPharmacy } from "./_pharmacies.js";
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const validCip = (cip) => cip && cip !== "0" && cip !== "false" && cip !== "";

// Mode de connexion des pharmacies (ec_config, celui que le site lit par config-get) : l'ancien mode doit être
// déclaré explicitement ; toute autre valeur, une clé absente ou une lecture en échec valent « otp » (fermé).
async function modeConnexion() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_config?key=eq.pharmacy_auth_mode&select=value`, { headers: SB });
    if (!res.ok) return "otp";
    const rows = await res.json();
    return Array.isArray(rows) && rows[0]?.value === "legacy" ? "legacy" : "otp";
  } catch { return "otp"; }
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };
  // même limite que l'envoi du code (pharmacy-otp-send) : une connexion n'appelle qu'une fois
  const rl = rateLimit(event, 5, 60); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return json(400, { error: "JSON invalide" }); }

  const email = typeof body?.email === "string" ? body.email : "";
  if (!email) return json(400, { error: "email manquant" });

  const emailNorm = email.trim().toLowerCase();

  // ── 0. Mode code (OTP) : l'identité ne sort jamais d'ici ───────────────
  if (await modeConnexion() !== "legacy") return json(200, { found: false, otp: true });

  // Réponse : seulement les champs de l'écran de confirmation et de la session
  const found = (p) => json(200, { found: true,
    pharmacy: { name: p.name || "", email: emailNorm, cip: validCip(p.cip) ? p.cip : "", cp: p.cp || "", ville: p.ville || "" } });

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
  if (cached && validCip(cached.cip)) return found(cached);

  // ── 2. Cache absent ou CIP invalide → fiche cliente Elixir (société 2) dans Odoo ──
  try {
    const row = await findElixirPharmacy(emailNorm);
    if (!row) {
      // Aucune fiche Elixir ne porte cette adresse : le cache, tenu par la synchronisation
      // (clients Elixir uniquement), fait foi — ancienne adresse d'une pharmacie Elixir ou ajout manuel.
      if (cached) return found(cached);
      return json(200, { found: false });
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
    return json(200, { found: false });
  }
};
