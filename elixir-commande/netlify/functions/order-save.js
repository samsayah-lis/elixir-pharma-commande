// Sauvegarde une commande dans Supabase — FIX BUG-04 (source) + BUG-10 (error handling)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let order;
  try { order = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const row = {
    id: order.id,
    date: order.date || new Date().toISOString(),
    pharmacy_name: order.pharmacyName,
    pharmacy_email: order.pharmacyEmail,
    pharmacy_cip: order.pharmacyCip || null,
    is_client: order.isClient ?? true,
    items: order.items,
    total_ht: order.totalHt,
    nb_lignes: order.nbLignes,
    csv: order.csv || null,
    processed: false,
    source: order.source || "catalogue",
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", "Prefer": "return=minimal"
      },
      body: JSON.stringify(row)
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[order-save] Supabase error:", err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: err }) };
    }

    // ── Décrémenter le stock dans odoo_catalog ──────────────────────────
    // Parse les items de la commande et décrémente les quantités
    try {
      const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          const cip = item.cip || item.CIP || item.CIP13;
          const qty = parseInt(item.qty || item.quantite || item.Quantité || 0);
          if (!cip || qty <= 0) continue;

          // Lire le stock actuel
          const getRes = await fetch(
            `${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${cip}&select=available`,
            { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
          );
          const rows = await getRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            const current = parseInt(rows[0].available) || 0;
            const newAvailable = Math.max(0, current - qty);
            await fetch(
              `${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${cip}`,
              {
                method: "PATCH",
                headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ available: newAvailable, in_stock: newAvailable > 0 }),
              }
            );
          }
        }
        console.log(`[order-save] Stock décrémenté pour ${items.length} lignes`);
      }
    } catch (e) {
      console.warn("[order-save] Stock decrement error (non-bloquant):", e.message);
    }

    console.log(`[order-save] ✓ ${order.id} (${order.pharmacyName}, source=${row.source})`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, id: order.id }) };
  } catch (e) {
    console.error("[order-save] Exception:", e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
