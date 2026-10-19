// Tests de l'API de l'Assistant Elixir (chat.js, chat-tour-background.js, chat-admin.js, chat-purge.js, _chat-stock.js) :
// node scripts/test-chat-api.mjs
// Hors ligne : faux PostgREST en mémoire (tables chat_*), identité réelle (_chat-perimetre.js) sur fausses données
// (Supabase Auth, elixir_pharmacies, Odoo), faux client Anthropic scripté, faux outils, faux Resend. Aucun appel réseau.
//  • sans jeton → 401 « reconnexion » (etat : disponible false) ; odoo_id du corps ignoré pour une pharmacie ;
//    admin + pour_odoo_id d'une fiche d'une autre société → 403 ; réponses avec CORS et no-store ;
//  • quotas → 429 avec CORS ; second message pendant un tour → 409 ; double lancement → tour joué une fois ;
//    tour perdu → conversation débloquée et historique réparé ; lancement impossible → 503 ;
//  • hôte d'aperçu → réponses fictives, aucun appel au modèle, aucune lecture ni écriture ;
//  • confirmation d'un retour sans IA, double clic = une demande ; l'événement est dit au modèle après le message suivant ;
//  • historique en ajout seulement (préfixe identique octet pour octet) ; placement des messages système ;
//  • admin : vues, transitions de statut, coûts par jour, réglages avec conflit ; purge.
import crypto from "node:crypto";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
process.env.CRON_SECRET = "secret-cron-test";
process.env.ADMIN_EMAIL = "equipe@elixir.test";
process.env.ODOO_URL = "https://odoo.test";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CHATBOT_ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

let ok = 0, ko = 0;
const eq = (label, got, exp) => { if (JSON.stringify(got) === JSON.stringify(exp)) ok++; else { ko++; console.log("✗", label, "→", JSON.stringify(got), "attendu", JSON.stringify(exp)); } };
const vrai = (label, v) => eq(label, !!v, true);

let T = Date.parse("2026-10-16T12:00:00Z");
const maintenant = () => new Date(T);

