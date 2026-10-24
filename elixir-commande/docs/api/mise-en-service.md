# API des pharmacies — mise en service

Pour Zineb. État au 24/10/2026 : le code est prêt sur la branche `api-pharmacies` (commits locaux, rien n'est en ligne).
Documents liés :

- `docs/api.md` : règles appliquées par le code (contrat interne) ;
- `docs/api/openapi.yaml` : description OpenAPI 3.1, servie aux pharmacies à `/api/openapi.yaml` ;
- `public/api/index.html` : documentation des pharmacies, servie à `/api/` (et `/api/docs`).

Dépôt public : ce fichier ne contient ni secret ni donnée réelle.

**En une phrase.** Une fois en ligne, la lecture (catalogue à leurs prix, disponibilités, contingents, commandes,
factures, bons de livraison) et les commandes de **test** fonctionnent tout de suite. Les commandes **réelles** restent
refusées (`503 ecriture_suspendue`) tant que P1, P3, P4, P7 et P9 ne sont pas cochés et que vous n'avez pas ouvert
l'interrupteur « Commandes par API ». P9 (avis par e-mail et alertes) ne peut pas encore être coché : son développement
reste à livrer.

---

## 1. Mise en ligne, dans l'ordre

### 1.1 SQL (une fois, puis à chaque nouvelle version du fichier)

1. Supabase → **SQL Editor** → nouvel onglet.
2. Collez tout le contenu de `sql/api-schema.sql`, puis **Run**.

Le fichier se rejoue sans effet : vous pouvez le relancer autant de fois que nécessaire. Il crée les tables privées de l'API :

- `api_reglages` (interrupteurs et prérequis) ;
- `api_acces`, `api_cles`, `api_commandes`, `api_journal`, `api_evenements` ;
- `api_compteurs` (débits) ;
- `api_prix` et `api_prix_listes` (prix de chaque liste).

Il ajoute aussi :

- la colonne `api_acces.test_parcours` ;
- le droit « documents » (factures, avoirs, bons de livraison), séparé de « lecture » ;
- l'index qui libère la référence d'une commande annulée (`api_commandes_reference_v2`) et celui de la recherche par
  `X-Request-Id` ;
- les fonctions `api_fenetre` (le « jour » des débits est le jour de Paris) et `api_marquer_lignes` (marques
  d'annulation posées en une seule fois).

Toutes ces tables et fonctions sont fermées : RLS activé, aucune policy, droits retirés à anon et authenticated. Seules
les fonctions du serveur y accèdent.

**Vérification** (même éditeur) :

```sql
-- 1. toutes les tables api_* : RLS activé (relrowsecurity = true)
select relname, relrowsecurity from pg_class where relkind = 'r' and relname like 'api\_%' order by 1;
-- 2. aucune policy : doit répondre 0
select count(*) from pg_policies where tablename like 'api\_%';
-- 3. la clé du navigateur ne lit rien : doit répondre false
select has_table_privilege('anon', 'public.api_cles', 'select');
-- 4. fonctions réservées au serveur : doit répondre false, false
select has_function_privilege('anon', 'api_marquer_lignes(text, int[], text, text)', 'execute'),
       has_function_privilege('anon', 'api_compter(text, int)', 'execute');
```

### 1.2 Variables Netlify

Rien de nouveau. L'API utilise deux variables déjà en place :

- `SUPABASE_SERVICE_ROLE_KEY` (depuis le 19/10) ;
- `CRON_SECRET`.

Vérifiez seulement qu'elles existent avec la portée « Functions ». Ne les affichez pas.

### 1.3 Protéger les adresses de déploiement (Netlify, une fois, AVANT le déploiement)

Chaque déploiement Netlify garde sa propre adresse (`<identifiant>--commandes-elixir.netlify.app`), qui fait tourner le
code de CE déploiement, même ancien. L'API n'y accepte que les clés de test, mais protégez-les quand même :

1. Netlify → le site → **Site configuration → Access & security → Visitor access** (« Password protection ») ;
2. choisissez la protection des déploiements **hors production** (aperçus de branche et liens permanents des
   déploiements), avec un mot de passe connu de l'équipe ;
3. vérifiez : l'adresse d'un ancien déploiement (Netlify → Deploys → un déploiement → lien « Permalink ») demande le mot
   de passe, et `https://elixir-commande.expepharma.com/api/` reste ouverte.

Si votre offre Netlify ne propose pas cette protection, dites-le moi : l'API refuse déjà les clés de production sur ces
adresses et y note chaque appel au journal (environnement « aperçu »).

### 1.4 Déploiement

Je ne pousse rien moi-même. Quand vous le décidez, la branche `api-pharmacies` est fusionnée dans `master`, puis Netlify
construit le site comme d'habitude.

Ce qui part avec ce déploiement :

- le routeur `/api/v1` ;
- deux fonctions planifiées :
  - `api-cron` (toutes les 15 min : prix des listes, ménage) ;
  - `api-commandes-cron` (toutes les 2 min : envoi des commandes dont le délai est écoulé) ;
- l'onglet admin 🔌 API ;
- le panneau « Accès API » de « Mes commandes » ;
- la documentation `/api/`.

### 1.5 Vérifications après la mise en ligne (5 minutes)

1. `https://elixir-commande.expepharma.com/api/` affiche la documentation.
2. `/api/docs` renvoie vers `/api/`, et `/api/openapi.yaml` se télécharge.
3. Sans clé, l'API répond bien `401` :

   ```bash
   curl -i https://elixir-commande.expepharma.com/api/v1/etat
   ```

   On attend `401`, `Content-Type: application/problem+json`, `"code":"cle_absente"` et un en-tête `X-Request-Id`.
4. Dans l'onglet admin **🔌 API**, on lit :
   - « API en service » ;
   - « Commandes par API (production) : fermées » ;
   - les prérequis, tous décochés (P9 grisé : « développement à livrer avant l'ouverture des commandes réelles »).
5. Netlify → Functions : `api-cron` et `api-commandes-cron` sont marquées « Scheduled ». Tant qu'aucun accès n'est ouvert,
   leurs journaux ne montrent rien d'autre qu'un passage à vide.

---

## 2. Prérequis P1 à P8

Seules les cinq cases de l'onglet 🔌 API (P1, P3, P4, P7, P9) commandent l'interrupteur « Commandes par API ». Il ne
s'ouvre que quand elles sont toutes cochées, et décocher une case le referme aussitôt. P2, P5, P6 et P8 se vérifient à la
main, avec la liste ci-dessous.

La lecture et le mode test peuvent servir dès la mise en ligne : ils n'écrivent que dans les tables privées `api_*` et
n'élargissent pas l'exposition actuelle de la base.

| # | Prérequis | Nécessaire pour | Qui | État au 24/10/2026 | Case de l'onglet |
|---|---|---|---|---|---|
| **P1** | Sécurisation de la base de données : étape 2 et Bloc 1 du plan terminés | Toute commande réelle (détail dans le plan de sécurisation du 19/10, hors dépôt) | Zineb (SQL) + Claude | À faire | Oui |
| **P2** | Tables `api_*` créées fermées (`sql/api-schema.sql`, rejoué pour `test_parcours`) | Tout | Zineb | À faire (§ 1.1) | Non (requêtes du § 1.1) |
| **P3** | Fin de la quarantaine des commandes du site (02/11/2026) | Écriture | — | Date | Oui (impossible à cocher avant le 02/11/2026) |
| **P4** | Identifiants du relais renouvelés et envoi automatique du site stable | Envoi automatique des commandes API | Zineb | À faire | Oui |
| **P5** | Numéros de commande « 18… » et « 19… » reconnus par le suivi | Suivi des commandes après le 15/01/2027 | Claude | Fait (fb2a76b, en production) | Non |
| **P6** | Lecture du stock par lots | Grosses commandes | Claude | Fait côté API (voir ci-dessous) | Non (non bloquant) |
| **P7** | Conditions d'utilisation de l'API validées par un avocat (dossier BPDG validé) | Commandes réelles | Zineb (avocat + pharmacien responsable) | À faire (projet au § 6) | Oui |
| **P8** | Entretien avec chaque pharmacie demandeuse (logiciel, outil, besoin, volume, PharmaML déjà paramétré ou non) | Avant d'ouvrir son accès | Zineb | À faire | Non |
| **P9** | Avis par e-mail des clés et alertes d'usage de l'API en place | Commandes réelles : la pharmacie et Elixir sont prévenus de chaque clé créée, remplacée ou révoquée ; alertes nouveau réseau, volume inhabituel, erreurs, clé inutilisée | Claude (développement), puis Zineb | À livrer (en attendant : notification à Elixir pour chaque clé de production) | Oui (grisée tant que ce n'est pas livré) |

Détail de P6 :

- l'API vérifie le stock en une seule lecture par commande, à l'acceptation puis à l'envoi ;
- le relais relit encore produit par produit (zone protégée, inchangée), mais dans une fonction d'arrière-plan de 15 min :
  aucun effet sur le délai de 10 s.

Libellés exacts des cases de l'onglet, repris du code :

- P1 : Sécurisation de la base de données : étape 2 et Bloc 1 du plan terminés
- P3 : Fin de la quarantaine des commandes du site (02/11/2026)
- P4 : Identifiants du relais renouvelés et envoi automatique du site stable
- P7 : Conditions d'utilisation de l'API validées par un avocat (dossier BPDG validé)
- P9 : Avis par e-mail des clés et alertes d'usage de l'API en place

---

## 3. Ouvrir l'accès d'une pharmacie

1. **Entretien (P8).** Si le besoin est le réassort courant, la bonne réponse est PharmaML depuis son logiciel
   d'officine : vérifiez qu'Elixir y est paramétré.
2. **Admin → 🔌 API → « Ouvrir un accès ».**
   - Recherchez la fiche (nom, ville, CIP ou e-mail), puis choisissez les droits (Lecture, Commande, Documents) et le mode
     (Automatique ou Bloqué). Une note interne est facultative.
   - Cliquez sur « Ouvrir l'accès ». La fiche est revérifiée : cliente Elixir, CIP présent.
   - La liste de prix de la fiche est lue, puis ses prix sont calculés. Dans « Prix des listes », elle passe de
     « Demandé » à « Calcul en cours », puis à « À jour », en général en moins d'une demi-heure. D'ici là, le catalogue
     de la pharmacie indique « prix en cours de calcul ».
3. **Réglages de l'accès**, si besoin, puis « Enregistrer les réglages ». Les valeurs ci-dessous sont celles données à
   l'ouverture :

   | Réglage | Défaut | Bornes |
   |---|---|---|
   | Délai d'annulation (min) | 10 | 0 à 20 |
   | Lignes par commande | 100 | 1 à 200 |
   | Boîtes par commande | 1 000 | 1 à 100 000 |
   | Montant HT par commande (€) | 3 000 | 1 à 1 000 000 |
   | Commandes par jour | 10 | 1 à 200 |
   | Anomalie : × la quantité mensuelle habituelle | 10 | 2 à 1 000 |
   | Anomalie : quasi-doublon sur (min) | 30 | 0 (coupé) à 1 440 |

   Deux autres réglages :
   - la case « Garder « à vérifier » les commandes anormales », cochée par défaut ;
   - « Réseaux autorisés », vide par défaut (tous les réseaux).

   Un plafond dépassé est un **refus explicite** (`422 plafond_depasse`), jamais une mise en attente.
4. **Message à la pharmacie.** Donnez-lui le lien `https://elixir-commande.expepharma.com/api/` et le chemin
   « Mes commandes » → « Accès API ». Elle :
   - accepte les conditions d'utilisation ;
   - crée sa clé de test ;
   - fait le parcours de test (six étapes) : le test se valide seul ;
   - crée enfin sa clé de production.
5. **Pharmacie sans compte du site** (variante tracée) :
   - « CGU signées (PDF) » : saisissez la référence du document signé ;
   - « Valider le test (passer outre) » si besoin, avec un motif ;
   - « Créer une clé (sans compte) » : un petit formulaire (environnement, droits, nom, motif). La clé n'est montrée
     qu'une fois. Remettez-la de vive voix, jamais par e-mail. Le journal note quel admin l'a vue.
6. **Pharmacie en lecture seule** : décochez le droit « Commande », ou passez le mode à « Bloqué ».

---

## 4. Interrupteurs et arrêt d'urgence

| Situation | Geste (onglet 🔌 API sauf mention) | Effet |
|---|---|---|
| Incident, abus, doute général | **Tout couper** (avec confirmation) | Toutes les routes répondent `503 api_suspendue`, sauf `/v1/etat` et l'annulation (une pharmacie peut toujours annuler), et les commandes réelles sont fermées. Les commandes encore dans leur délai ne partent pas : elles passent « à vérifier » (`envoi_suspendu`). « Remettre en service » rouvre l'API, mais pas les commandes réelles, qui se rouvrent à part. |
| Arrêter seulement les commandes réelles | **Fermer les commandes par API** (ou décocher un prérequis) | `POST /v1/commandes` avec une clé de production répond `503 ecriture_suspendue`. La lecture et le mode test continuent. Les commandes dans leur délai passent « à vérifier ». |
| Une pharmacie pose problème | **Suspendre l'accès** (motif tracé) | `403 acces_suspendu` sur toutes ses routes. |
| La pharmacie peut lire mais ne doit plus commander | Mode **Bloqué** | Ses commandes sont refusées (`403 commandes_bloquees`) et celles en attente ne partent pas. La lecture continue. |
| Une clé a fui | **Révoquer** (dans l'onglet, ou par la pharmacie dans « Accès API ») | `401 cle_revoquee` aussitôt pour les commandes et annulations, en moins d'une minute pour les lectures. Une notification vous prévient de chaque clé de production créée, remplacée ou révoquée. |
| Un produit ne doit pas se commander par l'API | « Produits exclus des commandes par API » | La ligne est refusée (`produit_non_commandable`, « à commander sur le site »). |
| Envoi automatique du relais coupé | Bandeau du relais (onglet relais, `autoSite`) | Les commandes API dont le délai se termine passent « à vérifier » (`envoi_manuel`). Il faut les synchroniser à la main. |

Une commande déjà partie vers PharmaML ne se rattrape pas par ces interrupteurs, comme une commande du site.

---

## 5. Surveillance au quotidien

### 5.1 Onglet Commandes

- Les commandes de l'API portent le badge **🔌 API**. Pendant le délai, il indique « annulable jusqu'à hh:mm ».
- **🔌 API · À VÉRIFIER** :
  - « Sync » valide la commande et l'envoie ;
  - « Traiter sans envoi » retire une ligne : la pharmacie la voit `traitee_par_elixir`.
- Les commandes API ne partent jamais avec « Sync toutes ». « Sync » pendant le délai demande une confirmation, parce que
  la pharmacie peut encore annuler.
- **⚠ 🔌 inconnue de l'API** ou **état API inconnu** : commande marquée « api » sans trace d'acceptation (ou enregistrement
  interrompu). Elle ne part jamais seule ; « Sync » demande une confirmation : appelez d'abord la pharmacie. Une
  notification vous la signale une fois.
- L'onglet **🔌 API** porte une pastille : nombre de commandes API « à vérifier » (et inconnues de l'API) en attente. Dans
  « Commandes reçues par l'API », cliquez sur un numéro pour aller à la commande dans l'onglet Commandes.

| Motif « à vérifier » | Cause | Que faire |
|---|---|---|
| `anomalie_quantite` | Ligne au-delà de 10 × la quantité mensuelle habituelle (6 mois, tous canaux ; plancher 3 boîtes par mois) | Appeler la pharmacie si besoin, puis Sync, ou retirer la ligne |
| `quasi_doublon` | Presque les mêmes produits qu'une commande de moins de 30 min (site, API, logiciel) : 80 % de produits communs, en comptant ceux des deux commandes | Vérifier le doublon avant Sync |
| `envoi_suspendu` | API, commandes par API ou accès coupés pendant le délai | Sync quand tout est rouvert, ou laisser la pharmacie annuler |
| `envoi_manuel` | Envoi automatique du relais coupé | Sync à la main |
| `envoi_manque` | Envoi automatique plus de 30 min en retard, ou erreur passagère qui a duré plus de 22 min (l'envoi est réessayé toutes les 3 min avant) | Sync à la main |
| `doublon_recent` | Le relais a vu une commande identique de moins de 2 h | Vérifier avant Sync |
| `precommande` | Lignes en rupture gardées (`si_rupture: garder`) | Sync au retour du stock |
| `rupture_envoi` | Ligne sans stock au moment de l'envoi | « Traiter sans envoi » sur ces lignes, ou Sync au retour du stock |
| `commande_modifiee` | Lignes ou pharmacie changées depuis l'acceptation | Ne pas envoyer : comparer avec l'onglet 🔌 API, puis me prévenir |
| `erreur_transmission`, `envoi_a_verifier`, `reprise` | Envoi interrompu ou reprise après une coupure | Regarder l'état du relais, puis Sync si rien n'est parti |

### 5.2 Onglet 🔌 API

- **Commandes reçues par l'API** : commandes réelles et de test, avec état, motif et référence, sans jamais le corps.
- **Journal des appels** : 500 derniers appels, filtres « Erreurs seulement » et « Cette pharmacie », « Export CSV », et
  **« Rechercher un X-Request-Id »** (l'identifiant donné par la pharmacie, quel que soit son âge, copiable). Les appels
  faits sur une adresse de déploiement sont marqués « (aperçu) ». Pendant le pilote, un coup d'œil par jour sur
  « Erreurs seulement » suffit.
- **Prix des listes** : état du calcul de chaque liste et bouton « Recalculer ».
- **Clés** d'un accès : dernière utilisation, appels sur 24 h, « Révoquer ».

### 5.3 Autres sources

- **Support.** La pharmacie donne le `X-Request-Id` de la réponse (elle le voit aussi dans « Accès API » → « Derniers
  appels »). Collez-le dans « Rechercher un X-Request-Id » du journal, ou cherchez-le dans les journaux Netlify de la
  fonction `api-v1`, en lignes JSON.
- **Notifications.** Chaque commande API réelle crée une notification « Commande API de … », précédée de
  « ⚠ À vérifier — » si elle est gardée. Aussi : toute commande que l'envoi ou le passage planifié garde « à vérifier »,
  toute commande « api » inconnue de l'API, et chaque clé de production créée, remplacée ou révoquée (« 🔑 Clé API de
  production … »).
- **Conservation** :
  - journal des appels : 13 mois (purge automatique) ;
  - compteurs de débit : 2 jours ;
  - commandes reçues par l'API : gardées, comme preuve (5 ans prévus ; purge pas encore programmée).
- **Pas encore fait** (prérequis P9, bloquant pour les commandes réelles) :
  - e-mails d'avis à la pharmacie (copie à Elixir) à la création, au remplacement ou à la révocation d'une clé ;
  - alertes automatiques : clé inactive depuis 90 jours (révoquée à 180), nouveau réseau, volume supérieur à 3 fois
    l'habitude, plus de 20 % d'erreurs ;
  - résumé quotidien par e-mail (V1.1).

---

## 6. Projet de conditions d'utilisation, à remettre à l'avocat

Ce texte est affiché aujourd'hui aux pharmacies, dans « Accès API », comme version **2026-10-24-projet**, avec cet
avertissement : « Version provisoire, en cours de validation juridique. Les commandes réelles par l'API ne seront
ouvertes qu'après sa validation ; vous serez alors invité à accepter la version définitive. »

**Titre : Conditions d'utilisation de l'API Elixir Pharma (projet)**

1. **Objet.** L'API permet à votre pharmacie, cliente d'Elixir Pharma, de consulter le catalogue à vos prix, la disponibilité, vos contingents et vos commandes, et de passer ou d'annuler des commandes depuis un outil de votre choix. Elle complète les conditions générales de vente, qui restent applicables.
2. **Clés d'accès.** Toute requête faite avec une clé valide est réputée faite par votre pharmacie, jusqu'à ce que vous signaliez sa compromission. Vous gardez vos clés secrètes (jamais dans une page web, un tableur partagé ou un message) et vous les révoquez sans délai depuis votre compte en cas de doute.
3. **Preuve.** Les enregistrements d'Elixir Pharma (commandes reçues par l'API, journal des appels) font foi, sauf preuve contraire.
4. **Formation de la commande.** La commande est formée à la réponse de l'API qui l'accepte. Elixir Pharma peut réduire ou refuser une ligne (stock, contingentement, plafonds, anomalie, obligations réglementaires). La disponibilité affichée est indicative.
5. **Prix.** Les prix donnés par l'API sont les prix hors taxes de votre liste de prix, hors offres réservées au site. Ils sont indicatifs : la facture applique vos conditions au jour de la livraison.
6. **Plafonds et contrôles.** Des plafonds par commande et par jour s'appliquent. Une commande qui présente une anomalie nette (quantité très supérieure à vos habitudes, quasi-doublon d'une commande récente) est gardée pour vérification avant envoi.
7. **Annulation.** Une commande peut être annulée par l'API pendant le délai d'annulation indiqué, tant que rien n'est parti. Ensuite, les réclamations et retours suivent les conditions générales de vente.
8. **Un seul canal par besoin.** Vous vous engagez à ne pas commander le même besoin à la fois par votre logiciel d'officine et par l'API, et vous assumez les doublons qui en résulteraient.
9. **Disponibilité du service.** Le service est fourni sans engagement de disponibilité. Le site, votre logiciel d'officine et le téléphone restent disponibles en secours. Elixir Pharma peut suspendre un accès immédiatement en cas d'abus ou de risque.
10. **Confidentialité et données.** Vos prix et conditions sont confidentiels : il est interdit d'aspirer, de diffuser ou de revendre le catalogue. Aucune donnée de patient ni ordonnance ne passe par l'API.
11. **Mode test et évolutions.** Le mode test est obligatoire avant toute clé de production. Toute évolution incompatible de l'API fait l'objet d'un préavis de six mois.
12. **Responsabilité.** La responsabilité d'Elixir Pharma est limitée aux dommages directs, dans la limite du montant de la commande en cause, sauf faute lourde ou dolosive.

**Comment fonctionne l'acceptation en ligne** (à faire valider aussi) :

- la pharmacie se connecte par code e-mail, avec une adresse encore enregistrée sur sa fiche client ;
- elle coche la case, puis clique ;
- sont enregistrés : la version, l'empreinte du texte affiché, le compte, la date et le réseau (préfixe, jamais l'adresse
  IP complète).

Une nouvelle version bloque les commandes (`403 cgu_a_accepter`) jusqu'à ce que la pharmacie l'accepte. Une variante
sur papier existe : signature d'un PDF, puis référence saisie dans l'admin.

**Questions à poser à l'avocat** :

1. **Imputabilité** (art. 2). Toute requête faite avec une clé valide est réputée faite par la pharmacie jusqu'au
   signalement : est-ce opposable, et faut-il préciser les obligations de garde, la révocation en un clic et le délai
   de prise en compte (moins d'une minute) ?
2. **Convention de preuve** (art. 3, art. 1356 du Code civil). Les preuves sont :
   - les commandes reçues, gardées 5 ans ;
   - le journal des appels, gardé 13 mois, sans corps de requête ni adresse IP complète.

   Faut-il des durées, ou des modalités de consultation par la pharmacie ?
3. **Formation de la commande** (art. 4 et 7). La commande est formée à la réponse 201, avec 10 minutes pour annuler ; une
   ligne peut être réduite (contingent) ou retirée (rupture). Est-ce compatible avec les CGV ? Faut-il un article sur la
   mise « à vérifier » en cas d'anomalie ?
4. **Prix indicatifs** (art. 5). Est-ce bien rédigé, sachant que la facture applique la liste de prix de la pharmacie au
   jour de la livraison ?
5. **Responsabilité** (art. 12). Le plafond est le montant de la commande en cause. Faut-il le vérifier au regard des
   art. 1170 et 1171 du Code civil (clause qui prive l'obligation essentielle de sa substance, déséquilibre significatif)
   et de l'art. L.442-1 du Code de commerce ?
6. **Un seul canal par besoin** (art. 8) : la clause est-elle suffisante pour les doublons entre le logiciel d'officine
   et l'API ?
7. **Confidentialité** (art. 10) : faut-il une clause d'interdiction d'extraction (droit des bases de données) ?
8. **Données personnelles.** Sont traités : l'e-mail du compte (identification) et le réseau tronqué (sécurité). Faut-il
   une mention d'information RGPD dans les CGU, ou un renvoi à la politique du site ?
9. **Modèle.** Faut-il s'appuyer sur l'accord type EDI (recommandation 94/820/CE) ? La clause de modification (nouvelle
   version à réaccepter) et les cas de suspension ou de résiliation sont-ils suffisants ?
10. **Gratuité.** Le service est gratuit. Faut-il écrire qu'il est « susceptible d'évoluer avec préavis » ?

**Après la validation :**

- je remplace la version et le texte dans `netlify/functions/_api-config.js` (constante `CGU`), en donnant une nouvelle
  date à la version ;
- les pharmacies acceptent la version définitive dans « Accès API » ;
- vous cochez P7.

**Dossier BPDG** (§ 3.3.1, pour le pharmacien responsable) :

- description : `docs/api.md`, ce fichier et `docs/api/openapi.yaml` ;
- tests : `scripts/test-api-fondations.mjs`, `test-api-lecture.mjs`, `test-api-commandes.mjs` et `test-api-openapi.mjs`,
  sur des données fictives, lancés avant chaque mise en ligne ;
- sauvegardes : celles de Supabase ;
- traçabilité : journal des appels et commandes reçues ;
- contrôles des ventes inhabituelles (§ 5.3) : plafonds par pharmacie et mise « à vérifier » des anomalies nettes.

---

## 7. Points ouverts (décisions)

1. **Articles livrés sous plusieurs références (fauteuils)** : refusés par l'API en V1 (« à commander sur le site »).
   À ouvrir si une pharmacie le demande.
2. **Menus promo et précommandes** :
   - aujourd'hui, ces produits se commandent par l'API **au prix de la liste**, jamais au prix du menu ;
   - seules les campagnes (U-Labs, campagnes actives) sont refusées.

   À confirmer.
3. **Catalogue.** Il ne signale pas encore les produits refusés à la commande (justificatif, campagnes, fauteuils,
   exclusions) : la ligne est refusée à la commande, avec son motif. Un champ « commandable » est prévu en V1.1.
4. **Seuil « stock faible »** : moins de 10 unités libres. À confirmer (jamais de quantité exacte rendue).
5. **Plafond du jour** : réglé — la place du jour est prise atomiquement avant le numéro de commande : des commandes
   simultanées ne dépassent jamais le plafond.
6. **Rejeu après fermeture** : réglé — une commande déjà acceptée, renvoyée avec la même clé après la fermeture de
   l'interrupteur, une nouvelle version des CGU ou le passage en « Bloqué », reçoit sa réponse d'origine.
7. **Commande traitée sans envoi.** Si toutes ses lignes ont été « traitées sans envoi » par Elixir, elle apparaît
   « transmise » (règle du site), avec des lignes `traitee_par_elixir`, et la pharmacie ne peut plus l'annuler par
   l'API (`409 trop_tard`).
8. **Adresse de l'API** : `https://elixir-commande.expepharma.com/api/v1`. Un sous-domaine dédié pourra venir plus tard
   si besoin.
9. **E-mails d'avis et alertes automatiques** : prérequis P9, voir § 5.3.
10. **Serveur partagé par plusieurs pharmacies** (éditeur de logiciel) : les 120 requêtes par minute avant la clé sont
    comptées par adresse IP ; une clé révoquée d'une pharmacie ne bloque plus les autres, mais le débit par IP reste
    commun. À relever pour ce cas, si une demande arrive.
11. **Page de l'admin restée ouverte** : « Traiter sans envoi » réécrit les lignes depuis la page ; sur une commande API
    annulée, les marques d'annulation effacées sont reposées par le passage planifié (2 min au plus).
