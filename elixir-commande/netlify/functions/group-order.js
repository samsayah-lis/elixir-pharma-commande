import { getCors } from "./cors.js";
import { verifierJeton, reponseIndisponible } from "./auth.js";
import { validCip } from "./_pharmacies.js";
import crypto from "node:crypto";
// Commandes groupées U-Labs
// Correctif de sécurité du 19/10/2026 : jeton obligatoire (avant, n'importe qui lisait le CIP et le nom de toutes les
// pharmacies participantes, et modifiait ou vidait le panier groupé de n'importe laquelle).
// GET  /group-order?fournisseur=ulabs              → admin : toutes les lignes ; pharmacie : ses lignes, et celles des
//                                                    autres pharmacies sans leur identité (CIP remplacé par un repère
//                                                    anonyme stable, ni nom ni date) : totaux et nombre de participantes
// POST /group-order  { cip, qty }                 → pharmacie : sa ligne (CIP du jeton, nom de sa fiche) ;
//                                                    admin (saisie pour une pharmacie) : + pharmacy_cip, pharmacy_name
// DELETE /group-order?fournisseur=ulabs            → pharmacie : vide son panier ; admin : + &pharmacy_cip=XXX
// Sans jeton valide → 401 { error: "reconnexion" } ; compte sans CIP → 403 { error: "fiche" } ;
// Supabase Auth en panne → 503 { error: "indisponible" } (rien lu ni écrit, pas de reconnexion demandée).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const H = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};
// Repère anonyme d'une autre pharmacie : signé avec un secret du serveur (ne permet pas de retrouver le CIP)
const SECRET = process.env.GP_KEY_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_KEY || "gp";
const anonyme = (fournisseur, cip) => `anonyme-${crypto.createHmac("sha256", SECRET).update(`group-order:${fournisseur}:${cip}`).digest("hex").slice(0, 12)}`;

// Appelant → { admin: true } | { admin: false, cip, email } | { erreur: réponse 401/403/503 }
async function appelant(event, json, cors) {
  const token = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  let user = null;
  try { user = token ? await verifierJeton(token) : null; }
  catch { return { erreur: reponseIndisponible(cors) }; }
  if (!user) return { erreur: json(401, { error: "reconnexion", message: "Session expirée : reconnectez-vous avec le code reçu par e-mail." }) };
  if (user.isAdmin === true) return { admin: true };
  if (!validCip(user.cip)) return { erreur: json(403, { error: "fiche", message: "Aucune pharmacie n'est rattachée à ce compte." }) };
  return { admin: false, cip: String(user.cip).trim(), email: String(user.email || "").toLowerCase() };
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });

  const params = event.queryStringParameters || {};
  const fournisseur = String(params.fournisseur || "ulabs");
  if (!/^[\w-]{1,40}$/.test(fournisseur)) return json(400, { error: "fournisseur invalide" });
  if (!["GET", "POST", "DELETE"].includes(event.httpMethod)) return { statusCode: 405, headers: cors, body: "Method not allowed" };

  const qui = await appelant(event, json, cors);
  if (qui.erreur) return qui.erreur;

  // ── GET : lignes du groupement (identité des autres pharmacies masquée) ──
  if (event.httpMethod === "GET") {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_group_orders?fournisseur=eq.${encodeURIComponent(fournisseur)}&select=*`,
      { headers: H }
    );
    const rows = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(rows)) return json(500, { error: "lecture du groupement impossible" });
    if (qui.admin) return json(200, rows);
    return json(200, rows.map(r => String(r.pharmacy_cip) === qui.cip ? r
      : { fournisseur: r.fournisseur, cip: r.cip, qty: r.qty, pharmacy_cip: anonyme(fournisseur, r.pharmacy_cip) }));
  }

  // ── POST : upsert une ligne (pharmacy_cip + cip + fournisseur = clé unique) ──
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}") || {}; }
    catch { return json(400, { error: "JSON invalide" }); }
    const fr = fournisseur;   // comme avant : celui de l'adresse (?fournisseur=, « ulabs » par défaut), pas celui du corps
    const cip = String(body.cip || "").trim();
    const pharmacyCip = qui.admin ? String(body.pharmacy_cip || "").trim() : qui.cip;
    if (!cip || !pharmacyCip) return json(400, { error: qui.admin ? "cip et pharmacy_cip requis" : "cip requis" });
    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty < 0 || qty > 100000) return json(400, { error: "quantité invalide" });
    // nom : celui de la fiche de la pharmacie connectée (celui envoyé par l'écran seulement s'il manque)
    let pharmacyName = body.pharmacy_name || null;
    if (!qui.admin) {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(qui.email)}&select=name&limit=1`, { headers: H }).catch(() => null);
      const [p] = pr?.ok ? await pr.json().catch(() => []) : [];
      pharmacyName = p?.name || (pharmacyName ? String(pharmacyName).slice(0, 200) : null);
    }

    const res = qty === 0
      // Supprimer la ligne
      ? await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_group_orders?fournisseur=eq.${encodeURIComponent(fr)}&cip=eq.${encodeURIComponent(cip)}&pharmacy_cip=eq.${encodeURIComponent(pharmacyCip)}`,
        { method: "DELETE", headers: H }
      )
      : await fetch(`${SUPABASE_URL}/rest/v1/elixir_group_orders`, {
        method: "POST",
        headers: { ...H, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ fournisseur: fr, cip, pharmacy_cip: pharmacyCip, pharmacy_name: pharmacyName, qty, updated_at: new Date().toISOString() })
      });
    if (!res.ok) return json(500, { error: await res.text() });
    return json(200, { success: true });
  }

  // ── DELETE : vider tout le panier d'une pharmacie ──
  const pharmacyCip = qui.admin ? String(params.pharmacy_cip || "").trim() : qui.cip;
  if (!pharmacyCip) return json(400, { error: "pharmacy_cip requis" });
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/elixir_group_orders?fournisseur=eq.${encodeURIComponent(fournisseur)}&pharmacy_cip=eq.${encodeURIComponent(pharmacyCip)}`,
    { method: "DELETE", headers: H }
  );
  if (!res.ok) return json(500, { error: await res.text() });
  return json(200, { success: true });
};
