// ── Cache des fichiers du site (24/10/2026) : plugin Vite ──
// Demande de Zineb : « laisser le navigateur garder les fichiers du site en mémoire au lieu de les revérifier à chaque
// visite, mais forcer le vidage en cas de mise à jour » (docs/cache.md). Les fichiers de /assets portent une empreinte de
// leur contenu (index-Ck0KzExp.js) : modifié, un fichier change de nom ; index.html, toujours relu (défaut de Netlify :
// max-age=0, must-revalidate), pointe vers les nouveaux noms, et le navigateur télécharge les fichiers renommés.
// Au build, ce plugin écrit dist/_headers : une règle par fichier à empreinte réellement produit dans /assets, gardé un an
// sans être revérifié (immutable). Jamais de règle « /assets/* » : Netlify peut l'appliquer aussi à la réponse d'un fichier
// absent (index.html de la règle « /* », ou une 404 ; vu avec netlify-cli et dans d'autres projets, non documenté), qu'un
// navigateur garderait un an sous l'adresse du fichier, cassé après un retour arrière (rollback) de Netlify. Un fichier
// absent ne correspond ici à aucune règle : il reste au défaut de Netlify.

export const CACHE_LONG = "public, max-age=31536000, immutable";
// empreinte de Vite (Rollup) : 8 caractères base64 url avant l'extension
export const EMPREINTE = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

// Fichiers à empreinte du bundle (revue du 24/10 : le nom seul ne suffit pas, « logo-officine.svg » a la forme d'une
// empreinte) : motifs de nom de Vite qui contiennent [hash] (sinon : aucun, et l'appelant prévient), fichier nommé par ces
// motifs (morceau de JS, ou fichier émis sans nom fixé : names non vide), forme d'empreinte. → null si un motif n'a pas [hash].
export function fichiersAEmpreinte(sortie, bundle) {
  if (![sortie.entryFileNames, sortie.chunkFileNames, sortie.assetFileNames].every(m => typeof m === "string" && m.includes("[hash]"))) return null;
  return Object.values(bundle).filter(f => (f.type === "chunk" || f.names?.length > 0) && f.fileName.startsWith("assets/") && EMPREINTE.test(f.fileName))
    .map(f => f.fileName).sort();
}

// fichiers à empreinte (chemins relatifs à dist/) → contenu de dist/_headers
export const enTetes = (fichiers) => [
  "# Écrit au build par scripts/cache-assets-plugin.mjs (docs/cache.md) : fichiers à empreinte de ce déploiement seulement.",
  ...fichiers.map(f => `/${f}\n  Cache-Control: ${CACHE_LONG}`),
].join("\n") + "\n";

export default function cacheAssets() {
  return {
    name: "cache-assets",
    apply: "build",
    // après vite:css-post, vite:asset et vite:build-html (CSS, polices, index.html déjà dans le bundle, à leur nom final) ;
    // un fichier ajouté plus tard sous assets/ n'aurait pas de règle : revérifié, sans risque (test-cache-assets le signale)
    enforce: "post",
    generateBundle(sortie, bundle) {
      const fichiers = fichiersAEmpreinte(sortie, bundle);
      if (!fichiers) this.warn("noms de fichiers sans [hash] dans la configuration de Vite : aucun fichier gardé un an (docs/cache.md)");
      this.emitFile({ type: "asset", fileName: "_headers", source: enTetes(fichiers || []) });
    },
  };
}