// ── Faux PostgREST (même doublure que scripts/test-chat-demandes.mjs) ──
function fauxPostgrest() {
  const tables = { chat_reglages: [], chat_conversations: [], chat_tours: [], chat_demandes: [], chat_fichiers: [], chat_alertes: [] };
  let seq = 0;
  const appels = [];
  const iso = () => new Date(T).toISOString();
  const SCHEMA = {
    chat_reglages: { defauts: () => ({ valeur: "{}", updated_at: iso() }), uniques: [r => String(r.id)] },
    chat_conversations: { defauts: () => ({ id: crypto.randomUUID(), cip: null, pharmacie: null, compte_email: null, admin_email: null, statut: "ouverte", messages: "[]",
      affichage: "[]", evenements_en_attente: "[]", nb_messages: 0, version: 0, created_at: iso(), updated_at: iso() }),
      uniques: [r => r.statut === "ouverte" ? `${r.odoo_id}|${r.admin_email || ""}` : null] },
    chat_tours: { defauts: () => ({ id: crypto.randomUUID(), admin_email: null, ctx: "{}", statut: "en_attente", etape: null, texte: null, ui_actions: "[]", outils: "[]",
      usage: null, cout_eur: 0, appels: 0, repli: false, refus: false, code: null, duree_ms: null, created_at: iso(), started_at: null, finished_at: null }),
      uniques: [r => ["en_attente", "en_cours"].includes(r.statut) ? r.conversation_id : null] },
    chat_demandes: { defauts: () => ({ id: crypto.randomUUID(), seq: ++seq, numero: null, conversation_id: null, pharmacie: null, admin_email: null, brouillon: "{}",
      resume: null, cible_ref: null, expire_at: null, created_at: iso(), confirmee_at: null, transmise_at: null, updated_at: iso(), erreur: null }),
      uniques: [r => r.type === "transmission" && r.conversation_id && ["confirmee", "transmise", "echec"].includes(r.statut) ? r.conversation_id : null, r => r.numero] },
    chat_fichiers: { defauts: () => ({ usages: 0, usages_max: 3, created_at: iso() }), uniques: [r => r.id] },
    chat_alertes: { defauts: () => ({ created_at: iso() }), uniques: [r => `${r.jour}|${r.type}`] },
  };
  const cmp = (a, b) => {
    if (a === null || a === undefined) return NaN;
    if (typeof a === "number") return a - Number(b);
    if (typeof a === "boolean") return String(a) === b ? 0 : 1;
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(a)) && !Number.isNaN(Date.parse(b))) return Date.parse(a) - Date.parse(b);
    return String(a) < b ? -1 : String(a) > b ? 1 : 0;
  };
  const SPECIAUX = new Set(["select", "order", "limit", "offset", "on_conflict"]);
  const correspond = (r, params) => [...params].every(([k, v]) => {
    if (SPECIAUX.has(k)) return true;
    const [op, ...reste] = v.split("."); const val = reste.join(".");
    if (op === "eq") return cmp(r[k], val) === 0;
    if (op === "neq") return cmp(r[k], val) !== 0;
    if (op === "gt") return cmp(r[k], val) > 0;
    if (op === "gte") return cmp(r[k], val) >= 0;
    if (op === "lt") return cmp(r[k], val) < 0;
    if (op === "lte") return cmp(r[k], val) <= 0;
    if (op === "is") return val === "null" ? r[k] === null || r[k] === undefined : String(r[k]) === val;
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").some(x => cmp(r[k], x) === 0);
    throw new Error(`filtre non pris en charge : ${k}=${v}`);
  });
  const projeter = (r, select) => select ? Object.fromEntries(select.split(",").map(c => [c, r[c] ?? null])) : { ...r };
  const doublon = (table, r) => (SCHEMA[table].uniques || []).some(f => { const k = f(r); return k != null && tables[table].some(x => x !== r && f(x) === k); });
  const reponse = (corps, status = 200, entetes = {}) => new Response(corps === null ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json", ...entetes } });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const methode = opts.method || "GET";
    const prefer = String(opts.headers?.Prefer || "");
    appels.push({ table, methode });
    if (opts.headers?.apikey !== "cle-service-test" || opts.headers?.Authorization !== "Bearer cle-service-test") return reponse({ message: "clé refusée" }, 401);
    if (!tables[table]) return reponse({ message: "table inconnue" }, 404);
    const p = u.searchParams, select = p.get("select");
    const rep = prefer.includes("return=representation");
    if (methode === "GET") {
      let rows = tables[table].filter(r => correspond(r, p));
      const total = rows.length;
      const o = p.get("order");
      if (o) { const [c, sens] = o.split("."); rows = [...rows].sort((a, b) => (cmp(a[c], String(b[c])) || 0) * (sens === "desc" ? -1 : 1)); }
      rows = rows.slice(Number(p.get("offset") || 0), p.get("limit") ? Number(p.get("offset") || 0) + Number(p.get("limit")) : undefined);
      if (prefer.includes("count=exact")) return reponse(rows.slice(0, 1).map(r => projeter(r, select)), 200, { "Content-Range": total ? `0-0/${total}` : "*/0" });
      return reponse(rows.map(r => projeter(r, select)));
    }
    if (methode === "POST") {
      const lignes = [JSON.parse(opts.body)].flat();
      const ajoutees = [];
      for (const l of lignes) {
        const r = { ...SCHEMA[table].defauts(), ...l };
        tables[table].push(r);
        if (doublon(table, r)) {
          tables[table].splice(tables[table].indexOf(r), 1);
          if (prefer.includes("resolution=ignore-duplicates")) continue;
          return reponse({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        }
        ajoutees.push(r);
      }
      return rep ? reponse(ajoutees.map(r => projeter(r, select)), 201) : reponse(null, 201);
    }
    if (methode === "PATCH") {
      const champs = JSON.parse(opts.body);
      const cibles = tables[table].filter(r => correspond(r, p));
      for (const r of cibles) {
        const avant = { ...r };
        Object.assign(r, champs);
        if (doublon(table, r)) { Object.assign(r, avant); return reponse({ code: "23505", message: "duplicate key" }, 409); }
      }
      return rep ? reponse(cibles.map(r => projeter(r, select))) : reponse(null, 204);
    }
    if (methode === "DELETE") {
      const cibles = tables[table].filter(r => correspond(r, p));
      tables[table] = tables[table].filter(r => !cibles.includes(r));
      if (table === "chat_conversations") {
        const ids = new Set(cibles.map(c => c.id));
        tables.chat_tours = tables.chat_tours.filter(t => !ids.has(t.conversation_id));
        for (const d of tables.chat_demandes) if (ids.has(d.conversation_id)) d.conversation_id = null;
      }
      return rep ? reponse(cibles.map(r => projeter(r, select))) : reponse(null, 204);
    }
    return reponse({ message: "méthode" }, 405);
  }
  return { tables, fetch, appels };
}
const db = fauxPostgrest();

// ── Identité : Supabase Auth, comptes du site, fiches Odoo (fausses) ──
const COMPTES = {
  "jeton-a": { id: "u-a", email: "compte@pharmacie-a.test", email_confirmed_at: "2026-07-07T10:00:00Z" },
  "jeton-b": { id: "u-b", email: "compte@pharmacie-b.test", email_confirmed_at: "2026-07-07T10:00:00Z" },
  "jeton-non-confirme": { id: "u-n", email: "compte@pharmacie-n.test", email_confirmed_at: null },
  "jeton-sans-fiche": { id: "u-s", email: "inconnu@pharmacie.test", email_confirmed_at: "2026-07-07T10:00:00Z" },
  "jeton-admin": { id: "u-admin", email: "equipe@elixir.test", email_confirmed_at: "2026-07-07T10:00:00Z", app_metadata: { role: "admin" } },
};
const PHARMACIES = [
  { email: "compte@pharmacie-a.test", odoo_id: 595, cip: "2000001" }, { email: "associe@pharmacie-a.test", odoo_id: 595, cip: "2000001" },
  { email: "compte@pharmacie-b.test", odoo_id: 777, cip: "2000002" }, { email: "compte@pharmacie-n.test", odoo_id: 888, cip: "2000003" },
];
const FICHES = {
  595: { id: 595, name: "PHARMACIE A", city: "Versailles", cip: "2000001", company_id: [2, "Elixir Pharma"] },
  777: { id: 777, name: "PHARMACIE B", city: "Paris", cip: "2000002", company_id: [2, "Elixir Pharma"] },
  999: { id: 999, name: "PHARMACIE D'UNE AUTRE SOCIÉTÉ", city: "Lyon", cip: "2000009", company_id: [3, "Autre société"] },
};
const PERIMETRE = {
  verifierJeton: async (j) => COMPTES[j] ? { id: COMPTES[j].id, email: COMPTES[j].email, isAdmin: COMPTES[j].app_metadata?.role === "admin" } : null,
  utilisateur: async (j) => COMPTES[j] || null,
  sb: async (path) => {
    const q = new URLSearchParams(path.split("?")[1]);
    if (!path.startsWith("elixir_pharmacies")) throw new Error(`lecture inattendue : ${path.split("?")[0]}`);
    const v = (k) => String(q.get(k) || "").replace(/^eq\./, "");
    return PHARMACIES.filter(p => (!q.get("email") || p.email === v("email")) && (!q.get("odoo_id") || String(p.odoo_id) === v("odoo_id")));
  },
  odoo: async (model, method, args) => {
    const dom = args[0] || [];
    if (model === "res.partner" && method === "search_read") {
      const id = dom.find(c => c[0] === "id")?.[2];
      const f = FICHES[id];
      return f && [2, false].includes(f.company_id ? f.company_id[0] : false) ? [f] : [];
    }
    if (model === "sale.order" && method === "search_count") return 0;
    throw new Error(`appel Odoo inattendu : ${model}.${method}`);
  },
};

// ── Réseau : tout appel non simulé échoue (aucune donnée réelle) ──
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith("https://supabase.test/auth/v1/user")) {   // verifyAdmin (auth.js) de chat-admin
    const j = String(opts.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return COMPTES[j] ? new Response(JSON.stringify(COMPTES[j]), { status: 200 }) : new Response("{}", { status: 401 });
  }
  if (url.startsWith("https://supabase.test/rest/v1/elixir_pharmacies")) return new Response("[]", { status: 200 });
  throw new Error(`appel réseau inattendu : ${opts.method || "GET"} ${url.split("?")[0]}`);
};

