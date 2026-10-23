// ── API des pharmacies : stockage Supabase des tables api_* (sql/api-schema.sql) ──
// Tables à RLS activé SANS policy : illisibles avec la clé anon du navigateur. Accès par la clé serveur
// SUPABASE_SERVICE_ROLE_KEY, seulement depuis api-v1, api-admin et api-compte (modèle de _chat-stock.js et de _push.js).
// Règles : toute lecture d'une donnée de pharmacie est filtrée par odoo_id ; les changements d'état sont des écritures
// conditionnelles (révocation : revoquee_le encore vide ; réglages : updated_at lu) ; les erreurs ne reprennent jamais
// le corps de la requête ni celui de la réponse.
// creerStockApi(deps) : deps.fetch, deps.url, deps.cle, deps.maintenant injectables (doublures des tests).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (v) => UUID.test(String(v || ""));
const enc = encodeURIComponent;
const entier = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const lireJson = (t, d) => { try { return JSON.parse(t); } catch { return d; } };

const COLS_ACCES = "odoo_id,nom,cip,ville,actif,portees,mode,delai_annulation_min,plafond_lignes,plafond_boites,plafond_montant_ht,plafond_commandes_jour,anomalie_active,anomalie_facteur,anomalie_doublon_min,ip_autorisees,liste_prix_id,liste_prix_lue_le,test_valide_le,test_valide_par,cgu_version,cgu_acceptees_le,cgu_acceptees_par,cgu_preuve,ouvert_par,ouvert_le,suspendu_le,suspendu_par,motif_suspension,note,created_at,updated_at";
const COLS_CLE = "id,odoo_id,environnement,prefixe,libelle,portees,creee_par,creee_par_role,created_at,expire_le,revoquee_le,revoquee_par,motif_revocation,remplace,derniere_utilisation,dernier_reseau";
const COLS_JOURNAL = "id,at,request_id,cle_id,odoo_id,environnement,methode,route,statut,code,duree_ms,reseau";
const COLS_EVT = "id,at,type,odoo_id,cle_id,par,role,detail";
// numeric → nombre (PostgREST rend numeric en nombre ou en texte selon la configuration)
const acces = (r) => r ? { ...r, plafond_montant_ht: Number(r.plafond_montant_ht), anomalie_facteur: Number(r.anomalie_facteur),
  portees: r.portees || [], ip_autorisees: r.ip_autorisees || null } : null;

