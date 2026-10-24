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
const COLS_PRIX_LISTE = "liste_id,etat,demande_le,debut_le,fin_le,produits,sans_prix,appels,erreur,updated_at";
const COLS_COMMANDE = "id,odoo_id,cle_id,test,reference_client,order_id,etat,motif,statut_http,reponse,envoi_apres,envoi_resultat,recu_le,updated_at";
// phase 3 : ligne complète (idempotence, demande normalisée) pour la création, la reprise et l'envoi
const COLS_COMMANDE_PLEINE = `${COLS_COMMANDE},idempotency_key,empreinte_requete,demande`;
const ETATS_COMMANDE = /^(en_cours|refusee|recue|a_verifier|envoi_demande|envoyee|non_servie|annulee)$/;
// catalogue (odoo_catalog, synchronisé par la GitHub Action) : jamais les lots, ni le prix de la liste n° 5
const COLS_CATALOGUE = "cip,barcode,name,in_stock,available,updated_at";
const CIP13 = /^\d{13}$/;
const ORDRE_SITE = /^1[7-9]\d{11}$/;
const ORDRE_TEST = /^T1[7-9]\d{11}$/;
const listeIn = (xs) => `(${xs.map(x => `"${String(x).replace(/["\\]/g, "")}"`).join(",")})`;
const prixLigne = (r) => r ? { ...r, prix_ht: r.prix_ht == null ? null : Number(r.prix_ht), paliers: (() => { const p = typeof r.paliers === "string" ? lireJson(r.paliers, null) : r.paliers; return Array.isArray(p) ? p : []; })() } : null;
// numeric → nombre (PostgREST rend numeric en nombre ou en texte selon la configuration)
const acces = (r) => r ? { ...r, plafond_montant_ht: Number(r.plafond_montant_ht), anomalie_facteur: Number(r.anomalie_facteur),
  portees: r.portees || [], ip_autorisees: r.ip_autorisees || null } : null;

