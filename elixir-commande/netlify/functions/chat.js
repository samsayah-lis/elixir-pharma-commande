// ── Assistant Elixir : API de la conversation (docs/assistant-contrat.md, « API HTTP ») ──
// POST { action: "etat" }                                   → { disponible, mode, raison, infos?, ouvert? } (jamais 401)
// POST { action: "ouvrir", conversation_id? }               → conversation ouverte (reprise ou créée) et son affichage
// POST { action: "message", conversation_id, texte, contexte?: { commande_site_id } } → 202 { tour_id }
//      · 409 { error: "tour_en_cours", tour_id } · 410 { error: "conversation_fermee", message } (fermée ailleurs, ou
//      assistant mis à jour : le panneau en ouvre une nouvelle) · 429 quota (messages, coût du jour de la fiche) · 503
// GET  ?tour=<id>&conversation_id=<id>                      → attente (≤ 8 s) : { statut, etape, message }
// POST { action: "confirmer", conversation_id, demande_id, decision: "confirmer" | "annuler" } → { message } (sans IA)
// POST { action: "nouvelle", conversation_id? }             → ferme la conversation ouverte, en ouvre une autre
// Identité : jeton vérifié par identifier() (_chat-perimetre.js) ; admin « pour une pharmacie » : admin_token +
// pour_odoo_id, revalidé dans Odoo. Aucun autre identifiant venu du navigateur n'est lu.
// Le tour (appels au modèle et outils) tourne dans chat-tour-background (lancé comme gp-upload → gp-extract-background,
// avec x-cron-secret) ; un seul tour actif par conversation (index unique, sinon 409).
// Quotas comptés en base (chat_tours), budget du jour (global et par fiche), interrupteur des réglages. Limite de débit
// par IP et par famille d'actions (l'attente d'un tour interroge souvent) ; identité gardée 60 s par jeton pour l'attente
// et l'état (lectures seules : ni Odoo ni Supabase Auth à chaque interrogation). Hôte d'aperçu : réponses fictives,
// aucun appel au modèle, aucune écriture, aucun e-mail. Réponses : CORS de cors.js, no-store, JSON, y compris les erreurs.
import { createHash } from "node:crypto";
import { getCors } from "./cors.js";
import { clientIp } from "./rate-limit.js";
import { creerStock, ajouterAuTexte } from "./_chat-stock.js";
import { REGLAGES_DEFAUT, lireReglages, raisonFermeture, journalJson, jourParis, debutJourParisIso } from "./_chat-config.js";
import { PROMPT_VERSION, messageContexte } from "./_chat-systeme.js";
import { reparerFin, TEXTES } from "./_chat-moteur.js";
import { creerDemandes } from "./_chat-demandes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APERCU = /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/;
const SITE_HOSTS = ["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"];
const ACTIONS = new Set(["etat", "ouvrir", "message", "confirmer", "nouvelle"]);
const MAX_TEXTE = 2000;
const MAX_MESSAGES_CONVERSATION = 30;
const ATTENTE_MAX_MS = 8_000, PAS_MS = 500;
// au-delà, un tour non terminé est considéré comme perdu (tour borné à 90 s ; lancement en quelques secondes)
const PERIME_ATTENTE_MS = 90_000, PERIME_COURS_MS = 150_000;
const HEURE = 3600e3, JOUR = 86400e3;
// requête synchrone : plafond de 10 s d'une fonction Netlify ; lancement du tour et envois bornés à cette échéance
const ECHEANCE_MS = 8_500;
const FERMEE = "Cette conversation est terminée (nouvelle conversation ouverte ailleurs, ou assistant mis à jour) : une nouvelle conversation s'ouvre.";

// Limite de débit par instance, par IP et par famille d'actions : [requêtes, fenêtre en secondes]. Une officine partage
// souvent une IP entre plusieurs postes : l'attente (long-poll, ~1 requête toutes les 1 à 8 s par panneau ouvert) a la sienne.
const DEBITS = { attendre: [150, 60], etat: [40, 60], autre: [30, 60] };
function limiteDebit(compteurs, event, famille) {
  const [max, fenetre] = DEBITS[famille] || DEBITS.autre;
  const cle = `${famille}|${clientIp(event)}`, t = Date.now();
  let e = compteurs.get(cle);
  if (!e || t > e.fin) {
    if (compteurs.size > 5000) for (const [k, v] of compteurs) if (t > v.fin) compteurs.delete(k);
    e = { n: 0, fin: t + fenetre * 1000 };
    compteurs.set(cle, e);
  }
  if (++e.n <= max) return null;
  return { statusCode: 429, headers: { "Retry-After": String(Math.ceil((e.fin - t) / 1000)) },
    body: JSON.stringify({ error: "quota", message: "Trop de requêtes en peu de temps : réessayez dans quelques secondes." }) };
}

