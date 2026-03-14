# CHANGELOG — Elixir Pharma Commande
## Version 2.0.0 — Audit complet + ML Engine — Mars 2026

---

### 🔴 BUGS CRITIQUES CORRIGÉS

#### BUG-01 — `nextBusinessDay()` : livraison toujours J+1 (CORRIGÉ)
- **Fichier** : `src/App.jsx` lignes 44-59
- **Problème** : Le `if` (après 14h) et le `else` (avant 14h) faisaient la même chose : `d.setDate(d.getDate() + 1)`. Résultat : livraison toujours J+1, jamais J+2 après 14h.
- **Fix** : Séparé les deux branches. Avant 14h → J+1 ouvré. Après 14h → J+2 ouvré. Supprimé aussi le code mort (ligne 56, `if` avec corps vide — BUG-03).

#### BUG-02 — `stock-refresh.js` : stocks jamais rafraîchis (CORRIGÉ)
- **Fichier** : `netlify/functions/stock-refresh.js` (entièrement réécrit)
- **Problème** : `gen-cips.js` extrayait les CIP depuis App.jsx, mais les produits ont migré vers Supabase → `cips.js` exportait un tableau vide → `stock-refresh` itérait sur rien.
- **Fix** : Le refresh charge désormais les CIP directement depuis la table `elixir_products` de Supabase. Plus de dépendance au fichier `cips.js`. Ajout d'un snapshot quotidien pour la prédiction ML des ruptures.

#### BUG-04 — `order-save` : champ `source` perdu (CORRIGÉ)
- **Fichier** : `netlify/functions/order-save.js` (réécrit)
- **Problème** : Le frontend envoyait `source: "ulabs"` pour les commandes groupées, mais le champ n'était pas inclus dans la row Supabase.
- **Fix** : Ajout du champ `source` dans la row. Ajout d'un try/catch pour gérer les erreurs Supabase (BUG-10).

#### BUG-07 / SEC-01 — Mot de passe admin en clair dans le JS client (CORRIGÉ)
- **Fichiers** : `src/AdminPanel.jsx`, nouveau `netlify/functions/admin-login.js`
- **Problème** : `const ADMIN_PASSWORD = "elixir2026"` extractible du bundle minifié.
- **Fix** : Password supprimé du frontend. Nouvelle Netlify Function `admin-login.js` vérifie le mot de passe côté serveur et retourne un JWT.

---

### 🟠 BUGS MOYENS CORRIGÉS

#### BUG-06 — `quantities` stocke des strings vides (CORRIGÉ)
- **Fichier** : `src/App.jsx` ligne 1430
- **Fix** : `e.target.value === "" ? 0` au lieu de `""`.

#### BUG-08 — `globalResults` utilise `indexOf` instable (CORRIGÉ)
- **Fichier** : `src/App.jsx`
- **Fix** : Remplacé `.filter().map(p => { _idx: products.indexOf(p) })` par `.map((p, idx) => { _idx: idx }).filter()` pour un index stable.

#### BUG-10 — `order-save` en fire-and-forget (CORRIGÉ)
- **Fichier** : `src/App.jsx` ligne ~724
- **Fix** : Le `fetch` order-save est maintenant `await`-é. ID commande utilise un format unique `ORD-{timestamp}-{random}`.

---

### 🔒 SÉCURITÉ

#### SEC-01/04 — Authentification JWT (NOUVEAU)
- **Fichier** : `netlify/functions/auth.js`
- Middleware JWT complet : `signToken()`, `verifyAuth()`, `verifyAdmin()`
- HMAC-SHA256 sans dépendance externe
- Utilisé par `admin-login.js` et `order-list.js`

#### SEC-05 — `order-list` exposait toutes les commandes (CORRIGÉ)
- **Fichier** : `netlify/functions/order-list.js` (réécrit)
- Supporte le filtrage par `pharmacy_cip` et par `source`
- Vérifie le JWT pour différencier admin (toutes commandes) / pharmacie (ses commandes uniquement)

