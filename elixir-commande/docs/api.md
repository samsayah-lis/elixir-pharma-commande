# API des pharmacies (`/api/v1`) — contrat interne

Dépôt PUBLIC : aucun secret, aucune donnée réelle. Les exemples sont fictifs (CIP `3400000000011`, « Pharmacie Exemple »,
numéros `1790000000001`). Ce fichier fixe les règles que le code applique. Pour les pharmacies : page `/api/`
(`public/api/index.html`) et description OpenAPI 3.1 `/api/openapi.yaml` (source : `docs/api/openapi.yaml`), confrontées
au code et aux réponses réelles du routeur par `scripts/test-api-openapi.mjs`. Pour la mise en service (SQL, prérequis,
interrupteurs, surveillance, projet de CGU) : `docs/api/mise-en-service.md`.

Décisions de Zineb (24/10/2026) :

1. accès sur demande, ouvert par Elixir pharmacie par pharmacie (onglet 🔌 API) ; la pharmacie crée et révoque ensuite
   ses clés dans son compte (« Mes commandes » → « Accès API ») ; variante tracée côté admin pour une pharmacie sans compte ;
2. la V1 comprend la **commande** ;
3. **pas de validation manuelle par défaut** : une commande acceptée part seule après un délai d'annulation de 10 min, avec
   des plafonds ; elle n'est gardée « à vérifier » que pour une **anomalie nette** (voir § 4) ;
4. gratuit ;
5. prix de la liste de prix Odoo de CHAQUE pharmacie (« prix HT de votre liste, hors offres du site »).

## 1. Fichiers

| Fichier | Rôle |
|---|---|
| `netlify/functions/api-v1.js` | Routeur : débit par IP, clé, accès, fiche Odoo, droit, débit par clé, route, journal |
| `netlify/functions/_api-lecture.js` | Lecture : catalogue, disponibilités, contingents, commandes, factures, BL |
| `netlify/functions/_api-commande.js` | Commandes : simulation, commande, annulation |
| `netlify/functions/_api-parcours.js` | Parcours de test (clé de production après six étapes réussies) |
| `netlify/functions/api-commandes-cron.js` | Planifiée toutes les 2 min : envois dus, réservations en suspens |
| `netlify/functions/api-envoi-background.js` | Envoi d'une commande par le relais existant (`envoiAuto`) |
| `netlify/functions/_api-stock.js` | Tables privées `api_*` (clé serveur), commandes du site écrites par l'API |
| `netlify/functions/_api-avis.js` | P9 : e-mails d'avis des clés (créée, remplacée, révoquée) et alertes d'usage du passage planifié `api-cron` (§ 11) |
| `sql/api-schema.sql` | Tables `api_*` : RLS sans policy, droits retirés à anon et authenticated |
| `docs/api/openapi.yaml` | Description OpenAPI 3.1 (servie à `/api/openapi.yaml` par `scripts/api-doc-plugin.mjs`) |
| `public/api/index.html` | Documentation des pharmacies (page statique `/api/`, hors bundle ; `/api/docs` y renvoie) |
| `docs/api/mise-en-service.md` | Mise en service : SQL, prérequis P1–P9, ouverture d'une pharmacie, interrupteurs, surveillance, projet de CGU |
| `scripts/test-api-openapi.mjs` | OpenAPI et page confrontées au code (routes, droits, limites, codes) et aux réponses réelles des trois tests de l'API |

## 2. Interrupteur « Commandes par API »

- Les commandes **réelles** (clés `elx_live_`) sont refusées par le serveur — `503 ecriture_suspendue`, `Retry-After` —
  tant que l'interrupteur de l'onglet 🔌 API est fermé. Il ne s'ouvre que si les cinq prérequis sont cochés :
  - P1 : sécurisation de la base de données terminée (étape 2 et Bloc 1 du plan) ;
  - P3 : fin de la quarantaine des commandes du site (pas avant le 02/11/2026) ;
  - P4 : identifiants du relais renouvelés et envoi automatique du site stable ;
  - P7 : conditions d'utilisation de l'API validées par un avocat ;
  - P9 : avis par e-mail des clés et alertes d'usage en place (livrés le 24/10/2026, § 11 ; Zineb coche la case après avoir reçu
    un premier e-mail d'avis).
