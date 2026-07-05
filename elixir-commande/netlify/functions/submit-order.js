import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { verifyTokenAsync } from "./auth.js";
// Soumet une commande au frontal PharmaML via l'API INFOSOFT
const PHARMAML_URL  = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "";
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  // Transmission fournisseur : plafonner les envois par IP pour limiter l'abus.
  // (mitigation — une auth pharmacie reste à mettre en place pour fermer l'IDOR)
  const rl = rateLimit(event, 10, 60);
  if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  let { items, pharmacyName, pharmacyEmail, pharmacyCip, orderId } = payload;
  if (!items?.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "items manquants" }) };

  // Sécurité : si un jeton pharmacie valide est présent, le CIP vient du jeton
  // (email vérifié) et non du corps de la requête → pas d'usurpation possible.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const tok = authHeader.replace(/^Bearer\s+/i, "");
  const authUser = tok ? await verifyTokenAsync(tok) : null;
  if (authUser?.cip) pharmacyCip = authUser.cip;

  // Si pas de CIP, essayer de le retrouver dans Supabase par email
  if ((!pharmacyCip || pharmacyCip === "0" || pharmacyCip === 0) && pharmacyEmail && SUPABASE_URL) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(pharmacyEmail.trim().toLowerCase())}&select=cip&limit=1`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await res.json();
      if (rows?.[0]?.cip) pharmacyCip = rows[0].cip;
    } catch (e) { console.warn("[submit-order] Lookup CIP error:", e.message); }
  }

  if (!pharmacyCip || pharmacyCip === "0" || pharmacyCip === 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `CIP introuvable pour ${pharmacyEmail || "email inconnu"}` }) };
  }

  const body = [{
    identifiantPML: String(pharmacyCip),
    referenceCommande: String(orderId || Date.now()),
    lignes: items.map(i => ({
      CIP: i.cip || "",
      libelle: (i.name || "").substring(0, 50),
      quantiteCommandee: parseInt(i.qty) || 0,
      quantiteLivree: parseInt(i.qty) || 0,
      prix: i.pn != null ? Math.round(parseFloat(i.pn) * 100) / 100 : 0
    }))
  }];

  try {
    const url = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!res.ok || result?.status === "error") {
      const msg = result?.message || result?.errors?.[0]?.message || `HTTP ${res.status}`;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: msg, detail: result }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, commandes: result?.commandes || 1, pharmaml: result }) };
  } catch (err) {
    console.error("[submit-order] ERREUR:", err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