const { creerStock } = await import("../netlify/functions/_chat-stock.js");
const { oublierReglages, REGLAGES_DEFAUT } = await import("../netlify/functions/_chat-config.js");
const { verifierHistorique, TEXTES } = await import("../netlify/functions/_chat-moteur.js");
const { creerDemandes } = await import("../netlify/functions/_chat-demandes.js");
const { creerHandler: creerChat } = await import("../netlify/functions/chat.js");
const { creerHandler: creerTour } = await import("../netlify/functions/chat-tour-background.js");
const { creerHandler: creerAdmin } = await import("../netlify/functions/chat-admin.js");
const { creerHandler: creerPurge } = await import("../netlify/functions/chat-purge.js");
const stock = creerStock({ fetch: db.fetch, maintenant });   // SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY lues dans l'environnement

const reglages = (valeur) => { db.tables.chat_reglages = [{ id: 1, valeur: JSON.stringify(valeur), updated_at: new Date(T).toISOString() }]; oublierReglages(stock); };
const mails = [];
const envoyerMail = async (m) => { mails.push(m); return { sent: true }; };
const revaliderRetour = async (ctx, b) => ({ ok: true, brouillon: b });
const fabriqueDemandes = (d) => creerDemandes({ ...d, envoyerMail, revaliderRetour, fetch: async () => { throw new Error("aucun POST attendu"); }, secret: "s" });
const journaux = [];
const journal = (o) => journaux.push(o);

// ── Faux client Anthropic et faux outils ──
const script = [];
const appelsModele = [];
const client = { beta: { messages: { create: async (params) => {
  appelsModele.push(JSON.parse(JSON.stringify(params)));
  const r = script.shift();
  if (!r) throw Object.assign(new Error("plus de réponse scriptée"), { status: 500 });
  return typeof r === "function" ? r(params) : r;
} } } };
const USAGE = { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 4500, output_tokens: 80, cache_creation: null, iterations: null };
const rep = (stop_reason, content) => ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, content, usage: USAGE });
const BROUILLON = { reference_document: "INV/2026/50987", document: { numero: "EP/OUT/01234", date_sortie: "2026-10-14", picking_id: 41, picking_ids: [41], facture_ids: [9001] },
  lignes: [{ produit: "SPASFON LYOC 80 MG", cip: "3400930000001", product_id: 5, lot: "AB123", lot_id: 7, peremption: "2028-04-30", quantite: 2, quantite_max: 3 }],
  motif: "retour_erreur_pharmacie", souhait: "avoir", commentaire: null, hors_delai: false, limite_retour: "2026-10-25" };
const OUTILS_FAUX = Object.freeze([{ name: "preparer_demande_retour", strict: true, description: "Prépare un retour.", input_schema: { type: "object", additionalProperties: false, required: [], properties: {} } }]);
const outilsFaux = { OUTILS: OUTILS_FAUX, ETAPES: { preparer_demande_retour: "Je prépare le récapitulatif de votre demande…" },
  executerOutil: async (nom, entree, ctx, d) => {
    const { demande_id, expire_at } = await d.demandes.creerBrouillon(ctx, BROUILLON);
    return { contenu: { message: "Récapitulatif affiché." }, erreur: false, ui_actions: [{ type: "recap_retour", demande_id, expire_at, document: BROUILLON.document, lignes: BROUILLON.lignes, motif: "x", souhait: "y", info_delai: "z" }] };
  } };

// ── Fonctions ──
const lancements = [];
let lancementEnPanne = false;
const depsChat = { stock, versionOutils: "outils-test", maintenant, attendre: async (ms) => { T += ms; }, limiteIp: () => null, journal, perimetre: PERIMETRE,
  creerDemandes: fabriqueDemandes, lancer: async (event, id) => { lancements.push(id); return lancementEnPanne ? "HTTP 500" : null; } };
const chat = creerChat(depsChat);
const tourBg = creerTour({ stock, client, outils: outilsFaux, maintenant, journal, creerDemandes: fabriqueDemandes, envoyerMail, perimetre: PERIMETRE });
const nomsDemandes = [];
const admin = creerAdmin({ stock, maintenant, journal, nomsFiches: async (ids) => { nomsDemandes.push(ids); return ids.map(id => ({ odoo_id: id, nom: `PHARMACIE ${id}`, ville: null })); } });
const purge = creerPurge({ stock, maintenant, journal, envoyerMail });

const ORIGINE = "https://elixir-commande.expepharma.com";
const ev = (methode, { jeton, corps, q, host = "elixir-commande.expepharma.com", cron } = {}) => ({ httpMethod: methode,
  headers: { host, origin: ORIGINE, ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(cron ? { "x-cron-secret": cron } : {}) },
  queryStringParameters: q || {}, body: corps === undefined ? null : JSON.stringify(corps) });
