// Script auto-exécuté avant chaque build (prebuild)
// Extrait tous les CIP13 valides de App.jsx et génère cips.js pour stock-get.js
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(resolve(__dir, "../src/App.jsx"), "utf8");

// CIP13 valide : exactement 13 chiffres, commence par 3
const cips = [...new Set(
  [...appSrc.matchAll(/"(3\d{12})"/g)].map(m => m[1])
)].sort();

const out = `// ⚠️ Fichier auto-généré par scripts/gen-cips.js — NE PAS MODIFIER
// Régénéré à chaque "npm run build" depuis App.jsx
export const CATALOG_CIPS = ${JSON.stringify(cips, null, 2)};
`;

writeFileSync(resolve(__dir, "../netlify/functions/cips.js"), out);
console.log(`[gen-cips] ✓ ${cips.length} CIP13 extraits → netlify/functions/cips.js`);
