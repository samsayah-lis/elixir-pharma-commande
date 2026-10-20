# Péremption courte : « Odoo facture la remise »

Choix de Zineb (20/10/2026) : une remise péremption n'existe que si Odoo la facture. La conception complète (règles de
prix Odoo par liste, réconciliation, simulation, essais T1 et T2) est un document de travail hors dépôt ; ce fichier dit
ce qui est en service.

## Lot 0 : la page cesse d'annoncer des remises qu'Odoo ne facture pas (site seul)

Constat : depuis le 14/03/2026, la page affichait −50 % (−20 % dès 500 €), ou la remise saisie dans l'admin, mais Odoo
facturait toujours le prix de la liste du client. La pharmacie voyait 5,16 € et payait 9,76 € (Hec pommade).

Ce que fait le lot 0 :

- **Page « Péremption courte » (pharmacies)** : le prix affiché est le prix facturé, le même que dans la Saisie de
  commande (`prixPage`, `src/peremption-panier.js`) : prix remisé de la liste n° 5 (`odoo_catalog.discounted_price`,
  synchro « Prix remisés ») s'il y en a un, sinon le prix catalogue ; paliers de quantité d'Odoo au panier. Ni prix
  barré, ni remise, ni −50 %. Encart : « Prix habituels, comme dans le reste du catalogue : aucune remise péremption
  pour l'instant. » La date du lot le plus court et les lots restent affichés.
- **Mention « Pér. <date> »** : un ajout depuis la page garde la date du lot sur la ligne hors catalogue du panier
  (encart « Pér. 31/12/2026 · péremption courte, au prix habituel »), dans la commande enregistrée (`note`,
  `peremption` : onglet Commandes de l'admin, « Mes commandes ») et dans l'e-mail à Elixir (« — PÉREMPTION COURTE
  (Pér. 31/12/2026, sans remise péremption) »). Elle sert face à une demande de retour « date trop courte ».
  - Elle ne change ni le prix, ni l'identité de la ligne (le CIP), ni le relais PharmaML (qui ne lit que `cip`, `name`,
    `qty`, `pn`) : une seule ligne et une seule commande, comme avant. PharmaML et Odoo n'ont aucun champ texte par
    ligne : la mention reste dans le site.
  - Produit rangé dans un menu du catalogue : l'ajout va sur la ligne du menu, au prix du menu (le même une fois la
    synchro des prix passée), et la mention se perd (4 produits sur 178 le 20/10).
  - Même produit ajouté par la Saisie et par la page : une seule ligne, quantités additionnées, mention gardée.
- **Carte « Péremption courte » de l'accueil** (`_accueil-outils.js`) : ni « dès » ni « jusqu'à » (`des` et `jusqua`
  à `null`), titre « Lots à date courte, en stock », accroche « … à leur prix habituel, avec la date de chaque lot »,
  badge par défaut « Date courte » ; un badge « Petits prix » déjà publié n'est pas affiché. Une seule lecture
  (`odoo_catalog`, 3 colonnes) : `expiry_discounts` n'est plus lue.
- **Onglet « Péremptions » de l'admin** : il fonctionne comme avant (synchro des péremptions, liste), avec un encart
  « Remises non facturées ». La remise devient une **remise notée** : entier de 0 à 90 (0 = aucune), enregistrée dans
  `expiry_discounts` comme avant, sans aucun effet sur les prix ni dans Odoo. Plus de remise d'office. Le prix de la
  liste n° 5 (celui que voient les pharmacies) est affiché à côté du prix de base. Enregistrement par `adminFetch`
  (jeton renouvelé), erreur affichée si le serveur refuse.

Fichiers : `src/peremption-panier.js` (parties pures), `src/components/ShortExpiry.jsx`,
`src/components/PeremptionsAdmin.jsx` (encart et remise notée de l'admin, chargés avec l'admin seulement), `src/App.jsx` (mention : 5
écarts déclarés dans `scripts/verifie-zones.mjs`, lot `peremptionMention`), `src/AdminPanel.jsx`,
`src/components/MyOrdersPanel.jsx`, `netlify/functions/_accueil-outils.js`, `src/components/accueil/rubriques.js`,
`vedettes.js`, `AdminVedettes.jsx`, `src/styles/tokens.css` (cartes sous 768 px repérées par classe). Aucune écriture
dans Odoo ni dans Supabase ; `restock-alert.js`, `odoo-catalog.js`, `_relais.js`, `_odoo-rpc.js` inchangés.

Tests : `node scripts/test-peremption-mention.mjs` (vrai code de la page, de la Saisie, du panier et de l'envoi, comparé à
la production), `node scripts/test-accueil-outils.mjs`.

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
