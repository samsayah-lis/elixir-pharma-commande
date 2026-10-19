import { rateLimit } from "./rate-limit.js";
import { getCors } from "./cors.js";
import { verifyTokenAsync } from "./auth.js";
import { validCip } from "./_pharmacies.js";
import { lireConfig, indexProduits } from "./_lab-justif.js";
// Sauvegarde une commande dans Supabase + décrémentation stock (non-bloquante)
// Correctif de sécurité du 19/10/2026 : jeton obligatoire (avant, n'importe qui pouvait enregistrer une commande au nom
// de n'importe quelle pharmacie : « Mes commandes », stock, contingentement).
//  • pharmacie : commande enregistrée au nom du compte de l'e-mail VÉRIFIÉ du jeton — e-mail du jeton, CIP et nom de
//    elixir_pharmacies ; pharmacyEmail / pharmacyCip venus du navigateur ignorés (pharmacyName seulement si la fiche
//    n'a pas de nom) ; date du serveur ;
//    source : catalogue, justificatif ou ulabs (toute autre → catalogue) ; lignes « justificatif » contrôlées comme la
//    page dédiée de lab-justif (produit sur justificatif, quantité entière, maxCommande du produit) : elles retirent leur
//    quantité de la disponibilité affichée à TOUTES les pharmacies ;
//  • admin : identité envoyée par l'écran ; entered_by posé pour une saisie Elixir (enteredByAdmin) seulement — une
//    adresse admin qui commande comme pharmacie reste à la synchro manuelle, comme avant.
// POST { verifier: true } : contrôle de la session juste avant un envoi, RIEN n'est écrit → { success, admin }.
// Sans jeton valide → 401 { error: "reconnexion" } ; compte sans pharmacie → 403 { error: "fiche" } ;
// enteredByAdmin sans session admin → 403 (inchangé).
// Transition : pages ouvertes avant la mise en ligne (sans jeton ni en-tête X-Elixir-Session) → QUARANTAINE (plus bas).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const NOTIFY_WEBHOOK = process.env.NOTIFY_WEBHOOK_URL || ""; // URL webhook pour notifications (Signal, Slack, Zapier...)
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const SOURCES_PHARMACIE = new Set(["catalogue", "justificatif", "ulabs"]);
const MAX_JUSTIF_SANS_REGLE = 999;   // produit sur justificatif sans maxCommande : quantité par commande au plus

