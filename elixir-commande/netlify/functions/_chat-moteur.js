// ── Assistant Elixir : boucle du modèle pour UN tour (conception § 2.3 et 2.4) ──
// Injectable : client Anthropic, définitions et exécutant des outils, horloge et journal sont passés en paramètres
// (tests sur doublures : scripts/test-chat-moteur.mjs, évaluation : scripts/eval-chat.mjs).
// Appel : client.beta.messages.create (sans flux). Le texte n'est pas diffusé mot à mot (le navigateur interroge le
// tour), et en mode sans flux un refus survenu en cours de réponse est retiré par l'API avant le repli : le contenu
// renvoyé est donc rejouable tel quel. Chaque appel est borné par un AbortSignal sur le temps restant du tour.
// Règles :
//  - historique rejoué octet pour octet, blocs de réflexion compris ; le tour n'ajoute que des messages à la fin ;
//  - tool_use → tous les outils en parallèle (6 s chacun), puis UN message « user » avec tous les tool_result ;
//  - max_tokens → rien n'est exécuté, une seule relance avec une limite doublée ; refus → message fixe, la réponse refusée
//    n'est pas ajoutée (chat-tour-background retire aussi le message refusé de l'historique) ; au plus 8 appels et 90 s
//    par tour ;
//  - un tour se termine toujours par une réponse « assistant » dans l'historique (texte du modèle ou message fixe) :
//    le message suivant de la pharmacie, et le message système qui le suit, restent ainsi bien placés.
// Journal : une ligne JSON par appel et par outil (jetons, durée, codes), jamais de texte ni de montant.
import { journalJson, neutraliserLiens } from "./_chat-config.js";

// max_tokens selon l'effort : la réflexion, toujours active sur Opus 5.5, compte dedans ; une réponse coupée est
// relancée une fois avec la limite doublée (plafond MAX_TOKENS_PLAFOND). Appel sans flux, borné par le temps du tour.
export const MAX_TOKENS_EFFORT = Object.freeze({ low: 8000, medium: 16000, high: 32000, xhigh: 64000, max: 64000 });
export const MAX_TOKENS = MAX_TOKENS_EFFORT.low;
export const MAX_TOKENS_PLAFOND = 64000;
export const maxTokensPour = (effort, relance = false) => {
  const base = MAX_TOKENS_EFFORT[effort] || MAX_TOKENS;
  return relance ? Math.min(2 * base, MAX_TOKENS_PLAFOND) : base;
};
export const BETAS = ["server-side-fallback-2026-07-01"]; // en-tête de la forme fallbacks: "default" (la forme tableau prend -06-01)
// outils_ms : délai propre à un outil (la transmission attend l'outil entrepôt puis l'e-mail de repli : jamais abandonnée
// à mi-chemin, sinon le modèle annoncerait un échec alors que la demande part)
export const LIMITES = { appels: 8, tour_ms: 90_000, outil_ms: 6_000, outils_ms: { transmettre_a_un_conseiller: 15_000 }, marge_ms: 3_000 };
export const TAUX_EUR = 0.9;                            // 1 $ = 0,90 € (prudent, conception § 4)
// $ par million de jetons : [entrée, écriture du cache 5 min, écriture du cache 1 h, lecture du cache, sortie]
// (skill claude-api 2.1.299). Haiku 5.5 : écriture 1 h non publiée, comptée au double de l'entrée.
export const TARIFS = {
  "claude-opus-5-5": [4, 5, 8, 0.2, 20],
  "claude-sonnet-5-5": [2, 2.5, 4, 0.2, 10],
  "claude-haiku-5-5": [0.1, 0.125, 0.2, 0.01, 0.5],
  // modèles du repli serveur (fallbacks: "default")
  "claude-opus-5": [5, 6.25, 10, 0.5, 25],
  "claude-opus-4-8": [5, 6.25, 10, 0.5, 25],
};
const TARIF_INCONNU = TARIFS["claude-opus-5"];          // modèle non répertorié : le tarif le plus haut connu

