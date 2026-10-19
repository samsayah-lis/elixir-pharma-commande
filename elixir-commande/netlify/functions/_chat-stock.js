// ── Assistant Elixir : stockage Supabase des tables chat_* (docs/assistant-contrat.md, « Stockage ») ──
// Tables de sql/chat-schema.sql : RLS activé SANS policy, donc illisibles avec la clé anon du navigateur. On y accède
// avec la clé serveur SUPABASE_SERVICE_ROLE_KEY, et seulement depuis les fonctions du chat.
// Règles :
//  - chaque lecture d'une donnée de pharmacie est filtrée par odoo_id (l'identité vérifiée par le serveur) ;
//  - les changements d'état sont des écritures conditionnelles (filtre sur le statut, ou sur la version de la
//    conversation) : une action rejouée ou deux onglets simultanés ne font jamais deux fois la même chose ;
//  - messages de l'API : texte JSON en ajout seulement. Le nouveau texte est l'ancien, octet pour octet, suivi des
//    nouveaux messages : l'historique rejoué au modèle ne change jamais (cache, blocs de réflexion).
// creerStock(deps) : deps.fetch, deps.url, deps.cle, deps.maintenant sont injectables (doublures des tests).
import crypto from "node:crypto";
import { jourParis, debutJourParisIso, jourSuivant } from "./_chat-config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{32}$/;
const enc = encodeURIComponent;
const entier = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const lireJson = (t, defaut) => { if (typeof t !== "string") return t ?? defaut; try { return JSON.parse(t); } catch { return defaut; } };
const liste = (valeurs) => `(${valeurs.map(v => String(v).replace(/[^a-z_]/gi, "")).join(",")})`;

// Ajout en fin de tableau JSON sans réécrire le texte existant
export function ajouterAuTexte(texte, items) {
  const t = String(texte ?? "[]");
  if (!items?.length) return t;
  const morceaux = items.map(m => JSON.stringify(m)).join(",");
  if (t.trim() === "[]") return `[${morceaux}]`;
  if (!t.endsWith("]")) throw new Error("historique de conversation illisible");
  return `${t.slice(0, -1)},${morceaux}]`;
}

const COLS_CONV = "id,odoo_id,cip,pharmacie,compte_email,admin_email,modele,prompt_version,statut,messages,affichage,evenements_en_attente,nb_messages,version,created_at,updated_at";
const COLS_TOUR = "id,conversation_id,odoo_id,admin_email,statut,etape,texte,ui_actions,outils,usage,cout_eur,appels,repli,refus,code,duree_ms,created_at,started_at,finished_at";
const COLS_DEMANDE = "id,seq,numero,type,categorie,statut,conversation_id,odoo_id,pharmacie,admin_email,brouillon,resume,cible_ref,expire_at,created_at,confirmee_at,transmise_at,updated_at,erreur";

const conversation = (r) => r ? {
  ...r, messages_texte: r.messages, messages: lireJson(r.messages, []), affichage_texte: r.affichage,
  affichage: lireJson(r.affichage, []), evenements: lireJson(r.evenements_en_attente, []),
} : null;
const tour = (r) => r ? { ...r, ui_actions: lireJson(r.ui_actions, []), outils: lireJson(r.outils, []), usage: lireJson(r.usage, null),
  cout_eur: Number(r.cout_eur) || 0, ...(r.ctx !== undefined ? { ctx: lireJson(r.ctx, null) } : {}) } : null;
const demande = (r) => r ? { ...r, brouillon: lireJson(r.brouillon, {}) } : null;

