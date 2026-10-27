# Copie des CIP : facile pour la pharmacie, catalogue toujours protégé

Demande de Zineb (27/10/2026) : « Fais en sorte que pour le site elixir commande, les pharmacies puissent copier coller les
codes CIP facilement. » La règle anti-copie du catalogue (docs/refonte-charte.md § 19) est gardée tant que Zineb n'en décide pas
autrement : le texte d'un CIP n'est pas sélectionnable (une sélection balayée d'un menu donnerait la liste des CIP), on le copie
un à la fois par un bouton. Dans ce cadre, la copie devient vraiment facile, et la pharmacie peut copier **ses** données en lot.

## Ce que voit la pharmacie

- **Le numéro lui-même se clique.** Partout où un CIP s'affiche, numéro et icône « copier » forment un seul bouton
  (`src/components/ui/CipCell.jsx`) : grande zone (44 px au toucher), curseur, fond au survol, Entrée / Espace au clavier,
  « Cliquer pour copier le CIP » au survol. Réussi : **« CIP copié ✓ »** en vert à la place du numéro pendant 1,5 s (largeur
  gardée, rien ne saute dans les tableaux) et un petit message en bas de l'écran, **« CIP 3400… copié »**, pour qu'on le voie sur
  mobile (région annoncée aux lecteurs d'écran, `aria-live="polite"`, hors du flux, jamais sous le doigt).
- **Copie refusée** (navigateur embarqué, permission, contexte non sécurisé) : le site essaie d'abord un repli (`execCommand`
  dans un champ hors écran) ; s'il échoue aussi, « Copie impossible » 2,5 s, puis **ce CIP-là devient sélectionnable** pour une
  copie à la main, avec un petit bouton pour réessayer.
- **Où** : grille, tableaux et liste mobile des menus, Saisie de commande (le bouton reste hors de la tabulation : l'enchaînement
  « − », quantité, « + » au clavier ne change pas), recherche globale, **lignes du panier** (le CIP y est désormais affiché sous le
  nom), **Mes commandes** (sous chaque ligne), **Péremption courte**, fauteuils roulants et de transfert, commande labo sur
  justificatif, commandes groupées, cartes de l'Assistant Elixir (lignes de commande, facture et bon de livraison, récapitulatif
  de retour). Le bandeau « De retour en stock » ne montre pas de CIP (le nom mène à la ligne de la Saisie, qui en a un) ; la boîte
  dessinée de l'accueil porte un CIP décoratif (`aria-hidden`), ce n'est pas une donnée à copier. Les écrans de l'admin gardent
  leurs propres boutons de copie.