export const ETAPE_DEFAUT = "Je consulte vos informations…";
// Messages fixes (le téléphone et les horaires viennent des réglages, jamais écrits ici)
export const TEXTES = {
  // refus : le message refusé est retiré de l'historique (chat-tour-background) ; aucune suite pilotée par le modèle n'est promise
  refus: (i = {}) => `Je ne peux pas traiter cette demande ici. Reformulez-la${i.telephone ? `, appelez le service client au ${i.telephone}${i.horaires ? ` (${i.horaires})` : ""}` : ""} ou demandez à parler à un conseiller.`,
  limite: () => "Je n'ai pas pu terminer cette recherche. Je peux transmettre votre demande à un conseiller de l'équipe Elixir : souhaitez-vous que je le fasse ?",
  erreur: (i = {}) => `L'assistant rencontre un problème technique. Réessayez dans quelques minutes${i.telephone ? ` ou appelez le service client au ${i.telephone}${i.horaires ? ` (${i.horaires})` : ""}` : ""}.`,
  longue: () => "Cette conversation est devenue trop longue. Ouvrez une nouvelle conversation pour continuer.",
  interrompu: () => "La réponse précédente a été interrompue. Vous pouvez reposer votre question.",
  vide: () => "Pouvez-vous préciser votre demande ?",
  // requête refusée par l'API (400 : historique devenu illisible pour le modèle) : la conversation est close
  bloquee: () => "Cette conversation ne peut pas se poursuivre. Renvoyez votre question : une nouvelle conversation s'ouvrira.",
  cartes: () => "Le résultat s'affiche ci-dessous.",
};

const blocs = (m) => Array.isArray(m?.content) ? m.content : [];
const assistantTexte = (texte) => ({ role: "assistant", content: [{ type: "text", text: texte }] });
const arrondi = (n) => Math.round(n * 1e6) / 1e6;

// ── Paramètres de l'appel (préfixe outils + système identique pour toutes les pharmacies) ──
export function parametresAppel({ modele, effort = "low", systeme, outils, messages, maxTokens = maxTokensPour(effort) }) {
  return {
    model: modele,                       // figé par conversation (la réflexion est liée au modèle)
    max_tokens: maxTokens,
    betas: BETAS,
    fallbacks: "default",                // repli serveur en cas de refus de sécurité
    output_config: { effort },
    // thinking omis : toujours actif sur Opus 5.5 ({type:"disabled"} ou budget_tokens → 400) ; tool_choice omis (auto)
    system: [{ type: "text", text: systeme, cache_control: { type: "ephemeral", ttl: "1h" } }],
    cache_control: { type: "ephemeral" }, // suite de la conversation (5 min), après le préfixe d'1 h
    tools: outils,
    messages,
  };
}

// ── Coût d'un appel : usage.iterations quand il existe (une entrée par tentative, repli compris), sinon usage ──
const tarif = (modele) => {
  const m = String(modele || "");
  const k = Object.keys(TARIFS).filter(x => m === x || m.startsWith(`${x}-`) || m.startsWith(`${x}@`)).sort((a, b) => b.length - a.length)[0];
  return k ? TARIFS[k] : TARIF_INCONNU;
};
const JETONS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];
function coutEntree(u, modele) {
  const [entree, ecr5, ecr1, lecture, sortie] = tarif(modele);
  const creation = Number(u.cache_creation_input_tokens) || 0;
  const detail = u.cache_creation && typeof u.cache_creation === "object" ? u.cache_creation : null;
  const c1h = detail ? Number(detail.ephemeral_1h_input_tokens) || 0 : creation;   // sans détail : tarif 1 h (prudent)
  const c5m = detail ? Number(detail.ephemeral_5m_input_tokens) || 0 : 0;
  return ((Number(u.input_tokens) || 0) * entree + c5m * ecr5 + c1h * ecr1 + (Number(u.cache_read_input_tokens) || 0) * lecture + (Number(u.output_tokens) || 0) * sortie) / 1e6;
}
export function coutAppel(usage, modele) {
  const iterations = Array.isArray(usage?.iterations) && usage.iterations.length ? usage.iterations : null;
  const jetons = Object.fromEntries(JETONS.map(k => [k, 0]));
  let usd = 0;
  for (const u of iterations || [usage || {}]) {
    usd += coutEntree(u, u.model || modele);
    for (const k of JETONS) jetons[k] += Number(u[k]) || 0;
  }
  return { usd, eur: arrondi(usd * TAUX_EUR), jetons, repli: !!iterations?.some(u => u.type === "fallback_message") };
}