export function creerStockApi(deps = {}) {
  const url = deps.url || process.env.SUPABASE_URL;
  const cle = deps.cle || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const http = deps.fetch || ((...a) => fetch(...a));
  const maintenant = deps.maintenant || (() => new Date());
  const iso = () => maintenant().toISOString();

  async function sb(path, { method = "GET", body, prefer } = {}) {
    if (!cle || !url) throw Object.assign(new Error("clé serveur Supabase absente des variables Netlify"), { code: "configuration" });
    const headers = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await http(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    if (!res.ok) {
      const pg = lireJson(text, {})?.code;
      const schema = res.status === 404 || pg === "PGRST205" || pg === "PGRST202" || pg === "42P01" || pg === "PGRST204" || pg === "42703" || pg === "42883";
      throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} : HTTP ${res.status}${pg ? ` (${pg})` : ""}`),
        { status: res.status, pg, ...(schema ? { code: "schema" } : {}) });
    }
    return text ? lireJson(text, null) : null;
  }
  const doublon = (e) => e?.status === 409 || e?.pg === "23505";
  async function lireReglages() {
    const [r] = (await sb("api_reglages?id=eq.1&select=valeur,updated_at&limit=1")) || [];
    return { valeur: r ? lireJson(r.valeur, {}) : {}, updated_at: r?.updated_at || null };
  }

  return {
    sb,
    reglages: {
      lire: lireReglages,
      // écriture conditionnelle : base = updated_at lu (null : sans condition, « Tout couper ») → { ok, updated_at } | { conflit }
      async ecrire(valeur, base) {
        const filtre = base ? `&updated_at=eq.${enc(base)}` : "";
        const rows = await sb(`api_reglages?id=eq.1${filtre}&select=valeur,updated_at`, { method: "PATCH", prefer: "return=representation",
          body: { valeur: JSON.stringify(valeur), updated_at: iso() } });
        if (rows?.[0]) return { ok: true, updated_at: rows[0].updated_at };
        const lu = await lireReglages();
        return { conflit: true, valeur: lu.valeur, updated_at: lu.updated_at };
      },
    },
    acces: {
      async lire(odooId) {
        const n = entier(odooId);
        if (!n) return null;
        const [r] = (await sb(`api_acces?odoo_id=eq.${n}&select=${COLS_ACCES}&limit=1`)) || [];
        return acces(r);
      },
      async lister() {
        return ((await sb(`api_acces?select=${COLS_ACCES}&order=created_at.desc&limit=1000`)) || []).map(acces);
      },
      // → ligne créée, ou null si l'accès existe déjà
      async creer(ligne) {
        try {
          const [r] = (await sb(`api_acces?select=${COLS_ACCES}`, { method: "POST", prefer: "return=representation", body: ligne })) || [];
          return acces(r);
        } catch (e) { if (doublon(e)) return null; throw e; }
      },
      async modifier(odooId, champs) {
        const n = entier(odooId);
        if (!n) return null;
        const [r] = (await sb(`api_acces?odoo_id=eq.${n}&select=${COLS_ACCES}`, { method: "PATCH", prefer: "return=representation",
          body: { ...champs, updated_at: iso() } })) || [];
        return acces(r);
      },
    },
    cles: {
      // clé par empreinte (avec l'empreinte : rien d'autre ne la lit)
      async parEmpreinte(empreinte) {
        if (!/^[0-9a-f]{64}$/.test(String(empreinte || ""))) return null;
        const [r] = (await sb(`api_cles?empreinte=eq.${empreinte}&select=${COLS_CLE}&limit=1`)) || [];
        return r || null;
      },
      async lire(id, odooId) {
        const n = entier(odooId);
        if (!estUuid(id) || !n) return null;
        const [r] = (await sb(`api_cles?id=eq.${id}&odoo_id=eq.${n}&select=${COLS_CLE}&limit=1`)) || [];
        return r || null;
      },
      async lireAdmin(id) {
        if (!estUuid(id)) return null;
        const [r] = (await sb(`api_cles?id=eq.${id}&select=${COLS_CLE}&limit=1`)) || [];
        return r || null;
      },
      async deFiche(odooId) {
        const n = entier(odooId);
        if (!n) return [];
        return (await sb(`api_cles?odoo_id=eq.${n}&select=${COLS_CLE}&order=created_at.desc&limit=200`)) || [];
      },
      async toutes() {
        return (await sb(`api_cles?select=${COLS_CLE}&order=created_at.desc&limit=5000`)) || [];
      },
      async creer(ligne) {
        const [r] = (await sb(`api_cles?select=${COLS_CLE}`, { method: "POST", prefer: "return=representation", body: ligne })) || [];
        return r;
      },
      // → clé révoquée, ou null (déjà révoquée, ou d'une autre fiche)
      async revoquer(id, odooId, { par, motif }) {
        const n = entier(odooId);
        if (!estUuid(id) || !n) return null;
        const [r] = (await sb(`api_cles?id=eq.${id}&odoo_id=eq.${n}&revoquee_le=is.null&select=${COLS_CLE}`, { method: "PATCH",
          prefer: "return=representation", body: { revoquee_le: iso(), revoquee_par: String(par || "").slice(0, 200), motif_revocation: String(motif || "").slice(0, 300) || null } })) || [];
        return r || null;
      },
      async expirer(id, odooId, expireLe) {
        const n = entier(odooId);
        if (!estUuid(id) || !n) return null;
        const [r] = (await sb(`api_cles?id=eq.${id}&odoo_id=eq.${n}&revoquee_le=is.null&select=${COLS_CLE}`, { method: "PATCH",
          prefer: "return=representation", body: { expire_le: expireLe } })) || [];
        return r || null;
      },
      // dernière utilisation : au plus une écriture par minute et par clé (condition sur la date précédente)
      async noterUsage(id, reseau) {
        if (!estUuid(id)) return;
        const avant = new Date(maintenant().getTime() - 60_000).toISOString();
        await sb(`api_cles?id=eq.${id}&or=(derniere_utilisation.is.null,derniere_utilisation.lt.${enc(avant)})`, { method: "PATCH",
          prefer: "return=minimal", body: { derniere_utilisation: iso(), dernier_reseau: reseau || null } });
      },
    },
    journal: {
      ajouter(ligne) { return sb("api_journal", { method: "POST", prefer: "return=minimal", body: ligne }); },
      // filtres : odooId, cleId, depuisIso, erreurs (statut ≥ 400) ; limite ≤ 5000
      async lister({ odooId = null, cleId = null, depuisIso = null, erreurs = false, limite = 500 } = {}) {
        const f = [];
        if (entier(odooId)) f.push(`odoo_id=eq.${entier(odooId)}`);
        if (estUuid(cleId)) f.push(`cle_id=eq.${cleId}`);
        if (depuisIso) f.push(`at=gte.${enc(depuisIso)}`);
        if (erreurs) f.push("statut=gte.400");
        const n = Math.min(5000, Math.max(1, Number(limite) || 500));
        return (await sb(`api_journal?${[...f, `select=${COLS_JOURNAL}`, "order=at.desc", `limit=${n}`].join("&")}`)) || [];
      },
    },
    evenements: {
      ajouter({ type, odoo_id = null, cle_id = null, par = null, role = null, detail = null }) {
        return sb("api_evenements", { method: "POST", prefer: "return=minimal", body: { type, odoo_id, cle_id, par: par ? String(par).slice(0, 200) : null, role,
          detail: detail == null ? null : JSON.stringify(detail) } });
      },
      async lister(odooId, limite = 50) {
        const n = entier(odooId);
        const rows = (await sb(`api_evenements?${n ? `odoo_id=eq.${n}&` : ""}select=${COLS_EVT}&order=at.desc&limit=${Math.min(500, limite)}`)) || [];
        return rows.map(r => ({ ...r, detail: r.detail ? lireJson(r.detail, null) : null }));
      },
    },
    compteurs: {
      // +1 sur la fenêtre fixe en cours → nouvelle valeur (api_compter)
      async compter(cleCompteur, fenetreS) {
        const n = await sb("rpc/api_compter", { method: "POST", body: { p_cle: cleCompteur, p_fenetre_s: fenetreS } });
        return Number(n) || 0;
      },
      async lire(cleCompteur, fenetreS) {
        const n = await sb("rpc/api_lire_compteur", { method: "POST", body: { p_cle: cleCompteur, p_fenetre_s: fenetreS } });
        return Number(n) || 0;
      },
      // ménage : fenêtres de plus de 2 jours
      purger() {
        const avant = new Date(maintenant().getTime() - 2 * 86400e3).toISOString();
        return sb(`api_compteurs?fenetre=lt.${enc(avant)}`, { method: "DELETE", prefer: "return=minimal" });
      },
    },
  };
}
