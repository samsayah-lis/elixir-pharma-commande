# Admin : ajouter et retirer des produits d'une section existante

Demande de Zineb (22/10/2026), onglet ✏️ Modifier : « ajoute la possibilité d'ajouter/supprimer des produits aux sections
déjà existantes ».

## Ce que voit l'admin

Une section choisie dans le filtre de l'onglet ✏️ Modifier :

- **« ＋ Ajouter des produits à « … » »** : recherche dans le catalogue Odoo (nom, CIP ou EAN, « En stock seulement »).
  Chaque résultat montre le prix net (liste n° 5), le prix de vente, le stock Odoo et son état sur le site :
  - *Pas encore sur le site* → « Choisir » : nouvelle ligne `elixir_products` dans la section, nom et prix d'Odoo,
    source « admin », photo Medipim cherchée ensuite (10 produits au plus, une par seconde) ;
  - *Dans « autre section »* → « Déplacer ici » : un CIP n'a qu'une ligne, donc qu'une section ; il quitte l'autre ;
  - *Retiré* (de cette section ou d'une autre) → « Remettre ici » ;
  - *Déjà dans cette section*, nom provisoire d'Odoo (« Nom à préciser »), sans prix, ou dans une section de campagne :
    aucune action, la raison est écrite.
  Choix multiple, puis une confirmation qui récapitule (nouveaux, déplacés avec leur section d'origine, remis).
- **« Retirer »** sur chaque carte (« Retirer de la section » sur ordinateur), aussi en « Toutes sections » : confirmation
  nommant le produit et la section.
- **Cases à cocher** + « Tout sélectionner » : barre en bas de l'écran « Retirer la sélection », confirmation listant les produits.
- **« Produits retirés de cette section »** (repliée) : date, auteur, prix et stock Odoo, « ↺ Remettre ».

Retirer = `active` à false : la ligne, sa photo et son historique restent ; rien n'est supprimé.

## Règles

- Écritures : `products-upsert` (inchangé), jeton admin, une ligne à la fois, seules les colonnes qui changent
  (`section`, `active` ; nom et prix seulement à la création). Historique du produit : `section_ajout`,
  `section_deplacement`, `section_remise`, `section_retrait`, auteur « admin », `changes` = avant / après.
- Juste avant d'écrire, l'état des produits est relu : un produit changé entre-temps par un autre poste n'est pas touché
  (raison dans le bilan).
- Jamais d'écriture de la configuration (`ec_config` : menus promo, affichage).
- Sections exclues, avec explication : menus promo (produits rangés dans le menu, onglet 🎯 Promos), U-Labs et toute
  campagne active (groupes de gratuité reconnus au nom, quantités engagées par CIP), outils du site (Péremption courte,
  fauteuils, justificatifs…). Un produit d'U-Labs n'est pas proposé au déplacement.
- Lecture : nouvelle fonction `products-sections` (GET, admin seulement, lecture seule) : produits retirés d'une section,
  état et stock de CIP. `products-get` ne renvoie que les produits actifs.

## Quand le site change

Au prochain chargement du site par la pharmacie (ouverture ou actualisation) : `products-get` n'est pas mis en cache et
le site le lit au démarrage. Une pharmacie déjà sur le site garde l'ancienne liste jusqu'à ce qu'elle recharge.
Un panier enregistré qui contenait des produits de la section modifiée est vidé à ce chargement (« Catalogue mis à jour —
panier réinitialisé par sécurité ») : protection existante du site, le panier étant rangé par position dans la section.

## Mise en service

Aucune migration SQL ni variable d'environnement. La mise en ligne déploie la fonction `products-sections.js` avec le site.

## Essais

- `node scripts/test-admin-sections.mjs` : vraies fonctions `products-upsert` et `products-sections` sur un faux Supabase,
  logique du client (`src/components/sections-produits.js`), banc identique au vrai code.
- Banc : `npm run dev` puis `node scripts/banc/controle-sections.mjs http://127.0.0.1:<port>/` (Chrome sans tête,
  375 px puis bureau ; `CAPTURES=<dossier>` pour les captures). Les changements du banc restent en mémoire jusqu'à son
  redémarrage (`scripts/banc/sections-banc.mjs`).