const lit = (r) => { let corps = null; try { corps = r.body ? JSON.parse(r.body) : null; } catch { corps = r.body; } return { statut: r.statusCode, corps, entetes: r.headers || {} }; };
const post = async (jeton, corps, extra = {}) => lit(await chat(ev("POST", { jeton, corps, ...extra })));
const get = async (jeton, q, extra = {}) => lit(await chat(ev("GET", { jeton, q, ...extra })));
const lancer = (id, cron = "secret-cron-test") => tourBg(ev("POST", { corps: { tour: id }, cron }));
const corsNoStore = (r) => r.entetes["Access-Control-Allow-Origin"] === ORIGINE && r.entetes["Cache-Control"] === "no-store";
const convDb = (id) => db.tables.chat_conversations.find(c => c.id === id);
const messagesDe = (id) => JSON.parse(convDb(id).messages);

// ════════ Identité et disponibilité ════════
let r = await post(null, { action: "etat" });
eq("etat sans jeton : 200, indisponible, reconnexion (jamais 401)", [r.statut, r.corps], [200, { disponible: false, mode: null, raison: "reconnexion" }]);
r = await post(null, { action: "ouvrir" });
eq("ouvrir sans jeton : 401 reconnexion, CORS et no-store", [r.statut, r.corps.error, corsNoStore(r)], [401, "reconnexion", true]);
r = await get(null, { tour: crypto.randomUUID() });
eq("attente sans jeton : 401", r.statut, 401);
r = await post("jeton-non-confirme", { action: "ouvrir" });
eq("e-mail non confirmé : 401", r.statut, 401);
r = await post("jeton-sans-fiche", { action: "ouvrir" });
eq("compte sans fiche : 403 fiche, CORS", [r.statut, r.corps.error, corsNoStore(r)], [403, "fiche", true]);
r = await post("jeton-a", { action: "etat" });
eq("assistant éteint par défaut : inactif", r.corps, { disponible: false, mode: null, raison: "inactif" });
reglages({ actif: true, pilote: [] });
r = await post("jeton-a", { action: "etat" });
eq("pharmacie hors pilote", r.corps.raison, "hors_pilote");
r = await post("jeton-a", { action: "ouvrir" });
eq("hors pilote : ouvrir → 503 indisponible", [r.statut, r.corps.error], [503, "indisponible"]);
reglages({ actif: true, pilote: [595, 777], quotas: { messages_heure: 3 } });
r = await post("jeton-a", { action: "etat" });
const INFOS = { delai_annonce: REGLAGES_DEFAUT.delai_annonce, telephone: REGLAGES_DEFAUT.telephone, horaires: REGLAGES_DEFAUT.horaires, conservation_jours: REGLAGES_DEFAUT.conservation_jours };
eq("pharmacie du pilote : disponible, mode complet, coordonnées des réglages (barre latérale)", r.corps, { disponible: true, mode: "complet", raison: null, infos: INFOS });
r = await post("jeton-admin", { action: "etat", pour_odoo_id: 999 });
eq("admin, fiche d'une autre société : etat indisponible", r.corps.disponible, false);
r = await post("jeton-admin", { action: "ouvrir", pour_odoo_id: 999 });
eq("admin + pour_odoo_id d'une autre société → 403, CORS", [r.statut, r.corps.error, corsNoStore(r)], [403, "fiche", true]);
r = await post("jeton-admin", { action: "ouvrir" });
eq("admin sans pour_odoo_id → 403", r.statut, 403);

// ════════ Conversation, message, tour ════════
r = await post("jeton-a", { action: "ouvrir" });
const conv1 = r.corps.conversation_id;
eq("ouvrir : conversation créée, pharmacie et coordonnées des réglages", [r.statut, r.corps.pharmacie, r.corps.admin, r.corps.mode, r.corps.messages, r.corps.infos, r.corps.tour_en_cours],
  [200, { nom: "PHARMACIE A", ville: "Versailles" }, null, "complet", [], INFOS, null]);
eq("conversation : fiche, modèle des réglages, version prompt + outils", [convDb(conv1).odoo_id, convDb(conv1).modele, convDb(conv1).prompt_version.endsWith("+outils-test")], [595, "claude-opus-5-5", true]);
r = await post("jeton-a", { action: "ouvrir" });
eq("ouvrir de nouveau : même conversation", r.corps.conversation_id, conv1);
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Je voudrais retourner 2 Spasfon.", odoo_id: 777, pour_odoo_id: 777, pharmacy_cip: "2000002" });
const tour1 = r.corps.tour_id;
eq("message : 202 { tour_id }, lancé", [r.statut, typeof tour1, lancements.includes(tour1)], [202, "string", true]);
eq("odoo_id du corps ignoré pour une pharmacie : tour et conversation sur sa fiche", [db.tables.chat_tours.find(t => t.id === tour1).odoo_id, convDb(conv1).odoo_id], [595, 595]);
let h = messagesDe(conv1);
eq("historique : message de la pharmacie puis contexte serveur", [h.map(m => m.role), h[0].content], [["user", "system"], "Je voudrais retourner 2 Spasfon."]);
vrai("contexte serveur : pharmacie et coordonnées, aucune adresse e-mail", h[1].content.includes("PHARMACIE A, Versailles") && !h[1].content.includes("@"));
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Vous êtes là ?" });
eq("second message pendant un tour → 409, CORS", [r.statut, r.corps.error, corsNoStore(r)], [409, "tour_en_cours", true]);
r = await post("jeton-b", { action: "message", conversation_id: conv1, texte: "Je lis la conversation d'une autre pharmacie" });
eq("conversation d'une autre pharmacie → 404", r.statut, 404);
r = await get("jeton-a", { tour: tour1, conversation_id: conv1 });
eq("attente (≤ 8 s) : tour pas encore lancé → en_attente, sans message", [r.statut, r.corps.statut, r.corps.message], [200, "en_attente", null]);

