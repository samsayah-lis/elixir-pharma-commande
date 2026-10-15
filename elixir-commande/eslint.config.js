// ESLint — garde-fou de développement seulement (rien ne part dans le build) : « npm run lint ».
// Il attrape les références orphelines que « vite build » laisse passer (variable, composant ou hook
// disparu lors d'un découpage en composants → écran « Erreur Admin Panel » en production).
// Volontairement réduit à trois règles : pas de bruit de style, seulement ce qui plante.
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const regles = {
  "no-undef": "error",                    // identifiant inconnu (variable, fonction, setter d'état…)
  "react/jsx-no-undef": "error",          // composant JSX inconnu (<MonComposant/> non importé)
  "react-hooks/rules-of-hooks": "error",  // hook conditionnel ou après un return anticipé
};

export default [
  { ignores: ["dist/**", "node_modules/**", "dev-fixtures/**"] },
  // les « eslint-disable » existants visent exhaustive-deps, non activée ici : pas d'avertissement
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  // Front (navigateur)
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "18.2" } },
    rules: regles,
  },
  // Outillage (Node) : configuration Vite, banc d'essai, scripts
  {
    files: ["*.config.js", "scripts/**/*.{js,mjs}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
    rules: { "no-undef": "error" },
  },
];
