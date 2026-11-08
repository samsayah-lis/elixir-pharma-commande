# Envoi direct au portail PharmaML maison — plan de mise en service

Rédigé le 08/11/2026. Rien n'est poussé ni déployé : chaque étape ci-dessous attend l'accord explicite de Zineb.

## 1. Ce qui change

**Site de commande** (`elixir-pharma-repo`, branche `pml-direct`, dossier `elixir-commande`) :
- le relais a désormais deux voies, choisies dans l'admin (onglet Commandes, bandeau « Relais PharmaML ») :
  - **agent** (par défaut, comportement actuel) : l'agent du Mac envoie à InfoSoft ;
  - **portail** : Netlify envoie lui-même au portail maison (`https://pml.elixirpharma.fr/commandes.php`, canal
    compatible InfoSoft).
- La voie est choisie au moment où une tâche est prise : la bascule vaut pour toutes les tâches pas encore parties,
  et une tâche n'est jamais envoyée par les deux voies.
- Garanties conservées : file `pmlr:*`, écriture conditionnelle, réservation des lignes, empreinte 2 h, états
  (`incertaine` = vérification humaine, jamais de renvoi automatique), comptes rendus pour l'admin et Sanofi Pro,
  alertes.
- Ajouts de la voie portail :
  - contrôle de l'officine avant l'envoi : elle doit être `active` au portail et rattachée à sa fiche Odoo, sinon
    rien ne part et une alerte prévient (le pont n'écrirait pas la commande dans Odoo) ;
  - vérification automatique des envois `incertaine` par l'API du portail toutes les 5 min (retrouvé avec le même
    contenu → confirmé ; jamais libéré automatiquement) ;
  - une référence déjà reçue par le portail n'est acceptée qu'avec un contenu identique ;
  - pause automatique sur identifiants refusés, hôte inconnu ou trop de tentatives.
