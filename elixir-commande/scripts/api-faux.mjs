// ── API des pharmacies : faux PostgREST en mémoire des tables api_* (sql/api-schema.sql) ──
// Sert à scripts/test-api-fondations.mjs et au banc d'essai (scripts/banc/api-banc.mjs). Aucun appel réseau.
// Sous-ensemble de PostgREST utilisé par netlify/functions/_api-stock.js : select, eq, gte, lt, is, or=(…), order, limit ;
// POST (return=representation), PATCH conditionnel, DELETE ; unicité (api_acces.odoo_id, api_cles.empreinte → 409 23505) ;
// fonctions rpc/api_compter et rpc/api_lire_compteur (fenêtres fixes, comme le SQL) ; clé serveur exigée (sinon 401,
// compté dans etat.refusees) ; etat.panne = true : fetch lève (Supabase injoignable).
// horloge() → millisecondes (horloge des tests) ; tables, appels (journal des requêtes) et etat sont exposés.
import crypto from "node:crypto";

export function fauxPostgrestApi({ horloge = () => Date.now(), cleService = "cle-service-test" } = {}) {
  const T0 = () => horloge();
  const iso = () => new Date(T0()).toISOString();
  const tables = { api_reglages: [{ id: 1, valeur: "{}", updated_at: iso() }], api_acces: [], api_cles: [], api_commandes: [], api_journal: [], api_evenements: [], api_compteurs: [] };
  let seq = 0;
  const appels = [];
  const DEFAUTS = {
    api_acces: () => ({ nom: null, cip: null, ville: null, actif: true, portees: ["lecture", "commande"], mode: "auto", delai_annulation_min: 10, plafond_lignes: 100,
      plafond_boites: 1000, plafond_montant_ht: "3000.00", plafond_commandes_jour: 10, anomalie_active: true, anomalie_facteur: "10.00", anomalie_doublon_min: 30,
      ip_autorisees: null, liste_prix_id: null, liste_prix_lue_le: null, test_valide_le: null, test_valide_par: null, cgu_version: null, cgu_acceptees_le: null,
      cgu_acceptees_par: null, cgu_preuve: null, ouvert_le: iso(), suspendu_le: null, suspendu_par: null, motif_suspension: null, note: null, created_at: iso(), updated_at: iso() }),
    api_cles: () => ({ id: crypto.randomUUID(), created_at: iso(), expire_le: null, revoquee_le: null, revoquee_par: null, motif_revocation: null, remplace: null,
      derniere_utilisation: null, dernier_reseau: null }),
    api_journal: () => ({ id: ++seq, at: iso() }),
    api_evenements: () => ({ id: ++seq, at: iso() }),
  };
  const UNIQUES = { api_acces: [r => String(r.odoo_id)], api_cles: [r => r.empreinte] };
  const cmp = (a, b) => {
    if (a === null || a === undefined) return NaN;
    if (typeof a === "number") return a - Number(b);
    if (typeof a === "boolean") return String(a) === b ? 0 : 1;
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(a)) && !Number.isNaN(Date.parse(b))) return Date.parse(a) - Date.parse(b);
    return String(a) < b ? -1 : String(a) > b ? 1 : 0;
  };
  const condition = (r, k, v) => {
    const i = v.indexOf("."); const op = v.slice(0, i), val = v.slice(i + 1);
    if (op === "eq") return cmp(r[k], val) === 0;
    if (op === "gte") return cmp(r[k], val) >= 0;
    if (op === "lt") return cmp(r[k], val) < 0;
    if (op === "is") return val === "null" ? r[k] === null || r[k] === undefined : String(r[k]) === val;
    throw new Error(`filtre non pris en charge : ${k}=${v}`);
  };
  const SPECIAUX = new Set(["select", "order", "limit", "offset"]);
  const correspond = (r, params) => [...params].every(([k, v]) => {
    if (SPECIAUX.has(k)) return true;
    if (k === "or") return v.replace(/^\(|\)$/g, "").split(",").some(c => { const i = c.indexOf("."); return condition(r, c.slice(0, i), c.slice(i + 1)); });
    return condition(r, k, v);
  });
  const projeter = (r, select) => select ? Object.fromEntries(select.split(",").map(c => [c, r[c] ?? null])) : { ...r };
  const doublon = (table, r) => (UNIQUES[table] || []).some(f => tables[table].some(x => x !== r && f(x) === f(r)));
  const reponse = (corps, status = 200) => new Response(corps === null ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
  const etat = { panne: false, refusees: 0 };
  async function fetch(url, opts = {}) {
    if (etat.panne) throw new TypeError("fetch failed");
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const methode = opts.method || "GET";
    const prefer = String(opts.headers?.Prefer || "");
    appels.push({ table, methode, url: u.pathname + u.search });
    if (opts.headers?.apikey !== cleService || opts.headers?.Authorization !== `Bearer ${cleService}`) { etat.refusees++; return reponse({ message: "clé refusée" }, 401); }
    if (table.startsWith("rpc/")) {
      const { p_cle, p_fenetre_s } = JSON.parse(opts.body);
      const fenetre = new Date(Math.floor(T0() / 1000 / p_fenetre_s) * p_fenetre_s * 1000).toISOString();
      let c = tables.api_compteurs.find(x => x.cle === p_cle && x.fenetre === fenetre);
      if (table === "rpc/api_compter") { if (!c) tables.api_compteurs.push(c = { cle: p_cle, fenetre, n: 0 }); c.n++; return reponse(c.n); }
      if (table === "rpc/api_lire_compteur") return reponse(c?.n || 0);
      return reponse({ code: "PGRST202" }, 404);
    }
    if (!tables[table]) return reponse({ code: "42P01", message: "table inconnue" }, 404);
    const p = u.searchParams, select = p.get("select");
    const rep = prefer.includes("return=representation");
    if (methode === "GET") {
      let rows = tables[table].filter(r => correspond(r, p));
      const o = p.get("order");
      if (o) { const [c, sens] = o.split("."); rows = [...rows].sort((a, b) => (cmp(a[c], String(b[c])) || 0) * (sens === "desc" ? -1 : 1)); }
      if (p.get("limit")) rows = rows.slice(0, Number(p.get("limit")));
      return reponse(rows.map(r => projeter(r, select)));
    }
    if (methode === "POST") {
      const r = { ...(DEFAUTS[table]?.() || {}), ...JSON.parse(opts.body) };
      if (doublon(table, r) || tables[table].some(x => (UNIQUES[table] || []).some(f => f(x) === f(r)))) return reponse({ code: "23505", message: "duplicate key" }, 409);
      tables[table].push(r);
      return rep ? reponse([projeter(r, select)], 201) : reponse(null, 201);
    }
    if (methode === "PATCH") {
      const champs = JSON.parse(opts.body);
      const cibles = tables[table].filter(r => correspond(r, p));
      for (const r of cibles) Object.assign(r, champs);
      return rep ? reponse(cibles.map(r => projeter(r, select))) : reponse(null, 204);
    }
    if (methode === "DELETE") {
      const cibles = tables[table].filter(r => correspond(r, p));
      tables[table] = tables[table].filter(r => !cibles.includes(r));
      return reponse(null, 204);
    }
    return reponse({ message: "méthode" }, 405);
  }
  return { tables, fetch, appels, etat };
}
