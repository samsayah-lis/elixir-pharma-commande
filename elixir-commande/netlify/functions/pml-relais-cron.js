// ── Relais PharmaML : surveillance toutes les 5 min (netlify.toml) ───────
// Expire les envois non pris par l'agent à l'échéance (lignes rendues à la synchro manuelle), répare la
// file, alerte si l'agent du Mac ne répond plus ou si un envoi reste sans compte rendu. Voir _relais.js.
import { surveiller } from "./_relais.js";

export const handler = async () => {
  try {
    const r = await surveiller();
    if (r.journal.length) console.log("pml-relais-cron :", r.journal.join(" · "));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    console.error("pml-relais-cron", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
