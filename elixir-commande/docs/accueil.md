# Page d'accueil « La Tête de gondole » et mises en avant

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
- Budgets mesurés (20/10/2026, `npm run build`, après la revue) : bundle des pharmacies 891 655 octets ≤ 940 000 ; chunk `Accueil-*` **14,4 Ko + 5,5 Ko gzip** (JS + CSS). Squelette statique (charte : squelettes jamais animés). Avec les mises en avant (§ 7) : voir § 7.6.
- Admin, onglet « Affichage » : bloc « Page d'accueil » (`src/components/AdminAccueil.jsx`) : interrupteurs et aperçu du classement (une ligne par famille) avec « Exclure (tous les dosages) » / « Réintégrer », et pour un produit sans photo « Chercher les photos » (banque d'images de l'admin, `medipim-lookup`, chaque dosage) / « Retirer les photos ».
- Réglages (`display_config.accueil`) : `masque` (interrupteur d'urgence), `arrivee` (page d'arrivée), `auto` (rotation), `exclus` (CIP retirés : toute la famille de chacun), `photos` (CIP → adresse de la photo, pour les produits sans photo au catalogue).

## 5. Banc d'essai et aperçus

- `node scripts/banc/fixture-accueil.mjs <top15j.json> --config <display_config.json> --noms <fiches.json>` écrit `dev-fixtures/accueil-offres.json` (hors git) au format exact du GET : prix, lot, menu et textes par la règle du serveur (`diapoPublique`), mais la sélection elle-même vient de l'étude (`top15j.json`), pas de `selectionner` (testé à part, `scripts/test-accueil.mjs`) ; le plugin du banc le sert pour `accueil-offres`.
- Aperçus Netlify (essai à blanc) : le jeton d'essai ne lit pas le vrai classement ; `src/dev/reponses-fictives.js` fournit 6 diapositives d'exemple (marquées « aperçu »).

## 6. À confirmer par Zineb (valeurs par défaut appliquées)

Profondeur limitée à la tête de gondole ; accueil en page d'arrivée ; dosages regroupés ; popularité en tranches ; contingentés écartés (Mounjaro sortirait s'il le devenait) ; rotation automatique sur ordinateur ; classement au produit ; boîte générée pour les produits sans photo.

Après la revue du 19/10/2026 : fenêtre de présentation de l'Assistant Elixir et fenêtre « Offres du moment » repoussées au premier menu ouvert depuis l'accueil (bandeau « Offres du moment » à côté du titre dès 1 280 px) ; photos des produits sans photo choisies dans l'admin (recherche automatique dans la banque d'images au classement planifié : non faite, clé partagée et limite de 100 appels par minute) ; offre « Precommande Masques BIODANCE » (fin le 25/09) encore active dans l'admin, à désactiver.

## 7. Les mises en avant de Zineb (vitrine cinéma et grille « À la une »)

Demande de Zineb (20/10/2026) : « dans le même style non pas les plus commandés mais les mises en avant que je décide, qui s'afficheraient au-dessus des plus commandés » ; choix : « la vitrine cinéma pour l'offre du moment, puis en dessous la grille Bento », pour « un produit » ou « un menu promo entier ». Spécification complète : `concept-mises-en-avant.md` (étude du 20/10/2026).

### 7.1 Sur la page (de haut en bas)

