# Péremption courte : remise affichée, règle panier et rectification des écarts

**Décision de Zineb (21/10/2026)**, après avoir appris que le −50 % n'avait jamais été facturé par Odoo (qui facture la liste
de prix du client) et qu'à −50 % 175 produits sur 178 sont vendus sous le coût : « je veux que par défaut le −50 s'affiche
et que ce soit la règle panier qui s'applique ; si le travail manuel côté admin n'est pas fait, on rectifiera les écarts
depuis l'affichage des écarts ». C'est un choix commercial : la page et le panier promettent le prix remisé ; Odoo facture
le tarif de la liste du client tant qu'Elixir ne corrige pas la ligne (ou ne pose pas de règle Odoo) ; l'écart se rectifie
ensuite depuis l'onglet Péremptions de l'admin.

Ce fichier dit ce qui est en service. Le mécanisme « Odoo facture la remise » (règles de prix Odoo, V1) est décrit dans
`docs/peremption-odoo.md` ; il reste en place et sert à faire facturer par Odoo, produit par produit, la remise affichée.

## 1. Règle du 21/10/2026

### 1.1 La page « Péremption courte » (pharmacies)

Chaque produit de la page a une **offre** (`offreAffichee`, `src/peremption-panier.js`), la même pour la page, le panier, la
carte de l'accueil et l'admin :

| Cas | Prix affiché | Remise affichée |
|---|---|---|
| Règle Odoo facturée (V1, état « Facturé par Odoo ») | prix facturé (prix du site repris) | celle de la facture, « remise sur facture » |
| Remise affichée choisie par l'admin (1 à 90 %) | prix de base × (1 − remise) | celle de l'admin |
| Remise affichée de l'admin à 0 % | prix habituel (Saisie, liste n° 5, paliers) | aucune |
| Sinon (défaut, comme avant le 20/10) | prix de base × 0,5 (× 0,8 dès 500 € de prix de base) | −50 % (−20 %) |

- Prix de base = `list_price` (PGHT, « PU » de la facture), **barré** à côté du prix remisé, badge « −50 % ».
- Jamais plus cher que le prix habituel : si le prix habituel (liste n° 5) est déjà sous le prix remisé (FFP2 : 2,99 € contre
  5,99 × 0,5), la page affiche le prix habituel, sans remise.
- Encart : « La remise péremption est déjà déduite du prix affiché. Chaque produit ajouté garde ce prix et la date de son lot
  sur une ligne à part de votre panier. »
- Lecture : `peremption?action=page` (produit par produit : `remise_admin`, offre, règle facturée ; produits « fantômes »
  sans boîte courte retirés). Repli si la fonction ne répond pas : `odoo-catalog?expiry_months=4` et la lecture publique
  `restock-alert?action=expiry_discounts` ; même calcul.
- Produits rangés dans un menu (Hec, Euphytose, FFP2, Mercryl en Centrale OTC, Zytiga en Sélection Expert…) : même offre ;
  l'ajout depuis la page ne va plus sur la ligne du menu (§ 1.2).

### 1.2 La règle panier

