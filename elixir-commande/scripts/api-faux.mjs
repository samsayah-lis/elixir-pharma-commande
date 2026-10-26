// ── API des pharmacies : faux PostgREST en mémoire des tables api_* (sql/api-schema.sql) ──
// Sert à scripts/test-api-fondations.mjs et au banc d'essai (scripts/banc/api-banc.mjs). Aucun appel réseau.
// Sous-ensemble de PostgREST utilisé par netlify/functions/_api-stock.js : select, eq, neq, gt, gte, lt, lte, like, in, is,
// not.is, or=(…), order, offset, limit, Prefer count=exact (Content-Range) ; POST (return=representation ; upsert
// resolution=merge-duplicates), PATCH conditionnel, DELETE ; unicité (api_acces.odoo_id, api_cles.empreinte,
// api_prix_listes.liste_id, api_prix (liste_id, cip) → 409 23505) ; phase 2 : tables de lecture odoo_catalog, elixir_orders,
// elixir_pharmacies, kv_store (remplies par les tests ou le banc) ; phase 3 : unicité de api_commandes (fiche, environnement,
// Idempotency-Key ; reference_client hors refusées), elixir_orders.id, kv_store.key ; ec_notifications ; rpc/decrement_stock
// (noté dans tables.decrements) ; DELETE avec return=representation ; elixir_campaigns, elixir_products et ec_config (produits hors
// API : campagnes, menus promo à quantité limitée) ;
// fonctions rpc/api_compter et rpc/api_lire_compteur (fenêtres fixes, comme le SQL ; fenêtre d'un jour = jour de Paris) ;
// rpc/api_marquer_lignes (comme le SQL : lignes sans synced_at ni handled_at ; etat.sansMarquer = true : fonction absente,
// 404 PGRST202 — fichier SQL pas encore rejoué) ; etat.indexReferenceAncien = true : ancien index de reference_client (hors
// refusées seulement, les annulées gardent leur référence) ; clé serveur exigée (sinon 401, compté dans etat.refusees) ;
// etat.panne = true : fetch lève (Supabase injoignable).
// horloge() → millisecondes (horloge des tests) ; tables, appels (journal des requêtes) et etat sont exposés.
import crypto from "node:crypto";

