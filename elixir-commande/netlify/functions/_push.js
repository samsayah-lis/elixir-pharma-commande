// ── Notifications de l'appli Elixir (Web Push) : bibliothèque serveur (docs/notifications.md) ──
// Utilisée par push-abonnement.js (pharmacies), push-admin.js (admin), push-envoi-background.js (messages de l'admin),
// push-programmes.js (messages programmés), push-evenement.js (outil entrepôt) et les envois automatiques (retour en
// stock) : notifierPharmacie(). Messages typés (promotion, communication, réclamation, commande), e-mail de secours et
// API signée : _push-messages.js.
//  • Clés VAPID lues dans les variables Netlify (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) à chaque appel,
//    jamais journalisées ni renvoyées (seule la clé PUBLIQUE sort, c'est son rôle). Une clé absente, illisible ou une
//    paire dépareillée : configPush().ok = false, et toute la fonction se cache (aucune carte, aucun menu côté pharmacies).
//  • Stockage : tables push_* de sql/push-schema.sql (RLS activé, AUCUNE policy) lues avec la clé serveur
//    SUPABASE_SERVICE_ROLE_KEY, comme l'Assistant Elixir (_chat-stock.js). Erreurs sans contenu (ni corps, ni adresse).
//  • Envoi : chiffrement aes128gcm et jeton VAPID par web-push (generateRequestDetails), puis fetch avec un délai
//    (AbortSignal.timeout) : aucun appel à un proxy, et un faux service push local en http est testable
//    (scripts/test-push-serveur.mjs, hotesEssai). 404/410 du service push : abonnement supprimé (téléphone réinitialisé,
//    appli supprimée, autorisation retirée).
//  • Adresses des services push admises (anti-SSRF : le serveur appelle l'adresse donnée par le navigateur) : https sans
//    port ni identifiants, hôtes de Google (FCM), Mozilla, Apple et Microsoft (WNS) seulement (HOTES_PUSH, regles.js) ;
//    aucune redirection suivie (redirect: "manual"). Hôte refusé : noté sans chemin ni jeton (push_hotes_refuses).
//  • Une erreur de CONFIGURATION (sujet VAPID, clés) n'est jamais imputée aux appareils : aucun abonnement supprimé.
//    Seuls 404/410 du service push, une adresse hors liste ou des clés d'appareil illisibles retirent un abonnement.
//  • Identité revérifiée à chaque envoi (lignesDesComptesActuels) : l'e-mail du compte doit toujours être rattaché au
//    CIP de l'abonnement dans elixir_pharmacies ; sinon (pharmacie retirée, e-mail corrigé, ancien salarié) : supprimé.
//  • Écritures groupées par tranches de 100 identifiants (URL PostgREST bornée, ~4 Ko).
// Code compatible Node 18 (NODE_VERSION du build) : pas de toSorted, Object.groupBy, Promise.withResolvers.
import crypto from "node:crypto";
import webpush from "web-push";
import {
  CATEGORIES_DEFAUT, IDS_CATEGORIES, fusionnerReglages, raisonOuverture, lienValide, texteNet, couper, RE_CIP, cipPropre, HOTES_PUSH,
  plafondDe, TYPES_MESSAGE,
} from "../../src/notifications/regles.js";

export const TTL = { offres: 86400, infos: 86400, stock: 43200, commandes: 86400, test: 600 };
export const URGENCE = { offres: "normal", infos: "normal", stock: "high", commandes: "normal", test: "high" };
export const SUJET_DEFAUT = "mailto:pharmacien@elixirpharma.fr";
export const MAX_APPAREILS = 10;          // appareils par pharmacie
export const ECHECS_EN_ALERTE = 3;        // « ⚠ ne répond plus » dans les listes
const ECHECS_SUPPRESSION = 10;            // filet : supprimé après 10 échecs sans succès depuis 30 jours
const JOUR = 86400e3;
export const CONSERVATION = { envois_jours: 90, inactif_jours: 365, hotes_jours: 90 };   // ménage quotidien (push-menage)
export const TRANCHE = 100;               // identifiants par écriture groupée (≈ 4,3 Ko d'URL encodée)
export const TRANCHE_EMAILS = 50;         // e-mails par lecture de elixir_pharmacies
export const ANNONCE_BLOQUEE_MIN = 20;    // annonce « en_cours » depuis plus longtemps : interrompue (fonction coupée à 15 min)
const tranches = (liste, n = TRANCHE) => { const out = []; for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n)); return out; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (v) => UUID.test(String(v || ""));
// catégories plafonnées par 7 jours (une seule diffusion à la fois : index unique push_annonces_une_en_cours)
export const CATEGORIES_PLAFONNEES = ["offres", "infos"];

// ── Petites aides HTTP communes aux trois fonctions ──
const APERCU = /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/;
const SITE_HOSTS = ["commandes-elixir.netlify.app", "elixir-commande.expepharma.com"];
export const estApercu = (event) => APERCU.test(String(event?.headers?.host || event?.headers?.Host || "").toLowerCase());
export const siteBase = (event) => { const h = String(event?.headers?.host || event?.headers?.Host || "").toLowerCase();
  return `https://${SITE_HOSTS.includes(h) ? h : SITE_HOSTS[0]}`; };
// adresse du site pour une fonction planifiée (sans requête entrante) : URL de Netlify si c'est un hôte du site
export const siteBaseEnv = (env = process.env) => { let h = ""; try { h = new URL(String(env.URL || "")).hostname.toLowerCase(); } catch { /* absente */ }
  return `https://${SITE_HOSTS.includes(h) ? h : SITE_HOSTS[0]}`; };
