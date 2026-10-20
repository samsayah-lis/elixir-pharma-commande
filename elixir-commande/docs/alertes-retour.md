# Alertes « M'avertir du retour »

Question de Zineb (20/10/2026) : « est-ce que tu es sûr que la fonctionnalité "M'avertir du retour" fonctionne ». Non : le bouton de la Saisie de commande enregistrait la demande (table `restock_alerts`), mais rien ne prévenait jamais la pharmacie. Proposition acceptée (« oui fais le ») : e-mail au retour en stock, mention dans la Saisie, liste dans l'admin.

## Ce que voit chacun

- **La pharmacie, par e-mail.** Un produit attendu revient en stock : elle reçoit **un** e-mail de pharmacien@elixirpharma.fr (plusieurs produits regroupés dans le même e-mail).
  - Il donne le nom, le CIP et le prix net HT du catalogue, comme la Saisie : prix remisé s'il y a remise, avec le prix barré et la remise.
  - Un bouton « Commander ce produit » ouvre la Saisie sur le produit (`https://elixir-commande.expepharma.com/?cip=<CIP>`, les liens du catalogue). Arrivée par ce lien : pas de fenêtre « Offres du moment » par-dessus, même après la connexion par code.
  - L'e-mail n'est envoyé qu'**une fois par demande**. Pour être averti de nouveau, la pharmacie reclique sur « M'avertir du retour ».
  - Le pied de l'e-mail dit pourquoi elle le reçoit, qu'il ne sera pas renvoyé, et comment retirer une autre alerte : « Alerte activée » dans la Saisie, ou une réponse à l'e-mail (l'équipe la retire depuis l'admin).
  - Mise en page sur une colonne (lisible sur téléphone), bouton qui tient dans Outlook, police Inter, or seulement en filet et en badge de remise.
- **La pharmacie, dans la Saisie de commande.** La ligne d'un produit attendu et revenu porte la mention « De retour en stock » (ton sarcelle, comme « Alerte activée »). Un bandeau liste aussi ces produits : alerte avertie depuis moins de 14 jours, produit toujours en stock.
  - Pendant une recherche, le bandeau ne répète pas les produits déjà affichés dessous : le produit ouvert par le lien de l'e-mail reste en haut de l'écran, même sur téléphone.
  - Clic sur un nom : le produit s'affiche. Croix : la mention disparaît (la demande déjà avertie est retirée ; message si le serveur refuse).
  - Produit attendu ajouté au panier : la mention se retire d'elle-même.
  - « Alerte activée » ne s'affiche plus que pour les demandes encore en attente.
- **Elixir, dans l'admin.** Onglet « 🔔 Alertes retour » :
  - **envois automatiques** : actifs ou suspendus, bouton « Activer / Suspendre », e-mails du jour (plafond 150) ;
  - **mise en service** : tant qu'aucun e-mail n'est parti, ce qui partira (destinataires valables seulement), les demandes closes sans e-mail (adresse plus rattachée, trop anciennes), l'heure du prochain passage ;
  - chiffres : demandes en attente, e-mails prêts à partir, e-mails envoyés et demandes closes sans e-mail sur 30 jours ;
  - **produits les plus attendus** : nombre de pharmacies (liste dépliable, nom et CIP, bouton « Retirer » pour une pharmacie qui ne veut plus être avertie), plus ancienne demande, état du stock ;
  - **envois à vérifier** : envoi incertain ou refusé 3 fois, avec l'adresse et l'heure (pour la recherche dans Resend, lien « Ouvrir Resend ») et le bouton « Relancer » ;
  - **demandes traitées** (30 jours), filtrables : e-mails envoyés d'abord, puis demandes closes sans e-mail ;
  - journal des passages, bouton **« Envoyer maintenant »** (avec le compte de ce qui va partir).
  - Aucune adresse e-mail n'y figure, sauf celles des envois à vérifier (l'onglet est réservé à l'admin).

## Règles

- **En stock** : la règle de la Saisie, c'est-à-dire `odoo_catalog.in_stock` et un prix net > 0. Un produit en stock sans prix attend son prix.
  - **Articles sous plusieurs CIP** (fauteuils roulants, même code fournisseur, `src/product-groups.js`) : comme la Saisie, l'article est en stock dès qu'un de ses CIP l'est. L'e-mail donne le nom, le CIP, le prix et le lien de la référence servie en premier. La mention de la Saisie suit cette ligne.
  - Les groupes viennent d'Odoo (`supplier-code-refs`). Le passage planifié en garde une copie d'un jour dans `kv_store` (`restock_notify:groupes`) : les autres passages et la Saisie n'appellent jamais Odoo.
