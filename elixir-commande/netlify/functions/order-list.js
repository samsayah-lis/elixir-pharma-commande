// Liste les commandes depuis Supabase — FIX SEC-05 : filtrage par pharmacie
// GET /order-list                         → toutes (admin) ou filtrées (pharmacie)
// GET /order-list?source=ulabs            → filtre par source campagne
// GET /order-list?pharmacy_cip=XXX        → filtre par pharmacie
import { verifyTokenAsync } from "./auth.js";
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  // Vérifie le JWT Supabase si présent
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const user = token ? await verifyTokenAsync(token) : null;
  const isAdmin = user?.isAdmin === true;

  const params = event.queryStringParameters || {};

  // Sans admin JWT et sans filtre, bloquer l'accès
  if (!isAdmin && !params.pharmacy_cip && !user?.cip && !params.source) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  // Construction de l'URL Supabase avec filtres
  let url = `${SUPABASE_URL}/rest/v1/elixir_orders?select=*&order=date.desc`;

  // Si un filtre source est demandé (ex: campagne ulabs)
  if (params.source) {
    url += `&source=eq.${encodeURIComponent(params.source)}`;
  }

  // Si pas admin, filtre par pharmacy_cip
  if (!isAdmin && params.pharmacy_cip) {
    url += `&pharmacy_cip=eq.${encodeURIComponent(params.pharmacy_cip)}`;
  } else if (!isAdmin && user?.cip) {
    // Filtre automatique basé sur le JWT
    url += `&pharmacy_cip=eq.${encodeURIComponent(user.cip)}`;
  }
  // Si admin sans filtre → toutes les commandes

  try {
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": "0-499"
      }
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
    }

    const rows = await res.json();

    const orders = rows.map(r => ({
      id: r.id,
      date: r.date,
      pharmacyName: r.pharmacy_name,
      pharmacyEmail: r.pharmacy_email,
      pharmacyCip: r.pharmacy_cip,
      isClient: r.is_client,
      items: r.items,
      totalHt: r.total_ht,
      nbLignes: r.nb_lignes,
      csv: r.csv,
      processed: r.processed,
      source: r.source || "catalogue",
    }));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ orders }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