export function creerStock(deps = {}) {
  const url = deps.url || process.env.SUPABASE_URL;
  const cle = deps.cle || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const http = deps.fetch || ((...a) => fetch(...a));
  const maintenant = deps.maintenant || (() => new Date());
  const iso = () => maintenant().toISOString();

  // PostgREST. Les erreurs ne reprennent ni le corps de la requête ni celui de la réponse (journaux sans contenu).
  async function sb(path, { method = "GET", body, prefer, compter = false } = {}) {
    if (!cle) throw Object.assign(new Error("SUPABASE_SERVICE_ROLE_KEY absente des variables Netlify : l'assistant ne peut pas lire ni enregistrer ses conversations"), { code: "configuration" });
    if (!url) throw Object.assign(new Error("SUPABASE_URL absente des variables Netlify"), { code: "configuration" });
    const headers = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
    const prefs = [prefer, compter ? "count=exact" : null].filter(Boolean);
    if (prefs.length) headers.Prefer = prefs.join(",");
    if (compter) { headers["Range-Unit"] = "items"; headers.Range = "0-0"; }
    const res = await http(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    if (!res.ok && !(compter && res.status === 416)) {   // 416 : plage vide d'un comptage
      const pg = lireJson(text, {})?.code;
      throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} : HTTP ${res.status}${pg ? ` (${pg})` : ""}`), { status: res.status, pg });
    }
    if (compter) {   // Content-Range : « 0-0/12 » ou « */0 »
      const total = Number(String(res.headers.get("content-range") || "").split("/")[1]);
      return Number.isFinite(total) ? total : (lireJson(text, []) || []).length;
    }
    return text ? JSON.parse(text) : null;
  }
  // lecture paginée (PostgREST plafonne chaque réponse à 1 000 lignes)
  async function tout(path, max = 20_000) {
    const out = [];
    for (let de = 0; de < max; de += 1000) {
      const rows = await sb(`${path}&limit=1000&offset=${de}`) || [];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }
  const doublon = (e) => e?.status === 409 || e?.pg === "23505";

  // ── Conversations ──
  const lireConv = async (id, odooId) => {
    const n = entier(odooId);
    if (!UUID.test(String(id || "")) || !n) return null;
    const [r] = await sb(`chat_conversations?id=eq.${id}&odoo_id=eq.${n}&select=${COLS_CONV}&limit=1`) || [];
    return conversation(r);
  };
  // fn(conversation) → champs à écrire (ou null : rien à changer) ; écrit seulement si personne n'a écrit entre-temps
  async function modifier(id, odooId, fn, essais = 5) {
    for (let i = 0; i < essais; i++) {
      const c = await lireConv(id, odooId);
      if (!c) return null;
      const champs = await fn(c);
      if (!champs) return c;
      const [r] = await sb(`chat_conversations?id=eq.${c.id}&odoo_id=eq.${c.odoo_id}&version=eq.${c.version}&select=${COLS_CONV}`,
        { method: "PATCH", prefer: "return=representation", body: { ...champs, version: c.version + 1, updated_at: iso() } }) || [];
      if (r) return conversation(r);
    }
    throw Object.assign(new Error("conversation modifiée en même temps ailleurs"), { code: "concurrence" });
  }
  const conversations = {
    async ouverte(odooId, admin) {
      const n = entier(odooId);
      if (!n) return null;
      const [r] = await sb(`chat_conversations?odoo_id=eq.${n}&${admin ? `admin_email=eq.${enc(admin)}` : "admin_email=is.null"}&statut=eq.ouverte&select=${COLS_CONV}&order=updated_at.desc&limit=1`) || [];
      return conversation(r);
    },
    // une seule conversation ouverte par fiche et par auteur (index unique) : en cas de course, on reprend l'autre
    async creer(ctx, { modele, prompt_version }) {
      const n = entier(ctx?.odooId);
      if (!n) throw new Error("fiche Odoo manquante");
      try {
        const [r] = await sb(`chat_conversations?select=${COLS_CONV}`, { method: "POST", prefer: "return=representation", body: {
          odoo_id: n, cip: ctx.cip || null, pharmacie: String(ctx.nom || "").slice(0, 200) || null, compte_email: ctx.compteEmail || null,
          admin_email: ctx.admin || null, modele, prompt_version } }) || [];
        return conversation(r);
      } catch (e) {
        if (doublon(e)) return conversations.ouverte(n, ctx.admin || null);
        throw e;
      }
    },
    lire: lireConv,
    modifier,
    // msgs : messages de l'API, ajoutés tels quels ; extra.affichage : MessageAffiche[] ; extra.messagesEcrits : compteur
    ajouterMessages(id, odooId, msgs, extra = {}) {
      return modifier(id, odooId, (c) => ({
        messages: ajouterAuTexte(c.messages_texte, msgs || []),
        ...(extra.affichage?.length ? { affichage: JSON.stringify([...c.affichage, ...extra.affichage]) } : {}),
        ...(extra.messagesEcrits ? { nb_messages: (c.nb_messages || 0) + extra.messagesEcrits } : {}),
      }));
    },
    async fermer(id, odooId) {
      const n = entier(odooId);
      if (!UUID.test(String(id || "")) || !n) return false;
      const rows = await sb(`chat_conversations?id=eq.${id}&odoo_id=eq.${n}&statut=eq.ouverte&select=id`, { method: "PATCH", prefer: "return=representation", body: { statut: "close", updated_at: iso() } });
      return (rows || []).length > 0;
    },
    // événement vérifié par le serveur, dit au modèle après le prochain message de la pharmacie
    evenement(id, odooId, texte) {
      return modifier(id, odooId, (c) => ({ evenements_en_attente: JSON.stringify([...(Array.isArray(c.evenements) ? c.evenements : []), String(texte).slice(0, 500)].slice(-10)) }));
    },
    // carte affichée hors tour (confirmation d'une demande) : seulement l'affichage, pas l'historique de l'API
    afficher(id, odooId, messageAffiche) {
      return modifier(id, odooId, (c) => ({ affichage: JSON.stringify([...c.affichage, messageAffiche]) }));
    },
    // admin (verifyAdmin) : liste et lecture sans filtre de fiche
    async lister({ depuisIso, limite = 500 } = {}) {
      return await sb(`chat_conversations?updated_at=gte.${enc(depuisIso)}&select=id,odoo_id,pharmacie,admin_email,statut,nb_messages,modele,created_at,updated_at&order=updated_at.desc&limit=${Math.min(limite, 1000)}`) || [];
    },
    async lireAdmin(id) {
      if (!UUID.test(String(id || ""))) return null;
      const [r] = await sb(`chat_conversations?id=eq.${id}&select=${COLS_CONV}&limit=1`) || [];
      return conversation(r);
    },
  };

  // ── Tours (un message et sa réponse ; compteur durable des quotas et du budget) ──
  const majTour = async (id, filtre, champs) => {
    if (!UUID.test(String(id || ""))) return false;
    const rows = await sb(`chat_tours?id=eq.${id}&${filtre}&select=id`, { method: "PATCH", prefer: "return=representation", body: champs });
    return (rows || []).length > 0;
  };
  const tours = {
    // null si un tour est déjà actif dans cette conversation (index unique) → 409
    async creer(conv, ctx) {
      try {
        const [r] = await sb(`chat_tours?select=${COLS_TOUR}`, { method: "POST", prefer: "return=representation", body: {
          conversation_id: conv.id, odoo_id: conv.odoo_id, admin_email: ctx.admin || null, statut: "en_attente",
          ctx: JSON.stringify({ odooId: ctx.odooId, cip: ctx.cip ?? null, nom: ctx.nom ?? "", ville: ctx.ville ?? null, compteEmail: ctx.compteEmail ?? null,
            comptes: Array.isArray(ctx.comptes) ? ctx.comptes : [], admin: ctx.admin || null, mode: ctx.mode || "complet" }) } }) || [];
        return tour(r);
      } catch (e) {
        if (doublon(e)) return null;
        throw e;
      }
    },
    // en_attente → en_cours, une seule fois (double lancement : le second ne fait rien)
    demarrer: (id) => majTour(id, "statut=eq.en_attente", { statut: "en_cours", started_at: iso() }),
    etape: (id, texte) => majTour(id, "statut=eq.en_cours", { etape: texte ? String(texte).slice(0, 120) : null }),
    terminer: (id, r) => majTour(id, "statut=eq.en_cours", {
      statut: "termine", etape: null, texte: r.texte ?? "", ui_actions: JSON.stringify(r.ui_actions || []), outils: JSON.stringify(r.outils || []),
      usage: r.usage ? JSON.stringify(r.usage) : null, cout_eur: Number(r.cout_eur) || 0, appels: r.appels || 0, repli: !!r.repli, refus: !!r.refus,
      code: r.code || "ok", duree_ms: r.duree_ms ?? null, finished_at: iso() }),
    // tour en échec (avec, s'il y en a eu, le coût et les jetons déjà consommés)
    erreur: (id, code, extra = {}) => majTour(id, "statut=in.(en_attente,en_cours)", {
      statut: "erreur", etape: null, code: String(code || "erreur").slice(0, 40), texte: extra.texte ?? null, ui_actions: JSON.stringify(extra.ui_actions || []),
      outils: JSON.stringify(extra.outils || []), usage: extra.usage ? JSON.stringify(extra.usage) : null, cout_eur: Number(extra.cout_eur) || 0,
      appels: extra.appels || 0, repli: !!extra.repli, refus: !!extra.refus, duree_ms: extra.duree_ms ?? null, finished_at: iso() }),
    // coût des appels déjà faits, sur un tour clos ailleurs (déclaré perdu, clôture refusée) : sans filtre de statut
    noterCout: (id, r) => majTour(id, "statut=in.(en_attente,en_cours,termine,erreur)", { cout_eur: Number(r.cout_eur) || 0,
      usage: r.usage ? JSON.stringify(r.usage) : null, appels: r.appels || 0, repli: !!r.repli, refus: !!r.refus }),
    async lire(id, odooId) {
      const n = entier(odooId);
      if (!UUID.test(String(id || "")) || !n) return null;
      const [r] = await sb(`chat_tours?id=eq.${id}&odoo_id=eq.${n}&select=${COLS_TOUR}&limit=1`) || [];
      return tour(r);
    },
    // fonction d'arrière-plan (appel authentifié par CRON_SECRET) : avec l'identité vérifiée par chat.js
    async lireServeur(id) {
      if (!UUID.test(String(id || ""))) return null;
      const [r] = await sb(`chat_tours?id=eq.${id}&select=${COLS_TOUR},ctx&limit=1`) || [];
      return tour(r);
    },
    async enCours(convId) {
      if (!UUID.test(String(convId || ""))) return [];
      return (await sb(`chat_tours?conversation_id=eq.${convId}&statut=in.(en_attente,en_cours)&select=${COLS_TOUR}`) || []).map(tour);
    },
    // admin (coûts par jour)
    lister: ({ depuisIso }) => tout(`chat_tours?created_at=gte.${enc(depuisIso)}&select=created_at,statut,cout_eur,repli,refus,code&order=created_at.asc`),
  };

  // ── Autorisations de téléchargement (duplicata, relevé) ──
  const fichiers = {
    async creer({ odoo_id, type, params, ttl_min = 15, usages_max = 3 }) {
      const n = entier(odoo_id);
      if (!n) throw new Error("fiche Odoo manquante");
      const id = crypto.randomBytes(16).toString("hex");
      await sb("chat_fichiers", { method: "POST", prefer: "return=minimal", body: {
        id, odoo_id: n, type: String(type), params: JSON.stringify(params ?? {}),
        expire_at: new Date(maintenant().getTime() + Math.max(1, ttl_min) * 60e3).toISOString(), usages: 0, usages_max: Math.max(1, usages_max) } });
      return id;
    },
    // compte un usage ; null si inconnu, d'une autre fiche, expiré ou épuisé (même réponse dans tous les cas)
    async consommer(id, odooId) {
      const n = entier(odooId);
      if (!HEX32.test(String(id || "")) || !n) return null;
      for (let i = 0; i < 3; i++) {
        const [r] = await sb(`chat_fichiers?id=eq.${id}&odoo_id=eq.${n}&select=id,odoo_id,type,params,expire_at,usages,usages_max&limit=1`) || [];
        if (!r || !(Date.parse(r.expire_at) > maintenant().getTime()) || r.usages >= r.usages_max) return null;
        const rows = await sb(`chat_fichiers?id=eq.${id}&odoo_id=eq.${n}&usages=eq.${r.usages}&select=id`, { method: "PATCH", prefer: "return=representation", body: { usages: r.usages + 1 } });
        if ((rows || []).length) return { id: r.id, odoo_id: r.odoo_id, type: r.type, params: lireJson(r.params, {}), usages: r.usages + 1, usages_max: r.usages_max };
      }
      return null;
    },
  };

  // ── Demandes (retours, transmissions) ──
  const demandes = {
    // → demande (avec son numéro R-2026-0412 / T-2026-0187) ; { doublon: true } si l'index unique refuse (transmission
    // ouverte de la même catégorie dans la conversation)
    async creer({ type, statut, categorie = null, conversation_id = null, odoo_id, pharmacie = null, admin_email = null, brouillon = {}, resume = null, expire_at = null, confirmee_at = null }) {
      const n = entier(odoo_id);
      if (!n) throw new Error("fiche Odoo manquante");
      let r;
      try {
        [r] = await sb(`chat_demandes?select=${COLS_DEMANDE}`, { method: "POST", prefer: "return=representation", body: {
          type, statut, ...(categorie ? { categorie: String(categorie).replace(/[^a-z_]/g, "").slice(0, 30) } : {}), conversation_id, odoo_id: n,
          pharmacie: pharmacie ? String(pharmacie).slice(0, 200) : null, admin_email,
          brouillon: JSON.stringify(brouillon ?? {}), resume: resume ? String(resume).slice(0, 2000) : null, expire_at, confirmee_at, updated_at: iso() } }) || [];
      } catch (e) {
        if (doublon(e)) return { doublon: true };
        throw e;
      }
      const numero = `${type === "retour" ? "R" : "T"}-${jourParis(r.created_at || maintenant()).slice(0, 4)}-${String(r.seq).padStart(4, "0")}`;
      const [m] = await sb(`chat_demandes?id=eq.${r.id}&select=${COLS_DEMANDE}`, { method: "PATCH", prefer: "return=representation", body: { numero } }) || [];
      return demande(m || { ...r, numero });
    },
    async lire(id, odooId) {
      const n = entier(odooId);
      if (!UUID.test(String(id || "")) || !n) return null;
      const [r] = await sb(`chat_demandes?id=eq.${id}&odoo_id=eq.${n}&select=${COLS_DEMANDE}&limit=1`) || [];
      return demande(r);
    },
    // transition conditionnelle : de (statut ou liste de statuts) → vers ; null si la demande n'était plus dans l'état attendu
    async passer(id, de, vers, extra = {}) {
      if (!UUID.test(String(id || ""))) return null;
      const champs = { ...extra, statut: vers, updated_at: iso() };
      if (champs.brouillon && typeof champs.brouillon !== "string") champs.brouillon = JSON.stringify(champs.brouillon);
      const [r] = await sb(`chat_demandes?id=eq.${id}&statut=in.${liste([de].flat())}&select=${COLS_DEMANDE}`, { method: "PATCH", prefer: "return=representation", body: champs }) || [];
      return demande(r);
    },
    // envoi interrompu (fonction coupée entre « confirmée » et l'envoi) : un seul repreneur, par une écriture conditionnelle
    // sur la date de mise à jour lue → demande reprise, ou null (déjà reprise ou envoyée entre-temps)
    async reprendre(id, updatedAt) {
      if (!UUID.test(String(id || "")) || !updatedAt) return null;
      const [r] = await sb(`chat_demandes?id=eq.${id}&statut=eq.confirmee&cible_ref=is.null&updated_at=eq.${enc(updatedAt)}&select=${COLS_DEMANDE}`,
        { method: "PATCH", prefer: "return=representation", body: { updated_at: iso() } }) || [];
      return demande(r);
    },
    // sans_cible + confirmee_avant : envois interrompus (confirmées sans cible depuis cette date)
    async lister({ statut, type, odoo_id, conversation_id, depuisIso, sans_cible = false, confirmee_avant = null, limite = 500 } = {}) {
      const f = [
        statut ? `statut=in.${liste([statut].flat())}` : null, type ? `type=eq.${type === "retour" ? "retour" : "transmission"}` : null,
        entier(odoo_id) ? `odoo_id=eq.${entier(odoo_id)}` : null, UUID.test(String(conversation_id || "")) ? `conversation_id=eq.${conversation_id}` : null,
        depuisIso ? `created_at=gte.${enc(depuisIso)}` : null, sans_cible ? "cible_ref=is.null" : null,
        confirmee_avant ? `confirmee_at=lt.${enc(confirmee_avant)}` : null,
      ].filter(Boolean);
      return (await sb(`chat_demandes?${f.join("&")}${f.length ? "&" : ""}select=${COLS_DEMANDE}&order=created_at.desc&limit=${Math.min(limite, 1000)}`) || []).map(demande);
    },
  };

  // ── Compteurs durables (quotas, budget) ──
  const depuis = (d) => `created_at=gte.${enc(d)}`;
  const somme = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.cout_eur) || 0), 0) * 1e6) / 1e6;
  const compter = {
    // messages de la pharmacie elle-même (ceux d'un admin en saisie Elixir comptent pour l'admin : messagesAdmin)
    messages: (odooId, depuisIso) => sb(`chat_tours?odoo_id=eq.${entier(odooId) || 0}&admin_email=is.null&${depuis(depuisIso)}&select=id`, { compter: true }),
    messagesAdmin: (admin, depuisIso) => sb(`chat_tours?admin_email=eq.${enc(admin)}&${depuis(depuisIso)}&select=id`, { compter: true }),
    fichiers: (odooId, depuisIso) => sb(`chat_fichiers?odoo_id=eq.${entier(odooId) || 0}&${depuis(depuisIso)}&select=id`, { compter: true }),
    demandes: (odooId, type, depuisIso, statuts = null) => sb(`chat_demandes?odoo_id=eq.${entier(odooId) || 0}&type=eq.${type === "retour" ? "retour" : "transmission"}&${depuis(depuisIso)}${statuts ? `&statut=in.${liste(statuts)}` : ""}&select=id`, { compter: true }),
    erreurs: (depuisIso) => sb(`chat_tours?statut=eq.erreur&${depuis(depuisIso)}&select=id`, { compter: true }),
    // somme des coûts des tours du jour « AAAA-MM-JJ » (heure de Paris)
    async coutJour(jourIso = jourParis(maintenant())) {
      const rows = await tout(`chat_tours?created_at=gte.${enc(debutJourParisIso(jourIso))}&created_at=lt.${enc(debutJourParisIso(jourSuivant(jourIso)))}&select=cout_eur`);
      return somme(rows);
    },
    // coût depuis une date : d'une pharmacie (ses propres messages), ou d'un admin en saisie Elixir (plafonds par fiche)
    async coutFiche(odooId, depuisIso) { return somme(await tout(`chat_tours?odoo_id=eq.${entier(odooId) || 0}&admin_email=is.null&${depuis(depuisIso)}&select=cout_eur`)); },
    async coutAdmin(admin, depuisIso) { return somme(await tout(`chat_tours?admin_email=eq.${enc(admin)}&${depuis(depuisIso)}&select=cout_eur`)); },
  };

  // ── Réglages (une ligne id = 1) ──
  const reglages = {
    async lire() {
      const [r] = await sb("chat_reglages?id=eq.1&select=valeur,updated_at&limit=1") || [];
      return { valeur: lireJson(r?.valeur, {}) || {}, updated_at: r?.updated_at ?? null };
    },
    // écriture si la version lue (updated_at) est toujours celle en base ; sinon { conflit, valeur, updated_at } en base
    async ecrire(valeur, base) {
      const champs = { valeur: JSON.stringify(valeur ?? {}), updated_at: iso() };
      const rows = base
        ? await sb(`chat_reglages?id=eq.1&updated_at=eq.${enc(base)}&select=valeur,updated_at`, { method: "PATCH", prefer: "return=representation", body: champs })
        : await sb("chat_reglages?on_conflict=id&select=valeur,updated_at", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { id: 1, ...champs } });
      if ((rows || []).length) return { ok: true, updated_at: rows[0].updated_at };
      return { conflit: true, ...(await reglages.lire()) };
    },
  };

  // ── Alertes (une seule par jour et par type) ──
  const alertes = {
    async marquer(jour, type) {
      const rows = await sb("chat_alertes?on_conflict=jour,type&select=jour", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { jour, type: String(type).slice(0, 40) } });
      return (rows || []).length > 0;
    },
    async oublier(jour, type) { await sb(`chat_alertes?jour=eq.${enc(jour)}&type=eq.${enc(type)}`, { method: "DELETE", prefer: "return=minimal" }); },
  };

  // ── Purge (chat-purge, quotidienne) : conversations et tours anciens, fichiers périmés, brouillons expirés ──
  async function purger({ avantIso }) {
    const n = (rows) => (rows || []).length;
    const brouillons = await sb(`chat_demandes?type=eq.retour&statut=eq.brouillon&expire_at=lt.${enc(iso())}&select=id`, { method: "PATCH", prefer: "return=representation", body: { statut: "expiree", updated_at: iso() } });
    const fich = await sb(`chat_fichiers?expire_at=lt.${enc(new Date(maintenant().getTime() - 86400e3).toISOString())}&select=id`, { method: "DELETE", prefer: "return=representation" });
    // les demandes sont gardées (dossier qualité) : leur lien vers la conversation passe à null (on delete set null)
    const conv = await sb(`chat_conversations?updated_at=lt.${enc(avantIso)}&select=id`, { method: "DELETE", prefer: "return=representation" });
    const trs = await sb(`chat_tours?created_at=lt.${enc(avantIso)}&statut=in.(termine,erreur)&select=id`, { method: "DELETE", prefer: "return=representation" });
    return { brouillons_expires: n(brouillons), fichiers: n(fich), conversations: n(conv), tours: n(trs) };
  }

  return { conversations, tours, fichiers, demandes, compter, reglages, alertes, purger };
}