- Un ajout depuis la page est une **ligne à part** du panier, rayon « Péremption courte », au **prix de la page**, avec
  « Pér. <date> · −50 % » (date du lot le plus court affichée à l'ajout) et le prix de base. Identité propre (`per:<CIP>`) :
  jamais fondue dans la ligne d'un menu ou de la Saisie du même CIP. Ajouter de nouveau le même produit depuis la page
  additionne les boîtes sur cette ligne, à l'offre du moment.
- Pas de règle de colis sur cette ligne (le prix carton du menu ne la concerne pas) ; justificatif labo et contingentement :
  comme toute ligne (le justificatif d'un CIP est gardé tant qu'une de ses lignes reste au panier).
- Même produit sur une autre ligne du panier (menu, Saisie) : la ligne péremption part dans une **commande à part**,
  enregistrée et relayée juste après l'autre (deux lignes d'un même CIP dans une commande PharmaML : comportement inconnu).
  Ses lignes portent `separeDe` (n° de l'autre commande). L'anti-doublon du relais (`_relais.js`) marque une ligne
  péremption (« :per ») : la commande à part n'est pas prise pour un double envoi. Le panier l'annonce sous la ligne.
- Accueil : la carte d'un produit ne compte pas la ligne péremption, et « − » ne la touche jamais.
- « Recommander » (Mes commandes) ne reprend pas une ligne péremption (offre liée à un lot) : message.
- Bon copié : « Pér. 31/12/2026 · −50 % · péremption courte » sous la ligne.

### 1.3 La commande

- Ligne enregistrée (`elixir_orders.items`) : `pn` = prix de la page, `note` (« Pér. 31/12/2026 »), `peremption` (date),
  `remise` (%), `facture_odoo` (true : une règle Odoo la facture), `separeDe` pour une commande à part. Le relais PharmaML
  n'en lit que `cip`, `name`, `qty`, `pn` : PharmaML et Odoo ne voient que le CIP, la quantité et le prix.
- E-mail à Elixir : « — PÉREMPTION COURTE (Pér. 31/12/2026, −50 %, prix de la page) », puis « ⚠ prix de la page Péremption
  courte (−50 %) non repris par Odoo, qui facture le tarif de la liste du client : corriger 2 boîtes à 5,16 € (sinon :
  Contrôle des écarts, onglet Péremptions) » ; commande à part : les deux numéros et « corriger 2 boîtes seulement, pas toute
  la ligne » (le connecteur additionne les boîtes du même produit sur une ligne Odoo). Ligne facturée par une règle Odoo :
  « remise −12 % facturée par Odoo », sans consigne.
- Admin, onglet Commandes : badge « Pér. 31/12/2026 · −50 % · prix non repris par Odoo : corriger 2 × 5,16 € » (ou
  « · facturée par Odoo »), « à part de la n° … » ; export Excel : colonne « Mention ». « Mes commandes » : le badge.

### 1.4 Panier enregistré (`controlerPrixPanier`, `src/App.jsx`, hors zones protégées)

Au chargement, à l'ouverture et à la fermeture du panier, au changement de pharmacie (saisie Elixir) et au retour sur
l'onglet, la page est relue (lecture partagée 5 min) et `controleLignes` :

- remet une ligne péremption à l'offre **actuelle** de la page si le produit y est encore (prix, remise, règle Odoo, date ;
  à la hausse comme à la baisse) : « Péremption courte : prix de la page mis à jour (Hec : 7,22 €, −30 %) » ;
- remet au **prix habituel** une ligne dont le produit a quitté la page (date, lot court épuisé ou en quarantaine) : la
  ligne est rajoutée comme un ajout ordinaire (ligne du menu s'il y en a une), « Plus en péremption courte, ligne remise au
  prix habituel » ; prix d'un produit absent de toutes les listes de la page : `peremption?action=prix` ;
- fait d'une ligne d'un panier de l'ancienne page (avant le 20/10 : −50 % sans mention) une ligne péremption ; une ligne du
  lot 0 (mention au prix habituel) prend le prix de la page.

Le contrôle du lot 0 qui remontait toute ligne au prix habituel est retiré : la règle panier n'est plus défaite. Si le
panier change pendant la lecture, rien n'est appliqué (le contrôle suivant reprend).

### 1.5 Carte « Péremption courte » de l'accueil

Titre « Péremption courte, petits prix », accroche « … la remise est déjà dans le prix affiché », badge par défaut « Petits
prix », « dès 0,44 € HT » (plus bas prix affiché) et médaillon « jusqu'à −50 % » (plus forte remise affichée, rapportée au
prix de base barré : `REMISE_REFERENCE` « page »), calculés par `_accueil-outils.js` sur les offres de la page (seuil
d'annonce : 5 % d'économie sur le prix habituel). Sans aucune remise affichée (toutes à 0 par l'admin) : ni « dès » ni
« jusqu'à », et un badge « Petits prix » n'est pas affiché.

### 1.6 Onglet « Péremptions » de l'admin

- Colonne **« Page : remise affichée · facturée par Odoo ? »** : l'offre de chaque produit (« −50 % (défaut) », « −30 %
  (admin) », « −12 % facturée par Odoo », « aucune »), le prix affiché, et « facturée par Odoo : aucun écart » ou « non
  facturée par Odoo : écarts à rectifier ». Champ « % » : la remise affichée du produit (0 à 90 ; 0 = aucune ; vide =
  défaut), « Enregistrer », « Défaut ». Écrite dans `expiry_discounts` par `peremption.js` (clé serveur, journalisée),
  **sans aucune écriture Odoo**. Compteur « Remisés sur la page ».
