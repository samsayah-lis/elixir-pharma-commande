import { getCors } from "./cors.js";
import { verifyAdmin, verifyTokenAsync } from "./auth.js";
// ── Alertes retour en stock + remises péremption courte ─────────────────
// Lot 0 (16/10/2026) : les alertes demandent un jeton. Pharmacie = son CIP et son e-mail, ceux du JETON
// (tout pharmacy_cip / pharmacy_email venu du navigateur est ignoré) ; admin (saisie pour une pharmacie) =
// pharmacy_cip de la requête. Sans jeton valide → 401 { error: "reconnexion" } ; jeton sans CIP → 403 { error: "fiche" }.
// POST /restock-alert { cip, product_name }                                → s'abonner (admin : + pharmacy_cip, pharmacy_email)
// DELETE /restock-alert?cip=Y                                              → se désabonner (admin : + pharmacy_cip=X)
// GET  /restock-alert                                                      → mes alertes (admin : ?pharmacy_cip=X)
// GET  /restock-alert?cip=X                                                → admin : qui veut ce produit ?
// POST /restock-alert { action: "set_expiry_discount", cip, discount_pct } → admin : remise péremption
// GET  /restock-alert?action=expiry_discounts                              → lister les remises (public : catalogue, aucune donnée de pharmacie)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const validCip = (c) => { const s = String(c ?? "").trim(); return !!s && s !== "0" && s.toLowerCase() !== "false"; };

// Appelant d'une route « alertes » → { admin, cip, email } ou { erreur: réponse 401/403 }
async function appelant(event, json) {
  const token = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  const user = token ? await verifyTokenAsync(token) : null;
  if (!user) return { erreur: json(401, { error: "reconnexion", message: "Session expirée : reconnectez-vous pour gérer vos alertes." }) };
  if (user.isAdmin === true) return { admin: true };
  if (!validCip(user.cip)) return { erreur: json(403, { error: "fiche", message: "Aucune pharmacie n'est rattachée à ce compte." }) };
  return { admin: false, cip: String(user.cip).trim(), email: user.email || null };
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  const params = event.queryStringParameters || {};

  // ── GET ────────────────────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    // Liste des remises péremption courte
    if (params.action === "expiry_discounts") {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/expiry_discounts?select=*&order=cip`, { headers: H });
      const rows = await res.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(rows) ? rows : []) };
    }

    // Alertes pour un produit → contient les emails abonnés : réservé admin
    if (params.cip && !params.pharmacy_cip) {
      const { error: adminErr } = await verifyAdmin(event);
      if (adminErr) return { ...adminErr, headers: { ...adminErr.headers, ...cors } };
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/restock_alerts?cip=eq.${encodeURIComponent(params.cip)}&select=*`,
        { headers: H }
      );
      const rows = await res.json();
      return json(200, Array.isArray(rows) ? rows : []);
    }

    // Alertes d'une pharmacie : la sienne (jeton), ou celle choisie par l'admin
    const qui = await appelant(event, json);
    if (qui.erreur) return qui.erreur;
    const pharmacyCip = qui.admin ? params.pharmacy_cip : qui.cip;
    if (!pharmacyCip) return json(400, { error: "pharmacy_cip requis" });
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/restock_alerts?pharmacy_cip=eq.${encodeURIComponent(pharmacyCip)}&select=*`,
      { headers: H }
    );
    const rows = await res.json();
    return json(200, Array.isArray(rows) ? rows : []);
  }

  // ── POST ───────────────────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}") || {}; }
    catch { return json(400, { error: "JSON invalide" }); }

    // Admin : définir une remise péremption courte
    if (body.action === "set_expiry_discount") {
      const { error: adminErr } = await verifyAdmin(event);
      if (adminErr) return { ...adminErr, headers: { ...adminErr.headers, ...cors } };
      if (!body.cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip requis" }) };
      const row = {
        cip: body.cip,
        discount_pct: parseFloat(body.discount_pct) || 0,
        product_name: body.product_name || null,
        updated_at: new Date().toISOString(),
      };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/expiry_discounts`, {
        method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(row)
      });
      if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    }

    // S'abonner à une alerte retour en stock
    const qui = await appelant(event, json);
    if (qui.erreur) return qui.erreur;
    const pharmacyCip = qui.admin ? body.pharmacy_cip : qui.cip;
    if (!pharmacyCip || !body.cip) {
      return json(400, { error: qui.admin ? "pharmacy_cip et cip requis" : "cip requis" });
    }
    const row = {
      pharmacy_cip: pharmacyCip,
      pharmacy_email: qui.admin ? (body.pharmacy_email || null) : qui.email,
      cip: body.cip,
      product_name: body.product_name || null,
      created_at: new Date().toISOString(),
      notified: false,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/restock_alerts`, {
      method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(row)
    });
    if (!res.ok) return json(500, { error: await res.text() });
    return json(200, { success: true });
  }

  // ── DELETE ─────────────────────────────────────────────────────────────
  if (event.httpMethod === "DELETE") {
    const qui = await appelant(event, json);
    if (qui.erreur) return qui.erreur;
    const pharmacyCip = qui.admin ? params.pharmacy_cip : qui.cip;
    if (!pharmacyCip || !params.cip) {
      return json(400, { error: qui.admin ? "pharmacy_cip et cip requis" : "cip requis" });
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/restock_alerts?pharmacy_cip=eq.${encodeURIComponent(pharmacyCip)}&cip=eq.${encodeURIComponent(params.cip)}`,
      { method: "DELETE", headers: H }
    );
    if (!res.ok) return json(500, { error: await res.text() });
    return json(200, { success: true });
  }

  return { statusCode: 405, headers: cors, body: "Method not allowed" };
};