- Rejeu d'une commande DÉJÀ enregistrée (même `Idempotency-Key`, même corps) : rendu à l'identique même si l'interrupteur,
  les CGU ou le mode de l'accès ont changé depuis ; seule une nouvelle commande est refusée.
- Décocher une case referme l'interrupteur. Une commande acceptée puis rattrapée par une fermeture ne part pas : elle passe
  « à vérifier » (motif `envoi_suspendu`).
- Les clés de **test** fonctionnent dès la mise en ligne : elles n'écrivent que dans les tables privées `api_*`.
- La simulation reste possible avec une clé de production : elle annonce le refus (`resultat: "refusee"`, `refus.code`).

## 3. Une commande

`POST /v1/commandes` (droit « commande », clé, accès et fiche Odoo relus à chaque appel — fiche : 3 s au plus) :

```http
POST /api/v1/commandes
Authorization: Bearer elx_test_<votre clé de test>
Idempotency-Key: 6f1c2b9e-0d4a-4c1e-9a57-2b8f0c3d1e42
Content-Type: application/json

{ "reference_client": "REASSORT-A", "lignes": [ { "cip": "3400000000011", "quantite": 12 } ],
  "si_rupture": "retirer", "tout_ou_rien": false, "commentaire": "facultatif" }
```

Contrôles, dans l'ordre :

1. accès en mode « auto » (sinon `403 commandes_bloquees`), conditions d'utilisation en vigueur acceptées (sinon
   `403 cgu_a_accepter`), interrupteur ouvert pour une clé de production (sinon `503 ecriture_suspendue`) ;
