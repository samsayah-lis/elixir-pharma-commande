# Plan de refonte visuelle d'elixir-commande, alignée sur elixirpharma.fr

**Conventions de chemin.** `src/…`, `index.html`, `netlify.toml` et `package.json` sont relatifs à /Users/samsayah/Downloads/elixir-pharma-repo/elixir-commande (HEAD c6809dc). `site/…` renvoie à /Users/samsayah/Downloads/elixir-pharma-site.

Travail fait en lecture seule : aucun fichier n'a été modifié.

---

## 0. Cadre et points vérifiés

### Principes

1. **On habille, on ne réécrit pas.**
   - On garde l'architecture : `App` monolithique, styles inline, pas de routeur.
   - On remplace les valeurs codées en dur par des jetons et on ajoute un petit CSS global.
   - Les lots 1 à 10 ne touchent à aucune logique métier.
   - Tout changement de comportement est isolé dans le lot E, point par point, et seulement après accord de la cliente.
2. **Cible de cohérence.** C'est la maquette de l'appli dessinée dans la vitrine : site/digital.html:184-195 et site/src/styles/digital.css:224-343.
   - Elle montre un en-tête pétrole avec la croix en or clair, une recherche en pastille, un fond paper et des cartes blanches à ombre douce.
   - Elle utilise un bouton « + » pétrole, un badge promo or + encre, une barre A–Z en pastille et des lignes « Mes commandes » avec bouton « Recommander ».
   - L'or y sert d'action principale.
3. **Pas d'animation 3D ni de « Voir le parcours » dans l'app.** Le parcours animé reste sur la vitrine (site/index.html:44).
   - Rien de three, GSAP ni Lenis dans elixir-commande : Lenis casserait `window.scrollTo` et `scrollY` de la barre A–Z (src/App.jsx:1108-1121), et three alourdirait un bundle déjà de 1 094 491 octets (dist/assets/index-KzkyflIC.js).

### Doutes levés en relisant le code

**Comportements**
- **L'arrondi au colis s'applique à chaque frappe.** `setQty` arrondit (src/App.jsx:810-816) et il est appelé par `onChange` (src/App.jsx:2616). Avec un colis de 6, taper « 12 » donne 0 : c'est confirmé.
- **Chaque ajout depuis la Saisie ouvre le panier.** `addItemToCart` fait `setCartOpen(true)` (src/App.jsx:861).
  - Cette ouverture déclenche aussi le rechargement du contingentement (`useEffect` sur `cartOpen`, src/App.jsx:960).
  - Supprimer l'ouverture automatique change donc le moment où l'alerte de quota apparaît. Le contrôle juste avant l'envoi reste en place (src/App.jsx:1348).

**Styles et CSS**
- **Le `<style>` global ne s'applique pas à l'écran d'identification.** Il est rendu dans le `return` principal (src/App.jsx:3011-3027), alors que l'identification sort plus tôt (src/App.jsx:1540).
  - Le déplacer dans un CSS global change l'écran d'identification. Par exemple, `box-sizing: border-box` réduit la carte `obCard` de 88 px (padding 40/44, src/App.jsx:1521).
- **Le focus ne peut pas reposer sur un simple `:focus-visible`.** Les `outline:"none"` inline (26 occurrences : App.jsx ×6, AdminDisplay ×7, ShortExpiry ×3…) l'emportent sur une feuille de style. La règle doit donc porter `!important`.
- **Le survol des lignes efface le fond « rupture ».** C'est un `onMouseEnter`/`onMouseLeave` qui réécrit le fond (src/App.jsx:2493-2499). Un `:hover` CSS n'est possible qu'après avoir retiré ce `background` inline.

**Données envoyées**
- **Changer `fmt` ne touche pas les données envoyées.** `fmt()` (src/App.jsx:42) sert uniquement à l'affichage. L'e-mail utilise `toFixed` (src/App.jsx:1385), le texte copié aussi (src/App.jsx:1144-1149).
  - On peut donc passer `fmt` au format français (espace des milliers, espace insécable avant €) sans modifier les envois.

**Build et polices**
- `scripts/gen-cips.js:8` lit `src/App.jsx`. Il ne faut ni déplacer ni renommer ce fichier.
- DM Sans est déclarée à 7 endroits :
  - index.html:11 ;
  - src/App.jsx:1520, 1657 et 1708 ;
  - src/AdminPanel.jsx:1018, 1059 et 1887 ;
  - un commentaire en src/App.jsx:3012.
- **Poids d'Inter** (@fontsource-variable/inter 5.3.0, déjà utilisé par la vitrine) :
  - fichier latin à axe de graisse : 48 Ko (`inter-latin-wght-normal.woff2`) ;
  - version à taille optique utilisée par la vitrine (site/src/styles/base.css:8) : 73 Ko.
  - Pour l'app, on prend `wght.css`.

**Libellés trompeurs**
- Le bouton d'actualisation promet « Forcer la mise à jour depuis Odoo » (src/App.jsx:1764). En réalité, il relit seulement la table Supabase (`fetchStock`, src/App.jsx:600-610).

**Contrastes recalculés (WCAG)**