// Lancement de push-envoi-background (comme chat.js → chat-tour-background) → null si elle est partie, sinon la raison
export async function lancerEnvoi(base, id, { secret = process.env.CRON_SECRET, http = (...a) => fetch(...a) } = {}) {
  if (!secret) return "CRON_SECRET absent";
  try {
    const r = await http(`${base}/.netlify/functions/push-envoi-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ annonce: id }), signal: AbortSignal.timeout(6000),
    });
    return r.ok || r.status === 202 ? null : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "délai dépassé" : "injoignable";
  }
}
export const json = (cors, statusCode, corps, cache = "no-store") =>
  ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": cache }, body: JSON.stringify(corps) });
export const jetonDe = (event) => String(event?.headers?.authorization || event?.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
// Limite de débit par instance (comme limiteDebit de chat.js) : cle → [max, fenêtre en s]
export function creerLimiteur() {
  const compteurs = new Map();
  return (cle, max, fenetreS, t = Date.now()) => {
    let e = compteurs.get(cle);
    if (!e || t > e.fin) {
      if (compteurs.size > 5000) for (const [k, v] of compteurs) if (t > v.fin) compteurs.delete(k);
      e = { n: 0, fin: t + fenetreS * 1000 };
      compteurs.set(cle, e);
    }
    return ++e.n <= max ? 0 : Math.max(1, Math.ceil((e.fin - t) / 1000));   // 0 : admis ; sinon secondes à attendre
  };
}
export const empreinte = (v) => crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 32);

// ── base64url ──
const RE_B64U = /^[A-Za-z0-9_-]+$/;
const b64u = (s) => (typeof s === "string" && RE_B64U.test(s) ? Buffer.from(s, "base64url") : null);
const sansEgal = (s) => String(s ?? "").trim().replace(/=+$/, "");

// ── Configuration (variables Netlify) ──
const sujetValide = (s) => /^mailto:[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(s) || /^https:\/\/[^\s]+$/.test(s);
// La configuration est-elle acceptée par web-push lui-même ? (jeton VAPID d'essai, rien n'est envoyé) — même contrôle que
// celui de l'envoi : un sujet https que web-push refuse (« https://elixir%pharma.fr », port invalide…) n'est jamais « prêt ».
// Gardé par instance (sujet + clé publique).
const verifsWebpush = new Map();
function accepteeParWebpush(sujet, pub, priv) {
  const cle = `${sujet}|${pub}|${empreinte(priv)}`;
  if (!verifsWebpush.has(cle)) {
    let ok = true;
    try { webpush.getVapidHeaders("https://fcm.googleapis.com", sujet, pub, priv, "aes128gcm"); } catch { ok = false; }
    if (verifsWebpush.size > 20) verifsWebpush.clear();
    verifsWebpush.set(cle, ok);
  }
  return verifsWebpush.get(cle);
}
// → { ok, service: { vapid_publique, vapid_privee, vapid_paire, sujet, sujet_defaut, cle_serveur, cron_secret }, defauts: [textes],
//     cles: { publicKey, privateKey, subject } | null, cle_publique } — défauts et service ne contiennent AUCUNE valeur de clé
export function configPush(env = process.env) {
  const defauts = [];
  const pub = sansEgal(env.VAPID_PUBLIC_KEY), priv = sansEgal(env.VAPID_PRIVATE_KEY);
  const sujetBrut = String(env.VAPID_SUBJECT || "").trim();
  const service = { vapid_publique: false, vapid_privee: false, vapid_paire: false, sujet: false, sujet_defaut: !sujetBrut,
    cle_serveur: !!(env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_URL), cron_secret: !!env.CRON_SECRET };
  const bp = pub ? b64u(pub) : null, bv = priv ? b64u(priv) : null;
  if (!pub) defauts.push("VAPID_PUBLIC_KEY absente");
  else if (!bp || bp.length !== 65 || bp[0] !== 4) defauts.push("VAPID_PUBLIC_KEY illisible (clé publique P-256 en base64url attendue)");
  else service.vapid_publique = true;
  if (!priv) defauts.push("VAPID_PRIVATE_KEY absente");
  else if (!bv || bv.length !== 32) defauts.push("VAPID_PRIVATE_KEY illisible (clé privée P-256 en base64url attendue)");
  else service.vapid_privee = true;
  if (service.vapid_publique && service.vapid_privee) {
    try { const e = crypto.createECDH("prime256v1"); e.setPrivateKey(bv); service.vapid_paire = e.getPublicKey().equals(bp); } catch { service.vapid_paire = false; }
    if (!service.vapid_paire) defauts.push("VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY ne vont pas ensemble (les deux doivent venir de la même génération)");
  }
  const sujet = sujetBrut || SUJET_DEFAUT;
  if (!sujetValide(sujet)) defauts.push("VAPID_SUBJECT illisible (mailto:adresse ou https://… attendu)");
  else if (service.vapid_paire && !accepteeParWebpush(sujet, pub, priv)) defauts.push("VAPID_SUBJECT refusé par web-push : mettez « mailto:pharmacien@elixirpharma.fr »");
  else service.sujet = true;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) defauts.push("SUPABASE_SERVICE_ROLE_KEY absente");
  if (!env.SUPABASE_URL) defauts.push("SUPABASE_URL absente");
  const ok = service.vapid_paire && service.sujet && service.cle_serveur;
  return { ok, service, defauts, cles: ok ? { publicKey: pub, privateKey: priv, subject: sujet } : null,
    cle_publique: service.vapid_paire ? pub : null, sujet_affiche: service.sujet ? sujet : null };
}

// ── Abonnement envoyé par le navigateur (PushSubscription.toJSON()) ──
// hotesEssai : ["127.0.0.1:<port>"] — tests seulement (faux service push en http) ; jamais passé en production
export function endpointValide(endpoint, hotesEssai = null) {
  const s = String(endpoint || "");
  if (!s || s.length > 1024) return false;
  let u; try { u = new URL(s); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  if (Array.isArray(hotesEssai) && hotesEssai.length && u.protocol === "http:" && hotesEssai.includes(u.host)) return true;
  if (u.protocol !== "https:" || u.port) return false;
  return HOTES_PUSH.some((re) => re.test(u.hostname));
}
// hôte d'une adresse refusée, pour le journal et l'admin (jamais le chemin ni le jeton qu'il contient) ; null si illisible
export function hoteDe(endpoint) {
  try { const h = new URL(String(endpoint || "")).hostname.toLowerCase(); return /^[a-z0-9.-]{1,100}$/.test(h) ? h : null; } catch { return null; }
}
// Clés de l'appareil utilisables pour chiffrer : p256dh = point P-256 non compressé SUR la courbe, auth = 16 octets
let ecdhEssai = null;
export function clesAppareilValides(p256dh, auth) {
  const p = b64u(sansEgal(p256dh)), a = b64u(sansEgal(auth));
  if (!p || p.length !== 65 || p[0] !== 4 || !a || a.length !== 16) return false;
  try { (ecdhEssai ||= (() => { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return e; })()).computeSecret(p); return true; } catch { return false; }
}
// → { ok: true, endpoint, p256dh, auth } | { ok: false, erreur, hote? } (hote : adresse hors liste des services push)
export function validerAbonnement(sub, { hotesEssai = null } = {}) {
  if (!sub || typeof sub !== "object") return { ok: false, erreur: "abonnement absent" };
  const endpoint = String(sub.endpoint || "");
  if (!endpointValide(endpoint, hotesEssai)) return { ok: false, erreur: "adresse du service push refusée", hote: hoteDe(endpoint) };
  const p256dh = sansEgal(sub.keys?.p256dh), auth = sansEgal(sub.keys?.auth);
  const p = b64u(p256dh), a = b64u(auth);
  if (!p || p.length !== 65 || p[0] !== 4) return { ok: false, erreur: "clé p256dh illisible" };
  if (!a || a.length !== 16) return { ok: false, erreur: "secret auth illisible" };
  if (!clesAppareilValides(p256dh, auth)) return { ok: false, erreur: "clé p256dh hors de la courbe P-256" };
  return { ok: true, endpoint, p256dh, auth };
}
// comparaison à temps constant (preuve de possession : secret auth de l'abonnement, connu du navigateur et de la base seulement)
export function memeSecret(a, b) {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Libellé d'appareil (« iPhone · application ») et plateforme envoyés par la page : affichage seulement, jamais l'user-agent
export const libelleNet = (v) => couper(texteNet(v).replace(/[<>]/g, ""), 60) || "Appareil";
const PLATEFORMES = ["ios", "android", "ordinateur", "autre"];
export const plateformeNette = (v) => (PLATEFORMES.includes(v) ? v : "autre");

// Appareil tel que montré à la page ou à l'admin : jamais endpoint, p256dh ni auth
export const appareilPublic = (r, endpointActuel = null) => ({
  id: r.id, appareil: r.appareil || "Appareil", plateforme: r.plateforme || "autre", installe: !!r.installe,
  categories: Array.isArray(r.categories) ? r.categories : [], created_at: r.created_at, last_success_at: r.last_success_at || null,
  en_echec: (r.failures || 0) >= ECHECS_EN_ALERTE, ...(endpointActuel != null ? { actuel: r.endpoint === endpointActuel } : {}),
});

// ── Charge utile (lue par public/sw.js) ──
// { v, categorie, titre, corps, url (chemin du site), tag, id, ts } ; ≤ 3 000 octets (limite des services push : 4 Ko chiffrés)
export function charge({ categorie = null, titre, corps, url, tag, id } = {}, ts = Date.now()) {
  const c = { v: 1, categorie: categorie || null, titre: couper(texteNet(titre), 80) || "Elixir Pharma", corps: couper(texteNet(corps), 240),
    url: lienValide(url) || "/" };
  const t = etiquette(tag, 64);
  if (t) c.tag = t;
  if (id) c.id = String(id).slice(0, 64);
  c.ts = ts;
  const texte = JSON.stringify(c);
  if (Buffer.byteLength(texte) > 3000) throw new Error("notification trop longue");
  return texte;
}
const etiquette = (v, n) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, n) || null;
// en-tête Topic : le service push remplace un message encore non livré de même sujet ([A-Za-z0-9_-], 32 au plus)
export const sujetDe = (tag) => etiquette(tag, 32);

// ── Envoi à des appareils ──
// lignes : lignes de push_abonnements ({ id, endpoint, p256dh, auth, failures, last_success_at }) ; chargeTexte : charge()
// opts : { cles (configPush().cles), ttl, urgence, sujet, delaiMs, parallele } ; deps : { stock, transport, hotesEssai, maintenant, journal }
// → { envoyes, echecs, retires, parLigne: Map(id → { ok, statut, retiree, erreur }) } ; base mise à jour si deps.stock
// Configuration VAPID refusée par web-push : exception { code: "configuration" } AVANT tout envoi, aucune ligne touchée.
// Transport par défaut : fetch sans suivre les redirections (une redirection = échec, jamais un autre hôte appelé).
export async function envoyerAAppareils(lignes, chargeTexte, opts = {}, deps = {}) {
  const { cles, ttl = 3600, urgence = "normal", sujet = null, delaiMs = 5000, parallele = 20 } = opts;
  if (!cles) throw Object.assign(new Error("clés VAPID absentes"), { code: "configuration" });
  // configuration commune (sujet, clés) contrôlée une fois : jamais comptée comme une erreur des appareils
  try { webpush.getVapidHeaders("https://fcm.googleapis.com", cles.subject, cles.publicKey, cles.privateKey, "aes128gcm"); }
  catch { throw Object.assign(new Error("configuration VAPID refusée par web-push"), { code: "configuration" }); }
  const transport = deps.transport || ((u, init) => fetch(u, { ...init, redirect: "manual" }));
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || (() => {});
  const topic = sujetDe(sujet);
  const parLigne = new Map();
  const un = async (l) => {
    if (!endpointValide(l.endpoint, deps.hotesEssai)) return { ok: false, statut: 0, retiree: true, erreur: "adresse refusée", hote: hoteDe(l.endpoint) };
    // clés de l'appareil illisibles : l'abonnement ne pourra jamais servir (seul cas de retrait avant l'envoi)
    if (!clesAppareilValides(l.p256dh, l.auth)) return { ok: false, statut: 0, retiree: true, erreur: "clés de l'appareil illisibles" };
    let d;
    try {
      d = webpush.generateRequestDetails({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } }, chargeTexte,
        { vapidDetails: cles, TTL: ttl, urgency: urgence, ...(topic ? { topic } : {}) });
    } catch { return { ok: false, statut: 0, erreur: "préparation" }; }   // jamais imputé à l'appareil : rien de retiré
    const headers = { ...d.headers };
    delete headers["Content-Length"];   // calculé par fetch
    try {
      const r = await transport(d.endpoint, { method: d.method, headers, body: d.body, signal: AbortSignal.timeout(delaiMs) });
      try { await r.text(); } catch { /* corps illisible : sans importance */ }
      if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) return { ok: false, statut: r.status, erreur: "redirection" };
      if (r.status >= 200 && r.status < 300) return { ok: true, statut: r.status };
      if (r.status === 404 || r.status === 410) return { ok: false, statut: r.status, retiree: true, erreur: `HTTP ${r.status}` };
      return { ok: false, statut: r.status, erreur: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, statut: 0, erreur: e?.name === "TimeoutError" || e?.name === "AbortError" ? "délai dépassé" : "injoignable" };
    }
  };
  // file partagée par `parallele` travailleurs
  const file = lignes.slice();
  const travailleur = async () => { for (let l = file.shift(); l; l = file.shift()) parLigne.set(l.id, await un(l)); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallele, file.length)) }, travailleur));

  let envoyes = 0, echecs = 0, retires = 0;
  const ok = [], aRetirer = [], enEchec = [];
  for (const l of lignes) {
    const r = parLigne.get(l.id);
    if (!r) continue;
    if (r.ok) { envoyes++; ok.push(l.id); }
    else if (r.retiree) { retires++; aRetirer.push(l.id); }
    else { echecs++; enEchec.push([l, r]); }
  }
  // hôtes hors liste rencontrés en base (lignes anciennes) : journal et admin, sans chemin ni jeton
  const hotes = [...new Set([...parLigne.values()].map((r) => r.hote).filter(Boolean))];
  for (const hote of hotes) journal({ evt: "push_envoi", code: "hote_refuse", hote });
  if (deps.stock) {
    const iso = maintenant().toISOString();
    const limite = maintenant().getTime() - 30 * JOUR;
    const a = deps.stock.abonnements;
    // filet : trop d'échecs d'affilée et aucun succès depuis 30 jours → supprimé
    for (const [l] of enEchec) if ((l.failures || 0) + 1 >= ECHECS_SUPPRESSION && !(Date.parse(l.last_success_at || "") > limite)) aRetirer.push(l.id);
    await Promise.all([
      ok.length ? a.succes(ok, iso).catch((e) => journal({ evt: "push_base", code: "succes", erreur: e.message })) : null,
      aRetirer.length ? a.supprimerIds(aRetirer).catch((e) => journal({ evt: "push_base", code: "retrait", erreur: e.message })) : null,
      ...enEchec.filter(([l]) => !aRetirer.includes(l.id)).map(([l, r]) =>
        a.echec(l.id, (l.failures || 0) + 1, iso, r.erreur).catch((e) => journal({ evt: "push_base", code: "echec", erreur: e.message }))),
      ...hotes.map((h) => deps.stock.hotes?.noter(h).catch(() => {})),
    ]);
  }
  return { envoyes, echecs, retires, parLigne };
}

// Lignes « pharmacie » dont l'e-mail du compte est TOUJOURS rattaché au CIP de l'abonnement (elixir_pharmacies, clé
// serveur) ; les autres (pharmacie retirée par la synchro, e-mail corrigé ou passé à une autre officine, ancien salarié)
// sont supprimées. Lignes admin : gardées (tests et aperçus de l'admin qui les demande). Lecture impossible : exception
// (rien n'est envoyé plutôt qu'envoyé à un appareil qui n'a plus le droit).
export async function lignesDesComptesActuels(stock, lignes, { journal = () => {}, supprimer = true } = {}) {
  const pharmacie = lignes.filter((l) => l.role === "pharmacie");
  if (!pharmacie.length) return lignes;
  const emailDe = (l) => String(l.compte_email || "").trim().toLowerCase();
  const actuels = await stock.comptes([...new Set(pharmacie.map(emailDe).filter(Boolean))]);
  const garder = [], retirer = [];
  for (const l of lignes) {
    if (l.role !== "pharmacie") garder.push(l);
    else if (actuels.get(emailDe(l)) === String(l.pharmacy_cip)) garder.push(l);
    else retirer.push(l.id);
  }
  if (retirer.length && supprimer) {
    await stock.abonnements.supprimerIds(retirer).catch((e) => journal({ evt: "push_base", code: "retrait", erreur: e.message }));
    journal({ evt: "push_abonnement", code: "compte_retire", n: retirer.length });
  }
  return garder;
}

// ── Stockage Supabase (tables push_*, clé serveur) ──
const COLS = "id,endpoint,p256dh,auth,role,pharmacy_cip,pharmacie_nom,compte_email,categories,appareil,plateforme,installe,created_at,updated_at,last_seen_at,last_success_at,last_failure_at,failures,last_error";
const COLS_ANNONCE = "id,idem,titre,corps,url,audience,cips,admin_email,statut,erreur,nb_visees,nb_plafonnees,nb_pharmacies,nb_appareils,nb_reussis,nb_echecs,nb_retires,created_at,started_at,finished_at"
  // sql/push-messages.sql : types, programmation, e-mail de secours
  + ",type,categorie,repli_email,programme_pour,annule_at,annule_par,destinataire_nom,email_statut,nb_emails,source";
const COLS_ENVOI = "id,categorie,annonce_id,tag,nb_appareils,nb_reussis,created_at,titre,type,source,email";
const COLS_EVENEMENT = "cle,pharmacy_cip,type,statut,reference,titre,recu_le,traite_le,resultat,nb_appareils,nb_reussis";
const COLS_MODELE = "id,nom,type,titre,corps,url,admin_email,created_at,updated_at";
const CHAMPS_ENVOI_MESSAGES = ["titre", "type", "source", "email"];   // colonnes de sql/push-messages.sql
const enc = encodeURIComponent;
const listeIn = (v) => `(${v.map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",")})`;
const lireJson = (t, d) => { try { return JSON.parse(t); } catch { return d; } };

// deps : fetch, url, cle, maintenant (doublures des tests). Tables absentes → erreur { code: "schema" } ; clé absente → { code: "configuration" }
export function creerStockPush(deps = {}) {
  const url = deps.url || process.env.SUPABASE_URL;
  const cle = deps.cle || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const http = deps.fetch || ((...a) => fetch(...a));
  const maintenant = deps.maintenant || (() => new Date());
  const iso = () => maintenant().toISOString();

  async function sb(path, { method = "GET", body, prefer } = {}) {
    if (!cle || !url) throw Object.assign(new Error("clé serveur Supabase absente"), { code: "configuration" });
    const headers = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await http(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    if (!res.ok) {
      const pg = lireJson(text, {})?.code;
      const schema = res.status === 404 || pg === "PGRST205" || pg === "42P01" || pg === "PGRST204" || pg === "42703";
      throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} : HTTP ${res.status}${pg ? ` (${pg})` : ""}`),
        { status: res.status, pg, ...(schema ? { code: "schema" } : {}) });
    }
    return text ? lireJson(text, null) : null;
  }
  async function tout(path, max = 20_000) {
    const out = [];
    for (let de = 0; de < max; de += 1000) {
      const rows = (await sb(`${path}&limit=1000&offset=${de}`)) || [];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }
  const doublon = (e) => e?.status === 409 || e?.pg === "23505";
  // une écriture par tranche de TRANCHE identifiants (URL bornée) ; une tranche en échec n'arrête pas les autres,
  // l'erreur est levée à la fin (« n tranches sur m en échec »)
  async function parTranches(liste, fn, n = TRANCHE) {
    const t = tranches(liste, n);
    let echecs = 0, derniere = null;
    for (const morceau of t) { try { await fn(morceau); } catch (e) { echecs++; derniere = e; } }
    if (echecs) throw Object.assign(new Error(`${echecs} tranche(s) sur ${t.length} en échec : ${derniere?.message || derniere}`), { code: derniere?.code });
    return null;
  }

  const abonnements = {
    async parEndpoint(endpoint) {
      const [r] = (await sb(`push_abonnements?endpoint=eq.${enc(endpoint)}&select=${COLS}&limit=1`)) || [];
      return r || null;
    },
    // identite : { role: "pharmacie", cip } | { role: "admin", email }
    deIdentite(identite) {
      return identite.role === "admin"
        ? sb(`push_abonnements?role=eq.admin&compte_email=eq.${enc(identite.email)}&select=${COLS}&order=created_at.asc&limit=50`).then((r) => r || [])
        : sb(`push_abonnements?role=eq.pharmacie&pharmacy_cip=eq.${enc(identite.cip)}&select=${COLS}&order=created_at.asc&limit=50`).then((r) => r || []);
    },
    // nouvelle ligne, ou ligne du même endpoint remplacée (identité, clés, catégories, libellé)
    async enregistrer(ligne) {
      const [r] = (await sb(`push_abonnements?on_conflict=endpoint&select=${COLS}`, { method: "POST",
        prefer: "resolution=merge-duplicates,return=representation", body: { ...ligne, updated_at: iso() } })) || [];
      return r || null;
    },
    async modifier(id, champs) {
      const [r] = (await sb(`push_abonnements?id=eq.${enc(id)}&select=${COLS}`, { method: "PATCH", prefer: "return=representation",
        body: { ...champs, updated_at: iso() } })) || [];
      return r || null;
    },
    supprimerIds(ids) { return ids.length ? parTranches(ids, (t) => sb(`push_abonnements?id=in.${listeIn(t)}`, { method: "DELETE" })) : null; },
    succes(ids, quand = iso()) {
      return parTranches(ids, (t) => sb(`push_abonnements?id=in.${listeIn(t)}`, { method: "PATCH", body: { last_success_at: quand, failures: 0, last_error: null } }));
    },
    // ménage : appareils de pharmacie sans ouverture du site depuis `avant` (ISO) — dernière ouverture, sinon création
    purgerInactifs(avant) {
      const a = enc(avant);
      return sb(`push_abonnements?role=eq.pharmacie&or=(last_seen_at.lt.${a},and(last_seen_at.is.null,created_at.lt.${a}))`, { method: "DELETE" });
    },
    echec(id, failures, quand = iso(), erreur = null) {
      return sb(`push_abonnements?id=eq.${enc(id)}`, { method: "PATCH", body: { failures, last_failure_at: quand, last_error: erreur ? String(erreur).slice(0, 60) : null } });
    },
    // appareils d'une pharmacie qui reçoivent une catégorie
    dePharmacie(cip) { return sb(`push_abonnements?role=eq.pharmacie&pharmacy_cip=eq.${enc(cip)}&select=${COLS}&limit=50`).then((r) => r || []); },
    // message : appareils des pharmacies abonnées à la catégorie (offres par défaut ; audience : CIP choisis, ou toutes)
    async pourAnnonce({ cips = null, categorie = "offres" } = {}) {
      const base = `push_abonnements?role=eq.pharmacie&categories=cs.${enc(`{${IDS_CATEGORIES.includes(categorie) ? categorie : "offres"}}`)}`;
      if (!cips) return tout(`${base}&select=${COLS}&order=id.asc`);
      const liste = [...new Set(cips.map(String).filter((c) => RE_CIP.test(c)))];
      const out = [];
      for (const t of tranches(liste)) out.push(...await tout(`${base}&pharmacy_cip=in.${listeIn(t)}&select=${COLS}&order=id.asc`));
      return out;
    },
    tous() { return tout(`push_abonnements?select=${COLS}&order=id.asc`); },
    // appareils (rôle pharmacie) de plusieurs CIP : recherche de l'admin, joignabilité
    async deCips(cips) {
      const liste = [...new Set(cips.map(String).filter((c) => RE_CIP.test(c)))];
      const out = [];
      for (const t of tranches(liste)) out.push(...await tout(`push_abonnements?role=eq.pharmacie&pharmacy_cip=in.${listeIn(t)}&select=${COLS}&order=id.asc`));
      return out;
    },
  };

  let cacheReglages = null;   // { valeur, fin } : 60 s par instance
  const reglages = {
    async lire({ frais = false } = {}) {
      if (!frais && cacheReglages && cacheReglages.fin > Date.now()) return cacheReglages.valeur;
      const [r] = (await sb("push_reglages?id=eq.1&select=valeur,updated_at&limit=1")) || [];
      const valeur = fusionnerReglages(r?.valeur);
      cacheReglages = { valeur, fin: Date.now() + 60_000 };
      return valeur;
    },
    async ecrire(valeur) {
      await sb("push_reglages?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
        body: { id: 1, valeur: JSON.stringify(valeur), updated_at: iso() } });
      cacheReglages = null;
      return fusionnerReglages(valeur);
    },
  };

  const annonces = {
    // → { annonce, existante } ; même clé d'idempotence (double clic, réponse perdue) : l'annonce déjà créée
    async creer(ligne) {
      try {
        const [r] = (await sb(`push_annonces?select=${COLS_ANNONCE}`, { method: "POST", prefer: "return=representation", body: ligne })) || [];
        return { annonce: r || null, existante: false };
      } catch (e) {
        if (doublon(e) && ligne.idem) return { annonce: await annonces.parIdem(ligne.idem), existante: true };
        throw e;
      }
    },
    async parIdem(idem) { const [r] = (await sb(`push_annonces?idem=eq.${enc(idem)}&select=${COLS_ANNONCE}&limit=1`)) || []; return r || null; },
    async lire(id) { if (!estUuid(id)) return null; const [r] = (await sb(`push_annonces?id=eq.${id}&select=${COLS_ANNONCE}&limit=1`)) || []; return r || null; },
    // titres et types de plusieurs messages (historique d'une pharmacie : lignes d'envoi d'avant sql/push-messages.sql)
    async parIds(ids) {
      const liste = [...new Set(ids.filter(estUuid))];
      const out = [];
      for (const t of tranches(liste, 50)) out.push(...((await sb(`push_annonces?id=in.${listeIn(t)}&select=id,titre,type,categorie`)) || []));
      return out;
    },
    // messages PLAFONNÉS (offres, informations) en file ou en cours, créés depuis `depuis` (ISO) ; les messages
    // transactionnels (commandes) ne bloquent jamais les autres
    enCours(depuis) { return sb(`push_annonces?statut=in.(en_file,en_cours)&categorie=in.(offres,infos)&created_at=gte.${enc(depuis)}&select=id,statut,created_at&limit=5`).then((r) => r || []); },
    // message plafonné en cours de diffusion (un seul à la fois : index unique push_annonces_une_en_cours), quelle que soit sa date
    diffusionEnCours() { return sb("push_annonces?statut=eq.en_cours&categorie=in.(offres,infos)&select=id,statut,created_at,started_at&limit=5").then((r) => r || []); },
    // ── programmation (push-programmes.js, toutes les 5 minutes) ──
    // messages programmés dont l'heure est passée (au plus 20 par passage, les plus anciens d'abord)
    dus(avantIso) { return sb(`push_annonces?statut=eq.programmee&programme_pour=lte.${enc(avantIso)}&select=${COLS_ANNONCE}&order=programme_pour.asc&limit=20`).then((r) => r || []); },
    // programmée → en_file, une seule fois (deux passages simultanés : un seul gagne) ; null si plus « programmée »
    async passerEnFile(id) {
      if (!estUuid(id)) return null;
      const [r] = (await sb(`push_annonces?id=eq.${id}&statut=eq.programmee&select=${COLS_ANNONCE}`, { method: "PATCH", prefer: "return=representation",
        body: { statut: "en_file", created_at: iso() } })) || [];
      return r || null;
    },
    // programmée → annulée (admin, avant l'envoi) ; null si déjà partie, annulée ou inconnue
    async annuler(id, admin) {
      if (!estUuid(id)) return null;
      const [r] = (await sb(`push_annonces?id=eq.${id}&statut=eq.programmee&select=${COLS_ANNONCE}`, { method: "PATCH", prefer: "return=representation",
        body: { statut: "annulee", annule_at: iso(), annule_par: String(admin || "").slice(0, 120) || null, finished_at: iso() } })) || [];
      return r || null;
    },
    // programmée trop en retard (service arrêté plusieurs heures) : jamais envoyée, erreur expliquée
    async abandonner(id, texte) {
      if (!estUuid(id)) return null;
      const [r] = (await sb(`push_annonces?id=eq.${id}&statut=eq.programmee&select=id`, { method: "PATCH", prefer: "return=representation",
        body: { statut: "erreur", erreur: String(texte).slice(0, 300), finished_at: iso() } })) || [];
      return r || null;
    },
    // messages restés « en file » (lancement perdu, autre diffusion en cours) entre `depuis` et `avant` : relancés
    enFile(depuis, avant) { return sb(`push_annonces?statut=eq.en_file&created_at=gte.${enc(depuis)}&created_at=lt.${enc(avant)}&select=id,statut,categorie,created_at,source&order=created_at.asc&limit=20`).then((r) => r || []); },
    programmees(limite = 50) { return sb(`push_annonces?statut=eq.programmee&select=${COLS_ANNONCE}&order=programme_pour.asc&limit=${Math.max(1, Math.min(200, limite | 0))}`).then((r) => r || []); },
    // annonce « en_cours » depuis plus de ANNONCE_BLOQUEE_MIN (fonction coupée) : passée en erreur, le verrou est libéré
    liberer(avant) {
      return sb(`push_annonces?statut=eq.en_cours&started_at=lt.${enc(avant)}`, { method: "PATCH",
        body: { statut: "erreur", erreur: "Envoi interrompu (fonction coupée) : une partie des pharmacies a pu la recevoir.", finished_at: iso() } });
    },
    // en_file → en_cours, une seule fois (double lancement sans effet) ; une autre annonce déjà en cours (index unique,
    // 409/23505) : null, l'annonce reste « en_file » (« Relancer » plus tard) — deux diffusions ne se chevauchent jamais
    async reclamer(id) {
      if (!estUuid(id)) return null;
      await annonces.liberer(new Date(maintenant().getTime() - ANNONCE_BLOQUEE_MIN * 60e3).toISOString()).catch(() => {});
      try {
        const [r] = (await sb(`push_annonces?id=eq.${id}&statut=eq.en_file&select=${COLS_ANNONCE}`, { method: "PATCH",
          prefer: "return=representation", body: { statut: "en_cours", started_at: iso() } })) || [];
        return r || null;
      } catch (e) { if (doublon(e)) return null; throw e; }
    },
    terminer(id, champs) { return sb(`push_annonces?id=eq.${id}`, { method: "PATCH", body: { ...champs, finished_at: iso() } }); },
    // historique : programmés d'abord (par date prévue), puis les autres (les plus récents d'abord)
    async lister(limite = 50) {
      const n = Math.max(1, Math.min(200, limite | 0));
      const [prog, autres] = await Promise.all([annonces.programmees(50),
        sb(`push_annonces?statut=neq.programmee&select=${COLS_ANNONCE}&order=created_at.desc&limit=${n}`).then((r) => r || [])]);
      return [...prog, ...autres];
    },
  };

  const envois = {
    // lignes avec titre, type, source, e-mail (sql/push-messages.sql) ; colonnes absentes (script pas encore passé) :
    // ré-écrites sans ces champs, le plafond et la traçabilité restent justes
    async ajouter(lignes) {
      if (!lignes.length) return null;
      try { return await parTranches(lignes, (t) => sb("push_envois", { method: "POST", prefer: "return=minimal", body: t }), 500); }
      catch (e) {
        if (e?.code !== "schema" || !lignes.some((l) => CHAMPS_ENVOI_MESSAGES.some((k) => k in l))) throw e;
        const base = lignes.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !CHAMPS_ENVOI_MESSAGES.includes(k))));
        return parTranches(base, (t) => sb("push_envois", { method: "POST", prefer: "return=minimal", body: t }), 500);
      }
    },
    // e-mail de secours d'un message unitaire : noté sur la ligne de la pharmacie
    noterEmail(annonceId, cip, statut) {
      return sb(`push_envois?annonce_id=eq.${enc(annonceId)}&pharmacy_cip=eq.${enc(cip)}`, { method: "PATCH", body: { email: statut } });
    },
    // nombres réels d'une annonce après l'envoi : reussis = Map(cip → appareils joints) ; une écriture par valeur et par tranche
    async corriger(annonceId, reussis) {
      const parValeur = new Map();
      for (const [cip, n] of reussis) { if (!parValeur.has(n)) parValeur.set(n, []); parValeur.get(n).push(cip); }
      for (const [n, cips] of parValeur)
        await parTranches(cips, (t) => sb(`push_envois?annonce_id=eq.${enc(annonceId)}&pharmacy_cip=in.${listeIn(t)}`, { method: "PATCH", body: { nb_reussis: n } }));
    },
    // CIP → nombre d'envois réussis (≥ 1 appareil joint) d'une catégorie plafonnée (offres par défaut) depuis `depuis` (ISO)
    async plafond(depuis, categorie = "offres") {
      const rows = await tout(`push_envois?categorie=eq.${enc(categorie)}&nb_reussis=gt.0&created_at=gte.${enc(depuis)}&select=pharmacy_cip&order=id.asc`);
      const n = new Map();
      for (const r of rows) n.set(r.pharmacy_cip, (n.get(r.pharmacy_cip) || 0) + 1);
      return n;
    },
    // CIP → nombre d'envois TENTÉS (≥ 1 appareil visé) depuis `depuis` : plafond de sécurité « commandes » (24 h)
    async tentatives(depuis, categorie = "commandes", cips = null) {
      const filtre = Array.isArray(cips) && cips.length ? `&pharmacy_cip=in.${listeIn(cips.slice(0, TRANCHE))}` : "";
      const rows = await tout(`push_envois?categorie=eq.${enc(categorie)}&nb_appareils=gt.0&created_at=gte.${enc(depuis)}${filtre}&select=pharmacy_cip&order=id.asc`);
      const n = new Map();
      for (const r of rows) n.set(r.pharmacy_cip, (n.get(r.pharmacy_cip) || 0) + 1);
      return n;
    },
    // historique d'une pharmacie (90 jours : purge des envois), les plus récents d'abord
    dePharmacie(cip, limite = 50) {
      return sb(`push_envois?pharmacy_cip=eq.${enc(cip)}&select=${COLS_ENVOI}&order=created_at.desc&limit=${Math.max(1, Math.min(200, limite | 0))}`).then((r) => r || []);
    },
    async dejaEnvoye(cip, tag) {
      const rows = (await sb(`push_envois?pharmacy_cip=eq.${enc(cip)}&tag=eq.${enc(tag)}&nb_reussis=gt.0&select=id&limit=1`)) || [];
      return rows.length > 0;
    },
    purger(avant) { return sb(`push_envois?created_at=lt.${enc(avant)}`, { method: "DELETE" }); },
  };

  // nom de la pharmacie (affichage de l'admin) : compte du jeton, comme auth.js (même e-mail → même CIP)
  async function nomPharmacie(email) {
    const [r] = (await sb(`elixir_pharmacies?email=eq.${enc(String(email || "").toLowerCase())}&select=name&limit=1`).catch(() => [])) || [];
    return r?.name ? String(r.name).slice(0, 120) : null;
  }
  // e-mails de compte → CIP actuel (nettoyé, null si illisible) dans elixir_pharmacies (email unique : on_conflict de la
  // synchro) ; e-mail absent de la table : absent de la Map. Exception si la lecture échoue.
  async function comptes(emails) {
    const out = new Map();
    for (const t of tranches(emails, TRANCHE_EMAILS)) {
      const rows = (await sb(`elixir_pharmacies?email=in.${enc(listeIn(t))}&select=email,cip`)) || [];
      for (const r of rows) out.set(String(r.email || "").trim().toLowerCase(), cipPropre(r.cip));
    }
    return out;
  }

  // Adresses de COMPTE d'une pharmacie (lignes de elixir_pharmacies portant ce CIP), seules destinataires de l'e-mail de
  // secours : jamais l'e-mail de la fiche Odoo, qui peut être celui d'une autre officine du même titulaire (piège de la
  // saisie pour une pharmacie). → [{ email, name, ville }]
  const compteNet = (r) => ({ email: String(r.email || "").trim().toLowerCase(), name: r.name ? String(r.name).slice(0, 120) : null,
    ville: r.ville ? String(r.ville).slice(0, 80) : null, cip: cipPropre(r.cip) });
  const adresseValide = (e) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i.test(e);
  async function comptesDuCip(cip) {
    const c = cipPropre(cip);
    if (!c) return [];
    const rows = (await sb(`elixir_pharmacies?cip=eq.${enc(c)}&select=email,name,ville,cip&order=email.asc&limit=20`)) || [];
    return rows.map(compteNet).filter((r) => adresseValide(r.email));
  }
  // mêmes lignes pour plusieurs CIP (pharmacies choisies dans l'admin : nom, ville, adresses de secours)
  async function comptesDesCips(cips) {
    const liste = [...new Set(cips.map(cipPropre).filter(Boolean))];
    const out = [];
    for (const t of tranches(liste, TRANCHE_EMAILS)) out.push(...((await sb(`elixir_pharmacies?cip=in.${enc(listeIn(t))}&select=email,name,ville,cip&order=email.asc`)) || []));
    return out.map(compteNet).filter((r) => r.cip && adresseValide(r.email));
  }
  // Recherche de l'admin (nom, ville ou CIP) dans les comptes du site : seules ces pharmacies peuvent avoir des appareils ou
  // une adresse de secours. → lignes { email, name, cip, ville } (60 au plus)
  async function chercherPharmacies(q) {
    const texte = String(q || "").normalize("NFC").replace(/[^\p{L}\p{N}' -]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    const chiffres = String(q || "").replace(/\D/g, "");
    if (texte.length < 2 && chiffres.length < 3) return [];
    const ou = [];
    if (texte.length >= 2) ou.push(`name.ilike."*${texte}*"`, `ville.ilike."*${texte}*"`);
    if (chiffres.length >= 3) ou.push(`cip.like.${chiffres.slice(0, 14)}*`);
    return (await sb(`elixir_pharmacies?or=${enc(`(${ou.join(",")})`)}&select=email,name,cip,ville&order=name.asc&limit=60`)) || [];
  }
  // pharmacies clientes avec un CIP lisible (estimation « toutes » : non abonnées), gardé 10 min par instance
  let cacheClientes = null;
  async function cipsClientes() {
    if (cacheClientes && cacheClientes.fin > Date.now()) return cacheClientes.valeur;
    const rows = await tout("elixir_pharmacies?select=cip&order=email.asc");
    const valeur = new Set(rows.map((r) => cipPropre(r.cip)).filter(Boolean));
    cacheClientes = { valeur, fin: Date.now() + 600_000 };
    return valeur;
  }

  // Modèles enregistrés par l'admin (« Enregistrer comme modèle »)
  const modeles = {
    lister(limite = 100) { return sb(`push_modeles?select=${COLS_MODELE}&order=nom.asc&limit=${Math.max(1, Math.min(200, limite | 0))}`).then((r) => r || []); },
    async creer(m) {
      try {
        const [r] = (await sb(`push_modeles?select=${COLS_MODELE}`, { method: "POST", prefer: "return=representation", body: { ...m, updated_at: iso() } })) || [];
        return { modele: r || null, doublon: false };
      } catch (e) { if (doublon(e)) return { modele: null, doublon: true }; throw e; }
    },
    supprimer(id) { return estUuid(id) ? sb(`push_modeles?id=eq.${id}`, { method: "DELETE" }) : null; },
  };

  // Événements de l'outil entrepôt (push-evenement.js) : clé d'idempotence = clé primaire, empreinte (pharmacie, type,
  // référence, statut) unique : un même statut d'une même référence n'est notifié qu'une fois
  const evenements = {
    // → { nouveau: true, ligne } | { nouveau: false, ligne (existante, par clé ou par empreinte) }
    async reserver(ligne) {
      try {
        const [r] = (await sb(`push_evenements?select=${COLS_EVENEMENT},empreinte`, { method: "POST", prefer: "return=representation", body: ligne })) || [];
        return { nouveau: true, ligne: r || ligne };
      } catch (e) {
        if (!doublon(e)) throw e;
        const [r] = (await sb(`push_evenements?or=${enc(`(cle.eq."${ligne.cle}",empreinte.eq."${ligne.empreinte}")`)}&select=${COLS_EVENEMENT},empreinte&limit=1`)) || [];
        return { nouveau: false, ligne: r || null };
      }
    },
    terminer(cle, champs) { return sb(`push_evenements?cle=eq.${enc(cle)}`, { method: "PATCH", body: { ...champs, traite_le: iso() } }); },
    lister(limite = 50) { return sb(`push_evenements?select=${COLS_EVENEMENT}&order=recu_le.desc&limit=${Math.max(1, Math.min(200, limite | 0))}`).then((r) => r || []); },
    purger(avant) { return sb(`push_evenements?recu_le=lt.${enc(avant)}`, { method: "DELETE" }); },
  };

  // services push refusés (hôte seulement) : admin → État du service, pour élargir HOTES_PUSH à bon escient
  const hotes = {
    noter(hote) { return sb("push_hotes_refuses?on_conflict=hote", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { hote, vu_le: iso() } }); },
    lister(limite = 10) { return sb(`push_hotes_refuses?select=hote,vu_le&order=vu_le.desc&limit=${Math.max(1, Math.min(50, limite | 0))}`).then((r) => r || []); },
    purger(avant) { return sb(`push_hotes_refuses?vu_le=lt.${enc(avant)}`, { method: "DELETE" }); },
  };

  return { abonnements, reglages, annonces, envois, nomPharmacie, comptes, hotes, comptesDuCip, comptesDesCips, chercherPharmacies, cipsClientes, modeles, evenements };
}

