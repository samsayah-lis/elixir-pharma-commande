# Page d'accueil « La Tête de gondole »

Demande de Zineb (19/10/2026) : une page d'accueil avec un slider des principales offres, c'est-à-dire les produits qui font l'objet du plus grand nombre de commandes sur les 15 derniers jours, avec un effet « waouh ».

Spécification complète : concept B′ « La Tête de gondole » (étude du 19/10/2026). Ce document garde les décisions et la règle.

## 1. Mise en scène

- **Le linéaire** (ordinateur, tablette) : les 10 produits sur une tablette, chacun avec son étiquette de rayon (rang, marque, prix net). C'est la liste d'onglets du carrousel (motif APG « carrousel à onglets »).
- **La tête de gondole** : le produit choisi, en grand, sous un projecteur ; à droite, la grande étiquette Elixir (prix net, remise, PV, palier, stock, règle de quantité, popularité en tranche, pouls des 15 jours, ajout au panier, « Voir dans… »).
- **Mobile** (< 768 px) : segments en haut (onglets), piste de cartes à aimantation, voisine visible à droite.
- **Boîte Elixir générée** pour les produits sans photo (Mounjaro, Dupixent, Eylea, Thealose, Beyfortus au 19/10) : marque, dosage, forme, laboratoire, CIP sur la tranche.
- **Mouvement** (Web Animations, sans bibliothèque) : arrivée « les lumières s'allument » (une fois par chargement), vol FLIP du facing vers la gondole, rang et prix en compteurs mécaniques, inclinaison au pointeur (souris seulement), vol de la miniature vers le compteur du panier. Rien en mouvement réduit.
- **Rotation automatique** : ordinateur seulement, 7 s par produit, un tour puis arrêt sur le n°1 ; pause au survol, onglet caché, vitrine hors écran, tiroir ouvert ; arrêt définitif à la première action (focus clavier, clic, dosage, ajout, glissé).

## 2. Règle de sélection (serveur, `netlify/functions/_accueil-selection.js`)

1. **Commandes servies** : commandes distinctes `sale.order` de la société 2, état `sale`, `date_order` depuis J−14 00:00 (heure de Paris), avec au moins une ligne du produit à `product_uom_qty > 0`. Le nombre brut de commandes reçues ne sert pas : les 30 premiers en brut sont en rupture (boucles de manquants des LGO).
2. Départages : pharmacies servies, quantité servie, CIP.
3. Écartés : hors catalogue du site, rupture, sans prix ou prix anormal (remise ≥ 80 %, pn < 0,05 €, pn > pv), justificatif labo, stupéfiant, **contingenté**, menu masqué, précommande, campagne, moins de 10 commandes ou 5 pharmacies, fiche inactive.
4. Un produit par marque (premier mot du nom + laboratoire) : les autres dosages deviennent des variantes (puces de dosage).
5. 12 diapositives et 8 réserves ; l'interface en montre 10.

## 3. Serveur

- `accueil-offres-refresh.js` (planifiée, `40 5-20/3 * * *`) : lecture Odoo seule (`read_group`, `read`, `search_read`), écrit kv `accueil:offres` et `accueil:dernier_passage`. Odoo en panne ou classement vide : **le cache précédent est gardé**.
- `accueil-offres.js` (GET) : jeton pharmacie (compte existant) ou admin ; sinon 401 / 403 ; panne de Supabase Auth → 503. Prix et stock **relus à chaque appel** (fusion de products-get, sinon règle de la Saisie) ; diapositive en rupture remplacée par la première réserve. Jamais de compte exact (tranches, courbe normalisée) ni de quantité en stock. Cache absent : calcul sous verrou (60 s), budget 10 s ; cache de plus de 36 h : `perime: true`.
- Tests hors ligne : `node scripts/test-accueil.mjs`.

## 4. Navigateur

- Clé de menu `accueil` (`?menu=accueil`), page d'arrivée sans lien ; `?menu=`, `?cip=`, `?outil=` mènent directement à leur vue. Entrée « Accueil » en tête de la barre latérale ; le logo mène à l'accueil.
- Chunk `Accueil-*` chargé à la demande ; dans le bundle des pharmacies : préchargement (chunk + GET en parallèle de products-get), squelette, helpers `produitDuCatalogue`, `modifierQte`, `naviguerVers`.
- **Résolution** (le slider ne contredit jamais un menu ni le panier) : prix, paliers, menu et règle de quantité repris du catalogue chargé, dans l'ordre d'`addItemToCart` ; retirés : justificatif, exclusions de l'admin, rupture d'un produit de menu, menu non ouvrable.
- **Ajout** : `ajouterDepuisSaisie` (arrondi au colis, minimum, justificatif, contingentement), comme la Saisie ; « − » par `setItemQty`. Montant affiché = `applyTiers(pn, paliers, lot) × lot`, ce que le panier facture (jamais le champ manuel `carton`).
- La fenêtre « Offres du moment » ne s'ouvre pas sur l'accueil : la rangée du même nom la remplace.
- Réglages (`display_config.accueil`) : `masque` (interrupteur d'urgence), `arrivee` (page d'arrivée), `auto` (rotation), `exclus` (CIP retirés de la vitrine).

## 5. Banc d'essai et aperçus

- `node scripts/banc/fixture-accueil.mjs <top15j.json> --config <display_config.json> --noms <fiches.json>` écrit `dev-fixtures/accueil-offres.json` (hors git) au format exact du GET, en passant par la règle du serveur ; le plugin du banc le sert pour `accueil-offres`.
- Aperçus Netlify (essai à blanc) : le jeton d'essai ne lit pas le vrai classement ; `src/dev/reponses-fictives.js` fournit 6 diapositives d'exemple (marquées « aperçu »).

## 6. À confirmer par Zineb (valeurs par défaut appliquées)

Profondeur limitée à la tête de gondole ; accueil en page d'arrivée ; dosages regroupés ; popularité en tranches ; contingentés écartés (Mounjaro sortirait s'il le devenait) ; rotation automatique sur ordinateur ; classement au produit ; boîte générée pour les produits sans photo.
