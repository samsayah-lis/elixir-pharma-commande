// ── API des pharmacies : réponses HTTP (RFC 9457, application/problem+json) ──
// Toute réponse de /api/v1 porte X-Request-Id (repris dans « instance » et dans api_journal pour le support),
// Cache-Control: no-store et X-Content-Type-Options: nosniff. AUCUNE en-tête CORS : l'API s'appelle depuis un serveur ou
// un outil de la pharmacie, jamais depuis une page web (la clé n'a rien à faire dans un navigateur) ; la documentation
// est une page statique du site, qui n'a pas besoin de CORS.
// Les textes ne parlent jamais de la plomberie interne : on écrit « notre système de préparation ».

import crypto from "node:crypto";

const SITE_HOSTS = ["elixir-commande.expepharma.com", "commandes-elixir.netlify.app"];
// Hôte d'aperçu : aperçus de branche, ET lien permanent de chaque déploiement (« <id>--commandes-elixir… »), anciens
// déploiements compris (ils font tourner l'ancien code). Le routeur n'y accepte que les clés de TEST (403
// cle_production_hors_site pour une clé elx_live_) et y tient le journal comme ailleurs.
const APERCU = /^[a-z0-9-]+--commandes-elixir\.netlify\.app$/;
const hote = (event) => String(event?.headers?.host || event?.headers?.Host || "").toLowerCase();
export const estApercu = (event) => APERCU.test(hote(event));
// Adresse du client vue par Netlify (en-tête posé par Netlify, que le client ne peut pas écrire) → texte, ou null si absent.
// Jamais X-Forwarded-For : un contrôle de sécurité (réseaux autorisés, débits) ne se fie pas à une donnée du client.
export function ipClient(event) {
  const h = event?.headers || {};
  const k = Object.keys(h).find(x => x.toLowerCase() === "x-nf-client-connection-ip");
  const v = k ? String(h[k] || "").trim() : "";
  return v || null;
}
// Secret des fonctions d'arrière-plan (x-cron-secret) comparé en temps constant (empreintes de même longueur) ; faux si
// CRON_SECRET n'est pas configuré
export function cronAutorise(event, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const h = event?.headers || {};
  const k = Object.keys(h).find(x => x.toLowerCase() === "x-cron-secret");
  const fourni = k ? String(h[k] ?? "") : "";
  if (!fourni) return false;
  const a = crypto.createHash("sha256").update(fourni).digest(), b = crypto.createHash("sha256").update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}
export const siteBase = (event) => `https://${SITE_HOSTS.includes(hote(event)) ? hote(event) : SITE_HOSTS[0]}`;
// adresse du site pour une fonction planifiée (sans requête entrante) : URL de Netlify si c'est un hôte du site
export const siteBaseEnv = (env = process.env) => { let h = ""; try { h = new URL(String(env.URL || "")).hostname.toLowerCase(); } catch { /* absente */ }
  return `https://${SITE_HOSTS.includes(h) ? h : SITE_HOSTS[0]}`; };
