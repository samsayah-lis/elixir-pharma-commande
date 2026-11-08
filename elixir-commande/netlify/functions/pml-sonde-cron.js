// Santé toutes les 5 min (netlify.toml) : 10 s pour le portail, puis persistance et e-mail.
import { sonder } from "./_sonde-pml.js";
import { masquer } from "./_portail-pml.js";

export const handler = async () => {
  try {
    const r = await sonder();
    if (r.ok === false || r.alerte) console.log("pml-sonde-cron :", JSON.stringify(r));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    const erreur = masquer(e.message || e).slice(0, 500);
    console.error("pml-sonde-cron :", erreur);
    return { statusCode: 500, body: JSON.stringify({ error: erreur }) };
  }
};
