// ── API des pharmacies : routeur unique de /api/v1/* (public/_redirects, AVANT la règle « /* ») ──
// Ordre des contrôles à chaque appel (conception § 3.5) :
//   1. débit par IP AVANT toute lecture (120/min, IPv6 par /64) et refus de clés inconnues par réseau (20 par 10 min → 429) ;
//      l'adresse est celle que pose Netlify (x-nf-client-connection-ip), jamais X-Forwarded-For (écrit par le client) ;
//   2. clé : « Authorization: Bearer elx_… » seulement (une clé dans l'adresse → 400 cle_dans_url), format et somme de
//      contrôle sans lecture en base, puis empreinte SHA-256 → api_cles (révoquée, expirée : comptées sur la clé, jamais sur
//      le réseau) ; hôte d'aperçu (« …--commandes-elixir.netlify.app », liens permanents des déploiements compris) : clés de
//      TEST seulement (403 cle_production_hors_site) ;
//   3. accès de la fiche (api_acces actif), interrupteur général (« Tout couper » : 503 sauf /v1/etat et l'annulation),
//      réseaux autorisés, fiche revérifiée dans Odoo (au plus toutes les 10 min par instance pour une lecture ; archivée →
//      acces_suspendu, sans CIP → compte_bloque) ; écritures (simulation, commande, annulation) : clé et accès relus en
//      base à chaque appel (une clé révoquée ne passe plus), fiche relue (3 s au plus) sauf pour l'annulation ;
//   4. portée (« lecture », « commande », « documents ») ;
//   5. débit par clé (compteurs durables api_compteurs : minute et jour de Paris, par classe ; lus d'abord : une requête
//      refusée par le débit n'est pas comptée) ;
//   6. route ; 7. journal (api_journal : ni corps, ni IP complète, ni e-mail ; aperçus compris, environnement « apercu »).
// L'identité vient TOUJOURS de la clé : aucun CIP, odoo_id ni e-mail venu de la requête n'est lu.
// Erreurs : RFC 9457 (application/problem+json) ; X-Request-Id sur toute réponse ; aucune en-tête CORS.
// Durée : une route est coupée à 9 s après l'ARRIVÉE de la requête (8,5 s au plus), et une commande n'écrit plus rien
// passé 7 s (COMMANDE.budget_ms) : la fonction répond toujours avant la coupure de 10 s de Netlify.
// Phase 1 (fondations) : GET /v1/etat. Phase 2 (lecture, _api-lecture.js) : catalogue, disponibilités, contingents,
// commandes (droit « lecture »), factures et bons de livraison (droit « documents »). Phase 3 (commandes, _api-commande.js) :
// simulation, commande (Idempotency-Key), annulation (droit « commande ») ; les commandes RÉELLES restent refusées (503
// ecriture_suspendue) tant que l'interrupteur « Commandes par API » est fermé (_api-config.js) ; les clés de test
// fonctionnent dès la mise en ligne.
import crypto from "node:crypto";
import { prefixeIp } from "./rate-limit.js";
import { ficheVerifiee } from "./_chat-perimetre.js";
import { validCip } from "./_pharmacies.js";
import { creerStockApi } from "./_api-stock.js";
import { analyserCle, cleDeRequete, empreinteCle, etatCle, ipDansListe, reseauDe } from "./_api-cles.js";
import { LIMITES, CORPS_MAX_OCTETS, VERSION_API, DERNIERE_MODIFICATION, MENTION_PRIX, CGU, COMMANDE, fusionnerReglages, commandesLiveOuvertes, limiteDe,
  secondesAvantMinuitParis } from "./_api-config.js";
import { probleme, reponseJson, codeDe, estApercu, isoParis, ipClient } from "./_api-http.js";
import { ROUTES_LECTURE, creerServicesLecture } from "./_api-lecture.js";
import { ROUTES_COMMANDE } from "./_api-commande.js";
import { noterParcours } from "./_api-parcours.js";