// Identité gardée 60 s par empreinte du jeton (et fiche demandée par un admin) pour l'attente et l'état : lectures seules,
// répétées pendant un tour. Les actions qui écrivent (message, confirmation, ouverture) revérifient toujours l'identité.
const IDENTITE_MS = 60_000;
const cleIdentite = (event, pour) => {
  const h = event?.headers || {};
  const jeton = String(h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  return jeton ? `${createHash("sha256").update(jeton).digest("hex")}|${pour ?? ""}` : null;
};

export const estApercu = (event) => APERCU.test(String(event?.headers?.host || event?.headers?.Host || "").toLowerCase());
const json = (cors, statusCode, corps) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(corps) });
const siteBase = (event) => { const h = String(event?.headers?.host || "").toLowerCase();
  return `https://${SITE_HOSTS.includes(h) ? h : SITE_HOSTS[0]}`; };
// MessageAffiche du contrat (les champs internes, comme la liste des outils, restent côté admin)
const affichable = (m) => ({ id: String(m.id), role: m.role === "pharmacie" ? "pharmacie" : "assistant", texte: String(m.texte ?? ""),
  ui_actions: Array.isArray(m.ui_actions) ? m.ui_actions : [], at: m.at });
// textes des réglages affichés par le panneau (contact, délai, durée de conservation annoncée dans « Vos données »)
const infosDe = (r) => ({ delai_annonce: r.delai_annonce, telephone: r.telephone, horaires: r.horaires, conservation_jours: r.conservation_jours });

