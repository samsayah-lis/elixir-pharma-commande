# Alertes « M'avertir du retour »

Question de Zineb (20/10/2026) : « est-ce que tu es sûr que la fonctionnalité "M'avertir du retour" fonctionne ». Non : le bouton de la Saisie de commande enregistrait la demande (table `restock_alerts`), mais rien ne prévenait jamais la pharmacie. Proposition acceptée (« oui fais le ») : e-mail au retour en stock, mention dans la Saisie, liste dans l'admin.

## Ce que voit chacun

- **La pharmacie, par e-mail.** Un produit attendu revient en stock : elle reçoit **un** e-mail de pharmacien@elixirpharma.fr (plusieurs produits regroupés dans le même e-mail). Il donne le nom, le CIP, le prix net HT de la Saisie (prix remisé s'il y a remise, prix barré et remise affichés) et un bouton « Commander ce produit ». Le bouton ouvre la Saisie sur le produit (`https://elixir-commande.expepharma.com/?cip=<CIP>`, les liens du catalogue).
  - L'e-mail n'est envoyé qu'**une fois par demande**. Pour être averti de nouveau, la pharmacie reclique sur « M'avertir du retour ».
  - Le pied de l'e-mail dit pourquoi elle le reçoit et comment ne plus en recevoir : retirer ses alertes (« Alerte activée ») ou répondre à l'e-mail.
- **La pharmacie, dans la Saisie de commande.** Un bandeau « De retour en stock » liste les produits qu'elle attendait et qui sont revenus : alerte avertie depuis moins de 14 jours, produit toujours en stock.
  - Clic sur un nom : le produit s'affiche. La ligne du produit porte aussi la mention « De retour en stock ».
  - Croix : la mention disparaît (la demande déjà avertie est retirée).
  - « Alerte activée » ne s'affiche plus que pour les demandes encore en attente.
- **Elixir, dans l'admin.** Onglet « 🔔 Alertes retour » :
  - chiffres : demandes en attente, produits prêts à partir (jusqu'à N e-mails), demandes trop anciennes, demandes averties sur 30 jours ;
  - **produits les plus attendus** : nombre de pharmacies (liste dépliable, nom et CIP, jamais d'adresse e-mail), plus ancienne demande, état du stock (« part au prochain passage », rupture, prix manquant) ;
  - **avertis récemment** (30 jours) et issue de chaque demande (e-mail envoyé, close car plus de 60 jours, adresse plus rattachée, échec) ;
  - journal des passages, bouton **« Envoyer maintenant »** (avec le compte de ce qui va partir) ;
  - envois interrompus et bouton « Relancer ».

## Règles

- **En stock** : la règle de la Saisie, c'est-à-dire `odoo_catalog.in_stock` et un prix net > 0. Un produit en stock sans prix attend son prix.
- **Destinataire** : l'adresse de la demande, seulement si c'est encore un compte de **ce** CIP dans `elixir_pharmacies`.
  - Sinon, la demande est close sans e-mail et notée au journal. La mention de la Saisie reste visible.
  - Les demandes saisies par Elixir « pour une pharmacie » portent l'adresse choisie à la saisie : même règle.
- **Plus de 60 jours** : demande close sans e-mail, jugée trop ancienne pour être utile.
  - Cela vaut aussi pour un produit toujours en rupture. La pharmacie retrouve alors « M'avertir du retour » et peut redemander.
  - Le bouton l'annonce au survol : « demande valable 60 jours ».
- **Heures d'envoi** : passages automatiques entre 7 h et 21 h, heure de Paris.
  - Hors de ces heures, seules les clôtures sont faites, et les e-mails partent au premier passage du matin.
  - « Envoyer maintenant » envoie à toute heure.
- **Jamais deux e-mails pour une même demande.**
  - La demande est d'abord réservée (`PATCH … notified=eq.false` → `notified=true, outcome=envoi`), puis l'e-mail part, puis l'issue est notée (`envoye`). Deux passages simultanés ne peuvent pas réserver la même demande.
  - E-mail refusé par Resend : la réservation est rendue et la demande retentée au passage suivant. Au 3e refus, issue « echec ».
  - Limite de débit (429) : la réservation est rendue sans compter de refus, et le passage s'arrête.
  - Fonction coupée entre la réservation et le compte rendu : la demande passe en « interrompu » après 15 min. Elle n'est **jamais** renvoyée d'office : il faut vérifier dans Resend, puis cliquer « Relancer » dans l'admin.

## Quand ça part

1. **Après chaque mise à jour du stock.** La GitHub Action (`.github/workflows/sync.yml`) lance `scripts/run-sync.mjs`. À la fin des étapes de stock (synchro rapide toutes les 3 h, chaîne de nuit), le script appelle `restock-notify?action=envoyer` avec `x-cron-secret`.
   - Chaque appel envoie pendant 5 s au plus, et le script rappelle tant qu'il en reste.
   - La réponse ne contient que des chiffres : ni nom ni adresse dans les journaux de GitHub.
   - Un échec ici ne fait pas échouer la synchro du stock.
2. **Passage planifié** `restock-notify-cron` (`netlify.toml`, `50 */3 * * *` UTC), 50 min après chaque synchro rapide (`0 */3 * * *`). C'est le filet de sécurité :
   - GitHub démarre souvent ses tâches planifiées avec retard, et l'Action peut échouer ;
   - il reste parfois des envois après les 5 s par appel ;
   - le stock peut aussi être synchronisé depuis l'admin.
   - Il travaille 20 s (limite des fonctions planifiées : 30 s), fait le ménage du journal (60 jours) et respecte la même fenêtre 7 h – 21 h.
3. **« Envoyer maintenant »** dans l'admin.

## Mise en service

1. **Déploiement** (fusion de la branche `alertes-retour` dans `master`) : rien d'autre n'est nécessaire pour que les e-mails partent.
   - Variables déjà en place : `RESEND_API_KEY`, `CRON_SECRET`, `SUPABASE_KEY`. Sans `RESEND_API_KEY`, rien n'est réservé et l'admin l'indique.
   - Avant le SQL, la base est en « mode réduit » (annoncé dans l'admin) : envoi unique garanti, essais comptés dans `kv_store`, envois interrompus non repérés.
2. **Supabase**, éditeur SQL, une fois : `sql/restock-notify.sql`.
   - Ajoute `attempts` et `outcome` (et `notified_at` s'il manquait), sans ouvrir aucun droit. Rejouable.
3. **Premier jour.** Les demandes déjà enregistrées sont prises en compte, et l'onglet l'annonce avant le premier passage (« Mise en service ») :
   - combien d'e-mails partiront, et pour quels produits ;
   - combien de demandes de plus de 60 jours seront closes sans e-mail.
   - Plusieurs e-mails peuvent donc partir le premier jour. Chaque passage est compté dans le journal de l'onglet et dans les journaux Netlify (`[restock-notify] …`).

## Fichiers

- `netlify/functions/_restock.js` : logique (passage, e-mail, aperçu de l'admin, mention de la Saisie).
- `netlify/functions/restock-notify.js` : HTTP (GitHub Action, admin).
- `netlify/functions/restock-notify-cron.js` : passage planifié.
- `netlify/functions/restock-alert.js` : fonction existante.
  - « mes alertes » renvoie `notified` et `retour`, sans adresse e-mail ;
  - une nouvelle demande remet le suivi à zéro.
  - Modification admise par empreinte dans `scripts/verifie-zones.mjs`.
- `src/components/OrderEntry.jsx` (Saisie), `src/components/AdminAlertesRetour.jsx` et `src/AdminPanel.jsx` (onglet).
- `scripts/run-sync.mjs` (appel après le stock), `netlify.toml` (planification), `sql/restock-notify.sql`.
- Tests hors ligne : `node scripts/test-alertes-retour.mjs` (Supabase simulé, aucun envoi).
- Banc local : bandeau de la Saisie, tableau de bord de mise en service, puis état « après le premier passage » une fois « Envoyer maintenant » cliqué. Aucun e-mail.

## Points ouverts

- **Validité de 60 jours** : appliquée à toutes les demandes, pas seulement à celles déjà enregistrées au démarrage. À allonger si des ruptures longues le demandent (`AGE_MAX_JOURS`).
- **Articles sous plusieurs CIP** (fauteuils, même code fournisseur) : l'alerte suit le CIP affiché au moment de la demande, pas le stock cumulé du groupe.