const CACHE_MS = 30_000;            // clé, accès, réglages : 30 s au plus par instance (une révocation est vue en ≤ 30 s)
const FICHE_MS = 10 * 60_000;       // fiche revérifiée dans Odoo au plus toutes les 10 min par instance (lectures)
const FICHE_ECHEC_MS = 60_000;      // Odoo injoignable : nouvel essai après 1 min (lectures)
const IP_MEMOIRE_MAX = 240;         // garde par instance, avant le compteur durable : épargne la base pendant une crue
const DELAI_ROUTE_MS = 8500;        // une route plus longue répond 503 (Retry-After) avant la coupure de 10 s de Netlify
const FIN_REQUETE_MS = 9000;        // …et au plus tard 9 s après l'arrivée de la requête (contrôles du routeur compris)
const PARAMS_CLE = /^(cle|key|api[_-]?key|token|access[_-]?token|authorization|bearer)$/i;
const nettoyer = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ── Routes ──
// gabarit : nom journalisé ; portee : droit exigé (null : toute clé valide) ; classe : débit ; toujours : servie même
// quand l'API est suspendue ; fiche_fraiche : fiche relue dans Odoo à chaque appel (écritures) ; sans_fiche : aucune
// lecture de la fiche (annulation : la clé et l'accès suffisent, Odoo muet n'empêche jamais d'annuler) ; cle_fraiche : clé
// et accès relus en base à chaque appel (écritures : une clé révoquée ne passe plus, même pendant les 30 s du cache)
export const ROUTES = [
  { methode: "GET", gabarit: "/v1/etat", re: /^\/v1\/etat$/, portee: null, classe: "lecture", toujours: true, traiter: routeEtat },
  ...ROUTES_LECTURE,
  ...ROUTES_COMMANDE,
];

// /api/v1/etat (réécriture de _redirects), /.netlify/functions/api-v1/etat (appel direct) → /v1/etat
export function cheminDe(event) {
  let p = String(event?.path || "/").split("?")[0];
  p = p.replace(/^\/\.netlify\/functions\/api-v1(?=\/|$)/, "").replace(/^\/api(?=\/v1(\/|$))/, "");
  if (!/^\/v1(\/|$)/.test(p)) p = `/v1${p.startsWith("/") ? p : `/${p}`}`;
  return p.replace(/\/+$/, "") || "/v1";
}

// GET /v1/etat : test de connexion (pharmacie, environnement, droits, commandes, limites, version)
async function routeEtat(arg) {
  const { cle, acces, reglages, fiche, environnement, maintenant } = arg;
  await noterParcours(arg, "etat");   // parcours de test (clé elx_test_ seulement)
  const portees = (cle.portees || []).filter(p => (acces.portees || []).includes(p));
  const routeCommande = ROUTES.some(r => r.methode === "POST" && r.gabarit === "/v1/commandes");
  const production = commandesLiveOuvertes(reglages, maintenant);
  return {
    pharmacie: nettoyer(fiche?.name) || acces.nom || null,
    environnement,
    cle: { prefixe: cle.prefixe, libelle: cle.libelle, expire_le: isoParis(cle.expire_le) },
    portees,
    etat_service: reglages.actif ? "normal" : "suspendu",
    commandes: {
      disponibles: routeCommande && reglages.actif && portees.includes("commande") && acces.mode === "auto" && (environnement === "test" || production),
      mode: acces.mode,
      production: production ? "ouvertes" : "fermees",
      delai_annulation_min: acces.delai_annulation_min,
      plafonds: { lignes_par_commande: acces.plafond_lignes, boites_par_commande: acces.plafond_boites,
        montant_ht_par_commande: acces.plafond_montant_ht, commandes_par_jour: acces.plafond_commandes_jour },
      // anomalies nettes : commande gardée « à vérifier » par Elixir (jamais d'envoi automatique) — conception § 6.2
      verification: { active: !!acces.anomalie_active, facteur_habitude_mensuelle: acces.anomalie_active ? acces.anomalie_facteur : null,
        quasi_doublon_min: acces.anomalie_active ? acces.anomalie_doublon_min : null },
    },
    prix: { base: "liste_pharmacie", mention: MENTION_PRIX },
    // limites de CETTE clé (une clé de test a plus de marge pour la commande et la simulation)
    limites: Object.fromEntries(["lecture", "disponibilites", "documents", "commande", "annulation", "simulation"].map(k => [k, limiteDe(k, environnement)])),
    cgu: { version_en_vigueur: CGU.version, acceptee: acces.cgu_version === CGU.version },
    version_api: VERSION_API,
    derniere_modification: DERNIERE_MODIFICATION,
  };
}

