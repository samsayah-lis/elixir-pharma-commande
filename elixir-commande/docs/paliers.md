# Jauge des paliers de quantité

Demande de Zineb (22/10/2026), avec la capture d'un autre site de commande : « est ce que tu peux presenter la partie des
paliers comme ça ». Le modèle : sous la ligne du produit, une piste de 0 au palier, la quantité en cours, des pointillés
jusqu'au palier suivant, chaque palier avec sa quantité au-dessus et son prix dessous, une incitation et « Voir le détail ».
Rien n'est repris du site d'origine (ni couleurs ni libellés de marque) : charte Elixir (Inter, pétrole, sarcelle, or des
remises). Corrigée le même jour après une revue (visuel et exactitude) : voir « Règles » ci-dessous.

## Ce qui est affiché

- **Données** : paliers de la liste de prix Odoo n° 5 (`odoo_catalog.price_tiers` : `[{ min_qty, price, pct }]`).
- **Prix** : toujours ceux d'`applyTiers` (zone protégée de `src/tiers.jsx`), c'est-à-dire ceux que le panier facture
  (`cartItems`). La jauge ne calcule aucun prix.
- **Étapes** : pour chaque seuil, la plus petite **quantité commandable** qui l'atteint (au pas du colis, au minimum, au
  plus le plafond d'une ligne péremption) ; l'étape est posée, nommée et cliquée à cette quantité, et son prix est celui
  d'`applyTiers` **à cette quantité** (un arrondi au colis qui saute un autre palier montre le bon prix). Pas d'étape pour un
  palier déjà atteint par la première quantité commandable : colis Stratège de 160 et palier à 160, DOLIPRANE effervescent
  (colis 144, palier 128), MONOPROST (colis 32)… — le petit badge « 0,80 € dès 160 » reste à sa place. Deux seuils au même
  prix ou à la même quantité commandable ne font qu'une étape.
- **Incitation** : toujours le prix unitaire, la remise à côté (revue : le % seul grossissait un gain de 0,01 à 0,03 €).
  « Dès 20 : 0,81 € HT l'unité (−23,6 %) » tant que rien n'est commandé, « Plus que 12 pour 0,81 € HT l'unité (−23,6 %) »
  ensuite, « Prix palier appliqué : 0,81 € HT l'unité (−23,6 %) » au meilleur prix. Cartes : « Dès 30 : 1,55 € »,
  « Encore 18 pour 1,55 € », « Prix palier 1,55 € » (jamais « Plus que N » seul, qui se lisait « plus que N en stock »).
- **Remise (%)** : sur le prix catalogue de la ligne (`pv` des menus, `list_price` de la Saisie), même référence que le
  badge de remise de la ligne et que le `pct` des paliers en base (`odoo-price-sync` : `1 − prix / list_price`).
- **Détail** : quantité, « Prix HT/u », remise, « Économie au palier » (gain total à la quantité du palier par rapport au
  prix de la première quantité commandable). Seuil et quantité à commander quand ils diffèrent : « Dès 60 (commander 75) ».
- **Clic sur un palier** (ou « Passer à N ») : pose la quantité de l'étape par la fonction de quantité de l'endroit —
  `setQty` (tableaux, liste mobile), `applyQty` (cartes), `setItemQty` (panier), champ de la Saisie (arrondi à l'ajout par
  `ajouterDepuisSaisie`). Ces fonctions la laissent telle quelle (vérifié sur leur texte réel).

## Où

| Endroit | Jauge | Remarque |
|---|---|---|
| Saisie de commande | complète | sur la **ligne du panier de destination** (ci-dessous) ; badge en rupture, palier inévitable, article multi-CIP |
| Tableaux des menus (ordinateur) | ligne, puis complète | une ligne à 0 et au meilleur prix ; complète une fois une quantité **validée** avec un palier à viser (le passage se fait à la validation, jamais pendant la frappe) ; badge en rupture |
| Liste mobile des menus en tableau | ligne, puis compacte | même règle (quantité au « − » / « + ») |
| Cartes des menus (OTC…) | mini | une étape, texte court ; pas de jauge en rupture |
| Panier | compacte | tant qu'il reste un palier à viser ; au meilleur prix, l'encart « Prix palier 0,81 € appliqué dès 20 unités (au lieu de 0,83 €) » |

Étapes posées sur la piste : 3 au plus (complète), 2 (compacte), 1 (mini), à partir du palier atteint ; toutes au détail.
Campagnes (U-Labs…) : pas de jauge, le panier n'y applique pas les paliers.

**Prix unitaire = prix du panier** : la colonne de prix des tableaux et la liste mobile montrent le prix palier quand il
s'applique (ton palier, prix sans palier en infobulle), le total d'une carte « = 46,50 € (1,55 €/u) », la Saisie le prix
palier à la place du prix (« Prix palier HT ») et « Ajouter » à ce prix. Prix × quantité = sous-total affiché.

## Saisie : ligne de destination

`ajouterDepuisSaisie` → `addItemToCart` **ajoute** la quantité à la ligne existante (premier menu qui contient le CIP,
sinon la ligne hors catalogue du CIP), et `cartItems` applique le palier sur le total. La jauge suit donc cette ligne
(`panierSaisie` dans `src/App.jsx`) : quantité déjà au panier + quantité saisie arrondie au colis (`arrondiSaisie`), prix
et paliers de la ligne du menu (aucun en campagne). Exemple : 15 au panier, palier 20 → « Plus que 5 … dont 15 déjà au
panier » ; le palier pose 5 dans le champ, le panier passe à 20 à 0,81 €.

## Articles multi-CIP (à vérifier dans Odoo)

Un article sous plusieurs CIP (même code fournisseur) est une ligne unique au panier, répartie par CIP à l'envoi
(`expandSupplierGroups`, plus ancien d'abord). Si Odoo applique les paliers de la liste n° 5 **ligne par ligne**, une
répartition 12 + 8 pour un palier de 20 serait facturée sans palier. En attendant la vérification sur une commande répartie,
la jauge n'est pas posée sur ces articles (Saisie : badge ; panier : l'encart d'avant). Le total du panier, lui, n'a pas
changé (il appliquait déjà le palier avant la jauge).

## Contrôles

- `node scripts/test-paliers.mjs` : étapes (colis, minimum, plafond, paliers inévitables, à rebours, arrondi qui saute un
  palier), prix de la jauge contre la vraie formule du panier (branche catalogue de `cartItems`, lue dans `src/App.jsx`) pour
  les 28 produits à paliers des données figées du banc et chaque quantité, destination de la Saisie (`panierSaisie` :
  déjà au panier, campagne, hors catalogue), textes, étapes montrées, accessibilité, clic → quantité.
- `node scripts/banc/controle-paliers.mjs http://localhost:<port>/` (banc lancé) : hauteurs stables, aucun défilement,
  tableau du détail dans la jauge (320, 375 px, tiroir du panier), Saisie avec une quantité déjà au panier, tableau (modes,
  prix × quantité, frappe), et paliers multiples injectés dans le navigateur : aucune étiquette sur une autre. Produits
  de la Saisie repérés par leur CIP : le contrôle passe avec ou sans `dev-fixtures/_capture.json` (avec, la recherche du
  banc affiche les noms Odoo capturés), donc sur le même banc que `controle-sections.mjs`.
- Accessibilité : palier « Mettre la quantité à 20 : 0,81 € HT l'unité, −23,6 % », annonce (zone `aria-live` masquée)
  seulement quand le palier visé ou atteint change, légende du tableau, tracés en `--or-fonce` (3:1 au moins).
