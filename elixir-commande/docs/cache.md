# Cache des fichiers du site

Demande de Zineb (24/10/2026) : « laisser le navigateur garder les fichiers du site en mémoire au lieu de les revérifier à
chaque visite, mais forcer le vidage en cas de mise à jour ».

## Ce qui est gardé, et combien de temps

| Fichiers | Cache du navigateur | Pourquoi |
|---|---|---|
| `/assets/*` à empreinte (JS, CSS, polices : `index-Ck0KzExp.js`) | **un an, sans revérifier** (`public, max-age=31536000, immutable`) | le nom change dès que le contenu change |
| `index.html` (et toutes les adresses du site) | revérifié à chaque visite (défaut de Netlify : `max-age=0, must-revalidate`) | c'est lui qui annonce les noms des fichiers de la version en ligne |
| `/sw.js`, manifestes, `/api/openapi.yaml` | jamais gardé / revérifié (règles de `netlify.toml`) | inchangé |
| icônes et autres fichiers de `public/` (sans empreinte) | revérifié à chaque visite (défaut de Netlify) | inchangé |

Avant : à chaque visite, le navigateur redemandait chaque fichier (réponse « 304, inchangé »), un aller-retour réseau par
fichier. Maintenant : le JS, le CSS et les polices sont lus sur place, sans réseau ; seuls `index.html` et les fichiers sans
empreinte (icônes, manifestes, service worker) sont encore revérifiés.

## Mise à jour : le « vidage » est automatique

Vite donne à chaque fichier de `/assets` une empreinte de son contenu. Une mise en ligne qui modifie un fichier lui donne un
nouveau nom ; `index.html`, toujours revérifié, pointe vers les nouveaux noms ; le navigateur télécharge les fichiers renommés
et ne relit jamais les anciens. Aucune purge à faire, ni sur Netlify ni chez les pharmacies.

En pratique, à chaque mise en ligne, le fichier principal (`index-*.js`, environ 150 Ko compressés) est téléchargé de
nouveau à la visite suivante, et la plupart des morceaux chargés à la demande quand ils servent la première fois : ils
contiennent le nom du fichier principal, donc changent avec lui (essai du 24/10 : une phrase changée dans l'admin a
renommé 17 des 20 fichiers JS). Restent en cache d'une version à l'autre : la bibliothèque Excel (`gp-files-*.js`), le
module des QR codes, les polices et le CSS non modifié.

**Onglet ouvert pendant une mise à jour** : comme avant, il garde l'ancienne version jusqu'au rechargement de la page. S'il
lui manque un fichier chargé à la demande (admin, accueil, assistant, import Excel…), le message habituel demande de
recharger la page.

## Comment c'est fait

- `scripts/cache-assets-plugin.mjs` (plugin Vite, au build) écrit `dist/_headers` : **une règle par fichier réellement
  produit dans `/assets`**, avec son nom exact. Netlify lit ce fichier en plus de `netlify.toml`.
- **Jamais de règle `/assets/*`** (dans `netlify.toml` ou ailleurs). Netlify applique ses règles d'en-têtes selon l'adresse
  demandée et peut les appliquer aussi quand le fichier n'existe pas (vu avec netlify-cli et dans d'autres projets ; non
  documenté) : un onglet ouvert avant une mise à jour qui demande un ancien fichier recevrait `index.html` (règle
  `/* → /index.html 200`) ou une 404 marqués « gardé un an », et le navigateur les garderait sous l'adresse du fichier ;
  après un retour arrière (rollback) de Netlify, ce fichier resterait cassé pour lui. Avec des règles au nom exact, un
  fichier absent ne correspond à aucune règle et reste au défaut de Netlify (revérifié). Nuance : Netlify compare les
  adresses sans tenir compte des majuscules et accepte une barre finale ; sans effet ici, le site ne demande que les noms
  exacts écrits dans ses fichiers.
- **Seuls les fichiers nommés par Vite avec une empreinte** reçoivent une règle : un fichier au nom fixé à la main (posé
  dans `public/assets`, ou émis avec un nom), même s'il a la forme d'une empreinte (`logo-officine.svg`), n'en reçoit pas ;
  si la configuration de Vite nomme ses fichiers sans `[hash]`, aucun fichier n'est gardé un an et le build l'écrit en
  avertissement. Sans règle, un fichier est revérifié à chaque visite : jamais gardé un an par erreur.
- Recherche et vérification du 24/10/2026 : documentation et forums de Netlify, essais avec netlify-cli, fichier `_headers`
  lu par les parseurs de Netlify (`@netlify/headers-parser`, `@netlify/config` : 29 règles, aucune erreur, aucun conflit avec
  `netlify.toml`), visites simulées dans Chromium (deuxième visite sans aucune requête vers `/assets`, mise à jour : seuls les
  fichiers renommés téléchargés, retour arrière sans fichier cassé).

## Contrôles

- `node scripts/test-cache-assets.mjs` : vrai build dans un dossier temporaire ; une règle par fichier de `dist/assets`, tous
  à empreinte, rien d'autre (ni `index.html`, ni service worker, ni manifestes) ; nom fixé à la main ou noms sans `[hash]` :
  aucune règle ; aucune règle `/assets` ni cache long dans les deux `netlify.toml` ; ni `public/_headers` ni `public/assets`.
- **Après le déploiement** (d'un ordinateur : ce contrôle ne peut pas se faire depuis l'environnement de développement) :

  ```sh
  SITE=https://elixir-commande.expepharma.com
  F=$(curl -s $SITE/ | grep -o '/assets/index-[^"]*\.js' | head -1)
  curl -sI "$SITE$F" | grep -i cache-control            # attendu : public, max-age=31536000, immutable
  curl -sI "$SITE/assets/index-ABSENT00.js" | grep -i cache-control   # attendu : pas de max-age=31536000
  curl -sI "$SITE/" | grep -i cache-control             # attendu : max-age=0 et must-revalidate (pas de max-age=31536000)
  curl -sI "$SITE/sw.js" | grep -i cache-control        # attendu : no-cache, no-store, must-revalidate
  ```