// deps (doublures des tests) : stock, maintenant, horloge (ms), verifierFiche(odooId), uuid, log, sel, hasard, odoo (lectures
// de la phase 2, signature de _odoo-rpc.js), quota (contingents, doublure du banc), justificatifs (produits sur justificatif,
// doublure du banc), delaiRouteMs
export function creerHandler(deps = {}) {
  let stockDefaut = null, servicesDefaut = null;
  const stockDe = () => deps.stock || (stockDefaut ||= creerStockApi());
  const maintenant = deps.maintenant || (() => new Date());
  const horloge = deps.horloge || (() => maintenant().getTime());
  const verifierFiche = deps.verifierFiche || ((id) => ficheVerifiee(id));
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const log = deps.log || ((o) => console.log(JSON.stringify({ fn: "api-v1", ...o })));
  const hasard = deps.hasard || Math.random;
  const sel = deps.sel || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "api-elixir";
  // empreinte d'un réseau pour les compteurs (aucune IP en clair en base)
  const hache = (v) => crypto.createHmac("sha256", sel).update(String(v)).digest("hex").slice(0, 24);
  const caches = { cles: new Map(), acces: new Map(), fiches: new Map(), ip: new Map(), usage: new Map(), reglages: null };
  // services des lectures (caches par instance, charge d'Odoo) : créés au premier appel d'une route de lecture
  const servicesDe = (stock) => (servicesDefaut ||= creerServicesLecture({ stock, odoo: deps.odoo, horloge, maintenant, log, quota: deps.quota, justificatifs: deps.justificatifs }));
  const delaiRoute = deps.delaiRouteMs ?? DELAI_ROUTE_MS;
  const borner = (m) => { if (m.size > 5000) m.clear(); };

  async function enCache(map, cle, lire, ms = CACHE_MS) {
    const c = map.get(cle), t = horloge();
    if (c && t - c.at < ms) return c.v;
    const v = await lire();
    borner(map);
    map.set(cle, { at: t, v });
    return v;
  }
  const lireReglages = async (stock) => {
    const t = horloge();
    if (caches.reglages && t - caches.reglages.at < CACHE_MS) return caches.reglages.v;
    const v = fusionnerReglages((await stock.reglages.lire()).valeur);
    caches.reglages = { at: t, v };
    return v;
  };
  // garde par instance (crue) → secondes d'attente, ou 0
  function gardeMemoire(cle) {
    const t = horloge();
    let e = caches.ip.get(cle);
    if (!e || t > e.fin) { borner(caches.ip); e = { n: 0, fin: t + 60_000 }; caches.ip.set(cle, e); }
    return ++e.n > IP_MEMOIRE_MAX ? Math.max(1, Math.ceil((e.fin - t) / 1000)) : 0;
  }
  const resteFenetre = (s) => s - (Math.floor(horloge() / 1000) % s);
  // fiche dans Odoo → { statut: "ok" | "absente" | "bloquee", fiche } ; frais : relue à chaque appel (3 s au plus), Odoo
  // muet ou lent → exception
  const ficheDelai = deps.ficheEcritureMs ?? COMMANDE.fiche_ecriture_ms;
  async function etatFiche(odooId, frais) {
    const c = caches.fiches.get(odooId), t = horloge();
    if (!frais && c && t < c.jusqua) return c.res;
    try {
      let minuteur;
      const p = frais ? await Promise.race([verifierFiche(odooId), new Promise((_, ko) => { minuteur = setTimeout(() => ko(new Error("fiche lente")), ficheDelai); })])
        .finally(() => clearTimeout(minuteur)) : await verifierFiche(odooId);
      const res = !p ? { statut: "absente", fiche: null } : !validCip(p.cip) ? { statut: "bloquee", fiche: p } : { statut: "ok", fiche: p };
      borner(caches.fiches);
      caches.fiches.set(odooId, { jusqua: t + FICHE_MS, res });
      return res;
    } catch (e) {
      if (frais) throw Object.assign(new Error("fiche illisible dans Odoo"), { code: "odoo" });
      log({ code: "fiche_odoo", odoo_id: odooId, erreur: String(e?.message || e).slice(0, 80) });
      const res = c?.res || { statut: "ok", fiche: null };   // lecture : la clé et l'accès suffisent, nouvel essai dans 1 min
      caches.fiches.set(odooId, { jusqua: t + FICHE_ECHEC_MS, res });
      return res;
    }
  }

  async function traiter(event, ctx, stock) {
    const pb = (code, opts) => probleme(event, code, ctx.requestId, opts);
    const ip = ctx.ip, cleReseau = hache(ip ? prefixeIp(ip) : "unknown");

    // 1. débit par IP, avant toute lecture
    const attente = gardeMemoire(cleReseau);
    if (attente) return pb("debit", { entetes: { "Retry-After": String(attente) } });
    const [nIp, nRefus] = await Promise.all([stock.compteurs.compter(`ip:${cleReseau}`, 60),
      stock.compteurs.lire(`ipko:${cleReseau}`, LIMITES.refus_cle.fenetre_s)]);
    if (nIp > LIMITES.ip.par_minute) return pb("debit", { entetes: { "Retry-After": String(resteFenetre(60)) } });
    if (nRefus >= LIMITES.refus_cle.max) return pb("debit", { detail: "Trop de clés refusées depuis votre réseau : réessayez dans quelques minutes.",
      entetes: { "Retry-After": String(resteFenetre(LIMITES.refus_cle.fenetre_s)) } });
    // clé inconnue ou mal formée : comptée sur le réseau ; clé connue mais révoquée ou expirée : comptée sur elle-même
    const refus = () => stock.compteurs.compter(`ipko:${cleReseau}`, LIMITES.refus_cle.fenetre_s).catch(() => 0);
    const refusDeCle = (id) => stock.compteurs.compter(`cleko:${id}`, LIMITES.refus_cle.fenetre_s).catch(() => 0);

    // 2. clé dans l'adresse : refusée (elle est désormais dans des journaux), rattachée à sa clé si elle est valide
    const params = { ...(event.queryStringParameters || {}) };
    for (const [k, v] of Object.entries(event.multiValueQueryStringParameters || {})) params[k] = [].concat(v).join(" ");
    const fuite = Object.entries(params).find(([k, v]) => PARAMS_CLE.test(k) || /elx_(live|test)_/.test(String(v)));
    if (fuite) {
      const valeur = String(fuite[1] || "").match(/elx_(live|test)_[0-9A-Za-z]{40}_[0-9A-Za-z]{6}/)?.[0];
      if (valeur && analyserCle(valeur)) ctx.cle = await stock.cles.parEmpreinte(empreinteCle(valeur)).catch(() => null);
      return pb("cle_dans_url");
    }

    // route (sans authentification : les routes sont publiques dans la documentation)
    const candidates = ROUTES.filter(r => r.re.test(ctx.chemin));
    const route = candidates.find(r => r.methode === ctx.methode);
    if (!candidates.length) return pb("introuvable", { detail: "Cette adresse n'existe pas dans l'API : voir la documentation." });
    if (!route) return pb("methode_non_autorisee", { entetes: { Allow: [...new Set(candidates.map(r => r.methode))].join(", ") } });
    ctx.route = route;
    if (event.body && Buffer.byteLength(event.body, event.isBase64Encoded ? "base64" : "utf8") > CORPS_MAX_OCTETS) return pb("trop_long");

    // 3. clé : format et somme de contrôle (sans lecture), puis empreinte (relue en base pour une écriture)
    const brute = cleDeRequete(event);
    if (!brute) return pb("cle_absente", { entetes: { "WWW-Authenticate": 'Bearer realm="api-elixir"' } });
    const forme = analyserCle(brute);
    if (!forme) { await refus(); return pb("cle_invalide", { entetes: { "WWW-Authenticate": 'Bearer realm="api-elixir", error="invalid_token"' } }); }
    const empreinte = empreinteCle(brute);
    const frais = !!route.cle_fraiche;
    const cle = await enCache(caches.cles, empreinte, () => stock.cles.parEmpreinte(empreinte), frais ? 0 : CACHE_MS);
    if (!cle || cle.environnement !== forme.environnement) { await refus(); return pb("cle_invalide", { entetes: { "WWW-Authenticate": 'Bearer realm="api-elixir", error="invalid_token"' } }); }
    ctx.cle = cle;
    ctx.environnement = cle.environnement;
    // hôte d'aperçu (et lien permanent d'un déploiement, ancien code compris) : jamais de clé de production
    if (ctx.apercu && cle.environnement === "live") return pb("cle_production_hors_site");
    const etat = etatCle(cle, ctx.maintenant);
    if (etat === "revoquee") { await refusDeCle(cle.id); return pb("cle_revoquee"); }
    if (etat === "expiree") { await refusDeCle(cle.id); return pb("cle_expiree"); }

    // 4. accès, interrupteur général, réseaux autorisés, fiche Odoo
    const acces = await enCache(caches.acces, cle.odoo_id, () => stock.acces.lire(cle.odoo_id), frais ? 0 : CACHE_MS);
    if (!acces || !acces.actif) return pb("acces_suspendu");
    const reglages = await lireReglages(stock);
    if (!reglages.actif && !route.toujours) return pb("api_suspendue", { entetes: { "Retry-After": "300" } });
    // réseaux autorisés : adresse vue par Netlify seulement ; absente → refus (jamais d'adresse déclarée par le client)
    if (acces.ip_autorisees?.length && !(ip && ipDansListe(ip, acces.ip_autorisees))) return pb("ip_non_autorisee");
    let fiche = { statut: "ok", fiche: null };
    if (!route.sans_fiche) {
      try { fiche = await etatFiche(acces.odoo_id, !!route.fiche_fraiche); }
      catch { return pb("indisponible", { entetes: { "Retry-After": "60" } }); }
      if (fiche.statut === "absente") return pb("acces_suspendu");
      if (fiche.statut === "bloquee") return pb("compte_bloque");
    }

    // 5. portée : droit de la clé ET de l'accès
    if (route.portee && !((cle.portees || []).includes(route.portee) && (acces.portees || []).includes(route.portee))) return pb("portee_insuffisante");

    // 6. débit par clé (minute et jour de Paris, par classe) : lu d'abord (une requête refusée n'est pas comptée), puis compté
    const lim = limiteDe(route.classe, ctx.environnement);
    const kMin = `cle:${cle.id}:${route.classe}:60`, kJour = `cle:${cle.id}:${route.classe}:86400`;
    const entetesDebit = (n) => ({
      "RateLimit-Policy": `"minute";q=${lim.par_minute};w=60, "jour";q=${lim.par_jour};w=86400`,
      RateLimit: `"minute";r=${Math.max(0, lim.par_minute - n)};t=${resteFenetre(60)}`,
    });
    const refusDebit = (nMin, nJour) => (nMin > lim.par_minute ? pb("debit", { entetes: { ...entetesDebit(nMin), "Retry-After": String(resteFenetre(60)) } })
      : nJour > lim.par_jour ? pb("plafond_journalier", { entetes: { ...entetesDebit(nMin), "Retry-After": String(secondesAvantMinuitParis(ctx.maintenant)) } }) : null);
    const [lMin, lJour] = await Promise.all([stock.compteurs.lire(kMin, 60), stock.compteurs.lire(kJour, 86400)]);
    const avant = refusDebit(lMin + 1, lJour + 1);
    if (avant) return avant;
    const [nMin, nJour] = await Promise.all([stock.compteurs.compter(kMin, 60), stock.compteurs.compter(kJour, 86400)]);
    const debit = entetesDebit(nMin);
    const course = refusDebit(nMin, nJour);   // d'autres requêtes sont passées entre la lecture et le compte
    if (course) return course;

    // dernière utilisation : au plus une écriture par minute et par clé (jamais sur un aperçu)
    if (!ctx.apercu) {
      const vu = caches.usage.get(cle.id);
      if (!vu || horloge() - vu > 60_000) {
        borner(caches.usage);
        caches.usage.set(cle.id, horloge());
        await stock.cles.noterUsage(cle.id, reseauDe(ip)).catch((e) => log({ request_id: ctx.requestId, code: "usage", erreur: String(e?.message || e).slice(0, 80) }));
      }
    }

    // 7. route (coupée à 8,5 s, et 9 s au plus après l'arrivée de la requête ; erreur d'une route → problem+json ; Odoo ou
    // base injoignable → 503 rejouable). echeance : instant après lequel une commande n'écrit plus rien (7 s après l'arrivée).
    const segments = (ctx.chemin.match(route.re) || []).slice(1).map(x => { try { return decodeURIComponent(x); } catch { return x; } });
    let minuteur;
    const reste = Math.max(1, Math.min(delaiRoute, FIN_REQUETE_MS - (horloge() - ctx.debut)));
    const delai = new Promise((_, ko) => { minuteur = setTimeout(() => ko(Object.assign(new Error("délai de la route dépassé"), { code: "delai" })), reste); });
    let corps;
    try {
      corps = await Promise.race([route.traiter({ event, cle, acces, reglages, fiche: fiche.fiche, environnement: ctx.environnement, stock,
        maintenant: ctx.maintenant, requestId: ctx.requestId, apercu: ctx.apercu, params: segments, services: servicesDe(stock),
        horloge, debut: ctx.debut, echeance: ctx.debut + (deps.budgetMs ?? COMMANDE.budget_ms) }), delai]);
    } catch (e) {
      if (e?.api) return pb(e.code, { detail: e.detail, extra: e.extra, entetes: { ...debit, ...(e.retry ? { "Retry-After": String(e.retry) } : {}) } });
      log({ request_id: ctx.requestId, route: route.gabarit, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      return pb("indisponible", { entetes: { ...debit, "Retry-After": "30" } });
    } finally { clearTimeout(minuteur); }
    if (corps && typeof corps.statusCode === "number") return { ...corps, headers: { ...debit, ...corps.headers } };
    return reponseJson(200, corps, ctx.requestId, debit);
  }

  return async (event) => {
    const t0 = horloge();
    const stock = stockDe();
    const ctx = { requestId: uuid(), methode: String(event?.httpMethod || "GET").toUpperCase(), chemin: cheminDe(event),
      apercu: estApercu(event), maintenant: maintenant(), route: null, cle: null, environnement: null, ip: ipClient(event), debut: t0 };
    let reponse;
    try {
      reponse = await traiter(event, ctx, stock);
    } catch (e) {
      log({ request_id: ctx.requestId, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
      reponse = probleme(event, "indisponible", ctx.requestId, { entetes: { "Retry-After": "30" } });
    }
    // journal partout, aperçus compris (table privée) : environnement « apercu » pour un hôte d'aperçu
    const ligne = { request_id: ctx.requestId, cle_id: ctx.cle?.id || null, odoo_id: ctx.cle?.odoo_id || null, environnement: ctx.apercu ? "apercu" : ctx.environnement,
      methode: ctx.methode.slice(0, 10), route: ctx.route?.gabarit || "(inconnue)", statut: reponse.statusCode, code: codeDe(reponse),
      duree_ms: Math.max(0, Math.round(horloge() - t0)), reseau: reseauDe(ctx.ip) };
    log({ request_id: ligne.request_id, odoo_id: ligne.odoo_id, route: ligne.route, statut: ligne.statut, code: ligne.code, duree_ms: ligne.duree_ms, ...(ctx.apercu ? { apercu: true } : {}) });
    // une panne du journal ou du ménage ne change jamais la réponse
    try { await stock.journal.ajouter(ligne); } catch (e) { log({ request_id: ctx.requestId, code: "journal", erreur: String(e?.message || e).slice(0, 80) }); }
    // ménage des compteurs (fenêtres de plus de 2 jours), de temps en temps
    if (!ctx.apercu && hasard() < 0.01) try { await stock.compteurs.purger(); } catch { /* prochain passage */ }
    return reponse;
  };
}

export const handler = creerHandler();
