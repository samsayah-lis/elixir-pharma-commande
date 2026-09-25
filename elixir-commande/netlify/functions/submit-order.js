import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { verifyTokenAsync } from "./auth.js";
// Soumet une commande au frontal PharmaML via l'API INFOSOFT
const PHARMAML_URL  = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "";
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

// ── Phase 1 (observation) : journal de chaque tentative d'envoi vers PharmaML ──
// Entrées dans kv_store sous la clé pml:<orderId>:<ts> — lisibles avec
// scripts/pharmaml-journal (voir mémoire). Jamais bloquant.
async function journal(entry) {
  if (!SUPABASE_URL) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
      method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: `pml:${entry.orderId || "sans-id"}:${Date.now()}`, value: JSON.stringify({ ts: new Date().toISOString(), ...entry }), updated_at: new Date().toISOString() }),
    });
  } catch { /* le journal ne doit jamais faire échouer l'envoi */ }
}
// Une commande transmise avec succès est marquée « traitée » → l'admin ne la
// propose plus à la synchro manuelle (évite les doubles envois).
async function markProcessed(orderId) {
  if (!SUPABASE_URL || !/^\d+$/.test(String(orderId))) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${orderId}`, {
      method: "PATCH", headers: { ...SB, Prefer: "return=minimal" }, body: JSON.stringify({ processed: true }),
    });
  } catch { /* non bloquant */ }
}
async function alreadyProcessed(orderId) {
  if (!SUPABASE_URL || !/^\d+$/.test(String(orderId))) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${orderId}&select=processed`, { headers: SB });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0]?.processed === true;
  } catch { return false; }
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  // Transmission fournisseur : plafonner les envois par IP pour limiter l'abus.
  // (mitigation — une auth pharmacie reste à mettre en place pour fermer l'IDOR)
  const rl = rateLimit(event, 10, 60);
  if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  let { items, pharmacyName, pharmacyEmail, pharmacyCip, orderId } = payload;
  const via = payload.via === "admin" ? "admin" : payload.via === "auto" ? "auto" : "inconnu";
  const t0 = Date.now();
  if (!items?.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "items manquants" }) };

  // Sécurité : si un jeton pharmacie valide est présent, le CIP vient du jeton
  // (email vérifié) et non du corps de la requête → pas d'usurpation possible.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const tok = authHeader.replace(/^Bearer\s+/i, "");
  const authUser = tok ? await verifyTokenAsync(tok) : null;
  if (authUser?.cip) pharmacyCip = authUser.cip;

  // Si pas de CIP, essayer de le retrouver dans Supabase par email
  if ((!pharmacyCip || pharmacyCip === "0" || pharmacyCip === 0) && pharmacyEmail && SUPABASE_URL) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/elixir_pharmacies?email=eq.${encodeURIComponent(pharmacyEmail.trim().toLowerCase())}&select=cip&limit=1`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await res.json();
      if (rows?.[0]?.cip) pharmacyCip = rows[0].cip;
    } catch (e) { console.warn("[submit-order] Lookup CIP error:", e.message); }
  }

  if (!pharmacyCip || pharmacyCip === "0" || pharmacyCip === 0) {
    await journal({ via, orderId, pharmacy: pharmacyName, cip: null, lignes: items.length, outcome: "cip_introuvable" });
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `CIP introuvable pour ${pharmacyEmail || "email inconnu"}` }) };
  }

  // Garde-fou (envoi automatique uniquement) : une commande déjà transmise n'est pas renvoyée.
  if (via === "auto" && await alreadyProcessed(orderId)) {
    await journal({ via, orderId, pharmacy: pharmacyName, cip: String(pharmacyCip), lignes: items.length, outcome: "deja_transmise" });
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, already_sent: true }) };
  }

  const body = [{
    identifiantPML: String(pharmacyCip),
    referenceCommande: String(orderId || Date.now()),
    lignes: items.map(i => ({
      CIP: i.cip || "",
      libelle: (i.name || "").substring(0, 50),
      quantiteCommandee: parseInt(i.qty) || 0,
      quantiteLivree: parseInt(i.qty) || 0,
      prix: i.pn != null ? Math.round(parseFloat(i.pn) * 100) / 100 : 0
    }))
  }];

  try {
    const url = `${PHARMAML_URL}/commandes.php?U=${encodeURIComponent(PHARMAML_USER)}&P=${encodeURIComponent(PHARMAML_PASS)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!res.ok || result?.status === "error") {
      const msg = result?.message || result?.errors?.[0]?.message || `HTTP ${res.status}`;
      await journal({ via, orderId, pharmacy: pharmacyName, cip: String(pharmacyCip), lignes: items.length, outcome: "refusee",
                      http: res.status, ms: Date.now() - t0, pharmaml: String(msg).slice(0, 200), brut: text.replace(/\s+/g, " ").slice(0, 200) });
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: msg, detail: result }) };
    }

    await journal({ via, orderId, pharmacy: pharmacyName, cip: String(pharmacyCip), lignes: items.length, outcome: "transmise",
                    http: res.status, ms: Date.now() - t0, commandes: result?.commandes ?? null });
    await markProcessed(orderId);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, commandes: result?.commandes || 1, pharmaml: result }) };
  } catch (err) {
    console.error("[submit-order] ERREUR:", err.message);
    await journal({ via, orderId, pharmacy: pharmacyName, cip: String(pharmacyCip), lignes: items.length, outcome: "exception", ms: Date.now() - t0, erreur: String(err.message).slice(0, 200) });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