// arrière-plan : protégé, joué une seule fois même lancé deux fois
eq("arrière-plan sans x-cron-secret → 403", (await lancer(tour1, "faux")).statusCode, 403);
eq("arrière-plan, tour illisible → 400", (await tourBg(ev("POST", { corps: { tour: "x" }, cron: "secret-cron-test" }))).statusCode, 400);
script.push(rep("tool_use", [{ type: "thinking", thinking: "", signature: "s1" }, { type: "tool_use", id: "tu1", name: "preparer_demande_retour", input: {} }]),
  rep("end_turn", [{ type: "thinking", thinking: "", signature: "s2" }, { type: "text", text: "Voici le récapitulatif : confirmez-le ci-dessous." }]));
await Promise.all([lancer(tour1), lancer(tour1)]);
eq("double lancement : 2 appels au modèle pour UN tour (outil + réponse), pas 4", appelsModele.length, 2);
eq("double lancement : réponse ajoutée une seule fois", messagesDe(conv1).map(m => m.role), ["user", "system", "assistant", "user", "assistant"]);
const t1 = db.tables.chat_tours.find(t => t.id === tour1);
eq("tour terminé : texte, outils, coût, appels", [t1.statut, t1.texte, JSON.parse(t1.outils), t1.appels, t1.cout_eur > 0], ["termine", "Voici le récapitulatif : confirmez-le ci-dessous.", ["preparer_demande_retour"], 2, true]);
eq("étape écrite pendant l'outil puis effacée", t1.etape, null);
r = await get("jeton-a", { tour: tour1, conversation_id: conv1 });
const recap = r.corps.message.ui_actions[0];
eq("attente : tour terminé, message et carte récapitulative", [r.corps.statut, r.corps.message.id, r.corps.message.texte, recap.type], ["termine", `a-${tour1}`, "Voici le récapitulatif : confirmez-le ci-dessous.", "recap_retour"]);
r = await get("jeton-b", { tour: tour1 });
eq("tour d'une autre pharmacie → 404", r.statut, 404);
eq("paramètres du modèle : système en cache 1 h, repli serveur, effort des réglages",
  [appelsModele[0].system[0].cache_control, appelsModele[0].fallbacks, appelsModele[0].betas, appelsModele[0].output_config], [{ type: "ephemeral", ttl: "1h" }, "default", ["server-side-fallback-2026-07-01"], { effort: "low" }]);

// ════════ Confirmation (sans IA), double clic ════════
const avantConfirmation = appelsModele.length;
r = await post("jeton-a", { action: "confirmer", conversation_id: conv1, demande_id: recap.demande_id, decision: "confirmer" });
eq("confirmer : carte « demande enregistrée » (simulation)", [r.statut, r.corps.message.ui_actions[0].type, r.corps.message.ui_actions[0].simulation], [200, "demande_enregistree", true]);
const numero = r.corps.message.ui_actions[0].numero;
r = await post("jeton-a", { action: "confirmer", conversation_id: conv1, demande_id: recap.demande_id, decision: "confirmer" });
eq("double clic : même demande, un seul e-mail à l'équipe, aucun appel au modèle", [r.corps.message.ui_actions[0].numero, mails.length, appelsModele.length - avantConfirmation], [numero, 1, 0]);
r = await post("jeton-b", { action: "confirmer", conversation_id: conv1, demande_id: recap.demande_id, decision: "confirmer" });
eq("confirmer depuis une autre pharmacie → 404", r.statut, 404);
const texteAvant = convDb(conv1).messages;

// tour suivant : l'événement est dit au modèle après le message de la pharmacie
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Merci, c'est bien enregistré ?" });
const tour2 = r.corps.tour_id;
h = messagesDe(conv1);
eq("événement de confirmation : message système juste après le message suivant", [h.at(-2).role, h.at(-1).role, h.at(-1).content.includes(`Événement vérifié par le serveur : Demande de retour ${numero} enregistrée`)], ["user", "system", true]);
eq("événements vidés une fois dits", convDb(conv1).evenements_en_attente, "[]");
vrai("historique en ajout seulement : texte précédent gardé octet pour octet", convDb(conv1).messages.startsWith(texteAvant.slice(0, -1)));
script.push(rep("end_turn", [{ type: "thinking", thinking: "", signature: "s3" }, { type: "text", text: "Oui, votre demande est enregistrée." }]));
await lancer(tour2);
const dernierAppel = appelsModele.at(-1);
eq("modèle : historique valide (placement des messages système)", verifierHistorique(dernierAppel.messages), null);
vrai("modèle : appel précédent = préfixe de l'appel suivant", JSON.stringify(dernierAppel.messages).startsWith(JSON.stringify(appelsModele[1].messages).slice(0, -1)));
eq("modèle : blocs de réflexion rejoués", dernierAppel.messages.filter(m => m.role === "assistant").flatMap(m => m.content).filter(b => b.type === "thinking").map(b => b.signature), ["s1", "s2"]);

// ════════ Quotas ════════
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Troisième message" });
const tour3 = r.corps.tour_id;
script.push(rep("end_turn", [{ type: "text", text: "Bien noté." }]));
await lancer(tour3);
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Quatrième message" });
eq("quota horaire (3) atteint → 429, CORS, message", [r.statut, r.corps.error, typeof r.corps.message, corsNoStore(r)], [429, "quota", "string", true]);
reglages({ actif: true, pilote: [595, 777], quotas: { messages_heure: 50, messages_jour: 50 } });

