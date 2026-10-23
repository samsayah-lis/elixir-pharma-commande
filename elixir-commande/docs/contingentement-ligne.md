# Contingentement dans la ligne de l'article

Demande des pharmacies relayée par Zineb (23/10/2026) : « l'affichage du contingentement dans la ligne de l'article ».
Jusque-là, le contingentement (quota Odoo par période, module `edi_healthsoft`) ne se voyait qu'au panier.

## Ce que voit la pharmacie

Une pastille, partout où un produit contingenté se commande : Saisie de commande, menus en tableau, cartes et liste
mobile, Péremption courte, recherche globale (« + Panier »), page d'accueil (vitrine des plus commandés, vitrine cinéma,
grille « À la une »). Elle est posée **sous les boutons de quantité ou sur sa propre rangée** (Saisie, liste mobile,
cartes) : quand son texte change, le « + » ne bouge pas sous le doigt.

Trois formes, selon la place :

| Forme | Où | Exemple |
| --- | --- | --- |
| longue | Saisie, liste mobile (rangée à part) | `Contingenté : 12 par jour · reste 8 · 3 au panier + 6 saisis : 1 de trop` |
| moyenne | tableaux, recherche, accueil (dans la ligne) | `Contingenté : 6 par semaine (lundi–dimanche) · encore 5` — état court, la ligne garde sa hauteur |
| courte | cartes, tuiles, Péremption courte | `Quota 8/semaine · 1 de trop` |

| Situation | État (forme longue ; ton) |
| --- | --- |
| reste pas encore lu | `vérification…` (neutre) — la place est prise dès que la liste est connue, rien ne saute à l'arrivée du reste |
| commande envoyée, reste pas encore relu | `mise à jour…` (neutre) — jamais le reste d'avant l'envoi |
| reste disponible | `reste 4` (info) ; avec du panier ou une saisie : `reste 8 · 3 au panier : encore 5 possibles` |
| panier + saisie = reste | `reste 8 · 3 au panier + 5 saisis : rien de plus possible` (info) |
| colis plus grand que le reste | `reste 10 · se commande par 120 : pas possible sur cette période` (avertissement) |
| Saisie arrondie au colis | `1 saisi → 120 (colis)` |
| reste 0 | `quota atteint · nouveau quota le lun. 26 oct.` (avertissement) ; plusieurs jours glissants : `· se libère au fil des jours` |
| au-delà du reste | `reste 2 · 1 au panier + 2 saisis : 1 de trop` (danger) — le panier refusera l'envoi |
| reste illisible (Odoo, session) | `reste non vérifié` (neutre) — le panier ne bloque pas non plus |
| compte sans fiche Odoo (`identified: false`) | `reste non vérifié` (neutre ; rouge seulement au-delà de ce que le panier compte, comme lui) |
| pharmacie dispensée (`deny_quota`) | rien |

Périodes en clair : `par semaine (lundi–dimanche)`, `par décade`, `par quinzaine`, `par mois`, `par jour` (1 jour
glissant), `sur N jours glissants` ; bornes de la décade et de la quinzaine dans le détail. Dates au format du panier
(`lun. 26 oct.`) ; le panier dit lui aussi `par semaine (lundi–dimanche)` et `par jour`.

**Détail** : la pastille est un bouton (au doigt, au clavier : `aria-expanded`) qui ouvre le détail — quota, période,
déjà commandé, reste, panier, colis, nouveau quota ; le même texte en bulle au survol. Le champ de quantité de la ligne est
décrit par la pastille (`aria-describedby`) ; le passage au rouge est annoncé par une seule région `role="status"`.

**Paliers** : la jauge des paliers, le badge « X € dès N » et « Passer à N » (tableaux, liste mobile, cartes, Saisie,
panier) ne proposent plus un palier au-delà du reste (`tiersQuota`, au pas du colis) ; prix facturés inchangés.

## Règle

