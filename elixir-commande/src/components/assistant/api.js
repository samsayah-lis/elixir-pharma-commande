// ── Assistant Elixir : conversation, attente de la réponse, fichiers (docs/assistant-contrat.md, « API HTTP ») ──
// Chargé avec le panneau (hors du bundle des pharmacies). Identité : src/assistant-client.js (jeton pharmacie, ou
// admin_token + pour_odoo_id en mode « Commander pour une pharmacie »).
// Erreurs : objets Error avec .code — "reconnexion" (401), "fiche" (403), "tour_en_cours" (409), "quota" (429),
// "indisponible" (503), "expiree" (410), "introuvable" (404), "reseau", "delai", "http" — et .message lisible.
import { jetonCourant, renouvelleJeton } from "../../assistant-client.js";

const FONCTIONS = "/.netlify/functions/";

// Appel d'une fonction du chat → { status, ok, json, reponse } ; un 401 d'une pharmacie est rejoué une fois avec un
// jeton renouvelé. Ne lève qu'en cas de coupure réseau ou d'abandon (signal). brut : réponse non lue (fichiers).
export async function requeteAssistant(fn, { corps = null, query = {}, auth = { admin: false }, signal, brut = false } = {}) {
  const params = new URLSearchParams(query);
  if (auth.admin && auth.odooId != null) {
    if (corps) corps = { ...corps, pour_odoo_id: auth.odooId };
    else params.set("pour_odoo_id", String(auth.odooId));
  }
  const url = FONCTIONS + fn + (params.toString() ? `?${params}` : "");
  const envoi = (jeton) => fetch(url, {
    method: corps ? "POST" : "GET", signal, cache: "no-store",
    headers: { ...(corps ? { "Content-Type": "application/json" } : {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  let r = await envoi(jetonCourant(auth));
  if (r.status === 401 && !auth.admin) { const j = await renouvelleJeton(); if (j) r = await envoi(j); }
  if (brut) return { status: r.status, ok: r.ok, json: null, reponse: r };
  const json = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json, reponse: r };
}

const pause = (ms, signal) => new Promise((ok) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); ok(); }, { once: true });
});

const MESSAGES = {
  reconnexion: "Pour protéger vos documents, l'assistant demande une connexion par code reçu par e-mail.",
  fiche: "Votre compte n'est relié à aucune fiche client Elixir : l'assistant n'est pas disponible pour ce compte.",
  tour_en_cours: "Une réponse est déjà en préparation : patientez quelques secondes avant d'envoyer un nouveau message.",
  quota: "Vous avez envoyé beaucoup de messages en peu de temps : réessayez un peu plus tard.",
  indisponible: "L'assistant est momentanément indisponible : réessayez plus tard.",
  expiree: "Ce récapitulatif a expiré : demandez à l'assistant de le préparer à nouveau.",
  introuvable: "Ce lien de téléchargement a expiré : demandez à nouveau le document à l'assistant.",
  reseau: "Connexion impossible : vérifiez votre réseau puis réessayez.",
  delai: "La réponse tarde à arriver.",
  http: "L'assistant n'a pas pu traiter la demande : réessayez dans un instant.",
};
const erreur = (code, message) => Object.assign(new Error(message || MESSAGES[code] || MESSAGES.http), { code });

// statut HTTP → erreur ; le message du serveur (429, 503) est repris s'il est fourni
function verifie(r) {
  if (r.ok) return r.json || {};
  const code = { 401: "reconnexion", 403: "fiche", 404: "introuvable", 409: "tour_en_cours", 410: "expiree", 429: "quota", 503: "indisponible" }[r.status] || "http";
  const texte = typeof r.json?.message === "string" && r.json.message.trim() && ["quota", "indisponible"].includes(code) ? r.json.message.trim().slice(0, 300) : null;
  throw erreur(code, texte);
}
async function appel(corps, auth, signal) {
  let r;
  try { r = await requeteAssistant("chat", { corps, auth, signal }); }
  catch (e) { if (signal?.aborted) throw e; throw erreur("reseau"); }
  return verifie(r);
}

