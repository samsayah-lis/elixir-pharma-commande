// ── Notifications de l'appli Elixir : API de l'onglet admin « 🔔 Notifications » (verifyAdmin sur toutes les routes) ──
// POST { action, … } :
//   etat          { endpoint? }  → { service (coches, sans aucune valeur de clé), disponible, sujet_affiche, cle_publique, reglages,
//                                    stats, pharmacies (500 au plus), mes_appareils (appareils admin de CET admin), hotes_refuses,
//                                    appareil_inconnu (endpoint donné et inconnu de TOUTE identité : abonnement local à désinscrire) }
//   reglages      { reglages: { ouverture, pilote_cips, plafond_offres_7j } } → { reglages } · 400 { erreurs }
//   abonner_admin { abonnement, appareil, remplacer? } → { success, appareil } (rôle admin : tests et aperçus seulement)
//   retirer_admin { id } | { endpoint } → { success } (ses propres appareils seulement)
//   test          → { envoyes, echecs, retires } (appareils admin de cet admin)
//   apercu        { annonce: { titre, corps, url } } → idem, l'annonce composée (pas de plafond, rien dans push_envois)
//   estimer       { audience, cips? } → { visees, plafonnees, recevront, appareils, fermee }
//   envoyer       { annonce: { titre, corps, url, audience, cips? }, idem } → 202 { annonce } (envoi par push-envoi-background)
//                 · même idem → l'annonce déjà créée (200, deja) · 409 en_cours | fermee | configuration · 502 lancement (« Relancer »)
//   relancer      { id } → 202 (annonce restée « en file » depuis 2 min au moins et moins de 24 h) · 409 en_cours (une autre
//                 annonce est en cours de diffusion) | trop_tot | trop_ancienne | statut
//   historique    { limite? } → { annonces }
//   pharmacie     { cip } → { appareils, raison } (saisie « Commander pour une pharmacie » : lecture seule)
//   retirer_pharmacie { cip, id? } → { success, retires } (demande d'effacement, appareil perdu : un appareil ou tous ceux
//                 de la pharmacie ; journal sans contenu)
// Jamais de 401/403 pour une raison métier (adminFetch déconnecterait l'admin) : 400 / 409. Aucune réponse ne contient endpoint,
// p256dh, auth ni la clé privée. Hôte d'aperçu (fonctions branchées sur la production) : réponses fictives, rien n'est envoyé.
import { getCors } from "./cors.js";
import { verifyAdmin } from "./auth.js";
import {
  configPush, creerStockPush, validerAbonnement, envoyerAAppareils, charge, appareilPublic, libelleNet, plateformeNette,
  statistiques, destinataires, estApercu, siteBase, json, estUuid, TTL, URGENCE, MAX_APPAREILS,
} from "./_push.js";
import { verifierAnnonce, verifierReglages, raisonOuverture, REGLAGES_DEFAUT, RE_CIP } from "../../src/notifications/regles.js";

const ACTIONS = new Set(["etat", "reglages", "abonner_admin", "retirer_admin", "test", "apercu", "estimer", "envoyer", "relancer", "historique", "pharmacie",
  "retirer_pharmacie"]);
const MINUTE = 60e3;
const RELANCE_MAX_H = 24;   // au-delà, une annonce restée « en file » n'est plus relancée : la recomposer

