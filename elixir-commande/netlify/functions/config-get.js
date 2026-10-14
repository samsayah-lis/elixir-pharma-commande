// GET  /config-get?key=display_config     → { key, value, updated_at }
// POST /config-get  { key, value[, base] } → sauvegarde (admin only)
//   base = updated_at lu par l'admin (null : clé encore jamais enregistrée) : l'écriture n'aboutit que si
//   personne n'a modifié la clé entre-temps, sinon 409 { conflit: true, value, updated_at } (version en ligne).
//   Sans base (anciennes pages admin encore ouvertes) : écriture directe, comme avant.
import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const lire = async (key) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_config?key=eq.${encodeURIComponent(key)}&select=value,updated_at`, { headers: SB });
  if (!res.ok) throw new Error(`lecture ${key} : HTTP ${res.status}`);
  const rows = await res.json();
  return rows?.[0] ? { value: rows[0].value ?? null, updated_at: rows[0].updated_at ?? null, existe: true } : { value: null, updated_at: null, existe: false };
};
export const handler = async (event) => {
  const cors = getCors(event);
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  // GET — lecture publique
  if (event.httpMethod === "GET") {
    const key = event.queryStringParameters?.key;
    if (!key) return json(400, { error: "key manquant" });
    try { const r = await lire(key); return json(200, { key, value: r.value, updated_at: r.updated_at }); }
    catch (e) { return json(500, { error: e.message }); }
  }

  // POST — écriture admin (JWT requis)
  if (event.httpMethod === "POST") {
    const auth = await verifyAdmin(event);
    if (auth.error) return auth.error;

    let body;
    try { body = JSON.parse(event.body); }
    catch { return json(400, { error: "JSON invalide" }); }

    const { key, value } = body;
    if (!key) return json(400, { error: "key manquant" });
    // horodatage toujours différent de la version lue (contrôle de version sur updated_at)
    let maj = new Date();
    if (body.base && maj.toISOString() === new Date(body.base).toISOString()) maj = new Date(maj.getTime() + 1);
    const updated_at = maj.toISOString();
    const conflit = async () => { const r = await lire(key); return json(409, { error: "modifiée depuis un autre poste", conflit: true, value: r.value, updated_at: r.updated_at }); };

    if (Object.prototype.hasOwnProperty.call(body, "base")) {
      if (body.base) {
        // mise à jour seulement si la version en ligne est celle que l'admin a lue
        const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_config?key=eq.${encodeURIComponent(key)}&updated_at=eq.${encodeURIComponent(body.base)}`, {
          method: "PATCH", headers: { ...SB, "Prefer": "return=representation" }, body: JSON.stringify({ value, updated_at }),
        });
        if (!res.ok) return json(500, { error: await res.text() });
        const rows = await res.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length !== 1) return conflit();
        return json(200, { success: true, key, updated_at: rows[0].updated_at ?? updated_at });
      }
      // clé jamais enregistrée : création seulement (échoue si quelqu'un l'a créée entre-temps)
      const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_config`, {
        method: "POST", headers: { ...SB, "Prefer": "return=representation" }, body: JSON.stringify({ key, value, updated_at }),
      });
      if (res.status === 409) return conflit();
      if (!res.ok) return json(500, { error: await res.text() });
      const rows = await res.json().catch(() => []);
      return json(200, { success: true, key, updated_at: rows?.[0]?.updated_at ?? updated_at });
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/ec_config`, {
      method: "POST",
      headers: { ...SB, "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key, value, updated_at }),
    });

    if (!res.ok) return json(500, { error: await res.text() });
    const rows = await res.json().catch(() => []);
    return json(200, { success: true, key, updated_at: rows?.[0]?.updated_at ?? updated_at });
  }

  return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
};