- Lecture des deux sources (InfoSoft + portail maison) pour Sanofi Pro (contrôles avant, pendant et après l'envoi)
  et pour le repérage des justificatifs labos. Si une source configurée est illisible, le contrôle échoue : aucun
  envoi « à l'aveugle ».

**Outil réappro** (`elixir-reappro-netlify`, branche `lecture-portail`) :
- Manquants pharma et produits inconnus : lecture des deux sources, sans double compte (règle du MAX inchangée),
  cache séparé pour le portail (`pml1/jour/…`).
- Vyndaqel → Pfizer : détection dans les deux sources, avec un garde-fou anti-double envoi (même pharmacie, même
  référence, à moins de 30 min d'écart = même commande).
- Fichier réappro : calculé depuis Odoo (lecture seule, même en-tête que le fichier InfoSoft) ; le calcul InfoSoft
  reste disponible au choix dans la page pendant la transition.

## 2. Prérequis à vérifier avec Zineb ou la session principale (AVANT toute mise en service)

État relevé par la session principale le 08/11 à 11 h 30 : P1 et P5 faits ; P2, P3 et P4 à faire par Zineb.

| # | Vérification | Comment |
|---|---|---|
| P1 | ✅ Portail en v1.16.0 en production (depuis le 08/11 11 h 26) | — |
| P2 | ⏳ Deux clés d'API **en lecture seule** à créer : « Site de commande (lecture) » et « Outil réappro (lecture) » | Zineb : Paramètres › Clés d'API, case « Lecture seule » |
| P3 | ⏳ Identifiants d'injection à poser (login + mot de passe d'au moins 16 caractères) ; le mot de passe reste chez Zineb, qui le met elle-même dans Netlify | Zineb : Paramètres › « Compatibilité InfoSoft (commandes.php) » |
| P4 | ⏳ Nom d'hôte à déclarer (la liste est vide : une injection répondrait aujourd'hui « Hôte inconnu »). Avant la bascule DNS, `pharmaml.elixirpharma.fr` pointe encore vers InfoSoft : déclarer `pml.elixirpharma.fr`. Effet de bord : `POST /`, `/commande`, `/commandes` sur ce nom iront au fournisseur Elixir (sans gêne tant qu'Elixir est le seul fournisseur) | Zineb : Paramètres › Comportement, liste des noms d'hôte |
| P5 | ✅ Les 497 officines d'Odoo chargées et actives (depuis le 08/11 11 h 29). Le contrôle du site exige aussi `ref_erp` (fiche Odoo) : à confirmer par un `GET /api/v1/officines` avec la clé de lecture | — |
| P6 | Pont en mode liste « toutes » : il écrit dans Odoo toute commande de production du portail ; capacité à surveiller à ~1 400 bons/jour | tableau de bord du portail, carte « Pont Odoo » |
| P6b | Aucun essai d'injection qui crée une commande en production : l'essai du bouton « Tester » envoie une liste vide (rien n'est créé) | — |
| P7 | Entrepôt prévenu : les commandes du site et de Sanofi Pro arriveront dans le bon « Ouvert » de la pharmacie (fermé à la main) | Zineb |
| P8 | Adresse d'alerte du relais (`pmlr:config.alertes`) lue par quelqu'un qui agit, week-end compris | admin, bandeau Relais |

## 3. Variables Netlify à poser (par Zineb ; jamais affichées)

Site de commande (`commandes-elixir`) :
- `PML_PORTAIL_URL` = `https://pml.elixirpharma.fr` (ou l'hôte dédié de P4)
- `PML_INJECTION_U`, `PML_INJECTION_P` = identifiants d'injection (P3)
- `PML_CLE_LECTURE` = clé « Site de commande (lecture) » (P2)
- `PML_SOURCES` : facultatif. Sans elle : InfoSoft + portail dès que la clé est posée. `portail` seul à la fin d'InfoSoft.

Outil réappro (`elixir-reappro`) :
- `PML_PORTAIL_URL`, `PML_CLE_LECTURE` (clé « Outil réappro (lecture) »), `PML_SOURCES` (même règle).

Une variable Netlify ne prend effet qu'au déploiement suivant.

## 4. Ordre de mise en service (chaque étape : accord de Zineb, heure creuse, vérification avant/après)

1. **Outil réappro** (lecture seule, aucun risque d'envoi) : variables, puis fusion de `lecture-portail` sur `main` et
   poussée (déploiement automatique). Vérifier : Manquants (« Sources : InfoSoft + portail maison », aucune erreur),
   Vyndaqel `?test=portail` (deux sources lisibles), fichier réappro « Odoo » comparé au fichier InfoSoft du même jour
   (`node scripts/comparer-reappro.mjs <odoo.csv> <infosoft.csv>` : écarts attendus de l'ordre de 1 à 2 %, voir § 6).
2. **Site, voie agent** : variables, puis mise en ligne de `pml-direct` sans changer la voie. Rien ne change pour
   l'envoi ; la lecture double est active (Sanofi Pro, justificatifs). Vérifier : bandeau Relais (voie « agent »),
   onglet Justificatifs « Tester » (deux sources), un passage Sanofi Pro sans erreur.
3. **Essai de la voie portail sans commande** : bouton « 🔌 Tester » (voie portail) → attendu « identifiants et hôte
   OK » (le portail répond 400 « Format invalide » à une liste vide, sans rien créer) et « clé de lecture OK ».
4. **Bascule voie → portail** (bouton du bandeau, heure creuse, équipe prévenue). Suivre la première commande du
   site : tâche « envoyée » avec son n° portail → commande au portail (canal infosoft) → intégrée dans Odoo par le pont
   (`ref_erp` S…) ; puis la première commande Sanofi Pro (SP…) jusqu'à « Traiter ».
5. **Agent du Mac** : le laisser tourner quelques jours (il ne prend plus rien en voie portail, son battement reste
   visible) ; puis l'arrêter sur les deux Mac (`launchctl bootout gui/$UID/fr.elixirpharma.agent-pharmaml`) en gardant
   l'installation pour un retour arrière.
6. **Fin d'InfoSoft** (après la dernière officine basculée + 3 mois) : `PML_SOURCES=portail` sur les deux sites, puis
   le choix « Portail InfoSoft » du fichier réappro peut être retiré.

## 5. Retour arrière

- Envoi : bouton « voie → agent » du bandeau (effet immédiat pour toutes les tâches pas encore prises) ; relancer
  l'agent du Mac s'il a été arrêté (`launchctl kickstart -k gui/$UID/fr.elixirpharma.agent-pharmaml`).
- Les envois `incertaine` de la voie portail restent à vérifier sur le portail maison (référence) avant toute
  nouvelle saisie ; boutons « vérifié : pas dans PharmaML / arrivé ».
- Lecture : `PML_SOURCES=infosoft` puis redéploiement.
- Code : redéployer le déploiement Netlify précédent (site et outil réappro).

## 6. Points d'attention

- **Risque accepté par Zineb** : InfoSoft ne déduit plus de son stock ni de ses quotas les commandes du site et de
  Sanofi Pro pour les pharmacies qu'il sert encore.
- **Officine pas prête au portail** : sa commande n'est pas envoyée (alerte, ligne rendue à la synchro manuelle) ;
  la synchro manuelle passe aussi par le portail. Remède : activer l'officine au portail, ou repasser
  temporairement toute la voie en agent.
- **Fichier réappro Odoo** : compte les lignes de commandes PharmaML d'Odoo (`from_pharmaml`), par date de création
  de la ligne. Comparaison faite le 08/11 sur la période du fichier InfoSoft du 05/10/2026 (05/09 → 05/10 11 h 16),
  calcul réel sur Odoo en lecture seule (6,8 s, 4 357 produits) : 4 355 références communes, 37 seulement chez InfoSoft,
  2 seulement dans Odoo ; « Commandés » identique pour 90 % des produits (95e centile d'écart 1,5 %), « Livrés »
  identique pour 95 % (95e centile 0,3 %), « Nb Commandes » 95e centile 11 % ; « En stock » non comparable (stock
  du jour contre stock du 05/10). Un écart isolé : 5413206336814 (InfoSoft 141 livrés, Odoo 675). Colonnes Laboratoire et PFHT remplies pour des produits que
  le catalogue InfoSoft ne connaissait pas. « En stock » = stock vendable EP/Stock, réservé non déduit (comme l'onglet
  SRA) — à confirmer par Zineb.
- **Manquants au portail** : lus jour par jour par l'API (500 commandes par page). À 497 officines (~1 400
  commandes/jour), un jour non mis en cache demandera plusieurs pages : le premier chargement d'une période peut être
  partiel (jours relus au chargement suivant, puis en cache). Si c'est trop lent, demander au portail une route
  « lignes non servies » agrégée.
- **Produits inconnus au portail** = lignes dont le code n'a pas été reconnu au catalogue à la réception
  (`cip13_reconnu` vide).

## 7. Code et vérifications (08/11/2026)

Rien n'est commité : les deux branches sont dans des worktrees, modifications en cours.

**Site** — worktree `~/Downloads/elixir-pml-direct-wt` (branche `pml-direct`, issue d'`origin/master` a3dd5ee) :
- `netlify/functions/_portail-pml.js` (nouveau) : client du portail (injection, lecture, contrôle de contenu, essai
  sans commande, sources lues, conversion au format des lignes InfoSoft) ; aucun identifiant ne sort du module.
- `_relais.js` : voie choisie à la prise (`agent` | `portail`), `envoyerDirect`, classement des réponses du portail,
  pause par voie, vérification automatique des envois incertains, `ecrireVoie`.
- `pml-relais.js` (action `voie_save`, essai portail), `pml-relais-cron.js` (budget 22 s), `submit-order.js`,
  `netlify.toml` (délai 26 s pour `submit-order` et `pml-relais`).
- `_sanofipro.js`, `sanofipro.js` : envoi par la voie courante, lecture des deux sources.
- `_lab-justif.js`, `lab-justif.js` : repérage dans les deux sources, anti-doublon entre sources.
- Écrans : `AdminRelais.jsx` (voie, bascule, essai, lieu de vérification), `AdminSanofiPro.jsx`,
  `AdminLabJustif.jsx`, textes de suivi dans `AdminPanel.jsx`.
- `scripts/verifie-zones.mjs` : fichiers déclarés (empreintes).
- Bancs hors ligne : `node scripts/test-relais-portail.mjs` (40 cas), `node scripts/test-sanofi-justif-portail.mjs`
  (19 cas) ; `npm run lint`, `npm run build`, `npm run zones` : verts.

**Outil réappro** — worktree `~/Downloads/elixir-reappro-pml-wt` (branche `lecture-portail`, issue d'`origin/main` 42ae794) :
- `netlify/functions/_portail-pml.js` (nouveau, lecture seule), `manquants.js`, `_vyndaqel.js`, `vyndaqel.js`,
  `public/index.html` (onglet Manquants, choix de la source du fichier réappro).
- `netlify/functions/reappro-odoo.js` (nouveau), `netlify.toml` (délai 26 s).
- Bancs : `node scripts/test-lecture-portail.mjs` (18 groupes), `node scripts/test-reappro-odoo.mjs` ;
  comparateur `node scripts/comparer-reappro.mjs A.csv B.csv`.

Non vérifié : aucun appel au portail réel (pas de clé de lecture, hôte non déclaré), écrans admin non affichés dans un
navigateur, exécution sous Node 18 (bancs passés sous Node 24 ; code écrit sans API récente). Le calcul réappro, lui,
a tourné sur le vrai Odoo en lecture seule (§ 6).
