# Agent PharmaML (Mac du bureau) — v3, relais

PharmaML (InfoSoft) n'accepte les envois de commandes (`commandes.php`) que depuis l'adresse du bureau :
depuis Netlify, tout envoi reçoit 403. Le site de commande met donc chaque envoi en file ; cet agent,
sur le Mac du bureau, interroge le site toutes les 20 s, envoie à PharmaML et rend compte.

- Commandes du site (envoi automatique des lignes en stock, synchro manuelle de l'admin depuis n'importe quel poste)
  et commandes Sanofi Pro passent toutes par ici : **un seul émetteur vers PharmaML**.
- Requêtes signées (Ed25519) : `relais-cle.pem` (clé privée, créée au premier lancement, jamais copiée ni
  committée) ; la clé publique (`relais-cle.pub`) est déclarée dans `elixir-commande/netlify/functions/_relais.js`.
- Journal local `relais-journal.jsonl` : une référence déjà tentée n'est jamais renvoyée automatiquement.
- Le port 3001 ne fait plus aucun envoi (les anciennes pages admin reçoivent « actualisez »).

## Installer / mettre à jour

1. `.env` : `PHARMAML_URL`, `PHARMAML_USER`, `PHARMAML_PASS`, `SITE_URL` (voir `.env.example`).
2. Double-clic sur `installer-service.command` : service macOS (démarrage automatique, relance en cas d'arrêt).
   Journal : `agent.log`. Retirer : `./installer-service.command --retirer`.
3. Vérifier dans l'admin du site (onglet Commandes, bandeau « Relais PharmaML ») : agent « connecté », puis « 🔌 Tester ».

`LANCER_AGENT.command` (lancement à la main dans un Terminal) reste possible, mais pas en même temps que le service.