// ════════ Tour perdu, lancement impossible ════════
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Message dont la réponse se perd" });
const perdu = r.corps.tour_id;
T += 100_000;   // la fonction d'arrière-plan n'est jamais partie
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Je réessaie" });
const tour5 = r.corps.tour_id;
eq("tour perdu (> 90 s en attente) : conversation débloquée", [r.statut, db.tables.chat_tours.find(t => t.id === perdu).statut, db.tables.chat_tours.find(t => t.id === perdu).code], [202, "erreur", "interrompu"]);
h = messagesDe(conv1);
eq("tour perdu : réponse fixe insérée avant le nouveau message (ordre user → system → assistant gardé)", h.slice(-5).map(m => m.role), ["user", "system", "assistant", "user", "system"]);
eq("historique réparé valide", verifierHistorique(h), null);
const appelsAvant = appelsModele.length;
await lancer(perdu);
eq("lancement tardif du tour perdu : rien n'est joué", appelsModele.length, appelsAvant);
script.push(rep("end_turn", [{ type: "text", text: "Me revoici." }]));
await lancer(tour5);
lancementEnPanne = true;
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Lancement en panne" });
lancementEnPanne = false;
const enPanne = db.tables.chat_tours.at(-1);
eq("lancement impossible : 503, tour en erreur, réponse fixe dans l'historique", [r.statut, r.corps.error, enPanne.statut, messagesDe(conv1).at(-1).role], [503, "indisponible", "erreur", "assistant"]);
r = await get("jeton-a", { tour: enPanne.id });
eq("attente d'un tour en erreur : message d'erreur avec le téléphone", [r.corps.statut, r.corps.message.texte.includes(REGLAGES_DEFAUT.telephone)], ["erreur", true]);

// ════════ Hôte d'aperçu ════════
const lecturesAvant = db.appels.length, modeleAvant = appelsModele.length;
const APERCU = { host: "deploy-preview-12--commandes-elixir.netlify.app" };
const a1 = await post("jeton-a", { action: "etat" }, APERCU);
const a2 = await post(null, { action: "ouvrir" }, APERCU);
const a3 = await post("jeton-a", { action: "message", conversation_id: "apercu", texte: "Bonjour" }, APERCU);
const a4 = await get("jeton-a", { tour: "apercu" }, APERCU);
const a5 = await post("jeton-a", { action: "confirmer", conversation_id: "apercu", demande_id: "x", decision: "confirmer" }, APERCU);
eq("aperçu : réponses fictives", [a1.corps.disponible, a2.corps.conversation_id, a3.statut, a3.corps.message.texte.startsWith("Aperçu"), a4.corps.statut, a5.corps.message.ui_actions[0].simulation],
  [true, "apercu", 202, true, "termine", true]);
eq("aperçu : aucune lecture ni écriture, aucun appel au modèle, aucun lancement", [db.appels.length - lecturesAvant, appelsModele.length - modeleAvant, lancements.includes("apercu")], [0, 0, false]);

// ════════ Budget du jour ════════
db.tables.chat_tours.push({ id: crypto.randomUUID(), conversation_id: crypto.randomUUID(), odoo_id: 1, statut: "termine", cout_eur: 8.5, created_at: new Date(T).toISOString(), repli: false, refus: false });
r = await post("jeton-a", { action: "etat" });
eq("budget du jour atteint : indisponible (budget)", r.corps, { disponible: false, mode: null, raison: "budget" });
r = await post("jeton-a", { action: "message", conversation_id: conv1, texte: "Encore une question" });
eq("budget atteint : message → 503 avec téléphone", [r.statut, r.corps.message.includes(REGLAGES_DEFAUT.telephone)], [503, true]);
r = await post("jeton-a", { action: "ouvrir" });
eq("budget atteint : l'historique reste consultable", [r.statut, r.corps.conversation_id], [200, conv1]);
db.tables.chat_tours.pop();

// ════════ Nouvelle conversation, changement de prompt, saisie Elixir ════════
r = await post("jeton-a", { action: "ouvrir" });
eq("ouvrir : affichage de la conversation (textes visibles seulement)", [r.corps.messages.every(m => ["pharmacie", "assistant"].includes(m.role) && typeof m.texte === "string"), JSON.stringify(r.corps.messages).includes("thinking"), "outils" in r.corps.messages.at(-1)], [true, false, false]);
r = await post("jeton-a", { action: "nouvelle", conversation_id: conv1 });
const conv2 = r.corps.conversation_id;
eq("nouvelle : autre conversation, la précédente est close", [conv2 !== conv1, convDb(conv1).statut, r.corps.messages], [true, "close", []]);
const chatV2 = creerChat({ ...depsChat, versionOutils: "outils-test-v2" });
r = lit(await chatV2(ev("POST", { jeton: "jeton-a", corps: { action: "ouvrir", conversation_id: conv2 } })));
eq("outils ou prompt changés : nouvelle conversation (l'historique n'est jamais réécrit)", [r.corps.conversation_id !== conv2, convDb(conv2).statut], [true, "close"]);
r = await post("jeton-admin", { action: "ouvrir", pour_odoo_id: 777 });
const convAdmin = r.corps.conversation_id;
const rb = await post("jeton-b", { action: "ouvrir" });
eq("saisie Elixir : conversation propre à l'admin, distincte de celle de la pharmacie", [r.corps.admin, r.corps.pharmacie.nom, convAdmin !== rb.corps.conversation_id, convDb(convAdmin).admin_email], ["equipe@elixir.test", "PHARMACIE B", true, "equipe@elixir.test"]);
r = await post("jeton-b", { action: "message", conversation_id: convAdmin, texte: "Je prends la conversation de l'admin" });
eq("pharmacie sur la conversation de l'admin → 404", r.statut, 404);

