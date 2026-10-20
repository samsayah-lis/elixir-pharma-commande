# Péremption courte : « Odoo facture la remise »

Choix de Zineb (20/10/2026) : une remise péremption n'existe que si Odoo la facture. La conception complète (règles de
prix Odoo par liste, réconciliation, simulation, essais T1 et T2) est un document de travail hors dépôt ; ce fichier dit
ce qui est en service.

## Lot 0 : la page cesse d'annoncer des remises qu'Odoo ne facture pas (site seul)

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

- Les onglets ouverts avant la mise en ligne et **non rechargés** gardent l'ancienne page (−50 %) jusqu'au
  rechargement : leurs ajouts partent à l'ancien prix si la commande est envoyée depuis cet onglet.
- Pendant quelques jours, relever dans l'onglet Commandes de l'admin les lignes hors catalogue dont le « PU HT » est
  inférieur au prix de la Saisie (même contrôle que les factures passées) et les ajouter à la question des
  remboursements.

## Suite (pas en service)

Mécanisme prévu : une règle de prix Odoo par produit et par liste, créée seulement sur décision de l'admin, avec deux
verrous avant toute écriture (variable Netlify `PEREMPTION_ODOO_ECRITURE=1` et mode « Actif » de l'admin), d'abord en
simulation. Réglages proposés en attendant les réponses de Zineb (modifiables sans code, table `peremption_reglages`) :

| Réglage | Proposition |
|---|---|
| Base de la remise | % du prix de base (`list_price`), comme sur la facture |
| Remise par défaut | aucune : seulement les remises saisies par l'admin |
| Vente sous le coût | confirmation explicite par produit, perte affichée |
| Listes de prix | 5, 15, 1110, 1112, 1114, 25 ; jamais la 4 (Export) |
| Lot long reçu pendant la remise | retrait automatique et alerte |
| Délai avant suppression d'une règle | 2 h |
| Seuil d'annonce | 5 % d'économie sur le prix habituel |