- Colonne « Règle Odoo : remise % » : préremplie avec la remise affichée ; « Appliquer dans Odoo » fait facturer par Odoo
  le prix que la page annonce (aperçu, confirmation sous le coût par produit, verrous : `docs/peremption-odoo.md`). Un
  produit dont la règle est facturée n'a plus d'écart.
- Tuile **« Écarts à rectifier »** du bandeau : « 41,16 € à rectifier pour 3 pharmacies » (lignes « Pér. » depuis le
  21/10/2026, relu à l'ouverture de l'onglet, gardé 10 min ; « Relire »), « Voir les écarts ».
- **Contrôle des écarts** (§ 2).

## 2. Rectifier les écarts

Le Contrôle des écarts (onglet Péremptions, en bas, ou « Voir les écarts ») lit les commandes du site de la période et,
pour chaque ligne prise au prix de la page (« Pér. », remise ≥ 1 %), sa ligne de vente dans Odoo (lecture seule) :

- **écart** = (net facturé par Odoo − prix de la page) × boîtes (celles de la ligne du site, au plus celles de la ligne Odoo :
  une commande à part est retrouvée sur la ligne de l'autre commande, où le connecteur a additionné les boîtes) ;
- une ligne facturée par une règle Odoo (`facture_odoo`) ou corrigée à la main dans Odoo (net ≤ prix de la page) n'a
  **aucun** écart et n'apparaît pas ;
- colonnes : date, pharmacie, n° de commande du site (et « à part de … »), commande Odoo (S…) et liste de prix, produit,
  boîtes, prix de la page, facturé, écart, « Pér. » et remise, facturation (« à facturer », « facturée »), statut ;
  « à vérifier » si le prix de la ligne est sous le prix de base d'Odoo × (1 − remise) (prix de base changé depuis, ou ligne
  à contrôler avant de rembourser) ;
- totaux par pharmacie (à rectifier, rectifié) et en tout ; filtre du… au… (par défaut depuis le 21/10/2026) ; lignes à
  rectifier, rectifiées ou toutes ; export CSV (avec statut, référence, qui, quand) ; sur demande, les lignes « probables »
  de l'ancienne page (avant le 20/10, sans mention : PU = prix de base × 0,5) et les autres écarts (liste ≠ 5, prix changé).

**Procédure** (chaque jour pendant le premier mois, puis chaque semaine) :

