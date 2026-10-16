# Centrale OTC : trier et filtrer par laboratoire

Demande de Zineb (16/10/2026) : « Pour le menu OTC Centrale d'achat, ajoute la fonctionnalité trier par Labo et Filtrer par Labo. Tu dois chercher ces infos dans Medipim (Fabricant). »

## Mise en service

1. **Supabase**, éditeur SQL, une fois : `sql/labo-otc.sql`, soit `ALTER TABLE public.elixir_products ADD COLUMN IF NOT EXISTS labo TEXT;`.
   - Le code marche avant et après. Sans la colonne, le site ne change pas, et l'admin affiche la commande SQL au lieu de l'outil.
   - Si l'admin annonce encore « colonne absente » après la migration, exécuter `notify pgrst, 'reload schema';`.
2. **Admin**, onglet « Modifier » (section « Toutes sections » ou « Centrale OTC / Para »), bloc « Laboratoires — Centrale OTC / Para » : cliquer « Renseigner les laboratoires manquants (Medipim) ».
   - Compter environ 10 s de recherche pour 670 produits, puis un enregistrement par produit trouvé.
   - Un bilan s'affiche à la fin : enregistrés, déjà à jour, introuvables dans Medipim (avec leur liste), en erreur.
3. **Site** : « Trier par » et « Laboratoire » apparaissent dans la Centrale OTC dès qu'un produit a un laboratoire.

## Données

- **Origine.** labo = « Fabricant » de Medipim (`organizations[]` de la fiche), avec la même règle que l'onglet SRA d'elixir-reappro :
  - les dépositaires logistiques (Alloga, CSP, Eurodep, Depolabo, Movianto, Arvato) sont écartés s'il existe une autre organisation ;
  - sinon, on prend l'id Medipim le plus petit.
- **Couverture** (banc, 16/10/2026) : 657 produits OTC sur 670 ont un laboratoire, répartis en 90 laboratoires. Les 13 autres sont absents de Medipim (Mepilex, Mepitel, Freestyle, Contour…) : à saisir à la main.
- **Noms.** Ils sont repris tels que Medipim les écrit (« URIACH FRANCE », « Procter & Gamble »).
  - On peut les corriger dans l'admin : champ « Laboratoire » du formulaire de modification, avec la liste des laboratoires déjà connus et un bouton « 🔍 Medipim ».
  - La recherche de l'onglet trouve aussi un produit par son laboratoire.
  - Le site regroupe les noms sans tenir compte de la casse, des accents ni des espaces doubles, et affiche l'orthographe la plus fréquente.
- **Jamais d'écrasement.** Le bouton ne traite que les produits sans laboratoire.
  - Pour remplacer aussi les laboratoires déjà renseignés, y compris ceux saisis à la main, il faut cocher « Remplacer aussi les laboratoires déjà renseignés », puis confirmer.
  - Chaque enregistrement est inscrit dans l'historique du produit (auteur « medipim », `changes.labo` avec l'avant et l'après).
- **Nouveaux produits.** Ils n'ont pas de laboratoire : relancer le bouton, qui ne traite que les manquants.

## Site (Centrale OTC seulement en V1)

- **« Trier par » A–Z / Laboratoire.** C'est un sélecteur segmenté avec `aria-pressed`.
  - En mode Laboratoire, la grille est groupée, avec un en-tête par laboratoire (`h2`, nombre de références). « Laboratoire non renseigné » vient en dernier.
  - Dans ce mode, la barre A–Z suit l'initiale du laboratoire.
- **« Laboratoire ».** C'est une liste native (clavier, lecteurs d'écran, sélecteur du téléphone) : « Tous les laboratoires », puis un laboratoire par ligne avec son nombre de références dans le menu.
  - Le filtre se combine avec la recherche, Favoris, En stock, Ruptures et Avec remise.
  - Une liste vide indique « laboratoire « X » », et « Effacer les filtres » le retire aussi.
- **Adresse.** Exemple : `?menu=otc&tri=labo&labo=Bayer`, mis à jour par `replaceState`.
  - Retour / Avancer changent de menu comme avant ; revenir sur la Centrale OTC rend son tri et son laboratoire.
  - Les paramètres sont ignorés avec un autre menu.
  - Un laboratoire inconnu est oublié.
- **Panier inchangé.** Les produits triés restent les mêmes objets : les clés `otc-<index>` ne bougent pas. Vérifié sur le banc : un produit ajouté en mode Laboratoire garde sa quantité en A–Z.
- **Autres menus.** Pour étendre le tri et le filtre à un autre menu, ajouter sa clé à `LABO_SECTIONS` (src/App.jsx), puis renseigner ses laboratoires.

## Serveur

- **`medipim-lookup`** (admin seulement, comme avant) :
  - la fiche (GET) renvoie aussi `labo` et `labo_autres` ;
  - le mode lot, `POST { action: "labos", codes }` (150 codes au plus), renvoie `{ labos: { code: { labo, autres } }, introuvables, sans_labo }`.
    - Il fait une seule recherche Medipim par lot (environ 1 s pour 150 codes).
    - Medipim saturé ou en panne : 429 / 503 avec `Retry-After` ; plus de 8 s : 504.
    - L'admin enchaîne les lots un par un, avec 1,5 s d'écart (clé partagée, 100 appels par minute).
- **`products-upsert`** :
  - `labo` n'est écrit que s'il est envoyé (espaces nettoyés, 120 caractères au plus, vide = null) ;
  - une modification ordinaire ne l'envoie jamais ;
  - colonne absente : réponse 409 `labo_colonne_absente`, avec la commande SQL, et rien n'est modifié.
- **`products-get`** est inchangé : `select=*` renvoie `labo` dès que la colonne existe.
- **Tests** : `node scripts/test-labo.mjs` (hors ligne, fetch simulé).

## Points ouverts

- **Budget du bundle** (`npm run zones`) dépassé de 5 827 octets.
  - La branche ajoute 7 957 octets au bundle des pharmacies (JS 7 295, CSS 662) ; la marge était de 2 130 octets.
  - L'outil de l'admin est chargé à la demande (`AdminLabos-*.js`, 5,5 Ko), donc hors du budget.
  - À décider par la cliente :
    - relever le budget ;
    - ou regagner de la place par un lot à part (par exemple, charger l'admin et la bibliothèque xlsx à la demande : ils sont aujourd'hui dans le bundle des pharmacies).
- **Clé Medipim.** Son repli est écrit en dur dans `netlify/functions/_medipim.js` (TODO dans medipim-lookup) : ne garder que les variables d'environnement, puis changer la clé.
