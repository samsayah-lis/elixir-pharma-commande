// ── OTP pharmacie : envoi du code à 6 chiffres ─────────────────────────
// POST /pharmacy-otp-send { email }
// Ne déclenche l'envoi que si l'email correspond à une pharmacie connue.
// Parité avec pharmacy-lookup : cache Supabase PUIS fallback Odoo.
// Correctif de sécurité du 19/10/2026 : la réponse dit si l'adresse est cliente (adresse inconnue → parcours
// « nouveau client », gardé tel quel) ; la limite par instance (5/min, remise à zéro à chaque démarrage) laissait
// tester des adresses en masse. Limite DURABLE (kv_store) comptée avant toute recherche, adresse connue ou non, par
// connexion (IPv4 entière, IPv6 par préfixe /64 : cleIp) : 10 demandes par heure (test d'adresses en masse), dont 5 au
// plus pour une même adresse. Aucun plafond par adresse SEUL : un tiers ne peut plus bloquer la connexion d'une
// pharmacie en demandant des codes à sa place (rafales d'e-mails : Supabase n'envoie qu'un code par adresse et par
// minute). Un code que Supabase n'envoie pas (moins d'une minute après le précédent, panne) ne compte pas.
// Au-delà → 429 { success: false, error } (message affiché par l'écran de connexion), sans rien lire.
// Un code envoyé remet à zéro les essais de code erronés de l'adresse (pharmacy-otp-verify).
import { getCors } from "./cors.js";
import { rateLimit, limiteDurable, effacerCompteur, cleIp } from "./rate-limit.js";
import { findElixirPharmacy } from "./_pharmacies.js";

const PAR_IP = 10, PAR_ADRESSE_ET_IP = 5, FENETRE = 3600;   // par heure

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // anon key
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

export const handler = async (event) => {
  const cors = { ...getCors(event), "Cache-Control": "no-store" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };
  // première barrière, par instance (rafales) ; la vraie limite est la limite durable ci-dessous
  const rl = rateLimit(event, 5, 60); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const email = (typeof body?.email === "string" ? body.email : "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Email invalide" }) };
  }

  // 0. Limite durable, avant toute recherche (sinon le nombre d'essais dirait aussi quelque chose)
  let liberer = async () => {};
  try {
    const ip = cleIp(event);
    const limite = await limiteDurable([
      { nom: "otp-ip", valeur: ip, max: PAR_IP },
      { nom: "otp-adresse-ip", valeur: `${email}|${ip}`, max: PAR_ADRESSE_ET_IP },
    ], FENETRE);
    const refus = limite.refus;
    if (refus) {
      const min = Math.max(1, Math.ceil(refus.retryAfter / 60));
      return { statusCode: 429, headers: { ...cors, "Retry-After": String(refus.retryAfter) }, body: JSON.stringify({ success: false,
        error: `Trop de demandes de code ${refus.compteur === "otp-adresse-ip" ? "pour cette adresse" : "depuis cette connexion"} : réessayez dans ${min} min, ou appelez Elixir Pharma au 01 86 04 39 95.` }) };
    }
    liberer = limite.liberer;
  } catch (e) {
    // kv_store injoignable : la première barrière (par instance) reste la seule limite ; la connexion n'est pas bloquée
    console.warn("[otp-send] limite durable indisponible :", e.message);
  }

  // 1. Cache Supabase
  let known = false;
  try {
    const chk = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(email)}&select=cip&limit=1`,
      { headers: SB }
    );
    const rows = await chk.json();
    if (Array.isArray(rows) && rows[0]) known = true;
  } catch { /* on tente Odoo ci-dessous */ }

  // 2. Fallback Odoo (comme pharmacy-lookup) : fiche cliente Elixir (société 2) + mise en cache
  if (!known) {
    try {
      const row = await findElixirPharmacy(email);
      if (row) {
        known = true;
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies?on_conflict=email`, {
            method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row),
          });
        } catch { /* le cache n'est pas bloquant */ }
      }
    } catch (e) { console.warn("[otp-send] Odoo lookup:", e.message); }
  }

  if (!known) {
    // unknown:true → le front bascule sur le flux « nouveau client »
    return { statusCode: 404, headers: cors, body: JSON.stringify({ success: false, unknown: true, error: "Email non reconnu" }) };
  }

  // 3. Déclenche l'envoi du code OTP via Supabase Auth
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      await liberer().catch(() => {});   // code non envoyé (Supabase : un code par minute et par adresse) : ne compte pas
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: err.msg || err.error_description || `Envoi du code impossible (HTTP ${res.status})` }) };
    }
    // nouveau code : les essais erronés du code précédent ne comptent plus (pharmacy-otp-verify)
    await effacerCompteur("otp-essai", email).catch(() => {});
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (e) {
    await liberer().catch(() => {});
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