export function creerStockApi(deps = {}) {
  const url = deps.url || process.env.SUPABASE_URL;
  const cle = deps.cle || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const http = deps.fetch || ((...a) => fetch(...a));
  const maintenant = deps.maintenant || (() => new Date());
  const iso = () => maintenant().toISOString();

  // compte : Prefer count=exact → { rows, total } (total lu dans Content-Range « 0-99/5234 »)
  async function sb(path, { method = "GET", body, prefer, compte = false } = {}) {
    if (!cle || !url) throw Object.assign(new Error("clé serveur Supabase absente des variables Netlify"), { code: "configuration" });
    const headers = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
    const pref = [prefer, compte ? "count=exact" : null].filter(Boolean).join(",");
    if (pref) headers.Prefer = pref;
    const res = await http(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    if (!res.ok) {
      const pg = lireJson(text, {})?.code;
      const schema = res.status === 404 || pg === "PGRST205" || pg === "PGRST202" || pg === "42P01" || pg === "PGRST204" || pg === "42703" || pg === "42883";
      throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} : HTTP ${res.status}${pg ? ` (${pg})` : ""}`),
        { status: res.status, pg, ...(schema ? { code: "schema" } : {}) });
    }
    const donnees = text ? lireJson(text, null) : null;
    if (!compte) return donnees;
    const total = Number(String(res.headers?.get?.("content-range") || "").split("/")[1]);
    return { rows: Array.isArray(donnees) ? donnees : [], total: Number.isFinite(total) ? total : null };
  }
  // Lecture seule (GET) d'autres tables par la clé serveur (odoo_catalog, elixir_orders, elixir_pharmacies, kv_store) :
  // passée aux lectures de _chat-perimetre.js et du contingentement ; toute écriture y est refusée
  const sbLecture = (path, opts = {}) => {
    if (opts.method && opts.method !== "GET") throw new Error("API des pharmacies : écriture interdite hors des tables api_*");
    return sb(path);
  };
  const doublon = (e) => e?.status === 409 || e?.pg === "23505";
  async function lireReglages() {
    const [r] = (await sb("api_reglages?id=eq.1&select=valeur,updated_at&limit=1")) || [];
    return { valeur: r ? lireJson(r.valeur, {}) : {}, updated_at: r?.updated_at || null };
  }

  return {
    sb,
    sbLecture,
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
      // parcours de test (phase 3) : colonne lue et écrite à part (absente tant que le SQL n'est pas rejoué : rien ne casse)
      async parcours(odooId) {
        const n = entier(odooId);
        if (!n) return null;
        const [r] = (await sb(`api_acces?odoo_id=eq.${n}&select=test_parcours,test_valide_le&limit=1`)) || [];
        return r ? { etapes: lireJson(r.test_parcours, {}) || {}, test_valide_le: r.test_valide_le || null } : null;
      },
      async noterParcours(odooId, etapes, valideLe = null, par = null) {
        const n = entier(odooId);
        if (!n) return null;
        await sb(`api_acces?odoo_id=eq.${n}`, { method: "PATCH", prefer: "return=minimal", body: { test_parcours: JSON.stringify(etapes) } });
        if (!valideLe) return null;
        const [r] = (await sb(`api_acces?odoo_id=eq.${n}&test_valide_le=is.null&select=odoo_id`, { method: "PATCH", prefer: "return=representation",
          body: { test_valide_le: valideLe, test_valide_par: par, updated_at: iso() } })) || [];
        return r || null;
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
      // filtres : odooId, cleId, depuisIso, erreurs (statut ≥ 400), requestId (support : X-Request-Id donné par la pharmacie) ;
      // limite ≤ 5000
      async lister({ odooId = null, cleId = null, depuisIso = null, erreurs = false, requestId = null, limite = 500 } = {}) {
        const f = [];
        if (estUuid(requestId)) f.push(`request_id=eq.${String(requestId).toLowerCase()}`);
        if (entier(odooId)) f.push(`odoo_id=eq.${entier(odooId)}`);
        if (estUuid(cleId)) f.push(`cle_id=eq.${cleId}`);
        if (depuisIso) f.push(`at=gte.${enc(depuisIso)}`);
        if (erreurs) f.push("statut=gte.400");
        const n = Math.min(5000, Math.max(1, Number(limite) || 500));
        return (await sb(`api_journal?${[...f, `select=${COLS_JOURNAL}`, "order=at.desc", `limit=${n}`].join("&")}`)) || [];
      },
      // conservation : 13 mois (api-cron)
      purger(avantIso) { return sb(`api_journal?at=lt.${enc(avantIso)}`, { method: "DELETE", prefer: "return=minimal" }); },
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
      // événements d'un type depuis une date (signalements déjà faits par le passage planifié)
      async deType(type, depuisIso, limite = 500) {
        if (!/^[a-z_]{3,40}$/.test(String(type || ""))) return [];
        const rows = (await sb(`api_evenements?type=eq.${type}&at=gte.${enc(depuisIso)}&select=${COLS_EVT}&order=at.desc&limit=${Math.min(1000, limite)}`)) || [];
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

    // ── Phase 2 (lecture) ──
    // Prix calculés d'une liste (api_prix) ; jamais filtrés par pharmacie : une liste est partagée par ses fiches
    prix: {
      // prix de la liste pour les CIP d'une page du catalogue (bornes comprises, triés comme le catalogue)
      async plage(listeId, cipMin, cipMax) {
        const l = entier(listeId);
        if (!l || !CIP13.test(String(cipMin)) || !CIP13.test(String(cipMax))) return [];
        return ((await sb(`api_prix?liste_id=eq.${l}&cip=gte.${cipMin}&cip=lte.${cipMax}&select=cip,prix_ht,paliers,calcule_le&order=cip.asc&limit=2000`)) || []).map(prixLigne);
      },
      async deCips(listeId, cips) {
        const l = entier(listeId);
        const xs = [...new Set((cips || []).map(String))].filter(c => CIP13.test(c)).slice(0, 500);
        if (!l || !xs.length) return [];
        return ((await sb(`api_prix?liste_id=eq.${l}&cip=in.${enc(listeIn(xs))}&select=cip,prix_ht,paliers,calcule_le&limit=${xs.length}`)) || []).map(prixLigne);
      },
      // écriture groupée (upsert par liste et CIP) : rows = [{ liste_id, cip, prix_ht, paliers (tableau), calcule_le }]
      async ecrire(rows) {
        for (let i = 0; i < rows.length; i += 500) {
          await sb("api_prix?on_conflict=liste_id,cip", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
            body: rows.slice(i, i + 500).map(r => ({ ...r, paliers: JSON.stringify(r.paliers || []) })) });
        }
      },
      // produits sortis du catalogue : lignes de la liste non recalculées depuis le début du passage
      purger(listeId, avantIso) {
        const l = entier(listeId);
        if (!l || !avantIso) return null;
        return sb(`api_prix?liste_id=eq.${l}&calcule_le=lt.${enc(avantIso)}`, { method: "DELETE", prefer: "return=minimal" });
      },
    },
    // État du calcul par liste (api_prix_listes)
    prixListes: {
      async lire(listeId) {
        const l = entier(listeId);
        if (!l) return null;
        const [r] = (await sb(`api_prix_listes?liste_id=eq.${l}&select=${COLS_PRIX_LISTE}&limit=1`)) || [];
        return r || null;
      },
      async toutes() { return (await sb(`api_prix_listes?select=${COLS_PRIX_LISTE}&order=liste_id.asc&limit=200`)) || []; },
      // demande de calcul : crée la liste (a_calculer) si elle est inconnue ; forcer (admin) : la repasse à a_calculer si elle
      // n'est pas en cours
      async demander(listeId, { forcer = false } = {}) {
        const l = entier(listeId);
        if (!l) return null;
        const champs = { etat: "a_calculer", demande_le: iso(), updated_at: iso() };
        try {
          const [r] = (await sb(`api_prix_listes?select=${COLS_PRIX_LISTE}`, { method: "POST", prefer: "return=representation", body: { liste_id: l, ...champs } })) || [];
          return r || null;
        } catch (e) {
          if (!doublon(e)) throw e;
          const [r] = forcer ? (await sb(`api_prix_listes?liste_id=eq.${l}&etat=neq.en_cours&select=${COLS_PRIX_LISTE}`, { method: "PATCH", prefer: "return=representation", body: champs })) || [] : [];
          if (r) return r;
          const [lu] = (await sb(`api_prix_listes?liste_id=eq.${l}&select=${COLS_PRIX_LISTE}&limit=1`)) || [];
          return lu || null;
        }
      },
      // début d'un calcul : seulement si personne ne calcule cette liste (ou si un calcul en cours a été coupé : 20 min)
      async commencer(listeId) {
        const l = entier(listeId);
        if (!l) return null;
        const coupe = new Date(maintenant().getTime() - 20 * 60e3).toISOString();
        const champs = { etat: "en_cours", debut_le: iso(), erreur: null, updated_at: iso() };
        try {
          const [r] = (await sb(`api_prix_listes?select=${COLS_PRIX_LISTE}`, { method: "POST", prefer: "return=representation", body: { liste_id: l, demande_le: iso(), ...champs } })) || [];
          if (r) return r;
        } catch (e) { if (!doublon(e)) throw e; }
        const [r] = (await sb(`api_prix_listes?liste_id=eq.${l}&or=(etat.neq.en_cours,debut_le.lt.${enc(coupe)})&select=${COLS_PRIX_LISTE}`,
          { method: "PATCH", prefer: "return=representation", body: champs })) || [];
        return r || null;
      },
      async terminer(listeId, champs) {
        const l = entier(listeId);
        if (!l) return null;
        await sb(`api_prix_listes?liste_id=eq.${l}`, { method: "PATCH", prefer: "return=minimal", body: { ...champs, updated_at: iso() } });
      },
    },
    // Catalogue du site (odoo_catalog), lecture seule
    catalogue: {
      // page triée par CIP → { rows, total }
      async page({ offset = 0, limite = 100 } = {}) {
        const n = Math.min(1000, Math.max(1, Number(limite) || 100)), o = Math.max(0, Number(offset) || 0);
        return sb(`odoo_catalog?select=${COLS_CATALOGUE}&order=cip.asc&offset=${o}&limit=${n}`, { compte: true });
      },
      // produits par CIP13 ou code-barres (deux lectures : la liste « in » ne passe pas dans un « or »)
      async deCips(cips) {
        const xs = [...new Set((cips || []).map(String))].filter(c => CIP13.test(c)).slice(0, 400);
        if (!xs.length) return [];
        const [a, b] = await Promise.all([sb(`odoo_catalog?cip=in.${enc(listeIn(xs))}&select=${COLS_CATALOGUE}&limit=${xs.length * 2}`),
          sb(`odoo_catalog?barcode=in.${enc(listeIn(xs))}&select=${COLS_CATALOGUE}&limit=${xs.length * 2}`)]);
        const vus = new Map();
        for (const r of [...(a || []), ...(b || [])]) if (!vus.has(r.cip)) vus.set(r.cip, r);
        return [...vus.values()];
      },
      // un produit par son CIP13 (ou son code-barres)
      async parCip(cip) {
        if (!CIP13.test(String(cip || ""))) return null;
        const rows = (await sb(`odoo_catalog?or=(cip.eq.${cip},barcode.eq.${cip})&select=${COLS_CATALOGUE}&order=cip.asc&limit=5`)) || [];
        return rows.find(r => r.cip === cip) || rows[0] || null;
      },
      // tout le catalogue pour le calcul des prix (pages de 1 000 par CIP croissant)
      async pourPrix() {
        const out = [];
        for (let apres = ""; ;) {
          const rows = (await sb(`odoo_catalog?select=cip,odoo_pid,odoo_tmpl_id,categ_id,list_price${apres ? `&cip=gt.${apres}` : ""}&order=cip.asc&limit=1000`)) || [];
          out.push(...rows);
          if (rows.length < 1000) return out;
          apres = rows.at(-1).cip;
        }
      },
    },
    // Commandes reçues par l'API (api_commandes) : lectures de la phase 2, réservation et transitions de la phase 3 (toutes
    // conditionnelles : updated_at lu ET état lu — la fonction d'envoi, l'annulation et la reprise ne peuvent pas se croiser)
    commandes: {
      // réservation (idempotence) → { row } | { conflit: true } (même Idempotency-Key, ou reference_client déjà prise)
      async reserver(ligne) {
        try {
          const [r] = (await sb(`api_commandes?select=${COLS_COMMANDE_PLEINE}`, { method: "POST", prefer: "return=representation",
            body: { ...ligne, etat: "en_cours", recu_le: iso(), updated_at: iso() } })) || [];
          return { row: r };
        } catch (e) { if (doublon(e)) return { conflit: true }; throw e; }
      },
      async parIdempotence(odooId, test, cle) {
        const n = entier(odooId);
        if (!n || !/^[A-Za-z0-9_.:-]{8,128}$/.test(String(cle || ""))) return null;
        const [r] = (await sb(`api_commandes?odoo_id=eq.${n}&test=eq.${test ? "true" : "false"}&idempotency_key=eq.${enc(cle)}&select=${COLS_COMMANDE_PLEINE}&limit=1`)) || [];
        return r || null;
      },
      // commande (hors refusées) qui porte déjà cette référence client : une commande vivante d'abord (une commande annulée
      // libère sa référence ; elle n'est rendue que si l'ancien index de sql/api-schema.sql la retient encore)
      async parReference(odooId, test, reference) {
        const n = entier(odooId);
        if (!n || !reference) return null;
        const rows = (await sb(`api_commandes?odoo_id=eq.${n}&test=eq.${test ? "true" : "false"}&reference_client=eq.${enc(reference)}&etat=neq.refusee&select=${COLS_COMMANDE}&order=recu_le.desc&limit=5`)) || [];
        return rows.find(r => r.etat !== "annulee") || rows[0] || null;
      },
      async parId(id) {
        if (!estUuid(id)) return null;
        const [r] = (await sb(`api_commandes?id=eq.${id}&select=${COLS_COMMANDE_PLEINE}&limit=1`)) || [];
        return r || null;
      },
      // commande de la fiche par son numéro (environnement de la clé), hors refusées
      async parOrdre(odooId, test, ordre) {
        const n = entier(odooId);
        if (!n || !(test ? ORDRE_TEST : ORDRE_SITE).test(String(ordre || ""))) return null;
        const [r] = (await sb(`api_commandes?odoo_id=eq.${n}&test=eq.${test ? "true" : "false"}&order_id=eq.${enc(ordre)}&etat=neq.refusee&select=${COLS_COMMANDE_PLEINE}&order=recu_le.desc&limit=1`)) || [];
        return r || null;
      },
      // transition conditionnelle (état ET updated_at lus) → nouvelle ligne, ou null si quelqu'un est passé avant
      async ecrire(row, champs) {
        if (!estUuid(row?.id) || !row.updated_at || !ETATS_COMMANDE.test(String(row.etat))) return null;
        let t = maintenant().getTime();
        if (new Date(t).toISOString() === new Date(row.updated_at).toISOString()) t += 1;   // toujours une nouvelle version
        const [r] = (await sb(`api_commandes?id=eq.${row.id}&etat=eq.${row.etat}&updated_at=eq.${enc(row.updated_at)}&select=${COLS_COMMANDE_PLEINE}`,
          { method: "PATCH", prefer: "return=representation", body: { ...champs, updated_at: new Date(t).toISOString() } })) || [];
        return r || null;
      },
      // réservation abandonnée (erreur passagère, 429) : supprimée si rien n'a été préparé → la même Idempotency-Key repart de zéro
      async liberer(row) {
        if (!estUuid(row?.id) || !row.updated_at) return;
        await sb(`api_commandes?id=eq.${row.id}&etat=eq.en_cours&order_id=is.null&updated_at=eq.${enc(row.updated_at)}`, { method: "DELETE", prefer: "return=minimal" });
      },
      // réservation restée en suspens sans commande enregistrée (api-commandes-cron) → true si supprimée
      async supprimerReservation(row) {
        if (!estUuid(row?.id) || !row.updated_at) return false;
        const rows = (await sb(`api_commandes?id=eq.${row.id}&etat=eq.en_cours&updated_at=eq.${enc(row.updated_at)}&select=id`, { method: "DELETE", prefer: "return=representation" })) || [];
        return rows.length === 1;
      },
      // commandes acceptées depuis une date (plafond de commandes par jour)
      async compterDepuis(odooId, test, depuisIso) {
        const n = entier(odooId);
        if (!n) return 0;
        const rows = (await sb(`api_commandes?odoo_id=eq.${n}&test=eq.${test ? "true" : "false"}&recu_le=gte.${enc(depuisIso)}&order_id=not.is.null&etat=not.in.(refusee,en_cours)&select=id&limit=1000`)) || [];
        return rows.length;
      },
      // commandes réelles annulées récemment (passage planifié : les lignes du site doivent porter la marque d'annulation)
      async annuleesRecentes(depuisIso, limite = 50) {
        return (await sb(`api_commandes?etat=eq.annulee&test=eq.false&order_id=not.is.null&updated_at=gte.${enc(depuisIso)}&select=${COLS_COMMANDE}&order=updated_at.desc&limit=${Math.min(200, limite)}`)) || [];
      },
      // commandes de TEST récentes d'une fiche (quasi-doublons du mode test)
      async recentesTest(odooId, depuisIso) {
        const n = entier(odooId);
        if (!n) return [];
        return (await sb(`api_commandes?odoo_id=eq.${n}&test=eq.true&recu_le=gte.${enc(depuisIso)}&etat=in.(recue,a_verifier,envoyee)&select=${COLS_COMMANDE}&limit=200`)) || [];
      },
      // commandes réelles dont le délai d'annulation est écoulé (api-commandes-cron)
      async dues(nowIso, limite = 20) {
        return (await sb(`api_commandes?etat=eq.recue&test=eq.false&envoi_apres=lte.${enc(nowIso)}&select=${COLS_COMMANDE}&order=envoi_apres.asc&limit=${Math.min(100, limite)}`)) || [];
      },
      // réservations ou envois restés en suspens (fonction coupée) depuis avantIso
      async enSuspens(avantIso, limite = 50) {
        return (await sb(`api_commandes?etat=in.(en_cours,envoi_demande)&updated_at=lt.${enc(avantIso)}&select=${COLS_COMMANDE_PLEINE}&order=updated_at.asc&limit=${Math.min(200, limite)}`)) || [];
      },
      // admin : dernières commandes (toutes fiches)
      async recentes(limite = 100) {
        return (await sb(`api_commandes?etat=neq.en_cours&select=${COLS_COMMANDE_PLEINE}&order=recu_le.desc&limit=${Math.min(500, limite)}`)) || [];
      },
      // admin (onglet Commandes) : commandes réelles par numéro
      async parNumeros(ordres) {
        const xs = [...new Set((ordres || []).map(String))].filter(o => ORDRE_SITE.test(o)).slice(0, 300);
        if (!xs.length) return [];
        return (await sb(`api_commandes?test=eq.false&order_id=in.${enc(listeIn(xs))}&etat=neq.refusee&select=${COLS_COMMANDE}&limit=${xs.length * 2}`)) || [];
      },
      // commandes d'une fiche (test : environnement test, « T… » ; sinon live) reçues dans [depuis, jusqua[, les plus récentes d'abord
      async deFiche(odooId, { test = false, depuisIso = null, jusquaIso = null, limite = 200 } = {}) {
        const n = entier(odooId);
        if (!n) return [];
        const f = [`odoo_id=eq.${n}`, `test=eq.${test ? "true" : "false"}`, "etat=neq.refusee", "order_id=not.is.null"];
        if (depuisIso) f.push(`recu_le=gte.${enc(depuisIso)}`);
        if (jusquaIso) f.push(`recu_le=lt.${enc(jusquaIso)}`);
        return (await sb(`api_commandes?${[...f, `select=${COLS_COMMANDE}`, "order=recu_le.desc", `limit=${Math.min(500, Math.max(1, Number(limite) || 200))}`].join("&")}`)) || [];
      },
      // commandes de la fiche portant ces numéros (site « 1… » ou test « T1… »)
      async parOrdres(odooId, ordres) {
        const n = entier(odooId);
        const xs = [...new Set((ordres || []).map(String))].filter(o => ORDRE_SITE.test(o) || ORDRE_TEST.test(o)).slice(0, 200);
        if (!n || !xs.length) return [];
        return (await sb(`api_commandes?odoo_id=eq.${n}&order_id=in.${enc(listeIn(xs))}&etat=neq.refusee&select=${COLS_COMMANDE}&limit=${xs.length * 2}`)) || [];
      },
    },
    // Commandes du site d'une pharmacie (elixir_orders, par le CIP de la fiche) ; phase 3 : écriture des commandes passées
    // par l'API (source « api », même table que le site : contingent, « Mes commandes », onglet Commandes, relais)
    site: {
      // → { ok: true } | { doublon: true } (numéro déjà pris)
      async inserer(ligne) {
        try { await sb("elixir_orders", { method: "POST", prefer: "return=minimal", body: ligne }); return { ok: true }; }
        catch (e) { if (doublon(e)) return { doublon: true }; throw e; }
      },
      async lire(id) {
        if (!ORDRE_SITE.test(String(id || ""))) return null;
        const [r] = (await sb(`elixir_orders?id=eq.${id}&select=id,date,items,processed,pharmacy_cip,pharmacy_email,source&limit=1`)) || [];
        if (!r) return null;
        return { ...r, items: typeof r.items === "string" ? lireJson(r.items, []) : (Array.isArray(r.items) ? r.items : []) };
      },
      // lignes réécrites (marques de l'API : rupture, annulation) ; processed posé si toutes les lignes sont faites. Repli de
      // marquer() tant que la fonction SQL n'existe pas.
      ecrireLignes(id, items, processed) {
        if (!ORDRE_SITE.test(String(id || ""))) return null;
        return sb(`elixir_orders?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { items, processed: !!processed } });
      },
      // marques posées en UNE transaction par la base (rpc api_marquer_lignes : lignes sans synced_at ni handled_at seulement)
      // → nombre de lignes marquées (-1 : commande absente) ; null si la fonction n'existe pas encore (fichier SQL pas rejoué)
      async marquer(id, idx, motif, atIso) {
        if (!ORDRE_SITE.test(String(id || ""))) return -1;
        try {
          const n = await sb("rpc/api_marquer_lignes", { method: "POST", body: { p_order_id: String(id), p_idx: Array.isArray(idx) ? idx.map(Number) : null, p_motif: motif, p_at: atIso } });
          return Number.isInteger(Number(n)) ? Number(n) : 0;
        } catch (e) { if (e?.code === "schema") return null; throw e; }
      },
      // commandes passées par l'API depuis une date (passage planifié : chacune doit avoir sa ligne api_commandes)
      async apiDepuis(depuisIso, limite = 200) {
        return (await sb(`elixir_orders?source=eq.api&date=gte.${enc(depuisIso)}&select=id,date,pharmacy_cip,pharmacy_name,total_ht&order=date.desc&limit=${Math.min(500, limite)}`)) || [];
      },
      // commandes récentes de la fiche (par CIP et par adresses de compte) : quasi-doublons
      async recentes(cip, emails, depuisIso) {
        const f = [...(/^\d{7,13}$/.test(String(cip || "")) ? [`pharmacy_cip.eq.${cip}`] : []), ...(emails || []).slice(0, 20).map(e => `pharmacy_email.eq.${JSON.stringify(String(e))}`)];
        if (!f.length) return [];
        const rows = (await sb(`elixir_orders?date=gte.${enc(depuisIso)}&or=(${enc(f.join(","))})&select=id,date,items,source&order=date.desc&limit=100`)) || [];
        return rows.map(r => ({ ...r, items: typeof r.items === "string" ? lireJson(r.items, []) : (Array.isArray(r.items) ? r.items : []) }));
      },
      async comptes(odooId) {
        const n = entier(odooId);
        if (!n) return [];
        return [...new Set(((await sb(`elixir_pharmacies?odoo_id=eq.${n}&select=email`)) || []).map(r => String(r.email || "").trim()).filter(Boolean))];
      },
      // décrément du stock affiché par le site (même fonction que order-save)
      decrementer(cip, qty) { return sb("rpc/decrement_stock", { method: "POST", body: { p_cip: String(cip), p_qty: Number(qty) } }); },
      // notification interne de l'admin (même table que order-save)
      notifier(n) { return sb("ec_notifications", { method: "POST", prefer: "return=minimal", body: { ...n, read: false } }); },
      async numeros(cip, { debutIso, finIso, offset = 0, limite = 21 } = {}) {
        if (!/^\d{7,13}$/.test(String(cip || ""))) return [];
        const o = Math.max(0, Number(offset) || 0), n = Math.min(600, Math.max(1, Number(limite) || 21));
        return (await sb(`elixir_orders?pharmacy_cip=eq.${enc(cip)}&date=gte.${enc(debutIso)}&date=lt.${enc(finIso)}&select=id,date&order=date.desc&offset=${o}&limit=${n}`)) || [];
      },
    },
    // Tâches du relais d'une commande (kv_store pmlr:tache:<numéro>…), lecture seule : annulation possible tant que rien n'est parti
    relais: {
      async taches(ordre) {
        if (!ORDRE_SITE.test(String(ordre || ""))) return [];
        const rows = (await sb(`kv_store?key=like.${enc(`pmlr:tache:${ordre}`)}*&select=key,value&limit=50`)) || [];
        return rows.map(r => (typeof r.value === "string" ? lireJson(r.value, null) : r.value)).filter(t => t && String(t.orderId) === String(ordre));
      },
    },
  };
}
