// ── Accueil « La Tête de gondole » : GET des offres de la page d'accueil (docs/accueil.md) ──
// GET /.netlify/functions/accueil-offres  (Authorization: Bearer <jeton pharmacie> ou <jeton admin>)
// Le classement des ventes est une information commerciale : réservé aux pharmacies connectées (compte du jeton) et à
// l'admin (saisie pour une pharmacie, aperçu de l'admin). Sans jeton valide → 401 { error: "reconnexion" } ; compte
// inconnu → 403 { error: "fiche" } ; Supabase Auth en panne → 503 « indisponible ».
// → { version, genere_le, periode: { du, au, jours }, slides (12 au plus), reserves (8 au plus), perime, vedettes }
// vedettes (toujours présent, même périmé) : les mises en avant de Zineb visibles maintenant (_accueil-vedettes.js),
// configuration relue à chaque appel (ec_config « accueil_vedettes », lue en parallèle du cache). Jeton admin seulement :
// vedettes_etat (état de chaque mise en avant publiée) et ?verifier=cip,cip (brouillon de l'éditeur : verification).
// Mises en avant d'outils (_accueil-outils.js) : lectures des seuls outils mis en avant en ce moment (aucune sans outil),
// en parallèle du contexte, chacune bornée (DELAI_OUTILS_MS : un outil lent passe en donnees_indisponibles, la réponse
// part sans lui) ; chiffres publics dans vedettes.items[].chiffres ; admin : outils_etat (les 6 outils, masqués compris,
// avec les chiffres réservés à l'admin : en_menu, honnetes, correspondance, comptes), pour l'éditeur — sauf ?verifier=
// (recherche « Un produit » de l'éditeur : seule la vérification des produits est lue, aucun outil ; les états des
// mises en avant d'outils de cette réponse ne sont donc pas significatifs, l'éditeur ne les lit pas).
// Prix et stock relus à chaque appel (fusion de products-get, sinon règle de la Saisie) : une diapositive passée en
// rupture est remplacée par la première réserve. Jamais de compte exact (tranches, courbe normalisée), jamais de stock.
// Cache absent (premier appel après la mise en ligne) : calcul sous verrou (60 s), terminé au plus tard 7 s après le début
// de l'appel (Netlify coupe la fonction à 10 s : le verrou est rendu, la réponse part), 3,5 s au plus par appel Odoo ;
// sinon perime: true. Échec ou classement vide : marqueur kv « accueil:echec », pas de nouveau calcul pendant 10 min
// (la fonction planifiée, elle, recalcule à son heure).
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { reponseIndisponible } from "./auth.js";
import { creerSources, calculerClassement, lireContexte, lireConfigAccueil, CLE_CACHE, CLE_JOURNAL, CLE_ECHEC } from "./_accueil-donnees.js";
import { publique, cipsDuCache, VERSION, jourParis } from "./_accueil-selection.js";
import { evaluerVedettes, cipsVedettes, cipsAVerifier, verification } from "./_accueil-vedettes.js";
import { OUTILS_MEA, outilsAEvaluer, lireOutils, evaluerOutil } from "./_accueil-outils.js";

const ECHEANCE_MS = 7000;          // depuis le début de l'appel (plafond Netlify : 10 s)
const DELAI_ODOO_MS = 3500;        // par appel Odoo, connexion comprise
const PAUSE_ECHEC_MS = 10 * 60e3;  // après un échec du calcul au premier appel
const DELAI_OUTILS_MS = 2500;      // lectures des outils (la page passe sur son repli à 4 s : un outil lent ne doit pas l'y mener)
const enc = encodeURIComponent;

