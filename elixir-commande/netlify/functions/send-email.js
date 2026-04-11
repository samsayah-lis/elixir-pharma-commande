// ── Email — envoi via EmailJS REST API côté serveur ───────────────────
// POST /send-email  { template_params: { to_email, pharmacy_name, ... } }
import { getCors } from "./cors.js";

const EMAILJS_SERVICE_ID  = process.env.EMAILJS_SERVICE_ID  || "service_jbnqhnv";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_hcu9i7q";
const EMAILJS_PUBLIC_KEY  = process.env.EMAILJS_PUBLIC_KEY  || "7KPf-we-Cmh8cSuRy";

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { template_params } = body;
  if (!template_params) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "template_params manquant" }) };

  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[send-email] EmailJS error:", err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Erreur envoi email" }) };
    }

    console.log(`[send-email] ✓ email envoyé (${template_params.pharmacy_name || "?"})`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error("[send-email]", e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