export function fauxPostgrestApi({ horloge = () => Date.now(), cleService = "cle-service-test" } = {}) {
  const T0 = () => horloge();
  const iso = () => new Date(T0()).toISOString();
  const tables = { api_reglages: [{ id: 1, valeur: "{}", updated_at: iso() }], api_acces: [], api_cles: [], api_commandes: [], api_journal: [], api_evenements: [], api_compteurs: [],
    api_prix: [], api_prix_listes: [], odoo_catalog: [], elixir_orders: [], elixir_pharmacies: [], kv_store: [], ec_notifications: [], decrements: [], elixir_campaigns: [], elixir_products: [], ec_config: [] };
  let seq = 0;
  const appels = [];
  const DEFAUTS = {
    api_acces: () => ({ nom: null, cip: null, ville: null, actif: true, portees: ["lecture", "commande", "documents"], mode: "auto", delai_annulation_min: 10, plafond_lignes: 100,
      plafond_boites: 1000, plafond_montant_ht: "3000.00", plafond_commandes_jour: 10, anomalie_active: true, anomalie_facteur: "10.00", anomalie_doublon_min: 30,
      ip_autorisees: null, liste_prix_id: null, liste_prix_lue_le: null, test_valide_le: null, test_valide_par: null, cgu_version: null, cgu_acceptees_le: null,
      cgu_acceptees_par: null, cgu_preuve: null, ouvert_le: iso(), suspendu_le: null, suspendu_par: null, motif_suspension: null, note: null, created_at: iso(), updated_at: iso() }),
    api_cles: () => ({ id: crypto.randomUUID(), created_at: iso(), expire_le: null, revoquee_le: null, revoquee_par: null, motif_revocation: null, remplace: null,
      derniere_utilisation: null, dernier_reseau: null }),
    api_journal: () => ({ id: ++seq, at: iso() }),
    api_evenements: () => ({ id: ++seq, at: iso() }),
    api_prix_listes: () => ({ etat: "a_calculer", demande_le: null, debut_le: null, fin_le: null, produits: null, sans_prix: null, appels: null, erreur: null, updated_at: iso() }),
    api_commandes: () => ({ id: crypto.randomUUID(), recu_le: iso(), updated_at: iso() }),
  };
  // clé null : contrainte sans objet pour cette ligne (index partiel de api_commandes.reference_client, hors refusées)
  const UNIQUES = { api_acces: [r => String(r.odoo_id)], api_cles: [r => r.empreinte], api_prix_listes: [r => String(r.liste_id)], api_prix: [r => `${r.liste_id}|${r.cip}`],
    api_commandes: [r => `${r.odoo_id}|${r.test}|${r.idempotency_key}`,
      r => (r.reference_client && r.etat !== "refusee" && (etat.indexReferenceAncien || r.etat !== "annulee") ? `${r.odoo_id}|${r.test}|ref:${r.reference_client}` : null)],
    elixir_orders: [r => String(r.id)], kv_store: [r => r.key] };
  const memeCle = (f, a, b) => { const k = f(b); return k != null && f(a) === k; };
  const cmp = (a, b) => {
    if (a === null || a === undefined) return NaN;
    if (typeof a === "number") return a - Number(b);
    if (typeof a === "boolean") return String(a) === b ? 0 : 1;
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(a)) && !Number.isNaN(Date.parse(b))) return Date.parse(a) - Date.parse(b);
    return String(a) < b ? -1 : String(a) > b ? 1 : 0;
  };
  const sansGuillemets = (x) => (/^".*"$/.test(x) ? JSON.parse(x) : x);
  const condition = (r, k, v) => {
    const i = v.indexOf("."); const op = v.slice(0, i), val = v.slice(i + 1);
    if (op === "not") return !condition(r, k, val);
    if (op === "eq") return cmp(r[k], sansGuillemets(val)) === 0;
    if (op === "neq") return !(cmp(r[k], sansGuillemets(val)) === 0);
    if (op === "gt") return cmp(r[k], val) > 0;
    if (op === "gte") return cmp(r[k], val) >= 0;
    if (op === "lt") return cmp(r[k], val) < 0;
    if (op === "lte") return cmp(r[k], val) <= 0;
    if (op === "like") return new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(String(r[k] ?? ""));
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map(sansGuillemets).some(x => cmp(r[k], x) === 0);
    if (op === "is") return val === "null" ? r[k] === null || r[k] === undefined : String(r[k]) === val;
    throw new Error(`filtre non pris en charge : ${k}=${v}`);
  };
  const SPECIAUX = new Set(["select", "order", "limit", "offset", "on_conflict"]);
  const correspond = (r, params) => [...params].every(([k, v]) => {
    if (SPECIAUX.has(k)) return true;
    if (k === "or") return v.replace(/^\(|\)$/g, "").split(",").some(c => { const i = c.indexOf("."); return condition(r, c.slice(0, i), c.slice(i + 1)); });
    return condition(r, k, v);
  });
  const projeter = (r, select) => select ? Object.fromEntries(select.split(",").map(c => [c, r[c] ?? null])) : { ...r };
  const doublon = (table, r) => (UNIQUES[table] || []).some(f => tables[table].some(x => x !== r && memeCle(f, x, r)));
  const reponse = (corps, status = 200, entetes = {}) => new Response(corps === null ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json", ...entetes } });
  const etat = { panne: false, refusees: 0, sansMarquer: false, indexReferenceAncien: false };
  // début de la fenêtre en cours (comme api_fenetre du SQL) : un jour = minuit, heure de Paris
  const fenetreDe = (s) => {
    if (s !== 86400) return new Date(Math.floor(T0() / 1000 / s) * s * 1000).toISOString();
    const jour = new Date(T0()).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    for (const off of ["+01:00", "+02:00"]) {
      const m = Date.parse(`${jour}T00:00:00${off}`);
      if (new Date(m).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) === jour && new Date(m - 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) !== jour) return new Date(m).toISOString();
    }
    return new Date(Date.parse(`${jour}T00:00:00+01:00`)).toISOString();
  };
  async function fetch(url, opts = {}) {
    if (etat.panne) throw new TypeError("fetch failed");
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const methode = opts.method || "GET";
    const prefer = String(opts.headers?.Prefer || "");
    appels.push({ table, methode, url: u.pathname + u.search });
    if (opts.headers?.apikey !== cleService || opts.headers?.Authorization !== `Bearer ${cleService}`) { etat.refusees++; return reponse({ message: "clé refusée" }, 401); }
    if (table === "rpc/decrement_stock") { const b = JSON.parse(opts.body); tables.decrements.push({ cip: b.p_cip, qty: b.p_qty }); return reponse(null, 200); }
    if (table === "rpc/api_marquer_lignes") {
      if (etat.sansMarquer) return reponse({ code: "PGRST202", message: "fonction absente" }, 404);
      const b = JSON.parse(opts.body);
      if (!["annulee", "rupture"].includes(b.p_motif)) return reponse({ code: "P0001", message: "motif inconnu" }, 400);
      const o = tables.elixir_orders.find(x => String(x.id) === String(b.p_order_id));
      if (!o) return reponse(-1);
      let its = typeof o.items === "string" ? JSON.parse(o.items) : o.items;
      if (!Array.isArray(its)) return reponse(0);
      let n = 0;
      its = its.map((it, i) => {
        if (!it || typeof it !== "object" || (b.p_idx && !b.p_idx.includes(i)) || it.synced_at || it.handled_at) return it;
        n++;
        return { ...it, handled_at: b.p_at, api_motif: b.p_motif };
      });
      if (n) { o.items = its; o.processed = !!o.processed || its.every(it => it?.synced_at || it?.handled_at); }
      etat.marquages = (etat.marquages || 0) + 1;
      return reponse(n);
    }
    if (table.startsWith("rpc/")) {
      const { p_cle, p_fenetre_s } = JSON.parse(opts.body);
      const fenetre = fenetreDe(p_fenetre_s);
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
      const total = rows.length;
      const debut = Number(p.get("offset") || 0);
      rows = rows.slice(debut, p.get("limit") ? debut + Number(p.get("limit")) : undefined);
      const plage = prefer.includes("count=exact") ? { "Content-Range": `${rows.length ? `${debut}-${debut + rows.length - 1}` : "*"}/${total}` } : {};
      return reponse(rows.map(r => projeter(r, select)), 200, plage);
    }
    if (methode === "POST") {
      const corps = JSON.parse(opts.body);
      const envoyees = Array.isArray(corps) ? corps : [corps];
      const fusion = prefer.includes("resolution=merge-duplicates");
      const faites = [];
      for (const x of envoyees) {
        const r = { ...(DEFAUTS[table]?.() || {}), ...x };
        const existante = tables[table].find(y => (UNIQUES[table] || []).some(f => memeCle(f, y, r)));
        // upsert : seuls les champs envoyés remplacent ceux de la ligne existante (comme PostgREST)
        if (existante && fusion) { Object.assign(existante, x); faites.push(existante); continue; }
        if (existante || doublon(table, r)) return reponse({ code: "23505", message: "duplicate key" }, 409);
        tables[table].push(r);
        faites.push(r);
      }
      return rep ? reponse(faites.map(r => projeter(r, select)), 201) : reponse(null, 201);
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
      return rep ? reponse(cibles.map(r => projeter(r, select))) : reponse(null, 204);
    }
    return reponse({ message: "méthode" }, 405);
  }
  return { tables, fetch, appels, etat };
}
