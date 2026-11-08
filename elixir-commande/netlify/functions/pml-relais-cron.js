// ── Relais PharmaML : surveillance toutes les 5 min (netlify.toml) ───────
// En voie portail : envoie la file et vérifie les issues incertaines par lecture.
// Expire, répare la file et alerte selon la voie ; budget de 22 s pour une limite Netlify de 30 s.
import { surveiller } from "./_relais.js";

export const handler = async () => {
  const finAvant = Date.now() + 22000;
  try {
    const r = await surveiller({ finAvant });
    if (r.journal.length) console.log("pml-relais-cron :", r.journal.join(" · "));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    console.error("pml-relais-cron", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
