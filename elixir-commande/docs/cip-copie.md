# Copie des CIP : facile pour la pharmacie, catalogue toujours protégé

Demande de Zineb (27/10/2026) : « Fais en sorte que pour le site elixir commande, les pharmacies puissent copier coller les
codes CIP facilement. » La règle anti-copie du catalogue (docs/refonte-charte.md § 19) est gardée tant que Zineb n'en décide pas
autrement : le texte d'un CIP n'est pas sélectionnable (une sélection balayée d'un menu donnerait la liste des CIP), on le copie
un à la fois par un bouton. Dans ce cadre, la copie devient vraiment facile, et la pharmacie peut copier **ses** données en lot.

## Ce que voit la pharmacie

- **Le numéro lui-même se clique.** Partout où un CIP s'affiche, numéro et icône « copier » forment un seul bouton
  (`src/components/ui/CipCell.jsx`) : grande zone (44 px au toucher), curseur, fond au survol, Entrée / Espace au clavier,
  « Cliquer pour copier le CIP » au survol. Le clic ne remonte jamais au conteneur : sur une carte cliquable (suggestions de
  recommande, qui ajoutent au panier), copier le CIP ne déclenche pas l'action de la carte. Réussi : **« CIP copié ✓ »** en vert
  à la place du numéro pendant 1,5 s (largeur gardée, rien ne saute dans les tableaux) et un petit message en bas de l'écran,
  **« CIP 3400… copié »**, pour qu'on le voie sur mobile (région annoncée aux lecteurs d'écran, `aria-live="polite"`, hors du flux,
  jamais sous le doigt ; centré en bas sur ordinateur, calé à gauche sous 768 px pour laisser la colonne du panier flottant et du
  lanceur de l'assistant).
- **Copie refusée** (navigateur embarqué, permission, contexte non sécurisé) : le site essaie d'abord un repli (`execCommand`
  dans un champ hors écran, qui rend ensuite le focus là où il était) ; s'il échoue aussi, **« Copie impossible »** en rouge sur le
  bouton entier pendant 2,5 s et un message en bas de l'écran en rouge (« Copie impossible : sélectionnez le numéro pour le
  copier »), **puis** ce CIP-là devient sélectionnable pour une copie à la main, avec la mention « à sélectionner » et un petit
  bouton « Réessayer ».
- **Où** : grille, tableaux et liste mobile des menus, Saisie de commande (le bouton reste hors de la tabulation : l'enchaînement
  « − », quantité, « + » au clavier ne change pas), recherche globale, **suggestions de recommande** (cartes en tête de chaque vue ;
  le clic sur le CIP copie sans ajouter au panier), **lignes du panier** (le CIP y est désormais affiché sous le nom), **Mes
  commandes** (sous chaque ligne), **Péremption courte**, fauteuils roulants et de transfert, commande labo sur justificatif,
  commandes groupées, cartes de l'Assistant Elixir (lignes de la carte commande et récapitulatif de retour ; les cartes facture et
  bon de livraison n'ont pas de lignes). Le bandeau « De retour en stock » ne montre pas de CIP (le nom mène à la ligne de la
  Saisie, qui en a un) ; la boîte dessinée de l'accueil porte un CIP décoratif (`aria-hidden`), ce n'est pas une donnée à copier.
  Les écrans de l'admin gardent leurs propres boutons de copie.