1. Admin → Péremptions : la tuile « Écarts à rectifier » donne le montant et le nombre de pharmacies.
2. « Voir les écarts » : pour chaque ligne « à rectifier » :
   - commande Odoo **pas encore facturée** (« à facturer ») : corriger dans Odoo le prix des boîtes indiquées (le prix de la
     page) ; au contrôle suivant, la ligne disparaît d'elle-même (plus d'écart) ;
   - commande **facturée** : faire un avoir (ou une remise sur la facture suivante), puis « Marquer rectifié… » avec la
     référence (n° d'avoir) ; « Tout marquer rectifié… » fait de même pour toutes les lignes d'une pharmacie (un avoir).
3. Le statut garde qui et quand, et les montants au moment du marquage ; « Annuler » le remet « à rectifier ». Chaque
   changement est écrit au journal de l'onglet (ajout seul).
4. Pour ne plus avoir d'écart sur un produit : « Appliquer dans Odoo » (règle facturée), ou remise affichée à 0 %.

Suivi : table privée `peremption_ecarts` (`sql/peremption-ecarts.sql` : RLS activé, aucune policy, clé serveur seulement).
Sans elle, les écarts restent lisibles, mais « Marquer rectifié » répond « suivi non installé ».

## 3. Mise en service

1. **Supabase → SQL Editor** : coller `sql/peremption-ecarts.sql`, **Run** (rejouable). Contrôle :
   `select relname, relrowsecurity from pg_class where relname = 'peremption_ecarts';` → `true`. (`sql/peremption.sql`, la
   V1, est nécessaire au journal et à la tuile « Dernier passage », pas à la page ni aux écarts.)
2. Variables Netlify : `SUPABASE_SERVICE_ROLE_KEY` doit exister (déjà utilisée) ; rien à ajouter.
3. Mise en ligne en avance rapide de la branche `peremption-affichage` (faite sur la production `b1dbd3e`) :
   `git -C ~/Downloads/elixir-perem50-wt push origin peremption-affichage:master`. Jamais `--force` ; si l'envoi est refusé,
   `master` a bougé : refaire l'intégration.
4. Après la mise en ligne : page Péremption courte (−50 %, prix barrés), un ajout depuis la page (ligne à part au panier),
   carte de l'accueil (« jusqu'à −50 % »), onglet Péremptions (colonne « Page », tuile « Écarts à rectifier »).
5. Les onglets ouverts avant la mise en ligne et non rechargés gardent la page du lot 0 (prix habituel) jusqu'au
   rechargement ; leurs paniers passent à la règle panier au premier chargement.

## 4. Fichiers et tests

`src/peremption-panier.js` (offre, ligne à part, mentions, séparation, contrôle du panier enregistré ; pur, importé aussi
par `_peremption.js` et `_accueil-outils.js`), `src/components/ShortExpiry.jsx`, `src/App.jsx` (zones protégées : écarts
déclarés dans `scripts/verifie-zones.mjs`, lot `peremptionPanier`), `src/AdminPanel.jsx`, `src/components/MyOrdersPanel.jsx`,
`src/components/PeremptionsAdmin.jsx`, accueil (`rubriques.js`, `vedettes.js`, `AdminVedettes.jsx`) ;
`netlify/functions/peremption.js` (`page`, `prix`, `ecarts`, `ecarts_resume`, `remise_affichee`, `ecart_statut`),
`_peremption.js`, `_accueil-outils.js`, `_relais.js` (empreinte « :per », seule fonction existante modifiée) ;
`sql/peremption-ecarts.sql`. Aucune écriture Odoo nouvelle : seules les règles V1 écrivent dans Odoo, par leur porte.

Tests : `node scripts/test-peremption-panier.mjs` (règle panier sur le vrai code d'App.jsx, de la page et de la ligne
d'empreinte du relais, comparée à la production `b1dbd3e` et à la page d'avant le 20/10 `d840631`),
`test-peremption-mention.mjs` (page, mention, parties de l'admin), `test-peremption-odoo.mjs` (offre de la page, remise
affichée, écarts et statuts sur un faux Odoo et un faux Supabase), `test-accueil-outils.mjs` (carte). Banc :
`BANC_PEREMPTION_MODE=actif BANC_PEREMPTION_ECRITURE=1 BANC_PEREMPTION_ESSAI=1 BANC_PEREMPTION_ECARTS=1 npx vite`
(commandes d'exemple de pharmacies fictives pour le Contrôle des écarts).

Limites connues :

- La quarantaine d'`order-save` (commandes sans jeton valide, jusqu'au 02/11) recopie les lignes champ par champ : la mention,
  la remise et `separeDe` s'y perdent (fichier protégé) ; le PU reste celui de la page. L'impression ne montre pas la mention.