1. **Vitrine cinéma « Offre du moment »** (`Cinema.jsx`) : salle sombre (pétrole profond) ; à gauche, le titre en très grand ; à droite, un écran clair où flotte le produit (photo en multiply, sinon boîte générée) ou l'**éventail** de 3 à 5 photos d'un menu promo (`Eventail.jsx`). La lumière de l'écran déborde dans la salle, dans la teinte de l'offre (couleur stockée + miniature floutée agrandie : aucun pixel lu, aucun canvas). Reflet qui balaie le produit, **médaillon or** de la remise (« jusqu'à −15 % » pour un menu ; absent sans remise : produits Vaseline sans PV), compte à rebours (`Rebours.jsx`) : date au-delà de 7 jours, « Plus que N jours », puis « Se termine dans 1 j 16 h 05 min » (minutes et secondes la dernière heure).
   - Plusieurs offres : carrousel à onglets (motif APG), barres façon *stories*, précédent / suivant ; **défilement automatique sur ordinateur seulement** (8 s par offre, deux tours, arrêt sur la première ; pause au survol, onglet caché, salle à moins de 50 %, tiroir ou fenêtre modale ; arrêt définitif à la première action) ; **glissé** au doigt (mobile, tablette) et à la souris sur l'écran. Une seule rotation à la fois : la vitrine qui défile à l'écran met en pause celle des plus commandés.
   - Produit : prix net, PV et remise, rayon où l'ajout range la ligne, `BoutonLot` (« Ajouter un carton de 120 · 361,20 € HT ») et « Voir dans … ». Menu : « 13 références · dès 1,59 € HT » et « Voir les 13 produits ».
   - Hauteur stable : toutes les offres sont rendues invisibles dans la même cellule (gabarit), la page sous la vitrine ne saute pas au changement d'offre.
2. **Grille « À la une »** (`Bento.jsx`) : une grande tuile et 1 à 4 petites, placement fixe selon le nombre et la largeur (< 768, < 1 280, au-delà). Tuile produit : `<article>` à deux vrais boutons (« Ajouter », « Voir dans … ») ; tuile menu : un `<button>` entier. Pointeur fin : bordure lumineuse qui tourne (pseudo-élément conique, sans `@property`), relief au pointeur, projecteur ; entrée en cascade une fois par chargement.
3. **Les plus commandés**, inchangés (titre en h2 sous un h1 « Accueil » masqué, bandeau « Offres du moment » retiré de leur en-tête). La rangée « Offres du moment » ne liste plus que les menus absents des deux blocs.

- **Mouvement** : Web Animations, `transform` / `translate` / `opacity` seulement ; flottement borné (pendant le défilement, sinon deux cycles) ; rien d'automatique en mouvement réduit (fondu de 150 ms, éventail posé ouvert, compte à la minute). Le sujet lui-même (photo, boîte, éventail) porte les mouvements : une enveloppe transformée isolerait le multiply et ferait réapparaître le fond blanc des photos opaques.
- **Mobile** : salle pleine largeur, écran en haut, texte dessous ; à 375 × 667, sans accroche ni « Offre du moment · », le bouton d'une offre produit reste au premier écran.
- **Impression** : vitrine et grille masquées.

### 7.2 Données : clé `ec_config` « accueil_vedettes »

`{ version: 1, repli, defilement, items: [{ id, type: "produit" | "menu", cip, menu_id, emplacement: "vitrine" | "grille", titre (60), accroche (140), badge (24), date_debut, date_fin, ordre, image, couleur, couleur_auto, actif, maj }] }`. Jours inclus, heure de Paris ; fin effective = la plus proche de `date_fin` et de la fin du menu promo (offre d'un menu promo comprise). 20 objets au plus, 5 visibles par emplacement, doublons écartés (même produit ou même menu, toutes places confondues).

- **Serveur** (`_accueil-vedettes.js`, JS pur) : validation (objets de forme invalide ignorés, textes tronqués), visibilité au moment présent. Produit : offre par la règle des diapositives (`offreDynamique`) ; écartés : justificatif labo, campagne, menu de rangement masqué, introuvable (ni menu ni catalogue), sans prix, prix anormal, rupture hors précommande ; **permis** : précommande (`sansStock`), PV absent, contingentés. Menu : existe, actif, pas échu, pas masqué, au moins un produit à prix.
- **GET `accueil-offres`** : configuration lue **en parallèle** du cache, dans la même requête que `display_config` et `admin_promos` ; `vedettes` dans toutes les réponses 200 (même périmées) ; jeton admin seulement : `vedettes_etat` (état de chaque objet publié) et `?verifier=cip,cip` (brouillon de l'éditeur, 20 CIP au plus). Publication visible chez les pharmacies **en 5 minutes au plus** (relecture du GET).
- **Navigateur** (`vedettes.js`) : produits recalés sur le catalogue chargé par `resoudreOffre` (option `ignorerStock` pour une précommande) : le montant du bouton est ce que le panier facture ; menus résolus depuis `admin_promos` (nombre de produits montrés, « dès », « jusqu'à », photos de l'éventail) ; visibilité refiltrée chaque minute et à la fin d'un compte à rebours. GET absent, refusé ou plus lent que 4 s : repli automatique (la réponse tardive montre le classement ; ses mises en avant attendent le rafraîchissement suivant).
- **Repli automatique** (« la page n'est jamais nue », réglage `repli`, vrai par défaut) : sans mise en avant visible, la vitrine montre le menu promo actif dont la fin est la plus proche, sinon le plus récent ; la grille, les suivants (5 au plus), sans doublon. Au 20/10/2026 : vitrine Précommande Vaseline, grille Culottes Claripharm puis Seringues Covid (BIODANCE, échu, écarté).
- **Teinte** : couleur choisie > tirée de la photo (`couleur_auto`, calculée dans l'admin si l'hébergeur autorise la lecture : Shopify, Open Beauty Facts ; pas la banque d'images Medipim) > couleur du menu (violet par défaut ignoré) > accent du rayon > sarcelle Elixir ; déclinée par `teintes()` en trois `rgb()` bornés (contrastes du texte de la salle ≥ 7:1 pour le texte principal sur 5 teintes extrêmes, vérifiés par le test).

### 7.3 Admin : onglet « Affichage », bloc « Page d'accueil »

Trois intertitres dans l'ordre de la page : **Mises en avant** (`AdminVedettes.jsx`) · Les plus commandés · Réglages.

- Deux listes (vitrine cinéma, grille) : vignette 16:9, titre, état (Visible, Programmée, Terminée, Masquée, Non visible : motif, Au-delà de 5), dates ; Modifier, ↑ ↓ (la première de la grille est la grande tuile), Masquer, Supprimer. Repli automatique montré en ligne pointillée « automatique ».
- **+ Produit** : recherche du catalogue (CIP ou nom), rayon où l'ajout rangera la ligne et motifs par le serveur ; justificatif, campagne, déjà mis en avant : désactivés ; rupture : permise avec avertissement. **+ Menu promo** : tous les menus, état, inactifs préparables.
- Formulaire : emplacement, titre (défaut en indication : la marque, jamais le nom Odoo en capitales), accroche, badge (suggestions), dates, photo (banque d'images, adresse https, retour à la photo du catalogue ; carte de devant d'un menu), couleur (Auto avec sa source, nuancier Elixir, couleur du menu, autre), rappel « publicité réglementée » pour un médicament.
- **Brouillon** : rien ne part avant « Publier » ; « N modifications non publiées », confirmation en quittant l'onglet ou l'admin, `beforeunload`. **Publication** par l'éditeur lui-même (`config-get` POST avec `base`) : 409 → différences par titre, « Reprendre la version en ligne » ou « Publier ma version à la place » (confirmations), jamais d'écrasement silencieux. `display_config` et `admin_promos` ne sont jamais écrits par l'éditeur.
- **Aperçu** : le brouillon dans un cadre téléphone (375 px) et un cadre ordinateur, avec les vrais composants (chargés depuis le chunk de l'accueil) ; ajout désactivé, pas de défilement, « Rejouer l'animation ».

### 7.4 Banc d'essai et aperçus

- `node scripts/banc/fixture-accueil.mjs <top15j.json> --config <display_config.json> --noms <fiches.json> --vedettes dev-fixtures/accueil-vedettes.json` ajoute `vedettes` (règle du serveur, menus promo figés) à `dev-fixtures/accueil-offres.json` et écrit `dev-fixtures/get/config-get__key=accueil_vedettes.json` pour l'éditeur (hors git). Exemple : Ventoline au carton et Précommande Vaseline en vitrine ; Claripharm, Spasfon, Flector et Seringues Covid dans la grille. Le banc répond à `?verifier=` par la règle du serveur sur ses données figées, et à la publication (`config-get` POST) par un succès fictif.
- Aperçus Netlify : `accueilFictif()` ajoute 3 mises en avant d'exemple (badge « Aperçu »).

### 7.5 Tests

`node scripts/test-vedettes.mjs` (64 contrôles hors ligne) : validation identique au serveur et au navigateur, dates de Paris (fin à minuit, début demain, fin effective), compte à rebours, visibilité et motifs, GET (pharmacie / admin, une seule lecture de la configuration, aucune écriture), repli du 20/10, montant du bouton = panier (Ventoline au carton, culotte Claripharm, pot Vaseline sans PV, Dupixent hors menu), contrastes sur 5 teintes extrêmes, teinte dominante d'une photo.

### 7.6 Budgets (20/10/2026, `npm run build`)

- Bundle des pharmacies : 892 027 octets ≤ 940 000 (**+372 octets** : squelette de la salle).
- Page d'accueil : `Accueil-*.js` 21,5 Ko + `outils-*.js` 5,7 Ko (partagé avec l'admin) + `Accueil-*.css` 9,5 Ko gzip, soit **+16,7 Ko gzip** (l'étude en prévoyait 9) ; l'aperçu de l'admin réutilise ce chunk.
- Admin (chargé à la demande) : +12 Ko gzip (éditeur).

### 7.7 À confirmer par Zineb (valeurs par défaut appliquées)

Pas de défilement automatique sur téléphone ni tablette ; repli automatique (1 menu en vitrine, les suivants dans la grille) ; compte à rebours dans les 7 derniers jours seulement ; contingentés et précommandes permis, justificatif et campagnes exclus ; bandeau « Offres du moment » retiré du titre des plus commandés quand la vitrine est là ; titre par défaut d'un produit = sa marque ; salle sombre pour la vitrine, grille claire. Relevé en passant : `config-get` en GET lit toute clé sans jeton (une mise en avant programmée y est lisible avant sa date) ; 10 menus sur 14 ont gardé le violet par défaut (ignoré : à choisir dans l'onglet Promos) ; « Precommande Masques BIODANCE » (fin le 25/09) toujours active.
