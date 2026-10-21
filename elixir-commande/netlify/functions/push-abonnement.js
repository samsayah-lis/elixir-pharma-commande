// ── Notifications de l'appli Elixir : API des pharmacies (docs/notifications.md) ──
// GET (sans jeton)                → { disponible, cle_publique, ouverture }  (Cache-Control: private, max-age=60)
//   disponible : clés VAPID et clé serveur en place ET tables créées ; sinon { disponible: false } et le site n'affiche rien.
// POST { action, … } — jeton pharmacie (Authorization: Bearer, appelAuthentifie du site), sauf « oublier » et « renouveler » :
//   statut     { endpoint? }        → { disponible, raison, cle_publique, plafond_offres_7j, plafond_infos_7j, categories_disponibles,
//                                       appareil, autre_identite, appareils: [{ id, appareil, plateforme, installe,
//                                       categories, created_at, last_success_at, en_echec, actuel }] }
//   abonner    { abonnement, categories?, appareil: { libelle, plateforme, installe }, remplacer? } → { success, appareil }
//              · 409 autre_identite (appareil d'une autre pharmacie ou d'Elixir : confirmer, puis remplacer: true)
//              · 409 trop_d_appareils (10 par pharmacie) · 400 abonnement (adresse du service push refusée, clés illisibles)
//   categories { endpoint, categories } → { success, categories } · 404 appareil (inconnu ou d'une autre pharmacie)
//   test       { endpoint }        → notification de test à CET appareil (3 par 10 min) · 410 expire · 502 envoi
//   retirer    { endpoint } | { id } (un autre appareil de la pharmacie) → { success } (idempotent)
//   oublier    { endpoint, auth }  SANS jeton (déconnexion) : supprime l'abonnement « pharmacie » prouvé par son secret auth
//              → toujours 200 { success: true, role: "pharmacie" | "admin" | null } (admin : rien supprimé)
//   renouveler { ancien: { endpoint, auth }, abonnement } SANS jeton (service worker, changement de clés VAPID) : la ligne
//              prouvée garde son identité et ses catégories → { success } (preuve fausse : { success: false }, pas d'oracle)
// Identité = le jeton (auth.js : CIP résolu par l'e-mail vérifié), jamais le corps ; CIP nettoyé et lisible (7 à 14 chiffres),
// sinon 403 fiche : « 0 », « false » (lignes manuelles sans CIP) ne sont jamais une identité partagée. Jeton admin (saisie
// « Commander pour une pharmacie ») → 403 admin : l'appareil d'Elixir n'est jamais abonné au nom d'une pharmacie. Ouverture (admin) : « fermee » →
// 403 fermee, « pilote » hors liste → 403 hors_pilote (statut répond 200 avec disponible: false et la raison). Désabonnement
// toujours possible. Aucune réponse ne contient endpoint, p256dh, auth ni la clé privée. Hôte d'aperçu : réponses fictives.
import { getCors } from "./cors.js";
import { verifierJeton } from "./auth.js";
import { cleIp } from "./rate-limit.js";
import {
  configPush, creerStockPush, validerAbonnement, envoyerAAppareils, charge, appareilPublic, libelleNet, plateformeNette,
  memeSecret, creerLimiteur, estApercu, json, jetonDe, TTL, URGENCE, MAX_APPAREILS,
} from "./_push.js";
import { CATEGORIES_DEFAUT, categoriesAffichees, filtrerCategories, raisonOuverture, PLAFOND_DEFAUT, PLAFOND_INFOS_DEFAUT, cipPropre } from "../../src/notifications/regles.js";

const ACTIONS = new Set(["statut", "abonner", "categories", "test", "retirer", "oublier", "renouveler"]);
// [requêtes, fenêtre en s] par IP (une officine partage souvent une IP entre plusieurs postes)
const DEBITS = { statut: [60, 60], oublier: [10, 60], renouveler: [10, 60], autre: [20, 60] };
const TESTS = [3, 600];   // notifications de test par appareil
const DOUZE_HEURES = 12 * 3600e3;

