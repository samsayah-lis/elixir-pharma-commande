# Page d'accueil « La Tête de gondole »

Demande de Zineb (19/10/2026) : une page d'accueil avec un slider des principales offres, c'est-à-dire les produits qui font l'objet du plus grand nombre de commandes sur les 15 derniers jours, avec un effet « waouh ».

Spécification complète : concept B′ « La Tête de gondole » (étude du 19/10/2026). Ce document garde les décisions et la règle.

## 1. Mise en scène

- **Le linéaire** (ordinateur, tablette) : les 10 produits sur une tablette, chacun avec son étiquette de rayon (rang, marque, prix net). C'est la liste d'onglets du carrousel (motif APG « carrousel à onglets »).
- **La tête de gondole** : le produit choisi, en grand, sous un projecteur ; à droite, la grande étiquette Elixir (prix net, remise, PV, palier, stock, règle de quantité, popularité en tranche, pouls des 15 jours, ajout au panier, « Voir dans… »).
- **Mobile** (< 768 px) : segments en haut (onglets), piste de cartes à aimantation, voisine visible à droite. Carte compacte pour que « Ajouter » tienne au premier écran (375 × 667 compris) : titre « Les plus commandés » sur une ligne, « N°1 » seul, sans « Prix net HT », stock et popularité sur une rangée, scène de 120 à 170 px.
- **Boîte générée** pour les produits sans photo (Mounjaro, Dupixent, Eylea, Thealose, Beyfortus au 19/10) : marque, dosage, forme, laboratoire, CIP sur la tranche ; neutre (ni « ELIXIR » ni croix : on aurait dit un conditionnement Elixir d'un médicament de marque). Photo choisie dans l'admin (§ 4) prioritaire.
- **Mouvement** (Web Animations, sans bibliothèque) : arrivée « les lumières s'allument » (une fois par chargement), vol FLIP du facing vers la gondole, rang et prix en compteurs mécaniques, inclinaison au pointeur (souris seulement), vol de la miniature vers le compteur du panier. Rien en mouvement réduit.
- **Rotation automatique** : ordinateur seulement, 7 s par produit, un tour puis arrêt sur le n°1 (sans annonce : la région vivante ne parle qu'après une action) ; pause au survol, onglet caché, vitrine hors écran, tiroir ouvert, fenêtre modale ouverte ; arrêt définitif à la première action (focus clavier, clic, dosage, ajout, glissé).
- **Produit actif suivi par sa famille** (pas par son rang) : la liste peut raccourcir en cours de session (stock rafraîchi, exclusion de l'admin, catalogue chargé tard) sans changer le produit affiché ni casser la page.
- **Bouton d'ajout** jamais rogné : « Ajouter un carton de 120 · 361,20 € HT » sur une ligne, sinon le lot puis le montant sur deux lignes ; palier compris dans le lot : « soit 1,67 € HT la boîte ». **Dosages** : unité en tête (« mg »), fondu du côté qui déborde, dosage coché toujours visible, cible de 44 px.

## 2. Règle de sélection (serveur, `netlify/functions/_accueil-selection.js`)

1. **Commandes servies** : commandes distinctes `sale.order` de la société 2, état `sale`, `date_order` depuis J−14 00:00 (heure de Paris), avec au moins une ligne du produit à `product_uom_qty > 0`. Le nombre brut de commandes reçues ne sert pas : les 30 premiers en brut sont en rupture (boucles de manquants des LGO). Tendance (« En hausse » dès +15 %) : période précédente de même durée exacte (J−14 00:00 → maintenant, puis la même durée juste avant).
2. Départages : pharmacies servies, quantité servie, CIP.
3. Écartés : hors catalogue du site, rupture, sans prix ou prix anormal (remise ≥ 80 %, pn < 0,05 €, pn > pv), justificatif labo, stupéfiant, **contingenté**, menu masqué, précommande, campagne (menu du site ou campagne à identifiant propre), moins de 10 commandes ou 5 pharmacies, fiche inactive.
4. Un produit par marque (premier mot du nom + laboratoire) : les autres dosages deviennent des variantes (puces de dosage).
5. 12 diapositives et 8 réserves ; l'interface en montre 10.

## 3. Serveur

- `accueil-offres-refresh.js` (planifiée, `40 5-20/3 * * *`) : lecture Odoo seule (`read_group`, `read`, `search_read`, 8 s au plus par appel : une erreur écrit le journal avant la limite de 30 s), écrit kv `accueil:offres` et `accueil:dernier_passage`. Odoo en panne ou classement vide : **le cache précédent est gardé**.
- `accueil-offres.js` (GET) : jeton pharmacie (compte existant) ou admin ; sinon 401 / 403 ; panne de Supabase Auth → 503. Prix et stock **relus à chaque appel** (fusion de products-get, sinon règle de la Saisie) ; diapositive en rupture remplacée par la première réserve. Jamais de compte exact (tranches, courbe normalisée) ni de quantité en stock. Cache absent : calcul sous verrou (60 s), terminé au plus tard 7 s après le début de l'appel (Netlify coupe à 10 s), 3,5 s au plus par appel Odoo ; échec ou classement vide → kv `accueil:echec`, aucun nouveau calcul au GET pendant 10 min ; cache de plus de 36 h : `perime: true`.
- Tests hors ligne : `node scripts/test-accueil.mjs` (serveur) et `node scripts/test-accueil-client.mjs` (résolution du navigateur : le montant du bouton est ce que le panier facture).

## 4. Navigateur

- Clé de menu `accueil` (`?menu=accueil`), page d'arrivée sans lien ; `?menu=`, `?cip=`, `?outil=` mènent directement à leur vue. Entrée « Accueil » en tête de la barre latérale ; le logo mène à l'accueil.
- Chunk `Accueil-*` chargé à la demande ; dans le bundle des pharmacies : préchargement (chunk + GET en parallèle de products-get), squelette, helpers `produitDuCatalogue`, `modifierQte`, `naviguerVers`.
- **Résolution** (`src/components/accueil/resolution.js`, JS pur testé hors ligne ; le slider ne contredit jamais un menu ni le panier) : prix, paliers, menu et règle de quantité repris du catalogue chargé, dans l'ordre d'`addItemToCart` (remise des menus promo saisie en texte « -10% » lue comme le serveur) ; retirés : justificatif, campagne (prix palier et UG du panier), exclusions de l'admin (toute la famille), rupture d'un produit de menu, menu non ouvrable. Offres relues toutes les 5 min et au retour sur l'onglet (prix et stock des produits hors menu).
- **Ajout** : `ajouterDepuisSaisie` (arrondi au colis, minimum, justificatif, contingentement), comme la Saisie ; « − » par `setItemQty`. Montant affiché = `applyTiers(pn, paliers, lot) × lot`, ce que le panier facture (jamais le champ manuel `carton`).
- « Offres du moment » (menus promo actifs et **pas échus**) : bandeau à côté du titre de la vitrine dès 1 280 px, rangée sous la vitrine ; la fenêtre ouverte à la connexion ne s'affiche pas par-dessus l'accueil, elle attend le premier menu ouvert. La fenêtre de présentation de l'Assistant Elixir attend de même le premier menu ouvert (`differer`). Suggestions de recommande : sous la vitrine et les offres. Panier flottant masqué sur l'accueil (il recouvrait le « + » sur téléphone) : le compteur or de l'en-tête collant reste.
- Budgets mesurés (20/10/2026, `npm run build`, après la revue) : bundle des pharmacies 891 655 octets ≤ 940 000 ; chunk `Accueil-*` **14,4 Ko + 5,5 Ko gzip** (JS + CSS). Squelette statique (charte : squelettes jamais animés).
- Admin, onglet « Affichage » : bloc « Page d'accueil » (`src/components/AdminAccueil.jsx`) : interrupteurs et aperçu du classement (une ligne par famille) avec « Exclure (tous les dosages) » / « Réintégrer », et pour un produit sans photo « Chercher les photos » (banque d'images de l'admin, `medipim-lookup`, chaque dosage) / « Retirer les photos ».
- Réglages (`display_config.accueil`) : `masque` (interrupteur d'urgence), `arrivee` (page d'arrivée), `auto` (rotation), `exclus` (CIP retirés : toute la famille de chacun), `photos` (CIP → adresse de la photo, pour les produits sans photo au catalogue).

## 5. Banc d'essai et aperçus

- `node scripts/banc/fixture-accueil.mjs <top15j.json> --config <display_config.json> --noms <fiches.json>` écrit `dev-fixtures/accueil-offres.json` (hors git) au format exact du GET : prix, lot, menu et textes par la règle du serveur (`diapoPublique`), mais la sélection elle-même vient de l'étude (`top15j.json`), pas de `selectionner` (testé à part, `scripts/test-accueil.mjs`) ; le plugin du banc le sert pour `accueil-offres`.
- Aperçus Netlify (essai à blanc) : le jeton d'essai ne lit pas le vrai classement ; `src/dev/reponses-fictives.js` fournit 6 diapositives d'exemple (marquées « aperçu »).

## 6. À confirmer par Zineb (valeurs par défaut appliquées)

Profondeur limitée à la tête de gondole ; accueil en page d'arrivée ; dosages regroupés ; popularité en tranches ; contingentés écartés (Mounjaro sortirait s'il le devenait) ; rotation automatique sur ordinateur ; classement au produit ; boîte générée pour les produits sans photo.

Après la revue du 19/10/2026 : fenêtre de présentation de l'Assistant Elixir et fenêtre « Offres du moment » repoussées au premier menu ouvert depuis l'accueil (bandeau « Offres du moment » à côté du titre dès 1 280 px) ; photos des produits sans photo choisies dans l'admin (recherche automatique dans la banque d'images au classement planifié : non faite, clé partagée et limite de 100 appels par minute) ; offre « Precommande Masques BIODANCE » (fin le 25/09) encore active dans l'admin, à désactiver.
