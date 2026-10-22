# Admin : ajouter et retirer des produits d'une section existante

Demande de Zineb (22/10/2026), onglet ✏️ Modifier : « ajoute la possibilité d'ajouter/supprimer des produits aux sections
déjà existantes ».

## Ce que voit l'admin

Une section choisie dans le filtre de l'onglet ✏️ Modifier :

- **« ＋ Ajouter des produits à « … » »** : recherche dans le catalogue Odoo (nom, CIP ou EAN, « En stock seulement »).
  Plusieurs mots ou un accent : le mot le plus long est cherché tel quel et sans accents, puis seuls les produits dont
  le nom contient tous les mots restent, en stock d'abord (`odoo-catalog`, partagé avec la Saisie, cherche une seule
  sous-chaîne, accents compris). Chaque résultat montre le prix net (liste n° 5), le prix de vente, le stock Odoo et
  son état sur le site :
  - *Pas encore sur le site* → « ＋ Ajouter ici » : nouvelle ligne `elixir_products` dans la section, nom et prix
    d'Odoo, source « admin », photo Medipim cherchée ensuite (10 produits au plus, une par seconde) ;
  - *Actuellement dans « autre section »* → « Déplacer ici » : un CIP n'a qu'une ligne, donc qu'une section ; il
    quitte l'autre ;
  - *Retiré* (de cette section ou d'une autre) → « Remettre ici » ;
  - *Déjà dans cette section*, nom provisoire (« Nom à préciser »), sans prix de vente dans Odoo, venant d'une section
    exclue (campagne, menu promo, outil) ou contraire à une règle de la section (Expert) : aucune action, la raison est
    écrite.
  Choix multiple : la barre « N à ajouter · Ajouter à « … » » reste en bas de l'écran (même recherche fermée) ; changer
  de section avec des produits choisis demande confirmation. La fenêtre récapitule (nouveaux, déplacés avec leur section
  d'origine, remis, prix montré et sa source) et nomme toutes les sections touchées dans l'avertissement panier.
- Recherche du haut de l'onglet remplie : « 🔍 Chercher « … » dans le catalogue Odoo pour l'ajouter à « … » » sous la
  liste ouvre ce panneau avec la même recherche.
- **« Retirer »** sur chaque carte (« Retirer de la section » sur ordinateur), aussi en « Toutes sections » : confirmation
  nommant le produit et la section ; le bilan nomme le produit et sa section, avec « Annuler ce retrait ».
- **Cases à cocher** (cible de 44 px) + « Tout sélectionner » : barre « Retirer la sélection » en bas de l'écran (au-dessus
  du message de l'admin), confirmation listant les produits.
- **« Produits retirés de cette section »** (repliée, filtrée par la recherche du haut, 30 par groupe puis « Afficher
  plus ») : « Retirés depuis l'admin » puis « Désactivés auparavant » (🗑️ de ➕ Ajouter, alignements) ; date, auteur
  quand ce n'est pas « admin », prix et stock Odoo, « ↺ Remettre » → fenêtre de confirmation.

Retirer = `active` à false : la ligne, sa photo et son historique restent ; rien n'est supprimé.

Une écriture refusée en partie : la fenêtre reste ouverte avec la raison de chaque produit et « Réessayer pour N
produit(s) » (seulement les échecs et les non tentés) ; le message fixe de 2,5 s ne sert qu'aux succès complets.

## Règles

- Écritures : `products-upsert`, jeton admin, une ligne à la fois, seules les colonnes qui changent (`section`,
  `active` ; nom et prix seulement à la création ; `colis` et `carton` pour la Sélection Stratège). Historique du
  produit : `section_ajout`, `section_deplacement`, `section_remise`, `section_retrait`, auteur « admin »,
  `changes` = avant / après.
- Juste avant d'écrire, l'état des produits est relu : un produit changé entre-temps par un autre poste n'est pas touché
  (raison dans le bilan) ; une remise dont la section a changé entre-temps est écartée.
- Jamais d'écriture de la configuration (`ec_config` : menus promo, affichage).
- Sections exclues, avec explication : menus promo (produits rangés dans le menu, onglet 🎯 Promos), U-Labs et toute
  campagne active (gratuités et quantités engagées), outils du site (Péremption courte, fauteuils, justificatifs…). Un
  produit d'une section exclue n'est ni déplacé ni remis ailleurs. Tant que les campagnes actives ne sont pas lues
  (`campaign-get` en attente ou en erreur), aucune section n'est modifiable (encart « Lecture des campagnes
  impossible » et « Réessayer »).
- Remise d'un produit retiré : seulement si Odoo a encore un prix de vente (sinon le site afficherait le prix
  enregistré, figé) et si le nom enregistré n'est pas provisoire ; un produit désactivé autrement que par « Retirer »
  demande la case « Je confirme la remise d'un produit désactivé à la main ».
- Règles propres à une section (`REGLES_SECTION`, `sections-produits.js`) :
  - **Sélection Stratège** (vendue au colis : quantité minimale = multiple = colis, colonnes Colis et Prix carton) : tout
    produit ajouté, déplacé ou remis demande son colis (prérempli avec le colis enregistré), le prix carton = colis ×
    prix net affiché est envoyé avec ; sans colis, le bouton reste inactif.
  - **Sélection Expert** (colonne « Remise € », 30 € affichés quand elle est nulle) : un produit sans remise (liste
    n° 5 = prix de vente) n'y entre pas.
- Contrôle serveur (`products-upsert`, actions `section_*` seulement, `refusActionSection`) : après lecture de la ligne
  et des campagnes actives, refus 400 pour un menu promo, un outil, une clé de section invalide, U-Labs ou une campagne
  active (arrivée ou origine), Stratège sans colis ; 409 pour un ajout d'un CIP déjà présent ou une remise d'un produit
  en ligne ; 503 si la lecture échoue (rien d'écrit). Les autres actions (✏️ Modifier, ➕ Ajouter, 🗑️) sont inchangées.
- Lecture : nouvelle fonction `products-sections` (GET, admin seulement, lecture seule) : produits retirés d'une section,
  état, prix enregistrés, colis, carton et stock de CIP. `products-get` ne renvoie que les produits actifs.

## Quand le site change

Au prochain chargement du site par la pharmacie (ouverture ou actualisation) : `products-get` n'est pas mis en cache et
le site le lit au démarrage. Une pharmacie déjà sur le site garde l'ancienne liste jusqu'à ce qu'elle recharge.
Un panier enregistré qui contenait des produits de la section modifiée est vidé à ce chargement (« Catalogue mis à jour —
panier réinitialisé par sécurité ») : protection existante du site, le panier étant rangé par position dans la section.

## Mise en service

Aucune migration SQL ni variable d'environnement. La mise en ligne déploie avec le site la fonction `products-sections.js`
et `products-upsert.js` complétée (contrôle des actions `section_*`, empreinte déclarée dans `scripts/verifie-zones.mjs`).

## Essais

- `node scripts/test-admin-sections.mjs` : vraies fonctions `products-upsert` et `products-sections` sur un faux Supabase,
  logique du client (`src/components/sections-produits.js`), banc identique au vrai code ; correctifs de la revue
  (Stratège, remise, campagnes non lues, refus serveur, Expert, bilans, recherche à plusieurs mots).
- Banc : `npm run dev` puis `node scripts/banc/controle-sections.mjs http://127.0.0.1:<port>/` (Chrome sans tête,
  375 px puis bureau ; `CAPTURES=<dossier>` pour les captures). Les changements du banc restent en mémoire jusqu'à son
  redémarrage (`scripts/banc/sections-banc.mjs`).
