// Commandes groupées U-Labs
// GET  /group-order?fournisseur=ulabs              → totaux par produit
// POST /group-order  { fournisseur, cip, pharmacy_cip, pharmacy_name, qty } → upsert
// DELETE /group-order?fournisseur=ulabs&pharmacy_cip=XXX → vider panier pharmacie
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Access-Control-Allow-Headers": "Content-Type" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const params = event.queryStringParameters || {};
  const fournisseur = params.fournisseur || "ulabs";

  // ── GET : récupère toutes les lignes du groupement ──
  if (event.httpMethod === "GET") {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_group_orders?fournisseur=eq.${fournisseur}&select=*`,
      { headers: H }
    );
    const rows = await res.json();
    return { statusCode: 200, headers: cors, body: JSON.stringify(rows) };
  }

  // ── POST : upsert une ligne (pharmacy_cip + cip + fournisseur = clé unique) ──
  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    const { cip, pharmacy_cip, pharmacy_name, qty } = body;
    if (!cip || !pharmacy_cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip et pharmacy_cip requis" }) };

    const now = new Date().toISOString();

    if (qty === 0) {
      // Supprimer la ligne
      await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_group_orders?fournisseur=eq.${fournisseur}&cip=eq.${cip}&pharmacy_cip=eq.${pharmacy_cip}`,
        { method: "DELETE", headers: H }
      );
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/elixir_group_orders`, {
        method: "POST",
        headers: { ...H, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ fournisseur, cip, pharmacy_cip, pharmacy_name, qty, updated_at: now })
      });
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  // ── DELETE : vider tout le panier d'une pharmacie ──
  if (event.httpMethod === "DELETE") {
    const { pharmacy_cip } = params;
    if (!pharmacy_cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "pharmacy_cip requis" }) };
    await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_group_orders?fournisseur=eq.${fournisseur}&pharmacy_cip=eq.${pharmacy_cip}`,
      { method: "DELETE", headers: H }
    );
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, headers: cors, body: "Method not allowed" };
};