// ── Historique ──
// Placement des messages role:"system" (doc Claude) et appariement des outils. → null si valide, sinon la raison.
export function verifierHistorique(messages) {
  if (!Array.isArray(messages) || !messages.length) return "historique vide";
  if (messages[0]?.role !== "user") return "le premier message doit venir de la pharmacie";
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!["user", "assistant", "system"].includes(m?.role)) return `message ${i} : rôle inconnu`;
    if (m.role === "system") {
      if (messages[i - 1]?.role !== "user") return `message système ${i} : il doit suivre un message de la pharmacie`;
      if (messages[i + 1] && messages[i + 1].role !== "assistant") return `message système ${i} : il doit être le dernier ou précéder une réponse du modèle`;
    }
    const ids = m.role === "assistant" ? blocs(m).filter(b => b?.type === "tool_use").map(b => b.id) : [];
    if (ids.length) {
      const suivant = messages[i + 1];
      const recus = new Set(suivant?.role === "user" ? blocs(suivant).filter(b => b?.type === "tool_result").map(b => b.tool_use_id) : []);
      if (ids.some(id => !recus.has(id))) return `message ${i} : appel d'outil sans résultat`;
    }
  }
  return null;
}
// Messages à ajouter pour qu'un historique interrompu se termine par une réponse « assistant »
export function reparerFin(messages, texte = TEXTES.interrompu()) {
  if (!Array.isArray(messages) || !messages.length) return [];
  const dernier = messages[messages.length - 1];
  if (dernier.role === "assistant") {
    const ids = blocs(dernier).filter(b => b?.type === "tool_use").map(b => b.id);
    if (!ids.length) return [];
    return [{ role: "user", content: ids.map(id => ({ type: "tool_result", tool_use_id: id, content: JSON.stringify({ erreur: "Traitement interrompu." }), is_error: true })) },
      assistantTexte(texte)];
  }
  return [assistantTexte(texte)];
}
// Refus final : la question refusée ne reste pas dans l'historique de l'API (sinon chaque message suivant, « oui » compris,
// est refusé à son tour). Retire le dernier message de la pharmacie et le message système qui le suit (la fin de
// l'historique, après tout bloc de réflexion : le préfixe ne change pas, octet pour octet). → { texte, evenements } (les
// événements vérifiés de ce message système, à redire au tour suivant), ou null si la fin n'a pas cette forme.
const PREFIXE_EVENEMENT = "Événement vérifié par le serveur : ";
export function retirerDernierMessage(texte, messages) {
  const n = Array.isArray(messages) ? messages.length : 0;
  const u = messages?.[n - 2], sys = messages?.[n - 1];
  if (n < 2 || u?.role !== "user" || sys?.role !== "system" || blocs(u).some(b => b?.type === "tool_result")) return null;
  const fin = `${JSON.stringify(u)},${JSON.stringify(sys)}]`;
  const t = String(texte ?? "");
  let reste;
  if (n === 2 && t === `[${fin}`) reste = "[]";
  else if (t.endsWith(`,${fin}`)) reste = `${t.slice(0, -(fin.length + 1))}]`;
  else return null;
  const evenements = String(typeof sys.content === "string" ? sys.content : "").split("\n")
    .filter(l => l.startsWith(PREFIXE_EVENEMENT)).map(l => l.slice(PREFIXE_EVENEMENT.length));
  return { texte: reste, evenements };
}

// Réponse d'un repli : blocs internes produits avant le dernier bloc « fallback » retirés (doc Claude, « Echoing
// fallback turns back ») ; sans flux, l'API ne les renvoie déjà pas : le contenu reste alors inchangé.
export function nettoyerContenu(content) {
  const c = Array.isArray(content) ? content : [];
  let bascule = -1;
  c.forEach((b, i) => { if (b?.type === "fallback") bascule = i; });
  if (bascule < 0) return c;
  return c.filter((b, i) => i >= bascule || !["thinking", "redacted_thinking", "tool_use"].includes(b?.type));
}

// ── Texte affiché ──
export { neutraliserLiens };   // défini dans _chat-config.js (aussi appliqué aux demandes, sans charger le moteur)
// contrôle « paiement » (journalisé et compté par l'évaluation, sans réécriture en v1)
export const RE_PAIEMENT = /\b(?:pay[ée]e?s?|impay[ée]e?s?|non pay[ée]e?s?|r[ée]gl[ée]e?s?|sold[ée]e?s?|reste à payer|en retard de paiement|échéance dépassée|encours)\b/i;
const texteVisible = (contenu) => contenu.filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text.trim()).filter(Boolean).join("\n\n");

