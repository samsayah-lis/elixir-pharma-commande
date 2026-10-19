// ── OTP pharmacie : vérification du code ───────────────────────────────
// POST /pharmacy-otp-verify { email, token }  (token = code à 6 chiffres)
// Renvoie un jeton de session Supabase + la fiche pharmacie (nom, CIP).
// Correctif de sécurité du 19/10/2026 : la limite par instance (10/min, remise à zéro à chaque démarrage) ne freinait
// pas la devinette d'un code réparti sur plusieurs connexions. Limite DURABLE (kv_store) des codes erronés, sur 15 min :
// 5 par adresse, 20 par connexion (IPv4 entière, IPv6 par préfixe /64). Chaque essai est compté avant la vérification
// puis effacé s'il réussit (ou si Supabase ne répond pas) : seuls les codes faux restent. Un nouveau code
// (pharmacy-otp-send) efface les essais erronés de l'adresse. Au-delà → 429 { success: false, error } (affiché par
// l'écran du code). kv_store injoignable : limite par instance seulement (la connexion n'est pas bloquée).
import { getCors } from "./cors.js";
import { rateLimit, limiteDurable, cleIp } from "./rate-limit.js";

const ESSAIS_ADRESSE = 5, ESSAIS_IP = 20, FENETRE = 900;   // 15 min

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // anon key

export const handler = async (event) => {
  const cors = { ...getCors(event), "Cache-Control": "no-store" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };
  const rl = rateLimit(event, 10, 60); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const email = (typeof body?.email === "string" ? body.email : "").trim().toLowerCase();
  const otp = String(body?.token || body?.otp || "").trim();
  if (!email || !otp || email.length > 254) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Email et code requis" }) };

  // Codes erronés : limite durable, avant la vérification
  let liberer = async () => {};
  try {
    const limite = await limiteDurable([
      { nom: "otp-essai", valeur: email, max: ESSAIS_ADRESSE },
      { nom: "otp-essai-ip", valeur: cleIp(event), max: ESSAIS_IP },
    ], FENETRE);
    if (limite.refus) {
      const min = Math.max(1, Math.ceil(limite.refus.retryAfter / 60));
      return { statusCode: 429, headers: { ...cors, "Retry-After": String(limite.refus.retryAfter) }, body: JSON.stringify({ success: false,
        error: limite.refus.compteur === "otp-essai"
          ? `Trop de codes erronés pour cette adresse : demandez un nouveau code (« ← Changer d'e-mail », puis « Continuer ») ou réessayez dans ${min} min.`
          : `Trop de codes erronés depuis cette connexion : réessayez dans ${min} min, ou appelez Elixir Pharma au 01 86 04 39 95.` }) };
    }
    liberer = limite.liberer;
  } catch (e) { console.warn("[otp-verify] limite durable indisponible :", e.message); }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", email, token: otp }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // code faux ou expiré (4xx) : l'essai reste compté ; Supabase en panne ou saturé : il ne compte pas
      if (res.status >= 500 || res.status === 429) await liberer().catch(() => {});
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: err.msg || "Code invalide ou expiré" }) };
    }
    await liberer().catch(() => {});   // code juste : l'essai ne compte pas
    const data = await res.json();

    // Résout la fiche pharmacie (nom + CIP) pour pré-remplir la session côté front
    let pharmacy = null;
    try {
      const p = await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(email)}&select=cip,name&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await p.json();
      pharmacy = Array.isArray(rows) ? rows[0] || null : null;
    } catch {}

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      success: true,
      token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      pharmacy,
    })};
  } catch (e) {
    await liberer().catch(() => {});
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