- **« Copier les CIP » en lot — données de la pharmacie seulement** (`src/components/ui/CopieCips.jsx`) :
  - dans le **panier**, sous « Imprimer / Copier le bon » (le bouton du bon de commande dit désormais ce qu'il copie) : toutes les
    lignes qui ont un CIP ;
  - dans **Mes commandes**, sous chaque commande : « Copier les CIP de cette commande » (« Copier les CIP » sous 768 px, le libellé
    long restant dans l'infobulle et pour les lecteurs d'écran) ;
  - sur la **carte commande de l'assistant** : « Copier les CIP », avec la précision « quantités servies » sous le bouton et dans
    l'infobulle.
  Trois formats de collage, pour le logiciel de la pharmacie ou un tableur : **un CIP par ligne**, **CIP;quantité**, **CIP ⇥ quantité**
  (tabulation). Le bouton copie tout de suite au **dernier format choisi** (mémorisé sur l'appareil) ; la première fois (le bouton
  annonce alors son menu : `aria-haspopup`, `aria-expanded`), ou par le petit bouton « Format », un menu propose les trois : amené
  dans la zone visible (le tiroir du panier le coupait par le bas), focus sur le format coché (sinon le premier), flèches haut / bas,
  Début / Fin, Entrée ou Espace pour choisir, Échap ou clic dehors pour fermer, focus rendu au bouton d'origine. Réussi : « N CIP
  copiés ✓ » sur le bouton 2 s et le message en bas ; refusé : « Copie impossible », message en bas en rouge, et le texte est
  proposé dans un champ déjà sélectionné, à copier à la main.
  Quantité : la quantité **servie** quand elle est connue (carte de l'assistant, `servi`), sinon la quantité commandée.
  Une ligne sans CIP (hors catalogue) est écartée ; un article à plusieurs références (même code fournisseur) donne la référence
  affichée (celle servie en premier), la répartition par CIP se faisant à l'envoi. **Un même CIP sur deux lignes** (ligne normale
  + ligne « péremption courte » à part dans le panier, deux lignes Odoo d'une même commande) donne **une seule ligne, quantités
  additionnées** : un logiciel d'officine ou un tableur refuserait le doublon ou l'importerait deux fois.

## Règle et exception (à inscrire au § 19)

- **Inchangé** : `.ex-app` en `user-select: none`, événements `copy` / `contextmenu` / `dragstart` bloqués sur le contenu
  (`src/anticopie.js` n'est pas modifié), CIP non sélectionnable, copie un à la fois. Le bouton écrit par `navigator.clipboard`
  (aucun événement `copy`), et le repli passe par un `<textarea>` : un champ, donc permis par l'anti-copie (CHAMPS).
- **Exception explicite** : la copie en lot ne porte que sur les lignes **de la pharmacie** — son panier, ses commandes passées,
  la commande que l'assistant lui montre — jamais sur un menu, un tableau ou une recherche du catalogue. C'est compatible avec
  la demande du 16/10 (ne pas livrer le catalogue et ses prix d'un geste) : la pharmacie ne récupère que ce qu'elle a elle-même
  saisi ou commandé, sans prix.

## Code

- `src/cip-copie.js` (JS pur, partagé avec les tests) : `copierTexte` (presse-papiers + repli, ne lève jamais, → booléen ; le repli
  rend le focus à l'élément actif et part tout de suite, dans le geste, quand `navigator.clipboard` est absent), `copierCip`,
  `signalerCopie(message, ton)` / `EVENEMENT_COPIE` (événement `ex-copie` sur `window`, `detail = { message, ton }`, écouté par
  `ToastCopie`), `FORMATS_CIP`, `lignesCip` (fusion par CIP), `quantiteLigne`, `texteCips`, `formatMemorise` / `memoriserFormat`
  (clé `cip_copie_format`, déclarée dans `scripts/verifie-zones.mjs`, `CLES_AUTORISEES.cipCopie`).
- `src/components/ui/CipCell.jsx` : le bouton entier (`.ex-cip`, tokens.css : icône `::before` passée à droite par `row-reverse`,
  marges négatives pour garder l'alignement du numéro, tons `--copie` / `--echec`), `stopPropagation` sur le clic, la séquence du
  refus (`DUREE_ECHEC` 2,5 s puis `manuel`), le repli sélectionnable (« à sélectionner », « Réessayer »), et `ToastCopie` (montée
  une fois dans App, à côté du message flash ; position par la classe `.ex-toast-copie` de tokens.css, à gauche sous 768 px).
- `src/components/ui/CopieCips.jsx` : bouton partagé (« Copier les CIP » + « Format »), props `libelle`, `libelleCourt` (affiché sous
  768 px par `.ex-copie-cips__court` / `__long`), `aide`, `compact`, `style` (ses marges extérieures vont sur la racine) ;
  `MenuFormats` (`role="menu"`, `menuitemradio` cochés, focus à l'ouverture, flèches), champ de secours. La racine ne dépasse
  jamais son conteneur (`max-width: 100%`, `min-width: 0`, libellé en ellipse).
- Branchements : panier, suggestions de recommande et bon copié (`src/App.jsx`), `MyOrdersPanel.jsx`, `ShortExpiry.jsx`,
  `WheelchairOrder.jsx`, `LabJustifOrder.jsx`, `GroupOrders.jsx`, `assistant/Cartes.jsx`.
- **Bon de commande copié** (`handleCopy`, zone protégée) : passe par `copierTexte` au lieu de `navigator.clipboard.writeText`
  sans garde — mêmes libellés et délais, repli en plus (avant, un navigateur sans presse-papiers levait une exception non
  rattrapée). Écart déclaré dans `ECARTS_AUTORISES` (lot « copie des CIP », attente `cipCopie`).

## Budget du bundle

Marge de départ : **53 octets** (512 947 pour 513 000, après les limites des menus promo). Le lot ajoute ~1,9 Ko au bundle des
pharmacies (CipCell, message, module, CIP au panier). Pour tenir le budget sans le relever (décision de la cliente requise) :
la fenêtre **Mes commandes passe à la demande** (`MyOrdersPanel-*.js`, 8 Ko ; le morceau est **préchargé** au repos dès que la
pharmacie est identifiée, et au survol / focus du bouton « Mes commandes », si bien que la fenêtre d'attente « Chargement de vos
commandes… » — fermable : clic dehors, « Fermer », focus rendu — ne s'affiche presque jamais ; fenêtre d'erreur avec « Fermer » si
le morceau est injoignable) et « Copier les CIP » est un morceau à part (`CopieCips-*.js`, 4 Ko). Résultat après la revue :
**512 101 octets, marge 899**, budget inchangé. Ce passage à la demande est un choix pris pour le budget : relever le budget de
513 000 à ~516 000 rendrait la fenêtre embarquée (à trancher par Zineb).

## Vérifié

- `npm run build`, `npm run lint`, `npm run zones` (master et `--ref origin/master`) : aucun écart ; 11 zones, dont `handleCopy`
  par son écart déclaré ; clé `cip_copie_format` admise.
- `node scripts/test-cip-copie.mjs` (91 contrôles) : formats (fusion d'un CIP en doublon comprise), repli du presse-papiers (focus
  rendu, repli synchrone sans presse-papiers), format mémorisé, CipCell (bouton entier, jamais sélectionnable, tabulation, clic sans
  propagation, « Copie impossible » rendu avant le passage en sélectionnable), CopieCips (désactivé sans CIP, copie immédiate au
  format mémorisé, menu annoncé, libellés court / long, aide, marges), anti-copie intact (`user-select`, message en bas en CSS,
  `anticopie.js` identique à `origin/master`), chaque écran rend CipCell (suggestions de recommande comprises).
- Tous les `scripts/test-*.mjs` existants et `scripts/banc/controle-accueil.mjs` : voir le compte rendu du lot.
- Banc du 27/10/2026 (Chrome sans interface, profil jetable, presse-papiers autorisé, vrais clics de souris ; captures dans le
  compte rendu du lot) : Saisie à 1 440 et 375 px — clic sur le numéro → presse-papiers = le CIP, « CIP copié » sur le bouton,
  message « CIP 3400… copié » en bas, `user-select: none` gardé, aucun `ex-selectionnable` ; 375 px sans défilement horizontal ;
  panier — CIP sous le nom de la ligne, menu des formats, « CIP ; quantité » → `3400927562396;3`, « 1 CIP copié », format
  mémorisé `pv` ; Mes commandes — 12 CIP copiables sur 3 commandes, « Copier les CIP de cette commande » → 4 lignes `CIP;qté` ;
  Péremption courte — clic dans la colonne CIP → copié ; carte commande de l'assistant — 2 CIP, « Copier les CIP (quantités
  servies) » → `3400900000011;6` et `3400900000028;3` (6 servis sur 10 commandés). Aucune erreur en console.

## Revue du 27/10/2026 (deux relectures : UX et anti-copie) — correctifs

Banc des correctifs : Chrome sans interface, profil jetable, presse-papiers autorisé, vrais clics et touchers, 1 440 et 375 px
(script `banc-correctifs.mjs` du compte rendu, captures `saisie-1440-cip-copie`, `saisie-repli-copie-impossible`,
`saisie-repli-selectionnable`, `panier-menu-formats`, `panier-cips-copies`, `mes-commandes`, `mes-commandes-375`,
`mes-commandes-375-menu`, `peremption-1440`, `assistant-carte-commande`, `assistant-carte-commande-375`, `saisie-375-cip-copie`).

| Constat | Correctif |
|---|---|
| Mes commandes et carte de l'assistant à 375 px : la rangée « Copier les CIP » débordait de la carte (bloquant / majeur) | Racine de `CopieCips` bornée (`max-width: 100%`, `min-width: 0`), bouton en `flex: 1 1 auto` (libellé en ellipse), libellé court sous 768 px (`libelleCourt`), « quantités servies » en aide sous le bouton ; mesuré : bouton de 96 à 237 px pour une carte de 32 à 343 px, assistant 33–342 pour 16–359. |
| Panier à 1 440 px : au premier clic, le menu des formats était coupé par le bas du tiroir (majeur) | `MenuFormats` : `scrollIntoView({ block: "nearest" })` à l'ouverture ; mesuré : bas du menu ≤ bas de la zone visible juste après le clic, sans défilement préalable. |
| Repli de CipCell : « Copie impossible » n'apparaissait jamais, le numéro passait tout de suite en texte sélectionnable sans message (majeur, deux relectures) | `setEtat("echec")` puis, 2,5 s plus tard, `setManuel(true)` ; message en bas en ton danger ; mention « à sélectionner » et bouton « Réessayer » dans le repli. |
| Suggestions de recommande : CIP en texte brut, ni copiable ni sélectionnable ; carte cliquable (majeur) | `CipCell` dans la carte ; le clic sur un CIP ne remonte jamais au conteneur (`stopPropagation`) : copié sans ajout au panier (vérifié au banc). |
| Message en bas et panier flottant à 375 px : chevauchement (mineur) | Position en CSS (`.ex-toast-copie`) ; sous 768 px, calé à gauche (`left: 16px`, largeur ≤ 100vw − 112 px) : plus aucun chevauchement avec le panier flottant ni le lanceur. |
| Décalage de 4 px entre « Copier les CIP » et « Format » (mineur) | Marges extérieures du `style` reçu posées sur la racine ; écart mesuré 0. |
| Menu des formats au clavier (mineur) | Focus sur le format coché (sinon le premier) à l'ouverture, flèches haut / bas cycliques, Début / Fin, Échap et choix rendent le focus au bouton d'origine ; `aria-haspopup` / `aria-expanded` sur le bouton principal tant qu'aucun format n'est mémorisé. |
| Deux « Copier » superposés dans le panier (mineur) | « Copier le bon » (title et aria-label inchangés). |
| Fenêtre d'attente de Mes commandes bloquante et éclair visible sur réseau lent (mineur) | Morceau préchargé au repos après l'identification et au survol / focus du bouton ; fenêtre d'attente fermable (clic dehors, « Fermer », `FocusFenetre`). |
| `copierTexte` : focus perdu après le repli, repli après une microtâche sans presse-papiers (mineur) | Focus rendu (`preventScroll`), `setSelectionRange` après `select()` (iOS), repli synchrone quand `navigator.clipboard` est absent. |
| Un même CIP sur deux lignes du panier copié deux fois (mineur) | Fusion par CIP, quantités additionnées (voir « Limites »). |
| Documentation (cartes facture / BL sans lignes ; séquence du refus) (mineur) | Corrigée ici et au § 19. |

Non repris : le `role="group"` à la place de `role="menu"` (variante proposée) — le menu garde son rôle, avec la navigation attendue.

## Limites et suites possibles

- Le CIP d'une ligne du panier est celui de la référence affichée ; pour un article à plusieurs références, les CIP réellement
  envoyés peuvent différer (répartition à l'envoi, docs/articles multi-CIP).
- Si Zineb lève la règle anti-copie des CIP, il suffira de rendre le numéro sélectionnable (`.ex-cip` en `user-select: text`) :
  le bouton et les lots resteront utiles.
- Les quantités servies ne sont connues que par l'assistant (Odoo) ; « Mes commandes » du site copie les quantités commandées.
- Fusion par CIP : deux lignes de même CIP (péremption courte à part, deux lignes Odoo) donnent une ligne, quantités additionnées.
  Si une pharmacie préfère une ligne par ligne de commande (lot, prix distinct), c'est un choix à faire trancher par Zineb : il
  suffirait de retirer la fusion de `lignesCip`.
- Le message en bas calé à gauche sous 768 px et la zone de toucher restent à confirmer sur l'iPhone de Zineb.
