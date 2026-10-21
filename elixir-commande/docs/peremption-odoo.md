# Péremption courte : « Odoo facture la remise » (V1)

Choix de Zineb (20/10/2026) : « Une remise saisie dans l'onglet Péremptions de l'admin crée automatiquement le prix dans
Odoo, puis le retire quand le produit sort de la page. Les produits qui ont aussi un lot long restent donc affichés au
prix normal, sauf si vous choisissez de les remiser. »

Ce document dit comment la fonction marche, comment la mettre en service, et que faire de chaque alerte. Le lot 0 (page
au prix facturé, mention « Pér. ») est décrit dans `docs/peremption.md`.

**État à la livraison : simulation.** Aucune écriture dans Odoo tant que les **deux verrous** ne sont pas ouverts :

1. la variable Netlify `PEREMPTION_ODOO_ECRITURE=1`, de portée « Production » seulement ;
2. le mode « Actif » choisi dans l'admin (onglet Péremptions).

---

## 1. Comment ça marche

### 1.1 La règle dans Odoo

Une remise = **une règle de prix Odoo par liste de prix**, sur les listes 5, 15, 1110, 1112, 1114 et 25 (jamais la 4,
Export). Chaque règle :

- vise le produit (`1_product`), en **pourcentage du prix de base** (« PGHT »), quantité minimale 0 ;
- porte une **date de début** (le repère de l'opération, identique sur les 6 règles, 2 minutes avant l'heure de
  l'opération pour qu'un léger décalage d'horloge entre Netlify et Odoo ne compte pas) et une **date de fin** : le dernier
  jour où le produit peut rester sur la page (péremption du lot court − 30 jours), 22 h 59 UTC ;
- s'ajoute aux règles d'Elixir sans les toucher : Odoo facture le **minimum** des règles, donc une règle commerciale plus
  basse (VIP) reste gagnante, et supprimer la règle rend exactement le prix d'avant.

La facture affiche « PU = prix de base, Remise X % ». Le site ne touche **jamais** une règle qu'il n'a pas créée : il
garde les identifiants de ses règles dans des tables Supabase privées (`sql/peremption.sql`).

Une remise ne peut pas naître si la règle vivrait moins de 24 h sur la page (« Fin trop proche ») : décidée le soir du
dernier jour, elle serait cachée aussitôt, voire déjà expirée dans Odoo.

### 1.2 L'ordre des opérations (le site n'affiche jamais un prix plus bas que la facture)

- **Poser** : réserver (table) → créer dans Odoo → relire chaque règle → contrôler le prix facturé sur les 6 listes (rapport
  des listes d'Odoo) → mettre à jour le prix du site → seulement alors, la page annonce la remise. Si une seule liste
  échoue, le site garde le prix habituel (toujours supérieur ou égal à ce que facture chaque liste) et la page n'annonce
  rien.
- **Retirer** : la page cesse d'annoncer et le site reprend le prix habituel (étape A, immédiate) → attente du délai
  (2 h) et de l'import des commandes en cours → le prix habituel est relu sur le site → suppression dans Odoo, une règle
  à la fois, après contrôle qu'elle n'a pas été changée à la main (étape B) → prix du site repris d'Odoo et relu.
- **Hausse de la remise** (prix plus bas) : écrite tout de suite dans Odoo (Odoo facture moins que le site entre-temps).
- **Baisse de la remise** (prix plus haut) : traitée comme un retrait partiel. La page cesse aussitôt d'annoncer la remise
  et le site reprend le prix habituel ; l'écriture dans Odoo attend le délai (2 h) et l'import des commandes en cours, puis
  la nouvelle remise est contrôlée et réannoncée. État « Baisse en attente » dans l'admin.
- Entre deux étapes, l'écart ne joue qu'**en faveur** de la pharmacie.
- **Piste d'audit** : chaque écriture Odoo laisse une ligne « demandé » au journal AVANT l'appel, puis une ligne
  « fait », « échec » ou « incertain ». Si le journal est en panne, rien n'est écrit dans Odoo.
- **Coupure** (délai, réseau) : une écriture dont la réponse se perd est relue au passage suivant ; une création perdue
  est retrouvée par son repère de date ; une modification perdue n'est jamais prise pour une modification faite à la main.

### 1.3 Ce que voient les pharmacies

- **Page « Péremption courte »** : une remise n'apparaît que si Odoo la facture **et** que le prix du site l'a reprise :
  prix de base barré, prix facturé, « −X % » (celui de la facture), « habituellement Y € ». Les autres produits sont au prix
  habituel avec « Péremption courte · lot au … ». Les produits « fantômes » (plus aucune boîte courte vendable, d'après la
  lecture d'Odoo de moins de 24 h) ne sont plus montrés. La remise disparaît de la page 3 h avant la date de fin de la
  règle, même si Odoo ne répond plus.
- **Panier** : la ligne garde « Pér. <date> · remise péremption −X % facturée par Odoo » jusqu'à la commande (e-mail à
  Elixir, onglet Commandes, « Mes commandes »). Si la remise finit pendant que la ligne attend dans un panier, la ligne
  remonte au prix actuel avec « La remise péremption a pris fin » ; si elle baisse, « La remise péremption facturée a
  changé ». Un panier enregistré par l'ancienne page (−50 % jamais facturés) remonte aussi pour un produit « fantôme ».
- **Carte de l'accueil** : « dès » et « jusqu'à −X % » ne comptent que les remises facturées ; sans aucune, la carte annonce
  les références sans prix (comme au lot 0).

### 1.4 Quand une remise s'arrête toute seule

| Cause | Quand | Ce qui se passe |
|---|---|---|
| Sortie par la date | 3 h avant la date de fin de la règle (page : aussitôt ; filet : au passage suivant) | étape A, puis B |
| Stock court épuisé ou parti en quarantaine | au passage horaire ou de nuit (lecture fraîche d'Odoo) | A puis B |
| Lot long reçu (non forcé) | idem | A puis B, et alerte « Lot long reçu : N boîtes » (réglage « maintien » : alerte seulement) |
| Produit rangé dans un menu promo, une campagne… | idem | A puis B |
| Règle supprimée ou modifiée à la main dans Odoo | idem | supprimée : constatée ; modifiée : plus aucune écriture, alerte |
| Règles retrouvées sous une décision close | à chaque passage | décision rouverte, retrait immédiat, alerte |

Un passage ne crée jamais de remise (sauf réglage « remise automatique », vide par défaut). Une nouvelle remise sur le
lot suivant demande une nouvelle décision.

### 1.5 Les passages

| Passage | Quand | Ce qu'il fait |
|---|---|---|
| Admin | boutons de l'onglet | aperçu, création, modification, retrait, « Réessayer », « Réconcilier maintenant » ; l'action est enregistrée, puis le navigateur la fait avancer pas à pas (chaque appel sous 10 s ; un 502 ou un 504 est réessayé) |
| Nuit | GitHub Action, chaîne stock → price → expiry → pharmacies ; l'étape expiry enchaîne **peremption** (`scripts/run-sync.mjs`, sans toucher à `.github/workflows/sync.yml`), qui recalcule elle-même le prix du site des CIP touchés | faits de toute la page, retraits, compléments, règles « orphelines », listes en usage, résumé par e-mail |
| Filet | fonction planifiée `peremption-cron` : complet à h:25 ; aux autres quarts d'heure, seulement s'il reste des retraits immédiats (« Tout retirer », « tout de suite ») | décisions ouvertes seulement : stock et dates, retraits A et B, baisses en attente, prix du site des remises retirées depuis 24 h, réservations à adopter, règles datées inconnues |

Un seul appel à la fois (verrou d'appel, rendu en 90 s si l'appel est coupé) ; un passage qui le trouve pris s'arrête
sans rien faire. Le filet ne complète pas une décision d'un passage de l'admin en cours depuis moins de 30 min.

### 1.6 Garde-fous

- **Simulation** : tout se calcule et se journalise (« simulé »), aucune écriture Odoo, aucun e-mail — y compris aucune
  suppression : les remises déjà posées restent facturées par Odoo jusqu'à leur retrait ou leur date de fin.
- **Créations suspendues** : plus de création ni de hausse de remise ; les retraits et les baisses continuent (ils vont
  dans le sens sûr).
- **Aperçus de déploiement Netlify** (deploy previews, branch deploys) : ils n'écrivent jamais dans Odoo (variable
  ignorée hors du contexte « production »), et la variable doit de toute façon être limitée à « Production ».
- **Disjoncteurs** : lecture du stock en échec, ou moins de la moitié des produits en stock de la veille → aucun retrait
  pour cause de stock ; plus de 30 % des produits facturés sortant pour cause de stock dans un même passage → retraits mis
  en attente, alerte (« Tout retirer » passe outre). Odoo injoignable : seuls les retraits par la date passent, alerte.
- **Commandes en cours illisibles** (relais ou commandes du site) : la suppression dans Odoo est reportée, jamais faite à
  l'aveugle.
- **Plafonds** : 40 produits par application en lot (240 règles), 120 produits remisés en même temps (toutes les
  décisions qui portent des règles comptent, pas seulement les « facturées »), 60 règles complétées par passage
  automatique.
- **Sous le coût** : impossible sans cocher, produit par produit, « Je vends sous le coût : perte X € par boîte, Y € sur
  les N boîtes ».
- **Demi-centime** : une remise qui tombe exactement sur x,xx5 € est refusée (Odoo arrondit au centime supérieur, la
  synchro « Prix remisés » du site au centime inférieur : le site afficherait 1 centime de moins que la facture) : prendre
  le pourcentage voisin (exemple : Oroken 200 à −30 % = 4,445 € → refusé ; −29 % ou −31 %).

### 1.7 Retour arrière

Dans cet ordre :

1. **« Retirer toutes les règles du site »** (bouton rouge, saisir RETIRER), avec la variable Netlify encore présente et
   le mode « Actif » ou « Créations suspendues ». La page cesse aussitôt d'annoncer toute remise et le site reprend les
   prix habituels ; les règles sont ensuite supprimées dans Odoo produit par produit (page ouverte) ou par le filet
   (dans le quart d'heure, si la page est fermée). C'est le **seul** moyen de faire cesser la facturation par Odoo.
2. Vérifier dans le journal complet que les lignes « Suppression dans Odoo » sont « fait » et que le compteur « Facturés
   par Odoo » est à 0.
3. Seulement ensuite, si on veut tout arrêter : mode « Simulation », ou retirer la variable Netlify **puis redéployer**
   (la variable n'est lue qu'au déploiement).

À savoir : « Créations suspendues » arrête les créations et les hausses, pas la facturation des remises posées ;
« Simulation » ou la variable retirée arrêtent TOUTE écriture, suppressions comprises : les règles restent alors jusqu'à
leur date de fin (si Odoo respecte les dates, essai T1), sinon indéfiniment. Les alertes par e-mail s'arrêtent aussi avec
les verrous (elles restent au journal).

---

## 2. Mise en service (étapes pour Zineb)

### Étape 1 : les tables (Supabase, 2 minutes)

1. Supabase → SQL Editor → New query.
2. Coller le contenu de `sql/peremption.sql`, puis **Run**.
3. Contrôle, dans une nouvelle requête :

   ```sql
   select relname, relrowsecurity from pg_class where relname like 'peremption\_%' and relkind = 'r';
   select mode, listes from peremption_reglages;
   ```

   Attendu : 6 lignes avec `true`, puis `simulation` et `{5,15,1110,1112,1114,25}`.

### Étape 2 : vérifier les variables Netlify (sans lire les secrets)

Netlify → Site configuration → Environment variables :

- `SUPABASE_SERVICE_ROLE_KEY` : doit **exister** (déjà utilisée par l'assistant). Ne pas l'ouvrir.
- `PEREMPTION_ODOO_ECRITURE` : **ne pas la créer maintenant.**

Le compte Odoo du site se contrôle à l'étape 3 (tuile « Droits Odoo »), pas ici. **Ne pas ouvrir `ODOO_APIKEY`.**

### Étape 3 : mise en ligne en simulation, contrôle des droits (T0, lecture seule)

1. **Déploiement**, seulement après les étapes 1 et 2 (sans la table, l'onglet Péremptions et la chaîne de nuit restent
   inactifs), par vous ou par Sam ou Claude avec votre accord. Envoi en avance rapide, **après** `appli-notifications`
   puis `peremption-lot0` (la branche contient les deux) :
   `git -C ~/Downloads/elixir-peremption-odoo-wt push origin peremption-odoo:master`. Jamais `--force` ; si l'envoi est
   refusé, `master` a bougé entre-temps : refaire l'intégration. Netlify publie le site.
2. Admin → onglet Péremptions → **« Actualiser depuis Odoo »** (1 à 2 minutes) : sans cela, toutes les lignes restent
   « Faits à lire » jusqu'à la première nuit.
3. Tuile « Droits Odoo » → **Contrôler (lecture seule)**. Attendu : « OK » et « Compte du site :
   pharmacien@elixirpharma.fr ».
4. Si « KO » : Odoo → Paramètres → Utilisateurs et sociétés → Utilisateurs → le compte du site :
   - onglet Droits d'accès, ligne **Ventes** : « Administrateur » (à défaut : groupe Healthsoft « Administratif /
     Commercial ») ;
   - **Sociétés autorisées** : cocher Elixir (société 2) ;
   - Enregistrer, puis relancer « Contrôler ».

### Étape 4 : deux ou trois nuits de simulation

- Le matin, onglet Péremptions → tuile « Dernier passage » (résumé de la nuit) et « Journal complet » : plan de la nuit,
  règles retrouvées, alertes (« simulé » : aucun e-mail), listes en usage.
- Essayer des aperçus et des « Simuler » sur quelques produits : le journal montre les valeurs exactes qui seraient
  envoyées à Odoo, liste par liste. La page des pharmacies n'annonce rien.
- Ces décisions simulées seront **closes** au passage en « Actif » (étape 6) : notez les produits et remises que vous
  voulez garder pour les réappliquer.

### Étape 5 : T1, respect des dates par Odoo (écriture, **accord explicite de Zineb**)

Sur la liste 2 « Liste de prix EUR » (aucune commande depuis le 12/03/2026, aucun client actif), pour Zinnat 125 :
une règle à −10 % avec une date de fin passée, puis future, puis une date de début future, puis supprimée. 4 écritures,
toutes défaites à la fin, chacune notée au journal (« Essai T1 »).

À lancer par Sam ou Claude sur le Mac, dans le dossier `elixir-commande`, les clés saisies sans être écrites dans la
commande (elles ne restent pas dans l'historique du terminal) :

```
read -s ODOO_APIKEY && read -s SUPABASE_SERVICE_ROLE_KEY && export ODOO_APIKEY SUPABASE_SERVICE_ROLE_KEY && \
  SUPABASE_URL=<adresse Supabase du site> PEREMPTION_ODOO_ECRITURE=1 \
  node scripts/essai-dates-peremption.mjs --ecrire --confirmer ZINNAT-LISTE-2
```

Sans `--ecrire`, la variable et la confirmation tapée, le script affiche seulement le plan. Si la réponse d'Odoo se perd,
la règle d'essai est retrouvée par son repère et supprimée ; le script échoue s'il reste une règle datée pour ce produit
sur la liste 2. Résultat : onglet Péremptions → Réglages → « Odoo respecte les dates (essai T1) » : **oui** ou **non**.
Si « non » : rien ne change dans le code, le filet horaire fait seul le travail (il cache la remise 3 h avant la fin de
la règle et la supprime ensuite).

### Étape 6 : T2, un produit et une vraie commande (écriture, **accord explicite de Zineb**)

1. Netlify : ajouter `PEREMPTION_ODOO_ECRITURE` = `1`, **portée « Production » seulement** (Scopes / Deploy contexts :
   Production), puis redéployer. Onglet Péremptions → Mode → **Actif**. La confirmation rappelle que les décisions
   simulées sont closes (rien n'avait été écrit dans Odoo) : les réappliquer ensuite avec un nouvel aperçu.
2. Zinnat 125 (CIP 3400933121549) : saisir **12** dans « Remise % » → « Appliquer dans Odoo ».
   - La conception proposait −10 % ; avec le seuil d'annonce de 5 %, −10 % (3,37 € contre 3,51 €, 4 % d'économie) est
     refusé « sans effet ». −11 % (3,33 €) est juste au seuil ; **−12 % = 3,29 €** (perte 0,15 € par boîte, 1,50 € sur les
     10 boîtes). Autre choix : baisser le seuil dans les réglages le temps de l'essai.
   - L'aperçu montre les 6 listes et « La facture affichera : PU 3,74 € · Remise 12 % » ; cocher « Je vends sous le
     coût… », puis « Créer les 6 règles ».
   - Attendu : état « Facturé par Odoo », 6/6 règles vérifiées, prix du site 3,29 €, la page annonce « 3,74 € barré,
     3,29 € HT −12 % ».
   - Contrôle dans Odoo : Ventes → Configuration → Listes de prix → « Liste de prix EUR 2 » → règles du produit.
3. Une commande réelle d'une boîte, en « Commander pour une pharmacie », pour une pharmacie d'accord. Après l'import
   (1 à 35 min), la ligne Odoo doit porter « PU 3,74 · Remise 12 % ».
4. « Retirer » : la page affiche aussitôt 3,51 € ; la règle est supprimée au premier passage horaire (h:25) après 2 h,
   donc entre 2 h et 3 h après (ou cocher « Tout de suite ») ; le journal est complet.

### Étape 7 : ouverture

- Choisir un premier lot (40 produits au plus) : de préférence seulement courts, peu vendus par les logiciels, avec une
  remise supportable face à la destruction (l'aperçu donne la perte, le repère « destruction », la remise maximale sans
  perte et l'économie réelle pour la pharmacie sur son prix habituel).
- Cocher les produits (« Tout sélectionner » ne prend que les produits sans remise en cours), « Appliquer une remise de
  X % à la sélection », cocher chaque produit sous le coût, saisir le nombre de règles. Les produits déjà remisés ne sont
  modifiés que si vous cochez la case qui les liste.

### Étape 8 : surveillance pendant un mois

Journal, alertes (e-mails « [Péremptions] » à `ADMIN_EMAIL`), compteur « perte prévue » (recalculé chaque jour sur le
stock court restant), et chaque jour **Contrôle des écarts** (onglet Péremptions, en bas) : lignes « page péremption
probable » (PU du panier = prix de base × 0,5, ou mention « Pér. ») à part des autres écarts (client d'une autre liste
que la 5, prix changé entre le panier et l'import). « Exporter (CSV) » pour la vérification ligne à ligne et les avoirs.
Premier contrôle de cohérence : on doit retrouver les 9 pharmacies et 172,56 € du relevé du 20/10 (conception § 16.1).

---

## 3. L'onglet Péremptions de l'admin

- **Bandeau** : mode (Simulation, Actif, Créations suspendues ; « Actif » grisé sans la variable Netlify ; « Actif, sans
  effet » en orange si la variable a disparu), écriture Odoo permise, droits Odoo, filet Odoo (T1), dernier passage
  (avec le résumé de la nuit) et journal complet ; bandeau rouge « Filet horaire en échec depuis … » ; boutons
  « Actualiser depuis Odoo » (synchro des péremptions puis faits frais), « Réconcilier maintenant », « Retirer toutes les
  règles du site ».
- **Compteurs** : produits sur la page (les « fantômes » masqués à part), facturés, non facturés dont à remiser, en cours,
  en retrait, en erreur, perte prévue (stock court des produits facturés, faits du jour) contre la valeur de ce stock au
  coût.
- **Tableau** (ce qui demande une action d'abord) : lot court et fin de page, boîtes courtes / longues / sans date (lues
  dans Odoo), prix de base, prix habituel liste 5 (figé à la décision pour un produit remisé), coût, remise (sur le prix
  de base, comme la facture), prix péremption, économie pour la pharmacie sur son prix habituel, marge, ventes 30 j (dont
  logiciels), état et actions.
- **États** : Facturé par Odoo (vert) ; Facturé, page à mettre à jour ; En cours (bleu) ; Baisse en attente ; Simulé ;
  À remiser (proposé : seulement court, sans exclusion) ; Non facturé (lot long, sans décision) ; Non remisable (multi-CIP,
  menu promo, campagne, justificatif, Sanofi Pro, variantes) ; Court épuisé ; Sortie par la date ; Retrait en attente
  (jaune : caché sur le site, suppression dans Odoo au premier passage après le délai ou l'import des commandes) ; Partiel,
  Erreur, Modifié dans Odoo (rouge : « Réessayer », « Retirer »).
- **Aperçu** (« Appliquer dans Odoo » ou « Modifier ») : les 6 listes (prix aujourd'hui, prix après, économie, changement
  exact dans Odoo : « Créer … » ou « Modifier la règle n° … : remise X % → Y % (dates inchangées) »), ce que dira la
  facture, stock touché et case « Forcer » pour les boîtes longues, marge et pertes, case « sous le coût », effet sur les
  logiciels, fin automatique. En lot : créations et modifications comptées à part, produits écartés listés avec leur
  raison, perte des produits cochés. L'aperçu lit Odoo à l'instant ; si un prix change avant la création, elle est refusée
  (« l'aperçu a changé »). Un clic à côté ne ferme pas la fenêtre quand une case est cochée.
- **Retrait** : la fenêtre (« Retirer », « Tout retirer ») lit les décisions, les règles dans Odoo et les commandes du site
  en cours d'import avant la confirmation ; bandeau rouge si les verrous sont fermés (les règles resteraient facturées).
- **Journal** : en français (action, résultat, détail en phrases), « détail technique » repliable, lien « Voir dans Odoo »
  sur la société Elixir.
- **Réglages** : voir § 5 ; une valeur hors limites est ramenée dans les bornes et signalée. **Contrôle des écarts** :
  § 16.1 de la conception, export CSV.

## 4. Que faire sur chaque alerte

| Alerte | Que faire |
|---|---|
| Échec de création | Lire le message (liste refusée, prix différent…). « Réessayer » ; si ça persiste, « Retirer ». Le site garde le prix habituel. |
| Règle modifiée dans Odoo | Quelqu'un a changé la règle à la main. Remettre la valeur d'origine dans Odoo (puis « Réessayer ») ou la supprimer à la main (puis « Retirer »). Le site n'y touche plus d'ici là. |
| Règle datée inconnue | Une règle avec une date de début existe sur une liste couverte sans venir du site. Rien à faire si Elixir date ses propres règles. |
| Règles du site retrouvées sous une décision close | Rien : la décision est rouverte et ses règles supprimées tout de suite. Si l'alerte dit qu'une autre décision est ouverte : « Retirer » le produit, puis vérifier dans Odoo. |
| Doublon d'une règle du site | Supprimer à la main dans Odoo la règle indiquée (le site ne l'a pas fait : verrous fermés ou règle changée). |
| Liste de prix en usage non couverte | Des commandes PharmaML portent une autre liste. L'ajouter dans les réglages si ses clients doivent profiter des remises. |
| Lot long reçu | La remise est retirée (réglage « retrait »). Pour la garder sur toutes les boîtes : attendre la suppression (heure donnée dans l'alerte) ou cliquer « Supprimer tout de suite », puis réappliquer avec « Forcer ». |
| Disjoncteur des retraits | Vérifier le stock dans Odoo. Si les sorties sont réelles : « Réconcilier maintenant » le lendemain, ou « Retirer » produit par produit. |
| Odoo injoignable pendant un passage | Rien dans l'immédiat : la page cesse d'annoncer les remises arrivées à leur date ; les suppressions reprennent au retour d'Odoo. Si ça dure, vérifier la clé et Odoo. |
| Suppression dans Odoo en échec / Retrait bloqué depuis plus de 24 h | Odoo continue de facturer la remise. Onglet Péremptions → « Droits Odoo » → Contrôler ; au besoin, supprimer les règles à la main dans Odoo. |
| Passage « filet » en échec | Lire l'erreur du bandeau rouge ; les retraits automatiques ne se font pas tant qu'elle dure. |
| Retrait (ou baisse) après 24 h d'attente / avec commandes en cours | Vérifier à leur import les commandes listées : elles sont facturées au prix habituel (ou à la nouvelle remise). |
| Plusieurs règles pour une réservation | Vérifier dans Odoo et supprimer le doublon à la main. |

## 5. Réglages (propositions en attendant les réponses de Zineb, modifiables sans code)

| Réglage | Valeur à la livraison | Question (conception § 16.3) |
|---|---|---|
| Base de la remise | % du prix de base, comme la facture | ou % du prix habituel liste 5 : la page barre alors le prix habituel, mais la facture affiche la remise équivalente sur le prix de base (ex. 15,53 % pour 10 %) |
| Remise automatique | vide : seulement les remises saisies | une remise par défaut la nuit (jamais sous le coût) |
| Vente sous le coût | confirmation explicite par produit, perte affichée | ou interdite ; perte maximale par produit ; budget mensuel |
| Ventes par les logiciels | pas de limite | ou seulement les produits peu vendus par LGO |
| Lot long reçu | retrait automatique et alerte | ou maintien jusqu'à décision |
| Délai avant suppression (et avant une baisse) | 120 min | |
| Seuil d'annonce | 5 % d'économie sur le prix habituel | |
| Listes | 5, 15, 1110, 1112, 1114, 25 ; jamais la 4 | |

## 6. Fichiers

`sql/peremption.sql` ; `netlify/functions/_peremption.js` (logique, seule porte d'écriture Odoo, par `_odoo-rpc.js`),
`peremption.js` (page publique, admin, nuit), `peremption-cron.js` (filet) ; `netlify.toml`, `scripts/run-sync.mjs`
(l'étape expiry enchaîne peremption ; `.github/workflows/sync.yml` inchangé, un jeton sans droit « workflow » ne peut pas le pousser) ; `src/components/PeremptionsAdmin.jsx` (onglet admin, chargé à la demande),
`ShortExpiry.jsx`, `src/peremption-panier.js`, `src/App.jsx` (hors zones protégées), `AdminPanel.jsx`,
`MyOrdersPanel.jsx` ; accueil : `_accueil-outils.js`, `_accueil-donnees.js`, `rubriques.js`, `AdminVedettes.jsx` ;
`scripts/essai-dates-peremption.mjs` (T1, par la porte d'écriture du module).

Tests : `node scripts/test-peremption-odoo.mjs` (faux Odoo à logique MIN et dates, faux Supabase, latence simulée),
`test-peremption-mention.mjs`, `test-accueil-outils.mjs`, `test-securite-2.mjs`. Banc : `BANC_PEREMPTION_MODE=actif
BANC_PEREMPTION_ECRITURE=1 BANC_PEREMPTION_ESSAI=1 npx vite` (vrai code sur faux Odoo, relevé du 20/10/2026 dans
`dev-fixtures/peremption-odoo.json`).

## 7. Limites connues

- **Prix de la liste 5** : la page affiche le prix de la liste 5 ; une pharmacie d'une liste dont le prix est déjà plus bas
  (VIP) paie moins. Jamais plus.
- **Mention « Pér. »** : perdue pour un produit rangé dans un menu (l'ajout va sur la ligne du menu) ; le prix, lui, est
  juste après la synchro des prix.
- **Commandes passées par les logiciels** : la remise vaut aussi pour elles (mécanisme Odoo) ; l'aperçu chiffre l'effet.
- **Synchro « Prix remisés » lancée seule** avec des règles relues avant une suppression : peut remontrer une remise
  retirée ; le filet suivant (au plus 1 h) reprend le prix d'Odoo des remises retirées depuis 24 h. L'option `chargerRegles`
  d'`odoo-price-sync` (conception § 6) fermerait ce cas ; non faite (zone protégée).
- **Lecture des lots par `odoo-expiry-sync`** (50 lots au plus par produit) : sans effet sur les décisions (lues à part),
  mais la page peut montrer une date fausse pour 22 produits ; correctif séparé recommandé.
- **Ligne de la Saisie complétée depuis la page** sous une remise facturée : la ligne garde le prix de la Saisie (plus haut)
  et prend la mention de la remise ; Odoo facture la remise (en faveur de la pharmacie).