// ── Erreurs de l'API → code de journal ──
// Sans les classes du SDK (le moteur ne l'importe pas : chat.js reste léger) : abandon par notre signal = délai,
// sinon le statut HTTP ; sans statut, coupure réseau.
export function codeErreurApi(e, abandonne = false) {
  if (abandonne || e?.name === "AbortError" || e?.name === "TimeoutError") return "delai";
  const s = Number(e?.status);
  if (s === 401 || s === 403) return "cle";
  if (s === 429 || s === 529) return "sature";
  if (s >= 400 && s < 500) return "requete";
  if (s >= 500) return "indisponible";
  return /time(?:d)? ?out/i.test(String(e?.message || "")) ? "delai" : "connexion";
}

const avecDelai = (promesse, ms) => new Promise((ok, ko) => {
  const t = setTimeout(() => ko(Object.assign(new Error("délai de l'outil dépassé"), { code: "delai_outil" })), ms);
  promesse.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); ko(e); });
});

// Un outil → { resultat (tool_result), ui (cartes), code }. Ne lève jamais.
async function executerBloc(b, { executer, noms, ms, journal }) {
  if (typeof ms === "function") ms = ms(b.name);
  const debut = Date.now();
  let code = "ok";
  const resultat = (contenu, erreur) => ({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(contenu ?? {}), ...(erreur ? { is_error: true } : {}) });
  try {
    if (!noms.has(b.name)) { code = "inconnu"; return { resultat: resultat({ erreur: "Outil inconnu." }, true), ui: [] }; }
    const r = await avecDelai(Promise.resolve().then(() => executer(b.name, b.input ?? {})), ms);
    if (r?.erreur) code = "erreur_metier";
    return { resultat: resultat(r?.contenu ?? {}, !!r?.erreur), ui: Array.isArray(r?.ui_actions) ? r.ui_actions : [] };
  } catch (e) {
    code = e?.code === "delai_outil" ? "delai" : "exception";
    return { resultat: resultat({ erreur: code === "delai" ? "La consultation a pris trop de temps : réessayez ou proposez la transmission à un conseiller." : "Erreur technique pendant la consultation." }, true), ui: [] };
  } finally {
    journal({ evt: "outil", nom: String(b.name || "").slice(0, 60), duree_ms: Date.now() - debut, code });
  }
}

