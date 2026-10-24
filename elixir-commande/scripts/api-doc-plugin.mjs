// ── Documentation publique de l'API des pharmacies (/api/) : plugin Vite ──
// La page public/api/index.html est copiée telle quelle par Vite (hors bundle React : le budget des pharmacies n'en dépend
// pas). Ce plugin sert à côté d'elle, au build (dist/api/) comme en développement :
//  • /api/openapi.yaml : docs/api/openapi.yaml, source unique (confrontée au code par scripts/test-api-openapi.mjs) ;
//  • /api/inter.woff2  : Inter de la charte (même fichier que le site, @fontsource-variable/inter), aucune police externe.
// En développement seulement, /api, /api/ et /api/docs servent la page (Netlify : fichier réel, puis public/_redirects).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
// fichier publié → source (chemins relatifs à elixir-commande/)
export const FICHIERS_DOC = {
  "api/openapi.yaml": "docs/api/openapi.yaml",
  "api/inter.woff2": "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
};
const TYPES = { "api/openapi.yaml": "application/yaml; charset=utf-8", "api/inter.woff2": "font/woff2" };

export default function apiDoc() {
  return {
    name: "api-doc",
    generateBundle() {
      for (const [nom, source] of Object.entries(FICHIERS_DOC)) this.emitFile({ type: "asset", fileName: nom, source: readFileSync(join(APP, source)) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const chemin = String(req.url || "").split("?")[0];
        const nom = chemin.replace(/^\//, "");
        if (FICHIERS_DOC[nom]) {
          res.setHeader("Content-Type", TYPES[nom]);
          res.setHeader("Cache-Control", "no-cache");
          return res.end(readFileSync(join(APP, FICHIERS_DOC[nom])));
        }
        if (/^\/api(\/|\/docs\/?)?$/.test(chemin)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.end(readFileSync(join(APP, "public/api/index.html")));
        }
        next();
      });
    },
  };
}