- La date de la mention est celle affichée à l'ajout, pas celle du lot livré (FEFO non garanti).
- L'écart ne compte que les lignes facturées **plus cher** que le prix de la page ; une pharmacie d'une liste plus basse
  (VIP) n'en a pas.
- Une ligne de commande saisie ou modifiée à la main dans Odoo (autre référence PharmaML, produit substitué) n'est pas
  retrouvée : elle n'apparaît pas dans les écarts.

## Historique : lot 0 (20/10/2026), remplacé le 21/10/2026

Le lot 0 avait retiré toute remise de la page (prix habituel, mention seule) et remontait au prix habituel les paniers de
l'ancienne page. Ce qui suit décrit ce lot tel qu'il a été en ligne le 20/10/2026.

### Lot 0 : la page cesse d'annoncer des remises qu'Odoo ne facture pas (site seul)

Constat : depuis le 14/03/2026, la page affichait −50 % (−20 % dès 500 €), ou la remise saisie dans l'admin, mais Odoo
facturait toujours le prix de la liste du client. La pharmacie voyait 5,16 € et payait 9,76 € (Hec pommade).

Ce que fait le lot 0 :

- **Page « Péremption courte » (pharmacies)** : le prix affiché est le prix habituel, le même que dans la Saisie de
  commande (`prixPage`, `src/peremption-panier.js`) : prix remisé de la liste n° 5 (`odoo_catalog.discounted_price`,
  synchro « Prix remisés ») s'il y en a un, sinon le prix catalogue ; paliers de quantité d'Odoo affichés (badge) et
  appliqués au panier. Ni prix barré, ni remise, ni −50 %. Encart : « Prix habituels, comme dans le reste du catalogue :
  aucune remise péremption pour l'instant. » La date du lot le plus court et les lots restent affichés.
  - **C'est le prix de la liste n° 5**, comme partout sur le site, pas forcément celui de la facture du client. Relevé
    Odoo du 20/10/2026 sur les 178 produits de la page : la page est égale à la liste 5 pour 178 sur 178 ; Odoo facture
    **plus cher** pour 90 produits en liste 15, 77 en liste 1110 et 177 en liste 25, **moins cher** pour 96 en liste
    1112 et 175 en liste 1114. Écart connu de tout le site, hors de ce chantier.
  - Produit rangé dans un menu du catalogue (ou une campagne) : la page affiche le prix que prendra le panier, celui du
    menu (`prixDuMenu`, même recherche qu'`addItemToCart`), avec « prix du menu « … » » s'il diffère de la Saisie.
  - Ajout par les règles de la Saisie (`ajouterDepuisSaisie`) : colis Stratège et gamme blanche, palier Master, campagne,
    justificatif et contingentement ; le panier s'ouvre, comme avant. Produit sans prix : « Ajouter » désactivé.
- **Mention « Pér. <date> »** : un ajout depuis la page garde la date du lot sur la ligne hors catalogue du panier
  (encart « Pér. 31/12/2026 · péremption courte, au prix habituel »), dans la commande enregistrée (`note`,
  `peremption` : onglet Commandes de l'admin, « Mes commandes ») et dans l'e-mail à Elixir (« — PÉREMPTION COURTE
  (Pér. 31/12/2026, sans remise péremption) »). Elle sert face à une demande de retour « date trop courte ».
  - Elle ne change ni le prix, ni l'identité de la ligne (le CIP), ni le relais PharmaML (qui ne lit que `cip`, `name`,
    `qty`, `pn`) : une seule ligne et une seule commande, comme avant. PharmaML et Odoo n'ont aucun champ texte par
    ligne : la mention reste dans le site.
  - Produit rangé dans un menu du catalogue : l'ajout va sur la ligne du menu, au prix du menu, et la mention se perd
    (5 produits sur 178 le 20/10 : Hec, Euphytose, FFP2 et Mercryl en Centrale OTC, Zytiga en Sélection Expert ; tous au
    prix de la Saisie ce jour-là).
  - La mention donne **la date affichée au moment de l'ajout**, pas celle du lot livré : Odoo peut servir un autre lot
    (FEFO non garanti). 11 produits « fantômes » n'ont plus de boîte courte vendable (quarantaine, destruction ou boîte
    vendue : Parlodel 10, Buprénorphine/Naloxone Viatris, Repaglinide Viatris…) mais restent sur la page, et sont comptés
    par la carte de l'accueil, jusqu'au lot qui lit les faits frais d'Odoo (`lireFaits`). Un correctif séparé
    d'`odoo-expiry-sync` (lots lus par identifiant au lieu de `limit: 50`) est recommandé.
  - La mention ne suit pas : la quarantaine d'`order-save` (commandes sans jeton valide, jusqu'au 02/11 : lignes recopiées
    champ par champ, fichier protégé), la copie du bon (`handleCopy`, zone protégée) et l'impression.
  - Même produit ajouté par la Saisie et par la page : une seule ligne, quantités additionnées, mention gardée.
