// ── Tests de l'API des pharmacies : capture des réponses du routeur /api/v1 (scripts/test-api-openapi.mjs) ──
// Sans la variable API_CAPTURE, transparent : la réponse est rendue telle quelle, rien n'est gardé.
// Avec API_CAPTURE=<fichier>, chaque réponse d'une requête /api/v1/* passée par capturer() est gardée (méthode, chemin,
// en-têtes reçus, statut, en-têtes et corps de la réponse ; un PDF n'est gardé que par sa taille) et le fichier est écrit
// à la fin du processus. test-api-openapi.mjs relance test-api-fondations, test-api-lecture et test-api-commandes dans ce
// mode, puis confronte chaque réponse RÉELLE à docs/api/openapi.yaml. Données des tests : fictives.
import { writeFileSync } from "node:fs";

const FICHIER = process.env.API_CAPTURE || null;
const reponses = [];
if (FICHIER) process.on("exit", () => writeFileSync(FICHIER, JSON.stringify(reponses)));

const API = /^\/(api\/v1|\.netlify\/functions\/api-v1)(\/|$)/;

// event : événement Netlify passé au routeur ; reponse : sa réponse (ou la promesse de sa réponse) → la même réponse
export function capturer(event, reponse) {
  if (!FICHIER) return reponse;
  return Promise.resolve(reponse).then((r) => {
    if (r && typeof r.statusCode === "number" && API.test(String(event?.path || ""))) {
      reponses.push({
        methode: String(event.httpMethod || "GET").toUpperCase(), path: String(event.path),
        requete: Object.keys(event.headers || {}).map((k) => k.toLowerCase()),
        statut: r.statusCode, entetes: r.headers || {},
        corps: r.isBase64Encoded ? null : r.body ?? null, base64: r.isBase64Encoded ? String(r.body || "").length : 0,
      });
    }
    return r;
  });
}
