import { getCors } from "./cors.js";
// Sauvegarde une commande dans Supabase + décrémentation stock (non-bloquante)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  let order;
  try { order = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  // Normaliser l'ID en nombre (la colonne est bigint)
  let orderId = order.id;
  if (typeof orderId === "string") {
    const num = parseInt(orderId.replace(/\D/g, ""));
    orderId = num > 0 ? num : Date.now();
  }

  const row = {
    id: orderId,
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

    console.log(`[order-save] ✓ ${orderId} (${order.pharmacyName}, source=${row.source})`);

    // ── Décrémentation stock — fire-and-forget (non-bloquant) ──────────
    // On ne bloque PAS la réponse pour le client
    try {
      const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
      if (Array.isArray(items)) {
        // Décrémente en parallèle (max 5 en même temps)
        const batch = items.filter(i => (i.cip || i.CIP || i.CIP13) && parseInt(i.qty || i.quantite || 0) > 0);
        for (let i = 0; i < batch.length; i += 5) {
          await Promise.all(batch.slice(i, i + 5).map(async (item) => {
            const cip = item.cip || item.CIP || item.CIP13;
            const qty = parseInt(item.qty || item.quantite || 0);
            try {
              const getRes = await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${encodeURIComponent(cip)}&select=available`,
                { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
              const rows = await getRes.json();
              if (Array.isArray(rows) && rows.length > 0) {
                const newAvailable = Math.max(0, (parseInt(rows[0].available) || 0) - qty);
                await fetch(`${SUPABASE_URL}/rest/v1/odoo_catalog?cip=eq.${encodeURIComponent(cip)}`, {
                  method: "PATCH",
                  headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ available: newAvailable, in_stock: newAvailable > 0 }),
                });
              }
            } catch (e) { /* ignore per-item errors */ }
          }));
        }
      }
    } catch (e) { console.warn("[order-save] Stock decrement error:", e.message); }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, id: orderId }) };
  } catch (e) {
    console.error("[order-save] Exception:", e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
