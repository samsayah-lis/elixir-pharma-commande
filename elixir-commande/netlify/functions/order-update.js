// Met à jour le statut processed d'une commande, ou la supprime
// Garde-fous du relais PharmaML (_relais.js), appliqués ici pour toutes les pages admin, même anciennes :
//   - rien n'est modifié ni supprimé pendant qu'un envoi de la commande est en cours (en file ou pris par l'agent) ;
//   - les marques d'envoi d'une ligne (synced_at, synced_ref) ne sont jamais effacées : une ligne envoyée
//     ne peut pas repartir (« Rouvrir » ne remet plus la commande à synchroniser).
import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
import { kvList } from "./_lab-justif.js";
import { lireTache, ACTIVES } from "./_relais.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

// envoi PharmaML en cours pour cette commande ? → référence, ou null. Une erreur de lecture remonte (refus 503 :
// jamais « pas d'envoi » par défaut) ; une réservation récente sans tâche = tâche en cours de création.
async function envoiEnCours(id) {
  const lignes = await kvList(`pmlr:ligne:${id}:`, 200);
  for (const l of lignes) {
    const ref = l.value?.ref;
    if (!ref) continue;
    const t = await lireTache(ref);
    if (t ? ACTIVES.has(t.etat) : Date.now() - Date.parse(l.value.at || 0) < 5 * 60e3) return ref;
  }
  return null;
}

export const handler = async (event) => {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: cors, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return json(400, { error: "JSON invalide" }); }

  const { id, action } = body;
  if (!id) return json(400, { error: "id manquant" });
  if (!/^\d{1,20}$/.test(String(id))) return json(400, { error: "id invalide" });

  let enCours;
  try { enCours = await envoiEnCours(id); }
  catch { return json(503, { error: "État des envois PharmaML illisible : réessayez dans un instant" }); }
  if (enCours) return json(409, { error: `Envoi PharmaML en cours pour cette commande (réf. ${enCours}) : réessayez dans une minute` });

  if (action === "delete") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB });
    if (!res.ok) return json(500, { error: await res.text() });
    return json(200, { success: true });
  }

  // Update fields (processed, pharmacy_cip, etc.)
  const patch = {};
  if (body.processed !== undefined) patch.processed = body.processed;
  if (body.pharmacy_cip) patch.pharmacy_cip = body.pharmacy_cip;
  // Envoi partiel : lignes marquées synced_at / synced_ref (même liste, mêmes produits)
  if (Array.isArray(body.items)) {
    // marques d'envoi déjà en base conservées (une page périmée ne peut pas « dé-envoyer » une ligne)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${encodeURIComponent(id)}&select=items`, { headers: SB });
    if (!r.ok) return json(500, { error: await r.text() });
    const [cur] = await r.json();
    let enBase = cur?.items; if (typeof enBase === "string") { try { enBase = JSON.parse(enBase); } catch { enBase = []; } }
    enBase = Array.isArray(enBase) ? enBase : [];
    patch.items = body.items.map((it, i) => {
      const b = enBase[i];
      if (b?.synced_at && String(b.cip || "") === String(it?.cip || "") && !(it?.synced_at && it?.synced_ref === b.synced_ref)) return { ...it, synced_at: b.synced_at, synced_ref: b.synced_ref };
      return it;
    });
    // commande « traitée » seulement si toutes ses lignes sont réglées (marques conservées comprises)
    if (patch.processed === false && patch.items.length && patch.items.every(it => it?.synced_at || it?.handled_at)) patch.processed = true;
  }
  if (Object.keys(patch).length === 0) patch.processed = true;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...SB, "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify(patch)
  });

  if (!res.ok) return json(500, { error: await res.text() });
  return json(200, { success: true, ...(patch.items ? { items: patch.items, processed: patch.processed } : {}) });
};