Celle du panier, jamais plus permissive : `quotaOver` d'`App.jsx` (contrôle de l'envoi) additionne les lignes du CIP au
panier ; la pastille y ajoute la quantité tapée pas encore ajoutée (Saisie, arrondie au colis comme à l'ajout ; Péremption
courte) et passe au rouge exactement quand le panier refuserait l'envoi, quelle que soit la forme (`scripts/test-quota.mjs`
le vérifie cas par cas sur le code d'`App.jsx`). Pas de plafond dans les champs : avertissement seulement, le panier bloque
comme avant.

## Données

- `quota-liste` (nouvelle fonction, GET + jeton, lecture seule) : règles des produits contingentés (`quotaProducts` de
  `_quota.js`, cache de 10 min par instance ; navigateur : `private, max-age=600`). Lue une fois par session, **avec** la
  pastille (`chargerPastille`) ; l'une ou l'autre en échec : nouvel essai après 2 min.
- Le reste de la pharmacie n'est lu qu'à l'affichage d'un produit de cette liste, par **le même appel et le même état que le
  panier** (`loadQuota` → `quota-status`, un appel pour tous les produits) ; gardé 5 min ; échec : nouvel essai après 1 min.
  Une lecture réussie du panier (ouverture, ajout depuis la Saisie) vaut aussi pour la pastille.
- Saisie Elixir (« Commander pour une pharmacie ») : reste de la pharmacie servie (`odoo_id`, jeton admin). `loadQuota`
  n'enregistre une réponse que si la pharmacie affichée est encore celle du départ de la lecture (`cleQuota`) : une réponse
  tardive pour une autre pharmacie (pastille, panier, ajout) n'est ni montrée ni gardée. Zone protégée modifiée, écart
  déclaré dans `scripts/verifie-zones.mjs` (attente `quotaLigne`).
- Commande envoyée : « mise à jour… » ; une lecture partie avant l'envoi est ignorée ; relu une fois le panier vidé s'il y
  a une pastille à l'écran, sinon à l'affichage de la suivante (aucune lecture Odoo de plus pour une pharmacie qui n'en voit
  aucune).

## Code

- `src/components/quota/entree.jsx` : contexte, composant `Quota`, `chargerPastille`, `tiersQuota` (partie du bundle des
  pharmacies) ; `PastilleQuota.jsx` chargée avec la liste ; textes et règle : `src/quota-ligne.js`.
- `App.jsx` : `cleQuota` (juste avant les zones du panier), `loadQuota` (écart déclaré), bloc « Contingentement dans la
  ligne de l'article » après les zones protégées.
- `netlify/functions/quota-liste.js` (admise dans `scripts/verifie-zones.mjs`, AJOUTS_AUTORISES) ; `_quota.js` et
  `quota-status.js` inchangés.

## Vérifications

- `node scripts/test-quota.mjs` : périodes, textes (trois formes), jour du nouveau quota, colis, paliers atteignables,
  panier, dispense, vérification et mise à jour, service indisponible, compte sans fiche Odoo, `quota-liste` (jeton, admin,
  pannes, cache), VRAI code d'`App.jsx` (pharmacie affichée, `loadQuota`, bloc) : une lecture, 5 min, échec, lecture du
  panier, envoi (lecture en cours ignorée, relecture seulement avec une pastille), liste en échec puis relue, réponse
  tardive d'une autre pharmacie.
- Banc : `scripts/banc/quota-banc.mjs` (règles FICTIVES sur des produits non contingentés en réel — dépôt public ;
  scénarios `BANC_QUOTA=normal|atteint|panne|dispense|off|accueil` ou `/banc-quota?mode=…&raz=1&retard=<ms>`) et
  `node scripts/banc/controle-quota.mjs http://localhost:<port>/` (CAPTURES=<dossier>) : positions (sous les boutons,
  « + » immobile), lecture lente (rien ne saute), colis, paliers, recherche, accessibilité, envoi.