- **Carte « Péremption courte » de l'accueil** (`_accueil-outils.js`) : ni « dès » ni « jusqu'à » (`des` et `jusqua`
  à `null`), titre « Lots à date courte, en stock », accroche « … à leur prix habituel, avec la date de chaque lot »,
  badge par défaut « Date courte » ; un badge « Petits prix » déjà publié n'est pas affiché. Une seule lecture
  (`odoo_catalog`, 3 colonnes) : `expiry_discounts` n'est plus lue.
- **Panier enregistré avant la mise en ligne** : l'ancienne page mettait au panier −50 % (−20 % dès 500 €), et le
  panier enregistré dans le navigateur garde ce prix. Au chargement du site, à l'ouverture et à la fermeture du panier
  et au changement de pharmacie (saisie Elixir), `controlerPrixPanier` (`src/App.jsx`, hors zones protégées) relit la
  page (`odoo-catalog?expiry_months=4`, lecture publique gardée 5 min) et remonte au prix de la page toute ligne hors
  catalogue dont le CIP y figure et dont le prix est plus bas (`remonterPrix`) ; un prix n'est jamais baissé. Message
  « Prix mis à jour : la remise péremption affichée auparavant n'était pas facturée par Odoo (Zaditen : 3,60 €) » et
  encart sur la ligne. Une ligne dont le produit a quitté la page n'est pas relue.
- **Onglet « Péremptions » de l'admin** : il fonctionne comme avant (synchro des péremptions, liste), avec un encart
  « Remises non facturées ». **Plus aucune remise ne se saisit** : `expiry_discounts` n'est plus écrite (l'ancienne
  page, encore ouverte dans des onglets non rechargés, l'appliquait comme prix affiché ; la table est publique ; la suite
  ne la reprend pas). Une remise déjà notée s'affiche en lecture seule (« notée, non reprise »). Le prix de la liste n° 5
  (celui que voient les pharmacies) est affiché à côté du prix de base.

Fichiers : `src/peremption-panier.js` (parties pures), `src/components/ShortExpiry.jsx`,
`src/components/PeremptionsAdmin.jsx` (encart et remise notée de l'admin, chargés avec l'admin seulement), `src/App.jsx` (mention : 5
écarts déclarés dans `scripts/verifie-zones.mjs`, lot `peremptionMention`), `src/AdminPanel.jsx`,
`src/components/MyOrdersPanel.jsx`, `netlify/functions/_accueil-outils.js`, `src/components/accueil/rubriques.js`,
`vedettes.js`, `AdminVedettes.jsx`, `src/styles/tokens.css` (cartes sous 768 px repérées par classe). Aucune écriture
dans Odoo ni dans Supabase ; `restock-alert.js`, `odoo-catalog.js`, `_relais.js`, `_odoo-rpc.js` inchangés.