- **Destinataire** : l'adresse de la demande, seulement si c'est encore un compte de **ce** CIP dans `elixir_pharmacies`.
  - Sinon, la demande est close sans e-mail et notée au journal. La mention de la Saisie reste visible.
  - Les demandes saisies par Elixir « pour une pharmacie » portent l'adresse choisie à la saisie : même règle.
- **Demandes anciennes** : à la mise en service, les demandes déjà vieilles de plus de 60 jours sont closes sans e-mail, jugées trop anciennes pour être utiles.
  - La mise en service est la première activation des envois automatiques. Le seuil est alors figé (60 jours avant cette date) et l'onglet l'affiche.
  - Ensuite, une demande reste valable jusqu'au retour du produit : le bouton promet un e-mail « à son retour en stock », sans date limite.
- **Heures d'envoi** : passages automatiques entre 7 h et 21 h, heure de Paris.
  - Hors de ces heures, seules les clôtures sont faites, et les e-mails partent au premier passage du matin.
  - « Envoyer maintenant » envoie à toute heure.
- **Plafonds** :
  - au plus **un e-mail par adresse sur 24 h**. Une demande qui arrive entre-temps attend, sans être close ; elle partira avec les suivantes ;
  - au plus **150 e-mails par jour** (heure de Paris), toutes sources confondues. Au-delà, le passage s'arrête, l'onglet l'indique et la suite part le lendemain ;
  - une demande datée dans le futur est écartée.
- **Jamais deux e-mails pour une même demande.**
  - La demande est d'abord réservée (`PATCH … notified=eq.false` → `notified=true, outcome=envoi`), puis l'e-mail part, puis l'issue est notée (`envoye`). Deux passages simultanés ne peuvent pas réserver la même demande.
  - Chaque envoi porte une clé d'idempotence (`Idempotency-Key`). Resend écarte tout doublon de la même demande pendant 24 h.
  - Resend a 4 s pour répondre. Selon sa réponse :
    - **refus propre à la demande** (adresse invalide…, 400/422) : la réservation est rendue et la demande retentée au passage suivant. Au 3e refus, issue « echec » (« Relancer » possible) ;
    - **panne générale** (clé révoquée, domaine non vérifié, quota du jour ou du mois, 401/403/429) : la réservation est rendue **sans compter de refus**, le passage s'arrête, l'onglet affiche l'erreur. Rien n'est clos, tout repart quand Resend accepte de nouveau ;
    - **limite de débit** (429 `rate_limit_exceeded`) : rendue sans compter, reprise à l'appel suivant ;
    - **issue incertaine** (pas de réponse, délai dépassé, erreur 5xx) : l'e-mail est peut-être parti. La demande n'est **jamais** renvoyée d'office : elle passe en « à vérifier » dans l'onglet. Il faut chercher l'adresse dans Resend, puis cliquer « Relancer » si l'e-mail n'est pas parti.
  - Fonction coupée entre la réservation et le compte rendu : la demande passe aussi en « à vérifier » après 15 min.

## Quand ça part

1. **Après chaque mise à jour du stock.** La GitHub Action (`.github/workflows/sync.yml`) lance `scripts/run-sync.mjs`. À la fin des étapes de stock (synchro rapide toutes les 3 h, chaîne de nuit), le script appelle `restock-notify?action=envoyer` avec `x-cron-secret`.
   - Chaque appel travaille 4 s : il ne commence rien qui pourrait finir après 9 s (limite des fonctions : 10 s). Le script rappelle tant qu'il en reste.
   - La réponse ne contient que des chiffres : ni nom ni adresse dans les journaux de GitHub.
   - Un échec ici ne fait pas échouer la synchro du stock.
2. **Passage planifié** `restock-notify-cron` (`netlify.toml`, `50 */3 * * *` UTC), 50 min après chaque synchro rapide (`0 */3 * * *`). C'est le filet de sécurité :
   - GitHub démarre souvent ses tâches planifiées avec retard, et l'Action peut échouer ;
   - il reste parfois des envois après les 4 s par appel ;
   - le stock peut aussi être synchronisé depuis l'admin.
   - Il travaille 15 s (limite des fonctions planifiées : 30 s), rafraîchit la copie des groupes d'articles (une fois par jour, 6 s au plus), fait le ménage du journal (60 jours) et respecte la même fenêtre 7 h – 21 h.
