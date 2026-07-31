# Elixir Pharma — Agent local PharmaML (v2.1)

Petit serveur local qui reçoit les commandes du site
[commandes-elixir.netlify.app](https://commandes-elixir.netlify.app) et les
transmet à **PharmaML**. Si le CIP de la pharmacie manque, il le retrouve
automatiquement via l'email (endpoint `pharmacy-lookup` du site).

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `agent.js` | Le serveur (écoute sur `http://localhost:3001`) |
| `LANCER_AGENT.command` | Lanceur **double-clic** (macOS) : libère le port 3001 puis démarre l'agent |
| `.env` | Vos réglages **privés** (mot de passe PharmaML) — **jamais** partagé |
| `.env.example` | Modèle à copier en `.env` |
| `package.json` | Métadonnées Node |

## Première installation

1. Installer [Node.js](https://nodejs.org) (une seule fois sur la machine).
2. Copier `.env.example` en `.env` et y renseigner le mot de passe PharmaML :
   ```
   PHARMAML_URL=https://pharmaml.elixirpharma.fr
   PHARMAML_USER=admin
   PHARMAML_PASS=VOTRE_MOT_DE_PASSE
   NETLIFY_URL=https://commandes-elixir.netlify.app
   PORT=3001
   ```
   (Le lanceur crée automatiquement `.env` depuis le modèle au premier démarrage.)

## Lancer l'agent

- **Simple** : double-cliquer sur `LANCER_AGENT.command`.
- **Terminal** :
  ```bash
  node agent.js
  ```

L'agent doit rester ouvert pendant les heures de commande. Pour l'arrêter,
fermer la fenêtre du terminal (ou `Ctrl-C`).

## Dépannage

- **« port déjà utilisé »** : un agent tourne déjà. Le lanceur libère le port
  3001 tout seul ; sinon : `lsof -ti:3001 | xargs kill`.
- **« CIP introuvable »** : l'email de la pharmacie n'est pas dans Odoo — vérifier
  la fiche client Odoo.
- **Erreur PharmaML** : vérifier `PHARMAML_PASS` dans `.env`.