// ════════ Outils réels du lot 1 : préfixe identique (outils passés tels quels) ════════
// conversation ouverte avant un déploiement (version « outils-test ») : le message est refusé proprement
const chatReel = creerChat({ ...depsChat, versionOutils: undefined });
r = lit(await chatReel(ev("POST", { jeton: "jeton-b", corps: { action: "message", conversation_id: rb.corps.conversation_id, texte: "Bonjour" } })));
eq("prompt ou outils changés depuis l'ouverture : 503 « mis à jour », conversation close", [r.statut, r.corps.message.includes("mis à jour"), convDb(rb.corps.conversation_id).statut], [503, true, "close"]);
try {
  const vrais = await import("../netlify/functions/_chat-outils.js");
  const bgReel = creerTour({ stock, client, maintenant, journal, creerDemandes: fabriqueDemandes, envoyerMail, perimetre: PERIMETRE });
  const o = lit(await chatReel(ev("POST", { jeton: "jeton-b", corps: { action: "ouvrir" } })));
  r = lit(await chatReel(ev("POST", { jeton: "jeton-b", corps: { action: "message", conversation_id: o.corps.conversation_id, texte: "Bonjour" } })));
  script.push(rep("end_turn", [{ type: "text", text: "Bonjour, que puis-je faire pour vous ?" }]));
  await bgReel(ev("POST", { corps: { tour: r.corps.tour_id }, cron: "secret-cron-test" }));
  eq("outils du lot 1 passés tels quels (OUTILS, ordre et octets)", JSON.stringify(appelsModele.at(-1).tools), JSON.stringify(vrais.OUTILS));
  // déploiement entre le message et le tour : le tour échoue proprement, sans appel au modèle
  r = lit(await chatReel(ev("POST", { jeton: "jeton-b", corps: { action: "message", conversation_id: o.corps.conversation_id, texte: "Et ma commande ?" } })));
  convDb(o.corps.conversation_id).prompt_version = "ancienne+outils-x";
  const n = appelsModele.length;
  await bgReel(ev("POST", { corps: { tour: r.corps.tour_id }, cron: "secret-cron-test" }));
  const tv = db.tables.chat_tours.find(t => t.id === r.corps.tour_id);
  eq("version changée entre le message et le tour : tour en erreur, aucun appel, historique terminé par une réponse",
    [tv.statut, tv.code, appelsModele.length - n, JSON.parse(convDb(o.corps.conversation_id).messages).at(-1).role], ["erreur", "version", 0, "assistant"]);
} catch (e) {
  console.log("(outils du lot 1 non chargés :", e.message, ")");
}

// ════════ Admin ════════
const adm = async (jeton, { q, corps } = {}) => lit(await admin(ev(corps ? "POST" : "GET", { jeton, q, corps })));
r = await adm(null, { q: { vue: "conversations" } });
eq("admin sans jeton → 403, CORS, no-store", [r.statut, corsNoStore(r)], [403, true]);
r = await adm("jeton-a", { q: { vue: "conversations" } });
eq("admin : jeton de pharmacie → 403", r.statut, 403);
r = await adm("jeton-admin", { q: { vue: "conversations", jours: "30" } });
const ligneConv = r.corps.conversations.find(c => c.id === conv1);
eq("admin conversations : champs du contrat", Object.keys(ligneConv), ["id", "odoo_id", "pharmacie", "admin_email", "statut", "nb_messages", "created_at", "updated_at"]);
eq("admin conversations : nombre de messages écrits", [ligneConv.nb_messages, ligneConv.pharmacie], [6, "PHARMACIE A"]);
r = await adm("jeton-admin", { q: { vue: "conversation", id: conv1 } });
const premierAssistant = r.corps.messages.find(m => m.role === "assistant");
eq("admin conversation : textes visibles et outils appelés, jamais réflexion ni appels d'outils",
  [Object.keys(r.corps.conversation), premierAssistant.outils, /"(thinking|tool_use|tool_result|signature)"/.test(JSON.stringify(r.corps.messages))],
  [["id", "odoo_id", "pharmacie", "admin_email", "modele", "statut", "created_at"], ["preparer_demande_retour"], false]);
