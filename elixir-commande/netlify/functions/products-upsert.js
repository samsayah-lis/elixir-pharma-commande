import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
// Crée ou met à jour un produit dans Supabase avec historique
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { product, action, author } = body;
  if (!product?.cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip manquant" }) };

  const now = new Date().toISOString();
  const oldCip = product.old_cip; // si changement de CIP
  const lookupCip = oldCip || product.cip;

  // Récupère l'historique existant si c'est une mise à jour
  let history = [];
  if (action !== "create") {
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(lookupCip)}&select=history`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await existing.json();
    if (rows?.[0]?.history) {
      try { history = JSON.parse(rows[0].history); } catch {}
    }
  }

  const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  const cipChange = !!oldCip && oldCip !== product.cip;
  // Changement de CIP : la ligne est renommée sur place (PATCH), jamais supprimée puis recréée — la photo
  // (image_url) et les colonnes non envoyées sont conservées ; refusé si le nouveau CIP existe déjà
  // (sinon l'upsert écrasait l'autre produit).
  if (cipChange) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(product.cip)}&select=cip,name,active`, { headers: SB });
    if (!r.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await r.text() }) };
    const deja = (await r.json())?.[0];
    if (deja) return { statusCode: 409, headers: cors, body: JSON.stringify({ error: `Le CIP ${product.cip} est déjà utilisé par « ${deja.name} »${deja.active === false ? " (produit désactivé)" : ""}` }) };
    history.push({ action: "cip_changed", date: now, author: author || "admin", changes: { old_cip: oldCip, new_cip: product.cip } });
  }

  // Ajoute l'entrée d'historique
  history.push({
    action: action || "update",
    date: now,
    author: author || "admin",
    changes: product._changes || null,
  });

  // Création : toutes les colonnes (absentes = vides). Mise à jour : seules les colonnes ENVOYÉES sont écrites
  // (avant, chaque modification remettait à vide « Prix carton », palier, etc. quand l'admin ne les envoyait pas).
  const CHAMPS = ["name", "section", "pv", "pct", "pn", "remise_eur", "colis", "carton", "note", "active", "source"];
  const row = { cip: product.cip };
  for (const k of CHAMPS) {
    if (action === "create") row[k] = product[k] ?? (k === "active" ? true : k === "source" ? "admin" : null);
    else if (product[k] !== undefined) row[k] = product[k];
  }
  row.history = JSON.stringify(history);
  row.updated_at = now;
  if (action === "create") row.created_at = now;

  const res = cipChange
    ? await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(oldCip)}`, {
        method: "PATCH", headers: { ...SB, "Prefer": "return=representation" }, body: JSON.stringify(row),
      })
    : await fetch(`${SUPABASE_URL}/rest/v1/elixir_products`, {
        method: "POST", headers: { ...SB, "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(row),
      });

  if (!res.ok) {
    const err = await res.text();
    console.error("[products-upsert] Supabase error:", err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
  }

  if (cipChange) {
    const maj = await res.json().catch(() => []);
    if (!Array.isArray(maj) || !maj.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: `produit ${oldCip} introuvable` }) };
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
};