- **« Copier les CIP » en lot — données de la pharmacie seulement** (`src/components/ui/CopieCips.jsx`) :
  - dans le **panier**, sous « Imprimer / Copier » : toutes les lignes qui ont un CIP ;
  - dans **Mes commandes**, sous chaque commande : « Copier les CIP de cette commande » ;
  - sur la **carte commande de l'assistant** : « Copier les CIP (quantités servies) ».
  Trois formats de collage, pour le logiciel de la pharmacie ou un tableur : **un CIP par ligne**, **CIP;quantité**, **CIP ⇥ quantité**
  (tabulation). Le bouton copie tout de suite au **dernier format choisi** (mémorisé sur l'appareil) ; la première fois, ou par le
  petit bouton « Format », un menu propose les trois (choix coché, Échap ou clic dehors pour fermer). Réussi : « N CIP copiés ✓ » sur
  le bouton 2 s et le message en bas ; refusé : le texte est proposé dans un champ déjà sélectionné, à copier à la main.
  Quantité : la quantité **servie** quand elle est connue (carte de l'assistant, `servi`), sinon la quantité commandée.
  Une ligne sans CIP (hors catalogue) est écartée ; un article à plusieurs références (même code fournisseur) donne la référence
  affichée (celle servie en premier), la répartition par CIP se faisant à l'envoi.

## Règle et exception (à inscrire au § 19)

- **Inchangé** : `.ex-app` en `user-select: none`, événements `copy` / `contextmenu` / `dragstart` bloqués sur le contenu
  (`src/anticopie.js` n'est pas modifié), CIP non sélectionnable, copie un à la fois. Le bouton écrit par `navigator.clipboard`
  (aucun événement `copy`), et le repli passe par un `<textarea>` : un champ, donc permis par l'anti-copie (CHAMPS).
- **Exception explicite** : la copie en lot ne porte que sur les lignes **de la pharmacie** — son panier, ses commandes passées,
  la commande que l'assistant lui montre — jamais sur un menu, un tableau ou une recherche du catalogue. C'est compatible avec
  la demande du 16/10 (ne pas livrer le catalogue et ses prix d'un geste) : la pharmacie ne récupère que ce qu'elle a elle-même
  saisi ou commandé, sans prix.

## Code

- `src/cip-copie.js` (JS pur, partagé avec les tests) : `copierTexte` (presse-papiers + repli, ne lève jamais, → booléen),
  `copierCip`, `signalerCopie` / `EVENEMENT_COPIE` (événement `ex-copie` sur `window`, écouté par `ToastCopie`), `FORMATS_CIP`,
  `lignesCip`, `quantiteLigne`, `texteCips`, `formatMemorise` / `memoriserFormat` (clé `cip_copie_format`, déclarée dans
  `scripts/verifie-zones.mjs`, `CLES_AUTORISEES.cipCopie`).
- `src/components/ui/CipCell.jsx` : le bouton entier (`.ex-cip`, tokens.css : icône `::before` passée à droite par `row-reverse`,
  marges négatives pour garder l'alignement du numéro, tons `--copie` / `--echec`), le repli sélectionnable, et `ToastCopie`
  (montée une fois dans App, à côté du message flash).
- `src/components/ui/CopieCips.jsx` : bouton partagé (« Copier les CIP » + « Format »), `MenuFormats` (`role="menu"`,
  `menuitemradio` cochés), champ de secours.
- Branchements : panier et bon copié (`src/App.jsx`), `MyOrdersPanel.jsx`, `ShortExpiry.jsx`, `WheelchairOrder.jsx`,
  `LabJustifOrder.jsx`, `GroupOrders.jsx`, `assistant/Cartes.jsx`.
- **Bon de commande copié** (`handleCopy`, zone protégée) : passe par `copierTexte` au lieu de `navigator.clipboard.writeText`
  sans garde — mêmes libellés et délais, repli en plus (avant, un navigateur sans presse-papiers levait une exception non
  rattrapée). Écart déclaré dans `ECARTS_AUTORISES` (lot « copie des CIP », attente `cipCopie`).

## Budget du bundle

Marge de départ : **53 octets** (512 947 pour 513 000, après les limites des menus promo). Le lot ajoute ~1,9 Ko au bundle des
pharmacies (CipCell, message, module, CIP au panier). Pour tenir le budget sans le relever (décision de la cliente requise) :
la fenêtre **Mes commandes passe à la demande** (`MyOrdersPanel-*.js`, 8 Ko ; la lecture des commandes part en parallèle, la
fenêtre affiche « Chargement de vos commandes… » le temps du téléchargement, et une fenêtre d'erreur avec « Fermer » si le
morceau est injoignable) et « Copier les CIP » est un morceau à part (`CopieCips-*.js`, 4 Ko). Résultat : **510 456 octets,
marge 2 544**, budget inchangé.

## Vérifié

- `npm run build`, `npm run lint`, `npm run zones` (master et `--ref origin/master`) : aucun écart ; 11 zones, dont `handleCopy`
  par son écart déclaré ; clé `cip_copie_format` admise.
- `node scripts/test-cip-copie.mjs` (73 contrôles) : formats, repli du presse-papiers, format mémorisé, CipCell (bouton entier,
  jamais sélectionnable, tabulation, clics réussis / refusés), CopieCips (désactivé sans CIP, copie immédiate au format mémorisé,
  menu, refus), anti-copie intact (`user-select`, `anticopie.js` identique à `origin/master`), chaque écran rend CipCell.
- Tous les `scripts/test-*.mjs` existants et `scripts/banc/controle-accueil.mjs` : voir le compte rendu du lot.
- Banc du 27/10/2026 (Chrome sans interface, profil jetable, presse-papiers autorisé, vrais clics de souris ; captures dans le
  compte rendu du lot) : Saisie à 1 440 et 375 px — clic sur le numéro → presse-papiers = le CIP, « CIP copié » sur le bouton,
  message « CIP 3400… copié » en bas, `user-select: none` gardé, aucun `ex-selectionnable` ; 375 px sans défilement horizontal ;
  panier — CIP sous le nom de la ligne, menu des formats, « CIP ; quantité » → `3400927562396;3`, « 1 CIP copié », format
  mémorisé `pv` ; Mes commandes — 12 CIP copiables sur 3 commandes, « Copier les CIP de cette commande » → 4 lignes `CIP;qté` ;
  Péremption courte — clic dans la colonne CIP → copié ; carte commande de l'assistant — 2 CIP, « Copier les CIP (quantités
  servies) » → `3400900000011;6` et `3400900000028;3` (6 servis sur 10 commandés). Aucune erreur en console.

## Limites et suites possibles

- Le CIP d'une ligne du panier est celui de la référence affichée ; pour un article à plusieurs références, les CIP réellement
  envoyés peuvent différer (répartition à l'envoi, docs/articles multi-CIP).
- Si Zineb lève la règle anti-copie des CIP, il suffira de rendre le numéro sélectionnable (`.ex-cip` en `user-select: text`) :
  le bouton et les lots resteront utiles.
- Les quantités servies ne sont connues que par l'assistant (Odoo) ; « Mes commandes » du site copie les quantités commandées.
