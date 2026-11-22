# CRM Elixir — conception

Onglet « CRM » de l'administration du site de commande, et adresse `#crm` pour les utilisateurs qui ne sont pas administrateurs. Objectif : suivre chaque pharmacie, cliente ou prospect, comme dans un CRM du marché (comptes, contacts, activités, opportunités, tableaux de bord), relié à Odoo, aux commandes du site et aux réclamations.

Ce dépôt est **public** : aucune donnée réelle (nom de pharmacie, adresse e-mail, montant, objectif chiffré) dans le code, les tests, les exemples ou cette documentation. Les données vivent dans Supabase et dans Odoo ; les objectifs chiffrés sont des réglages enregistrés en base.

## 1. Décisions (22/11/2026)

| Sujet | Décision |
|---|---|
| Emplacement | Onglet de l'admin du site de commande + adresse `#crm` (même appli, même base Supabase que le site). |
| Comptes et rôles | Comptes Supabase Auth ; rôle lu dans `app_metadata.role` (écrit côté serveur uniquement) : `admin`, `commercial`, `service_client`, `lecture`. Un rôle CRM explicite dans `app_metadata.role` est prioritaire ; à défaut seulement, les adresses de `ADMIN_EMAIL` sont `admin`. Un compte de pharmacie (sans rôle) n'a aucun accès. |
| Utilisateurs | Direction, commerciaux, service client et qualité, toute l'équipe en lecture. |
| Prospects | Toutes les officines du territoire, chargées depuis l'annuaire public (FINESS / Annuaire Santé), plus la saisie à la main. |
| Odoo | Lecture seule. Comptes clients, chiffre d'affaires, marge, factures lus dans Odoo ; contacts, activités, opportunités, prospects et notes dans la base du CRM. |
| Réclamations | Réclamations et tickets restent dans l'outil entrepôt ; la fiche compte les lit par une API serveur signée HMAC-SHA256, pour la fiche commerciale Odoo et ses enfants (50 identifiants maximum, société 2). Consultation par tous les rôles CRM, sans écriture dans l'entrepôt. |

## 2. Droits

| Action | admin | commercial | service_client | lecture |
|---|---|---|---|---|
| Voir comptes, contacts, activités, opportunités, CA | oui | oui | oui | oui |
| Voir la marge | oui | non | non | non |
| Créer un prospect ou un contact ; modifier les champs CRM de tout compte (champs Odoo protégés) | oui ; statut du prospect réservé à l’admin | oui ; prospect sans changer son statut | contacts seulement | non |
| Créer une activité (appel, visite, e-mail, note, tâche) | oui | oui | oui | non |
| Modifier ou clore une activité | toutes | les siennes (auteur ou assignée) | les siennes | non |
| Créer ou modifier une opportunité | toutes | les siennes (propriétaire) | non | non |
| Attribuer un compte à un commercial, archiver | oui | non | non | non |
| Équipe (rôles, territoires) et réglages | oui | non | non | non |

Tous les droits sont appliqués par le serveur ; l'écran ne fait que les refléter. La marge est retirée des réponses avant l'envoi pour les rôles qui ne la voient pas.

## 3. Données (Supabase, tables `crm_*`)

RLS activé sans politique, droits retirés à `anon` et `authenticated` : les tables ne sont lisibles qu'avec la clé serveur `SUPABASE_SERVICE_ROLE_KEY`, depuis les fonctions du CRM (même principe que les tables `chat_*`). Chaque table modifiable porte `version` (écriture conditionnelle : une modification faite sur une version périmée est refusée, 409).

- `crm_comptes` : pharmacie cliente ou prospect. `odoo_id` (fiche commerciale, unique si renseigné), `finess` (unique si renseigné), `siret`, `cip`, nom, adresse, code postal, ville, département, téléphone, e-mail, `statut` (`prospect`, `client`, `ancien_client`, `hors_cible`), `source` (`odoo`, `annuaire`, `saisie`), `commercial_email`, groupement, logiciel, étiquettes, notes, `archive`, `annuaire_site` (clé FINESS ou SIRET) et `annuaire_maj`.
- `crm_contacts` : personnes d'un compte (titulaire, cotitulaire, adjoint, préparateur, acheteur, comptable, autre), téléphones, e-mail, canal préféré, contact principal, actif, `rpps` (unique si renseigné), `source` (`saisie` ou `annuaire`), `annuaire_maj`.
- `crm_activites` : appel, visite, e-mail, rendez-vous, note, tâche ; échéance, date de réalisation, statut (`a_faire`, `fait`, `annule`), résultat, auteur, personne assignée, contact et opportunité facultatifs.
- `crm_opportunites` : titre, étape (`a_qualifier`, `premier_contact`, `rdv`, `proposition`, `ouverture_compte`, `gagnee`, `perdue`), montant mensuel estimé, probabilité, date visée, motif de perte, propriétaire.
- `crm_equipe` : membres (e-mail, nom affiché, rôle affiché, territoires = départements, objectif mensuel, actif). Le rôle qui fait foi reste `app_metadata.role` ; l'écran Équipe met les deux à jour ensemble.
- `crm_indicateurs` : instantané par compte client et par date de fin de période (lot 2).
- `crm_reglages` : réglages (objectif mensuel global, jalons, cibles par pharmacie, seuils).
- `crm_journal` : journal en ajout seul de toutes les écritures (qui, quand, action, objet, avant, après).

