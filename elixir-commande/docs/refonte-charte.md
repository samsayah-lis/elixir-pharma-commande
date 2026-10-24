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
  - **GET couverts :** products-get, stock-get, config-get (`display_config`, `admin_promos`, `pharmacy_auth_mode`), campaign-get, odoo-catalog, supplier-code-refs, lab-justif?action=products, ml-recommend, group-order?fournisseur=ulabs, order-list?source= (réponse calculée par le banc, plus capturée : la lecture exige un jeton depuis le correctif de sécurité du 19/10/2026).
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

**État (15/10/2026) :** E1, E2 et E3 validés par la cliente et faits, un commit chacun ; détail, avant / après et tests au § 11. E4 à E8 : non faits.

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
- Anti-copie (16/10/2026) : « fais en sorte que ce ne soit pas copiable », vitrine et site de commande. Côté site de commande : pharmacies seulement, l'admin copie librement → § 19.

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
- **Sessions simultanées (revue, § 20).** Le serveur 8931 peut servir plusieurs sessions à la fois : même stockage du navigateur pour une même origine (un panier modifié dans un autre onglet) et même dossier de journal (`dev-fixtures/_envois/<jour>/`, que `compare-envois.mjs` lit en entier). Pour une comparaison d'envois, lancer un serveur dédié avec `BANC_JOURNAL=<série>` sur un port libre ; pour un simple contrôle visuel, au minimum une origine à soi (`http://[::1]:8931` au lieu de `http://localhost:8931` : le serveur n'écoute que sur `::1`, `127.0.0.1` ne répond pas) et un panier vidé au départ.

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
- **Budget en octets (revue, § 20).** Les « kB » affichés par Vite comptent des caractères (les accents pèsent plusieurs octets) : ils sous-estiment d'environ 4 Ko. Les tailles se lisent avec `wc -c dist/assets/index-*.js dist/assets/index-*.css`, et `npm run zones` contrôle désormais le budget après `npm run build` : JS + CSS ≤ 1 154 491 octets (référence 1 094 491 + 60 000, polices exclues).
- **Admin chargé à la demande (16/10/2026, branche labo-otc, docs/labo-otc.md).** `AdminPanel` et ses outils ne sont plus dans le bundle des pharmacies : ils se chargent à l'ouverture de `#admin` (`AdminPanel-*.js`, environ 280 Ko). Le bundle passe d'environ 1 152 000 à 878 000 octets ; xlsx y reste (import LGO des commandes groupées). Le budget n'a pas été abaissé : à décider par la cliente.
- **package-lock.json (revue, § 20, écart accepté).** L'ajout d'ESLint (lot 0) a fait monter trois dépendances partagées avec la production : hasown 2.0.2 → 2.0.4, es-object-atoms 1.1.1 → 1.1.2, is-core-module 2.16.1 → 2.17.0 (embarquées par esbuild dans les fonctions via form-data, get-intrinsic et resolve). Pas de retour en arrière possible sans toucher à package.json : des paquets d'ESLint exigent ces versions (function.prototype.name : hasown ^2.0.4 ; array-includes, string.prototype.trim… : es-object-atoms ^1.1.2 ; resolve d'eslint-plugin-react : is-core-module ^2.16.2), npm n'en garde qu'une copie, et la commande `npm install hasown@2.0.2 …` les ajouterait aux dépendances directes. Versions correctives du même mainteneur ; contrôlé : form-data (envoi multipart), get-intrinsic et resolve.isCore chargent et répondent avec ces versions. Les sources de `netlify/functions/**` restent identiques à master.
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

## 11. Changements de comportement (lot E)

Seuls changements de logique de la refonte, validés par la cliente (§ 6) : E1, E2 et E3, un commit chacun. Les autres points du lot E (E4 à E8, et le reste de E3 : Entrée dans la recherche, flèches, retour du focus) ne sont pas faits.

### E1 — Arrondi au colis à la sortie du champ (tableaux)

- **Avant.** Dans les tableaux d'ordinateur (produits sans photo : Stratège, Master, Gamme Blanche…), `onChange` appelait `setQty`, qui arrondit au colis à chaque touche. Avec un colis de 6, « 1 » devenait 0 et le champ se vidait : impossible de taper 12. Constaté sur le banc avant le lot : 1, 2, 0 tapés un à un dans BETADINE DERMIQUE (colis 60) → champ vide, quantité 0.
- **Après.** Le champ est un petit composant, `ChampQteColis` (src/App.jsx, à côté de `CipCell`) :
  - la frappe reste libre et vit dans le champ (brouillon local) ;
  - l'arrondi se fait par `setQty`, inchangé, à la sortie du champ (Tab, clic ailleurs, clic sur − ou +) ou sur Entrée (le focus reste dans le champ) ;
  - le panier et `cart_quantities` ne reçoivent donc que des quantités arrondies : un texte non validé est abandonné si la page change ou se recharge ;
  - revue (§ 20) : une quantité changée de l'extérieur pendant la frappe l'emporte sur le brouillon (`useEffect` sur `valeur`). Cas visé : « − » ou « + » touché sans que le champ perde le focus (Safari sur iPad, où le tableau d'ordinateur s'affiche dès 768 px) ; avant, le champ gardait le texte tapé, puis l'écrasait à la sortie. La frappe ne change pas `valeur` : le reste de E1 est inchangé.
- **Inchangé.** `setQty` et sa règle (multiple le plus proche : 7 avec un colis de 24 → 0, 30 → 24), boutons − / +, mention « par N », style du champ (mêmes attributs).
- **Autres champs de quantité, vérifiés et laissés tels quels :**
  - grille (cartes) : déjà conforme. La frappe est libre ; à la sortie, l'alerte min / multiple remet à 0 (`handleBlur`). Cette alerte est conservée ;
  - liste mobile : pas de champ, seulement − / + au pas du colis ;
  - Saisie de commande : pas d'arrondi au colis (produits Odoo au pas de 1), seulement le plafond `maxCommande` des produits sur justificatif, appliqué à la frappe.
- **Tester.** Stratège à 1440 px : taper 4 puis 8 dans ADVILMED (colis 24) → le champ affiche 48 et le panier ne bouge pas ; Tab → 48 au panier. Taper 1, 2, 0 dans BETADINE (colis 60) puis Entrée → 120, focus dans le champ. Taper 30 dans DACUDOSES (colis 24) puis Tab → 24 ; taper 7 → 0. Taper 100 dans BETADINE SCRUB (colis 60) puis cliquer + → 120 puis 180. Taper 5 sans valider puis recharger la page → rien au panier. Revue : taper 100 dans BETADINE SCRUB, puis actionner + sans que le champ perde le focus (dans la page : `bouton.click()` pendant que le champ a le focus) → champ et panier à 60 ; à la sortie du champ, 60 (avant : 120, le + était écrasé).

### E2 — La Saisie de commande n'ouvre plus le panier

