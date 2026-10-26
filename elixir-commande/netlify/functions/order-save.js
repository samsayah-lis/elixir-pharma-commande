import { rateLimit } from "./rate-limit.js";
import { getCors } from "./cors.js";
import { verifierJeton, reponseIndisponible } from "./auth.js";
import { validCip } from "./_pharmacies.js";
import { lireConfig, indexProduits } from "./_lab-justif.js";
import { controleLimites, pharmacie } from "./_promo-limites.js";
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
// enteredByAdmin sans session admin → 403 (inchangé) ; Supabase Auth en panne → 503 { error: "indisponible" } (le site
// dit « réessayez dans un instant », sans demander de reconnexion ; rien n'est écrit).
// Même numéro déjà enregistré (le site renvoie la commande avec le même numéro quand la réponse s'est perdue) : succès
// { deja: true } sans rien réécrire, si c'est bien la même commande (même compte, même source, mêmes lignes) ;
// sinon 409 { error: "numero" } (le site reprend un autre numéro).
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
// Ligne « sur justificatif » : justificatif gardé, nettoyé (attestation, renouvellement, identifiants des ordonnances
// déposées) — Elixir retrouve l'ordonnance, que menageOrdonnances garde tant que la commande « a_verifier » est à traiter.
const justifNettoye = (j) => ({ attestation: !!j.attestation, renouvellement: !!j.renouvellement,
  rx: (Array.isArray(j.rx) ? j.rx : []).map(String).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5) });
async function quarantaine(order, json) {
  const source = texte(order.source || "catalogue", 40);
  const items = order.items.slice(0, 500).map(i => ({ cip: texte(i?.cip, 20) || null, name: texte(i?.name, 200),
    qty: Number.isFinite(Number(i?.qty)) ? Number(i.qty) : 0, pn: Number(i?.pn) || 0, total: Number(i?.total) || 0,
    ...(i?.justif && typeof i.justif === "object" ? { justif: justifNettoye(i.justif) } : {}) }));
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

// Commande déjà enregistrée sous row.id : la même (même compte, même source, mêmes lignes : CIP et quantités — le relais
// ajoute ses marques d'envoi aux lignes) → true ; une autre → false ; lecture impossible → null
async function memeCommande(row) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${row.id}&select=pharmacy_email,source,items&limit=1`, { headers: SB });
    const rows = r.ok ? await r.json() : null;
    if (!Array.isArray(rows)) return null;
    const [o] = rows;
    if (!o) return false;
    const lignes = (its) => JSON.stringify((typeof its === "string" ? JSON.parse(its) : its || []).map(i => [String(i?.cip ?? ""), Number(i?.qty) || 0]));
    const mail = (m) => String(m || "").trim().toLowerCase();
    return mail(o.pharmacy_email) === mail(row.pharmacy_email) && o.source === row.source && lignes(o.items) === lignes(row.items);
  } catch { return null; }
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
  let user = null;
  try { user = token ? await verifierJeton(token) : null; }
  catch { return reponseIndisponible(cors); }   // Supabase Auth en panne : rien d'écrit, le site propose de réessayer
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

  // Limites des menus promo et précommandes (26/10/2026, docs/limites-promo.md) : au-delà de ce que la pharmacie (ou l'ensemble
  // des pharmacies, max total) peut encore commander → 400, rien d'écrit, le site garde le panier ; le même numéro renvoyé après
  // une réponse perdue n'est pas compté contre lui-même (sauf) ; commandes illisibles → 503 (réessayer). Contrôlée de nouveau
  // juste après l'écriture (plus bas) quand elle contient un produit limité.
  const phLimites = pharmacie(row.pharmacy_cip, row.pharmacy_email);
  const refusLimites = (refus) => json(400, { success: false, error: refus.message, limites: refus.over });
  const limitesIllisibles = () => json(503, { success: false, error: "Vérification des quantités limitées impossible : réessayez dans un instant" });
  let avecLimite = false;
  try {
    const c = await controleLimites({ items: row.items, ph: phLimites, sauf: orderId });
    if (c.refus) return refusLimites(c.refus);
    avecLimite = c.limite;
  } catch (e) {
    console.error("[order-save] limites :", e.message);
    return limitesIllisibles();
  }

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
    let err = res.ok ? "" : await res.text();
    // colonne entered_by pas encore créée (sql/orders-entered-by.sql) : la commande passe quand même
    if (!res.ok && row.entered_by && /entered_by/.test(err)) {
      const { entered_by, ...rest } = row; res = await post(rest); err = res.ok ? "" : await res.text();
    }

    if (!res.ok) {
      // numéro déjà enregistré : nouvel essai du site après une réponse perdue → succès, sans doublon ni second
      // décompte du stock ; autre commande sous ce numéro → 409, le site en reprend un autre
      if (/23505|duplicate key/.test(err)) {
        const deja = await memeCommande(row);
        if (deja === null) return json(500, { success: false, error: "Enregistrement à vérifier : réessayez dans un instant" });
        return deja ? json(200, { success: true, id: orderId, deja: true })
          : json(409, { success: false, error: "numero", message: "Numéro de commande déjà pris : renvoyez la commande" });
      }
      console.error("[order-save] Supabase error:", err);
      return json(500, { success: false, error: err });
    }

    // Limites : nouveau contrôle, la commande écrite (sauf : elle-même), pour compter celles parties en même temps (autre
    // pharmacie, ou la même par des envois simultanés) : au-delà → commande retirée, 400 (illisible : retirée, 503). Retrait
    // impossible (3 essais) → la commande reste enregistrée : acceptée, suite normale (notification, stock, 200), journalisée.
    if (avecLimite) {
      let refus = null, illisible = false;
      try { refus = (await controleLimites({ items: row.items, ph: phLimites, sauf: orderId })).refus; }
      catch (e) { illisible = true; console.error("[order-save] limites après écriture :", e.message); }
      if (refus || illisible) {
        let retiree = false;
        for (let essai = 0; essai < 3 && !retiree; essai++) {
          if (essai) await new Promise(r => setTimeout(r, 300 * essai));
          retiree = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${orderId}`, { method: "DELETE", headers: SB }).then(r => r.ok, () => false);
        }
        if (retiree) return refus ? refusLimites(refus) : limitesIllisibles();
        console.error(`[order-save] limites : commande ${orderId} ${refus ? "au-delà" : "non vérifiée"}, retrait impossible : gardée`);
      }
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