2. `Idempotency-Key` obligatoire (8 à 128 caractères `A-Z a-z 0-9 _ . : -`) ;
3. structure : 1 à 200 lignes, `cip` = texte de 13 chiffres (CIP13 ou code-barres), `quantite` entière de 1 à 999, un produit
   une seule fois (ni deux fois le même CIP, ni le CIP et le code-barres d'un même produit), aucun champ inconnu (un prix
   envoyé par le client est refusé : rien n'est pris du client) ;
4. plafond de commandes du jour de la pharmacie (toutes clés, annulées comprises ; test : 100 au moins) : premier filtre
   ici, puis place prise ATOMIQUEMENT (compteur `api_compter` « cmdjour », jour de Paris) juste avant le numéro — des
   requêtes simultanées ne dépassent jamais le plafond → `429 plafond_commandes_jour` jusqu'à minuit (heure de Paris) ;
5. par ligne :
   - absent du catalogue → `refusee`, `produit_inconnu` ;
   - produit exclu par l'admin → `produit_non_commandable` ;
   - offres que le site seul sait servir (hors V1) → `produit_non_commandable` (« à commander sur le site ») : article livré
     sous plusieurs CIP (fauteuils : le site répartit la quantité entre eux, le plus ancien d'abord), produit d'une campagne
     (section U-Labs ou campagne active). Exclusions illisibles → `503`, jamais « commandable » par défaut ;
   - produit sur justificatif laboratoire → `produit_sur_justificatif` (« à commander sur le site ») ;
   - prix pas encore calculé → `prix_indisponible` ;
   - contingent : quantité ramenée au reste (`motif: contingentement`), refusée à 0 ;
   - rupture (stock libre lu en direct) : retirée (`etat: rupture`) avec `si_rupture: "retirer"` (défaut), gardée en attente
     du stock avec `"garder"` (`motif: en_attente_stock`) ;
   - prix : celui de la liste de prix de la pharmacie, calculé par Odoo (MINIMUM des règles applicables, comme la facture), au
     palier atteint par la quantité ;
6. `tout_ou_rien: true` et une ligne refusée, retirée ou réduite → `422 commande_refusee` ; aucune ligne acceptée →
   `422 aucune_ligne_acceptee` ;
7. plafonds de l'accès, sur ce qui serait envoyé (défauts : 100 lignes, 1 000 boîtes, 3 000 € HT) : dépassement →
   `422 plafond_depasse` avec `plafond: { nom, limite, valeur }`. **Refus explicite, jamais de mise en attente.**
8. anomalies nettes (§ 4) → commande acceptée mais gardée « à vérifier ».

Odoo injoignable : `503` (`contingent_indisponible` si un produit est contingenté), rien n'est enregistré, la même requête
(même `Idempotency-Key`) peut être renvoyée. Durée : l'échéance est mesurée depuis l'ARRIVÉE de la requête (contrôles du
routeur compris) ; passé 7 s, rien n'est plus écrit (ni numéro, ni ligne `elixir_orders`) : `503` rejouable. La route est
coupée au plus tard 9 s après l'arrivée. Le contrôle de contingent est fait au serveur ; deux commandes simultanées
peuvent lire le même reste : Odoo reste l'arbitre à l'import.

Réponse `201`, `Location: /api/v1/commandes/{id}` :

```json
{ "id": "1790000000001", "environnement": "live", "reference_client": "REASSORT-A", "canal": "api", "etat": "recue",
  "motif": null, "cree_le": "2026-11-16T09:30:12+01:00", "annulable_jusqu_a": "2026-11-16T09:40:12+01:00",
  "si_rupture": "retirer", "total_indicatif_ht": 110.4,
  "lignes": [ { "ligne": 1, "cip": "3400000000011", "nom": "PRODUIT EXEMPLE A 30 CPR", "quantite_demandee": 12, "quantite": 12,
                "prix_unitaire_ht": 9.2, "total_ht": 110.4, "etat": "acceptee", "motif": null, "detail": null } ],
  "anomalies": [], "avertissements": [], "mention": "Prix HT de votre liste, hors offres du site. Prix indicatifs : …" }
```

La commande réelle est écrite dans `elixir_orders` (source `api`, sans e-mail, CIP et nom de la fiche, lignes
`{ cip, name, qty, pn, total, ligne_api }`) : elle compte aussitôt dans le contingent, apparaît dans « Mes commandes » et dans
l'onglet Commandes de l'admin avec le badge « 🔌 API ». `order-save.js` n'est pas utilisé ni modifié.

`POST /v1/commandes/simulation` : mêmes contrôles, rien n'est écrit, `200` avec `resultat` (`acceptee` | `refusee`), `refus`
(statut, code, détail que la commande aurait reçus), lignes, total, anomalies.

## 4. Anomalies nettes : commande gardée « à vérifier »

C'est la SEULE validation humaine. Réglable par pharmacie dans l'onglet 🔌 API (case « Garder à vérifier les commandes
anormales », facteur, fenêtre de doublon). Par défaut :

- **Quantité inhabituelle** : une ligne au-delà de **10 × la quantité mensuelle habituelle** de ce produit pour cette
  pharmacie. Habitude = quantité commandée sur les 6 derniers mois (tous canaux : site, API, logiciel d'officine ; commandes
  Odoo non annulées), divisée par 6, avec un plancher de 3 boîtes par mois pour un produit jamais ou rarement commandé
  (soit 30 boîtes au-delà desquelles une première commande est gardée). L'historique est une SOMME GROUPÉE par produit
  (`read_group` d'Odoo) : jamais tronqué, même pour une pharmacie qui commande tous les jours.
- **Quasi-doublon** : une commande reçue depuis moins de **30 min**, quel que soit le canal (site, API, logiciel d'officine
  vu dans Odoo), porte presque les mêmes produits : produits communs / produits des deux commandes réunis ≥ **80 %**
  (indice de Jaccard, symétrique). Un complément d'une ou deux lignes après une grosse commande n'en est donc pas un. Les
  commandes du logiciel sont lues à part (créées depuis 30 min, 2 000 lignes au plus ; la plus ancienne d'une lecture
  pleine est écartée). Les lignes annulées ou traitées sans envoi ne comptent pas : une commande annulée puis repassée
  n'est pas un doublon. En mode test, la comparaison se fait avec les commandes de test de la pharmacie.

Effet : `201` avec `etat: "en_attente_elixir"`, `motif: "anomalie_quantite"` ou `"quasi_doublon"`, `anomalies` détaillées,
`annulable_jusqu_a: null` (annulable tant qu'Elixir ne l'a pas envoyée). Elixir est notifié ; la commande est dans l'onglet
Commandes (« 🔌 API · À VÉRIFIER »), hors de « Sync toutes ». Valider = « Sync » de la commande ; refuser une ligne =
« Traiter sans envoi ». Elle ne part jamais seule.

Sont aussi gardées « à vérifier », après le délai : relais en envoi manuel (`envoi_manuel`), commande identique à une autre
de moins de 2 h selon le relais (`doublon_recent`), retard de plus de 30 min (`envoi_manque`), API ou accès coupés
(`envoi_suspendu`), ruptures gardées (`precommande`), ligne sans stock au moment de l'envoi (`rupture_envoi`), commande
modifiée depuis l'acceptation (`commande_modifiee`), erreur
(`erreur_transmission`, `envoi_a_verifier`, `reprise`). Ces cas ne sont pas des validations : la commande n'est pas partie
seule et Elixir la termine.

## 5. Idempotence

- Portée : la fiche et l'environnement (une clé tournée retrouve la même commande).
- Rejeu, même contenu (lignes triées, valeurs par défaut remplies) : même statut, même corps, `Idempotent-Replayed: true`
  — y compris pour un refus `422`. Contenu différent : `422 idempotency_key_reutilisee`.
- Requête encore en cours (moins de 60 s) : `409 requete_en_cours`, `Retry-After: 2` ; au-delà (fonction coupée) : reprise.
- Rejeu après fermeture de l'accès (interrupteur, CGU, mode « bloqué ») : rendu à l'identique (voir § 2).
- `reference_client` : unique par fiche hors commandes refusées ou ANNULÉES (index `api_commandes_reference_v2`) →
  `409 reference_deja_utilisee` avec l'`id` existant ; autre requête de même référence encore en cours → `409
  requete_en_cours` (elle peut encore finir refusée).
- Numéro choisi par le serveur (`Date.now()`, 13 chiffres ; `T` devant en test) et noté dans `api_commandes` AVANT l'insertion :
  une reprise réutilise le même numéro ; un numéro déjà pris par une autre commande en fait tirer un nouveau.
- Erreur passagère ou plafond du jour : la réservation est rendue (la même clé repart de zéro).

## 6. Envoi, annulation, états

- `api-commandes-cron` (toutes les 2 min) confie chaque commande réelle dont le délai est écoulé à `api-envoi-background`,
  qui la prend par une transition conditionnelle (un seul envoi même si deux passages se croisent), retire les lignes sans
  stock (`si_rupture: "retirer"`) AVANT la mise en file, puis appelle `envoiAuto` du relais (seul chemin vers PharmaML).
  L'interrupteur `autoSite` du relais vaut aussi pour l'API.
- Avant tout envoi, la commande du site doit porter exactement les lignes acceptées par l'API (CIP, quantité, rang) et le
  CIP de la fiche Odoo de l'accès : sinon « à vérifier » (`commande_modifiee`), rien ne part (défense en profondeur).
- Erreur passagère AVANT toute mise en file (Odoo, base) : la commande redevient « recue », nouvel essai 3 min plus tard,
  tant qu'elle a moins de 22 min ; ensuite « à vérifier » (`envoi_manque`, avis). Exception APRÈS la mise en file (réponse
  perdue) : la file du relais fait foi (tâche active → `envoyee`).
- Le passage planifié prévient Elixir (notification) de toute commande qu'il passe « à vérifier », repose les marques
  d'annulation qui manquent sur les lignes du site (48 h), et signale une fois toute commande `elixir_orders` de source
  « api » sans ligne `api_commandes` (onglet Commandes : « ⚠ inconnue de l'API », « Sync » sous confirmation).
- Commande synchronisée à la main par Elixir pendant le délai (« Sync » de l'onglet Commandes, avec confirmation) : la
  fonction d'envoi n'y touche plus (ni ligne retirée, ni nouvel envoi), l'état suit le relais.
- Ligne restée sans stock entre la vérification et la mise en file : elle n'est pas réécrite après la mise en file (le
  relais pose ses marques sur les mêmes lignes) ; la commande passe « à vérifier » (`rupture_envoi`, avis à Elixir), qui la
  retire avec « Traiter sans envoi » ou l'envoie au retour du stock.
- `DELETE /v1/commandes/{id}` : pendant le délai (reçue, pas encore prise par l'envoi) ou tant qu'une commande gardée
  « à vérifier » n'est pas partie ; jamais si une ligne est envoyée, si une tâche du relais existe ou si Elixir a pris une
  ligne en main (`handled_at` sans `api_motif` : « Traiter sans envoi », saisie directe) → `409 trop_tard`. Les lignes sont
  marquées « traitées » (`handled_at`, `api_motif: annulee`) par la fonction SQL `api_marquer_lignes` (une transaction,
  jamais une ligne partie ; repli sur la relecture-réécriture tant qu'elle n'existe pas) : plus de contingent, plus
  d'envoi. Marquage interrompu → `503` rejouable, le rejeu le termine. Classe de débit à part (`annulation`), aucune
  lecture d'Odoo, servie pendant « Tout couper ».
- États (`GET /v1/commandes/{id}`) : `recue` (délai en cours), `en_attente_elixir` + motif, `en_transmission` (dont : délai
  écoulé, pas encore pris par l'envoi), `transmise`,
  `en_preparation`, `partiellement_sortie`, `sortie_entrepot`, `facturee`, `non_servie` (toutes lignes en rupture),
  `annulee`. Dès qu'une ligne part, l'état du relais puis d'Odoo l'emporte. Lignes : `acceptee`, `refusee`, `rupture`,
  `annulee`, `traitee_par_elixir`.

## 7. Mode test

Clé `elx_test_` : contrôles réels (prix, contingents, stock, plafonds, anomalies), commande « T… » écrite seulement dans
`api_commandes` — jamais dans `elixir_orders`, ni notification, ni stock, ni relais ; état simulé (reçue pendant le délai,
puis transmise, puis sortie de l'entrepôt 10 min plus tard ; gardée « à vérifier » : validation simulée à la fin du délai).
Débits propres (`LIMITES_TEST` : commande 30/min et 500/j, simulation 30/min et 1 000/j) ; au moins 100 commandes de test
par jour. En-tête `X-Elixir-Simulation` (test seulement) : `rupture`, `contingent`, `indisponible`, `doublon`.

Hôte d'aperçu (« …--commandes-elixir.netlify.app », liens permanents des déploiements compris) : clés de TEST seulement
(`403 cle_production_hors_site` pour une clé `elx_live_`), journal tenu (environnement `apercu`), jamais de dernière
utilisation ni de parcours de test.

Parcours de test : la création d'une clé de production devient possible quand une clé de test a réussi `GET /v1/etat`, une simulation,
une commande, sa relecture, son annulation et un rejeu avec la même `Idempotency-Key` (étapes montrées dans « Accès API ») ;
l'admin peut toujours valider le test à la main (tracé).

## 8. Ce qui ne sort jamais

Plomberie interne (relais, Odoo, Supabase, PharmaML), e-mails, numéro ou nom de la liste de prix, quantités de stock exactes,
prix d'achat, texte libre d'une commande du site, messages techniques du relais. Le journal ne garde ni corps, ni IP
complète, ni numéro de commande dans la route.

## 9. À faire par Zineb avant la mise en service

Voir `docs/api/mise-en-service.md` (pas à pas) :

- exécuter `sql/api-schema.sql` (il se rejoue sans effet) ;
- cocher les prérequis P1, P3, P4, P7 et P9 quand ils sont faits ; puis ouvrir « Commandes par API ».

## 10. Documentation : garder la page et l'OpenAPI justes

Toute évolution d'une route, d'un champ de réponse, d'un code d'erreur, d'une limite ou d'une valeur par défaut doit être
reportée dans `docs/api/openapi.yaml` ET dans `public/api/index.html` : `scripts/test-api-openapi.mjs` échoue sinon
(champ non documenté, statut ou code non prévu, ancre `#erreur-<code>` absente, débit ou plafond différent du code). Seuls
des ajouts compatibles dans `/v1` ; une rupture ouvre `/v2` avec six mois de préavis. Mettre à jour `VERSION_API`,
`DERNIERE_MODIFICATION` (`_api-config.js`), `info.version` de l'OpenAPI et le journal des changements de la page.

## 11. Avis par e-mail des clés et alertes d'usage (P9, `_api-avis.js`)

Règles appliquées (constantes `AVIS` et `ALERTES` de `_api-config.js`) :

- **E-mail d'avis** à chaque clé **créée, remplacée ou révoquée**, depuis le compte de la pharmacie (`api-compte`), depuis
  l'admin (`api-admin` : clé « sans compte », révocation) ou automatiquement (`api-cron`). Destinataires : les adresses de
  compte du site de la fiche **encore présentes sur la fiche Odoo** (celles de l'Assistant : `identifier()`, ou
  `comptesEmailDeFiche`) ; copie à Elixir (`GP_ADMIN_MAIL`, à défaut `pharmacien@elixirpharma.fr`) pour une clé de
  **production** ou une révocation automatique ; fiche sans aucune adresse de compte : Elixir seul, avec la mention. L'e-mail
  ne contient **jamais la clé** : son début (`prefixe`), son nom, ses droits, l'environnement, la date, l'origine (compte,
  Elixir, automatique), et ce qu'il faut faire si l'opération n'est pas attendue. Envoi par `mail.mail` d'Odoo (comme les
  justificatifs et les alertes du relais), avec un Message-ID propre à (clé, avis) : une reprise retrouve le message déjà
  créé dans Odoo et ne l'envoie jamais deux fois.
  - **Dans la requête** (création, remplacement, révocation), la 1re tentative est bornée à **3 s** en tout (2,5 s par appel
    à Odoo) : la réponse qui porte le secret d'une clé part toujours avant le délai des fonctions Netlify. Une marque
    `avis_en_attente` (non affichée) est posée **avant** l'envoi ; la réponse dit `avis_envoye: true | false`.
  - **Échec** (Odoo muet ou lent, état « exception » de la messagerie, adresses de compte illisibles) : événement
    `avis_echec`, **jamais** la version « Elixir seul » (réservée à une fiche dont la lecture a réussi et qui n'a aucune
    adresse). `api-cron` reprend au passage suivant une marque restée seule depuis 2 min (fonction coupée), et un échec
    après 15 min, puis 2 h, puis 8 h : **4 tentatives** en tout, sur une dizaine d'heures. La dernière échouée porte
    `abandon: true` et une notification demande à Elixir de prévenir la pharmacie. 3 reprises au plus par passage.
  - Créations et remplacements de clés depuis le compte d'une pharmacie : **10 par heure** et par fiche au plus
    (`CLES_CREATIONS_HEURE`, `429 trop_d_operations`) ; la révocation n'est jamais limitée.
  - Elixir reçoit toujours en plus une notification de l'admin pour une clé de production.
- **Alertes** (`api-cron`, toutes les 15 min ; chacune = événement `alerte_*` à `role: systeme`, notification à Elixir et
  e-mail à Elixir — l'e-mail est tenté une fois : la notification et l'onglet 🔌 API font foi ; **jamais deux fois pour le
  même fait**, les événements eux-mêmes servant de mémoire ; 5 alertes et 3 révocations automatiques au plus par passage,
  le reste au passage suivant ; aucun envoi commencé au-delà de 8,5 s depuis le début du passage, et cette étape tourne même
  si l'étape des prix a échoué) :
  - `alerte_cle_inactive` : clé active sans appel depuis **90 jours** (jamais utilisée : depuis sa création) ; à
    **180 jours**, elle est **révoquée automatiquement** (`cle_revoquee`, `role: systeme`, motif « inutilisée depuis N jours »)
    avec e-mail à la pharmacie et copie Elixir. Contrôle une fois par jour (première passe de 7 h, heure de Paris) ; une clé
    réutilisée puis oubliée de nouveau est signalée de nouveau ;
  - `alerte_nouveau_reseau` : une clé déjà utilisée avant la fenêtre (30 min) appelle depuis un réseau (`/24` ou `/64`)
    jamais vu pour elle dans le journal ; une alerte par clé et par jour, qui nomme jusqu'à 5 réseaux ; sans objet pour un
    accès à réseaux autorisés ;
  - `alerte_reseau_refuse` : appels refusés `ip_non_autorisee` dans la dernière heure ; une alerte par clé et par jour ;
  - `alerte_erreurs` : au moins **20 appels** sur la dernière heure et au moins **20 % de 4xx**, refus de réseau exclus
    (déjà « réseau refusé ») ; une alerte par clé et par heure ;
  - `alerte_volume` : appels du jour (heure de Paris) d'au moins **300** et supérieurs à **3 ×** la moyenne journalière des
    14 jours précédents (clés utilisées aujourd'hui ; contrôle à la première passe de chaque heure) ; une alerte par clé et
    par jour.
  Les appels faits sur un hôte d'aperçu (`environnement: apercu`) ne comptent pas. Le journal relu est borné à 5 000 lignes
  par passage (`journal_tronque` dans le bilan au-delà). Détails des événements : jamais d'adresse IP complète (réseaux
  seulement), jamais d'e-mail autre que `par`.
- **Où les voir** : onglet 🔌 API, section « Alertes » (30 jours), historique de chaque accès (avis envoyés ou en échec,
  alertes), notifications de l'admin ; la pharmacie voit la mention des avis dans « Accès API ». Un résumé quotidien par
  e-mail n'est pas prévu en V1.
- **Tests** : `scripts/test-api-avis.mjs` (faux Odoo : aucun e-mail réel).