- **Avant.** `addItemToCart` faisait `setCartOpen(true)` : chaque ajout depuis la Saisie ouvrait le panier, dont le voile masquait la Saisie (il fallait le refermer avant l'ajout suivant). Cette ouverture rechargeait aussi le contingentement (`quota-status`, effet sur `cartOpen`) : l'encart « Contingenté » et le bandeau « Contingentement dépassé » apparaissaient tout de suite dans le panier.
- **Après.**
  - La Saisie appelle `ajouterDepuisSaisie` (src/App.jsx, juste après la zone protégée « panier calculé… »), qui appelle `addItemToCart(item, { ouvrirPanier: false })`. Le panier reste fermé.
  - Le message existant « ✓ N× Produit ajouté au panier » confirme l'ajout ; le compteur or de l'en-tête et le panier flottant se mettent à jour.
  - Produit sur justificatif labo : « … ajouté au panier · justificatif à joindre dans le panier » (calcul `needsJustif` sur le panier avec cet ajout).
  - **Contingentement, aucune alerte perdue :**
    - `quota-status` est rechargé après chaque ajout, soit autant d'appels qu'avant (un par ajout, puisque le panier s'ouvrait à chaque fois) ;
    - si le produit ajouté dépasse son reste, le message « ⚠ Contingentement dépassé : Produit (N au panier, reste R pour cette période) » s'affiche 6 s ;
    - le panier recharge toujours le contingentement à son ouverture et affiche l'encart et le bandeau ;
    - « Envoyer la commande » reste désactivé, et le contrôle avec les chiffres du moment juste avant l'envoi est inchangé.
  - Les autres appels d'`addItemToCart` ouvrent toujours le panier (option `ouvrirPanier`, vraie par défaut) : fauteuils, commande labo sur justificatif (pièces à joindre dans le panier), péremption courte, « + Panier » de la recherche globale pour un produit sur justificatif.
  - `flash` : une seule minuterie. Un nouveau message reste affiché sa durée entière : avant, la minuterie du message précédent pouvait effacer le suivant, par exemple l'alerte de contingentement arrivée juste après « ajouté ». La durée est un paramètre facultatif (3 s par défaut).
- **Zones protégées.** `addItemToCart` change de deux lignes : la signature, et l'ouverture devenue conditionnelle. `scripts/verifie-zones.mjs` les inscrit dans `ECARTS_AUTORISES` (lot E2). Le repère de la zone accepte l'ancienne et la nouvelle signature. Le reste de la zone est identique à master.
- **Tester.**
  1. Saisie : chercher « doliprane », mettre 3 et cliquer « Ajouter ». Attendu : panier fermé, message, compteur à jour, journal du banc avec `search-track` puis `quota-status`.
  2. Contingentement : poser `dev-fixtures/post/quota-status.json` avec un reste de 2 pour le CIP ajouté (CODOLIPRANE 3400927562396 sur le banc). Ajouter 1 : pas d'alerte. Ajouter 2 de plus : « ⚠ Contingentement dépassé … (3 au panier, reste 2 …) ». Ouvrir le panier : « Maximum 2 », « Ramener à 2 », bandeau, « Envoyer » désactivé. **Retirer la fixture ensuite.**
  3. Justificatif : chercher « ninlaro » et ajouter 1. Attendu : message « · justificatif à joindre dans le panier », panier fermé.

### E3 — Entrée ajoute au panier dans la Saisie

- **Avant.** Entrée était sans effet dans le champ de quantité de la Saisie : il fallait cliquer sur « Ajouter ».
- **Après.** Entrée dans ce champ vaut « Ajouter », quand la quantité est supérieure à 0 (src/components/OrderEntry.jsx, `onKeyDown`). C'est le même `handleAdd` : même ajout, même `search-track`, quantité remise à 0. Le focus reste dans le champ. Avec E2, le panier ne s'ouvre pas : on enchaîne au clavier.
  - Ignoré pendant une composition de saisie (IME).
  - Sans effet à 0.
  - Le plafond `maxCommande` reste appliqué à la frappe.
- **Hors périmètre** (plan, E3, non validés) : Entrée dans la recherche vers la première quantité, flèches entre les résultats, retour du focus dans la recherche après un ajout.
- **Tester.** Saisie à 1440 px puis à 375 px : chercher « doliprane », cliquer dans la quantité, taper 3, Entrée. Attendu : message, compteur +3, panier fermé, champ vidé avec le focus. Entrée sur un champ vide : rien.

### Vérifications du lot E (banc, 15/10/2026)

- `npm run lint`, `npm run build`, `node scripts/verifie-zones.mjs` (aucun écart, avec les deux écarts E2 inscrits), `node scripts/test-gp-pricing.mjs` (71 OK) et `node scripts/test-quota.mjs` (17 OK) passent après chaque commit.
- **Données envoyées identiques.** Même panier avant et après le lot : ADVILMED 48, BETADINE 120, CODOLIPRANE 3 (Saisie).
  - Avant le lot, il était saisi aux boutons et au clic, puisque la frappe était impossible. Après, il est tapé au clavier, avec Entrée dans la Saisie.
  - `node scripts/banc/compare-envois.mjs avant-lotE apres-lotE` : send-email, order-save et submit-order identiques, identifiants et dates masqués.
- **Journal des autres POST.**
  - `search-track` : identiques.
  - `quota-status` : 2 appels avant (ouverture du panier à l'ajout, puis avant l'envoi), 3 après (ajout, ouverture du panier, avant l'envoi). Lecture seule, corps identiques.
- **Signalé, hors lot, non corrigé.** Un ajout depuis la Saisie d'un produit du catalogue à colis ou à palier n'est pas arrondi : `addItemToCart` ajoute la quantité telle quelle. Constaté sur le banc : 3 DAFALGAN 1000 gélules ajoutées depuis la Saisie donnent `stratege-4 = 3`, pour un colis de 160.
  - Ce comportement est antérieur à la refonte, et le lot E ne le change pas.
  - Si l'on passe ensuite par le champ du tableau (focus puis sortie), `setQty` arrondit à 0, avant comme après.
  - Règle à faire trancher par la cliente : arrondir au colis à l'ajout, refuser, ou laisser.
- Bundle après le lot E : JS 1 108 586 octets (lot 3 : 1 107 832), CSS inchangé (5 425 octets).

## 12. Catalogue posé (lot 4)

- **En-tête de vue** : nouveau composant `src/components/ui/EnteteVue.jsx` (`EnteteVue` + `CompteurVue`), réutilisable par les vues spéciales (lots 5 et 7). Carte `--paper`, rayon 16, titre `<h1>` 26/640 `--petrol` (21 px sur mobile). La couleur du rayon (`catEffective.accent` : SECTION_META, campagne, menu promo, section perso) n'est plus qu'un **filet de 3 px** à gauche et une **pastille d'icône teintée à 14 %** (`alpha()` ; toute couleur non hex → pastille menthe). Icône SVG du rayon connu (`iconeMenu`, taille en paramètre), emoji conservé pour une icône changée dans l'admin, un menu promo ou une section perso. Compteur à droite : « 39 références », plus « N affichées » quand un filtre ou la recherche réduit la liste (`filteredProducts.length` lu, rien de recalculé) ; U-Labs : « Pharmacies participantes ». Marges et tailles mobiles par la classe `ex-entete-vue` (le composant ne reçoit pas `isMobile`).
- **Recherche de section** en pastille blanche de 40 px, loupe au trait, filet `--line-field` ; 16 px de police sur mobile (plus de zoom Safari iOS). **Filtres** en pastilles de 32 px avec `aria-pressed` : sable + encre, actif encre + paper (classe `ex-filtre`, la couleur suit `aria-pressed`) ; emojis remplacés par les icônes au trait (favori plein quand actif, coche, alerte, étiquette).
- **Tableau** : conteneur blanc, filet `--line`, rayon 16, `--shadow-1`. En-tête neutre (`ui.th` : `--surface-2` + eyebrow `--ink-mute` 11 px, 4,65:1), libellés sur deux lignes au besoin comme avant, alignés comme leurs colonnes (`alignCol` : textes à gauche, colis au centre, montants à droite). Chiffres tabulaires sur tout le tableau. Zébrure, survol et rupture par la classe `ex-tr` + `data-rupture` ; `onMouseEnter` / `onMouseLeave` supprimés : **le survol n'efface plus le fond rupture** (vérifié : ligne en rupture survolée `#f9e9e8`, puis `#fcf1f0`). Prix net encre 700 ; remise % en **badge or + encre** (`BadgeRemise`, « − » si vide) ; remise € en `--ink-soft` ; colis, carton, palier en `--ink-soft` ; sous-total encre 700 (tiret `--ink-faint` à 0). Étoile favori : toujours un `<td onClick>`, icône pleine sarcelle (5,06:1) ou contour `--line-field`, `title` ajouté. Notes en ton `warn`, rupture en badge `danger` avec icône.
- **Quantités** : « − » sable, « + » pétrole (survol sarcelle), classes `ex-qte-moins` / `ex-qte-plus`, `aria-label` « Diminuer / Augmenter la quantité » ; 24 px au tableau, 30 en liste mobile, 32 en grille. Champ `ui.qtyInput` : filet `--line-field`, puis 2 px sarcelle et graisse 700 dès qu'il y a une quantité ; `aria-label` « Quantité <produit> ». `ChampQteColis` (E1), `setQty`, `getStepMin`, `handleBlur` et l'`alert()` min / multiple inchangés.
- **Densité** (banc, 1440 × 900). Stratège : 39 lignes de 61 px, en-tête 48 px (avant : 38 × 62 + 1 × 65, en-tête 50) → au moins autant de lignes visibles. Expert : 31 lignes de 47 px + 3 lignes à deux badges (avant : 29 × 48, 1 × 47, 4 × 51 ; total 1 625 px contre 1 643). Deux réglages pour y arriver avec des cellules en 13 px : plus de `maxWidth` sur la désignation (la limite renvoyait nom + badges sur deux lignes) et badge de palier sous le prix (`TierBadge bloc`), pour laisser la largeur à la désignation. À 1024 px (barre latérale ouverte), le tableau Stratège défilait déjà en largeur avant le lot (1 009 px dans 722) : 982 px après, lignes un peu plus hautes (+4 % au total).
- **Grille** : carte blanche, rayon 16, filet `--line`, `--shadow-1`, `--shadow-2` au survol (souris seulement), **jamais de transform** ; produit au panier : anneau sarcelle de 2 px (`data-choisi`, classe `ex-carte`). Puits photo **blanc** (les photos Medipim sont sur fond blanc : un puits sable les encadrerait) ; sans photo, puits `--surface-2` et icône du rayon en `--ink-faint`. Badge rupture plein (`danger` + blanc), nom 600 encre, EAN en chasse fixe, note `warn`, « Obligatoire » en ton sarcelle (`COND_COLORS.oblig`), UG en ton `ok`. Prix barré `--ink-mute`, remise en badge or + encre, prix net 20/700 encre ; encart « prix effectif avec UG » en ton `ok` ; « min 6 · ×6 » en 11 px ; sous-total en pastille sable ; remise à zéro en petit bouton rond (`aria-label`). Hauteur médiane d'une carte OTC : 352 px (avant 349). Rendu d'un changement de quantité sur les 670 cartes OTC (serveur de développement, médiane de 10) : 61-62 ms contre 52-99 ms avant le lot.
- **Liste mobile** : en-tête neutre, lignes `ex-tr` (zébrure et rupture), prix net encre 700 + badge remise, boutons sable / pétrole de 30 px.
- **U-Labs** : compteurs de conditions en pastilles `ok` / `danger` (libellé et ✓ conservés), compte à rebours sur `--surface-2` avec icône horloge, piste de progression sable remplie en sarcelle puis **or au palier** (plus de dégradés), « −33 % atteint » en badge `tier`. En-têtes de groupe : carte paper avec filet à la couleur du groupe (plus de dégradé ni de texte blanc), compteur « réf. sélectionnées » en menthe + sarcelle, conditions en tons `COND_COLORS`. Textes et calculs inchangés ; la barre collante de confirmation (zone protégée pour ses calculs) n'est pas touchée.
- **Atomes** : `COND_COLORS` → tons `{ bg, fg, border }` (`neutral`, `ok`, `info`, `labo`), désormais utilisés par l'en-tête de groupe au lieu d'une copie en dur ; `tdStyle` = `ui.td` (13 px encre) ; `thStyle` (en-tête qui peut passer à la ligne) ; `qtyBtnStyle(kind, taille)` (plus de couleur du rayon : plus aucun `accent + "xx"` dans App.jsx) ; `CipCell` (12 px `--ink-mute`, bouton de copie de 18 px, coche `ok` une fois copié, `aria-label`) ; `LienMenu` (pastille discrète, icône lien / coche) ; `TierBadge` (ton `tier`, 11 px, pastille, option `bloc`, import de theme.js placé après la zone protégée d'`applyTiers`). Aussi visibles dans la Saisie et le fauteuil, qui utilisent `TierBadge`.
- **Remise affichée** : `fmtPct` d'App (catalogue seulement, jamais envoyé) passe au format français de theme.js : « −9,7 % » au lieu de « -9.70 % ». `fmt` (montants) n'est pas encore passé au format français : il sert aussi au panier et les composants en ont leurs copies ; à faire en une fois (lot 6 ou 9).
- **Vérifié** : lint, build, `verifie-zones` (aucun écart), test-gp-pricing (71 OK), test-quota (17 OK). Banc : même panier avant et après le lot (Expert 2 + 1 ; Stratège 48 tapés + Tab, 60 au palier, 160 ; OTC 30 DIFFU-K au palier + 2 ; U-Labs 12 avec 4 UG + 6), saisi aux boutons et au clavier puis envoyé : `compare-envois avant-lot4 apres-lot4` → 6 envois identiques (3 `group-order`, `send-email`, `order-save`, `submit-order`). Filtres (`aria-pressed`, « 6 affichées »), favori, copie du CIP et du lien de menu, alerte min / multiple de la grille (« Minimum 6 u. et multiple de 6 requis. »), pas de défilement horizontal à 375 et 768 px, aucune erreur en console.
- **Signalés, hors lot (non corrigés ; Master aligné depuis, § 20)** : Sélection Master affiche 7 cellules pour 6 colonnes (« ×palier » et « pb » ne sont pas transmis par products-get, § 3 « Signalés mais hors refonte ») : l'en-tête « PV » tombe sur « × » et la dernière colonne n'a pas d'en-tête ; les sections perso (`customSections`) n'affichent aucune cellule produit dans le tableau (seulement favori, quantité, sous-total).
- Bundle après le lot 4 : JS 1 109 439 octets (lot E : 1 108 586), CSS 7 097 octets (lot E : 5 425).

## 13. Saisie de commande et recherche globale posées (lot 5)

- **En-tête de la Saisie** : `EnteteVue` au lieu du bandeau en dégradé. Icône et couleur du menu passées par App (`iconeMenu`, `accent` : une icône changée dans l'admin reste affichée) ; titre, sous-titre et date de mise à jour inchangés. À droite, `CompteurVue` : « 27 811 références · 4 419 en stock », lus dans la réponse `odoo-catalog?count=1` déjà chargée (aucun appel ajouté).
- **Recherche** en pastille blanche de 48 px, loupe au trait, filet `--line-field`, `--shadow-1` ; plus de bordure recolorée en JS (`onFocus` / `onBlur` retirés) : anneau de focus global. 16 px de police sous 768 px (Safari iOS ne zoome plus). `autoFocus`, `initialQuery` (`?cip=` / `?produit=`) et bouton d'effacement (rond, `aria-label`) inchangés. Placeholder et « Recherche… » en typographie française.
- **Filtre** « En stock seulement » en pastille `ex-filtre` avec `aria-pressed`, comme les filtres du catalogue (était une case à cocher ; même état `stockOnly`). Nombre de résultats à droite, en `role="status"`.
- **Résultats** : lignes blanches de rayon 16 (`ex-saisie-ligne`, maquette de la vitrine `.resultats li`), grille « produit · prix · actions ». Nom 600 encre ; sous le nom, **statut écrit** (`BadgeStatut`, nouveau `src/components/ui/BadgeStatut.jsx`, partagé avec la recherche globale : « En stock » `ok`, « Sur commande » sarcelle `labo`, « Rupture » `danger`, toujours avec icône) puis CIP en chasse fixe `--ink-mute`. Produit sur justificatif : conditions du laboratoire en sarcelle. Ligne en rupture à plat sur `--paper` ; quantité saisie : anneau sarcelle de 2 px (`data-choisi`, comme les cartes). Prix : barré `--ink-mute`, remise en badge or + encre (`fmtPct` de theme.js : « −14,7 % »), prix net 18/700 encre, « Prix HT », palier (`TierBadge bloc`). Montants au format français (`fmtEur` : « 3 165,80 € ») — affichage seulement : `handleAdd`, le panier, `search-track` et `restock-alert` ne passent pas par ces fonctions.
- **Quantité et « Ajouter »** : « − » sable, « + » pétrole (classes `ex-qte-moins` / `ex-qte-plus`, `aria-label`), champ `ui.qtyInput` (sarcelle dès qu'il y a une quantité, `aria-label` « Quantité <produit> »). « Ajouter <montant> » en pastille pétrole (`ex-btn-petrole`), **toujours en place et invisible à 0** (`visibility: hidden` : ni focus ni lecture d'écran) : la ligne ne bouge plus quand il apparaît. Avant le lot, constaté sur le banc : deux clics au même endroit sur « + » ont mis le produit au panier (quantité 1) — la ligne s'était agrandie et le second clic était tombé sur « Ajouter », apparu entre-temps. Après le lot, les deux clics donnent 2, sans ajout.
- **Alerte de retour en stock** : bouton à filet « M'avertir du retour » (icône cloche, ajoutée à src/icons.jsx), puis ton `info` (menthe + sarcelle) « Alerte activée » ; même `toggleAlert`, même état d'attente (opacité 0,5).
- **Disposition** par classes (src/styles/tokens.css, « Saisie de commande et recherche globale ») : ≥ 1 200 px, « Ajouter » à droite de la quantité (colonne de 272 px réservée) ; 768-1 199 px (tablette, portable de 1 024 px avec barre latérale), « Ajouter » sous la quantité, le nom garde ~380 px ; < 768 px, nom et prix en haut, contrôles sur toute la largeur (boutons de 36 px, « Ajouter » en largeur restante). Le composant ne reçoit toujours pas `isMobile`.
- **Recherche globale** (en-tête) : carte blanche, lignes `ex-tr` (zébrure, survol, rupture teintée) disposées par `ex-resultat` ; même statut écrit que la Saisie, « Sur commande » pour un produit sur justificatif (au lieu de « Rupture »), CIP et « N dispo » ; prix au format français (étaient « 0.83 € » avec un point) ; « + Panier » en pastille pétrole avec `aria-label` « Ajouter <produit> au panier ». Sous 768 px : nom entier sur toute la largeur, puis prix et « + Panier ». « N produits » au lieu de « N produit(s) ». Gestionnaire du bouton repris octet pour octet (catalogue → `setQuantities`, justificatif → `addItemToCart`, sinon message « ⚠ … Utilisez la Saisie de commande »).
- **Inchangés** : `handleAdd`, `onAddToCart` / `ajouterDepuisSaisie` (E2), Entrée = Ajouter (E3), quantités locales, plafond `maxCommande`, `toggleAlert`, recherche et `search-track`, ordre de tabulation (recherche, effacer, filtre, puis « − », quantité, « + » par ligne ; « Ajouter » n'entre dans la tabulation qu'une fois visible).
- **Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK). Même parcours avant et après le lot (Saisie : CODOLIPRANE 3 au clavier + Entrée, alerte activée puis retirée, DOLIPRANE 1000 effervescent 2 aux boutons + « Ajouter » ; recherche globale : DAFALGAN du catalogue + « + Panier », DAFALGAN hors catalogue → message ; envoi) : `compare-envois avant-lot5 apres-lot5` → send-email, order-save, submit-order identiques ; `restock-alert` (POST puis DELETE), `search-track` (6) et `quota-status` (4) identiques. `?cip=3400939024479`, `?cip=doliprane` et `?produit=ninlaro` ouvrent la Saisie pré-remplie, focus dans la recherche ; NINLARO ajouté depuis la Saisie : panier fermé, message « justificatif à joindre ». Pas de défilement horizontal à 375, 768, 1 024 et 1 440 px ; hauteur des lignes : 80 px à 1 440 (100 avec palier), 94 à 1 024, 155 à 375 (environ 215 avant, avec débordement horizontal) ; aucune erreur en console.
- **Signalés, hors lot (non corrigés, lot 8)** : à l'ouverture par `?cip=` ou à chaque nouvelle recherche, « 0 résultat » et « Aucun produit trouvé » s'affichent environ 350 ms avant la réponse (le délai de frappe précède `setSearching(true)`) ; « Catalogue non synchronisé » s'affiche tant que `odoo-catalog?count=1` n'a pas répondu. Comportements antérieurs à la refonte.
- Bundle après le lot 5 : JS 1 110 654 octets (lot 4 : 1 109 439), CSS 9 420 octets (lot 4 : 7 097).

## 14. Panier et envoi posés (lot 6)

- **Tiroir** blanc (`--surface`), toujours un `<aside>` (z-index 301, voile 300 inchangés), désormais nommé (`aria-label="Panier"`). Voile `--scrim` à plat (plus de `backdrop-filter`), ombre portée seulement quand le panier est ouvert (fermé, elle débordait au bord de l'écran), glissement `.3s var(--ease)`. En-tête : « Panier » 20/640 pétrole avec icône (était « 🛒 Panier commun », recommandation du § 5 retenue), pharmacie en `--ink-soft`, fermeture en bouton rond de 36 px (`aria-label`). Tuiles **Lignes / Unités neutres** (`--surface-2`, eyebrow `--ink-mute` 4,65:1, chiffre 20/700 encre en `.num`) : plus de bleu ni de vert.
- **Lignes** en liste (`<ul>`/`<li>`, filet `--line-soft` entre deux lignes). Rayon en **eyebrow `--ink-mute`** précédé d'une pastille de 8 px à sa couleur (repère discret, décision § 6) ; nom 13/600 encre ; suppression en petit bouton rond `ex-btn-discret` (`title="Supprimer"` conservé, `aria-label` « Supprimer <produit> du panier », 32 px sur mobile). Quantité : « − » sable, « + » pétrole de 28 px (classes `ex-qte-*` du lot 4, `aria-label` avec le nom du produit), quantité, prix unitaire et « par N » en `.num` ; sous-total 14/700 encre. Unités gratuites en badge `ok` avec icône cadeau.
- **Encarts** (`encart(ton)`, rayon 10, texte 12 px, icône au trait) : palier appliqué en ton `tier` (coche), palier à viser en `warn` (cible) ; contingentement en `info` (menthe + sarcelle, cadenas), dépassé en `danger` avec « Maximum N… » et **« Ramener à N »** en pastille à filet danger (`ex-btn-danger-ligne`, pleine au survol) ; rupture en `danger` (alerte). Calculs (`q`, `over`, `room`, `max`) et `setItemQty` repris tels quels.
- **Justificatif** (`JustifCartBlock`) : ton `labo` sarcelle (plus de violet, décision § 6), titre avec icône document, textes en 11-12 px (étaient 10-10,5), cases de 16 px teintées sarcelle (`accent-color`), séparation avant la partie ordonnance, fichiers avec icône (horloge pendant le dépôt), retrait en bouton rond avec `aria-label`, « Joindre l'ordonnance… » à filet pointillé sarcelle, erreur en `danger` avec icône (`role="alert"` conservé). `onFile`, `onChange`, `uploadPrescription`, `fileRef` inchangés.
- **Produits complémentaires** (`CrossSellBanner`) : carte paper à filet (plus de dégradé vert ni d'italique), icône ampoule, pertinence en ton `info`, prix au format français, « Ajouter » en pastille pétrole (`ex-btn-petrole`, `aria-label`), « Masquer » en bouton rond. La prop `accent` (#10b981) n'est plus passée ni lue ; la recherche (`ml-recommend`), `dismissed` et `onAdd` sont inchangés.
- **Pied** : total « Total HT estimé » **20/700 encre `.num`**, mention en 11 px `--ink-mute` (était 10 px #aaa), livraison estimée en ton `ok` avec camion, récapitulatif pharmacie sur `--surface-2` (statut client en `ok` / `warn` avec icône, texte inchangé). Bandeaux `role="alert"` : contingentement dépassé en `danger` (cadenas), justificatif en `labo` (document) ; textes inchangés, emojis retirés.
- **« Envoyer la commande »** : pastille **or + encre de 48 px (5,82:1)**, survol or clair (9,32:1), classe `ex-btn-or` ; envoi en cours : or + encre, icône horloge, curseur d'attente, « Envoi en cours… » ; **succès `ok` + blanc (7,68:1)** « Commande envoyée ! » ; **erreur `danger` + blanc (6,47:1)** « Erreur – Réessayez » ; bloqué par le contingentement ou un justificatif : sable + `--ink-soft` (7,67:1), curseur interdit (au lieu d'une opacité de 0,6 sur blanc/bleu à 2,77:1). `onClick={handleSend}` et la condition `disabled` sont **les mêmes lignes**, octet pour octet.
- **Secondaires** : « Imprimer » et « Copier » côte à côte, pastilles à filet `--line-field` (3,13:1) de 40 px, `aria-label` / `title` « … le bon de commande » ; « Copié ! » en ton `ok`, « Erreur copie » en ton `danger` (était vert dans les deux cas) — chaînes de `handleCopy` inchangées, seul le « ✓ » de tête est remplacé par l'icône à l'affichage. « Vider le panier » en lien `danger` souligné avec icône corbeille (même `onClick`).
- **Montants** : `fmt` d'App passe au format français de theme.js (`fmtEur` : « 3 630,04 € », espace fine insécable, vrai signe moins), panier **et** catalogue, en une fois (prévu « lot 6 ou 9 », § 12). Affichage seulement : l'e-mail, le texte copié, `order-save`, `submit-order` gardent leurs `toFixed()`. Densité vérifiée : Stratège 39 × 61 px (inchangé), Expert 32 × 47 px + 2 lignes à badges (1 620 px contre 1 625 au lot 4). Copies restantes à harmoniser plus tard : `eur` de src/tiers.jsx (badges de palier), composants des lots 7 et 9.
- Icônes ajoutées à src/icons.jsx : `envoyer`, `corbeille`, `ampoule`. Classes ajoutées (survols impossibles en inline) : `.ex-btn-or`, `.ex-btn-danger-ligne`, `.ex-lien-danger`.
- **Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK). Même parcours avant et après le lot : panier Expert 2 (rupture), Stratège BETADINE 60 (palier appliqué, contingenté 240), Master CODOLIPRANE 3 (contingentement dépassé, réponse `quota-status` posée dans `dev-fixtures/post/` puis retirée), OTC DIFFU-K 2 (palier à viser), hors catalogue CODOLIPRANE gélules 1, NINLARO 1 (justificatif), LORVIQUA 1 ; « Ramener à 2 », « + » puis « − » sur ALECENSA, attestation NINLARO, puis **double clic** sur « Envoyer » : `compare-envois avant-lot6 apres-lot6` → send-email, order-save ×2, submit-order, lab-justif (submit) identiques ; un seul envoi pour le double clic ; panier vidé et refermé 3 s après le succès. Bouton désactivé (sable) tant que le contingentement est dépassé ou l'attestation manquante. États envoi / erreur forcés dans la page (fetch de send-email retardé puis rejeté, sans rien changer au code) : « Envoi en cours… » or + encre, « Erreur – Réessayez » danger + blanc pendant 5 s. Copie : « Copié ! » (ok) et « Erreur copie » (danger). Panier vide, unités gratuites U-Labs (« + 2 unités offertes → 8 livrées »). 375 px : tiroir plein écran, pas de défilement horizontal (seul le carrousel des produits complémentaires défile, dans son cadre). Impression (règles `@media print` appliquées à l'écran) : mêmes boîtes qu'avant le lot (barre latérale et panier pleine largeur, aucun bouton visible) ; les encarts ont désormais un filet, qui s'imprime même sans les fonds. Aucune erreur en console.
- Bundle après le lot 6 : JS 1 109,39 kB (affichage Vite ; lot 5 : 1 110,65 kB), CSS 9,86 kB (lot 5 : 9,42 kB).

## 15. Mes commandes, outils et fenêtres posés (lot 7)

- **Atomes partagés** (src/theme.js) : `ui.titreModal` (titre de fenêtre 20/640 pétrole), `ui.encart(ton)` (encart de statut 13 px aux tons de `tone()`), `ui.rond(taille)` (bouton rond à icône, fond par `ex-btn-discret`). Les copies locales `card`, `h2`, `btn`, `chip`, `input`, `label`, `qteInput` de GroupOrders, WheelchairOrder et LabJustifOrder pointent désormais sur `ui.*` ; les tables de statuts (`PHASE_COLOR` des commandes groupées, couleurs de `Msg`) passent à `tone()`. Icônes ajoutées à src/icons.jsx : `recommander` (celle de la maquette de la vitrine), `image`, `agrandir`, `lecture`, `precedent`, `suivant`, `fleche`, `retour`, `regle`, `calendrier`, `bulle`, `trombone`, `importer`. Classe ajoutée : `.ex-btn-visionneuse` (boutons de la visionneuse, sarcelle au survol).
- **Vues spéciales** : `EnteteVue` au lieu des bandeaux en dégradé pour le fauteuil (roulant et de transfert), la commande labo sur justificatif, la péremption courte et les commandes groupées (pharmacie seulement : l'admin garde son cadre). App passe l'icône et la couleur du menu (`iconeMenu`, `accent`), comme pour la Saisie ; l'orange de la péremption et le violet du justificatif ne restent que dans le filet et la pastille. Péremption courte : compteur « N références » à droite (était dans le sous-titre), bouton admin « Actualiser depuis Odoo » à filet sous le titre ; dans l'onglet admin « Péremptions » (sans icône ni couleur passées), horloge et orange d'origine par défaut.
- **Mes commandes** : fenêtre paper de rayon 28 sur `--scrim` (plus de flou), `role="dialog"`, `aria-modal`, `aria-labelledby`, fermeture en bouton rond avec `aria-label`. Une carte blanche par commande (`<ul>`/`<li>`, colonne `minmax(0, 1fr)` : pas de débordement à 375 px), total 16/700 encre, montants au format français (affichage seulement), statut écrit avec icône : « Traitée » menthe + sarcelle (maquette de la vitrine), « En attente » ton `warn`, « Commande labo » ton `labo`. Suivi du justificatif en encart sarcelle (icônes document / bulle au lieu de 📑 💬, refus en `danger`). « Recommander cette commande » en pastille à filet pétrole avec l'icône de la maquette ; « + N autres… » à sa gauche. Regroupement multi-CIP et `onReorder` inchangés.
- **Fenêtres** : « Offres du moment » (paper, rayon 28, `--scrim`, `role="dialog"` + `aria-labelledby`, titre avec icône cadeau ; chaque menu promo en carte blanche avec filet de 3 px et pastille d'icône à 14 % de sa couleur d'admin, `alpha()`, menthe si la couleur n'est pas hex ; date de fin en `warn` ; « Continuer vers le catalogue » à filet) ; choix de la pharmacie (saisie Elixir) : même fenêtre, recherche en pastille, « Rechercher » pétrole (sable quand indisponible), erreur en encart `danger` avec `role="alert"`, résultats en lignes `ex-tr`, badges « compte site » `ok` / « sans compte » neutre. zIndex 400 / 2000 / 10000 inchangés.
- **Bandeau « Commande saisie par Elixir »** : orange conservé (décision § 6) via `tone("acting")`, icône crayon au lieu de 🛠, alerte au trait pour « pas de CIP », boutons en pastilles (« Changer de pharmacie » à filet, « Terminer » plein).
- **Suggestions ML** : bloc « Suggestions de recommande » d'App (coquille « récommande » corrigée, § 1.6) et `ReorderSuggestion` en cartes paper à filet (plus de dégradés violet / bleu), vignettes blanches (`ex-carte`), quantités en encre `.num`, masquage en bouton rond avec `aria-label`, « Pré-remplir mon panier » en pastille pétrole. Calculs, `onApply`, clic sur vignette inchangés.
- **Fauteuil** : sélecteur de méthode segmenté (sable, segment actif pétrole, `aria-pressed`), champs `ui.input`, résultat en ton `ok` (ou `warn` hors gamme, avec icône), tailles en pastilles (`aria-pressed`, `aria-label` « 45,5 cm — En stock : 1 »), statut `BadgeStatut`, prix barré `--ink-mute` + remise en badge or + encre + prix net 20/700 encre, quantités `ex-qte-*`, « Ajouter au panier » pétrole (sable si indisponible). Guide de mesure : palette privée passée sur les jetons (encre, `--ink-soft`, sarcelle, menthe, ton `warn` pour « Erreurs fréquentes »), légende du schéma en Inter avec halo paper, coches au trait. `add()` et la charge envoyée au panier inchangés.
- **Photos (ProductMedia) et visionneuse** : carte `ui.card`, puits photo blanc, vignettes à filet (`aria-pressed`), bouton de lecture pétrole (plus de rouge YouTube), « Agrandir » avec icône. Visionneuse : fond `--deep` à 90 %, `ex-on-dark` (anneau or clair), boutons pétrole translucides avec icônes, compteur `.num`. Piège à focus, flèches, Échap et retour du focus **inchangés** (vérifié au clavier sur le banc : → passe à 2/4, Tab tourne entre Précédente / Suivante / Fermer, Échap ferme et rend le focus à « Agrandir la photo »).
- **Commande labo sur justificatif** : encart sarcelle « Ordonnance anonymisée » (cadenas) dans l'en-tête, laboratoire en sous-titre sarcelle, CIP en chasse fixe, « Ajouter à ma demande » et « + Panier » pétrole, « Retirer » à filet, suppression en bouton rond (`aria-label`), total 20/700, « Transmettre ma demande » pétrole de 48 px (sable quand une pièce manque ; icônes envoyer / actualiser / horloge au lieu de 📑 ↻), pièces manquantes en encart `warn`, erreur en encart `danger`. Frise de suivi en sarcelle (étape en cours foncée), refus `danger`, date prévue et commentaire avec icônes. Demande, verrou, `commanderJustif`, identifiants en sessionStorage inchangés.
- **Commandes groupées** (pharmacie et saisie admin) : liste en lignes `ex-tr` (les `onMouseEnter`/`onMouseLeave` qui réécrivaient le fond sont retirés), statuts d'opération par ton (`ouverte` ok, `a_venir` info, `cloturee` warn, `commandee` labo, `terminee` neutre ; retour à la ligne permis dans les colonnes étroites), « Commander » pétrole / « Modifier » à filet, « Voir » avec flèche. Fiche : nom 20/640 pétrole, phase en badge, conditions sur `--surface-2`, grille avec en-tête `ui.th`, précommande en sarcelle (était orange), champs de 36 px (sarcelle dès qu'il y a une quantité, `danger` hors colisage, `warn` plus en stock), « → N » en pastille `ex-btn-danger-ligne`, totaux `.num` (Total HT 16/700), messages par `ui.encart` avec icône. Objectif du groupe (aussi dans le suivi admin) : piste sable, sarcelle puis **or à l'objectif atteint**. « Confirmer » : même condition `disabled`, l'aspect grisé (opacité) devient sable. Focus de retour (`data-gp-open`), `beforeunload`, calculs et enregistrement inchangés.
- **Péremption courte** : en-tête de tableau neutre (`ui.th`) au lieu du bordeaux, lignes `ex-tr`, CIP 12 px `--ink-mute`, péremption en `danger` (≤ 30 j) ou `warn` avec « N j restants », remise en badge or + encre (admin : bouton badge, ton info + crayon quand une remise propre au produit est posée), prix remisé 15/700 encre, quantités `ex-qte-*` avec `aria-label`, « Ajouter » pétrole. Le conteneur passe de `overflow: hidden` à `overflowX: auto` (prévu au lot 9) : à 1 440 px le tableau tient sans défilement (cellules 10 × 10 px), sous cette largeur il défile dans son cadre au lieu d'être rogné. Recherche en pastille (16 px sur mobile par `ex-saisie-recherche`), tri en pastille.
- **Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK), build de production sans « aucune commande ne part ». Même parcours avant et après le lot (Recommander de la plus ancienne commande, fauteuil 42 cm → 45,5 cm ajouté, péremption 2 + 1, justificatif ALUNBRIG 180 ×1 et 90 ×2 avec attestations + LORVIQUA « + Panier » puis Transmettre, commande groupée Avène 12 / 7 → « → 12 » / 12 puis Confirmer, envoi du panier) : `compare-envois avant-lot7 apres-lot7` → lab-justif (commander), send-email, order-save, submit-order identiques ; corps `gp-pharmacy` (save) identiques. Opérations et demandes de justificatif servies par des réponses posées temporairement dans `dev-fixtures/post/` (et `get/` pour la saisie admin et le choix de pharmacie), retirées ensuite. Pas de défilement horizontal de page à 375 px (Mes commandes, fauteuil, justificatif, péremption, commandes groupées : les tableaux défilent dans leur cadre). Onglets admin « Péremptions », « Groupements » et « Commandes groupées » (saisie d'une participante + suivi avec l'objectif) affichés. Aucune erreur en console liée au lot.
- **Signalés, hors lot** : src/GroupOrderTab.jsx n'est importé nulle part (code mort, non retouché). À 375 px, les listes à tableau (péremption, opérations groupées) restent des tableaux défilants : une présentation en cartes relève du lot 9. Fenêtres : Échap, focus à l'ouverture et retour au déclencheur ne sont pas ajoutés (lot E5, non validé) ; seule la visionneuse les avait déjà.
- Bundle après le lot 7 : JS 1 117,94 kB (affichage Vite ; lot 6 : 1 109,39 kB), CSS 10,02 kB (lot 6 : 9,86 kB).

## 16. États vides, chargement et erreurs posés (lot 8)

- **Composants communs** (nouveau `src/components/ui/EtatVide.jsx`) : `EtatVide` (pastille ronde à icône au trait, menthe + sarcelle ; titre 16/640 pétrole, texte `--ink-soft`, actions en pastilles ; `erreur` → pastille `danger` et `role="alert"` ; `compact` dans une carte ; `cadre` = carte blanche), `ActionEtat` (pastille pétrole `ex-btn-petrole` pour l'action principale, à filet `ex-btn-ligne` sinon), `Chargement` (roue de 16 px + texte, `role="status"`), `Squelette` (bloc sable statique) et `SqueletteCatalogue` (cartes de grille, tableau d'ordinateur ou liste mobile, place du rail A–Z, lignes seules pour la recherche globale). Classes ajoutées (tokens.css) : `.ex-squelette`, `.ex-roue` (`@keyframes ex-roue`, roue **arrêtée** si l'utilisateur réduit les animations : la règle globale ne fait que raccourcir la durée, une rotation infinie y clignoterait). `CompteurVue` accepte `chargement` (bloc sable à la place du chiffre : la place est tenue). Squelettes **jamais animés** (jusqu'à 675 cartes OTC).
- **Catalogue** (App) : pendant le premier chargement des produits (`productsLoading`, jusqu'ici jamais affiché), squelettes aux dimensions de la vue (grille : 8 cartes, puits de 160 / 120 px, et place du rail A–Z en Centrale OTC / Autres NR ; tableau : 10 lignes ; liste mobile) et compteur en attente. Mesuré sur le banc (1 440 px, chargement retardé) : rail A–Z et grille OTC commencent **au même pixel** que les squelettes (335 / 395 px), tableau Stratège aussi (335 px) ; à 375 px, en-tête de même hauteur (titre sur deux lignes dans les deux cas). Aucun produit reçu (`products-get` en échec) : « Le catalogue n'a pas pu être chargé » + **« Réessayer »** (`fetchProducts`, le même chargement qu'à l'ouverture ; les `catch` ne sont pas touchés, E7 reste à valider). Menu sans produit : « Aucun produit dans ce menu pour le moment ». Liste filtrée vide : « Aucun produit ne correspond », « Filtres actifs : recherche « … » · favoris · en stock… » et **« Effacer les filtres »** (remet à zéro `search`, `showFavOnly`, `filterStock`, `filterRemise` : états d'affichage seulement).
- **Recherches** : Saisie de commande et recherche globale passent en « Recherche… » **dès la frappe** (`setSearching(true)` / `setGlobalSearching(true)` avant le délai de 350 ms ; Saisie ouverte par `?cip=` / `?produit=` : dès le premier affichage). Fini le « 0 résultat » / « Aucun produit trouvé » affiché ~350 ms avant la réponse (signalé au lot 5) : vérifié au banc, échantillonné toutes les 60 ms après l'ouverture par `?cip=`, jamais de « 0 résultat ». Première recherche : lignes squelettes (3 dans la Saisie, 4 dans la recherche globale, au lieu d'une carte vide). Aucun résultat : `EtatVide` ; avec « En stock seulement » actif, **« Afficher aussi les ruptures »** (même état `stockOnly` que la pastille). « Catalogue non synchronisé » ne s'affiche plus pendant la lecture de `odoo-catalog?count=1` (drapeau d'affichage `infoLue`, posé après la réponse ou l'échec ; la consigne « Saisissez au moins 2 caractères » reste affichée pendant ce temps) ; compteur « références » en attente.
- **Mes commandes** : « Chargement de vos commandes… » (roue) ; « 0 commande » n'est plus annoncé pendant la lecture ; aucune commande : `EtatVide`. **Péremption courte** : chargement en carte, compteur tenu ; erreur en `EtatVide` (`role="alert"`, même message, « Réessayer » = `fetchData`) ; liste vide (bouton de synchronisation inchangé, même `onClick`) ; **filtre sans résultat** (était : rien) « Aucun produit ne correspond » + « Effacer le filtre ». **Commandes groupées** (pharmacie) : en-tête de vue affiché dès le chargement (la page ne saute plus) ; aucune opération : `EtatVide` ; liste en échec : erreur + « Réessayer » (`loadList`, le même chargement) ; messages d'erreur `Msg` en `role="alert"` (les autres restent `status`) ; montants au format commun (`eur` = `fmtEur`, espace insécable avant %). **Justificatif** : chargements en roue, erreurs en encart `danger` `role="alert"` (« Mes demandes » : « Réessayer » = `chargerDemandes`, comme « Actualiser »), listes vides en `EtatVide` compact. **Fauteuil**, **produits complémentaires**, **suggestions** : chargements en roue.
- **Panier vide** : « Votre panier est vide » + consigne (était « Aucun produit sélectionné »). **U-Labs**, conditions non remplies : encart `danger` `role="alert"` avec icône (texte de `setUlabsError` inchangé, « ⚠️ » de tête retiré à l'affichage seulement ; la zone protégée de `confirmOrder` n'est pas touchée).
- **Erreur de rendu à la racine** (src/main.jsx) : écran cream, carte paper de rayon 28 (croix Elixir, pastille `danger`, « Une erreur est survenue », « Recharger la page » en pastille pétrole de 48 px, contact Elixir), `role="alert"` ; message, pile et composant vont dans la console (`componentDidCatch`), plus à l'écran. Vérifié en forçant une erreur temporaire dans la Saisie (retirée ensuite). **Erreur de l'admin** (« Erreur Admin Panel ») : même dessin, textes et bouton « Réinitialiser et recharger » inchangés (même `onClick`).
- **Coquilles** (§ 1.6) : « reessayer » → « réessayer » (message d'erreur de l'identification, zone protégée : écart inscrit dans `ECARTS_AUTORISES`, lot 8) ; « récommande » → « recommande » (commentaire ; le libellé visible l'était déjà au lot 7).
- **Formats français** (affichage seulement) : badge de palier (`TierBadge`, src/tiers.jsx) en `fmtEur` ; l'ancien `eur` du haut du fichier, en zone protégée, est laissé tel quel mais ne sert plus. Commandes groupées : voir plus haut. Les données envoyées gardent leurs `toFixed()`.
- **Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK), build de production sans « aucune commande ne part » ni trace de l'erreur d'essai. États forcés sans toucher au code livré : `dev-fixtures/get/products-get.json` mis de côté puis remis (catalogue en échec, puis « Réessayer » avec `fetch` retardé dans la page : squelettes), réponses 500 / 503 simulées dans la page pour la péremption et les commandes groupées (« Réessayer » ramène la liste), `order-list` et `odoo-catalog?expiry_months` retardés (roues). Saisie : ajout au clavier (Entrée) toujours fonctionnel (message, compteur). Pas de défilement horizontal à 375 px ; aucune erreur en console sur un parcours propre des menus.
- **Signalés, hors lot (non corrigés)** : un échec de `products-get` au démarrage **vide le panier** si celui-ci contient des lignes de catalogue (contrôle de signature : sections vides ≠ signature mémorisée → « ⚠ Catalogue mis à jour — panier réinitialisé par sécurité » ; reproduit sur le banc : Stratège 24 au panier, `products-get` en échec au rechargement → `cart_quantities` = `{}`, comportement antérieur à la refonte, zone protégée inchangée) — à traiter avec E7 (ne pas faire le contrôle sur un catalogue non reçu). Péremption courte : la liste vide propose « Synchroniser les péremptions Odoo » aussi aux pharmacies (appel réservé à l'admin, sans effet pour elles) ; « Ajouter » y apparaît encore sous la quantité (la ligne s'agrandit, comme la Saisie avant le lot 5). Échecs de `order-list` (Mes commandes) et de `odoo-catalog?count=1` toujours présentés comme « aucune commande » / « catalogue non synchronisé » (E7).
- Bundle après le lot 8 : JS 1 125,38 kB (affichage Vite ; lot 7 : 1 117,94 kB), CSS 10,35 kB (lot 7 : 10,02 kB).

## 17. Passe mobile posée (lot 9)

- **Contrôlé** à 375, 390, 768, 1 024 et 1 440 px, sur tous les écrans client (menus du catalogue en tableau, liste mobile et grille, Saisie, recherche globale, panier, Mes commandes, Péremption courte, fauteuils, justificatif, commandes groupées, U-Labs, tiroir de menu) : aucun défilement horizontal de page ; tableaux larges (Stratège sur tablette, grille de saisie des commandes groupées) défilant dans leur cadre.
- **Cibles tactiles (sous 768 px seulement ; ordinateur inchangé)**. Les tailles passent par `min-width` / `min-height` dans des classes (tokens.css, « Passe mobile ») : elles l'emportent sur le `width` / `height` inline sans toucher au dessin d'ordinateur.
  - « − » / « + » : **40 px** partout (`.ex-qte-moins` / `.ex-qte-plus` : grille 32 → 40, liste mobile 30 → 40, panier 28 → 40, Saisie 36 → 40, péremption 24 → 40, fauteuil 32 → 40) ; champs de quantité 40 px (`.ex-qte-champ` ; Saisie par `.ex-saisie-qte`). Grille : écart de 4 px (la ligne tient dans une carte de 172 px, deux colonnes à 375 px).
  - **44 px** pour l'action principale d'une ligne ou d'une fenêtre (`.ex-tactile`) : « Ajouter » de la Saisie (36 → 44), « + Panier » de la recherche globale (32 → 44), « Recommander cette commande », « Ajouter à ma demande » / « + Panier » du justificatif, « Ajouter au panier » et tailles du fauteuil. Tiroir de menu : entrées de 44 px, libellé sur deux lignes au plus (fini « Commande labo sur justif… »).
  - **A–Z** : lettres de 36 px (28 → 36), marges de la bande resserrées (bande collée de 58 px au lieu de 56). Saut vérifié : la carte « M » arrive 10 px sous la bande, elle-même collée sous l'en-tête (106 px).
  - Filtres en pastilles 32 → 36 px ; produits complémentaires du panier 30 / 28 → 36 px.
  - **Petits boutons à icône** (en-tête : menu, Mes commandes, panier, déconnexion, effacer la recherche ; fermer le tiroir, le panier, les fenêtres ; masquer les suggestions ; supprimer une ligne du panier ; remise à zéro d'une carte ; copier le CIP) : zone de toucher portée à **44 × 44 px** par un pseudo-élément centré (`.ex-cible`, pointeurs tactiles seulement), sans changer le dessin ni la mise en page. Pas sur les voisins trop proches (« 🛠 » et déconnexion de l'admin à 2 px d'écart, fichiers joints du justificatif, « Masquer » des produits complémentaires) : la zone chevaucherait l'autre bouton.
- **Champs sans zoom** : 16 px de police dans tous les champs du site client sous 768 px (recherche de l'en-tête 13 → 16, quantités, fauteuil, justificatif, commandes groupées…) : Safari iOS ne zoome plus à la saisie.
- **Barre collante U-Labs** (habillage seulement ; calculs, `confirmOrder`, `onClick` et `disabled` inchangés, zone protégée identique) : le panier flottant recouvrait « Confirmer ma commande » à 375 px (constaté avant le lot). Sur mobile, la barre prend la largeur en laissant 80 px à droite pour le panier flottant (6 px d'écart) et s'aligne sur son bas. Habillage aux jetons : pétrole comme l'en-tête (plus de #0d4f3c / #059669), « remise −33% incluse » en or clair, « Confirmer ma commande » en or + encre (l'envoi de la commande groupée, comme « Envoyer la commande »), envoi en cours avec horloge, « Commande confirmée ! » en `ok` + blanc ; ✅ / ✓ remplacés par les icônes.
- **Panier flottant masqué pendant que le tiroir de menu est ouvert** (mobile, tablette) : son zIndex 290 le laissait seul au-dessus du voile du menu (140), signalé au lot 2. zIndex inchangés.
- **Message flash** : sur mobile, sous l'en-tête collant (`top` = hauteur de l'en-tête + 8) au lieu de 20 px : il ne cache plus le compteur du panier qui vient de changer (ajout depuis la Saisie, E2). Ordinateur inchangé.
- **En-tête mobile** : le groupe de droite peut céder de la place ; le nom de la pharmacie va jusqu'à 140 px (au lieu de 80, qui n'affichaient que « PHARMACIE … ») et se raccourcit tout seul quand le compteur du panier grandit : plus de risque de pousser la page en largeur (calcul : 323 px de boutons au pire, compteur à 4 chiffres et 🛠 compris, pour 360 px).
- **Péremption courte sous 768 px : une carte par produit** (classe `ex-peremption`, CSS seulement, mêmes cellules et gestionnaires) : nom ; CIP et « Stock : N » ; péremption (date, jours restants) ; lots ; prix barré, remise, prix remisé ; quantité et « Ajouter » côte à côte (la carte ne grandit plus quand « Ajouter » apparaît). Le tableau de 9 colonnes défilait en largeur, quantité et « Ajouter » hors de l'écran (signalé au lot 7). Tablette et ordinateur : tableau inchangé.
- **Commandes groupées, liste des opérations sous 768 px : une carte par opération** (classe `ex-ops`) : nom, période, statut et « ma commande » à gauche, bouton à droite ; la ligne entière reste cliquable (même `onClick`). La grille de saisie d'une opération (produits × dates de livraison) reste un tableau défilant à colonne produit collée.
- **Règle des tableaux 11 px des mobiles restreinte au site client** (`.ex-app … :not(.ex-admin …)`) : l'admin garde ses tailles et marges (vérifié : onglet « Péremptions » de l'admin à 375 px, tableau inchangé, marges 10 px, boutons 24 px). Toutes les règles du lot excluent l'admin de la même façon.
- **Inchangés** : `isMobile` / `isDesktop`, largeur 248 de la barre latérale, `refEntete`, `id` `barre-alphabet` / `lettre-*`, balises `<aside>` / `<header>`, z-index, `onClick` des menus, gestionnaires de quantité, d'ajout et d'envoi, clés de stockage.
- **Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK), build de production sans « aucune commande ne part ». Mesures dans la page (375 px) : boutons et champs listés ci-dessus à leur taille, zone de toucher de `.ex-cible` effective (un toucher à 3 px du bord du bouton fermer l'atteint) ; barre U-Labs 10-285 px, panier flottant 291-351 px, encart « Conditions non remplies » au-dessus de la barre sans chevauchement (les états « Envoi… » et « Commande confirmée ! » ne s'atteignent pas sur le banc : la condition « 3 Parogencyl » n'a que 2 références dans les données figées) ; carte de péremption de même hauteur avec et sans « Ajouter » ; ligne de Saisie de même hauteur (163 px) avec et sans « Ajouter » ; Entrée dans la quantité de la Saisie : message sous l'en-tête, compteur +1, panier fermé. Liste des opérations groupées vue avec une réponse `gp-pharmacy` (list) posée temporairement dans `dev-fixtures/post/`, retirée ensuite. 1 024 et 1 440 px : menus 34 px, quantités de grille 32 px, A–Z 28 px (inchangés), barre U-Labs centrée (520 px). Aucune erreur en console.
- **Restent (hors lot)** : le panier flottant recouvre, le temps du défilement, le coin bas droit du contenu (« + Panier » d'une ligne, quantité d'une carte) — `main` réserve 96 px en bas pour la dernière ligne ; quantités du tableau d'ordinateur à 24 px sur tablette tactile (768-1 023 px), conformément au plan (mobile seulement) ; libellé « référence(s) » de la barre U-Labs.
- Bundle après le lot 9 : JS 1 126,69 kB (affichage Vite ; lot 8 : 1 125,38 kB), CSS 14,17 kB (lot 8 : 10,35 kB : sélecteurs `:not(.ex-admin *)` des règles mobiles).

## 18. Admin aligné (lot 10, léger)

- **Atomes communs** (src/theme.js, `adm`) : `adm.label` (12/700 `--ink-soft`), `adm.input` (13 px **sans hauteur minimale** : densité de l'admin conservée, filet `--line-field` 3,13:1 au lieu de #e2e8f0 1,2:1), `adm.btn` (bouton principal **pétrole à plat** en pastille, fini le dégradé), `adm.fermer` (rond de 32 px, fond `ex-btn-discret`). `LS` / `IS` / `PB` / `CB` d'AdminPanel et leurs copies d'AdminAdd, AdminEdit, AdminCampaigns, AdminGroupPurchases pointent dessus ; `OV` et `MO` (jamais utilisés) sont retirés. AdminGroupPurchases : `card`, `h3`, `btn(kind)` aux jetons (pastilles ; « ok » `--ok` + blanc 7,7:1 au lieu de #16a34a 3,3:1).
- **Coquille** : fond cream ; barre du haut pétrole `ex-on-dark` (anneau or clair), croix Elixir or clair au lieu de ⚙️, statistiques en `--paper-mute` ; « Commander pour une pharmacie » en ton `acting` (orange conservé, crayon au lieu de 🛠), « Retour au catalogue » sur `--petrol-field` (classes `.ex-admin-btn-acting` / `.ex-admin-btn-sombre`, survol). Onglets dans un `<nav aria-label>` paper + filet ; **actif menthe + sarcelle** (`aria-current="page"`, filet de 3 px sarcelle au lieu de #0ea5e9), survol `ex-menu`, compteurs `danger` + blanc ; emoji de tête des `TABS` et regex du libellé inchangés. Bandeau d'écart de configuration en ton `warn` (`danger` pour une erreur de publication) ; textes, boutons et gestionnaires inchangés. Message « enregistré » en `role="status"`. Connexion : carte paper rayon 16 sur cream, croix sarcelle, `<h1>`, fermeture en rond avec `aria-label`, erreur `role="alert"` avec icône ; `autoFocus`, Entrée et `handleLogin` inchangés.
- **Balayage des neutres** (styles inline seulement : `color`, `background`, `border*`) : gris de texte → `--ink-mute` / `--ink-soft` / `--ink-faint`, #f1f5f9 / #f0f2f5… → `--surface-2`, #f8fafc / #fafbfc → `--paper`, blanc → `--surface`, filets #e2e8f0 / #e8ecf0 / #ddd… → `--line` / `--line-soft`, #0f2d3d → `--petrol` ; verts, rouges et ambres de statut → `--ok` / `--danger` / `--warn` et leurs fonds (#059669 2,5-3,8:1 → `--ok` 7,7:1 ; #e07b39 2,7:1 et #d97706 → `--warn`) ; bleus d'information et d'action → famille sarcelle (encarts et sélection menthe + sarcelle, liens et « Sync » `--teal`, #0ea5e9 2,8:1 et #3b82f6 3,7:1 retirés). **11 px minimum** (126 tailles de 8 à 10,5 px → 11), graisses 800 → 700, rayons ≤ 16 (20 → 16), plus aucun dégradé. Hex restants : 74 sur 1 055, presque tous des **données** (couleurs par défaut des campagnes, menus promo et sections perso, `segColors`), gardées telles quelles, ou des violets fonctionnels (« Sync sélection », calcul ML, conditions de campagne, suivi « acceptée »).
- **Tables de statuts → `tone()`** : `STATUTS` (justificatifs), `ETATS` (relais), `ETATS` / `DECISIONS` / mode (Sanofi Pro), `STATUS` (commandes groupées : pastille en teinte avec filet au lieu de blanc sur couleur, 3,2:1 pour « Clôturée »). En cours / à envoyer → `labo`, envoyée / traitée → `ok`, à vérifier / à traiter à la main → `acting`, en attente → `warn`, erreurs → `danger`, ignorée / annulée → `neutral` ; libellés inchangés. Concaténations « couleur + suffixe » remplacées par `alpha()` (menus promo, segments ML).
- **Tableaux** : chiffres alignés (`.ex-admin table`), survol de ligne discret (sauf lignes `.ex-tr` des composants partagés), en-têtes en `--ink-mute`. **Focus** : anneau global (`:focus-visible !important`) partout, or clair dans la barre pétrole et les bandeaux pétrole (justificatifs, Sanofi Pro).
- **Téléphone** (< 768 px, CSS sous `.ex-admin` seulement) : la barre du haut ne déborde plus (libellés des deux boutons et statistiques masqués, libellés toujours lus par les lecteurs d'écran), onglets réduits à leur icône (60 px au lieu de 200), contenu en 16 × 12 px : 375 px sans défilement horizontal. L'admin reste un outil de bureau.
- **Garde-fou** : `scripts/verifie-zones.mjs` compare aussi les zones interdites du lot (`adminFetch` ; `publier` … `saveDisplayConfig` ; `chargerConfigServeur` … `handleLogin`) : identiques à master.
- **Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 11 zones, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK), build sans « aucune commande ne part ». Diff relu hors attributs de style (script : `style={…}`, `className`, `aria-*`, `role`, `title` retirés) : ne restent que imports, atomes, tables de statuts, couleurs des tuiles de chiffres, `onMouseEnter` / `onMouseLeave` de survol (valeurs de couleur seulement), icônes et commentaires. Parcours des 14 onglets à 1 440 px sans erreur (justificatifs, Sanofi Pro et commandes groupées vus avec des réponses posées temporairement dans `dev-fixtures/`, retirées ensuite) ; connexion (jeton mis de côté puis remis) et anneau de focus au clavier ; onglet mémorisé au rechargement ; bandeau d'écart provoqué par une copie locale modifiée de `display_config` puis rétablie, **sans publier** (aucun POST `config-get` au journal du banc) ; « Commander pour une pharmacie » ouvre le choix de la pharmacie ; site client inchangé.
- **Signalé, hors lot (non corrigé)** : « ＋ Nouvelle opération » (commandes groupées) fait planter l'admin, sur master aussi (commit 3f77b3d) : `prodJob?.id === form.id` est vrai quand `prodJob` vaut `null` et que la nouvelle opération n'a pas encore d'`id`, puis `prodJob.done` lève « Cannot read properties of null ». Correction d'une ligne proposée à part (`prodJob && prodJob.id === form.id`). Avertissement React « key » dans AdminAdd, antérieur au lot.
- Bundle après le lot 10 : JS 1 126,54 kB (lot 9 : 1 126,69 kB), CSS 15,04 kB (lot 9 : 14,17 kB).

## 19. Anti-copie (lot A)

Demande de la cliente (16/10/2026, § 6) : rendre la copie du catalogue, des prix et des conditions aussi malaisée que possible, sans gêner la commande ni l'accessibilité. Site client seulement : dans l'admin (`#admin`, `.ex-admin`, rendu dans l'arbre d'App) tout reste copiable. La vitrine est traitée à part (dépôt elixir-pharma-site).

**En place**
- **CSS** (src/styles/tokens.css, section « Anti-copie ») : `.ex-app` en `user-select: none` et `-webkit-touch-callout: none` (pas de menu « Copier / Enregistrer » au toucher long sur iOS). Restent sélectionnables :
  - les champs (`input`, `textarea`, `select`, `[contenteditable]`), avec un `-webkit-user-select: text` explicite, sinon Safari iOS n'y laisse plus saisir ;
  - les zones `.ex-selectionnable` : les n° de commande des demandes sur justificatif (src/components/LabJustifOrder.jsx : confirmation d'envoi et « Mes demandes ») ; depuis la revue (§ 20), les outils internes d'Elixir rendus dans `.ex-app` — la fenêtre « Commander pour une pharmacie » (`PharmacyPicker` : nom, ville, CIP, téléphone des pharmacies, même ouverte depuis l'admin) et le texte du bandeau « Commande saisie par Elixir » (CIP et e-mail de la pharmacie servie) — et un CIP dont la copie par le bouton a échoué (`CipCell`) ;
  - tout `.ex-admin` (« text », hérité par ses descendants).
  Liens : toucher long permis. Photos du site client : `-webkit-user-drag: none` (Chrome, Safari) et `draggable={false}` (Firefox) sur les 9 `<img>` client (grille du catalogue, ProductMedia et sa visionneuse, MLRecommendations, WheelchairOrder) ; les images de l'admin ne sont pas touchées (`:not(.ex-admin *)`).
- **Événements** (src/anticopie.js, installé une fois par src/main.jsx, essai à blanc compris) : écouteurs en phase de capture sur `window`, qui ne font qu'un `preventDefault` (aucun `stopPropagation` : les gestionnaires de l'app tournent comme avant).
  - `copy` / `cut` : sans effet si la sélection touche le contenu protégé ; permis quand le focus est dans un champ, dans `.ex-selectionnable`, hors du site client.
  - `contextmenu` : bloqué sur les photos (même dans un lien) et sur le contenu ; permis dans les champs (coller dans la recherche) et sur les liens.
  - `dragstart` : bloqué sur le contenu et les photos ; permis depuis un champ et sur un élément `draggable="true"` (aucun côté client aujourd'hui).
  - Clavier : Ctrl/Cmd+A sans effet hors des champs (dans un champ, il sélectionne le texte du champ) ; Ctrl/Cmd+S (enregistrer la page) et Ctrl/Cmd+U, Cmd+Option+U (code source) sans effet. Lettre lue selon la disposition (AZERTY : `e.key`), position de la touche seulement pour Cmd+Option sur Mac ; Ctrl+Alt (AltGr de Windows et Linux) jamais intercepté : la saisie de caractères n'est pas touchée.
  - « Admin affiché » = `#admin` ou un `.ex-admin` présent (connexion ou back-office) : plus aucune protection.
- **Moteurs et IA** : `<meta name="robots" content="noindex, nofollow, noarchive, noai, noimageai">` (index.html), public/robots.txt (revue, § 20 : `Disallow: /` pour les robots d'IA connus — GPTBot, ClaudeBot, CCBot, Google-Extended… ; pour les autres, seul `/.netlify/` est fermé, afin que les moteurs lisent le `noindex`), en-tête `X-Robots-Tag` de même valeur pour `/*` dans elixir-commande/netlify.toml et, par précaution comme l'essai à blanc, dans celui de la racine. Pas de CSP (§ 1.3).

**Jamais bloqués** : l'impression (Ctrl/Cmd+P, bouton Imprimer, `window.print`) ; Tab et les autres raccourcis ; les lecteurs d'écran (ils lisent l'arbre d'accessibilité, que `user-select` ne change pas) ; les boutons « Copier » (CIP, bon de commande du panier, lien du menu pour l'admin) : `navigator.clipboard.writeText` ne déclenche aucun événement `copy` ; coller, couper, copier dans les champs. Pas de détection des outils de développement. L'écran d'identification et l'écran d'erreur (sans `.ex-app`, ni catalogue ni prix) restent sélectionnables ; seuls Ctrl/Cmd+S et U y sont sans effet.

**Limites (à dire à la cliente)** : c'est un frein à la copie facile, pas une protection absolue.
- Capture d'écran, photo de l'écran : impossibles à empêcher.
- Impression : conservée (outil de travail) ; « Enregistrer au format PDF » donne un PDF dont le texte se copie.
- Code et données : le JavaScript et les réponses des fonctions (`products-get`, `stock-get`…) restent lisibles par les outils de développement du navigateur ; désactiver le CSS ou le JavaScript rend la sélection possible ; « Enregistrer la page sous… » par le menu du navigateur (seul le raccourci est neutralisé) enregistre la page affichée, prix compris.
- Robots : `robots.txt` et les balises ne valent que pour les robots qui les respectent ; `noai` / `noimageai` ne sont pas standard (respectées par certains seulement). Depuis la revue (§ 20), les moteurs peuvent lire la page d'accueil (l'identification) pour y trouver le `noindex` et retirer l'adresse de leurs résultats ; avec l'ancien `Disallow: /` pour tous, ils ne la lisaient pas, et une adresse citée ailleurs pouvait rester listée sans contenu. Un robot d'IA qui ne se déclare pas sous son nom n'est arrêté que par les balises. À confirmer par la cliente (fermer aussi aux moteurs = revenir à `Disallow: /` pour tous).
- Accessibilité : les outils qui partent d'une sélection (« Énoncer la sélection » de macOS, extensions de synthèse vocale) et « Traduire » au clic droit ne marchent plus sur le contenu ; zoom, contraste, clavier et lecteurs d'écran ne sont pas touchés.
- CIP : non sélectionnables (une sélection balayée donnerait la liste des CIP du catalogue) ; le bouton de copie du CIP reste, un CIP à la fois — depuis la revue (§ 20), aussi dans la Saisie de commande (hors tabulation) et la recherche globale. Copie refusée par le navigateur (permission, contexte non sécurisé, navigateur embarqué) : « Copie impossible » et ce CIP-là devient sélectionnable.
- Saisie Elixir (« Commander pour une pharmacie ») : c'est l'écran client, la protection s'y applique au catalogue ; le choix de la pharmacie et le bandeau de saisie restent sélectionnables (revue, § 20) ; l'admin (`#admin`) reste libre.
- Retrait : supprimer l'appel `installeAntiCopie()` de src/main.jsx et la section « Anti-copie » de tokens.css.

**Vérifié (banc, 16/10/2026)** : lint, build, `verifie-zones` (aucun écart, 86 appels de stockage identiques), test-gp-pricing (71 OK), test-quota (17 OK), build de production sans « aucune commande ne part » ; `dist/robots.txt` et la balise robots présents dans `dist/index.html`.
- Navigateur intégré, 1 440 px : `user-select` none sur le contenu, text dans la recherche ; triple clic et glisser sur des noms de produits → sélection vide ; Cmd+A (page), Cmd+S, Cmd+Option+U → `defaultPrevented` ; Ctrl/Cmd+P et Tab non interceptés (focus visible, anneau 3 px) ; Cmd+A dans la recherche non intercepté ; `copy` / `cut` / `contextmenu` bloqués sur le contenu, permis dans un champ et dans un `.ex-selectionnable` (sélectionnable, copie permise) ; menu contextuel et `dragstart` bloqués sur les 609 photos OTC (toutes en `draggable="false"`, `-webkit-user-drag: none`) ; AltGr+S non intercepté. Admin (`#admin`) : texte en `user-select: text`, copie, menu, Ctrl+A/S/U non interceptés, image d'admin glissable. 375 px : recherche en 16 px, saisie normale, pas de défilement horizontal. Aucune erreur en console après rechargement (le refus d'écriture du presse-papiers de ce navigateur intégré existe aussi sans le module).
- Presse-papiers réel (Chrome sans interface, profil isolé, permissions accordées ; presse-papiers du système inchangé) : identification par code de bout en bout ; bouton « Copier le CIP » → le CIP est dans le presse-papiers et l'état « CIP copié » s'affiche ; « Copier » du panier → bon de commande (10 lignes, « BON DE COMMANDE — ELIXIR PHARMA ») ; Cmd+C sur un titre rendu sélectionnable de force → presse-papiers inchangé ; Cmd+A puis Cmd+C dans la recherche → « betadine » copié ; Cmd+A hors champ → rien de sélectionné ; dans l'admin, Cmd+C copie le texte sélectionné.
- Bundle après le lot A : JS 1 128,31 kB (lot 10 : 1 126,54 kB), CSS 15,46 kB (lot 10 : 15,04 kB).

## 20. Corrections de la revue (16/10/2026)

Trois relectures contradictoires de la branche (invariants, rendu, production) ont relevé 23 points. Chacun a été vérifié sur le banc avant d'être corrigé. Seul E1 touche à un comportement, et seulement dans un cas limite. Le reste ne change que l'affichage, l'accessibilité, l'outillage ou la documentation. Les zones protégées sont identiques à master.

**Corrigés**

| Point | Correction |
|---|---|
| Sélection Master : 7 cellules pour 6 en-têtes, prix net sous « QTÉ » (majeur, présent en production) | En-tête « Palier » ajouté (`SECTION_META.master.columns`, centré). Le palier vide affiche « – » au lieu d'un « × » seul. Le contenu ne change pas : palier et PB ne sont toujours pas transmis (§ 3), donc ces colonnes affichent « – ». Supprimer la colonne ou renommer « PV » en « PB » reste à trancher par la cliente. Nouveau contrôle dans `npm run zones` : autant d'en-têtes que de cellules pour chaque menu en tableau (il signale la ligne de master). |
| Panier fermé et tiroir de menu fermé dans l'ordre de tabulation (majeur) | `visibility: hidden` une fois sortis de l'écran (transition retardée de 0,3 s / 0,25 s), visibles dès l'ouverture. Pas d'`inert`, et rien d'autre du lot E5. À l'impression, `aside` est forcé visible, sans transition : mêmes boîtes qu'avant. |
| E1 : brouillon non resynchronisé | `useEffect(() => setBrouillon(null), [valeur])` dans `ChampQteColis` (§ 11, avec son test). |
| Choix de la pharmacie et bandeau de saisie non sélectionnables | `ex-selectionnable` sur la fenêtre `PharmacyPicker` et sur le texte du bandeau (§ 19). |
| Recherche de l'en-tête à 180 px à 1 024 px | Classe `ex-titre-vue` : titre de vue au plus 22 % de 1 024 à 1 279 px, « Bon de commande » masqué (restent « stocks 14:32 » et l'actualisation), `title` sur le titre. Mesuré : 234 px à 1 024 px (texte d'aide entier), 420 px à 1 440 px. |
| Message flash sur la recherche (ordinateur) | `top` = hauteur de l'en-tête + 8 partout, comme sur mobile (72 px à 1 440 px ; la recherche finit à 50). |
| Troncatures | Barre latérale d'ordinateur sur deux lignes au plus, comme le tiroir. Nom de la pharmacie : `ex-nom-pharmacie`, `clamp(110px, 10vw, 150px)`, puis `clamp(110px, 14vw, 220px)` dès 1 280 px (12vw laissait encore « PHARMACIE DU BANC D'ESSAI » coupé à 1 440 px). |
| Coche des filtres « En stock » inactifs | Coche seulement si `aria-pressed` vaut true ; sinon l'icône neutre du stock (carton), en catalogue et dans la Saisie. |
| Mes commandes : noms tronqués sur mobile | `ex-commande-nom` : deux lignes au plus sous 768 px, et `title` partout. |
| Tablette : Qté hors écran (Stratège) | `ex-col-qte` de 768 à 1 279 px : colonne Qté collée au bord droit (`position: sticky`), fond hérité de la ligne (zébrure, rupture), filet à gauche. Sans effet quand le tableau tient. Les ± restent à 24 px sur tablette (plan : mobile seulement). |
| Libellés génériques des ± | Nom du produit dans les `aria-label` (grille, liste mobile, tableau, Saisie, remise à zéro d'une carte). Deux « Masquer » distincts : « … les suggestions de recommande » et « … le réapprovisionnement suggéré ». La quantité de la liste mobile reste un `<span>` sans étiquette. |
| H2 avant le H1 de la vue | Les titres « Suggestions de recommande » et « Réapprovisionnement suggéré » passent en `<p>`. Les blocs restent des régions nommées (`section` + `aria-labelledby`). |
| Écarts de charte | Crayon au trait au lieu de 🛠 (bouton « Commander pour une pharmacie » et préfixe du nom). « Jusqu’au 25 sept. 2026 », lue en date locale. |
| Admin, chiffre « Critiques » à 2,68:1 | `T.acting` (#9a3412) ; encart du calcul ML en ton `ok` (était #f0fdf4 / #bbf7d0). L'admin à l'écran reste à faire passer par une personne connectée (14 onglets). |
| Tirets « – » en `--ink-faint` | `--ink-mute` (4,8 à 5,2:1) pour le sous-total nul, la remise absente (`BadgeRemise`) et le CIP absent. |
| CIP impossibles à copier hors du catalogue ; copie sans repli | `CipCell` sort d'App (`src/components/ui/CipCell.jsx`). Elle est utilisée aussi dans la recherche globale et dans la Saisie ; dans la Saisie, le bouton est hors tabulation pour garder l'enchaînement − / quantité / + au clavier. Les lignes du panier n'affichent pas de CIP. Écriture refusée ou `navigator.clipboard` absent : « Copie impossible » en ton danger, et ce CIP devient sélectionnable. Sur mobile, la ligne de la Saisie passe de 163 à 185 px : le bouton renvoie le CIP à la ligne. |
| Fenêtres `aria-modal` sans focus | `FocusFenetre` (`src/components/ui/FocusFenetre.jsx`) : à l'ouverture, focus sur « Fermer » ; à la fermeture, retour à l'élément d'origine. Mes commandes rend le focus au bouton « Mes commandes ». « Offres du moment » le rend au champ de la Saisie quand elle est ouverte derrière (avant, le focus tombait sur `body`). Ni Échap ni piège à focus (E5). |
| Grille OTC plus lourde | « − », « + » et « copier » des cartes dessinés en CSS (`ex-ico` : masque sur `::before`, mêmes tracés ; `ButtonText` en contraste élevé). Mesuré sur le banc (même page OTC, serveur de développement) : nœuds 18 553 → 13 867, `<svg>` 2 346 → 336, nœuds SVG 5 952 → 1 264. Pas de `React.memo` sur les cartes : trop proche des gestionnaires de quantité pour une retouche de fin de branche. Les temps de clic mesurés dans le navigateur intégré, onglet non affiché, étaient trop instables pour conclure. À l'impression, ces trois icônes disparaissent (fonds non imprimés), comme les boutons, sans gêne. |
| Budget suivi en kB Vite | Contrôle en octets dans `npm run zones` (§ 7). |
| `robots.txt` contraire au `noindex` | Robots d'IA connus : `Disallow: /`. Autres robots : seul `/.netlify/` est fermé, pour qu'ils lisent le `noindex` (§ 19). À confirmer par la cliente. |
| Banc partagé entre sessions | Consigne au § 7. Cette relecture a utilisé l'origine `http://[::1]:8931`, avec son propre stockage. |

**Non corrigés, avec la raison**
- **Lockfile** : écart accepté et documenté au § 7. Un retour en arrière demanderait de modifier package.json, et ESLint exige les nouvelles versions.
- **Safari, Firefox, Edge (majeur)** : vérification partielle.
  - Fait : WebKit de macOS 26.6, le moteur de Safari 26.6, piloté par un script hors dépôt (fenêtre `WKWebView` hors écran, stockage non persistant, vrais événements clavier et souris envoyés à cette seule fenêtre). Il s'est connecté par e-mail et code tapés. Dans la Saisie, il a tapé la recherche, puis 3 + Entrée : le produit est ajouté, le message s'affiche et le compteur passe à 3. Un double clic dans un champ sélectionne le mot ; sur un nom de produit, il ne sélectionne rien. La recherche de l'en-tête reçoit la frappe. Le tableau Stratège : 120 puis Tab donne 120 au panier. Le champ d'une carte OTC prend la quantité. Les icônes en masque CSS s'affichent, le panier se masque une fois fermé, et aucune erreur JS n'apparaît : 13 contrôles sur 13. Calculé : `user-select` vaut none sur le contenu et text dans les champs.
  - Pas fait : iOS ou iPadOS (ni Xcode ni simulateur sur ce Mac, et `safaridriver` demanderait de changer un réglage de sécurité), Firefox (absent) et Edge (absent ; même moteur que Chrome). La liste du § 4.5 reste à passer avant publication sur un iPhone et un iPad réels : saisie dans les champs (recherche, Saisie, quantités de la grille, du panier et du fauteuil, identification), toucher long dans un champ (coller) et sur un lien, puis Firefox. En cas de souci sur iOS, ne retirer que la règle `.ex-app { … user-select: none … }` de tokens.css ; `src/anticopie.js` garde la protection par événements.
- **Étoile ou cœur pour le favori** : l'étoile est gardée. C'est le repère des pharmaciens (« Favoris ») ; la maquette de la vitrine montre un cœur. À trancher par la cliente.
- **Libellés « 🔥🔥Centrale OTC / Para » sans espace** : ce sont des données saisies dans l'admin (`display_config.labels`), pas du code. À signaler à la cliente.
- **Sections perso de l'admin** (`customSections`) : en-têtes sans cellules produit (§ 12). Aucune en production ; le contrôle des colonnes le rappelle.

**Vérifié (banc, 16/10/2026)**
- Outillage : `npm run lint`, `npm run build`, `node scripts/verifie-zones.mjs`, test-gp-pricing (71 OK) et test-quota (17 OK) passent.
- `verifie-zones` : aucun écart, 11 zones, 67 fichiers de fonctions identiques, 86 appels de stockage identiques. Il affiche les colonnes Expert 5, Stratège 8, Master 7 et promos 5, et le budget : 1 151 520 octets ≤ 1 154 491.
- Build de production : aucune trace de « aucune commande ne part ». `dist/robots.txt` est à jour.
- Navigateur intégré, origine `[::1]`, à 1 440 / 1 024 / 768 / 375 px :
  - Master : 10 en-têtes pour 10 cellules, alignés au pixel.
  - Panier fermé : 0 bouton focusable visible. Tab depuis la dernière carte mène au panier flottant, plus hors écran. Ouvert, le panier est visible tout de suite ; fermé, il est masqué après 0,3 s. Le tiroir mobile se comporte de même. Avec les règles d'impression appliquées à l'écran, panier et tiroir sont visibles.
  - E1 : 48 puis Tab donne 48. Un + sans perte de focus aligne champ et panier (60). Une sortie du champ puis + donne 120, puis 180.
  - E2 / E3 : 3 + Entrée dans la Saisie donne le message sous l'en-tête et un panier fermé.
  - Copie du CIP : réussie (coche) ; refusée ou presse-papiers absent (simulés dans la page) : « Copie impossible », CIP sélectionnable et copie permise ; un nom de produit reste protégé.
  - Focus : Mes commandes passe le focus à « Fermer », puis le rend à « Mes commandes ». « Offres du moment », après connexion sur la Saisie, affiche « Jusqu’au 25 sept. 2026 », focus sur « Fermer », puis rend le focus à la recherche de la Saisie.
  - Choix de la pharmacie et bandeau de saisie (jeton d'admin factice et pharmacie fictive posés dans le stockage, retirés ensuite) : `user-select: text`, crayon dans la pastille.
  - Stratège à 768 et 1 024 px : Qté visible au bord droit.
  - Pas de défilement horizontal de page. Aucune erreur en console.
- Bundle : JS 1 134 197 octets, CSS 17 323 (lot A : 1 132 377 et 15 465), soit 1 151 520 octets en tout, pour une marge de 2 971 octets sur le budget. Toute retouche demandée ensuite devra regagner de la place, ou faire relever le budget par la cliente.

---

## Après la revue — décisions de Zineb (16/10/2026)

- iPhone / iPad : saisie et collage dans les champs validés par la cliente sur son téléphone.
- **Sélection Master** : colonnes « Palier » et « PV » supprimées (jamais fournies par le serveur) ; 5 colonnes produit, en-têtes et cellules alignés.
- **Saisie de commande — règle de quantité du catalogue** (corrige un défaut antérieur à la refonte : 4 boîtes d'un colis de 160 partaient au prix carton) :
  - une référence présente dans un catalogue à règle (colis Stratège / gamme blanche, palier Master, campagne) affiche « Se commande par N · rayon » ; les boutons − / + avancent au pas du colis ;
  - à l'ajout (`ajouterDepuisSaisie`), même arrondi que les tableaux (`setQty`) : 150 → 160 avec le message « arrondi au colis de 160 » ; moins d'un demi-colis (4) → rien n'est ajouté, message « se commande par 160 : saisissez 160 ou plus » ;
  - références sans règle et articles à plusieurs références (code fournisseur) : inchangés.
  - Vérifié sur le banc (Dafalgan 1000 gélules, colis 160) : 4 → refus, 150 → 160 (stratege-4), + → 160 → 320.

---

## 21. Thème sombre (24/10/2026)

**Problème.** Un téléphone réglé en mode sombre en permanence noircissait le site lui-même : Chrome Android (« thème sombre pour les sites »), les WebView Android et Samsung Internet appliquent leur propre assombrissement aux pages qui ne déclarent pas de thème sombre. Résultat sur le banc, avec l'assombrissement de Chrome : bouton « Continuer » pétrole sur carte sombre, boîte Ventoline de l'accueil noircie, fonds brunâtres. `color-scheme: light` (lot 1) n'y suffisait pas, et Samsung Internet ignore aussi `only light`.

**Ce qui est fait.** Le site déclare ses deux thèmes (`color-scheme: light dark` dans `tokens.css` et balise `<meta name="color-scheme">` d'index.html). Un navigateur réglé en sombre affiche donc le thème sombre du site au lieu de le noircir. Vérifié sur le banc : avec l'assombrissement forcé de Chrome, le rendu est identique pixel pour pixel au thème sombre.
- **Jetons** : les mêmes noms, redéfinis sous `@media screen and (prefers-color-scheme: dark)` (écran seulement, l'impression reste claire). Les tons sont inversés, comme dans les thèmes sombres Material. Les fonds clairs deviennent sombres et l'encre claire. `--petrol` (titres, liens, boutons pleins) devient un pétrole clair et `--paper` un fond sombre : un bouton « pétrole + paper » reste lisible (10,6:1). L'or ne change pas et garde une encre foncée (`--ink-fixe`). Tous les textes sont à ≥ 4,5:1.
- **Nouveaux jetons** pour les couleurs écrites en dur : `--ink-fixe`, `--acting-bg`, `--labo-bg`, `--violet` (textes de l'admin), `--rupture-bg`, `--rupture-survol`, `--sand-survol`, `--hover-tint` et les filets des tons (`--ok-line`, `--danger-line`, `--danger-line-2`, `--warn-line`, `--acting-line`). Les tons `labo` et `acting` de theme.js et le bouton `danger` y passent.
- **Texte blanc sur fond plein** (`color: "white"` / `"#fff"` sur `T.petrol`, `T.teal`, `T.ok`, `T.danger`, `T.warn`, `T.acting`) : passé à `T.paper`, quasi blanc en clair (#fbf8f2) et sombre en thème sombre, comme son fond devenu clair. Les fonds hexadécimaux saisis dans l'admin (couleurs de rayon, de campagne) gardent leur blanc.
- **Zones qui gardent la palette claire** : la palette claire est redéclarée sur `.ex-on-dark` (bandeaux pétrole : en-tête, salle de cinéma de l'accueil, visionneuse, barre de l'admin, aperçu des mises en avant), qui restent identiques dans les deux thèmes. Elle l'est aussi sur la nouvelle classe `.ex-clair`, pour les objets qui ne se lisent que sur fond clair : photos produit sur fond blanc ou en `mix-blend-mode: multiply`, boîtes dessinées. Concrètement : puits photo des cartes du catalogue, boîtes, scènes et linéaire de « Les plus commandés », tuiles « À la une », geste d'achat, photos des recommandations et du fauteuil.

**Thème clair inchangé** : captures avant/après identiques (connexion, accueil, Centrale OTC, Expert, Master, panier), au texte des pastilles « Rupture » près (#fff → #fbf8f2).

**Vérifié (banc, 24/10/2026)** : audit de contraste automatique, texte par texte, en clair puis en sombre, sur mobile (390 px) et ordinateur (1 280 px). Vues couvertes : connexion, accueil, menus, Saisie, Péremption courte, fauteuil, justificatif, panier, Mes commandes, Notifications, Assistant, menu mobile, recherche de l'en-tête, et les 17 onglets de l'admin. Aucune régression : aucun texte qui passait en clair ne descend sous 4,5:1 (3:1 pour les grands textes) en sombre. `npm run lint`, `npm run build`, `verifie-zones` et les tests concernés passent (test-appli-admin, test-peremption-mention, test-peremption-panier, test-push-client, test-push-messages).

**Budget du bundle** : +1 912 octets (938 338 → 940 250), au-delà de la marge de 1 662 octets. Le budget de `verifie-zones` passe de 940 000 à 942 000 octets : **à confirmer par Zineb**.