// ── Statistiques de l'admin ──
// lignes : toutes les lignes de push_abonnements → { stats, pharmacies (500 au plus, par nom), admins: Map(email → lignes) }
export function statistiques(lignes, maintenant = new Date()) {
  const pharmacieLignes = lignes.filter((l) => l.role === "pharmacie" && l.pharmacy_cip);
  const parCip = new Map();
  for (const l of pharmacieLignes) {
    if (!parCip.has(l.pharmacy_cip)) parCip.set(l.pharmacy_cip, []);
    parCip.get(l.pharmacy_cip).push(l);
  }
  const par_categorie = { stock: 0, commandes: 0, infos: 0, offres: 0 };
  const par_plateforme = { ios: 0, android: 0, ordinateur: 0, autre: 0 };
  let installes = 0, en_echec = 0, vus_30j = 0;
  const limite = maintenant.getTime() - 30 * JOUR;
  for (const l of pharmacieLignes) {
    par_plateforme[PLATEFORMES.includes(l.plateforme) ? l.plateforme : "autre"]++;
    if (l.installe) installes++;
    if ((l.failures || 0) >= ECHECS_EN_ALERTE) en_echec++;
    if (Date.parse(l.last_seen_at || l.created_at || "") > limite) vus_30j++;
  }
  const pharmacies = [];
  for (const [cip, ls] of parCip) {
    const cats = new Set(ls.flatMap((l) => (Array.isArray(l.categories) ? l.categories : [])));
    for (const c of cats) if (c in par_categorie) par_categorie[c]++;
    pharmacies.push({ cip, nom: ls.map((l) => l.pharmacie_nom).find(Boolean) || null, appareils: ls.length,
      plateformes: [...new Set(ls.map((l) => l.plateforme || "autre"))], categories: IDS_CATEGORIES.filter((c) => cats.has(c)),
      en_echec: ls.filter((l) => (l.failures || 0) >= ECHECS_EN_ALERTE).length });
  }
  pharmacies.sort((a, b) => String(a.nom || a.cip).localeCompare(String(b.nom || b.cip), "fr"));
  return {
    stats: { pharmacies: parCip.size, appareils: pharmacieLignes.length, par_categorie, par_plateforme, installes, en_echec, vus_30j },
    pharmacies: pharmacies.slice(0, 500),
  };
}