r = await adm("jeton-admin", { q: { vue: "conversation", id: crypto.randomUUID() } });
eq("admin conversation inconnue → 404", r.statut, 404);
r = await adm("jeton-admin", { q: { vue: "demandes" } });
const dem = r.corps.demandes.find(x => x.numero === numero);
eq("admin demandes : brouillon lu en objet, champs du contrat", [typeof dem.brouillon, dem.brouillon.document.numero, dem.statut, dem.type, Object.keys(dem).length], ["object", "EP/OUT/01234", "confirmee", "retour", 14]);
r = await adm("jeton-admin", { q: { vue: "demandes", statut: "transmise" } });
eq("admin demandes filtrées par statut", r.corps.demandes.length, 0);
r = await adm("jeton-admin", { corps: { action: "demande_statut", id: dem.id, statut: "traitee" } });
eq("admin : demande traitée", [r.statut, r.corps], [200, { ok: true }]);
r = await adm("jeton-admin", { corps: { action: "demande_statut", id: dem.id, statut: "traitee" } });
eq("admin : changement rejoué → 409", r.statut, 409);
r = await adm("jeton-admin", { corps: { action: "demande_statut", id: dem.id, statut: "brouillon" } });
eq("admin : statut non autorisé → 400", r.statut, 400);
r = await adm("jeton-admin", { q: { vue: "couts", jours: "7" } });
const jour = r.corps.jours.at(-1);
eq("admin coûts : 7 jours, aujourd'hui compté (tours, erreurs)", [r.corps.budget_jour_eur, r.corps.jours.length, jour.jour, jour.tours > 0, jour.erreurs >= 2, jour.cout_eur > 0], [8, 7, "2026-10-16", true, true, true]);
r = await adm("jeton-admin", { q: { vue: "reglages" } });
const base = r.corps.updated_at;
eq("admin réglages : valeur fusionnée avec les défauts", [r.corps.valeur.actif, r.corps.valeur.pilote, r.corps.valeur.telephone, r.corps.valeur.quotas.messages_heure], [true, [595, 777], REGLAGES_DEFAUT.telephone, 50]);
eq("admin réglages : modèles acceptés (sans Haiku) et noms des fiches du pilote", [r.corps.modeles, r.corps.pilote_fiches, nomsDemandes.at(-1)],
  [["claude-opus-5-5", "claude-sonnet-5-5"], [{ odoo_id: 595, nom: "PHARMACIE 595", ville: null }, { odoo_id: 777, nom: "PHARMACIE 777", ville: null }], [595, 777]]);
{
  const enPanne = creerAdmin({ stock, maintenant, journal, nomsFiches: async () => { throw new Error("Odoo injoignable"); } });
  const rp = lit(await enPanne(ev("GET", { jeton: "jeton-admin", q: { vue: "reglages" } })));
  eq("admin réglages : Odoo injoignable → réglages lus quand même, sans noms", [rp.statut, rp.corps.pilote_fiches, rp.corps.valeur.actif], [200, [], true]);
}
r = await adm("jeton-admin", { corps: { action: "reglages", valeur: { ...r.corps.valeur, modele: "claude-haiku-5-5" }, base } });
eq("admin réglages invalides → 400 avec erreurs", [r.statut, Array.isArray(r.corps.erreurs)], [400, true]);
T += 1000;
r = await adm("jeton-admin", { corps: { action: "reglages", valeur: { ...REGLAGES_DEFAUT, actif: true, pilote: [595], budget_jour_eur: 10 }, base } });
eq("admin réglages enregistrés", [r.statut, r.corps.ok, typeof r.corps.updated_at], [200, true, "string"]);
r = await adm("jeton-admin", { corps: { action: "reglages", valeur: { ...REGLAGES_DEFAUT, actif: false }, base } });
eq("admin réglages modifiés ailleurs entre-temps → 409 conflit avec la version en base", [r.statut, r.corps.conflit, r.corps.valeur.budget_jour_eur], [409, true, 10]);
{
  const avant = JSON.stringify(db.tables.chat_reglages);
  const rp = lit(await admin(ev("POST", { jeton: "jeton-admin", host: "assistant-elixir--commandes-elixir.netlify.app", corps: { action: "reglages", valeur: { ...REGLAGES_DEFAUT, actif: false }, base: null } })));
  eq("admin sur un hôte d'aperçu : aucune écriture (403)", [rp.statut, JSON.stringify(db.tables.chat_reglages) === avant], [403, true]);
}
r = await adm("jeton-admin", { q: { vue: "inconnue" } });
eq("admin vue inconnue → 400", r.statut, 400);

// ════════ Purge ════════
const vieille = { id: crypto.randomUUID(), odoo_id: 595, statut: "close", messages: "[]", affichage: "[]", evenements_en_attente: "[]", nb_messages: 1, version: 0,
  modele: "claude-opus-5-5", prompt_version: "x", created_at: "2026-06-01T10:00:00Z", updated_at: "2026-06-01T10:00:00Z" };
db.tables.chat_conversations.push(vieille);
db.tables.chat_tours.push({ id: crypto.randomUUID(), conversation_id: vieille.id, odoo_id: 595, statut: "termine", cout_eur: 0.02, created_at: "2026-06-01T10:00:00Z" });
db.tables.chat_demandes.push({ id: crypto.randomUUID(), seq: 900, numero: "R-2026-0900", type: "retour", statut: "confirmee", conversation_id: vieille.id, odoo_id: 595, brouillon: "{}", created_at: "2026-06-01T10:00:00Z" });
db.tables.chat_demandes.push({ id: crypto.randomUUID(), seq: 901, numero: "R-2026-0901", type: "retour", statut: "brouillon", conversation_id: conv1, odoo_id: 595, brouillon: "{}", expire_at: "2026-10-16T11:00:00Z", created_at: "2026-10-16T10:30:00Z" });
db.tables.chat_fichiers.push({ id: "a".repeat(32), odoo_id: 595, type: "facture", params: "{}", expire_at: "2026-10-01T10:00:00Z", usages: 0, usages_max: 3, created_at: "2026-10-01T09:45:00Z" });
r = lit(await purge());
eq("purge : conversation de plus de 90 jours et ses tours supprimés, brouillon expiré, fichier périmé",
  [r.statut, r.corps.conversations, r.corps.tours >= 0, r.corps.brouillons_expires, r.corps.fichiers, !!convDb(vieille.id), db.tables.chat_tours.some(t => t.conversation_id === vieille.id)], [200, 1, true, 1, 1, false, false]);
eq("purge : demandes gardées (dossier qualité), lien de conversation à null", db.tables.chat_demandes.find(x => x.numero === "R-2026-0900")?.conversation_id, null);
eq("purge : conversations récentes gardées", !!convDb(conv1), true);

// ════════ Journal ════════
const j = JSON.stringify(journaux);
eq("journal : jamais le texte des messages ni de réponse, ni d'adresse e-mail", ["Spasfon", "Bien noté", "compte@pharmacie-a.test", "PHARMACIE A"].map(s => j.includes(s)), [false, false, false, false]);

// ════════ Stockage : clé serveur obligatoire ════════
let erreurCle = null;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const stockSansCle = creerStock({ fetch: db.fetch });
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service-test";
try { await stockSansCle.conversations.ouverte(595, null); } catch (e) { erreurCle = e; }
eq("stock sans SUPABASE_SERVICE_ROLE_KEY : erreur claire", [erreurCle?.code, /SUPABASE_SERVICE_ROLE_KEY/.test(erreurCle?.message || "")], ["configuration", true]);
const sansCle = creerChat({ ...depsChat, stock: stockSansCle });
r = lit(await sansCle(ev("POST", { jeton: "jeton-a", corps: { action: "ouvrir" } })));
eq("chat sans clé serveur : 503, CORS", [r.statut, corsNoStore(r)], [503, true]);
void TEXTES;

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