Tests : `node scripts/test-peremption-mention.mjs` (vrai code de la page, de la Saisie, du panier, du contrôle des prix
et de l'envoi, comparé à la production), `node scripts/test-accueil-outils.mjs`.

### Mise en service du lot 0

- Mise en ligne en avance rapide, **après** `appli-notifications` (la branche la contient ; prérequis de l'appli :
  `docs/notifications.md`) : `git -C ~/Downloads/elixir-peremption-lot0-wt push origin peremption-lot0:master`. Jamais
  `--force` ; si l'envoi est refusé, `master` a bougé entre-temps : refaire l'intégration.
- Les onglets ouverts avant la mise en ligne et **non rechargés** gardent l'ancienne page (−50 %) jusqu'au
  rechargement : leurs ajouts partent à l'ancien prix si la commande est envoyée depuis cet onglet.
- Pendant quelques jours, relever dans l'onglet Commandes de l'admin les lignes hors catalogue dont le « PU HT » est
  inférieur au prix de la Saisie (même contrôle que les factures passées) et les ajouter à la question des
  remboursements.

## V1 « Odoo facture la remise » (livrée en simulation le 20/10/2026)

Mécanisme, mise en service, réglages et alertes : `docs/peremption-odoo.md`. En bref : une règle de prix Odoo par produit
et par liste, créée seulement sur décision de l'admin (onglet Péremptions), avec deux verrous avant toute écriture
(variable Netlify `PEREMPTION_ODOO_ECRITURE=1` et mode « Actif »), d'abord en simulation. Depuis la règle du 21/10/2026, une
règle facturée l'emporte sur la remise affichée et ne laisse aucun écart (§ 1.1, § 2). Ce qu'elle changeait par rapport au
lot 0 (le 20/10) :

- la page lit `peremption?action=page` (repli : `odoo-catalog?expiry_months=4`) : une remise n'est annoncée que si Odoo la
  facture (prix de base barré, « −X % », « habituellement Y € ») ; les produits « fantômes » (aucune boîte courte vendable
  d'après Odoo) ne sont plus montrés ; tant qu'aucune remise n'est facturée, la page reste celle du lot 0 ;
- la mention garde la remise facturée (« Pér. 31/12/2026 · −12 % », e-mail « remise péremption −12 % facturée par Odoo ») ;
- le contrôle des prix du panier remonte aussi les lignes dont la remise a pris fin, au retour sur l'onglet compris ;
- l'onglet Péremptions de l'admin est `src/components/PeremptionsAdmin.jsx` (chargé à la demande) ; la remise notée de
  `expiry_discounts` n'est plus affichée (jamais reprise) ;
- la carte de l'accueil donne « dès » et « jusqu'à » des seules remises facturées.

Réglages à la livraison (propositions en attendant les réponses de Zineb, modifiables dans l'onglet sans code) :

| Réglage | Proposition |
|---|---|
| Base de la remise | % du prix de base (`list_price`), comme sur la facture |
| Remise automatique (règle Odoo posée la nuit, à ne pas confondre avec la remise affichée par la page, § 1.1) | aucune : seulement les remises saisies par l'admin |
| Vente sous le coût | confirmation explicite par produit, perte affichée |
| Listes de prix | 5, 15, 1110, 1112, 1114, 25 ; jamais la 4 (Export) |
| Lot long reçu pendant la remise | retrait automatique et alerte |
| Délai avant suppression d'une règle | 2 h |
| Seuil d'annonce | 5 % d'économie sur le prix habituel |