// ── Messages de l'admin (annonces « Offres et nouveautés », puis types : docs/notifications.md § 4) ──
// Envois déjà reçus par pharmacie dans la fenêtre du plafond de la catégorie → { plafond (null : aucun), deja: Map(cip → n) }
//  • offres, infos : envois RÉUSSIS (≥ 1 appareil joint) sur 7 jours glissants ;
//  • commandes : envois TENTÉS (≥ 1 appareil visé) sur 24 h glissantes (plafond de sécurité, hors plafonds marketing).
export async function dejaRecus(stock, categorie, reglages, maintenant = () => new Date(), cips = null) {
  const p = plafondDe(categorie, reglages);
  if (!p) return { plafond: null, deja: new Map() };
  const depuis = new Date(maintenant().getTime() - p.fenetreMs).toISOString();
  if (categorie === "commandes") return { plafond: p, deja: await stock.envois.tentatives(depuis, "commandes", cips) };
  return { plafond: p, deja: p.max > 0 ? await stock.envois.plafond(depuis, categorie) : new Map() };
}

// Destinataires d'un message : appareils abonnés à la catégorie, ouverture et audience respectées, plafond appliqué.
// audience : « toutes » | « liste » | « une » (cips) ; categorie : offres (défaut), infos, commandes
// → { visees, plafonnees, recevront, appareils, lignes (retenues), parCip: Map(cip → lignes retenues), fermee, reglages,
//     plafond, cipsPlafonnes: [cip], injoignables: [cip] (une ou liste : CIP choisis sans appareil abonné ou hors ouverture) }
// Comptes revérifiés (lignesDesComptesActuels) : envoi réel → appareils dont le compte n'est plus rattaché au CIP écartés ET
// supprimés ; estimation de l'admin (lecture seule) → seulement écartés.
export async function destinataires(stock, { audience = "toutes", cips = null, categorie = "offres" } = {}, { maintenant = () => new Date(), supprimer = false, journal } = {}) {
  const reglages = await stock.reglages.lire({ frais: true });
  const choisis = audience === "toutes" ? null : [...new Set((cips || []).map(String))];
  if (reglages.ouverture === "fermee") return { visees: 0, plafonnees: 0, recevront: 0, appareils: 0, lignes: [], parCip: new Map(), fermee: true, reglages,
    plafond: plafondDe(categorie, reglages), cipsPlafonnes: [], injoignables: choisis || [] };
  let lignes = await stock.abonnements.pourAnnonce({ cips: choisis, categorie });
  lignes = lignes.filter((l) => l.role === "pharmacie" && l.pharmacy_cip && (l.categories || []).includes(categorie)
    && (reglages.ouverture === "toutes" || reglages.pilote_cips.includes(l.pharmacy_cip)));
  lignes = await lignesDesComptesActuels(stock, lignes, { journal, supprimer });
  const tous = new Map();
  for (const l of lignes) { if (!tous.has(l.pharmacy_cip)) tous.set(l.pharmacy_cip, []); tous.get(l.pharmacy_cip).push(l); }
  const { plafond, deja } = await dejaRecus(stock, categorie, reglages, maintenant, categorie === "commandes" ? [...tous.keys()] : null);
  const parCip = new Map(), cipsPlafonnes = [];
  for (const [cip, ls] of tous) {
    if (plafond && (deja.get(cip) || 0) >= plafond.max) cipsPlafonnes.push(cip);
    else parCip.set(cip, ls);
  }
  const retenues = [...parCip.values()].flat();
  return { visees: tous.size, plafonnees: cipsPlafonnes.length, recevront: parCip.size, appareils: retenues.length, lignes: retenues, parCip, fermee: false, reglages,
    plafond, cipsPlafonnes, injoignables: choisis ? choisis.filter((c) => !tous.has(c)) : [] };
}

