// ── Commandes Sanofi Pro : passage planifié (toutes les 10 min) ──────────
// Lance la fonction d'arrière-plan (15 min) : le traitement relit le portail plusieurs fois
// (~1,5 Mo par lecture) et attend Odoo, trop long pour une fonction planifiée (30 s).
// Surveillance : en mode automatique, si aucun passage n'a abouti depuis 40 min (fonction non
// lancée, plantée, verrou bloqué…), e-mail d'alerte (au plus toutes les 6 h).
import { kvGet } from "./_lab-justif.js";
import { lireConfig, alerteTechnique } from "./_sanofipro.js";

const SITE = "https://commandes-elixir.netlify.app";
const SILENCE_MAX_MIN = 40;

export const handler = async () => {
  let lancement = "";
  if (!process.env.CRON_SECRET) lancement = "CRON_SECRET absent : passage impossible";
  else {
    const r = await fetch(`${SITE}/.netlify/functions/sanofipro-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET }, body: "{}",
    }).catch(e => ({ ok: false, status: 0, erreur: e.message }));
    if (!(r.ok || r.status === 202)) lancement = `lancement du passage refusé (HTTP ${r.status}${r.erreur ? ` : ${r.erreur}` : ""})`;
  }
  if (lancement) console.error("sanofipro-cron :", lancement);
  try {
    const cfg = await lireConfig();
    if (cfg.mode !== "auto") return { statusCode: 200, body: "" };
    const der = await kvGet("sp:dernier_complet");
    const depuis = (s) => s ? (Date.now() - new Date(s).getTime()) / 60e3 : Infinity;
    // silence depuis le dernier passage abouti, et depuis le passage en automatique
    if (Math.min(depuis(der?.fin), depuis(cfg.majA)) > SILENCE_MAX_MIN) {
      await alerteTechnique(cfg, new Error(`aucun passage du traitement automatique depuis ${der?.fin ? `${Math.round(depuis(der.fin))} min` : "sa mise en route"}${lancement ? ` (${lancement})` : ""}`),
        { cle: "sp:alerte_arret", sujet: "Sanofi Pro : traitement automatique à l'arrêt" });
    }
  } catch (e) { console.error("sanofipro-cron surveillance :", e.message); }
  return { statusCode: 200, body: "" };
};
