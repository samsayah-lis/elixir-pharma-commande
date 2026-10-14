import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { verifyTokenAsync } from "./auth.js";
import { envoiAuto } from "./_relais.js";
// Envoi automatique d'une commande du site vers PharmaML, appelé par la page juste après l'enregistrement.
// PharmaML refuse tout envoi venant de Netlify (403, adresse non autorisée) : la commande est mise dans la
// file du relais, que l'agent du Mac du bureau envoie (voir _relais.js). Cette fonction n'appelle JAMAIS
// PharmaML, même si InfoSoft autorisait un jour Netlify : un seul émetteur, l'agent.
// La commande est relue en base (jamais le contenu envoyé par la page) ; identité vérifiée par le jeton
// (pharmacie : CIP du jeton = CIP de la commande ; admin : saisie Elixir). Sans jeton valide, ou si une
// condition manque (lignes en précommande, client bloqué, double…), la commande reste à la synchro manuelle.
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

// Journal de chaque demande (kv_store pml:<orderId>:<ts>), lisible par le diagnostic de l'admin Sanofi Pro
async function journal(entry) {
  if (!SUPABASE_URL) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
      method: "POST", headers: { ...SB, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: `pml:${entry.orderId || "sans-id"}:${Date.now()}`, value: JSON.stringify({ ts: new Date().toISOString(), ...entry }), updated_at: new Date().toISOString() }),
    });
  } catch { /* le journal ne doit jamais faire échouer la demande */ }
}

export const handler = async (event) => {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: cors, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  const rl = rateLimit(event, 10, 60);
  if (rl) return { ...rl, headers: { ...rl.headers, ...cors } };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return json(400, { error: "JSON invalide" }); }
  const orderId = String(payload.orderId || "");
  const via = payload.via === "admin" ? "admin" : payload.via === "auto" ? "auto" : "inconnu";

  // ancienne page admin encore ouverte (synchro directe) : la synchro passe désormais par le relais
  if (via !== "auto") {
    await journal({ via, orderId, outcome: "ancienne_page" });
    return json(200, { success: false, error: "La synchro PharmaML passe désormais par le relais : actualisez la page admin (Cmd+R) puis relancez la synchro." });
  }
  if (!/^\d{6,20}$/.test(orderId)) return json(400, { error: "numéro de commande invalide" });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const tok = authHeader.replace(/^Bearer\s+/i, "");
  const user = tok ? await verifyTokenAsync(tok) : null;
  try {
    const r = await envoiAuto({ orderId, user });
    await journal({ via, orderId, pharmacy: payload.pharmacyName || null, outcome: r.ok ? "en_file" : `manuelle:${r.code}`, reference: r.ref || null, lignes: r.lignes ?? null, motif: r.ok ? null : r.error });
    return json(200, r.ok ? { success: true, queued: true, reference: r.ref, lignes: r.lignes, retenues: r.retenues || 0 } : { success: false, manuelle: true, code: r.code, error: r.error });
  } catch (e) {
    console.error("[submit-order]", e);
    await journal({ via, orderId, outcome: "exception", erreur: String(e.message).slice(0, 200) });
    return json(500, { success: false, error: "erreur : la commande reste à synchroniser à la main" });
  }
};
