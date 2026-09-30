// ── kv_store : petite table clé → valeur partagée par les fonctions ─────
// La colonne `value` est de type TEXTE en production (les synchros y rangent du
// JSON sérialisé). On y écrit donc toujours du JSON texte et on le relit en objet ;
// les filtres PostgREST sur le contenu (value->>champ) n'y fonctionnent pas :
// les recherches se font sur la clé (préfixes, plages) et sur updated_at.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const enc = encodeURIComponent;

async function sb(path, { method = "GET", body, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} kv_store : ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const kvParse = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return v; } };
export async function kvGet(key) {
  const [row] = (await sb(`kv_store?key=eq.${enc(key)}&select=value&limit=1`)) || [];
  return row ? kvParse(row.value) : null;
}
export const kvSet = (key, value) => sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key, value: JSON.stringify(value) } });
export const kvDel = (key) => sb(`kv_store?key=eq.${enc(key)}`, { method: "DELETE" });
export const kvExists = async (key) => ((await sb(`kv_store?key=eq.${enc(key)}&select=key&limit=1`)) || []).length > 0;
// Clés comprises strictement entre `from` et `to` (ordre du texte), avec leur date d'insertion
export const kvRange = async (from, to, limit = 500) => (await sb(`kv_store?key=gt.${enc(from)}&key=lt.${enc(to)}&select=key,updated_at&order=key.asc&limit=${limit}`)) || [];
export const kvDeleteOlder = (likePrefix, beforeIso) => sb(`kv_store?key=like.${enc(likePrefix)}*&updated_at=lt.${enc(beforeIso)}`, { method: "DELETE" });