// ── Un tour ──
// messages : historique complet (se terminant par le message de la pharmacie et le message système du serveur).
// executer(nom, entree) → { contenu, erreur, ui_actions } (exécutant des outils, périmètre déjà appliqué).
// → { nouveaux (messages à ajouter à l'historique), texte, ui_actions, outils, appels, usage, cout_eur, repli, refus,
//     code, duree_ms, alerte_paiement }
export async function jouerTour({
  client, messages, modele, effort = "low", systeme, outils = [], executer, etapes = {}, surEtape = null,
  limites = {}, journal = journalJson, horloge = () => Date.now(), infos = {}, ids = {},
}) {
  const L = { ...LIMITES, ...limites };
  const debut = horloge();
  const log = (o) => { try { journal({ ...ids, ...o }); } catch { /* journal indisponible */ } };
  const hist = [...(messages || [])];
  const nouveaux = [];
  const ajouter = (...m) => { nouveaux.push(...m); hist.push(...m); };
  const res = { texte: "", ui_actions: [], outils: [], appels: 0, usage: Object.fromEntries(JETONS.map(k => [k, 0])), cout_eur: 0,
    repli: false, refus: false, code: "ok", alerte_paiement: false };
  const fin = (code, texte) => { res.code = code; res.texte = texte; ajouter(assistantTexte(texte)); };
  const noms = new Set(outils.map(o => o?.name).filter(Boolean));
  const vus = new Set();
  let usd = 0, relance = false;

  try {
    for (;;) {
      if (res.appels >= L.appels) { fin("limite_appels", TEXTES.limite(infos)); break; }
      const restant = L.tour_ms - (horloge() - debut);
      if (restant < L.marge_ms) { fin("delai", TEXTES.limite(infos)); break; }
      const invalide = verifierHistorique(hist);
      if (invalide) { log({ evt: "historique_invalide", raison: invalide }); fin("historique", TEXTES.erreur(infos)); break; }

      res.appels++;
      const t0 = horloge();
      let r;
      const signal = AbortSignal.timeout(Math.max(1, restant));
      try {
        r = await client.beta.messages.create(parametresAppel({ modele, effort, systeme, outils, messages: hist, maxTokens: maxTokensPour(effort, relance) }),
          { signal, timeout: Math.max(1000, restant) });
      } catch (e) {
        const code = codeErreurApi(e, signal.aborted);
        log({ evt: "appel", appel: res.appels, code, latence_ms: horloge() - t0 });
        fin(code === "delai" ? "delai" : `api_${code}`, code === "delai" ? TEXTES.limite(infos) : TEXTES.erreur(infos));
        break;
      }
      const c = coutAppel(r?.usage, r?.model || modele);
      usd += c.usd;
      for (const k of JETONS) res.usage[k] += c.jetons[k];
      if (c.repli) res.repli = true;
      log({ evt: "appel", appel: res.appels, code: "ok", stop_reason: r?.stop_reason ?? null, modele: r?.model ?? null, repli: c.repli, usage: c.jetons, latence_ms: horloge() - t0 });

      // refus (après repli éventuel) : message fixe, la réponse refusée n'entre pas dans l'historique
      if (r.stop_reason === "refusal") { res.refus = true; fin("refus", TEXTES.refus(infos)); break; }
      // réponse coupée : rien n'est exécuté ni ajouté, une seule relance, avec une limite doublée
      if (r.stop_reason === "max_tokens") {
        if (!relance) { relance = true; continue; }
        fin("max_tokens", TEXTES.limite(infos));
        break;
      }
      const contenu = nettoyerContenu(r.content);
      const demandes = contenu.filter(b => b?.type === "tool_use");
      if (r.stop_reason === "tool_use" && demandes.length) {
        if (res.appels >= L.appels) { fin("limite_appels", TEXTES.limite(infos)); break; }   // plus d'appel pour lire les résultats
        if (surEtape) await Promise.resolve(surEtape(etapes[demandes[0].name] || ETAPE_DEFAUT)).catch(() => {});
        const msOutil = (nom) => Math.min(L.outils_ms?.[nom] || L.outil_ms, Math.max(L.outil_ms, L.tour_ms - (horloge() - debut) - L.marge_ms));
        const faits = await Promise.all(demandes.map(b => executerBloc(b, { executer, noms, ms: msOutil, journal: log })));
        res.outils.push(...demandes.map(b => b.name));
        for (const f of faits) for (const a of f.ui) { const k = JSON.stringify(a); if (!vus.has(k)) { vus.add(k); res.ui_actions.push(a); } }
        ajouter({ role: "assistant", content: contenu }, { role: "user", content: faits.map(f => f.resultat) });
        continue;
      }
      if (r.stop_reason === "pause_turn") { if (contenu.length) ajouter({ role: "assistant", content: contenu }); continue; }
      if (r.stop_reason === "end_turn" || r.stop_reason === "stop_sequence" || r.stop_reason === "tool_use") {
        // réponse vide (rare, après des résultats d'outils) : un message « assistant » sans contenu serait refusé par
        // l'API au tour suivant ; il est remplacé par un texte fixe
        if (!contenu.length) { fin("vide", res.ui_actions.length ? TEXTES.cartes(infos) : TEXTES.vide(infos)); break; }
        ajouter({ role: "assistant", content: contenu });
        res.texte = texteVisible(contenu) || (res.ui_actions.length ? "" : TEXTES.vide(infos));
        break;
      }
      // fenêtre de contexte dépassée ou arrêt inconnu
      fin(r.stop_reason === "model_context_window_exceeded" ? "contexte" : `arret_${String(r.stop_reason || "inconnu").slice(0, 30)}`,
        r.stop_reason === "model_context_window_exceeded" ? TEXTES.longue(infos) : TEXTES.erreur(infos));
      break;
    }
  } catch (e) {
    log({ evt: "tour", code: "exception", erreur: String(e?.message || e).slice(0, 120) });
    ajouter(...reparerFin(hist, TEXTES.erreur(infos)));   // l'historique se termine toujours par une réponse
    res.code = "exception";
    res.texte = TEXTES.erreur(infos);
  }
  res.cout_eur = arrondi(usd * TAUX_EUR);
  res.duree_ms = horloge() - debut;
  res.alerte_paiement = RE_PAIEMENT.test(res.texte);
  if (res.alerte_paiement) log({ evt: "controle_paiement" });
  res.texte = neutraliserLiens(res.texte);
  res.nouveaux = nouveaux;
  return res;
}