// Lancement de la fonction d'arrière-plan → null si elle est partie, sinon la raison de l'échec ; ms : temps restant
// avant l'échéance de la requête (la réponse 202 doit parvenir au navigateur)
async function lancerTour(event, tourId, ms = 8_000) {
  if (!process.env.CRON_SECRET) return "CRON_SECRET absent";
  try {
    const r = await fetch(`${siteBase(event)}/.netlify/functions/chat-tour-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
      body: JSON.stringify({ tour: tourId }), signal: AbortSignal.timeout(Math.max(1000, Math.min(8_000, ms))),
    });
    return r.ok || r.status === 202 ? null : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "délai dépassé" : "injoignable";
  }
}

// Hôte d'aperçu (fonctions branchées sur la production) : rien n'est lu ni écrit, aucun appel au modèle
function apercu(cors, action, body) {
  const at = new Date().toISOString();
  const infos = infosDe(REGLAGES_DEFAUT);
  const fictive = { id: "a-apercu", role: "assistant", at, ui_actions: [],
    texte: "Aperçu : réponse fictive. Sur le site en ligne, l'assistant consulte ici les factures et commandes Elixir de la pharmacie." };
  switch (action) {
    case "etat": return json(cors, 200, { disponible: true, mode: "complet", raison: null, infos });
    case "ouvrir": case "nouvelle":
      return json(cors, 200, { conversation_id: "apercu", pharmacie: { nom: "Pharmacie d'aperçu", ville: null }, admin: null, mode: "complet",
        messages: [], infos, tour_en_cours: null, apercu: true });
    case "message": return json(cors, 202, { tour_id: "apercu", message: fictive });
    case "attendre": return json(cors, 200, { statut: "termine", etape: null, message: fictive });
    case "confirmer": return json(cors, 200, { message: body.decision === "annuler"
      ? { id: "d-apercu", role: "assistant", texte: "Demande annulée : rien n'a été envoyé.", ui_actions: [], at }
      : { id: "d-apercu", role: "assistant", texte: "Aperçu : demande fictive, rien n'a été envoyé.", at,
        ui_actions: [{ type: "demande_enregistree", numero: "R-APERCU", date: jourParis(), delai: infos.delai_annonce, email_masque: null, simulation: true }] } });
    default: return json(cors, 400, { error: "action" });
  }
}

// deps (doublures des tests) : stock, identifier, versionOutils, lancer, maintenant, attendre, creerDemandes,
// perimetre (deps de _chat-perimetre), limiteIp(event, famille), journal, horloge (heure réelle, ms : échéances)
export function creerHandler(deps = {}) {
  let stockDefaut = null;   // un stock par instance : le cache des réglages (60 s) sert d'un appel à l'autre
  const stockDe = () => deps.stock || (stockDefaut ||= creerStock());
  const maintenant = deps.maintenant || (() => new Date());
  const attendre = deps.attendre || ((ms) => new Promise(ok => setTimeout(ok, ms)));
  const journal = deps.journal || journalJson;
  const identifier = async (...a) => (deps.identifier || (await import("./_chat-perimetre.js")).identifier)(...a);
  // définitions seules (_chat-outils-liste.js, sans Zod ni relevé) : le paquet de chat.js reste léger
  const versionOutils = async () => deps.versionOutils ?? (await import("./_chat-outils-liste.js")).VERSION_OUTILS;
  const lancer = deps.lancer || lancerTour;
  const horloge = deps.horloge || Date.now;
  const compteurs = new Map(), identites = new Map();   // par instance de la fonction (débit par IP, identités gardées 60 s)

  return async (event) => {
    const debut = maintenant().getTime();   // l'attente d'un tour compte depuis le début de la requête (plafond Netlify de 10 s)
    const echeance = horloge() + ECHEANCE_MS;   // heure réelle : lancement du tour, envois d'une confirmation
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(cors, 405, { error: "methode" });
    let body = {};
    if (event.httpMethod === "POST") {
      try { body = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "requete" }); }
      if (typeof body !== "object" || Array.isArray(body)) return json(cors, 400, { error: "requete" });
    }
    const q = event.queryStringParameters || {};
    const action = event.httpMethod === "GET" ? "attendre" : String(body.action || "");
    if (action !== "attendre" && !ACTIONS.has(action)) return json(cors, 400, { error: "action" });
    if (estApercu(event)) return apercu(cors, action, body);
    const famille = action === "attendre" || action === "etat" ? action : "autre";
    const limite = deps.limiteIp ? deps.limiteIp(event, famille) : limiteDebit(compteurs, event, famille);
    if (limite) return { ...limite, headers: { ...cors, ...(limite.headers || {}), "Content-Type": "application/json", "Cache-Control": "no-store" } };

    // ── Identité : seul pour_odoo_id (admin) est transmis, jamais un autre identifiant du navigateur ──
    let ctx;
    const pour = body.pour_odoo_id ?? q.pour_odoo_id ?? null;
    const cle = action === "attendre" || action === "etat" ? cleIdentite(event, pour) : null;
    const garde = cle && identites.get(cle);
    try {
      if (garde && garde.fin > horloge()) ctx = garde.ctx;
      else {
        ctx = await identifier(event, { pour_odoo_id: pour }, deps.perimetre || {});
        if (cle) {
          if (identites.size > 2000) for (const [k, v] of identites) if (v.fin <= horloge()) identites.delete(k);
          identites.set(cle, { ctx, fin: horloge() + IDENTITE_MS });
        }
      }
    } catch (e) {
      const statut = e?.status === 401 ? 401 : e?.status === 403 ? 403 : 503;
      journal({ evt: "http", action, code: e?.code || `identite_${statut}` });
      if (action === "etat") {
        // session sans jeton valide (ancien mode, renouvellement impossible) : « reconnexion » ; ouvert : l'assistant est
        // ouvert à toutes les pharmacies, le bouton s'affiche alors avec l'encart « Me reconnecter » (pendant le pilote, non)
        let ouvert = false;
        if (statut === 401) { try { const r = await lireReglages({ stock: stockDe(), maintenant }); ouvert = r.actif && r.ouvert_a_tous; } catch { /* réglages illisibles */ } }
        return json(cors, 200, { disponible: false, mode: null, raison: statut === 401 ? "reconnexion" : null, ...(ouvert ? { ouvert: true } : {}) });
      }
      if (statut === 401) return json(cors, 401, { error: "reconnexion" });
      if (statut === 403) return json(cors, 403, { error: "fiche" });
      return json(cors, 503, { error: "indisponible", message: "Vérification de votre compte impossible pour le moment : réessayez dans quelques minutes." });
    }

    const stock = stockDe();
    try {
      const r = await lireReglages({ stock, maintenant });
      const fermee = raisonFermeture(ctx, r);
      const budgetAtteint = async () => r.budget_jour_eur > 0 && (await stock.compter.coutJour(jourParis(maintenant()))) >= r.budget_jour_eur;
      const indisponible = (raison) => json(cors, 503, { error: "indisponible", message: raison === "budget"
        ? `L'assistant est momentanément indisponible. Pour votre demande : ${r.telephone} (${r.horaires}) ou ${r.email_equipe}.`
        : "L'assistant n'est pas disponible pour votre compte." });

      // conversation de cette identité (fiche + auteur), ouverte
      const conversationDe = async (id) => {
        const c = await stock.conversations.lire(id, ctx.odooId);
        return c && c.statut === "ouverte" && (c.admin_email || null) === (ctx.admin || null) ? c : null;
      };
      // historique terminé par une réponse fixe (tour perdu, lancement impossible) ; affichage complété
      const reparer = async (convId, odooId, texte, tourId) => {
        await stock.conversations.modifier(convId, odooId, (c) => {
          const rep = reparerFin(c.messages, texte);
          return rep.length ? { messages: ajouterAuTexte(c.messages_texte, rep),
            affichage: JSON.stringify([...c.affichage, { id: `a-${tourId}`, role: "assistant", texte, ui_actions: [], at: maintenant().toISOString() }]) } : null;
        }).catch(e => journal({ evt: "http", action, code: "reparation_impossible", erreur: String(e?.message || e).slice(0, 80) }));
      };
      const perime = (t) => {
        const age = maintenant().getTime() - Date.parse(t.started_at || t.created_at);
        return t.statut === "en_attente" ? age > PERIME_ATTENTE_MS : t.statut === "en_cours" && age > PERIME_COURS_MS;
      };
      // tour perdu (fonction coupée) : clos en erreur d'abord (l'arrière-plan n'ajoutera plus rien), puis historique réparé
      const clorePerime = async (t) => {
        if (await stock.tours.erreur(t.id, "interrompu", { texte: TEXTES.interrompu() })) await reparer(t.conversation_id, t.odoo_id, TEXTES.interrompu(), t.id);
      };

      switch (action) {
        case "etat": {
          if (fermee) return json(cors, 200, { disponible: false, mode: null, raison: fermee });
          if (await budgetAtteint()) return json(cors, 200, { disponible: false, mode: null, raison: "budget" });
          // infos : ligne de contact de la barre latérale dès la connexion (sans attendre l'ouverture du panneau)
          return json(cors, 200, { disponible: true, mode: ctx.mode || "complet", raison: null, infos: infosDe(r) });
        }

        case "ouvrir": case "nouvelle": {
          if (fermee) return indisponible(fermee);
          const version = `${PROMPT_VERSION}+${await versionOutils()}`;
          let c = action === "ouvrir" && UUID.test(String(body.conversation_id || "")) ? await conversationDe(body.conversation_id) : null;
          if (!c) c = await stock.conversations.ouverte(ctx.odooId, ctx.admin || null);
          // nouvelle conversation demandée, ou prompt/outils changés depuis (l'historique n'est jamais réécrit)
          if (c && (action === "nouvelle" || c.prompt_version !== version)) { await stock.conversations.fermer(c.id, ctx.odooId); c = null; }
          if (!c) c = await stock.conversations.creer(ctx, { modele: r.modele, prompt_version: version });
          if (!c) throw new Error("conversation non créée");
          const enCours = (await stock.tours.enCours(c.id)).find(t => !perime(t)) || null;
          journal({ evt: "http", action, conv: c.id, code: "ok" });
          return json(cors, 200, {
            conversation_id: c.id, pharmacie: { nom: ctx.nom || "", ville: ctx.ville ?? null }, admin: ctx.admin || null, mode: ctx.mode || "complet",
            messages: (c.affichage || []).map(affichable), infos: infosDe(r), tour_en_cours: enCours?.id || null,
          });
        }

        case "message": {
          const texte = typeof body.texte === "string" ? body.texte.trim() : "";
          if (!texte) return json(cors, 400, { error: "texte" });
          if (texte.length > MAX_TEXTE) return json(cors, 400, { error: "texte_trop_long" });
          if (fermee) return indisponible(fermee);
          if (await budgetAtteint()) return indisponible("budget");
          const c = UUID.test(String(body.conversation_id || "")) ? await conversationDe(body.conversation_id) : null;
          // conversation fermée (nouvelle conversation ouverte sur un autre poste, purge) ou inconnue : le panneau en rouvre une
          if (!c) return json(cors, 410, { error: "conversation_fermee", message: FERMEE });
          // prompt ou outils changés depuis l'ouverture : l'historique ne peut pas être rejoué avec le nouveau préfixe
          if (c.prompt_version !== `${PROMPT_VERSION}+${await versionOutils()}`) {
            await stock.conversations.fermer(c.id, ctx.odooId);
            return json(cors, 410, { error: "conversation_fermee", message: "L'assistant vient d'être mis à jour : une nouvelle conversation s'ouvre." });
          }
          if ((c.nb_messages || 0) >= MAX_MESSAGES_CONVERSATION) return json(cors, 429, { error: "quota", message: "Cette conversation est longue : ouvrez une nouvelle conversation pour continuer." });
          // quotas durables
          const t = maintenant().getTime();
          if (ctx.admin) {
            if (await stock.compter.messagesAdmin(ctx.admin, new Date(t - JOUR).toISOString()) >= r.quotas.admin_messages_jour) {
              return json(cors, 429, { error: "quota", message: `Limite atteinte : ${r.quotas.admin_messages_jour} messages par 24 heures en saisie Elixir.` });
            }
          } else {
            if (await stock.compter.messages(ctx.odooId, new Date(t - HEURE).toISOString()) >= r.quotas.messages_heure) {
              return json(cors, 429, { error: "quota", message: "Vous avez envoyé beaucoup de messages en une heure : réessayez un peu plus tard." });
            }
            if (await stock.compter.messages(ctx.odooId, new Date(t - JOUR).toISOString()) >= r.quotas.messages_jour) {
              return json(cors, 429, { error: "quota", message: `Limite atteinte : ${r.quotas.messages_jour} messages par 24 heures. Pour une demande urgente : ${r.telephone}.` });
            }
          }
          // coût du jour de la fiche (ou de l'admin en saisie Elixir, trois fois le plafond) : une pharmacie ne peut pas
          // épuiser à elle seule le budget de toutes
          if (r.budget_fiche_jour_eur > 0) {
            const depuisJour = debutJourParisIso(jourParis(maintenant()));
            const cout = ctx.admin ? await stock.compter.coutAdmin(ctx.admin, depuisJour) : await stock.compter.coutFiche(ctx.odooId, depuisJour);
            if (cout >= r.budget_fiche_jour_eur * (ctx.admin ? 3 : 1)) {
              return json(cors, 429, { error: "quota", message: `L'assistant a beaucoup servi aujourd'hui pour ${ctx.admin ? "votre saisie" : "votre pharmacie"} : il sera de nouveau disponible demain. Pour votre demande : ${r.telephone} (${r.horaires}).` });
            }
          }
          // un seul tour à la fois ; un tour perdu ne bloque pas la conversation ; 409 avec le tour en cours (le panneau le suit)
          for (const tr of await stock.tours.enCours(c.id)) {
            if (!perime(tr)) return json(cors, 409, { error: "tour_en_cours", tour_id: tr.id });
            await clorePerime(tr);
          }
          if (!deps.lancer && !process.env.CRON_SECRET) {
            journal({ evt: "http", action, code: "cron_secret_absent" });
            return json(cors, 503, { error: "indisponible", message: "L'assistant est momentanément indisponible : configuration du serveur incomplète." });
          }
          const tour = await stock.tours.creer(c, ctx);
          if (!tour) {   // tour créé au même instant par un autre onglet
            const autre = (await stock.tours.enCours(c.id).catch(() => []))[0];
            return json(cors, 409, { error: "tour_en_cours", ...(autre ? { tour_id: autre.id } : {}) });
          }
          // historique : message de la pharmacie puis contexte du serveur (date, identité au premier message, événements)
          const ref = String(body.contexte?.commande_site_id ?? "");
          const commandeSite = /^\d{6,20}$/.test(ref) ? ref : null;
          const at = maintenant().toISOString();
          try {
            await stock.conversations.modifier(c.id, ctx.odooId, (cc) => ({
              messages: ajouterAuTexte(cc.messages_texte, [
                ...reparerFin(cc.messages, TEXTES.interrompu()),   // fin de tour manquante : l'ordre user → system → assistant est gardé
                { role: "user", content: texte },
                messageContexte({ maintenant: maintenant(), ctx, premier: !cc.messages.length, evenements: cc.evenements, infos: r, commandeSite }),
              ]),
              affichage: JSON.stringify([...cc.affichage, { id: `p-${tour.id}`, role: "pharmacie", texte, ui_actions: [], at }]),
              evenements_en_attente: "[]",
              nb_messages: (cc.nb_messages || 0) + 1,
            }));
          } catch (e) {
            await stock.tours.erreur(tour.id, "stockage").catch(() => {});
            throw e;
          }
          const pourquoi = await lancer(event, tour.id, Math.max(1000, echeance - horloge()));
          if (pourquoi) {
            journal({ evt: "http", action, conv: c.id, tour: tour.id, code: "lancement_impossible", raison: pourquoi });
            if (await stock.tours.erreur(tour.id, "lancement", { texte: TEXTES.erreur(r) })) await reparer(c.id, ctx.odooId, TEXTES.erreur(r), tour.id);
            return json(cors, 503, { error: "indisponible", message: "L'assistant n'a pas pu traiter votre message : réessayez dans un instant." });
          }
          journal({ evt: "http", action, conv: c.id, tour: tour.id, code: "ok" });
          return json(cors, 202, { tour_id: tour.id });
        }

        case "attendre": {
          const tourId = String(q.tour || "");
          const convId = q.conversation_id ? String(q.conversation_id) : null;
          if (!UUID.test(tourId)) return json(cors, 404, { error: "tour" });
          const fin = debut + ATTENTE_MAX_MS;
          for (;;) {
            const t = await stock.tours.lire(tourId, ctx.odooId);   // filtre de la fiche : le tour d'une autre pharmacie = introuvable
            if (!t || (convId && t.conversation_id !== convId) || (t.admin_email || null) !== (ctx.admin || null)) return json(cors, 404, { error: "tour" });
            if (t.statut === "termine" || t.statut === "erreur") {
              return json(cors, 200, { statut: t.statut, etape: null, message: { id: `a-${t.id}`, role: "assistant",
                texte: t.texte ?? (t.statut === "erreur" ? TEXTES.erreur(r) : ""), ui_actions: t.ui_actions || [], at: t.finished_at || t.created_at } });
            }
            if (perime(t)) { await clorePerime(t); continue; }
            if (maintenant().getTime() + PAS_MS >= fin) return json(cors, 200, { statut: t.statut, etape: t.etape || null, message: null });
            await attendre(PAS_MS);
          }
        }

        case "confirmer": {
          if (fermee) return indisponible(fermee);
          if (body.decision !== "confirmer" && body.decision !== "annuler") return json(cors, 400, { error: "decision" });
          const c = UUID.test(String(body.conversation_id || "")) ? await stock.conversations.lire(body.conversation_id, ctx.odooId) : null;
          if (!c || (c.admin_email || null) !== (ctx.admin || null)) return json(cors, 404, { error: "introuvable" });
          const demandes = (deps.creerDemandes || creerDemandes)({ stock, reglages: r, conversationId: c.id, maintenant, perimetre: deps.perimetre || {}, journal, echeance });
          const res = await demandes.confirmer(ctx, { demande_id: body.demande_id, decision: body.decision, conversation_id: c.id, prevenir: body.prevenir_pharmacie !== false });
          journal({ evt: "http", action, conv: c.id, code: res.http === 200 ? "ok" : res.error });
          return res.http === 200 ? json(cors, 200, { message: res.message })
            : json(cors, res.http, { error: res.error, ...(res.message ? { message: res.message } : {}) });
        }
      }
      return json(cors, 400, { error: "action" });
    } catch (e) {
      journal({ evt: "http", action, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      // tables absentes (schéma pas encore exécuté), clé serveur manquante… : le bouton reste simplement masqué
      if (action === "etat") return json(cors, 200, { disponible: false, mode: null, raison: null });
      return json(cors, e?.code === "configuration" ? 503 : 500, { error: "indisponible", message: "L'assistant rencontre un problème technique : réessayez dans quelques minutes." });
    }
  };
}

export const handler = creerHandler();