3. **« Envoyer maintenant »** dans l'admin, même quand les envois automatiques sont suspendus.

## Mise en service

1. **Supabase, sécurité d'abord.** `restock_alerts` fait partie du **premier lot du plan de fermeture** (clé secrète + RLS, plan du 19/10). Tant que la table reste écrivable avec la clé publique, un tiers pourrait y glisser des demandes. Les plafonds limitent alors les e-mails (un par adresse sur 24 h, 150 par jour), mais seule la fermeture règle le problème : à faire avant d'activer les envois automatiques.
2. **Déploiement** (fusion de la branche `alertes-retour` dans `master`). Les envois automatiques sont **suspendus** au départ : les passages ne font que les clôtures, aucun e-mail ne part.
   - Variables déjà en place : `RESEND_API_KEY`, `CRON_SECRET`, `SUPABASE_KEY`. Sans `RESEND_API_KEY`, rien n'est réservé et l'admin l'indique.
   - Avant le SQL, la base est en « mode réduit » (annoncé dans l'admin) : envoi unique garanti, essais comptés dans `kv_store`. Un envoi incertain y reste de côté, sans « Relancer » possible.
3. **Supabase**, éditeur SQL, une fois : `sql/restock-notify.sql`.
   - Ajoute `attempts` et `outcome` (et `notified_at` s'il manquait), sans ouvrir aucun droit. Rejouable.
4. **Activation.** L'onglet affiche l'encadré « Mise en service » : combien d'e-mails partiront (destinataires valables seulement), combien de demandes seront closes sans e-mail (adresse plus rattachée, trop anciennes), et l'heure du prochain passage.
   - Zineb lit ces chiffres, puis clique « Activer les envois automatiques ». Cette date devient la mise en service (seuil des demandes anciennes).
   - Plusieurs e-mails peuvent donc partir le premier jour, 150 au plus. Chaque passage est compté dans le journal de l'onglet et dans les journaux Netlify (`[restock-notify] …`).
   - « Suspendre » coupe les envois automatiques à tout moment (anomalie de prix, de nom…), sans redéploiement et sans toucher aux e-mails des commandes groupées.

## Fichiers

- `netlify/functions/_restock.js` : logique (passage, envoi Resend, e-mail, aperçu de l'admin, mention de la Saisie).
- `netlify/functions/restock-notify.js` : HTTP (GitHub Action, admin : aperçu, envoyer, activer, relancer).
- `netlify/functions/restock-notify-cron.js` : passage planifié.
- `netlify/functions/restock-alert.js` : fonction existante.
  - « mes alertes » renvoie `notified`, `retour` et `retour_cip`, sans adresse e-mail ;
  - une nouvelle demande remet le suivi à zéro ; CIP en chiffres, nom du produit coupé à 200 caractères.
  - Modification admise par empreinte dans `scripts/verifie-zones.mjs`.
- `src/components/OrderEntry.jsx` (Saisie), `src/components/AdminAlertesRetour.jsx` et `src/AdminPanel.jsx` (onglet), `src/App.jsx` (arrivée par un lien produit sans « Offres du moment »).
- `scripts/run-sync.mjs` (appel après le stock), `netlify.toml` (planification), `sql/restock-notify.sql`.
- `kv_store` : `restock_notify:reglages` (actif, mise en service), `:groupes`, `:dernier`, `:passage:*` (journal), `:dest:*` (empreinte d'adresse, jamais l'adresse), `:jour:*` (compteur), `:essais:*` (mode réduit).
- Tests hors ligne : `node scripts/test-alertes-retour.mjs` (Supabase et Resend simulés, aucun envoi).
- Banc local : bandeau de la Saisie, tableau de bord de mise en service (envois suspendus), puis état « après le premier passage » une fois « Envoyer maintenant » cliqué. Aucun e-mail.

## Points ouverts

- **Mode réduit** (avant le SQL) : une demande avertie par e-mail après plus de 60 jours d'attente n'a pas la mention « De retour en stock » dans la Saisie. L'e-mail, lui, part. Rien à faire une fois le SQL passé.
- **Plafond par adresse** (un e-mail sur 24 h) : un second produit revenu le même jour attend le lendemain. À assouplir si Zineb préfère (`ADRESSE_HEURES`).