// conversation_id ? reprend celle-là si elle est encore ouverte, sinon le serveur reprend ou crée la conversation ouverte
export const ouvrir = (auth, conversationId, signal) => appel({ action: "ouvrir", ...(conversationId ? { conversation_id: conversationId } : {}) }, auth, signal);
export const nouvelle = (auth, conversationId) => appel({ action: "nouvelle", ...(conversationId ? { conversation_id: conversationId } : {}) }, auth);
// → { tour_id } (202) ; les aperçus (réponses fictives) renvoient aussi le message tout prêt : { tour_id, message }
export const envoyer = (auth, conversationId, texte, contexte) =>
  appel({ action: "message", conversation_id: conversationId, texte, ...(contexte ? { contexte } : {}) }, auth);
// prevenir : saisie Elixir seulement (case « Prévenir la pharmacie », cochée par défaut) ; conversation fermée entre-temps
// (404) : le récapitulatif ne peut plus être confirmé, comme s'il avait expiré
export const decider = (auth, conversationId, demandeId, decision, { prevenir = true } = {}) =>
  appel({ action: "confirmer", conversation_id: conversationId, demande_id: demandeId, decision, ...(auth.admin && !prevenir ? { prevenir_pharmacie: false } : {}) }, auth)
    .catch((e) => { throw e.code === "introuvable" ? erreur("expiree") : e; });

// Attente de la réponse d'un tour : long-poll (le serveur garde la requête jusqu'à 8 s), relancé aussitôt ; au moins
// 0,8 s entre deux requêtes ; 4 échecs de suite ou 3 minutes sans réponse → erreur (le tour peut être repris).
// surEtape(texte | null) : ligne d'état (texte fourni par le serveur). → { message, erreur } ; null si abandonné.
export async function attendreReponse({ auth, tourId, conversationId, signal, surEtape, delaiMax = 180000 }) {
  const fin = Date.now() + delaiMax;
  let echecs = 0;
  while (!signal?.aborted) {
    if (Date.now() > fin) throw erreur("delai");
    const debut = Date.now();
    let r = null;
    try { r = await requeteAssistant("chat", { query: { tour: tourId, conversation_id: conversationId }, auth, signal }); }
    catch { if (signal?.aborted) return null; }
    if (r && r.status === 401) throw erreur("reconnexion");
    if (r && r.status === 404) throw erreur("http");   // tour inconnu (expiré, autre conversation) : rien à attendre
    if (!r || !r.ok || !r.json) {
      if (++echecs >= 4) throw erreur(r ? "http" : "reseau");
      await pause(1500 * echecs, signal);
      continue;
    }
    echecs = 0;
    const j = r.json;
    if (j.statut === "termine") return { message: j.message || null, erreur: false };
    if (j.statut === "erreur") return { message: j.message || null, erreur: true };
    surEtape?.(typeof j.etape === "string" && j.etape.trim() ? j.etape.trim().slice(0, 120) : null);
    const ecoule = Date.now() - debut;
    if (ecoule < 800) await pause(800 - ecoule, signal);
  }
  return null;
}

// Téléchargement d'un fichier préparé par l'assistant (duplicata, relevé) : fetch avec le jeton, puis blob: et
// <a download> (sur iPhone, le PDF s'ouvre dans la visionneuse). Le lien n'est jamais une adresse écrite par le modèle.
export async function telecharger(auth, fichierId, nomParDefaut, nomDepuis) {
  let r;
  try { r = await requeteAssistant("chat-fichier", { query: { id: fichierId }, auth, brut: true }); }
  catch { throw erreur("reseau"); }
  if (!r.ok) verifie(r);
  const blob = await r.reponse.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomDepuis(r.reponse.headers.get("Content-Disposition"), nomParDefaut);
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Conversation et tour en cours gardés pour l'onglet, par identité (pharmacie ou « pour une pharmacie ») : rouvrir le
// panneau reprend la même conversation et, si une réponse était en préparation, son attente
const cle = (identite) => `assistant_conversation_${identite}`;
export function litMemoire(identite) {
  try { const v = JSON.parse(sessionStorage.getItem(cle(identite)) || "null"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export function ecritMemoire(identite, valeur) {
  try {
    if (valeur?.conversation_id) sessionStorage.setItem(cle(identite), JSON.stringify(valeur));
    else sessionStorage.removeItem(cle(identite));
  } catch { /* stockage indisponible (navigation privée) : la conversation ouverte est reprise par le serveur */ }
}