// ── Quarantaine des pages ouvertes avant la mise en ligne du correctif ──
// L'ancien site envoie l'e-mail à Elixir PUIS enregistre la commande sans jeton, et vide le panier quoi qu'il arrive :
// un refus (401) la ferait disparaître de l'admin et du relais PharmaML. Jusqu'à FIN_TRANSITION, une commande sans jeton
// venue d'une page SANS l'en-tête X-Elixir-Session (le site à jour l'envoie toujours, par appelAuthentifie) est donc
// enregistrée « a_verifier » : sans CIP ni e-mail (absente de « Mes commandes » de toute pharmacie, non comptée par le
// contingentement, jamais envoyée à PharmaML : envoiAuto n'accepte que « catalogue », la synchro manuelle demande un
// CIP), identité ANNONCÉE dans le nom seulement, lignes bornées ; ni stock, ni notification. Données NON vérifiées :
// Elixir confirme par téléphone avec la pharmacie avant de la saisir. Après FIN_TRANSITION : 401 comme les autres.
const FIN_TRANSITION = Date.parse("2026-11-02T00:00:00+01:00");   // ~ 2 semaines : à repousser si la mise en ligne tarde
const texte = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const idCommande = (id) => {
  let n = id;
  if (typeof n === "string") { const x = parseInt(n.replace(/\D/g, "")); n = x > 0 ? x : Date.now(); }
  return Number.isSafeInteger(n) && n > 0 ? n : Date.now();
};
async function quarantaine(order, json) {
  const source = texte(order.source || "catalogue", 40);
  const items = order.items.slice(0, 500).map(i => ({ cip: texte(i?.cip, 20) || null, name: texte(i?.name, 200),
    qty: Number.isFinite(Number(i?.qty)) ? Number(i.qty) : 0, pn: Number(i?.pn) || 0, total: Number(i?.total) || 0 }));
  const row = {
    id: idCommande(order.id), date: new Date().toISOString(),
    pharmacy_name: texte(`⚠ NON VÉRIFIÉE${source !== "catalogue" ? ` (${source})` : ""} — ${texte(order.pharmacyName, 120) || "?"} · ${texte(order.pharmacyEmail, 120) || "?"} · CIP ${texte(order.pharmacyCip, 20) || "?"}`, 300),
    pharmacy_email: null, pharmacy_cip: null, is_client: order.isClient !== false,
    items, total_ht: Number(order.totalHt) || 0, nb_lignes: items.length, csv: String(order.csv || "").slice(0, 50000) || null,
    processed: false, source: "a_verifier",
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders`, { method: "POST",
      headers: { ...SB, "Content-Type": "application/json", "Prefer": "return=minimal" }, body: JSON.stringify(row) });
    if (!res.ok) { console.error("[order-save] quarantaine :", await res.text()); return json(500, { success: false, error: "Enregistrement impossible : réessayez dans un instant" }); }
  } catch (e) { return json(500, { success: false, error: e.message }); }
  return json(200, { success: true, id: row.id, aVerifier: true });
}

// Lignes « justificatif » d'une pharmacie : mêmes règles que l'action « commander » de lab-justif → null ou { code, message }
async function controleJustificatif(items) {
  let idx;
  try { idx = indexProduits(await lireConfig()); }
  catch { return { code: 500, message: "lecture des produits sur justificatif impossible : réessayez dans un instant" }; }
  const total = {};
  for (const l of items) {
    const cip = String(l?.cip || ""), hit = idx[cip], q = Number(l?.qty);
    if (!hit || hit.lab.site === false) return { code: 400, message: `produit non commandable sur justificatif : ${cip || "?"}` };
    if (!Number.isInteger(q) || q < 1) return { code: 400, message: `${hit.produit.nom} : quantité invalide` };
    total[cip] = (total[cip] || 0) + q;
  }
  for (const [cip, q] of Object.entries(total)) {
    const p = idx[cip].produit, max = Number(p.maxCommande) || MAX_JUSTIF_SANS_REGLE;
    if (q > max) return { code: 400, message: `${p.nom} : ${max} au plus par commande` };
  }
  return null;
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  const rl = rateLimit(event); if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let order;
  try { order = JSON.parse(event.body); }
  catch { return json(400, { error: "JSON invalide" }); }
  if (!order || typeof order !== "object" || Array.isArray(order)) return json(400, { error: "JSON invalide" });

  // ── Identité : jeton vérifié côté serveur ──
  const token = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  const user = token ? await verifyTokenAsync(token) : null;
  if (!user) {
    const h = event.headers || {};
    const siteAJour = !!(h["x-elixir-session"] || h["X-Elixir-Session"]);
    const avecLignes = Array.isArray(order.items) && order.items.length > 0 && order.verifier !== true;
    const enQuarantaine = !token && !siteAJour && avecLignes && Date.now() < FIN_TRANSITION;
    // trace dans les journaux Netlify (données NON vérifiées : n'importe qui peut appeler cette fonction sans jeton)
    if (avecLignes) console.warn(`[order-save] commande sans jeton valide, ${enQuarantaine ? "mise en quarantaine" : "refusée"} (données NON vérifiées) :`, JSON.stringify({
      email: texte(order.pharmacyEmail, 120), cip: texte(order.pharmacyCip, 20), lignes: order.items.length, source: texte(order.source, 40) }));
    if (enQuarantaine) return quarantaine(order, json);
    return json(401, { success: false, error: "reconnexion", message: "Session expirée : reconnectez-vous avec le code reçu par e-mail pour envoyer votre commande." });
  }
  const isAdmin = user.isAdmin === true;
  // Saisie par Elixir pour une pharmacie (admin connecté) : session admin exigée
  if (order.enteredByAdmin && !isAdmin) return json(403, { success: false, error: "Session admin expirée : reconnectez-vous à l'admin pour commander à la place d'une pharmacie" });
  // Pharmacie : son compte (e-mail vérifié du jeton) ; aucun compte → aucune commande
  let compte = null;
  if (!isAdmin) {
    const mail = String(user.email || "").trim().toLowerCase();
    try {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(mail)}&select=cip,name&limit=1`, { headers: SB });
      const rows = pr.ok ? await pr.json() : null;
      if (!Array.isArray(rows)) return json(500, { success: false, error: "Lecture du compte impossible : réessayez dans un instant" });
      compte = rows[0] ? { ...rows[0], email: mail } : null;
    } catch (e) { return json(500, { success: false, error: e.message }); }
    if (!compte || !mail) return json(403, { success: false, error: "fiche", message: "Aucune pharmacie n'est rattachée à ce compte : contactez Elixir Pharma." });
  }
  // Contrôle avant envoi (le site l'appelle avant l'e-mail et l'enregistrement) : rien n'est écrit
  if (order.verifier === true) return json(200, { success: true, admin: isAdmin });

  if (!Array.isArray(order.items) || !order.items.length) return json(400, { success: false, error: "commande sans ligne" });
  const source = isAdmin ? String(order.source || "catalogue").slice(0, 40) : (SOURCES_PHARMACIE.has(order.source) ? order.source : "catalogue");
  if (!isAdmin && source === "justificatif") {
    const refus = await controleJustificatif(order.items);
    if (refus) return json(refus.code, { success: false, error: refus.message });
  }

  // Normaliser l'ID en nombre (la colonne est bigint)
  const orderId = idCommande(order.id);

  const row = {
    id: orderId,
    date: isAdmin ? (order.date || new Date().toISOString()) : new Date().toISOString(),
    pharmacy_name: isAdmin ? order.pharmacyName : (compte.name || String(order.pharmacyName || "").slice(0, 200) || null),
    pharmacy_email: isAdmin ? order.pharmacyEmail : compte.email,
    pharmacy_cip: isAdmin ? (order.pharmacyCip || null) : (validCip(compte.cip) ? String(compte.cip).trim() : null),
    is_client: order.isClient ?? true,
    items: order.items,
    total_ht: order.totalHt,
    nb_lignes: order.nbLignes,
    csv: order.csv || null,
    processed: false,
    source,
  };
  // Saisie par Elixir pour une pharmacie : on garde qui l'a saisie (seulement elle : envoiAuto la relaie avec le jeton admin)
  if (isAdmin && order.enteredByAdmin) row.entered_by = user.email || "admin";

  try {
    const post = (r) => fetch(`${SUPABASE_URL}/rest/v1/elixir_orders`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", "Prefer": "return=minimal"
      },
      body: JSON.stringify(r)
    });
    let res = await post(row);
    // colonne entered_by pas encore créée (sql/orders-entered-by.sql) : la commande passe quand même
    if (!res.ok && row.entered_by) {
      const t = await res.clone().text();
      if (/entered_by/.test(t)) { const { entered_by, ...rest } = row; res = await post(rest); }
    }

    if (!res.ok) {
      const err = await res.text();
      console.error("[order-save] Supabase error:", err);
      return json(500, { success: false, error: err });
    }


    // ── Notification webhook (fire-and-forget) ────────────────────────
    if (NOTIFY_WEBHOOK) {
      fetch(NOTIFY_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "new_order",
          id: orderId,
          pharmacy: row.pharmacy_name,
          email: row.pharmacy_email,
          total: order.totalHt,
          lignes: order.nbLignes || (Array.isArray(order.items) ? order.items.length : 0),
          source: row.source,
          text: `🛒 Nouvelle commande : ${row.pharmacy_name} — ${parseFloat(order.totalHt || 0).toFixed(2)} € HT (${order.nbLignes || "?"} lignes)`,
        }),
      }).catch(e => console.warn("[notify]", e.message));
    }

    // ── Notification in-app (stockée en Supabase) ─────────────────────
    fetch(`${SUPABASE_URL}/rest/v1/ec_notifications`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({
        type: "new_order",
        title: `Commande de ${row.pharmacy_name}`,
        body: `${parseFloat(order.totalHt || 0).toFixed(2)} € HT · ${order.nbLignes || "?"} ligne(s)`,
        data: { order_id: orderId, pharmacy: row.pharmacy_name, total: order.totalHt },
        read: false,
      }),
    }).catch(() => {});

    // ── Décrémentation stock — fire-and-forget (non-bloquant) ──────────
    // On ne bloque PAS la réponse pour le client
    try {
      const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
      if (Array.isArray(items)) {
        // Décrémente atomiquement via RPC Supabase (pas de race condition)
        const batch = items.filter(i => (i.cip || i.CIP || i.CIP13) && parseInt(i.qty || i.quantite || 0) > 0);
        for (let i = 0; i < batch.length; i += 5) {
          await Promise.all(batch.slice(i, i + 5).map(async (item) => {
            const cip = item.cip || item.CIP || item.CIP13;
            const qty = parseInt(item.qty || item.quantite || 0);
            try {
              await fetch(`${SUPABASE_URL}/rest/v1/rpc/decrement_stock`, {
                method: "POST",
                headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ p_cip: cip, p_qty: qty }),
              });
            } catch (e) { /* ignore per-item errors */ }
          }));
        }
      }
    } catch (e) { console.warn("[order-save] Stock decrement error:", e.message); }

    return json(200, { success: true, id: orderId });
  } catch (e) {
    console.error("[order-save] Exception:", e.message);
    return json(500, { success: false, error: e.message });
  }
};
