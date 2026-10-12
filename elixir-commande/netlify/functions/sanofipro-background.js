// ── Commandes Sanofi Pro : passage en arrière-plan (jusqu'à 15 min) ──────
// Lancé toutes les 10 min par sanofipro-cron, ou par « Vérifier maintenant » (admin).
// Un seul passage à la fois (verrou sp:lock, 16 min : plus long que la vie de la fonction, il ne peut
// pas être repris tant qu'elle tourne). Logique : _sanofipro.js
import { isCronAuthorized } from "./auth.js";
import { avecVerrou, kvSet } from "./_lab-justif.js";
import { passage, lireConfig, alerteTechnique, VERROU, VERROU_MS } from "./_sanofipro.js";

export const handler = async (event) => {
  if (!isCronAuthorized(event)) return { statusCode: 403, body: "" };
  const debut = new Date().toISOString();
  let res;
  try {
    res = await avecVerrou(() => passage({ budgetMs: 10 * 60e3 }), VERROU_MS, VERROU);
  } catch (e) {
    console.error("sanofipro", e);
    res = { erreur: String(e.message || e).slice(0, 300) };
    // portail injoignable, identifiants refusés… : e-mail au plus toutes les 6 h (mode automatique)
    const cfg = await lireConfig().catch(() => null);
    if (cfg?.mode === "auto") await alerteTechnique(cfg, e).catch(err => { res.erreur += ` — alerte non envoyée : ${err.message}`; });
  }
  const r = res.resultat || {};
  const trace = { at: debut, fin: new Date().toISOString(), occupe: !!res.occupe, erreur: res.erreur || null, mode: r.mode || null, journal: r.journal || [], stats: r.stats || null };
  await kvSet("sp:dernier_passage", trace).catch(() => {});
  // passage réellement exécuté (même en erreur) : surveillé par sanofipro-cron
  if (!res.occupe) await kvSet("sp:dernier_complet", { fin: trace.fin, erreur: trace.erreur }).catch(() => {});
  return { statusCode: 200, body: "" };
};