// Lancement de push-envoi-background (comme chat.js → chat-tour-background) → null si elle est partie, sinon la raison
async function lancerEnvoi(event, id) {
  if (!process.env.CRON_SECRET) return "CRON_SECRET absent";
  try {
    const r = await fetch(`${siteBase(event)}/.netlify/functions/push-envoi-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
      body: JSON.stringify({ annonce: id }), signal: AbortSignal.timeout(6000),
    });
    return r.ok || r.status === 202 ? null : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "délai dépassé" : "injoignable";
  }
}

// annonce de l'historique : liste de CIP abrégée au-delà de 20
const resumeAnnonce = (a) => a && ({ ...a, cips: Array.isArray(a.cips) ? a.cips.slice(0, 20) : null, nb_cips: Array.isArray(a.cips) ? a.cips.length : 0 });

// Hôte d'aperçu : réponses d'exemple, rien n'est lu, écrit ni envoyé
function apercu(cors, action) {
  const maintenant = new Date().toISOString();
  switch (action) {
    case "etat": return json(cors, 200, { apercu: true, disponible: true, service: { vapid_publique: true, vapid_privee: true, vapid_paire: true, sujet: true,
      sujet_defaut: false, cle_serveur: true, cron_secret: true, tables: true, defauts: [] }, sujet_affiche: "mailto:pharmacien@elixirpharma.fr", cle_publique: null,
      reglages: REGLAGES_DEFAUT, stats: { pharmacies: 0, appareils: 0, par_categorie: { stock: 0, commandes: 0, offres: 0 },
        par_plateforme: { ios: 0, android: 0, ordinateur: 0, autre: 0 }, installes: 0, en_echec: 0, vus_30j: 0 }, pharmacies: [], mes_appareils: [] });
    case "estimer": return json(cors, 200, { apercu: true, visees: 0, plafonnees: 0, recevront: 0, appareils: 0, fermee: false });
    case "envoyer": return json(cors, 202, { apercu: true, annonce: { id: "apercu", statut: "envoyee", created_at: maintenant } });
    case "historique": return json(cors, 200, { apercu: true, annonces: [] });
    case "pharmacie": return json(cors, 200, { apercu: true, appareils: [], raison: null });
    case "retirer_pharmacie": return json(cors, 200, { apercu: true, success: true, retires: 0 });
    case "test": case "apercu": return json(cors, 200, { apercu: true, envoyes: 0, echecs: 0, retires: 0 });
    default: return json(cors, 200, { apercu: true, success: true });
  }
}

// deps (doublures des tests) : stock, config(), verifierAdmin, transport, hotesEssai, lancer, maintenant, journal
export function creerHandler(deps = {}) {
  let stockDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockPush());
  const config = () => (deps.config ? deps.config() : configPush());
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  const lancer = deps.lancer || lancerEnvoi;

  return async (event) => {
    const cors = getCors(event);
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    const { admin, error } = await (deps.verifierAdmin || verifyAdmin)(event);
    if (error) return { ...error, headers: { ...cors, ...(error.headers || {}), "Cache-Control": "no-store" } };
    if (event.httpMethod !== "POST") return json(cors, 405, { error: "methode" });
    let body;
    try { body = JSON.parse(event.body || "{}") || {}; } catch { return json(cors, 400, { error: "requete" }); }
    if (typeof body !== "object" || Array.isArray(body)) return json(cors, 400, { error: "requete" });
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return json(cors, 400, { error: "action" });
    if (estApercu(event)) return apercu(cors, action);

    const email = String(admin?.email || "").toLowerCase();
    const conf = config();
    const stock = stockDe();
    const iso = () => maintenant().toISOString();
    const opts = (categorie, sujet) => ({ cles: conf.cles, ttl: TTL[categorie], urgence: URGENCE[categorie], sujet, delaiMs: 5000 });
    const dep = { stock, transport: deps.transport, hotesEssai: deps.hotesEssai, maintenant, journal };
    const mesAppareils = () => stock.abonnements.deIdentite({ role: "admin", email });
    const bilan = (r) => ({ envoyes: r.envoyes, echecs: r.echecs, retires: r.retires });
    try {
      switch (action) {
        case "etat": {
          let tables = false, absentes = false, reglages = REGLAGES_DEFAUT, lignes = [], hotesRefuses = [];
          if (conf.service.cle_serveur) {
            try { reglages = await stock.reglages.lire({ frais: true }); tables = true; lignes = await stock.abonnements.tous(); }
            catch (e) { absentes = e?.code === "schema"; journal({ evt: "push_admin", action, code: e?.code || "erreur" }); }
            if (tables) hotesRefuses = await stock.hotes.lister(10).catch(() => []);
          }
          const { stats, pharmacies } = statistiques(lignes, maintenant());
          const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
          const appareilInconnu = tables && endpoint && endpoint.length <= 1024 ? !(await stock.abonnements.parEndpoint(endpoint).catch(() => true)) : null;
          const defauts = [...conf.defauts,
            ...(conf.service.cle_serveur && !tables ? [absentes ? "Tables absentes : exécutez sql/push-schema.sql dans Supabase" : "Tables illisibles (Supabase injoignable ?)"] : []),
            ...(conf.service.cron_secret ? [] : ["CRON_SECRET absent : les annonces ne peuvent pas partir"])];
          return json(cors, 200, { disponible: conf.ok && tables, service: { ...conf.service, tables, defauts }, sujet_affiche: conf.sujet_affiche,
            cle_publique: conf.cle_publique, reglages, stats, pharmacies, hotes_refuses: hotesRefuses,
            mes_appareils: lignes.filter((l) => l.role === "admin" && l.compte_email === email).map((l) => appareilPublic(l, endpoint)), appareil_inconnu: appareilInconnu });
        }
        case "reglages": {
          const v = verifierReglages(body.reglages || {});
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const reglages = await stock.reglages.ecrire(v.reglages);
          journal({ evt: "push_admin", action, ouverture: reglages.ouverture, pilote: reglages.pilote_cips.length, plafond: reglages.plafond_offres_7j });
          return json(cors, 200, { reglages });
        }
        case "abonner_admin": {
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const v = validerAbonnement(body.abonnement, { hotesEssai: deps.hotesEssai });
          if (!v.ok) {
            if (v.hote) { journal({ evt: "push_admin", action, code: "hote_refuse", hote: v.hote }); await stock.hotes.noter(v.hote).catch(() => {}); }
            return json(cors, 400, { error: "abonnement", message: v.erreur });
          }
          const ex = await stock.abonnements.parEndpoint(v.endpoint);
          const meme = !!ex && ex.role === "admin" && ex.compte_email === email;
          if (ex && !meme && body.remplacer !== true)
            return json(cors, 409, { error: "autre_identite", de: ex.role === "admin" ? "un autre compte admin" : (ex.pharmacie_nom || `la pharmacie ${ex.pharmacy_cip}`) });
          if (!meme && (await mesAppareils()).length >= MAX_APPAREILS) return json(cors, 409, { error: "trop_d_appareils" });
          const ap = body.appareil && typeof body.appareil === "object" ? body.appareil : {};
          const r = await stock.abonnements.enregistrer({ endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth, role: "admin", pharmacy_cip: null,
            pharmacie_nom: null, compte_email: email, categories: [], appareil: libelleNet(ap.libelle), plateforme: plateformeNette(ap.plateforme),
            installe: ap.installe === true, failures: 0, last_error: null, last_seen_at: iso(),
            ...(meme ? {} : { created_at: iso(), last_success_at: null, last_failure_at: null }) });
          journal({ evt: "push_admin", action, code: meme ? "mis_a_jour" : ex ? "repris" : "nouveau" });
          return json(cors, 200, { success: true, appareil: r ? appareilPublic(r) : null });
        }
        case "retirer_admin": {
          const miens = await mesAppareils();
          const ids = miens.filter((l) => (typeof body.id === "string" && l.id === body.id) || (typeof body.endpoint === "string" && l.endpoint === body.endpoint)).map((l) => l.id);
          if (ids.length) await stock.abonnements.supprimerIds(ids);
          return json(cors, 200, { success: true });
        }
        case "test": {
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const miens = await mesAppareils();
          if (!miens.length) return json(cors, 200, { envoyes: 0, echecs: 0, retires: 0, aucun: true });
          const r = await envoyerAAppareils(miens, charge({ categorie: "test", titre: "Elixir Admin : notification de test",
            corps: "Les notifications arrivent bien sur cet appareil.", url: "/", tag: "test-admin" }, maintenant().getTime()), opts("test", "test-admin"), dep);
          return json(cors, 200, bilan(r));
        }
        case "apercu": {
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const v = verifierAnnonce({ ...(body.annonce || {}), audience: "toutes", cips: null });
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const miens = await mesAppareils();
          if (!miens.length) return json(cors, 200, { envoyes: 0, echecs: 0, retires: 0, aucun: true });
          const r = await envoyerAAppareils(miens, charge({ categorie: "offres", titre: v.annonce.titre, corps: v.annonce.corps, url: v.annonce.url, tag: "apercu" },
            maintenant().getTime()), opts("test", "apercu"), dep);
          return json(cors, 200, bilan(r));
        }
        case "estimer": {
          const audience = body.audience === "liste" ? "liste" : "toutes";
          const cips = audience === "liste" ? (Array.isArray(body.cips) ? body.cips.map(String).filter((c) => RE_CIP.test(c)).slice(0, 500) : []) : null;
          const d = await destinataires(stock, { audience, cips }, { maintenant });
          return json(cors, 200, { visees: d.visees, plafonnees: d.plafonnees, recevront: d.recevront, appareils: d.appareils, fermee: d.fermee,
            plafond_offres_7j: d.reglages.plafond_offres_7j });
        }
        case "envoyer": {
          const v = verifierAnnonce(body.annonce || {});
          if (!v.ok) return json(cors, 400, { erreurs: v.erreurs });
          const idem = typeof body.idem === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.idem) ? body.idem : null;
          if (!idem) return json(cors, 400, { error: "idem" });
          if (!conf.ok) return json(cors, 409, { error: "configuration" });
          const deja = await stock.annonces.parIdem(idem);
          if (deja) return json(cors, 200, { annonce: resumeAnnonce(deja), deja: true });
          if ((await stock.annonces.enCours(new Date(maintenant().getTime() - 15 * MINUTE).toISOString())).length
            || (await stock.annonces.diffusionEnCours()).length) return json(cors, 409, { error: "en_cours" });
          if ((await stock.reglages.lire({ frais: true })).ouverture === "fermee") return json(cors, 409, { error: "fermee" });
          const { annonce, existante } = await stock.annonces.creer({ idem, titre: v.annonce.titre, corps: v.annonce.corps, url: v.annonce.url,
            audience: v.annonce.audience, cips: v.annonce.cips, admin_email: email, statut: "en_file" });
          if (existante) return json(cors, 200, { annonce: resumeAnnonce(annonce), deja: true });
          const echec = await lancer(event, annonce.id);
          journal({ evt: "push_admin", action, annonce: String(annonce.id).slice(0, 8), code: echec ? "lancement_impossible" : "lancee", audience: v.annonce.audience });
          if (echec) return json(cors, 502, { error: "lancement", detail: echec, annonce: resumeAnnonce(annonce) });
          return json(cors, 202, { annonce: resumeAnnonce(annonce) });
        }
        case "relancer": {
          if (!estUuid(body.id)) return json(cors, 400, { error: "id" });
          const a = await stock.annonces.lire(body.id);
          if (!a || a.statut !== "en_file") return json(cors, 409, { error: "statut" });
          const age = maintenant().getTime() - Date.parse(a.created_at);
          if (age < 2 * MINUTE) return json(cors, 409, { error: "trop_tot" });
          if (!(age <= RELANCE_MAX_H * 60 * MINUTE)) return json(cors, 409, { error: "trop_ancienne" });
          // une seule diffusion à la fois (plafond des offres) : jamais pendant qu'une autre annonce part
          if ((await stock.annonces.diffusionEnCours()).some((x) => x.id !== a.id)) return json(cors, 409, { error: "en_cours" });
          const echec = await lancer(event, a.id);
          if (echec) return json(cors, 502, { error: "lancement", detail: echec, annonce: resumeAnnonce(a) });
          return json(cors, 202, { annonce: resumeAnnonce(a) });
        }
        case "historique": {
          const annonces = await stock.annonces.lister(Math.max(1, Math.min(200, parseInt(body.limite, 10) || 50)));
          return json(cors, 200, { annonces: annonces.map(resumeAnnonce) });
        }
        case "pharmacie": {
          const cip = String(body.cip || "").trim();
          if (!RE_CIP.test(cip)) return json(cors, 400, { error: "cip" });
          const [lignes, reglages] = await Promise.all([stock.abonnements.deIdentite({ role: "pharmacie", cip }), stock.reglages.lire()]);
          return json(cors, 200, { appareils: lignes.map((l) => appareilPublic(l)), raison: raisonOuverture(reglages, cip), disponible: conf.ok });
        }
        case "retirer_pharmacie": {
          const cip = String(body.cip || "").trim();
          if (!RE_CIP.test(cip)) return json(cors, 400, { error: "cip" });
          const lignes = await stock.abonnements.deIdentite({ role: "pharmacie", cip });
          const ids = (typeof body.id === "string" ? lignes.filter((l) => l.id === body.id) : lignes).map((l) => l.id);
          if (ids.length) await stock.abonnements.supprimerIds(ids);
          journal({ evt: "push_admin", action, n: ids.length, tous: typeof body.id !== "string" });
          return json(cors, 200, { success: true, retires: ids.length });
        }
      }
      return json(cors, 400, { error: "action" });
    } catch (e) {
      journal({ evt: "push_admin", action, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      return json(cors, e?.code === "schema" ? 409 : 500, { error: e?.code === "schema" ? "schema" : "erreur",
        message: e?.code === "schema" ? "Tables absentes : exécutez sql/push-schema.sql dans Supabase." : "Erreur technique : réessayez dans un instant." });
    }
  };
}

export const handler = creerHandler();
