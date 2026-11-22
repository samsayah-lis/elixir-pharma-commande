import { lancerIndicateurs } from "./crm-indicateurs-background.js";
// Deux horaires UTC couvrent été/hiver ; seul celui qui tombe à 04:30 Paris lance le calcul.
export function creerHandlerCron(deps = {}) {
  // Comme api-cron : invocation par le planificateur Netlify (pas une route HTTP).
  // Le secret est obligatoire sur l'appel sortant vers le background.
  return async () => {
    const now = (deps.maintenant || (() => new Date()))();
    // Heure seule : un déclenchement en retard de quelques minutes (04:31…) doit encore lancer le calcul.
    const heure = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now);
    if (heure !== "04") return { statusCode: 200, body: "" };
    try { await lancerIndicateurs(deps); return { statusCode: 200, body: "" }; }
    catch { return { statusCode: 503, body: "" }; }
  };
}
export const handler = creerHandlerCron();