- `crm_rapprochements` : site de l'annuaire et contacts proposés, compte client candidat, FINESS, SIRET, motif, statut (`a_valider`, `valide`, `rejete`), auteur et date de décision. Validation atomique, journalisée, conditionnée par les versions du rapprochement et du client.
- `crm_annuaire_etat` : une ligne durable pour le dernier passage, date de l'extraction, début/fin, statut, compteurs et bail exclusif. Le tampon privé de collecte, le curseur d'écriture, les octets reçus, le fragment de ligne et l'ETag permettent la reprise. Seuls l'état et les compteurs sont exposés par l'API.

## 4. Indicateurs (lot 2)

Calculés chaque nuit depuis Odoo par une fonction d'arrière-plan, sur les 30 derniers jours et les 30 jours précédents, plus le CA des 13 derniers mois : chiffre d'affaires HT net d'avoirs, CA par famille (spécialités chères, Mounjaro et GLP-1, fond de rayon), marge (coût au moment de la facture), références achetées, jours facturés, demande non servie (`pharmaml_ordered_qty` − `product_uom_qty`, plus gros manque d'une journée par pharmacie et produit), profil (A panier large, B spécialités seules, C intermédiaire, D occasionnelle, E sans achat) et action proposée. Les règles reprennent celles des listes de travail du plan commercial, sans changement.

## 5. Écrans (lot 3)

Accueil (mes tâches du jour, alertes : baisses, comptes sans achat, nouvelles clientes), Comptes (liste filtrable, vues enregistrées), fiche Compte (en-tête et indicateurs, fil d'activité, contacts, opportunités, commandes du site, factures, produits et demande non servie, réclamations), Contacts, Opportunités (tableau par étape), Activités (agenda et tâches), Tableau de bord (objectif mensuel, CA par jour ouvré, pipeline, activité de l'équipe), Équipe et réglages (admin). Mode démonstration à données inventées pour le banc d'essai.

## 6. Lots

1. Socle serveur : rôles et accès, schéma SQL, stockage, API, journal, tests.
2. Indicateurs Odoo et synchronisation des comptes clients.
3. Écrans.
4. Prospects et contacts de l'Annuaire Santé : extraction publique « personne-activite », import mensuel le premier à 5 h Paris (deux horaires UTC et garde saisonnière), ou relance par un admin depuis Réglages. Profession 21, section A ; section D seulement avec secteur explicitement officinal, ou secteur absent et présence d'un A sur le même site. Un secteur explicitement non officinal est exclu. Territoire des réglages, sinon 75, 78, 91, 92, 93, 94, 95. Groupement FINESS du site, sinon SIRET ; un RPPS multi-sites est rattaché au site où il est titulaire, puis à la première clé de site dans l'ordre croissant pour respecter l'unicité du RPPS.
   SIRET identique : rattachement sûr (plusieurs clients avec le même SIRET : validation nécessaire). Même code postal, même numéro et voie normalisée proche : proposition à valider ; sinon prospect. Les rejets restent mémorisés. Les champs CRM et les comptes hors cible sont préservés ; les contacts saisis à la main restent intacts. Une disparition désactive les contacts ou ajoute l'étiquette réservée « absente de l'annuaire », sans suppression. Le nettoyage attend une extraction intégralement collectée et écrite. Une validation archive le prospect en double ; un contact déjà lié à une activité sur un autre compte entraîne un conflit, sans mutation partielle, afin de préserver son historique.
   Budget de 14 minutes, pause avec reprise au passage suivant. La reprise en octets exige un ETag fort et le support de Range ; sinon la collecte redémarre sans mélanger deux versions du fichier. Aucun téléchargement réel dans les tests : le banc sert vingt lignes inventées en flux et simule les transactions de la base.
5. Réclamations (lot 5b) : onglet de la fiche compte, tickets, pastille des réclamations ouvertes et lien vers l'outil entrepôt. Lecture des 24 derniers mois, au plus 300 lignes par liste ; la pastille compte les réclamations affichées sans date de clôture et sans statut terminal. Les champs hors contrat sont retirés et les identifiants retournés contrôlés. Délai de l'appel signé : 6 secondes. L'absence de configuration est distincte d'une panne (503) ; un prospect renvoie des listes vides sans appel externe.
   Variables à créer côté site de commande, sans valeur dans le dépôt : `CRM_RECLAMATIONS_SECRET` (secret dédié, au moins 32 caractères, identique côté entrepôt) et `ENTREPOT_URL` (adresse HTTPS de l'outil, aucune valeur par défaut). Seule l'adresse est exposée par `moi`. Tests hors ligne avec le signataire de référence importé depuis l'autre dépôt ; banc avec outil entrepôt fictif vérifiant la signature.
6. Reprise du suivi saisi dans les listes de travail.