// Lancement du calcul des prix d'une liste (api-prix-background, x-cron-secret) → null si parti, sinon la raison
export async function lancerCalculPrix(base, listeId, { secret = process.env.CRON_SECRET, http = (...a) => fetch(...a) } = {}) {
  if (!secret) return "CRON_SECRET absent";
  try {
    const r = await http(`${base}/.netlify/functions/api-prix-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ liste_id: Number(listeId) }), signal: AbortSignal.timeout(6000) });
    return r.ok || r.status === 202 ? null : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "délai dépassé" : "injoignable";
  }
}

// code → [statut, titre, détail par défaut]
export const CODES = {
  json_invalide: [400, "Corps JSON illisible", "Le corps de la requête n'est pas un JSON valide."],
  idempotency_key_absente: [400, "En-tête Idempotency-Key absent", "Ajoutez un en-tête Idempotency-Key (8 à 128 caractères, un UUID par exemple) : il évite toute commande en double en cas de nouvel essai."],
  cle_dans_url: [400, "Clé transmise dans l'adresse", "La clé ne doit jamais figurer dans l'adresse (elle se retrouve dans des journaux) : envoyez-la dans l'en-tête « Authorization: Bearer … », et remplacez cette clé depuis votre compte."],
  cle_absente: [401, "Clé d'API absente", "Envoyez votre clé dans l'en-tête « Authorization: Bearer elx_… »."],
  cle_invalide: [401, "Clé d'API invalide", "Cette clé n'est pas reconnue : vérifiez qu'elle est recopiée en entier, sans espace."],
  cle_revoquee: [401, "Clé d'API révoquée", "Cette clé a été révoquée : créez-en une nouvelle depuis votre compte (« Accès API »)."],
  cle_expiree: [401, "Clé d'API expirée", "Cette clé a été remplacée et n'est plus valide : utilisez la nouvelle clé."],
  cle_production_hors_site: [403, "Clé de production refusée à cette adresse", "Cette adresse n'est pas celle du service : seules les clés de test (elx_test_) y sont acceptées. Appelez https://elixir-commande.expepharma.com/api/v1/…"],
  portee_insuffisante: [403, "Droit insuffisant", "Cette clé n'a pas le droit nécessaire pour cette opération."],
  ip_non_autorisee: [403, "Réseau non autorisé", "Cette clé ne s'utilise que depuis les réseaux déclarés pour votre pharmacie."],
  acces_suspendu: [403, "Accès suspendu", "L'accès API de votre pharmacie est suspendu : contactez Elixir Pharma."],
  compte_bloque: [403, "Accès indisponible", "L'accès API de votre pharmacie est momentanément indisponible : contactez Elixir Pharma."],
  cgu_a_accepter: [403, "Conditions d'utilisation à accepter", "Acceptez la version en vigueur des conditions d'utilisation de l'API depuis votre compte (« Accès API »)."],
  test_requis: [403, "Mode test à valider", "Validez d'abord le parcours de test avec une clé elx_test_."],
  commandes_bloquees: [403, "Commandes par API suspendues", "Les commandes par API sont suspendues pour votre pharmacie : contactez Elixir Pharma. Le site et votre logiciel d'officine restent disponibles."],
  introuvable: [404, "Introuvable", "Cette ressource n'existe pas (ou n'appartient pas à votre pharmacie)."],
  methode_non_autorisee: [405, "Méthode non autorisée", "Cette adresse n'accepte pas cette méthode."],
  requete_en_cours: [409, "Requête déjà en cours", "La même requête est encore en cours de traitement : réessayez dans quelques secondes."],
  reference_deja_utilisee: [409, "Référence déjà utilisée", "Cette reference_client a déjà servi pour une autre commande."],
  trop_tard: [409, "Trop tard", "La commande est déjà partie vers notre système de préparation : elle ne peut plus être annulée par l'API."],
  trop_long: [413, "Requête trop volumineuse", "Le corps de la requête dépasse 256 Ko."],
  requete_invalide: [422, "Requête invalide", "La requête ne respecte pas le format attendu."],
  idempotency_key_reutilisee: [422, "Idempotency-Key réutilisée", "Cette Idempotency-Key a déjà servi pour une requête différente."],
  aucune_ligne_acceptee: [422, "Aucune ligne acceptée", "Aucune ligne de la commande ne peut être acceptée : rien n'a été enregistré."],
  commande_refusee: [422, "Commande refusée", "Au moins une ligne est refusée et « tout_ou_rien » est demandé : rien n'a été enregistré."],
  plafond_depasse: [422, "Plafond de commande dépassé", "La commande dépasse un plafond de votre accès (lignes, boîtes ou montant) : rien n'a été enregistré. Scindez-la, ou demandez à Elixir Pharma d'ajuster vos plafonds."],
  debit: [429, "Trop de requêtes", "Trop de requêtes en peu de temps : réessayez après le délai indiqué (Retry-After)."],
  plafond_journalier: [429, "Plafond du jour atteint", "Le nombre de requêtes autorisé aujourd'hui pour cette clé est atteint."],
  plafond_commandes_jour: [429, "Commandes du jour atteintes", "Le nombre de commandes par API autorisé aujourd'hui pour votre pharmacie est atteint : rien n'a été enregistré. Le site et votre logiciel d'officine restent disponibles."],
  api_suspendue: [503, "Service suspendu", "L'API est momentanément suspendue. Le site et votre logiciel d'officine restent disponibles."],
  ecriture_suspendue: [503, "Commandes momentanément fermées", "Les commandes par API sont momentanément fermées. Le site et votre logiciel d'officine restent disponibles."],
  contingent_indisponible: [503, "Contingent impossible à vérifier", "La commande contient un produit contingenté et notre système ne répond pas. Rien n'a été enregistré : renvoyez la même requête (même Idempotency-Key) dans une minute."],
  indisponible: [503, "Service momentanément indisponible", "Le service ne répond pas pour l'instant : réessayez dans un instant."],
};

const ENTETES = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function reponseJson(statut, corps, requestId, entetes = {}) {
  return { statusCode: statut, headers: { ...ENTETES, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...entetes },
    body: JSON.stringify(corps) };
}
// → réponse problem+json ; extra : champs propres au problème (erreurs par champ, id existant…)
export function probleme(event, code, requestId, { detail, entetes = {}, extra = {}, statut } = {}) {
  const [s, titre, defaut] = CODES[code] || CODES.indisponible;
  const corps = { type: `${siteBase(event)}/api/#erreur-${code}`, title: titre, status: statut || s, code, detail: detail || defaut,
    instance: `urn:uuid:${requestId}`, ...extra };
  return { statusCode: statut || s, headers: { ...ENTETES, "Content-Type": "application/problem+json; charset=utf-8", "X-Request-Id": requestId, ...entetes },
    body: JSON.stringify(corps) };
}
// Erreur levée par une route (rendue en problem+json par le routeur) : code de CODES, détail, délai, champs propres
export const erreurApi = (code, { detail, retry, extra } = {}) => Object.assign(new Error(code), { api: true, code, detail, retry, extra });

// Fichier (PDF) : corps en base64, téléchargement, jamais gardé en cache
export function reponseFichier(base64, nom, mime, requestId, entetes = {}) {
  return { statusCode: 200, headers: { ...ENTETES, "Content-Type": mime, "Content-Disposition": `attachment; filename="${String(nom).replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
    "X-Request-Id": requestId, ...entetes }, body: base64, isBase64Encoded: true };
}

// Code d'erreur d'une réponse déjà construite (journal)
export const codeDe = (reponse) => { try { return reponse.statusCode >= 400 ? JSON.parse(reponse.body)?.code || null : null; } catch { return null; } };

// Date ISO 8601 à l'heure de Paris, avec son décalage : « 2026-11-16T09:30:12+01:00 » (null si absente ou illisible)
export function isoParis(d) {
  if (d == null || d === "") return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(t).map(x => [x.type, x.value]));
  const decalage = /GMT([+-]\d{2}:\d{2})/.exec(p.timeZoneName)?.[1] || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${decalage}`;
}