// Hôte d'aperçu (fonctions branchées sur la production) : rien n'est lu, écrit ni envoyé
function apercu(cors, action) {
  if (action === "statut") return json(cors, 200, { disponible: true, raison: null, cle_publique: null, plafond_offres_7j: PLAFOND_DEFAUT, plafond_infos_7j: PLAFOND_INFOS_DEFAUT,
    categories_disponibles: categoriesAffichees(PLAFOND_DEFAUT, PLAFOND_INFOS_DEFAUT), appareil: null, autre_identite: false, appareils: [], apercu: true });
  if (action === "oublier") return json(cors, 200, { success: true, role: null, apercu: true });
  return json(cors, 200, { success: true, apercu: true });
}

// deps (doublures des tests) : stock, config(), verifierJeton, transport, hotesEssai, maintenant, journal, limite
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockPush());
  const config = () => (deps.config ? deps.config() : configPush());
  const verifier = deps.verifierJeton || verifierJeton;
  const limite = deps.limite || creerLimiteur();
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };

    // ── GET : configuration publique (site, service worker) ──
    if (event.httpMethod === "GET") {
      const conf = config();
      let disponible = false, ouverture = "fermee";
      if (conf.ok) {
        try { ouverture = (await stockDe().reglages.lire()).ouverture; disponible = true; }
        catch (e) { journal({ evt: "push_config", code: e?.code || "erreur" }); }
      }
      return json(cors, 200, { disponible, cle_publique: disponible ? conf.cle_publique : null, ouverture: disponible ? ouverture : "fermee" }, "private, max-age=60");
    }
    if (event.httpMethod !== "POST") return json(cors, 405, { error: "methode" });

    let body;
    try { body = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "requete" }); }
    if (typeof body !== "object" || Array.isArray(body)) return json(cors, 400, { error: "requete" });
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return json(cors, 400, { error: "action" });
    if (estApercu(event)) return apercu(cors, action);
    const [max, fenetre] = DEBITS[action] || DEBITS.autre;
    const attente = limite(`${DEBITS[action] ? action : "autre"}|${cleIp(event)}`, max, fenetre);
    if (attente) {
      const r = json(cors, 429, { error: "quota", message: "Trop de requêtes en peu de temps : réessayez dans quelques secondes." });
      r.headers["Retry-After"] = String(attente);
      return r;
    }

    const conf = config();
    const stock = stockDe();
    const iso = () => maintenant().toISOString();
    const endpoint = typeof body.endpoint === "string" && body.endpoint.length <= 1024 ? body.endpoint : null;
    // service push hors liste : hôte seulement (jamais le chemin ni le jeton), journal + admin (État du service)
    const noterHote = async (hote) => {
      if (!hote) return;
      journal({ evt: "push_abonnement", action, code: "hote_refuse", hote });
      await stock.hotes?.noter(hote).catch(() => {});
    };
    try {
      // ── Sans jeton : preuve de possession (secret auth de l'abonnement) ──
      if (action === "oublier") {
        if (!conf.service.cle_serveur || !endpoint) return json(cors, 200, { success: true, role: null });
        const r = await stock.abonnements.parEndpoint(endpoint);
        if (!r || !memeSecret(r.auth, body.auth)) return json(cors, 200, { success: true, role: null });
        if (r.role === "pharmacie") { await stock.abonnements.supprimerIds([r.id]); journal({ evt: "push_abonnement", action, code: "retire" }); }
        return json(cors, 200, { success: true, role: r.role });
      }
      if (action === "renouveler") {
        const anc = body.ancien && typeof body.ancien === "object" ? body.ancien : {};
        const r = typeof anc.endpoint === "string" && anc.endpoint.length <= 1024 ? await stock.abonnements.parEndpoint(anc.endpoint) : null;
        if (!r || !memeSecret(r.auth, anc.auth)) return json(cors, 200, { success: false });
        const v = validerAbonnement(body.abonnement, { hotesEssai: deps.hotesEssai });
        if (!v.ok) { await noterHote(v.hote); return json(cors, 400, { error: "abonnement" }); }
        if (v.endpoint === r.endpoint) await stock.abonnements.modifier(r.id, { p256dh: v.p256dh, auth: v.auth, failures: 0, last_error: null });
        else {
          const deja = await stock.abonnements.parEndpoint(v.endpoint);
          // nouvel abonnement déjà connu : l'ancien, désormais inutile, est retiré
          if (deja) await stock.abonnements.supprimerIds([r.id]);
          else await stock.abonnements.modifier(r.id, { endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth, failures: 0, last_error: null });
        }
        journal({ evt: "push_abonnement", action, code: "renouvele" });
        return json(cors, 200, { success: true });
      }

      // ── Identité : le jeton seulement ──
      let user;
      try { user = await verifier(jetonDe(event)); }
      catch (e) {
        if (e?.indisponible) return json(cors, 503, { error: "indisponible", message: "Connexion momentanément indisponible : réessayez dans un instant." });
        throw e;
      }
      if (!user) return json(cors, 401, { error: "reconnexion" });
      if (user.isAdmin) return json(cors, 403, { error: "admin" });
      const cip = cipPropre(user.cip), email = String(user.email || "").trim().toLowerCase();
      if (!cip) return json(cors, 403, { error: "fiche" });
      if (!conf.ok) return action === "statut" ? json(cors, 200, { disponible: false, raison: null }) : json(cors, 503, { error: "indisponible" });
      const reglages = await stock.reglages.lire();
      const raison = raisonOuverture(reglages, cip);
      const meme = (r) => !!r && r.role === "pharmacie" && r.pharmacy_cip === cip;
      const deCetAppareil = async () => { const r = endpoint ? await stock.abonnements.parEndpoint(endpoint) : null; return meme(r) ? r : null; };

      switch (action) {
        case "statut": {
          const lignes = await stock.abonnements.deIdentite({ role: "pharmacie", cip });
          const actuelle = endpoint ? lignes.find((l) => l.endpoint === endpoint) || null : null;
          const autre = !!(endpoint && !actuelle && await stock.abonnements.parEndpoint(endpoint));
          // dernière ouverture du site (au plus une écriture par 12 h) : « vus ces 30 jours » de l'admin
          if (actuelle && !(Date.parse(actuelle.last_seen_at || "") > maintenant().getTime() - DOUZE_HEURES))
            await stock.abonnements.modifier(actuelle.id, { last_seen_at: iso() }).catch(() => {});
          return json(cors, 200, { disponible: !raison, raison, cle_publique: conf.cle_publique, plafond_offres_7j: reglages.plafond_offres_7j,
            plafond_infos_7j: reglages.plafond_infos_7j, categories_disponibles: categoriesAffichees(reglages.plafond_offres_7j, reglages.plafond_infos_7j),
            appareil: actuelle ? appareilPublic(actuelle) : null,
            autre_identite: autre, appareils: lignes.map((l) => appareilPublic(l, endpoint)) });
        }
        case "abonner": {
          if (raison) return json(cors, 403, { error: raison });
          const v = validerAbonnement(body.abonnement, { hotesEssai: deps.hotesEssai });
          if (!v.ok) { await noterHote(v.hote); return json(cors, 400, { error: "abonnement", message: v.erreur }); }
          const existante = await stock.abonnements.parEndpoint(v.endpoint);
          if (existante && !meme(existante) && body.remplacer !== true)
            return json(cors, 409, { error: "autre_identite", de: existante.role === "admin" ? "Elixir (admin)" : "une autre pharmacie" });
          if (!meme(existante)) {
            const lignes = await stock.abonnements.deIdentite({ role: "pharmacie", cip });
            if (lignes.length >= MAX_APPAREILS) return json(cors, 409, { error: "trop_d_appareils" });
          }
          const cats = filtrerCategories(body.categories) ?? (meme(existante) ? existante.categories : CATEGORIES_DEFAUT);
          const ap = body.appareil && typeof body.appareil === "object" ? body.appareil : {};
          const r = await stock.abonnements.enregistrer({
            endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth, role: "pharmacie", pharmacy_cip: cip,
            pharmacie_nom: await stock.nomPharmacie(email), compte_email: email, categories: cats,
            appareil: libelleNet(ap.libelle), plateforme: plateformeNette(ap.plateforme), installe: ap.installe === true,
            failures: 0, last_error: null, last_seen_at: iso(),
            // appareil repris d'une autre identité : nouvel historique
            ...(existante && !meme(existante) ? { created_at: iso(), last_success_at: null, last_failure_at: null } : {}),
          });
          journal({ evt: "push_abonnement", action, code: !existante ? "nouveau" : meme(existante) ? "mis_a_jour" : "repris" });
          return json(cors, 200, { success: true, appareil: r ? appareilPublic(r) : null });
        }
        case "categories": {
          const r = await deCetAppareil();
          if (!r) return json(cors, 404, { error: "appareil" });
          const cats = filtrerCategories(body.categories);
          if (cats === null) return json(cors, 400, { error: "categories" });
          const m = await stock.abonnements.modifier(r.id, { categories: cats });
          return json(cors, 200, { success: true, categories: m?.categories ?? cats });
        }
        case "test": {
          if (raison) return json(cors, 403, { error: raison });
          const r = await deCetAppareil();
          if (!r) return json(cors, 404, { error: "appareil" });
          if (limite(`test|${r.id}`, TESTS[0], TESTS[1])) return json(cors, 429, { error: "quota", message: "3 notifications de test en 10 minutes au plus : réessayez un peu plus tard." });
          const res = await envoyerAAppareils([r], charge({ categorie: "test", titre: "Notification de test",
            corps: `Les notifications Elixir fonctionnent sur cet appareil (${r.appareil || "appareil"}).`, url: "/?notifications=1", tag: "test" }, maintenant().getTime()),
          { cles: conf.cles, ttl: TTL.test, urgence: URGENCE.test, sujet: "test", delaiMs: 5000 },
          { stock, transport: deps.transport, hotesEssai: deps.hotesEssai, maintenant, journal });
          const p = res.parLigne.get(r.id);
          journal({ evt: "push_test", code: p?.ok ? "ok" : p?.retiree ? "retire" : "echec", statut: p?.statut ?? null });
          if (p?.ok) return json(cors, 200, { success: true });
          if (p?.retiree) return json(cors, 410, { error: "expire" });
          return json(cors, 502, { error: "envoi", detail: p?.erreur || "erreur" });
        }
        case "retirer": {
          let ids = [];
          if (typeof body.id === "string") ids = (await stock.abonnements.deIdentite({ role: "pharmacie", cip })).filter((l) => l.id === body.id).map((l) => l.id);
          else { const r = await deCetAppareil(); if (r) ids = [r.id]; }
          if (ids.length) { await stock.abonnements.supprimerIds(ids); journal({ evt: "push_abonnement", action, code: "retire" }); }
          return json(cors, 200, { success: true });
        }
      }
      return json(cors, 400, { error: "action" });
    } catch (e) {
      journal({ evt: "push_abonnement", action, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      // tables absentes, clé serveur manquante, Supabase injoignable : la carte et le menu restent simplement masqués
      if (action === "statut") return json(cors, 200, { disponible: false, raison: null });
      return json(cors, 503, { error: "indisponible", message: "Service momentanément indisponible : réessayez dans un instant." });
    }
  };
}

export const handler = creerHandler();
