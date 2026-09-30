// ── Synchronisation des pharmacies : Odoo → elixir_pharmacies ───────────
// Seules les pharmacies clientes d'Elixir (société 2, règle dans _pharmacies.js)
// peuvent se connecter au site. Chaque passage :
//  1. écrit une ligne par adresse e-mail des fiches clientes Elixir (vrai CIP, fiche commerciale) ;
//  2. conserve les anciennes adresses d'une pharmacie Elixir (e-mail changé dans Odoo depuis) ;
//  3. retire les comptes dont la fiche n'est pas (ou plus) cliente d'Elixir, après sauvegarde
//     dans kv_store (« pharmacies_retirees:AAAA-MM-JJ »). Les ajouts manuels (sans fiche Odoo) restent.
// ?dry=1 : simulation, rien n'est écrit.
import { verifyAdmin, isCronAuthorized } from "./auth.js";
import { getCors } from "./cors.js";
import { elixirPharmacyRows, elixirCustomerIds, pharmacyRow, PARTNER_FIELDS } from "./_pharmacies.js";
import { odoo } from "./_odoo-rpc.js";
import { kvGet, kvSet } from "./_kv.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
const validCipRow = (c) => !!c && !!String(c.cip || "").trim() && String(c.cip).trim() !== "0";
const MIN_ROWS = 200;          // garde-fou : Odoo qui renvoie une liste anormalement courte
const MAX_REMOVE_RATIO = 0.6;  // garde-fou : on ne retire jamais plus de 60 % de la table d'un coup

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...SB, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${opts.method || "GET"} ${path.split("?")[0]} : ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
// Lecture complète malgré le plafond de lignes de PostgREST
async function sbAll(path, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const rows = await sb(path, { headers: { Range: `${from}-${from + page - 1}` } });
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
// Valeurs entre guillemets, guillemets et barres obliques inverses échappés (syntaxe PostgREST)
const inList = (arr) => `(${arr.map(v => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (!isCronAuthorized(event)) {
    const auth = await verifyAdmin(event);
    if (auth.error) return auth.error;
  }
  const q = event.queryStringParameters || {};
  const dry = q.dry === "1";
  const t0 = Date.now();
  try {
    const { rows, buyers, partnersCount } = await elixirPharmacyRows();
    if (rows.length < MIN_ROWS) throw new Error(`Garde-fou : seulement ${rows.length} adresses de pharmacies Elixir lues dans Odoo — synchronisation annulée`);

    const current = await sbAll("elixir_pharmacies?select=*&order=email.asc");
    const fresh = new Set(rows.map(r => r.email));
    const others = current.filter(c => !fresh.has(c.email) && c.odoo_id);
    const status = await elixirCustomerIds([...new Set(others.map(c => c.odoo_id))], buyers);
    const legacy = others.filter(c => status.get(c.odoo_id));             // ancienne adresse d'une pharmacie Elixir
    const stale = others.filter(c => !status.get(c.odoo_id));             // fiche d'une autre société, archivée ou supprimée
    // Ancienne adresse d'une pharmacie Elixir : la ligne est réécrite depuis la fiche commerciale
    // (vrai CIP, nom, adresse), sinon elle garderait un CIP « 0 » et ses commandes n'iraient pas à PharmaML
    const comIds = [...new Set(legacy.map(c => status.get(c.odoo_id)))];
    const coms = new Map();
    for (let i = 0; i < comIds.length; i += 500)
      for (const p of await odoo("res.partner", "search_read", [[["id", "in", comIds.slice(i, i + 500)]]], { fields: PARTNER_FIELDS, context: { active_test: false } })) coms.set(p.id, p);
    const legacyRows = legacy.filter(c => coms.has(status.get(c.odoo_id))).map(c => pharmacyRow(coms.get(status.get(c.odoo_id)), null, c.email));
    const currentEmails = new Set(current.map(c => c.email));
    const summary = {
      elixir_partners: partnersCount, rows: rows.length,
      added: rows.filter(r => !currentEmails.has(r.email)).length,
      kept_old_emails: legacy.length, old_emails_fixed_cip: legacyRows.filter(r => r.cip && !validCipRow(legacy.find(c => c.email === r.email))).length, removed: stale.length, manual_kept: current.filter(c => !c.odoo_id).length,
    };
    if (stale.length > current.length * MAX_REMOVE_RATIO && q.force !== "1")
      throw new Error(`Garde-fou : ${stale.length} comptes sur ${current.length} seraient retirés — relancer avec ?force=1 après vérification`);
    if (dry) return { statusCode: 200, headers: cors, body: JSON.stringify({ dry: true, ...summary,
      removed_sample: stale.slice(0, 50).map(c => ({ name: c.name, email: c.email, odoo_id: c.odoo_id })), ms: Date.now() - t0 }) };

    const all = [...rows, ...legacyRows];
    for (let i = 0; i < all.length; i += 500)
      await sb("elixir_pharmacies?on_conflict=email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(all.slice(i, i + 500)) });
    if (stale.length) {
      const day = new Date().toISOString().slice(0, 10);
      const key = `pharmacies_retirees:${day}`;
      const prev = await kvGet(key);
      const saved = [...(prev?.rows || []), ...stale];
      await kvSet(key, { at: new Date().toISOString(), rows: saved });
      let deleted = 0;
      for (let i = 0; i < stale.length; i += 100)
        deleted += (await sb(`elixir_pharmacies?email=in.${encodeURIComponent(inList(stale.slice(i, i + 100).map(c => c.email)))}`, { method: "DELETE", headers: { Prefer: "return=representation" } }) || []).length;
      if (deleted !== stale.length) summary.removed_mismatch = `${stale.length - deleted} compte(s) sauvegardé(s) mais non supprimé(s)`;
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, count: rows.length, ...summary,
      message: `${rows.length} adresses de pharmacies Elixir synchronisées, ${stale.length} comptes hors Elixir retirés`, ms: Date.now() - t0 }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
