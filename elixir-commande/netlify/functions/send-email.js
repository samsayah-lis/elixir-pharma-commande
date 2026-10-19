import { rateLimit } from "./rate-limit.js";
// ── Email — envoi via EmailJS REST API côté serveur ───────────────────
// POST /send-email  { template_params: { pharmacy_name, pharmacy_email, ... } }
// Correctif de sécurité du 19/10/2026 :
//  • destinataire FIXÉ par le serveur (to_email envoyé par le navigateur ignoré) : la fonction ne peut plus servir à
//    écrire à n'importe qui au nom d'Elixir ;
//  • jeton pharmacie joint (e-mail de commande du site) : adresse et nom de la pharmacie = ceux de l'e-mail VÉRIFIÉ du
//    jeton ; jeton admin (saisie Elixir pour une pharmacie) : paramètres inchangés ;
//  • jeton joint mais invalide ou expiré → 401 { error: "reconnexion" } : RIEN n'est envoyé (le site renouvelle le jeton) ;
//  • sans jeton (demande d'accès « nouveau client », page ouverte avant la mise en ligne, ou appel hors du site) :
//    l'e-mail part, le nom précédé de « ⚠ IDENTITÉ NON VÉRIFIÉE — » (Origin et Referer se falsifient hors navigateur) :
//    une commande reçue ainsi se confirme par téléphone avec la pharmacie avant d'être saisie.
import { getCors } from "./cors.js";
import { verifyTokenAsync } from "./auth.js";

const EMAILJS_SERVICE_ID  = process.env.EMAILJS_SERVICE_ID  || "service_jbnqhnv";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_hcu9i7q";
const EMAILJS_PUBLIC_KEY  = process.env.EMAILJS_PUBLIC_KEY  || "7KPf-we-Cmh8cSuRy";
const DESTINATAIRE = "pharmacien@elixirpharma.fr";   // seule adresse servie (celle du site : DEFAULT_RECIPIENT)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = { ...getCors(event), "Cache-Control": "no-store" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const rl = rateLimit(event); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  // Vérification origin — bloque les appels depuis des sites tiers (navigateur seulement : falsifiable ailleurs)
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const referer = event.headers?.referer || event.headers?.Referer || "";
  const ALLOWED = ["elixir-commande.expepharma.com", "commandes-elixir.netlify.app", "localhost"];
  if (!ALLOWED.some(d => origin.includes(d) || referer.includes(d))) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: "Origine non autorisée" }) };
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const template_params = body?.template_params;
  if (!template_params || typeof template_params !== "object" || Array.isArray(template_params)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "template_params manquant" }) };

  // ── Expéditeur : jeton vérifié côté serveur ──
  const token = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  const user = token ? await verifyTokenAsync(token) : null;
  if (token && !user) return { statusCode: 401, headers: cors, body: JSON.stringify({ success: false, error: "reconnexion",
    message: "Session expirée : reconnectez-vous avec le code reçu par e-mail pour envoyer votre commande." }) };
  const params = { ...template_params, to_email: DESTINATAIRE };
  if (!user) params.pharmacy_name = `⚠ IDENTITÉ NON VÉRIFIÉE — ${String(template_params.pharmacy_name ?? "").slice(0, 200)}`;
  else if (!user.isAdmin) {
    const mail = String(user.email || "").trim().toLowerCase();
    params.pharmacy_email = mail;
    try {   // nom de la fiche du compte (à défaut, celui envoyé par le site, l'adresse restant celle du jeton)
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(mail)}&select=name&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      const rows = pr.ok ? await pr.json() : [];
      if (Array.isArray(rows) && rows[0]?.name) params.pharmacy_name = rows[0].name;
    } catch { /* nom du site gardé */ }
  }

  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: params,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[send-email] EmailJS error:", err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Erreur envoi email" }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error("[send-email]", e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
