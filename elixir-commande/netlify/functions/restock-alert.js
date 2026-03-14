// ── Alertes retour en stock + remises péremption courte ─────────────────
// POST /restock-alert { pharmacy_cip, pharmacy_email, cip, product_name }  → s'abonner
// DELETE /restock-alert?pharmacy_cip=X&cip=Y                               → se désabonner
// GET  /restock-alert?pharmacy_cip=X                                       → mes alertes
// GET  /restock-alert?cip=X                                                → qui veut ce produit?
// POST /restock-alert { action: "set_expiry_discount", cip, discount_pct } → admin: remise péremption
// GET  /restock-alert?action=expiry_discounts                              → lister les remises
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const params = event.queryStringParameters || {};

  // ── GET ────────────────────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    // Liste des remises péremption courte
    if (params.action === "expiry_discounts") {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/expiry_discounts?select=*&order=cip`, { headers: H });
      const rows = await res.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(rows) ? rows : []) };
    }

    // Alertes d'une pharmacie
    if (params.pharmacy_cip) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/restock_alerts?pharmacy_cip=eq.${params.pharmacy_cip}&select=*`,
        { headers: H }
      );
      const rows = await res.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(rows) ? rows : []) };
    }

    // Alertes pour un produit
    if (params.cip) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/restock_alerts?cip=eq.${params.cip}&select=*`,
        { headers: H }
      );
      const rows = await res.json();
      return { statusCode: 200, headers: cors, body: JSON.stringify(Array.isArray(rows) ? rows : []) };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "pharmacy_cip ou cip requis" }) };
  }

  // ── POST ───────────────────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");

    // Admin : définir une remise péremption courte
    if (body.action === "set_expiry_discount") {
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
    if (!body.pharmacy_cip || !body.cip) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "pharmacy_cip et cip requis" }) };
    }
    const row = {
      pharmacy_cip: body.pharmacy_cip,
      pharmacy_email: body.pharmacy_email || null,
      cip: body.cip,
      product_name: body.product_name || null,
      created_at: new Date().toISOString(),
      notified: false,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/restock_alerts`, {
      method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(row)
    });
    if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await res.text() }) };
    console.log(`[restock-alert] ✓ Alerte créée: ${body.pharmacy_cip} → ${body.cip}`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  // ── DELETE ─────────────────────────────────────────────────────────────
  if (event.httpMethod === "DELETE") {
    if (!params.pharmacy_cip || !params.cip) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "pharmacy_cip et cip requis" }) };
    }
    await fetch(
      `${SUPABASE_URL}/rest/v1/restock_alerts?pharmacy_cip=eq.${params.pharmacy_cip}&cip=eq.${params.cip}`,
      { method: "DELETE", headers: H }
    );
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, headers: cors, body: "Method not allowed" };
};
