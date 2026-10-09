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

  // Si pas admin : le CIP du JETON pharmacie prime (sécurisé). À défaut de jeton,
  // fallback legacy sur le pharmacy_cip de la requête (à retirer une fois toutes
  // les pharmacies migrées vers l'OTP).
  if (!isAdmin && user?.cip) {
    url += `&pharmacy_cip=eq.${encodeURIComponent(user.cip)}`;
  } else if (params.pharmacy_cip) {   // admin en saisie pour une pharmacie : ses commandes seulement
    url += `&pharmacy_cip=eq.${encodeURIComponent(params.pharmacy_cip)}`;
  }
  // Si admin sans filtre → toutes les commandes

  try {
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": "0-1999"
      }
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
    }

    const rows = await res.json();

    // SEC : le mode `source` (barre de progression campagne, appelé côté client)
    // ne doit PAS exposer les PII des autres pharmacies. Réponse réduite aux
    // seuls CIP/quantités agrégés tant qu'on n'est pas admin.
    if (!isAdmin && params.source) {
      const orders = rows.map(r => ({
        items: Array.isArray(r.items) ? r.items.map(i => ({ cip: i.cip, qty: i.qty })) : [],
        source: r.source || "catalogue",
      }));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ orders }) };
    }

    // Commandes « sur justificatif labo » : où en est la transmission au laboratoire (kv lj:req:s-<id>-<labo>)
    const justif = {};
    const jIds = rows.filter(r => r.source === "justificatif").map(r => r.id).filter(id => /^\d+$/.test(String(id)));
    for (let i = 0; i < jIds.length; i += 40) {
      try {
        const or = jIds.slice(i, i + 40).map(id => `key.like.lj:req:s-${id}-*`).join(",");
        const kr = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?or=(${encodeURIComponent(or)})&select=key,value`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
        for (const row of kr.ok ? await kr.json() : []) {
          let v = row.value; if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } }
          if (!v?.orderId) continue;
          (justif[v.orderId] ||= []).push({ lab: v.lab, statut: v.statut, envoyeLe: v.envoyeLe || null, ...(isAdmin ? { poNom: v.poNom || null, motif: v.motif || v.erreur || null } : {}) });
        }
      } catch { /* suivi indisponible : la commande s'affiche quand même */ }
    }

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
      enteredBy: r.entered_by || null,
      ...(justif[String(r.id)] ? { justif: justif[String(r.id)] } : {}),
    }));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ orders }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
