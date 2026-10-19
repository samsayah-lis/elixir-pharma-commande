// ── Accueil « La Tête de gondole » : GET des offres de la page d'accueil (docs/accueil.md) ──
// GET /.netlify/functions/accueil-offres  (Authorization: Bearer <jeton pharmacie> ou <jeton admin>)
// Le classement des ventes est une information commerciale : réservé aux pharmacies connectées (compte du jeton) et à
// l'admin (saisie pour une pharmacie, aperçu de l'admin). Sans jeton valide → 401 { error: "reconnexion" } ; compte
// inconnu → 403 { error: "fiche" } ; Supabase Auth en panne → 503 « indisponible ».
// → { version, genere_le, periode: { du, au, jours }, slides (12 au plus), reserves (8 au plus), perime }
// Prix et stock relus à chaque appel (fusion de products-get, sinon règle de la Saisie) : une diapositive passée en
// rupture est remplacée par la première réserve. Jamais de compte exact (tranches, courbe normalisée), jamais de stock.
// Cache absent (premier appel après la mise en ligne) : calcul sous verrou (60 s), budget 10 s ; sinon perime: true.
import { getCors } from "./cors.js";
import { rateLimit } from "./rate-limit.js";
import { reponseIndisponible } from "./auth.js";
import { creerSources, calculerClassement, lireContexte, CLE_CACHE, CLE_JOURNAL } from "./_accueil-donnees.js";
import { publique, cipsDuCache, VERSION } from "./_accueil-selection.js";

const BUDGET_MS = 10000;
const enc = encodeURIComponent;

export function creerHandler(deps = {}) {
  return async (event) => {
    const cors = getCors(event);
    const repondre = (statusCode, corps, cache = "no-store") => ({ statusCode, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": cache, Vary: "Authorization" }, body: JSON.stringify(corps) });
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
    if (event.httpMethod !== "GET") return repondre(405, { error: "Méthode non autorisée" });
    const limite = (deps.rateLimit || rateLimit)(event, 30, 60);
    if (limite) return { ...limite, headers: { ...cors, ...limite.headers } };
    const src = creerSources(deps);
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
      let cache = await src.kvGet(CLE_CACHE);
      if (!cache) cache = await premierCalcul(src);
      if (!cache) return repondre(200, { version: VERSION, genere_le: null, periode: null, slides: [], reserves: [], perime: true }, "private, max-age=60");
      const ctx = await lireContexte(src, cipsDuCache(cache));
      return repondre(200, publique(cache, ctx, src.maintenant()), "private, max-age=60");
    } catch (e) {
      console.error("accueil-offres", e);
      return repondre(502, { error: "indisponible", message: "Offres momentanément indisponibles." });
    }
  };
}

// Premier appel sans cache : calcul à la demande, un seul à la fois (verrou kv), 10 s au plus ; null sinon
async function premierCalcul(src) {
  try {
    const r = await src.verrou(async () => {
      if (await src.kvGet(CLE_CACHE)) return src.kvGet(CLE_CACHE);   // calculé entre-temps par un autre appel
      const calcul = calculerClassement(src).then(async ({ cache, journal }) => {
        if (cache.slides.length) await src.kvSet(CLE_CACHE, cache);
        await src.kvSet(CLE_JOURNAL, { at: cache.genere_le, journal: [`calcul au premier appel : ${cache.slides.length} diapositive(s)`, ...journal.slice(0, 40)] }).catch(() => {});
        return cache.slides.length ? cache : null;
      }).catch((e) => { console.warn("accueil-offres : calcul au premier appel en échec", e?.message || e); return null; });
      let minuteur;
      const delai = new Promise((ok) => { minuteur = setTimeout(() => ok(null), BUDGET_MS); });
      try { return await Promise.race([calcul, delai]); } finally { clearTimeout(minuteur); }
    });
    return r?.occupe ? null : (r?.resultat || null);
  } catch (e) {
    console.warn("accueil-offres : calcul au premier appel impossible", e?.message || e);
    return null;
  }
}

export const handler = creerHandler();