#### SEC-06 — Token hardcodé dans `pharmacy-sync-now` (CORRIGÉ)
- **Fichier** : `netlify/functions/pharmacy-sync-now.js`
- Token lu depuis `process.env.SYNC_TOKEN` ou `process.env.ADMIN_PASSWORD`

---

### ⚡ PERFORMANCE

#### PERF-04 — `filteredProducts` mémoïsé (CORRIGÉ)
- **Fichier** : `src/App.jsx`
- L'IIFE `(() => { ... })()` remplacée par `useMemo(fn, [cat?.products, search, activeTab])`

#### PERF-05 — Cache de regex compilées (CORRIGÉ)
- **Fichier** : `src/App.jsx`
- Nouvelle fonction `getCachedRx()` avec `Map` globale. Les regex des campagnes sont compilées une seule fois.

#### PERF-06 — Polling stock avec Page Visibility API (CORRIGÉ)
- **Fichier** : `src/App.jsx`
- Le `setInterval(fetchStock, 5min)` est pausé quand l'onglet est masqué, repris avec un refresh immédiat au retour.

#### PERF-07 — Google Fonts via `<link>` au lieu de `@import` (CORRIGÉ)
- **Fichiers** : `index.html` (ajout preload), `src/App.jsx` (suppression @import bloquant)

---

### 🤖 MACHINE LEARNING & INTELLIGENCE COMMERCIALE (NOUVEAU)

#### ML-01 — Moteur de recommandation cross-sell
- **Fichier** : `netlify/functions/ml-recommend.js`
- Calcul de co-occurrence avec métriques Lift / Support / Confidence
- Endpoint GET `?cip=XXX` pour obtenir les produits complémentaires
- Seuil Lift ≥ 1.2 pour filtrer les associations significatives

#### ML-02 — Re-order intelligent (pré-remplissage de panier)
- **Fichier** : `netlify/functions/ml-recommend.js`
- Analyse la fréquence et régularité des commandes par pharmacie
- Endpoint GET `?pharmacy_cip=XXX&mode=reorder`
- Détecte quand un réapprovisionnement est probablement nécessaire (seuil 80% de l'intervalle moyen)

#### ML-03 — Snapshot stocks quotidien (prédiction ruptures)
- **Fichier** : `netlify/functions/stock-refresh.js`
- Sauvegarde automatique d'un snapshot dans `stock_history` à chaque refresh
- Base de données pour la future prédiction par time series

#### ML-04 — Composants React d'interface ML
- **Fichier** : `src/components/MLRecommendations.jsx`
- `<CrossSellBanner>` : bandeau dans le panier, affiche 4 recommandations max
- `<ReorderSuggestion>` : popup au login, propose un panier pré-rempli
- Intégrés dans `App.jsx` (panier + page principale)

#### ML-05 — Tables Supabase pour le ML
- **Fichier** : `supabase-migrations.sql`
- `product_associations` : matrice cross-sell
- `pharmacy_patterns` : historique commandes par pharmacie
- `stock_history` : snapshots quotidiens
- `pharmacy_segments` : segmentation K-means

---

### 📋 ACTIONS POST-DÉPLOIEMENT REQUISES

1. **Variables d'environnement Netlify** à ajouter :
   - `JWT_SECRET` — string aléatoire de 64+ caractères
   - `ADMIN_PASSWORD` — nouveau mot de passe admin (remplace "elixir2026")
   - `SYNC_TOKEN` — (optionnel, utilise ADMIN_PASSWORD si absent)

2. **SQL Supabase** à exécuter :
   - Ouvrir l'éditeur SQL Supabase
   - Copier-coller le contenu de `supabase-migrations.sql`
   - Exécuter

3. **Scheduled Function** Netlify :
   - Créer un cron qui appelle `POST /.netlify/functions/ml-recommend` avec body `{"action":"compute"}` 1x/jour

4. **Fichiers obsolètes** à supprimer du repo (optionnel) :
   - `src/pharmaciesDb.js` (2 261 lignes — résidu de la migration Supabase)
   - `netlify/functions/catalog-data.js` (2 749 lignes — résidu)
   - `scripts/gen-cips.js` (obsolète, CIP chargés depuis Supabase)
   - `netlify/functions/cips.js` (obsolète)
