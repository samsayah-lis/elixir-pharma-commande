// ── Commandes sur justificatif labo : passage planifié (toutes les 10 min) ──
// 1. repère les commandes passées depuis le logiciel des pharmacies (portail PharmaML, lecture
//    seule) pour les labos actifs avec « détection » ; 2. lance les envois dus en arrière-plan ;
// 3. efface les ordonnances de plus de 90 jours.
import { lireConfig, detecter, avecVerrou, menageOrdonnances, kvSet } from "./_lab-justif.js";

const SITE = "https://commandes-elixir.netlify.app";

export const handler = async () => {
  const journal = [];
  try {
    const cfg = await lireConfig();
    if (Object.values(cfg.labs).some(l => l.actif && l.detection)) {
      const res = await avecVerrou(() => detecter(cfg, { budgetMs: 15000 }), 60e3);
      journal.push(...(res.occupe ? ["Détection reportée : un envoi est en cours"] : res.resultat));
    }
    // envois dus (labos actifs, ou envois demandés à la main pour un labo inactif) : la fonction
    // d'arrière-plan s'arrête vite s'il n'y a rien à faire
    if (process.env.CRON_SECRET) {
      await fetch(`${SITE}/.netlify/functions/lab-justif-background`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET }, body: "{}",
      }).catch(e => journal.push(`Lancement des envois impossible : ${e.message}`));
    }
    await menageOrdonnances().catch(e => journal.push(`Ménage des ordonnances : ${e.message}`));
  } catch (e) {
    journal.push(`Erreur : ${String(e.message || e).slice(0, 300)}`);
  }
  await kvSet("lj:dernier_passage", { at: new Date().toISOString(), journal }).catch(() => {});
  return { statusCode: 200, body: "" };
};