// L'e-mail de secours d'un message unitaire peut-il partir ? (la pharmacie n'a été jointe sur aucun appareil)
// Jamais quand le plafond l'a écartée. Promotion et Communication : jamais quand elle a des appareils et a coupé cette
// alerte sur tous (son choix est respecté). Réclamation / SAV et Commande : oui (suivi de son dossier, voie habituelle).
// → { ok: true } | { ok: false, raison: "plafond" | "alerte_coupee" | "jointe" }
export function repliPermis({ categorie, jointe, plafonnee, appareilsPharmacie = [] }) {
  if (jointe) return { ok: false, raison: "jointe" };
  if (plafonnee) return { ok: false, raison: "plafond" };
  if (categorie !== "commandes" && appareilsPharmacie.length && !appareilsPharmacie.some((l) => (l.categories || []).includes(categorie)))
    return { ok: false, raison: "alerte_coupee" };
  return { ok: true };
}

// Envoi d'un message (push-envoi-background) : réclamation (une diffusion PLAFONNÉE à la fois), destinataires (comptes
// revérifiés), push_envois écrits AVANT l'envoi (le plafond compte le message même si la fonction est coupée), envoi,
// nombres réels, e-mail de secours (message unitaire, deps.repli : _push-messages.js), clôture, purge 90 jours.
// deps : { stock, config, transport, hotesEssai, maintenant, parallele, delaiMs, journal, repli } → { lancee, statut, ... }
export async function diffuserAnnonce(id, deps = {}) {
  const stock = deps.stock || creerStockPush();
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || (() => {});
  const a = await stock.annonces.reclamer(id);
  if (!a) return { lancee: false };
  try {
    const conf = deps.config || configPush();
    if (!conf.ok) {
      await stock.annonces.terminer(a.id, { statut: "erreur", erreur: "Configuration incomplète (clés VAPID ou clé serveur)." });
      return { lancee: true, statut: "erreur" };
    }
    const categorie = IDS_CATEGORIES.includes(a.categorie) ? a.categorie : "offres";
    const type = TYPES_MESSAGE[a.type] ? a.type : "promotion";
    const unitaire = a.audience === "une" && Array.isArray(a.cips) && a.cips.length === 1;
    const avecRepli = unitaire && a.repli_email === true && typeof deps.repli === "function";
    const d = await destinataires(stock, { audience: a.audience, cips: a.cips, categorie }, { maintenant, supprimer: true, journal });
    if (d.fermee && !avecRepli) {
      await stock.annonces.terminer(a.id, { statut: "erreur", erreur: "Ouverture « fermée » : aucune pharmacie ne reçoit encore les notifications.",
        nb_visees: 0, nb_plafonnees: 0, nb_pharmacies: 0, nb_appareils: 0, nb_reussis: 0, nb_echecs: 0, nb_retires: 0 });
      return { lancee: true, statut: "erreur" };
    }
    // étiquette : offres comme avant ; autres messages « msg-… » (une notification identique remplace la précédente)
    const tag = `${categorie === "offres" ? "offre" : "msg"}-${String(a.id).slice(0, 8)}`;
    const titreEnvoi = couper(texteNet(a.titre), 80);
    // plafond : une ligne par pharmacie AVANT l'envoi, comptée comme servie (provisoire) ; écriture impossible → rien ne part
    await stock.envois.ajouter([...d.parCip].map(([cip, ls]) => ({ categorie, pharmacy_cip: cip, annonce_id: a.id, tag,
      nb_appareils: ls.length, nb_reussis: ls.length, titre: titreEnvoi, type, source: "message" })));
    const r = d.lignes.length
      ? await envoyerAAppareils(d.lignes, charge({ categorie, titre: a.titre, corps: a.corps, url: a.url, tag, id: a.id }, maintenant().getTime()),
        { cles: conf.cles, ttl: TTL[categorie], urgence: URGENCE[categorie], sujet: tag, delaiMs: deps.delaiMs ?? 5000, parallele: deps.parallele ?? 20 },
        { stock, transport: deps.transport, hotesEssai: deps.hotesEssai, maintenant, journal })
      : { envoyes: 0, echecs: 0, retires: 0, parLigne: new Map() };
    // nombres réels (seulement ceux qui diffèrent du provisoire)
    const reussis = new Map();
    let servies = 0;
    const jointes = new Set();
    for (const [cip, ls] of d.parCip) {
      const n = ls.filter((l) => r.parLigne.get(l.id)?.ok).length;
      if (n > 0) { servies++; jointes.add(cip); }
      if (n !== ls.length) reussis.set(cip, n);
    }
    if (reussis.size) await stock.envois.corriger(a.id, reussis).catch((e) => journal({ evt: "push_annonce", code: "envois", erreur: e.message }));
    // e-mail de secours (message unitaire) : la pharmacie n'a été jointe sur aucun appareil
    let email = { email_statut: null, nb_emails: null };
    if (avecRepli) {
      const cip = String(a.cips[0]);
      const appareilsPharmacie = await stock.abonnements.dePharmacie(cip).catch(() => []);
      const permis = repliPermis({ categorie, jointe: jointes.has(cip), plafonnee: d.cipsPlafonnes.includes(cip), appareilsPharmacie });
      if (permis.ok) {
        const e = await deps.repli({ annonce: { ...a, categorie, type }, cip }).catch(() => ({ statut: "echec", nb: 0 }));
        email = { email_statut: e.statut, nb_emails: e.nb || 0 };
        if (d.parCip.has(cip)) await stock.envois.noterEmail(a.id, cip, e.statut).catch(() => {});
        else await stock.envois.ajouter([{ categorie, pharmacy_cip: cip, annonce_id: a.id, tag, nb_appareils: 0, nb_reussis: 0, titre: titreEnvoi, type,
          source: "message", email: e.statut }]).catch(() => {});
      } else email = { email_statut: "non_requis", nb_emails: 0 };
    }
    await stock.annonces.terminer(a.id, { statut: "envoyee", erreur: d.fermee ? "Ouverture « fermée » : e-mail de secours seulement." : null,
      nb_visees: d.visees, nb_plafonnees: d.plafonnees, nb_pharmacies: servies, nb_appareils: d.lignes.length, nb_reussis: r.envoyes, nb_echecs: r.echecs,
      nb_retires: r.retires, ...(avecRepli ? email : {}) });
    await stock.envois.purger(new Date(maintenant().getTime() - CONSERVATION.envois_jours * JOUR).toISOString()).catch(() => {});
    return { lancee: true, statut: "envoyee", envoyes: r.envoyes, echecs: r.echecs, retires: r.retires, ...(avecRepli ? { email: email.email_statut } : {}) };
  } catch (e) {
    journal({ evt: "push_annonce", code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) });
    await stock.annonces.terminer(a.id, { statut: "erreur", erreur: e?.code === "schema" ? "Tables absentes ou à compléter : exécutez sql/push-schema.sql puis sql/push-messages.sql."
      : e?.code === "configuration" ? "Configuration VAPID refusée (VAPID_SUBJECT ?) : aucun abonnement n'a été touché." : "Erreur technique pendant l'envoi." })
      .catch(() => {});
    return { lancee: true, statut: "erreur" };
  }
}

