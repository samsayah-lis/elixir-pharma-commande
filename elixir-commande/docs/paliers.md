# Jauge des paliers de quantité

Demande de Zineb (22/10/2026), avec la capture d'un autre site de commande : « est ce que tu peux presenter la partie des
paliers comme ça ». Le modèle : sous la ligne du produit, une piste de 0 au dernier palier, la quantité en cours, des
pointillés jusqu'au palier suivant, chaque palier avec sa quantité au-dessus et sa remise dessous, « Plus que N pour
bénéficier de −X % » et « Voir le détail ». Rien n'est repris du site d'origine (ni couleurs ni libellés de marque) :
charte Elixir (Inter, pétrole, sarcelle, or des remises).

## Ce qui est affiché

- **Données** : paliers de la liste de prix Odoo n° 5 (`odoo_catalog.price_tiers` : `[{ min_qty, price, pct }]`).
- **Prix** : toujours ceux d'`applyTiers` (zone protégée de `src/tiers.jsx`), c'est-à-dire ceux que le panier facture
  (`cartItems`). La jauge ne calcule aucun prix : `jaugePaliers` appelle `applyTiers` pour chaque seuil et pour la
  quantité en cours. Deux paliers au même prix ne font qu'une étape ; un palier dont le prix n'est pas sous le prix de
  la ligne est ignoré, comme dans `applyTiers`.
- **Remise (%)** : sur le prix de base affiché sur la ligne (prix catalogue barré : `pv` des menus, `list_price` de la
  Saisie), c'est-à-dire la même référence que le badge de remise de la ligne et que le `pct` des paliers en base
  (`odoo-price-sync` : `1 − prix / list_price`). Exemple DAFALGAN 1000 effervescent : ligne « 1,06 € barré, −21,7 %,
  0,83 € », palier « dès 20 : 0,81 €, −23,6 % ». Sans prix de base plus élevé que le prix de la ligne : remise sur le
  prix sans palier.
- **Économie** (tableau du détail) : par rapport au prix sans palier, pour la quantité du palier (20 × 0,02 € = 0,40 €).
- **Clic sur un palier** : pose la plus petite quantité commandable qui atteint le seuil (au pas du colis, au minimum,
  au plus le plafond), puis passe par la fonction de quantité de l'endroit — `setQty` (tableaux, liste mobile),
  `applyQty` (cartes), `setItemQty` (panier), quantité de la Saisie (arrondie à l'ajout par `ajouterDepuisSaisie`).
  Ces fonctions la laissent telle quelle (vérifié par `scripts/test-paliers.mjs` sur leur texte réel).

## Où

| Endroit | Variante | Remarque |
|---|---|---|
| Saisie de commande | complète | sous la ligne, produit commandable ; produit en rupture : petit badge comme avant |
| Tableaux des menus (ordinateur) | complète | ligne `ex-tr-palier` sous le produit, même zébrure (`data-zebre`) ; quantité en cours de frappe suivie en direct |
| Liste mobile des menus en tableau | compacte | dans la ligne, sous le nom et les quantités |
| Cartes des menus (OTC…) | mini | incitation courte (la remise est sous le palier), sans détail |
| Panier | compacte | à la place de l'encart « Prix palier appliqué / Encore N unités » ; encart gardé si la jauge ne peut pas s'afficher |

Campagnes (U-Labs…) : pas de jauge, le panier n'y applique pas les paliers. Le petit badge « 1,60 € dès 60 » reste là
où la jauge n'est pas posée (Péremption courte, fauteuils, accueil) et dans les tableaux pour une ligne sans jauge.

Sous-total des tableaux et total des cartes : au prix d'`applyTiers`, comme le panier (avant : prix sans palier, alors
que le panier facturait déjà le prix palier — ex. 24 DAFALGAN : 19,44 € au panier, 19,92 € affichés dans le menu).

## Contrôles

- `node scripts/test-paliers.mjs` : étapes, prix = `applyTiers` à chaque quantité (cas construits et 28 produits à
  paliers des données figées du banc), incitation, dernier palier, curseur, accessibilité, clic → quantité.
- Bundle : +12,9 Ko (composant, styles, placements) ; 931 540 octets pour un budget de 940 000 (marge 8 460).