| Paire | Rapport | Verdict |
|---|---|---|
| ink-mute #6f6863 sur cream | 4,77 | correct |
| ink-mute sur sand #ebe6dc | 4,40 | à éviter |
| encre sur or | 5,82 | correct |
| blanc sur or | 2,98 | insuffisant |
| or sur paper | 2,81 | insuffisant |
| teal-2 sur cream | 4,41 | insuffisant en petit corps |
| teal sur mint | 6,39 | correct |
| --ok #065f46 sur #dce9e5 | 6,16 | correct |
| --danger #b91c1c sur #f7e4e4 | 5,29 | correct |
| --warn #92400e sur #f4e7dd | 5,85 | correct |
| blanc sur #0ea5e9 (bouton « Envoyer » actuel) | 2,77 | insuffisant |
| blanc sur #10b981 (« Ajouter » actuel) | 2,54 | insuffisant |
| or clair sur pétrole | 7,73 | correct |
| paper à 70 % sur pétrole (#b4bbbc) | 7,36 | correct |
| bordure #949190 sur blanc | 3,13 | ≥ 3:1, conforme à WCAG 1.4.11 |

**Écart avec la maquette de la vitrine**
- La maquette montre des onglets horizontaux (site/src/styles/digital.css:239-241).
- L'app garde sa barre latérale, avec plus de 20 menus en deux groupes (src/App.jsx:1678-1702). On accepte cet écart.

---

## 1. Direction artistique : « la vitrine, en version outil »

### 1.1 Ce qu'on reprend de la vitrine

| Élément | Vitrine | App de commande |
|---|---|---|
| Police | Inter locale, sans italique (site/src/styles/base.css:8, 28, 74-75) | Inter Variable `wght` en local, `font-style: normal` forcé, plus aucune police externe |
| Palette | site/src/styles/base.css:10-25 | Mêmes jetons, copiés tels quels |
| Fond | cream / paper | Page en `--cream`, barre latérale et panneaux en `--paper`, cartes et tableaux en `--surface` blanc (photos produit) |
| En-tête | `.appli__entete` pétrole + croix or clair (site/src/styles/digital.css:225-227) | En-tête collant `--petrol`, croix SVG `--or-clair`, mot ELIXIR en 600 avec un interlettrage de 0,28 em |
| Boutons | pastilles 999 px ; `.btn--jaune` (or + encre) ; `.btn--ligne` (site/src/styles/base.css:103-113) | Pastilles compactes ; or + encre réservé à « Envoyer la commande » ; secondaires en filet encre |
| Badges | promo or + encre, précommande sarcelle (site/src/styles/digital.css:281-284) | Identiques, en 11 px minimum |
| Focus | 3 px `--teal-2`, or clair sur sombre (site/src/styles/base.css:76-77) | Identique, en `!important` pour battre les `outline:none` inline |
| Sélection | or + encre (site/src/styles/base.css:78) | Identique |
| Mouvement réduit | site/src/styles/base.css:129-131 | Identique |
| Croix Elixir | site/public/favicon.svg | Favicon + logo, en remplacement de l'emoji 💊 (public/favicon.svg) et du texte « ELIXIR » (src/App.jsx:1527, 1671-1672) |

### 1.2 Ce qu'on adapte à un outil dense

**Échelle typographique compacte**, sans les `clamp` de la vitrine (site/src/styles/base.css:32-38) :

| Taille | Usage |
|---|---|
| 11 px | minimum absolu ; remplace les 8, 9 et 10 px |
| 12 px | métadonnées, CIP |
| 13 px | cellules, désignations |
| 14 px | texte courant, champs |
| 16 px | titres de carte |
| 20 px | titres de vue, prix sur carte |
| 26 px | titre de catalogue |

- Graisses : 400, 500 (menu), 600 (nom de produit), 640 (titres, comme `--titre-graisse`), 700 (prix, boutons, badges). Les 800 et 900 passent à 700.
- Interlettrage des titres : −0,02 em, au lieu de −0,035 em sur la vitrine.
- `font-variant-numeric: tabular-nums` sur les prix, quantités, totaux, compteurs et dates. Les chiffres alignés font gagner du temps à la lecture des colonnes.
- CIP/EAN en `ui-monospace`, 12 px, couleur `--ink-mute`.

**Rayons**

| Rayon | Usage |
|---|---|
| 6 px | champ de quantité de tableau, petits badges carrés |
| 10 px | champs, petits blocs |
| 16 px | cartes produit, en-tête de section, panier |
| 28 px | réservé aux fenêtres, à l'écran d'identification et aux bandeaux de vue |
| 999 px | boutons, filtres, recherche, A–Z |

**Densité**
- On conserve le gabarit actuel des cellules : 10 px × 14 px (src/App.jsx:3110-3112), avec des lignes de 40 à 44 px.
- Champ de quantité de 50 px et boutons de 24 px dans le tableau d'ordinateur (src/App.jsx:2613-2626).
- Grille en `minmax(220px, 1fr)` (src/App.jsx:2209).
- Hauteur des boutons : 32 à 36 px dans les listes, 44 à 48 px seulement pour les actions principales et au tactile.

### 1.3 Ce qu'on ne reprend pas

- GSAP, ScrollTrigger, SplitText, Lenis, three, les `data-reveal` et `data-split`, les transitions entre pages (`@view-transition`), les fonds qui changent au défilement, les boutons aimantés et le remplissage animé `.btn::after`.
  - Dans l'outil, seules restent des transitions de 150 à 200 ms sur `--ease` (couleur, fond, ombre). Jamais de `transform` sur les 675 cartes OTC.
- Les grands espacements (`.section` 72-150 px, `--gutter` jusqu'à 56 px, site/src/styles/base.css:42, 119) et les titres en `clamp`.
- La navigation flottante en pastille avec `backdrop-filter` (site/src/styles/components.css:6) : l'en-tête reste collant et opaque, car la barre A–Z se colle dessous.
- Le texte or sur fond clair, l'or en fond sous du texte blanc et les dégradés sur les boutons (16 dégradés pétrole aujourd'hui, comme src/App.jsx:1523 et 2974).
- La CSP de la vitrine (site/netlify.toml:23). Elle bloquerait les photos Supabase, YouTube et les `blob:` des ordonnances.

### 1.4 Couleurs : un rôle par couleur

**Structure.** Fond `--cream` ; panneaux `--paper` ; cartes `--surface` avec bordure `--line` et ombre légère.
- Une carte blanche sur cream sans bordure ne fait que 1,15:1 : la bordure `--line` est obligatoire.

**Textes**

| Jeton | Rôle | Remplace |
|---|---|---|
| `--ink` | noms, prix | — |
| `--ink-soft` | texte secondaire | #444, #475569, #555, #666 |
| `--ink-mute` | métadonnées | #888, #999, #aaa, #94a3b8, #64748b |
| `--ink-faint` | décoratif seulement | — |

`--ink-mute` ne s'emploie jamais sur `--sand` (4,40:1).

**Action**
- Pétrole pour « + », « Ajouter », « + Panier » et les boutons primaires.
- Or + encre pour exactement trois rôles :
  - « Envoyer la commande » ;
  - les badges promo / remise ;
  - le compteur du panier (site/src/styles/digital.css:236, 283, 318).

**Statuts**, distincts mais réchauffés, toujours avec un libellé ou une icône (jamais la couleur seule) :

| Statut | Couleurs |
|---|---|
| En stock | `--ok` sur `--ok-bg` |
| Rupture | `--danger` sur `--danger-bg` ; badge plein `--danger` + blanc |
| Avertissement (palier à viser, note produit, péremption proche) | `--warn` sur `--warn-bg` |
| Info (contingentement en cours) | `--teal` sur `--mint` |
| Palier atteint | `--tier-bg` (or en teinte) + texte encre + bordure or |
| Justificatif / précommande | à arbitrer (§ 5) : sarcelle comme la vitrine, ou violet fonctionnel #5b21b6 sur #efe9f8 (7,56:1) |

**Couleurs de rayon** (SECTION_META src/App.jsx:25-41, plus les couleurs choisies dans l'admin : campagnes src/App.jsx:658-669, promos src/App.jsx:679-680, sections perso src/App.jsx:717-718)
- Elles ne pilotent plus la structure : en-têtes de tableau, boutons de quantité, prix, lettres A–Z.
- Elles restent comme repère : filet de 3 px sur l'en-tête de section, plus une pastille d'icône en teinte à 14 %.
- Une couleur saisie dans l'admin ne peut ainsi jamais produire un texte illisible.

**Bandeau « Commander pour une pharmacie »** (src/App.jsx:1826-1836) : il reste orange #9a3412 sur fond clair (6,89:1), pour ne pas être confondu avec une promo or (à valider).

### 1.5 Icônes et logo

**Jeu d'icônes**
- Créer `src/icons.jsx` : environ 20 SVG au trait de 2 px, arrondis, `currentColor`, comme les icônes de la vitrine (site/digital.html:184-195).
- Icônes nécessaires : recherche, panier, favori, imprimer, mes commandes, déconnexion, menu, fermer, actualiser, alerte, coche, cadenas, camion, document, cadeau, cible, lien, plus, moins, ainsi que la croix Elixir.

**Rayons connus.** Une table clé → SVG.

**Icônes saisies dans l'admin** (`dc.icons`, `ps.icon`, `cs.icon`, `camp.icon`, src/App.jsx:668, 677, 698-702, 718)
- Une icône surchargée par l'admin reste affichée telle quelle.
- Sinon, on affiche le SVG du rayon ou, à défaut, l'initiale dans une pastille menthe (à valider).

**Emojis à conserver**
- Le « ⚠ » de tête des messages flash, car il décide de leur couleur (`flashMsg.startsWith("⚠")`, src/App.jsx:1819).
- Les libellés d'onglets admin, car une regex retire le premier mot (src/AdminPanel.jsx:1110).

### 1.6 Contenus et typographie française (affichage seulement)

- `fmt` et `fmtPct` (src/App.jsx:42, 189-194) passent au format français : séparateur de milliers, espace insécable avant € et %, vrai signe moins (−).
  - Les données envoyées ne bougent pas (voir § 0).
- Apostrophes typographiques et « … » dans les libellés.
- Coquilles à corriger : « récommande » (src/App.jsx:1843) et « reessayer » (src/App.jsx:1201).
- Libellés périmés, à valider (§ 5) :
  - « Publication 6 / Février 2026 » : index.html:7-8, src/App.jsx:1530, 1759 et 1133 (ce dernier est le texte copié) ;
  - « Panier commun » (src/App.jsx:2786) et « Hors catalogue » ;
  - l'infobulle « depuis Odoo (~40s) » (src/App.jsx:1764).

---

## 2. Fondations techniques

### 2.1 Police
- `npm i @fontsource-variable/inter@5.3.0`, même version que site/package.json. Cela met à jour package-lock.json.
- Dans `src/styles/tokens.css`, ajouter `@import "@fontsource-variable/inter/wght.css";`.
- Supprimer index.html:9-11 (préconnexions et feuille Google Fonts).
- Remplacer les 6 `fontFamily: "'DM Sans'…"` par `"inherit"` (src/App.jsx:1520, 1657, 1708 ; src/AdminPanel.jsx:1018, 1059, 1887).
- Ajouter dans le CSS global `button, input, select, textarea { font-family: inherit; }`.
  - Surtout pas `font: inherit`, qui changerait la taille des boutons sans `fontSize`, y compris dans l'admin.
- Ne pas fixer de `font-size` sur `body` : c'est aujourd'hui 16 px par défaut, et des éléments en héritent.
- NODE_VERSION 18 (netlify.toml) reste compatible, car fontsource n'est que du CSS. Ne pas monter Vite.

### 2.2 `src/styles/tokens.css` (nouveau, importé en tête de src/main.jsx)

Pas de `color-mix()` : il est absent avant Safari 16.2, et des postes anciens existent (garde Safari < 16 en src/product-groups.js:14). Les valeurs sont donc précalculées.

```css
@import "@fontsource-variable/inter/wght.css";
:root{
  /* marque — copie de site/src/styles/base.css:10-25 */
  --cream:#f4efe4; --paper:#fbf8f2; --ink:#201917; --ink-soft:#4b4440;
  --teal:#285557; --teal-2:#3c7782; --petrol:#0f2d3d; --deep:#0a1d22;
  --mint:#d3e6df; --mint-2:#a9cdc2; --or:#b5904a; --or-clair:#d7bb7f;
  /* applicatif */
  --surface:#fff; --surface-2:#f1ece2; --sand:#ebe6dc;
  --line:rgba(32,25,23,.14); --line-soft:rgba(32,25,23,.08); --line-field:#949190;
  --ink-mute:#6f6863; --ink-faint:#b9b5b0;
  --petrol-field:#2b4553;            /* champ sur pétrole (paper 12 %) */
  --ok:#065f46; --ok-bg:#dce9e5; --danger:#b91c1c; --danger-bg:#f7e4e4;
  --warn:#92400e; --warn-bg:#f4e7dd; --tier-bg:#f0e9da; --orange-acting:#9a3412;
  --scrim:rgba(10,29,34,.55);
  --shadow-1:0 4px 14px -6px rgba(15,45,61,.25);
  --shadow-2:0 12px 40px -12px rgba(15,45,61,.28);
  --shadow-3:0 30px 60px -30px rgba(10,29,34,.5);
  --r-xs:6px; --r-s:10px; --r-m:16px; --r-l:28px; --r-pill:999px;
  --sans:"Inter Variable","Inter",system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  --ease:cubic-bezier(.22,1,.36,1);
}
body{margin:0;font-family:var(--sans);background:var(--cream);color:var(--ink);-webkit-font-smoothing:antialiased}
i,em{font-style:normal}
:focus-visible{outline:3px solid var(--focus,var(--teal-2)) !important;outline-offset:2px}
.ex-on-dark{--focus:var(--or-clair)}
::selection{background:var(--or);color:var(--ink)}
::placeholder{color:var(--ink-mute);opacity:1}
input[type=number]{-moz-appearance:textfield;appearance:textfield}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.num{font-variant-numeric:tabular-nums}
@keyframes fadeIn{from{opacity:0;transform:translate(-50%,-6px)}}   /* référencé mais jamais défini : src/App.jsx:1821 */
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
/* + les règles déplacées telles quelles de src/App.jsx:3013-3026 (mobile, impression, barre de défilement recolorée) */
/* + quelques classes là où l'inline ne suffit pas : .ex-tr (zébrure, :hover, [data-rupture]), .ex-btn:hover, .ex-card:hover */
```

Garder les valeurs de z-index existantes à l'identique : 50, 80, 90, 140, 150, 300, 301, 400, 1000, 2000, 9999, 10000 (src/App.jsx:1661-1742, 2706, 2771-2775, 3078). On documente cette pile, on ne la renumérote pas.

### 2.3 `src/theme.js` (nouveau, JS pur)

- `T` : `{ ink: "var(--ink)", petrol: "var(--petrol)", … }` pour les objets `style`.
- `alpha(hex, a)` : renvoie `rgba()` à partir d'un hex à 3 ou 6 chiffres, et renvoie l'entrée telle quelle sinon.
  - C'est le remède aux 22 concaténations « couleur + suffixe alpha » :
    - `cat.accent + "18"` (src/App.jsx:2200) ;
    - `${cat.accent}10` (src/App.jsx:2498) ;
    - `qtyBtnStyle` (src/App.jsx:3114-3119) ;
    - `${accent}08` (src/components/MLRecommendations.jsx:45) ;
    - `ps.color + "60"` (src/AdminPanel.jsx:1183)…
  - **Règle :** `alpha()` ne s'applique qu'à des hex (couleurs de l'admin), jamais à `T.x`.
- `tone(name)` renvoie `{bg, fg, border}` pour neutral, ok, danger, warn, info, promo, tier, labo, acting.
  - Les 8 tables de statuts (COND_COLORS src/App.jsx:176-181, PHASE_COLOR src/components/GroupOrders.jsx:379, STATUTS src/components/AdminLabJustif.jsx:7-16, ETATS src/components/AdminRelais.jsx:7-11…) ne gardent que le libellé et le ton.
- `ui` : `card`, `panel`, `h2`, `label`, `input`, `btn(kind, size)`, `pill(on)`, `badge(tone)`, `th`, `td`, `qtyBtn(kind)`, `qtyInput(active)`, `overlay`, `modal`.
  - Ils remplacent les copies locales : src/components/GroupOrders.jsx:11-16, src/components/WheelchairOrder.jsx:11-14, src/components/LabJustifOrder.jsx:12-15, src/AdminPanel.jsx:1886-1891, src/components/AdminAdd.jsx:4-6, src/components/AdminEdit.jsx:3-5, src/components/AdminCampaigns.jsx:3-5, src/components/AdminGroupPurchases.jsx:9-17.
- `fmtEur` / `fmtPct` : fonctions d'affichage uniques.
- Ne rien importer de theme.js dans src/gp-pricing.js. Ce fichier est importé par 6 fonctions Netlify (netlify/functions/_gp.js:6…) et doit rester du JS pur.

### 2.4 Migrer les styles inline sans tout réécrire

1. **Par zone, pas par fichier.** Chaque lot traite un intervalle de lignes connu.
2. **Table de correspondance hex → jeton**, appliquée à la main zone par zone :
   - les 40 couleurs les plus fréquentes couvrent 71 % des occurrences ;
   - cas ambigus à relire un par un : `#0f2d3d` en texte (titres → `T.petrol`, noms et prix → `T.ink`) et `#059669` (prix → `T.ink`, statut → `ok`).
3. **Indicateur d'avancement par zone :**
   - `grep -cE '#[0-9a-fA-F]{3,6}\b'` doit tendre vers 0, hors couleurs de données de l'admin et SECTION_META ;
   - `grep -c "outline: *['\"]none"` doit valoir 0, ou être couvert par `:focus-visible !important`.
4. **`className` seulement là où le CSS est indispensable :** `:hover` des lignes et cartes, `@media`, `::placeholder`, impression.
   - Préfixer : `ex-app` sur la racine client (src/App.jsx:1657), `ex-admin` sur la racine admin (src/AdminPanel.jsx:1059).
   - Toute règle propre au client se cible sous `.ex-app`, car l'admin est rendu dans l'arbre d'App et hérite du CSS global.
5. **Interdits :**
   - pas de « view-models » ni de clonage des produits avant `cat.products.indexOf(p)` (src/App.jsx:2211, 2485, 2436-2438) : sinon realIdx vaut −1 et les clés de panier se confondent ;
   - pas de hook ajouté après le `return` de l'identification (src/App.jsx:1540) ;
   - pas de changement de balise `<aside>` ou `<header>` (règles d'impression, src/App.jsx:3020-3023) ;
   - pas de changement de l'`id` `barre-alphabet`, des `lettre-*` ni du `ref={refEntete}` (src/App.jsx:1741, 2191).

---

## 3. Lots livrables indépendamment

Ordre conseillé : 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Le lot E s'insère à la carte.

Chaque lot fait l'objet d'une PR et d'un déploiement de prévisualisation. On fusionne un seul lot à la fois, puisque toute fusion sur master déploie en production.

| Lot | Objet | Charge indicative |
|---|---|---|
| 0 | Garde-fous et banc d'essai (rien de visible) | 1 j |
| 1 | Fondations : jetons, Inter, focus, favicon | 1 j |
| 2 | Coquille : en-tête, barre latérale, A–Z, toast, panier flottant | 1 à 1,5 j |
| 3 | Identification | 0,5 j |
| 4 | Catalogue : en-tête de section, filtres, tableau, grille, liste mobile | 2,5 à 3 j |
| 5 | Saisie de commande et recherche globale | 1 j |
| 6 | Panier et envoi (habillage seulement) | 1,5 j |
| 7 | Mes commandes, outils, fenêtres | 2 à 3 j |
| 8 | États vides, chargement, erreurs | 0,5 à 1 j |
| 9 | Passe mobile transversale | 1 j |
| 10 | Admin (léger) | 2 à 3 j |
| E | Ergonomie : comportements, sur validation | à la carte |

### Lot 0 — Garde-fous et banc d'essai

**Fichiers.** package.json (devDependencies), `eslint.config.js`, vite.config.js, `src/dev/essai-a-blanc.js`, src/main.jsx, netlify.toml, `scripts/verifie-zones.mjs`, `.gitignore`.

**Contenu**
- **ESLint** en développement uniquement : `no-undef`, `react/jsx-no-undef`, `react-hooks/rules-of-hooks` en erreur, et script `npm run lint`. Il attrape les références orphelines que `vite build` laisse passer, cause des plantages « Erreur Admin Panel ».
- **Banc local.** Un plugin Vite `apply: "serve"` :
  - sert des données figées pour les GET ;
  - répond « succès » à tous les POST et journalise leurs données dans `dev-fixtures/_envois/` ;
  - ne relaie jamais rien vers la production.
  - **GET couverts :** products-get, stock-get, config-get (`display_config`, `admin_promos`, `pharmacy_auth_mode`), campaign-get, odoo-catalog, supplier-code-refs, lab-justif?action=products, ml-recommend, group-order?fournisseur=ulabs, order-list?source=.
  - **Capture :** une seule fois, par des GET en production.
  - `dev-fixtures/` va dans `.gitignore`, car il contient des données de pharmacies.
- **Mode « essai à blanc ».** `src/dev/essai-a-blanc.js` est importé dynamiquement par main.jsx seulement si `import.meta.env.VITE_ESSAI_A_BLANC === "1"`.
  - Il enveloppe `window.fetch` : tout appel non-GET vers `/.netlify/functions/` reçoit une fausse réponse 200.
  - Il affiche un bandeau fixe « Aperçu : aucune commande ne part ».
  - Dans netlify.toml, ajouter `[context.deploy-preview.environment]` et `[context.branch-deploy.environment]` avec `VITE_ESSAI_A_BLANC = "1"`.
- **Performance, prérequis.** Sortir le compte à rebours U-Labs (src/App.jsx:278-299) dans un composant `<CompteARebours/>`, rendu au seul endroit où il sert (src/App.jsx:2103).
  - Aujourd'hui, toute l'application se redessine chaque seconde, OTC compris.
  - Le code est seulement déplacé : il ne sert nulle part ailleurs.
- **`scripts/verifie-zones.mjs`** compare entre master et la branche une empreinte des zones protégées (§ 4).

**Acceptation**
- `npm run lint` passe sans erreur.
- `npm run build` réussit, gen-cips compris.
- Taille du bundle notée (référence : 1 094 491 octets).
- `node scripts/test-gp-pricing.mjs` et `node scripts/test-quota.mjs` passent.
- En production, `grep -c "aucune commande ne part" dist/assets/*.js` donne 0.
- Le Profiler React ne montre plus de rendu d'App chaque seconde sur OTC.

**Risque.** Un oubli dans le bouchonnage des POST. Contre-mesure : liste exhaustive tirée de `grep -n "functions/" src`.

### Lot 1 — Fondations

**Fichiers**
- Nouveaux : `src/styles/tokens.css`, `src/theme.js`, `src/icons.jsx`.
- Modifiés : src/main.jsx (import), index.html (supprimer 9-11 ; titre et description selon § 5), public/favicon.svg (croix Elixir de site/public/favicon.svg), src/App.jsx (supprimer le `<style>` 3011-3027, déplacé tel quel ; `fontFamily: inherit` en 1520, 1657 et 1708), src/AdminPanel.jsx (1018, 1059, 1887).

**Changements visibles.** Seulement la police, les anneaux de focus, le favicon et la carte d'identification réduite par `box-sizing`.

**Acceptation**
- Aucune requête vers fonts.googleapis.com ; Inter servi depuis `/assets`.
- Anneau de focus visible à la tabulation sur :
  - la recherche globale (src/App.jsx:1776) ;
  - la recherche de section (src/App.jsx:2150) ;
  - les quantités en grille et en tableau (src/App.jsx:2394, 2623) ;
  - la Saisie (src/components/OrderEntry.jsx:115) ;
  - les champs d'identification.
- Données envoyées identiques sur le banc.

**Risque.** Inter est un peu plus large que DM Sans. Contrôler les troncatures :
- libellés de la barre latérale (src/App.jsx:1697) ;
- pastille pharmacie de 150 px (src/App.jsx:1781) ;
- noms sur les cartes.

Captures à 1024 et 1440 px.

### Lot 2 — Coquille et navigation

**Zones.** src/App.jsx:1656-1703 (barre latérale), 1740-1810 (en-tête), 1816-1824 (toast), 1878-1886 (titre des résultats, aujourd'hui en #f0f0f0 pensé pour le fond noir), 2190-2207 (A–Z), 2997-3009 (panier flottant). Aussi src/components/OrderEntry.jsx:139-156 (gris #aaa et #888 posés sur le fond noir).

Ces textes « sur fond noir » doivent passer en `--ink` / `--ink-mute` dans ce même lot, sinon ils deviennent illisibles sur cream.

**Rendu**

*En-tête*
- `--petrol` + classe `ex-on-dark`, logo croix `--or-clair` + ELIXIR, comme site/src/styles/digital.css:225-227.
- Recherche en pastille sur `--petrol-field`, texte paper.
- Boutons-icônes ronds de 36 px avec `aria-label` : Imprimer, Mes commandes, Déconnexion, Panier, ☰.
- Panier rempli : or + encre, avec compteur (site/src/styles/digital.css:236).

*Barre latérale*
- `--paper` + bordure `--line`, `<nav aria-label="Menus">` à l'intérieur de l'`<aside>`.
- Titres de groupe en eyebrow `--ink-mute` 11 px.
- Entrée active en pastille `--mint` + texte `--teal`, avec `aria-current="page"`.
- Icônes SVG, avec repli emoji pour les icônes saisies dans l'admin.

*Barre A–Z*
- Bande `--cream` (au lieu de #0c0d0e, src/App.jsx:2191), rail blanc en pastille avec `--shadow-1`.
- Lettres `--ink-soft` ; disponibles sur fond menthe ; indisponibles en `--ink-faint`.

*Toast*
- La condition `startsWith("⚠")` est conservée ; tons `warn` ou `ok` ; ajouter `role="status"` et `aria-live="polite"`.

*Panier flottant*
- Rond `--petrol`, compteur or, `zIndex` 290 (sous le voile du panier à 300).
- `paddingBottom` de `main` à 96 px quand il est affiché.

**Interdits.**
- `refEntete` sur l'élément collant ;
- la largeur 248 aux deux endroits (src/App.jsx:1657, 1664) ;
- le `onClick` des menus (`window.confirm` des commandes groupées, `navParClic`, src/App.jsx:1689) ;
- `handleLogout` ;
- `isMobile` / `isDesktop`.

**Acceptation**
- Le saut A–Z (OTC, NR) arrive juste sous l'en-tête et la barre reste collée.
- Retour/Avancer et `?menu=` fonctionnent.
- L'aperçu d'impression n'est pas dégradé.
- Pas de défilement horizontal à 375 px.
- Tous les textes de l'en-tête atteignent au moins 4,5:1.

### Lot 3 — Identification

**Zone.** src/App.jsx:1519-1654.

**Rendu**
- Fond `--deep` à plat avec la croix en filigrane : SVG statique, `aria-hidden`, sans animation.
- Carte `--paper`, rayon 28, padding 24 px sur mobile et 40 px au-delà.
- Champs `--line-field`, hauteur 44 ; bouton pastille pétrole de 48 px.
- Erreurs en ton `danger` avec `role="alert"`.

**Ajouts d'attributs seulement :** `autoComplete="email"`, `autoComplete="one-time-code"` et `inputMode="numeric"` sur le code.

**Interdits.** `autoFocus`, touche Entrée, étapes `obStep`, appels `pharmacy-*` (src/App.jsx:1166-1248), lien Asana.

**Acceptation**
- Les modes legacy et OTP fonctionnent de bout en bout sur le banc.
- À 375 px, au moins 300 px de largeur utile.

### Lot 4 — Catalogue (le cœur)

**Zones**
- en-tête de section : src/App.jsx:2014-2040 ;
- en-tête U-Labs : 2040-2140 ;
- recherche et filtres : 2141-2186 ;
- grille : 2208-2426 ;
- liste mobile : 2429-2466 ;
- tableau : 2468-2645 ;
- atomes `tdStyle` / `qtyBtnStyle` : 3110-3119 ;
- `CipCell` / `LienMenu` : 197-227 ;
- `TierBadge` : src/tiers.jsx:20-31 ;
- `COND_COLORS` : 176-181.

**Rendu**

*En-tête de section*
- Nouveau composant `src/components/ui/EnteteVue.jsx` : carte `--paper`, rayon 16.
- Filet de 3 px à la couleur du rayon (hex), pastille d'icône `alpha(color, .14)`.
- Titre 26/640 `--petrol`.
- Compteur « N références · N affichées » : `filteredProducts.length` est simplement lu, rien n'est calculé de nouveau.

*Filtres*
- Pastilles de 32 px avec `aria-pressed` ; inactives en sand + encre, actives en encre + paper (site/src/styles/components.css:15).

*Tableau*
- En-tête neutre (`--surface-2` + eyebrow `--ink-mute` 11 px, ou `--petrol` + paper : à valider) au lieu de `cat.color` (src/App.jsx:2471).
- Zébrure, survol et rupture par classe `.ex-tr` et attribut `data-rupture` ; on supprime `onMouseEnter`/`onMouseLeave` (src/App.jsx:2498-2499), ce qui corrige le fond rupture effacé.
- Chiffres alignés à droite en `.num`.
- Prix en encre 700, prix barré en `--ink-mute`, pourcentage en badge or + encre.
- Quantité : « − » sand, « + » pétrole, champ à bordure `--line-field`, puis 2 px `--teal` dès que la quantité est > 0. On garde les 24 px du bureau.

*Étoile favori*
- Elle reste un `<td onClick>`, pour ne pas ajouter d'arrêt de tabulation. Seul son visuel change.

*Grille*
- Carte blanche, rayon 16, `--line`, `--shadow-1` ; sélection par anneau de 2 px `--teal` (au lieu de src/App.jsx:2284-2285).
- Puits photo `--surface-2` ; badge rupture `danger`.
- Note produit en ton `warn` (aujourd'hui #e07b39 à 2,73:1).
- Prix 20/700 en encre.

*U-Labs*
- Piste de progression sand, remplissage sarcelle puis or au palier ; pastilles de conditions via `tone()`.
- Textes et calculs inchangés : « −33 % » et 0,67 restent en dur (src/App.jsx:2657, 2685).

**Interdits.**
- `realIdx` et les clés `${activeTab}-${realIdx}` ;
- les appels `getStepMin` / `setQty` ;
- l'`alert()` min/multiple (src/App.jsx:2361-2375) ;
- `syncGroup` ;
- les `id` `lettre-*`.

**Acceptation**
- Données envoyées identiques pour les paniers Expert, Stratège, OTC avec palier et U-Labs avec unités gratuites.
- En Stratège, à 1440 × 900 : au moins autant de lignes visibles qu'avant.
- 675 cartes OTC sans saccade au profilage.
- Plus aucun `accent + "xx"`.

**Risques.** Index du panier (R1) ; couleurs hex + alpha (R8) ; performance, d'où une seule ombre légère par carte, sans `filter` ni `backdrop-filter`.

### Lot 5 — Saisie de commande et recherche globale

**Zones.** src/components/OrderEntry.jsx (en entier) ; src/App.jsx:1878-1954.

**Rendu**
- `EnteteVue` au lieu du dégradé (src/components/OrderEntry.jsx:102-108).
- Recherche en pastille de 48 px avec focus visible.
- Résultats en lignes blanches de rayon 16 (site/src/styles/digital.css:292-295).
- Badges EN STOCK / RUPTURE / SUR COMMANDE avec texte, pas la couleur seule.
- « Ajouter » en pastille pétrole, au lieu de #10b981 (src/components/OrderEntry.jsx:227-229).
- Réserver la hauteur du bouton « Ajouter » pour que la ligne ne saute plus quand il apparaît.
- Sous 768 px, mise en pile par `@media` sur une classe : le composant ne reçoit pas `isMobile`.
- Recherche globale : titre en encre et bouton « + Panier » en pastille pétrole.

**Interdits.** `handleAdd` / `onAdd`, quantités locales, `maxCommande`, `toggleAlert`, pré-remplissage `?cip=` et `autoFocus` (src/components/OrderEntry.jsx:114).

**Acceptation**
- `?cip=<EAN>` ouvre la Saisie pré-remplie, avec le focus dans le champ.
- Une saisie de 10 lignes au clavier, chronométrée, prend au plus le même temps qu'avant.

### Lot 6 — Panier et envoi

**Zones.** src/App.jsx:2769-2994 ; src/components/JustifCartBlock.jsx ; `CrossSell` (src/components/MLRecommendations.jsx:6-75).

**Rendu**
- Tiroir blanc ; tuiles Lignes et Unités neutres en `.num`.
- Libellé de rayon de la ligne en eyebrow `--ink-mute`, et non plus dans la couleur du rayon.
- Encarts en tons `tier`, `danger`, `info` et labo.
- Total 20/700.
- « Envoyer la commande » en pastille or + encre de 48 px (au lieu de 2,77:1). Succès en `ok` + blanc (7,68:1), erreur en `danger` + blanc.
- « Imprimer » et « Copier » en boutons à filet ; « Vider le panier » en lien `danger`.

**Interdits.**
- `handleSend` et `sendOrder` (src/App.jsx:1281-1517) ;
- la condition `disabled` (src/App.jsx:2955) ;
- la balise `<aside>` ;
- l'ordre send-email → order-save → submit-order.

**Acceptation**
- Données envoyées identiques, `id` et date masqués.
- Un double-clic n'envoie qu'une commande.
- États envoi / succès / erreur visibles.
- Dépassement de contingentement et justificatif manquant désactivent toujours le bouton.
- Aperçu d'impression vérifié.

Une feuille d'impression dédiée au bon de commande est souhaitable, mais seulement après validation (§ 5).

### Lot 7 — Mes commandes, outils et fenêtres

**Zones**
- src/components/MyOrdersPanel.jsx ;
- src/components/ShortExpiry.jsx (aussi rendu dans l'admin, src/AdminPanel.jsx:1723) ;
- src/components/WheelchairOrder.jsx et ProductMedia.jsx ;
- src/components/LabJustifOrder.jsx ;
- src/components/GroupOrders.jsx (aussi dans l'admin : src/components/AdminGroupPurchases.jsx:756, 810) ;
- « Offres du moment » (src/App.jsx:1705-1738) ;
- PharmacyPicker (src/App.jsx:3058-3108) ;
- bandeau de saisie pour une pharmacie (src/App.jsx:1826-1836) ;
- suggestions ML (src/App.jsx:1838-1876 ; src/components/MLRecommendations.jsx:77-134).

**Rendu**
- `EnteteVue` pour les vues spéciales. Plus de dégradés (src/components/ShortExpiry.jsx:143-150, WheelchairOrder.jsx:74-80, GroupOrders.jsx:208-211, LabJustifOrder.jsx:155-160).
- L'orange de la péremption et le violet du justificatif ne restent que dans la pastille et le filet.
- Atomes `ui.*` à la place des copies locales.
- Palette privée du guide fauteuil (src/components/WheelchairOrder.jsx:222-286) passée sur les jetons : elle en est déjà très proche.
- Mes commandes : lignes comme site/src/styles/digital.css:337-343, statut « traitée » en menthe + sarcelle.
- Fenêtres : `--scrim`, rayon 28, `role="dialog"`, `aria-modal`, `aria-labelledby` (attributs seulement).

**Interdits.**
- focus de GroupOrders (src/components/GroupOrders.jsx:65-72, `data-gp-open`) ;
- `beforeunload` ;
- piège à focus de la Lightbox (src/components/ProductMedia.jsx:19-47) ;
- `commanderJustif` et ses identifiants en sessionStorage.

**Acceptation.** Captures des onglets admin « Péremptions » et « Groupements » dans le même lot, à cause des composants partagés.

### Lot 8 — États vides, chargement, erreurs

- **Chargement du catalogue.** `productsLoading` existe déjà (src/App.jsx:456) mais n'est jamais affiché. On affiche des lignes ou cartes squelettes statiques.
- **Liste filtrée vide.** Message « Aucun produit ne correspond » et bouton « Effacer les filtres ». Ce bouton remet à zéro des états d'affichage existants, sans logique de commande.
- **Erreur de rendu à la racine** (src/main.jsx:5-19). Message en français et « Recharger la page ». La pile d'erreur va dans la console, plus à l'écran.
- **Composant d'état vide unique**, réutilisé par src/components/OrderEntry.jsx:139-156, MyOrdersPanel, ShortExpiry et GroupOrders.
- **Erreurs réseau visibles.** Elles touchent les `catch` : voir le lot E.

### Lot 9 — Passe mobile transversale

Contrôle à 375, 768, 1023, 1024 et 1440 px.

- Cibles tactiles de 40 à 44 px sur mobile seulement : quantités de grille 32 → 40, A–Z 28 → 36.
- La barre collante U-Labs (src/App.jsx:2706) et le panier flottant ne se recouvrent pas.
- Péremption : le conteneur passe de `overflow:hidden` à `overflowX:auto`.
- Restreindre à `.ex-app` la règle tableaux 11 px des mobiles (src/App.jsx:3015-3017), qui touche aussi l'admin.

### Lot 10 — Admin (léger)

**Zones**
- coque : src/AdminPanel.jsx:1018-1038 et 1059-1117 ;
- atomes : src/AdminPanel.jsx:1886-1891 et leurs copies (AdminAdd.jsx:4-6, AdminEdit.jsx:3-5, AdminCampaigns.jsx:3-5, AdminGroupPurchases.jsx:9-17).

**Rendu**
- Neutres : #f1f5f9 → cream, blanc → surface, #888 / #aaa → `--ink-mute`.
- Onglet actif en menthe + sarcelle (src/AdminPanel.jsx:1108).
- Bouton `PB` en pétrole à plat.
- Tables de statuts passées à `tone()`.
- Rayons de 16 px au plus ; densité inchangée.

**Interdits.**
- publication de la config (src/AdminPanel.jsx:170-208, 381-428), `adminFetch`, `gpDirtyRef`, import xlsx ;
- la regex des libellés (src/AdminPanel.jsx:1110) : garder l'emoji de tête des `TABS`.

**Risque.** Références orphelines quand on extrait les atomes : ESLint `no-undef` est obligatoire. Ces fichiers changent souvent (26 commits en un mois) : lot à faire en dernier, sur une branche courte.

### Lot E — Ergonomie (comportements à valider un par un, un commit chacun)

- **E1.** Tableaux à colis : arrondi seulement à la sortie du champ. `onChange` garde la valeur brute (src/App.jsx:2616) ; `onBlur` reste inchangé (src/App.jsx:2617). Taper 12 avec un colis de 6 devient possible.
- **E2.** Ne plus ouvrir le panier après chaque ajout (src/App.jsx:861). À la place : message « Ajouté · Voir le panier » et compteur mis à jour.
  - Conséquence : le contingentement n'est plus rechargé à chaque ajout (src/App.jsx:960). Il l'est toujours avant l'envoi (src/App.jsx:1348).
- **E3.** Saisie au clavier :
  - Entrée dans la quantité = Ajouter ;
  - Entrée dans la recherche = focus sur la première quantité ;
  - flèches haut/bas entre les résultats ;
  - après un ajout, retour du focus dans la recherche, texte sélectionné.
- **E4.** Liste mobile : champ numérique entre « − » et « + » (src/App.jsx:2456-2462).
- **E5.** Fenêtres et tiroirs :
  - Échap pour fermer, focus à l'ouverture, retour au bouton déclencheur ;
  - `inert` sur le panier et le tiroir fermés (pris en charge à partir de Safari 15.5) ;
  - impression à retester.
- **E6.** Étoile favori atteignable au clavier : un arrêt de tabulation de plus par ligne, à arbitrer.
- **E7.** Erreurs réseau affichées : products-get, stock-get, config-get (src/App.jsx:458-509, 582-597).
- **E8.** Accès direct à la Saisie de commande dans l'en-tête mobile.

**Signalés mais hors refonte** (ne pas les corriger en douce) :
- un échec d'order-save est affiché comme une réussite (src/App.jsx:1405-1442) ;
- `isClient` reste vide, d'où « Nouveau client – RIB joint » (src/App.jsx:761) ;
- les champs `palier`, `prix`, `pb` ne sont pas transmis (src/App.jsx:628-644) ;
- remise U-Labs à 0,67 en dur (src/App.jsx:2657, 2685) ;
- `AbortSignal.timeout` non protégé pour Safari 15 (src/App.jsx:586, 952, 1450).

---

## 4. Vérifier sans casser la production

1. **Branche.** `refonte-charte` depuis master, à la racine elixir-pharma-repo (base `elixir-commande`, ../netlify.toml). Une PR par lot.
2. **Banc local** (lot 0) :
   - `npm run dev` avec les données figées ;
   - rejouer 10 paniers types : Expert, Stratège, OTC avec palier, U-Labs avec unités gratuites, ligne hors catalogue, fauteuil multi-CIP, justificatif, contingentement dépassé, saisie pour une pharmacie, Recommander ;
   - comparer les données de send-email, order-save, submit-order et group-order avec la référence, `id` et date masqués : aucun autre écart toléré.
3. **Prévisualisation Netlify** en « essai à blanc » (PR → deploy preview si activé, sinon `netlify link` puis `netlify deploy` en brouillon).
   - Les fonctions de l'aperçu utilisent les variables de production. Sans l'intercepteur, une commande partirait réellement dans le relais PharmaML.
   - Ne jamais cliquer « Publier la version de ce navigateur » dans l'admin pendant les tests (incident du 14/10).
4. **Garde-fous automatiques avant chaque fusion :**
   - `npm run lint`, `npm run build`, les deux scripts de test, taille du bundle (au plus la référence + 60 Ko hors fichiers de police) ;
   - `scripts/verifie-zones.mjs` : empreinte identique, entre master et la branche, des zones protégées :
     - src/App.jsx:43-64 (panier persistant, quota) ;
     - src/App.jsx:792-862 (`getStepMin`, `setQty`, `setItemQty`, `addItemToCart`) ;
     - src/App.jsx:864-1061 (`cartItems`, quota, signature du catalogue, synchronisation de l'URL) ;
     - src/App.jsx:1128-1155 (`handleCopy`) ;
     - src/App.jsx:1166-1279 (authentification) ;
     - src/App.jsx:1281-1517 (envoi) ;
     - src/App.jsx:2650-2704 (confirmation U-Labs) ;
     - src/tiers.jsx:1-19 ;
     - src/lab-justif-client.js, src/gp-pricing.js, src/product-groups.js et netlify/functions/** : aucune ligne modifiée ;
   - clés de stockage : la sortie triée de `grep -rhoE "(local|session)Storage\.(get|set|remove)Item\([^)]*" src` est identique avant et après ;
   - diff limité aux styles : relire à la main toute ligne modifiée qui ne relève pas de `style`, `className`, `aria-*`, `role`, `T.`, `ui.`, `tone(`, `alpha(` ou d'un import.
5. **Tests manuels par lot** : la checklist ci-dessous, au clavier seul, à 375 / 768 / 1024 / 1440 px, sur Chrome, Safari (un Safari 15 ou 16 si possible), Firefox (flèches des champs nombre) et Edge.
6. **Mise en ligne**
   - Fusion un lot à la fois, après 17 h en semaine (commandes de 9 h 30 à 17 h, site ouvert 7 j/7).
   - Retour arrière Netlify prêt (« Publish deploy » de la version précédente).
   - Le lendemain matin, contrôler l'onglet Relais et les commandes du jour dans l'admin.
   - Aucun changement de clés : un ancien onglet resté ouvert continue de fonctionner.

**Checklist manuelle minimale par lot**

| Lot | À vérifier |
|---|---|
| 1 | Police chargée en local ; focus visible partout ; identification ; un envoi sur le banc |
| 2 | `?menu=otc`, saut A–Z, Retour/Avancer, déconnexion, tiroir mobile, aperçu d'impression, toast « ⚠ » en ambre |
| 3 | Legacy : e-mail, Entrée, « Oui c'est moi ». OTP : code, erreur, « Changer d'e-mail ». E-mail inconnu → formulaire Asana |
| 4 | Saisie, arrondi et « par N » en tableau ; alerte min/multiple en grille ; filtres ; favoris ; copie du CIP ; badges palier et rupture ; U-Labs (compteurs, unités gratuites, POST group-order sur le banc seulement) |
| 5 | `?cip=` ; `?produit=` ; alerte de retour en stock ; produit sur justificatif ; « + Panier » dans et hors catalogue |
| 6 | Palier appliqué ; contingentement (« Ramener à N ») ; justificatif ; double-clic ; vidage après 3 s ; copier ; imprimer |
| 7 | Recommander ; Lightbox au clavier ; commandes groupées (retour, focus, protection avant de quitter) ; onglets admin partagés |
| 8-9 | Catalogue vide, filtres actifs, erreur forcée ; 375 px sans défilement horizontal |
| 10 | Connexion admin ; onglet mémorisé ; bandeau d'écart de config (sans publier) ; « Commander pour une pharmacie » |

---

## 5. À faire valider par la cliente avant de coder

1. **Maquette de deux écrans clés, avec données réelles.** Plutôt qu'une maquette abstraite, coder les lots 1 et 2 sur la branche, puis montrer avant/après côte à côte :
   - Sélection Stratège en tableau, panier ouvert, à 1440 px ;
   - Centrale OTC en grille avec A–Z, à 375 px.
   Faire valider la densité (lignes visibles) autant que l'apparence.
2. **Couleurs de rayon.** Les neutraliser (filet + pastille d'icône, recommandé) ou garder les en-têtes de tableau colorés.
3. **Or.** Le réserver à « Envoyer la commande », aux promos et au compteur du panier.
4. **En-tête.** Pétrole (recommandé, comme la maquette de la vitrine et l'admin, src/AdminPanel.jsx:1062) ou clair.
5. **Bandeau « Commander pour une pharmacie ».** Orange conservé (recommandé) ou or.
6. **Justificatif et précommande.** Sarcelle comme la vitrine, ou violet fonctionnel.
7. **Icônes.** SVG pour les rayons connus ; pour les icônes saisies dans l'admin, les garder ou passer à l'initiale.
8. **Libellés.**
   - « Publication 6 — Février 2026 » : passer à la publication 7 de juillet 2026 (site/BRIEF.md) ou à un libellé générique.
   - « Panier commun » → « Panier ».
   - « Hors catalogue ».
   - Sous-titre Expert « Abandon de marge fixe 30€/boîte » (src/App.jsx:26) : chiffres admis derrière connexion, mais interdits sur la vitrine.
   - Titre d'onglet.
9. **Lot E.** Oui ou non, point par point. Surtout E1 (arrondi en sortie de champ), E2 (plus d'ouverture forcée du panier) et E3 (Entrée pour ajouter).
10. **Impression.** Feuille dédiée au bon de commande, ou on garde l'impression de la page actuelle.
11. **Aucune animation de parcours ni 3D dans l'app.** Lien éventuel depuis l'écran d'identification vers la page de la vitrine qui présente le parcours.
12. **Organisation.**
    - Activer les deploy previews Netlify avec le mode essai à blanc.
    - Désigner un ou deux pharmaciens pilotes pour la mise en ligne.
    - Retenir le créneau de déploiement (après 17 h).
---

## 6. Décisions de la cliente (Zineb, 15/10/2026)

- En-tête : **pétrole** (#0f2d3d), croix Elixir en or clair.
- Couleurs de rayon : **discrètes** (filet + pastille d'icône) ; en-têtes de tableau neutres.
- Ergonomie (lot E) : **E1 oui** (arrondi au colis à la sortie du champ, plus à chaque frappe), **E2 oui** (un ajout depuis la Saisie n'ouvre plus le panier : message de confirmation), **E3 oui** (Entrée ajoute au panier dans la Saisie).
- Libellé « Publication 6 — Février 2026 » : **aucune mention** de publication nulle part (titre d'onglet, description, en-tête, texte copié…).
- Valeurs par défaut retenues pour les autres points du § 5 (à montrer à la cliente) : or réservé à « Envoyer la commande », aux promos et au compteur du panier ; bandeau « Commander pour une pharmacie » orange conservé ; justificatif/précommande en sarcelle ; icônes SVG pour les rayons connus, icônes de l'admin conservées ; aucune 3D dans l'app.
- Règle commune avec la vitrine : les chiffres de conditions sont admis derrière connexion (app), jamais sur elixirpharma.fr.

---

## 7. Banc d'essai (lot 0)

**Lancer**
1. Une fois, ou pour rafraîchir : `npm run banc:capture`. Ce ne sont que des lectures GET publiques de la production (aucun POST, aucun jeton). Le résultat, anonymisé (ni nom, ni e-mail, ni CIP de pharmacie), va dans `dev-fixtures/`, hors git : ne jamais l'ajouter.
2. `npm run dev`, ou la configuration `elixir-commande-banc` (port 8931). Le plugin Vite `scripts/banc/plugin.mjs` (`apply: "serve"`, absent de `vite build`) répond lui-même à `/.netlify/functions/*` : rien n'est relayé vers la production.
3. Identification : toute adresse e-mail donne « PHARMACIE DU BANC D'ESSAI » (CIP 9999999, remplaçable par `dev-fixtures/pharmacie.json`).
   - Mode code (celui de la production) : n'importe quel code à 6 chiffres ; `000000` affiche l'erreur.
   - Une adresse contenant « inconnu » mène au formulaire de nouvelle pharmacie.
   - `BANC_AUTH=legacy npm run dev` pour le mode historique (« Oui c'est moi »).
4. Admin (`#admin`) : identifiants quelconques. Les lectures propres à l'admin ne sont pas capturées et répondent 404 : c'est attendu.

**Ce que sert le banc**
- GET : les données figées ; à défaut, des données calculées à partir d'elles : recherche Odoo locale (catalogue curaté + recherches capturées), « Mes commandes » et suggestions de la pharmacie du banc, ventes croisées prises dans la même section.
- Autres méthodes : un succès fictif (`src/dev/reponses-fictives.js`, partagé avec l'essai à blanc). Une réponse sur mesure se pose dans `dev-fixtures/post/<fonction>[.<action>].json`, par exemple `quota-status.json` pour un contingentement dépassé.
- Chaque envoi est journalisé dans `dev-fixtures/_envois/<jour>/` : jamais de jeton, base64 des ordonnances résumé (longueur + empreinte).
- Variables : `BANC=0` (désactive), `BANC_AUTH`, `BANC_LATENCE=800` (états de chargement), `BANC_JOURNAL=<série>`.

**Comparer les données envoyées (acceptation des lots)**
- `BANC_JOURNAL=avant npm run dev`, puis le parcours ; on applique le lot ; `BANC_JOURNAL=apres npm run dev`, puis le même parcours.
- `node scripts/banc/compare-envois.mjs avant apres` compare send-email, order-save, submit-order, group-order et lab-justif, identifiants et dates masqués.

**Garde-fous**
- `npm run lint` : `no-undef`, `react/jsx-no-undef`, `react-hooks/rules-of-hooks` en erreur (src et outillage).
- `npm run zones` (`scripts/verifie-zones.mjs [--ref master]`) : zones protégées du § 4 retrouvées par leur contenu, fichiers intouchables, `netlify/functions/**`, clés de stockage. Un écart validé (lot E, mention de publication dans `handleCopy`…) s'inscrit dans `ECARTS_AUTORISES`, avec le lot et le motif.
- Aperçus Netlify : `VITE_ESSAI_A_BLANC = "1"` dans les contextes `deploy-preview` et `branch-deploy`, dans elixir-commande/netlify.toml (vraisemblablement le fichier lu par Netlify, puisque la base est elixir-commande et que ses crons tournent) et, par précaution, dans celui de la racine.
  - Bandeau « Aperçu : aucune commande ne part » ; tout appel non-GET aux fonctions reçoit une fausse réponse 200 ; connexion admin refusée.
  - Si le module ne se charge pas, l'aperçu ne démarre pas.
  - Contrôle sur un build de production : `grep -c "aucune commande ne part" dist/assets/*.js` donne 0.
- Taille du bundle après le lot 0 : 1 094 523 octets (référence 1 094 491).
- Après le lot 1 : JS 1 093 558 octets (le `<style>` d'App est passé dans `src/styles/tokens.css`), CSS 4 323 octets ; Inter : 7 fichiers dans `dist/assets`, seul le latin (48 Ko) est chargé en pratique. `src/theme.js` et `src/icons.jsx` ne pèsent rien tant qu'aucun lot ne les importe.

## 8. Fondations posées (lot 1)

- `src/styles/tokens.css` : jetons du § 2.2, Inter locale, focus (`!important`), `.ex-on-dark` (anneau or clair : posé sur l'en-tête), `.num`, `@keyframes fadeIn` (en `translate`, pour ne pas décaler le bloc d'AdminAdd), règles déplacées du `<style>` d'App. Racines repérées par `ex-app` (client) et `ex-admin` (admin) : l'admin est rendu dans l'arbre d'App, une règle « client seulement » doit donc exclure `.ex-admin`.
- `src/theme.js` : `T` (variables CSS), `R` (rayons), `alpha(hex, a)`, `tone(nom)` → `{bg, fg, border}`, `ui.*` (card, panel, h2, label, input, btn(kind, size) avec kind = primaire | or | ligne | doux | danger | lien et size = s | m | l, pill, badge(ton, plein), th, td, qtyBtn(moins | plus), qtyInput, overlay, modal), `fmtEur` / `fmtPct` (affichage seulement, pas encore branchés).
- `src/icons.jsx` : `<Icone nom taille epaisseur plein titre/>` (recherche, panier, favori, imprimer, commandes, deconnexion, menu, fermer, actualiser, alerte, coche, cadenas, camion, document, cadeau, cible, lien, copier, horloge, plus, moins) et `<CroixElixir/>` (`CROIX_ELIXIR`).
- Aucune mention de publication du catalogue (titre d'onglet « Elixir Pharma — Commande », description, en-tête, identification, texte copié) : écart de `handleCopy` inscrit dans `ECARTS_AUTORISES`.

## 9. Coquille posée (lot 2)

- **Fond de page** `--cream` (était #0c0d0e) ; textes qui supposaient le noir passés en encre : titre des résultats de la recherche globale, gris de la Saisie (`OrderEntry` : libellé du filtre, état vide, compteur de résultats).
- **En-tête** pétrole collant (`ex-on-dark`, rangée de 64 px sur ordinateur) : titre de vue + « Bon de commande · stocks » (paper 72 %, `--paper-mute`), recherche en pastille sur `--petrol-field` (champ partagé ordinateur / mobile : `rechercheGlobale`), pastille pharmacie (nom `clamp(110px, 10vw, 150px)`) avec Déconnexion, boutons ronds de 36 px avec `aria-label` (Imprimer, Mes commandes, menu). Panier : rond vide, **pastille or + encre avec le compteur** dès qu'il contient quelque chose. Sur mobile / tablette : menu + croix or clair, mot ELIXIR masqué sous 480 px.
- **Barre latérale** `--paper` dans un `<nav aria-label="Menus">` ; en tête, bloc de marque pétrole (croix or clair + ELIXIR) à la hauteur mesurée de l'en-tête (`hauteurEntete`) : une seule bande sur ordinateur. Titres de groupe en eyebrow `--ink-mute` 11 px ; entrée active en pastille menthe + sarcelle, `aria-current="page"`. Icônes SVG des rayons connus (`ICONES_RAYON`, src/icons.jsx) tant que l'icône d'origine n'a pas été changée dans l'admin ; sinon, et pour les menus promo et sections perso, l'emoji saisi reste affiché.
- **Barre A–Z** : bande cream, rail blanc en pastille (`--shadow-1`) ; ordinateur en 27 colonnes (une seule rangée dès 720 px), lettres disponibles sur menthe, indisponibles en `--ink-faint`. La couleur du rayon n'y apparaît plus.
- **Message flash** : région `role="status"` toujours présente ; ton `warn` si le message commence par « ⚠ », sinon `ok`.
- **Panier flottant** : rond pétrole de 60 px, compteur or + encre, `zIndex` 290 ; `main` réserve 96 px en bas tant qu'il est affiché. Sur mobile, il reste visible au-dessus du voile du tiroir de menu (140) : à revoir au lot 9 si gênant.
- **Impression** : en-tête et bloc de marque en encre sans fond (`@media print`, tokens.css) ; boutons toujours masqués.
- Classes ajoutées (survols impossibles en inline) : `.ex-menu`, `.ex-icone-entete`, `.ex-icone-pastille`, `.ex-panier-flottant`, `.ex-sans-barre`, `.ex-mot-elixir`, `.ex-marque`.
- Bundle après le lot 2 : JS 1 106 058 octets (lot 1 : 1 093 558 ; theme.js et icons.jsx désormais importés), CSS 5 115 octets.

## 10. Identification posée (lot 3)

- **Fond** `--deep` à plat ; croix Elixir en filigrane (`--mint-2` à 11 %, comme `.inscription__croix` de la vitrine), SVG statique sans animation, dans un calque `aria-hidden` qui la rogne lui-même : un `overflow:hidden` sur le fond en ferait un conteneur défilant, et le focus ou un `scrollIntoView` y décalerait la carte (constaté sur le banc avant correction).
- **Carte** `--paper`, rayon 28, padding 24 px sur mobile (< 768 px, `isMobile`) et 40 px au-delà ; marge latérale de 12 px sur mobile : 303 px utiles à 375 px. Marque comme la vitrine (croix sarcelle, ELIXIR / PHARMA), pastille menthe « Bon de commande ». Titres d'étape en `<h1>` 22/640 `--petrol`.
- **Champs** 44 px, filet `--line-field`, rayon 10, `<label htmlFor>` relié (`ident-email`, `ident-code`) ; 16 px de police sur mobile (Safari iOS ne zoome plus à la saisie). Attributs ajoutés : `autoComplete="email"`, `autoComplete="one-time-code"` (`inputMode="numeric"` existait déjà).
- **Boutons** pastille pétrole de 48 px (`.ex-btn-petrole`, survol sarcelle) ; « Retour » de la confirmation en filet (`.ex-btn-ligne`) ; « Oui, c'est moi » et « Retour » passent l'un sous l'autre sous 312 px utiles. Liens « Changer d'e-mail » / « Retour » en `--ink-soft` souligné, 40 px de haut.
- **Erreurs** en ton `danger` avec `role="alert"` et icône d'alerte (l'emoji ⚠️ est retiré, le texte du message est inchangé) ; étape de chargement en `role="status"`. Emojis 👋 ✓ 🏥 📞 ✅ 📋 ⏳ remplacés par les icônes au trait (ou retirés).
- Inchangés : étapes `obStep`, touche Entrée, `autoFocus`, gestionnaires `handleEmailLookup` / `handleConfirmPharmacy` / `handleVerifyOtp`, lien Asana (href, target, rel). Vérifié sur le banc : legacy (e-mail, Entrée, confirmation, « Retour », « Oui, c'est moi ») et OTP (code, `000000` → erreur, code incomplet, « Changer d'e-mail », e-mail inconnu → formulaire Asana) ; corps envoyés `{email}` / `{email, token}` identiques.
- Bundle après le lot 3 : JS 1 107 832 octets (lot 2 : 1 106 058), CSS 5 425 octets.