export function creerHandler(deps = {}) {
  return async (event) => {
    const cors = getCors(event);
    const repondre = (statusCode, corps, cache = "no-store") => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": cache, Vary: "Authorization" }, body: JSON.stringify(corps) });
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
    if (event.httpMethod !== "GET") return repondre(405, { error: "Méthode non autorisée" });
    const limite = (deps.rateLimit || rateLimit)(event, 30, 60);
    if (limite) return { ...limite, headers: { ...cors, ...limite.headers } };
    const src = creerSources(deps, { delaiOdoo: DELAI_ODOO_MS });
    const echeance = src.maintenant() + ECHEANCE_MS;
    try {
      // accès : jeton vérifié AVANT toute lecture
      const jeton = String(event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
      let user = null;
      try { user = jeton ? await src.verifierJeton(jeton) : null; }
      catch (e) { if (e?.indisponible) return reponseIndisponible(cors); throw e; }
      if (!user) return repondre(401, { error: "reconnexion", message: "Session expirée : reconnectez-vous avec le code reçu par e-mail." });
      if (!user.isAdmin) {
        const mail = String(user.email || "").trim().toLowerCase();
        const [compte] = mail ? (await src.sb(`elixir_pharmacies?email=eq.${enc(mail)}&select=email&limit=1`)) || [] : [];
        if (!compte) return repondre(403, { error: "fiche", message: "Aucune pharmacie n'est rattachée à ce compte." });
      }
      // classement en cache et configuration de l'accueil (menus, menus promo, mises en avant) lus en parallèle
      const [enCache, conf] = await Promise.all([src.kvGet(CLE_CACHE), lireConfigAccueil(src)]);
      const cache = enCache || await premierCalcul(src, echeance);
      const vedCips = cipsVedettes(conf.vedettes.valeur);
      const aVerifier = user.isAdmin ? cipsAVerifier(event.queryStringParameters?.verifier) : [];
      // outils mis en avant en ce moment (admin : les 6, pour l'éditeur ; vérification d'un brouillon : aucun) ; aucun :
      // aucune lecture de plus
      const besoins = user.isAdmin ? (aVerifier.length ? [] : OUTILS_MEA) : outilsAEvaluer(conf.vedettes.valeur, jourParis(src.maintenant()));
      const delaiOutils = Math.max(500, Math.min(deps.delaiOutilsMs ?? DELAI_OUTILS_MS, echeance - src.maintenant() - 1000));
      // justificatifs et outils lus en parallèle du contexte ; justificatifs illisibles : liste vide (le navigateur écarte
      // aussi ces produits avec justifProducts) ; lecture d'un outil en échec : seul cet outil est écarté
      const [ctx, justifs, outils] = await Promise.all([
        lireContexte(src, [...new Set([...(cache ? cipsDuCache(cache) : []), ...vedCips, ...aVerifier])], conf),
        vedCips.length || aVerifier.length ? src.justifs().catch(() => null) : null,
        besoins.length ? lireOutils(src, besoins, conf, { delaiMs: delaiOutils, lireMasques: user.isAdmin }).catch(() => null) : null,
      ]);
      const ctxV = { ...ctx, justifs: justifs || new Set(), outils };
      const ved = evaluerVedettes(conf.vedettes.valeur, conf.vedettes.maj, ctxV, src.maintenant());
      const corps = cache ? publique(cache, ctx, src.maintenant()) : { version: VERSION, genere_le: null, periode: null, slides: [], reserves: [], perime: true };
      corps.vedettes = ved.publiques;
      if (user.isAdmin) {
        corps.vedettes_etat = ved.etats;
        if (!aVerifier.length) corps.outils_etat = Object.fromEntries(OUTILS_MEA.map(k => [k, evaluerOutil(k, ctxV, src.maintenant())]));
        if (aVerifier.length) corps.verification = verification(aVerifier, ctxV);
      }
      return repondre(200, corps, "private, max-age=60");
    } catch (e) {
      console.error("accueil-offres", e);
      return repondre(502, { error: "indisponible", message: "Offres momentanément indisponibles." });
    }
  };
}

// Premier appel sans cache : calcul à la demande, un seul à la fois (verrou kv), terminé avant l'échéance ; null sinon.
// Échec récent (marqueur de moins de 10 min) : aucun calcul, null tout de suite.
async function premierCalcul(src, echeance) {
  try {
    const echec = await src.kvGet(CLE_ECHEC).catch(() => null);
    if (echec?.at && src.maintenant() - Date.parse(echec.at) < PAUSE_ECHEC_MS) return null;
    const noterEchec = () => src.kvSet(CLE_ECHEC, { at: new Date(src.maintenant()).toISOString() }).catch(() => {});
    const r = await src.verrou(async () => {
      if (await src.kvGet(CLE_CACHE)) return src.kvGet(CLE_CACHE);   // calculé entre-temps par un autre appel
      const calcul = calculerClassement(src).then(async ({ cache, journal }) => {
        if (cache.slides.length) await src.kvSet(CLE_CACHE, cache);
        await src.kvSet(CLE_JOURNAL, { at: cache.genere_le, journal: [`calcul au premier appel : ${cache.slides.length} diapositive(s)`, ...journal.slice(0, 40)] }).catch(() => {});
        return cache.slides.length ? cache : null;
      }).catch((e) => { console.warn("accueil-offres : calcul au premier appel en échec", e?.message || e); return null; });
      let minuteur;
      const delai = new Promise((ok) => { minuteur = setTimeout(() => ok(null), Math.max(0, echeance - src.maintenant())); });
      try { return await Promise.race([calcul, delai]); } finally { clearTimeout(minuteur); }
    });
    if (r?.occupe) return null;
    if (!r?.resultat) await noterEchec();
    return r?.resultat || null;
  } catch (e) {
    console.warn("accueil-offres : calcul au premier appel impossible", e?.message || e);
    return null;
  }
}

export const handler = creerHandler();