// ── Ménage quotidien (push-menage, planifié) ──
// envois > 90 jours ; appareils de pharmacie sans ouverture du site depuis 12 mois ; appareils dont le compte n'est plus
// rattaché au CIP ; annonce bloquée « en_cours » (fonction coupée) ; services push refusés > 90 jours ; événements de l'outil
// entrepôt > 90 jours.
// → bilan { envois, inactifs, comptes, annonces, hotes, evenements } (« ok » ou « erreur » par étape : une étape en échec
// n'arrête pas les suivantes)
export async function menage(deps = {}) {
  const stock = deps.stock || creerStockPush();
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || (() => {});
  const avant = (jours) => new Date(maintenant().getTime() - jours * JOUR).toISOString();
  const bilan = {};
  const etape = async (nom, fn) => {
    try { bilan[nom] = (await fn()) ?? "ok"; }
    catch (e) { bilan[nom] = "erreur"; journal({ evt: "push_menage", etape: nom, code: e?.code || "erreur", erreur: String(e?.message || e).slice(0, 120) }); }
  };
  await etape("envois", () => stock.envois.purger(avant(CONSERVATION.envois_jours)).then(() => "ok"));
  await etape("inactifs", () => stock.abonnements.purgerInactifs(avant(CONSERVATION.inactif_jours)).then(() => "ok"));
  await etape("comptes", async () => {
    const lignes = (await stock.abonnements.tous()).filter((l) => l.role === "pharmacie");
    const gardees = await lignesDesComptesActuels(stock, lignes, { journal });
    return lignes.length - gardees.length;
  });
  await etape("annonces", () => stock.annonces.liberer(new Date(maintenant().getTime() - ANNONCE_BLOQUEE_MIN * 60e3).toISOString()).then(() => "ok"));
  await etape("hotes", () => stock.hotes.purger(avant(CONSERVATION.hotes_jours)).then(() => "ok"));
  if (stock.evenements) await etape("evenements", () => stock.evenements.purger(avant(CONSERVATION.envois_jours)).then(() => "ok"));
  return bilan;
}

