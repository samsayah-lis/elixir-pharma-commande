# Elixir Pharma — Bon de commande en ligne

Application de commande catalogue Publication 6 (Février 2026).  
Déployée sur Netlify : https://commandes-elixir.netlify.app

## Structure

```
elixir-commande/       ← Application React (Netlify)
  src/App.jsx          ← Catalogue + panier
  src/AdminPanel.jsx   ← Interface admin
  netlify/functions/   ← Fonctions serverless
  
elixir-local-agent/    ← Agent Node.js (Mac local)
  agent.js             ← Sync commandes → PharmaML
  .env                 ← Identifiants (non versionné)
  .env.example         ← Modèle de configuration
```

## Lancer l'agent local

```bash
cd elixir-local-agent
cp .env.example .env    # puis renseigner le mot de passe
node agent.js
```

## Déployer sur Netlify

```bash
cd elixir-commande
npm install && npm run build
# Déposer le dossier dist/ dans Netlify
```
