// ── Commandes sur justificatif labo : envois en arrière-plan (jusqu'à 15 min) ──
// Lancée après une commande du site (lab-justif submit), par une relance admin ou par le
// passage planifié. Un seul traitement à la fois (verrou lj:lock).
import { isCronAuthorized } from "./auth.js";
import { lireConfig, envoisDus, detecter, avecVerrou, kvSet } from "./_lab-justif.js";

export const handler = async (event) => {
  if (!isCronAuthorized(event)) return { statusCode: 403, body: "" };
  let detection = false;
  try { detection = JSON.parse(event.body || "{}").detecter === true; } catch {}
  const res = await avecVerrou(async () => {
    // « Contrôler maintenant » (admin) : repérage PharmaML d'abord, puis envois dus
    const journal = detection ? await detecter(await lireConfig(), { budgetMs: 90000 }).catch(e => [`Détection : ${e.message}`]) : [];
    return [...journal, ...await envoisDus(await lireConfig(), { budgetMs: 12 * 60e3 })];
  }, 14 * 60e3);
  await kvSet("lj:dernier_envoi", { at: new Date().toISOString(), occupe: !!res.occupe, journal: res.resultat || [] }).catch(() => {});
  return { statusCode: 200, body: "" };
};