// ── Point d'accroche des envois automatiques (retour en stock, outil entrepôt : docs/notifications.md § 9) ──
// notifierPharmacie(cip, "stock" | "commandes" | "infos" | "offres", { titre, corps, url, tag }, opts) → { envoyes, echecs, retires, raison }
// NE LÈVE JAMAIS : un e-mail ou un traitement qui l'appelle ne doit jamais échouer à cause d'une notification.
// raison : null (envoyé) | "categorie" | "configuration" | "schema" | "fermee" | "hors_pilote" | "deja_envoye" | "plafond"
//          | "aucun_appareil" | "erreur"
// opts : { delaiMs (4000 par défaut), unique (ne pas renvoyer la même étiquette à la même pharmacie), type, source (tracés
//          dans push_envois : historique de la pharmacie), stock, config, transport, hotesEssai, maintenant, journal }
// Plafonds : offres et infos (7 jours, envois réussis), commandes (sécurité, 24 h, envois tentés) ; retour en stock : aucun.
// Appareils : ceux de la pharmacie (rôle pharmacie, CIP du jeton à l'abonnement) qui ont gardé la catégorie et dont le
// compte est toujours rattaché à ce CIP (lignesDesComptesActuels : sinon supprimés, jamais servis).
export async function notifierPharmacie(cip, categorie, { titre, corps, url, tag } = {}, opts = {}) {
  const rien = (raison) => ({ envoyes: 0, echecs: 0, retires: 0, raison });
  try {
    if (!IDS_CATEGORIES.includes(categorie)) return rien("categorie");
    const c = cipPropre(cip);   // « 0 », « false », espaces : jamais une identité
    if (!c) return rien("aucun_appareil");
    const conf = opts.config || configPush();
    if (!conf.ok) return rien("configuration");
    const stock = opts.stock || creerStockPush();
    const maintenant = opts.maintenant || (() => new Date());
    const reglages = await stock.reglages.lire();
    const fermee = raisonOuverture(reglages, c);
    if (fermee) return rien(fermee);
    const t = etiquette(tag, 64);
    if (opts.unique && t && await stock.envois.dejaEnvoye(c, t)) return rien("deja_envoye");
    const { plafond, deja } = await dejaRecus(stock, categorie, reglages, maintenant, [c]);
    if (plafond && (deja.get(c) || 0) >= plafond.max) return rien("plafond");
    let lignes = (await stock.abonnements.dePharmacie(c)).filter((l) => (l.categories || []).includes(categorie));
    if (lignes.length) lignes = await lignesDesComptesActuels(stock, lignes, { journal: opts.journal });
    if (!lignes.length) return rien("aucun_appareil");
    const r = await envoyerAAppareils(lignes, charge({ categorie, titre, corps, url, tag: t }, maintenant().getTime()),
      { cles: conf.cles, ttl: TTL[categorie], urgence: URGENCE[categorie], sujet: t, delaiMs: opts.delaiMs ?? 4000 },
      { stock, transport: opts.transport, hotesEssai: opts.hotesEssai, maintenant, journal: opts.journal });
    await stock.envois.ajouter([{ categorie, pharmacy_cip: c, tag: t, nb_appareils: lignes.length, nb_reussis: r.envoyes,
      titre: couper(texteNet(titre), 80) || null, ...(opts.type ? { type: String(opts.type).slice(0, 20) } : {}), source: opts.source ? String(opts.source).slice(0, 20) : categorie }]).catch(() => {});
    return { envoyes: r.envoyes, echecs: r.echecs, retires: r.retires, raison: null };
  } catch (e) {
    return rien(e?.code === "schema" ? "schema" : e?.code === "configuration" ? "configuration" : "erreur");
  }
}

// Catégories par défaut d'un nouvel abonnement (rappel pour les fonctions)
export { CATEGORIES_DEFAUT };
