# Limites de quantité des menus promo et des précommandes

Demande de Zineb (26/10/2026), à propos d'une précommande : « je voudrais pouvoir mettre des limites max de quantité
commandables ». Deux limites, chacune facultative, par produit d'un menu promo : un **max par pharmacie** et un **max total**
(toutes pharmacies, l'allocation du laboratoire).

## Ce que voit l'admin

Onglet 🎯 Promos, formulaire d'un produit (« + Produit » ou ✏️) : **Max par pharmacie** et **Max total (toutes
pharmacies)**, en boîtes, vides = illimité. Refusé à l'enregistrement : une valeur qui n'est pas un entier ≥ 1, ou une limite
sur un produit sans CIP (les commandes sont comptées par CIP).

Dans la liste des produits du menu : `🔒 max 5/pharmacie · 200 au total · commandé : 37/200` — quantité déjà commandée,
toutes pharmacies, depuis l'ajout du produit à CE menu, lue par `promo-limites` à l'ouverture de l'onglet puis 1,5 s après
chaque changement, une fois la publication terminée (menus visibles seulement) ; en rouge quand le max total est atteint.

## Ce que voit la pharmacie

- **Ligne d'article** (menus en tableau, cartes, liste mobile, résultats de recherche) : une pastille sous la désignation ou sous les
  boutons de quantité, comme celle du contingentement : `5 max par pharmacie · encore 2`, `· rien de plus possible`,
  `· limite atteinte`, `· épuisé` (max total), `· plus que 3 disponibles` (max total plus bas que ce qui reste à la
  pharmacie), `· 2 de trop` (rouge : le panier refusera l'envoi). Détail au survol et pour les lecteurs d'écran (déjà
  commandé, au panier, encore possible).
- **Panier** : encart sous la ligne (`Quantité limitée : 5 par pharmacie · déjà commandé 3 · reste 2`), au-delà
  `Maximum 2 pour cette offre` et « Ramener à 2 » ; alerte au-dessus du bouton et **« Envoyer la commande » bloqué**.
- Sans lecture de ce qui est déjà commandé (pas connecté, service injoignable) : la limite seule (une commande au-delà
  est refusée quoi qu'il soit déjà commandé).

## Règle

- Menus **actifs** seulement. Un CIP limité dans deux menus actifs : chaque menu garde sa règle, comptée depuis l'ajout du
  produit à CE menu ; la plus restrictive l'emporte (la pastille montre le plus bas des max par pharmacie).
- Comptées **par CIP**, quel que soit le menu ou le canal de la commande (site, saisie Elixir, API), **depuis l'ajout du
  produit au menu** (son identifiant est sa date d'ajout ; à défaut, la création du menu) ; commandes relues sur 180 jours
  au plus. Pour repartir de zéro (nouvelle vague) : retirer le produit du menu et l'ajouter de nouveau (s'il est limité
  dans un autre menu actif, la règle de cet autre menu continue de compter).
- Pharmacie : ses commandes portent le CIP de sa fiche, ou son adresse de connexion (comparaison exacte, jamais `ilike`) ;
  fiche sans CIP : toutes les adresses de connexion de sa fiche Odoo, comme le contingentement.
- **API des pharmacies** : un produit limité d'un menu actif est « à commander sur le site » (`produit_non_commandable`,
  comme les produits des campagnes : `produitsHorsApi` de `_api-lecture.js`, cache de 10 min) ; ses commandes passées par
  l'API avant la limite comptent.
- Ne comptent pas : une commande supprimée dans l'admin ; une commande non vérifiée de la quarantaine d'order-save (pages
  d'avant le correctif du 19/10, source `a_verifier`), comme pour le contingentement ; une ligne retirée par l'API (rupture,
  annulation : `handled_at` et `api_motif`, jamais envoyée).
- Une ligne traitée par l'admin (« Traiter sans envoi » : saisie dans Odoo, mais aussi refusée ou annulée) **compte** : le
  site ne distingue pas ces cas. Pour rendre des boîtes refusées ou annulées : supprimer la commande si elle ne contient rien
  d'autre, sinon relever la limite de la quantité perdue.
- Ce qui reste = la plus basse des deux limites : max par pharmacie − ce que la pharmacie a déjà commandé, max total − ce
  que toutes ont commandé.
- **order-save** contrôle chaque commande avant de l'écrire, avec les chiffres du moment : au-delà → **400**, rien d'écrit,
  le site garde le panier et affiche le motif (`PRODUIT : 5 au plus par pharmacie pour cette offre (déjà commandé : 3),
  encore 2 possibles` ; `… quantité limitée, plus que 2 boîtes disponibles pour cette offre`). Saisie Elixir comprise :
  pour donner plus à une pharmacie, relever la limite dans l'onglet Promos. Le même numéro renvoyé après une réponse
  perdue n'est pas compté contre lui-même (`{ deja }` comme avant). Limites illisibles : commande non contrôlée (comme le
  contingentement quand Odoo ne répond pas) ; commandes illisibles pour une commande qui contient un produit limité :
  **503**, rien d'écrit (« réessayez dans un instant »).
- Commandes envoyées en même temps (deux pharmacies, ou la même depuis deux postes) : chacune est **contrôlée de nouveau
  juste après son écriture**, les autres comptées ; au-delà, elle est retirée (400, comme avant l'écriture). Deux envois
  simultanés qui dépassent ensemble la limite peuvent ainsi être refusés tous les deux : la pharmacie renvoie. Retrait
  impossible (Supabase) : 503, le même numéro renvoyé retrouve la commande.

Limites connues :

- Les limites sont lisibles avec les menus (`config-get?key=admin_promos`, public comme les prix des menus).

## Données

- Limites dans `admin_promos` (ec_config), sur chaque produit : `maxPharmacie`, `maxTotal` (entiers, ou null).
- `promo-limites` (nouvelle fonction, POST + jeton, lecture seule) : pharmacie → `{ limites: { <CIP>: { reste, motif, deja } } }`
  (compte de l'e-mail vérifié du jeton, corps ignoré) ; admin en saisie → idem pour `{ cip, email }` ; admin, onglet
  Promos → `{ admin: true }` → `{ limites: { <CIP>: { nom, menu, parPharmacie, total, dejaTotal, parMenu } } }` (`parMenu` :
  déjà commandé selon chaque menu). Aucun produit limité : `{ limites: {} }` sans lire les commandes. Max total : commandes
  de toutes les pharmacies gardées 60 s par instance, celles de la pharmacie toujours relues ; `{ frais: true }` : sans le
  cache.
- Site : module chargé à la demande (`src/components/limites/LimitesPromo.jsx`), seulement quand un menu actif a un
  produit limité ; état lu par `promo-limites` à l'affichage d'un menu, de résultats de recherche ou d'un panier qui
  contient un produit limité (une fois par minute au plus ; échec : nouvel essai 30 s plus tard), à l'ouverture du panier.
  Commande envoyée : chiffres d'avant l'envoi cachés jusqu'au panier vidé (3 s), puis relus sans le cache ; envoi refusé
  (limite dépassée entre-temps…) : relus sans le cache, le panier montre « Ramener à ». Réponse d'une autre pharmacie
  (saisie Elixir) ou partie avant un envoi : ignorée.
- Aperçus Netlify (essai à blanc) : `promo-limites` répond `{ limites: {} }` (limites seules).

## Code

- `src/limites-promo.js` : règles et textes, JS pur, partagé par le site, l'admin et le serveur.
- `netlify/functions/_promo-limites.js` (lecture des limites et des commandes, contrôle) et `promo-limites.js` : nouvelles,
  admises dans `scripts/verifie-zones.mjs` (AJOUTS_AUTORISES) ; `order-save.js` : lignes ajoutées seulement (import,
  contrôle avant l'écriture et juste après), empreinte dans FICHIERS_AUTORISES, écart déclaré à `scripts/ecart-order-save.mjs` pour les
  tests qui le veulent inchangé depuis la production (`test-api-commandes.mjs`, `test-peremption-mention.mjs`).
- API : `_api-lecture.js` (produits limités ajoutés aux produits hors API) et `_api-commande.js` (motif « quantité
  limitée »), admis comme fonctions de l'API ; `docs/api.md`, `docs/api/mise-en-service.md` et `public/api/index.html` le
  disent ; `scripts/api-faux.mjs` a la
  table `ec_config`.
- `src/App.jsx` : état et lecture après le contingentement, pastille dans les 4 vues, encart et alerte du panier, bouton
  d'envoi ; aucune zone protégée touchée. `src/AdminPanel.jsx` : champs, contrôle, quantités commandées.
- Bundle des pharmacies : 512 861 octets (budget 513 000) ; règles, pastille et encarts hors du bundle (2,9 et 3 ko à la
  demande).

## Vérifications

- `node scripts/test-api-commandes.mjs` (§ 12 bis) : produit limité refusé par l'API, « quantité limitée ».
- `node scripts/test-limites-promo.mjs` (73 contrôles, produits FICTIFS) : règles, textes, lecture des commandes (filtre exact,
  pages, cache), contrôle, fonction `promo-limites` (jeton, compte, saisie, admin), `order-save` (400 rien d'écrit, dans la
  limite, renvoi du même numéro, saisie Elixir, 503, `{ verifier }`), branchement du site et de l'admin.
- Banc local (`npm run dev`) avec un menu promo fictif dans `dev-fixtures/get/config-get__key=admin_promos.json` et un état
  dans `dev-fixtures/post/promo-limites.json` : pastilles, panier bloqué, « Ramener à », formulaire de l'admin et refus d'une
  valeur invalide vérifiés à l'écran.
