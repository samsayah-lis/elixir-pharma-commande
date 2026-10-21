# Appli Elixir installable et notifications sur le téléphone

Pour Zineb Moulatif. État du 21/10/2026 : branche `notifications-messages`, créée à partir de la version en ligne `b1dbd3e` : messages unitaires et collectifs, avec les correctifs de la revue (sécurité, fiabilité, confort sur iPhone). Elle contient aussi la correction de l'appli « Elixir Admin » (branche `appli-admin-ios`, adresse `/admin`), déjà intégrée : rien à fusionner.

Vos demandes :
- 20/10/2026 : « Est ce que c'ets compliqué de faire de tout ça une vraie app qui enverrai des notifications », puis « On peut faire le 1 ». C'est en ligne : appli installable, notifications « Retour en stock » et annonces « Offres et nouveautés ».
- 21/10/2026 : l'icône « Elixir Admin » de votre iPhone ouvrait la connexion des pharmacies. Corrigé par l'adresse `https://elixir-commande.expepharma.com/admin` (branche `appli-admin-ios`, comprise dans celle-ci : § 3 f et § 10).
- 21/10/2026 : « prévoir l'envoi d'une notification unitaire ou collective : communication, promotion, traitement d'une reclamation, etc. ». C'est l'objet de cette branche (§ 3 à 7).

**Rien de nouveau n'est en ligne tant que vous ne lancez pas les commandes de mise en ligne** (§ 3 : d'abord l'appli « Elixir Admin », puis les messages, § 3 c ; ou seulement la seconde, qui contient la première). Pour les messages, un script SQL se passe juste **avant** (§ 3 a), un petit second juste **après** (§ 3 d).

---

## 1. Ce que ça fait

**Pour les pharmacies**
- Le site de commande est une **application installable** : icône Elixir sur l'écran d'accueil, plein écran. Elle montre toujours la dernière version du site.
- Une carte **« Recevez nos alertes sur votre téléphone »** en bas de l'accueil propose l'activation selon l'appareil (Android : deux touches ; iPhone : guide d'installation ; ordinateur : code QR ou activation sur place).
- Un menu **« MON COMPTE → Notifications »** (menu ☰ sur téléphone) et une cloche dans l'en-tête sur grand écran. Le panneau permet de choisir **4 alertes**, chacune par un interrupteur :

| Alerte | Ce qu'elle reçoit | Plafond |
|---|---|---|
| **Retour en stock** | les produits pour lesquels la pharmacie a cliqué « M’avertir du retour », juste après l'e-mail | aucun |
| **Mes commandes et réclamations** (nouveau nom de « Mes commandes ») | vos messages « Réclamation / SAV » et « Commande », et l'outil entrepôt une fois branché (réclamations, demandes, commandes : § 6) | sécurité : 10 par 24 h |
| **Informations Elixir** (nouvelle) | vos messages « Communication » : fermetures exceptionnelles, horaires, changements de service et du site (jamais d'offre ni de nouveau produit) | 2 par 7 jours |
| **Offres et nouveautés** | vos messages « Promotion » | 2 par 7 jours |

- Le panneau sert aussi à envoyer une notification de test, voir et retirer ses appareils, désactiver, et lire « Vos données ».
- Le lien **`https://elixir-commande.expepharma.com/?notifications=1`** ouvre directement le panneau (mailing, SMS).
- Nouveau : le lien **`/?commandes=1`** d'une notification ouvre directement **« Mes commandes »** de la pharmacie.

**Pour vous, dans l'admin, onglet « 📲 Notifications »**
- **État du service** : des coches. Nouveau point : « Tables des messages » (script `sql/push-messages.sql`).
- **Ouverture aux pharmacies** (fermée, pilote, toutes) et les **trois plafonds** : offres, informations, sécurité des commandes et réclamations.
- **Vos appareils** : pour recevoir vous-même les tests et les aperçus (sur iPhone : appli « Elixir Admin », installée depuis `https://elixir-commande.expepharma.com/admin`, § 3 f).
- **Pharmacies joignables** : statistiques par alerte et par appareil, liste, retrait.
- **Nouveau message** (§ 4), **en tête de l'onglet** (sur iPhone, il arrive sans défilement) : type, modèle, texte, lien, destinataires (une pharmacie, plusieurs, toutes), e-mail de secours, envoi maintenant ou **programmé** (§ 5), estimation avant l'envoi, aperçus Android et iPhone (repliés sur téléphone).
- **Historique** (§ 7) : messages (à venir en tête, avec « Annuler »), par pharmacie, outil entrepôt ; en cartes sur téléphone.
- Puis État du service, Ouverture aux pharmacies, Vos appareils, Pharmacies joignables (ci-dessus).

**Onglet « 🏥 Pharmacies »** : la fiche d'une pharmacie (CIP renseigné) montre un bloc **« Notifications envoyées »** (90 derniers jours) et un bouton **« Écrire à cette pharmacie »** (onglet 📲 Notifications, pharmacie déjà choisie).

**En mode « 🛠 Commander pour une pharmacie »** : le panneau « Notifications » montre seulement les appareils de la pharmacie servie. Votre appareil n'est **jamais** abonné au nom de la pharmacie.

---

## 2. Le pharmacien reçoit-il les notifications sur son téléphone ?

**Oui : sur son téléphone, écran verrouillé et site fermé, s'il les a activées.**

| Appareil | Ce qu'il faut faire | À savoir |
|---|---|---|
| **Android** (Chrome, Edge, Samsung Internet, Firefox) | Ouvrir le site, se connecter, « Activer les notifications », puis « Autoriser ». | L'installation est un plus, pas une obligation. Pas sur les Huawei récents sans services Google, ni dans Brave. |
| **iPhone / iPad** | **iOS 16.4 ou plus récent**, application **ajoutée à l'écran d'accueil** puis ouverte depuis l'icône, **reconnexion une fois par code**, puis « Activer les notifications ». | Impossible dans Safari sans installation : règle d'Apple. Impossible sur iPhone 7 et plus anciens. |
| **Ordinateur** (Chrome, Edge, Firefox, Safari sur Mac) | « Activer sur cet ordinateur ». | Le navigateur doit rester ouvert. |

Ce qui peut retarder ou cacher une notification : Ne pas déranger, Concentration, Résumé programmé (iPhone), notifications du navigateur coupées dans les réglages du système, économie de batterie, application supprimée. L'activation se fait **appareil par appareil**.

**L'e-mail reste la voie des informations importantes.** Pour un message à **une** pharmacie (Communication, Réclamation / SAV, Commande), vous pouvez demander l'**e-mail de secours** : il part si aucun de ses téléphones n'a accepté la notification (§ 4.5).

On ne peut pas promettre « tous les pharmaciens ». On peut promettre que **chaque pharmacien qui l'active** reçoit vos messages, et que l'estimation vous dit avant l'envoi combien de pharmacies seront jointes.

---

## 3. Mise en service (dans l'ordre)

Deux mises en ligne, **dans cet ordre**, chacune par une seule commande dans l'application Terminal du Mac. Rien à fusionner : les deux branches partent de la version en ligne (`b1dbd3e`) et celle des messages contient déjà celle de l'appli « Elixir Admin ».

1. **L'appli « Elixir Admin » à l'adresse `/admin`** (branche `appli-admin-ios`) : ni script SQL ni réglage.

   ```
   git -C ~/Downloads/elixir-admin-ios-wt push origin appli-admin-ios:master
   ```

   Netlify déploie en 2 à 3 minutes (Deploys : « Published »). Vous pouvez alors faire tout de suite l'étape f (votre iPhone).
2. **Les messages** (cette branche) : étapes a à e ci-dessous, la commande étant celle de l'étape c.

**Si vous lancez seulement la commande de l'étape c** (sans la première) : elle met en ligne les deux d'un coup, puisqu'elle contient l'appli « Elixir Admin ». Rien n'est perdu ; l'étape f attend alors cette mise en ligne. Une fois la seconde en ligne, la première est inutile : lancée quand même, Git la refuse (« rejected ») sans rien changer.

**a. Passer le script SQL, juste avant la mise en ligne.** Dans l'application Terminal du Mac, tapez cette ligne : elle copie le script dans le presse-papiers (rien ne s'affiche).

```
pbcopy < ~/Downloads/elixir-notif-msg-wt/elixir-commande/sql/push-messages.sql
```

Puis Supabase → SQL Editor → New query → Cmd+V → Run.
- Le script **ajoute** seulement : colonnes, contraintes, deux tables (modèles, événements de l'outil entrepôt) et une table de suivi des migrations. Il ne supprime rien.
- Il est compatible avec la version déjà en ligne.
- Vous pouvez le relancer sans risque (vérifié : deux passages de suite sur un Postgres 17, `push-schema.sql` relancé entre les deux ; et l'ancienne version du script puis celle-ci). **Si vous aviez déjà passé une version précédente, passez celle-ci** : elle complète (relances, e-mail de secours plafonné, événements différés) sans rien défaire.
- **Enchaînez a, c puis d sans pause.** Entre le script et la fin du déploiement, la version en ligne ne connaît pas « Informations Elixir » : si une pharmacie touche un interrupteur à ce moment-là, l'alerte disparaît de son appareil (et une activation faite à ce moment-là ne l'a pas). L'étape d rattrape ces quelques appareils.
- Les nouvelles tables sont fermées comme les autres : RLS activé, aucune policy, rien de lisible avec la clé publique.
- **Catégorie « Informations Elixir » des appareils déjà abonnés** (décision prise pour vous, à changer si vous le souhaitez) : elle est **activée** sur les appareils qui reçoivent encore « Offres et nouveautés », et **laissée coupée** sur ceux qui ont coupé les offres. Une pharmacie qui a refusé les messages non indispensables ne reçoit donc rien de nouveau sans l'avoir choisi ; elle peut l'activer dans son panneau. Cette mise à jour est faite **une seule fois** : relancer le script ne réactive jamais une alerte qu'une pharmacie a coupée ensuite. Les nouvelles activations ont les 4 alertes.

**b. Le secret de l'API de l'outil entrepôt — seulement le jour où l'outil entrepôt est branché** (§ 6). Rien à faire avant : sans ce secret, l'API refuse tout (réponse 503) et le reste fonctionne.
1. Dans **l'application Terminal du Mac** (pas le terminal de l'application Claude, que Claude peut lire), tapez : `openssl rand -hex 32`. Une suite de 64 caractères s'affiche.
2. Netlify → site *commandes-elixir* → Site configuration → Environment variables → Add a variable : nom **`PUSH_EVENEMENT_SECRET`**, valeur : ces 64 caractères, cochez « Contains secret values ».
3. Mettez la **même valeur** dans la configuration de l'outil entrepôt (là où il garde ses propres secrets).
4. Gardez-en une copie dans votre gestionnaire de mots de passe. **Jamais** par e-mail, message, conversation (Claude compris) ni dans le code.
5. Netlify → Deploys → Trigger deploy (les variables ne sont lues qu'au déploiement).

**c. Mise en ligne : une seule commande**, dans l'application Terminal :

```
git -C ~/Downloads/elixir-notif-msg-wt push origin notifications-messages:master
```

- Après la commande de l'appli « Elixir Admin » (1 ci-dessus), celle-ci ajoute seulement les messages. Lancée seule, elle met aussi en ligne l'appli « Elixir Admin ».
- Ne supprimez pas les dossiers `~/Downloads/elixir-admin-ios-wt` et `~/Downloads/elixir-notif-msg-wt` avant.
- Netlify déploie en 2 à 3 minutes (Deploys : « Published »).
- Si Git répond « rejected » ou « non-fast-forward » (à l'une ou l'autre commande) : une autre branche que ces deux-là a été mise en ligne entre-temps (par exemple la Péremption à −50 %). **Ne forcez rien** : demandez une intégration de la branche, puis relancez la même commande.
- La fonction planifiée `push-programmes` (messages programmés et événements différés de l'outil entrepôt, toutes les 5 minutes) démarre seule avec le déploiement.

**d. Juste après la mise en ligne (Netlify : « Published »), le rattrapage d'« Informations Elixir »** :

```
pbcopy < ~/Downloads/elixir-notif-msg-wt/elixir-commande/sql/push-messages-apres.sql
```

Puis Supabase → SQL Editor → New query → Cmd+V → Run. Il affiche le nombre d'appareils à rattraper (souvent 0), puis leur rend « Informations Elixir » (seulement les appareils modifiés depuis l'étape a qui reçoivent encore les offres). Une seule fois : relancé plus tard, il ne fait rien et ne réactive jamais une alerte qu'une pharmacie a coupée ensuite.

**e. Vérifier dans l'admin.** 📲 Notifications → « État du service » : toutes les coches vertes, aucune ligne « Tables des messages absentes ». Les plafonds de « Ouverture aux pharmacies » affichent 2, 2 et 10.

**f. Votre téléphone : l'appli « Elixir Admin »**, dès que l'adresse `/admin` est en ligne (commande 1, ou celle de l'étape c).

*Sur iPhone :*
1. Ouvrez Safari et **tapez** l'adresse `https://elixir-commande.expepharma.com/admin` dans la barre d'adresse (pas l'ancienne adresse en `/#admin`). L'écran « Espace Admin » s'affiche (ou directement l'administration si vous y êtes déjà connectée dans Safari).
2. Touchez Partager (sur iOS 26 : « ••• » en bas à droite, puis Partager) → « Sur l'écran d'accueil ». Le nom proposé est « Elixir Admin ». Sur iOS 26, laissez « Ouvrir en tant qu'app web » activé, puis touchez Ajouter.
3. Ouvrez l'icône « Elixir Admin » : l'écran « Espace Admin » s'affiche (ou directement l'administration), jamais celui des pharmacies (à confirmer au premier essai). Connectez-vous si besoin.
4. Allez dans 📲 Notifications → « Recevoir les notifications sur cet appareil », puis « Autoriser ».
5. Touchez « M'envoyer un test » et verrouillez l'écran : la notification doit arriver.
6. Composez un message et touchez « M'envoyer l'aperçu ». Toucher l'aperçu ouvre son lien dans une nouvelle fenêtre : votre brouillon reste en place.
7. Profitez-en pour relire le guide iPhone du panneau (côté pharmacie) : sur iOS 26, le libellé exact de l'interrupteur « Ouvrir en tant qu'app web » est à confirmer.

*Sur Android :* ouvrez Chrome à la même adresse `https://elixir-commande.expepharma.com/admin`, puis suivez les mêmes boutons. L'installation est facultative (⋮ → Installer l'application) ; elle doit donner une appli « Elixir Admin » à part, sans toucher à l'appli « Elixir » des pharmacies (vérifié seulement dans Chrome sur ordinateur). Si l'appli « Elixir » des pharmacies est déjà installée sur ce téléphone, Chrome peut proposer « Ouvrir dans Elixir » au lieu d'« Installer l'application » : restez alors dans Chrome sur `…/admin` ; l'installation est facultative et les notifications s'activent aussi dans Chrome (à confirmer au premier essai).

*Si l'icône « Elixir Admin » de l'iPhone ouvre l'accueil des pharmacies au lieu de l'admin* : c'est une icône ajoutée depuis l'ancienne adresse en `/#admin` (avant la mise en ligne de l'adresse `/admin`) : elle ne retient pas l'adresse de l'admin (détail au § 10). Supprimez-la (appui long sur l'icône → Supprimer, puis confirmez), puis refaites les étapes 1 à 3 ci-dessus depuis `https://elixir-commande.expepharma.com/admin`.

**g. Essayer avec une pharmacie pilote** (votre propre téléphone ne reçoit que les tests et les aperçus, jamais les messages des pharmacies) :
1. « M'envoyer l'aperçu » d'un message : il arrive sur votre téléphone (appli « Elixir Admin », étape f).
2. Un message « Réclamation / SAV » à **une** pharmacie pilote prévenue, sans e-mail de secours. L'historique affiche « Envoyé » et le nombre d'appareils joints.
3. L'e-mail de secours (Communication, Réclamation / SAV ou Commande ; jamais Promotion) : **il part vraiment** aux adresses du compte de la pharmacie. Faites le premier essai avec une pharmacie amie prévenue, ou un compte de test à votre adresse s'il en existe un.
4. Un message programmé dans 10 minutes, puis « Annuler et modifier » ; un autre laissé partir.

---

## 4. Envoyer un message

### 4.1 Les types

| Type | Arrive dans l'alerte | Destinataires | Plafond par pharmacie | Contenu |
|---|---|---|---|---|
| **Promotion** | Offres et nouveautés | une, plusieurs ou toutes | 2 sur 7 jours glissants (réglable 0 à 7) | offres, nouveaux produits, nouveaux menus ; prix admis ; **jamais d'e-mail de secours** |
| **Communication** | Informations Elixir | une, plusieurs ou toutes | 2 sur 7 jours glissants, à part des offres (réglable 0 à 7) | fermetures, horaires, changements de service et du site ; **jamais d'offre ni de nouveau produit** |
| **Réclamation / SAV** | Mes commandes et réclamations | **une seule pharmacie** | sécurité : 10 sur 24 h (réglable 1 à 50) | **aucun montant** |
| **Commande** | Mes commandes et réclamations | une, ou 20 au plus **sans référence propre à l'une d'elles** ; jamais toutes | même plafond de sécurité | **aucun montant** |

- Les messages « Réclamation / SAV » et « Commande » ne comptent **pas** dans les plafonds des offres et des informations. Leur plafond de sécurité arrête un emballement (double saisie, outil entrepôt qui boucle) ; il compte aussi les notifications de l'outil entrepôt et les e-mails de secours partis. C'est un frein d'urgence, pas un compteur exact : deux envois lancés à la même seconde vers la même pharmacie peuvent le dépasser d'une ou deux unités.
- **Montants** : « Réclamation / SAV » et « Commande » refusent tout montant, même dans un avoir : « 12,50 € », « 30 euros », « 45,90 HT », « 12,5 TTC », « 1 250,00 », « 30 E », « solde : 120 », « quarante euros »… Les dates (« 22/10 »), heures (« 24 h »), numéros (« EN-601-2026-12 », « S04512 ») et le téléphone restent admis. La notification s'affiche sur l'écran verrouillé : le détail chiffré passe par vos voies habituelles (facture, e-mail que vous envoyez).
- Jamais de donnée de patient, quel que soit le type.
- **Pourquoi « Nouveau menu » est une Promotion** : une pharmacie qui coupe « Offres et nouveautés » ne doit plus recevoir de message commercial. « Informations Elixir » (allumée par défaut) est réservée aux informations de service.
- **Une seule diffusion plafonnée à la fois** (Promotion ou Communication en cours d'envoi : l'autre attend). Les messages « Réclamation / SAV » et « Commande » ne sont jamais bloqués par une diffusion en cours.

### 4.2 Les destinataires

- **Une pharmacie** : recherchez-la par **nom, ville ou CIP**. Seules les pharmacies qui ont un **compte sur le site** apparaissent : les autres ne peuvent recevoir ni notification ni e-mail de secours. Pour chacune, vous voyez :
  - ses appareils (nombre et type) et si elle reçoit l'alerte du type choisi (✓ ou ✗) ;
  - quand un de ses appareils activés a ouvert le site pour la dernière fois, et la dernière notification reçue ;
  - les adresses de secours, **masquées** (« co…@…fr ») ;
  - « hors pilote » si l'ouverture est en pilote sans elle.
- Le bouton d'envoi porte son nom (« Envoyer à PHARMACIE DES TILLEULS »). Après l'envoi d'une Réclamation / SAV ou d'une Commande, la pharmacie et la case e-mail sont **vidées** : la suivante se choisit, jamais héritée du message précédent. Passer de « Plusieurs » ou « Toutes » à « Une pharmacie » vide aussi le choix.
- Depuis la fiche d'une pharmacie (onglet 🏥 Pharmacies) : **« Écrire à cette pharmacie »** ouvre le composeur, pharmacie choisie.
- **Plusieurs pharmacies** : la même recherche (« Ajouter »), ou la liste des pharmacies abonnées à l'alerte. 500 au plus pour Promotion et Communication. **Commande** : 20 au plus, et le même texte part à chacune, donc **aucune référence propre à une pharmacie** (« Livraisons retardées ce matin » : oui ; « Votre commande S04512… » : refusé). **Réclamation / SAV : jamais**, une pharmacie à la fois. La confirmation liste les noms des pharmacies.
- **Toutes les pharmacies abonnées** : Promotion et Communication seulement.

### 4.3 L'estimation, avant l'envoi

Elle se met à jour à chaque changement :
- combien de pharmacies **recevront** la notification, et sur combien d'appareils ;
- combien sont **écartées par le plafond** ;
- combien sont **non joignables** : sans appareil (un appareil dont le compte n'est plus rattaché à la pharmacie compte comme « sans appareil », comme à l'envoi), avec l'alerte coupée, hors pilote. Pour « toutes » : combien de pharmacies clientes n'ont pas activé les notifications, et combien sont hors pilote ;
- pour un message unitaire avec e-mail de secours, **la même règle que l'envoi** : combien d'adresses de compte (masquées) le recevraient et si l'e-mail ne partira qu'en cas d'échec (la pharmacie a un téléphone qui reçoit l'alerte), ou pourquoi il ne partira pas (aucune adresse, alerte coupée, plafond atteint).

Les destinataires réels sont recalculés au moment de l'envoi : comptes revérifiés, ouverture et plafonds du moment.

### 4.4 Les modèles

**Modèles Elixir** (prêts, modifiables avant l'envoi) :

| Modèle | Type | Titre | Texte |
|---|---|---|---|
| Réclamation reçue | Réclamation / SAV | Réclamation reçue | Nous avons bien reçu votre réclamation [référence]. Réponse sous 24 h ouvrées (du lundi au vendredi). |
| Réclamation traitée | Réclamation / SAV | Réclamation traitée | Votre réclamation [référence] est traitée. Une question : 01 86 04 39 95. |
| Retour accepté | Réclamation / SAV | Retour accepté | Votre demande de retour [référence] est acceptée. Notre équipe vous contacte pour la reprise. |
| Avoir émis | Réclamation / SAV | Avoir émis | Un avoir est émis pour votre réclamation [référence]. (sans montant) |
| Commande expédiée | Commande | Commande expédiée | Votre commande [n° de commande] est sortie de l'entrepôt (tournée [n° de tournée]). |
| Reliquat | Commande | Reliquat sur votre commande | Une partie de votre commande [n° de commande] est en reliquat : elle partira dès réception du stock. |
| Fermeture exceptionnelle | Communication | Fermeture exceptionnelle | Elixir Pharma sera fermé le [date]. Les commandes reçues ce jour-là partiront le [date de reprise]. |
| Nouveau menu | Promotion (menu promo à choisir) | Nouveau sur votre espace Elixir | Découvrez le menu [nom du menu] : [ce qu'il apporte]. |
| Offre du moment | Promotion (menu promo à choisir) | Offre du moment | [produit ou gamme] : [avantage] jusqu'au [date]. |

- Les champs **entre crochets en minuscules** sont à remplacer : l'envoi (et l'aperçu) est refusé tant qu'il en reste. « [NOUVEAU] » en majuscules reste admis.
- Aucun modèle ne promet un envoi qui n'existe pas (plus de « le détail vous est envoyé par e-mail » : rien n'envoie ce détail, et aucun écran de la pharmacie ne montre ses réclamations ni ses avoirs). Si vous envoyez vous-même un e-mail, vous pouvez l'écrire dans le texte.
- Les modèles de réclamation et de commande ouvrent **« Mes commandes »** au toucher (`/?commandes=1`). « Nouveau menu » et « Offre du moment » préparent le lien « Menu promo » sans menu : l'envoi reste bloqué tant que le menu (ou une autre page) n'est pas choisi.
- Choisir un modèle alors que le titre ou le texte ont été écrits ou modifiés à la main : une confirmation est demandée avant de les remplacer.
- **« Enregistrer comme modèle »** (à côté de « M'envoyer l'aperçu ») garde le message en cours (type, titre, texte, lien) sous un nom, côté serveur : il est partagé entre les admins, dans « Vos modèles ». 100 au plus ; un nom déjà pris propose **« Remplacer »** ; « Supprimer ce modèle » le retire (les messages déjà envoyés ne changent pas).

### 4.5 L'e-mail de secours (message à une pharmacie)

Case **« Si la pharmacie n'est pas joignable sur téléphone, envoyer aussi par e-mail »** : Communication, Réclamation / SAV et Commande, message à **une** pharmacie.
- Il part **seulement si aucun de ses téléphones** (iPhone, iPad, Android) **n'a accepté la notification** : pas de téléphone, envois en échec, ou ouverture fermée. « Accepté » veut dire remis au service de notification d'Apple ou de Google, pas forcément lu. Un ordinateur joint ne suffit pas : une pharmacie abonnée seulement depuis le Chrome du comptoir reçoit aussi l'e-mail.
- **Jamais pour une Promotion.** Un e-mail commercial envoyé aux adresses de connexion, sans lien pour s'y opposer ni mention dans « Vos données », serait de la prospection par e-mail sans les garanties qu'elle impose (art. L34-5 du code des postes et des communications électroniques, recommandations de la CNIL). La case n'apparaît pas pour une Promotion ; le serveur et la base la refusent. Pour le permettre un jour : voir § 9.3.
- Destinataires : les **adresses de connexion de son compte** sur le site (celles de la table des pharmacies qui portent son CIP), 5 au plus, **un e-mail par adresse**. Jamais l'e-mail de la fiche Odoo : il peut être partagé avec une autre officine du même titulaire (le piège déjà corrigé pour « Commander pour une pharmacie »). Jamais une adresse tapée dans la page : la page ne voit que des adresses masquées.
- Il ne contourne **jamais** un plafond, **et il y compte** : un e-mail parti compte comme une notification reçue (Communication : 2 par 7 jours ; Réclamation / SAV et Commande : sécurité, 10 par 24 h), pharmacie sans appareil et ouverture « fermée » comprises. Plafond atteint : ni notification ni e-mail.
- Il respecte le choix de la pharmacie :
  - Communication, alerte « Informations Elixir » coupée sur tous ses appareils : pas d'e-mail ;
  - Réclamation / SAV ou Commande, alerte coupée : l'e-mail part quand même (c'est le suivi de son dossier, et l'e-mail est la voie habituelle).
- Ce que l'historique et le suivi affichent : « e-mail envoyé (2 adresses) », « e-mail en échec », « pas d'e-mail : aucune adresse de compte », « pas d'e-mail : plafond atteint », « pas d'e-mail : alerte coupée par la pharmacie », « e-mail inutile : notification reçue ».
- L'e-mail reprend la charte de l'e-mail « De retour en stock » : en-tête pétrole, titre, texte, bouton vers la page du lien (« Voir mes commandes », « Voir le produit »…), expéditeur `pharmacien@elixirpharma.fr`, réponse à la même adresse. Le pied explique pourquoi il arrive par e-mail et comment activer les notifications.
- Il ne part jamais deux fois : clé d'idempotence par message et par adresse.
- Avec l'ouverture « fermée », un message unitaire avec e-mail de secours peut partir quand même : seul l'e-mail part (plafond compris).

### 4.6 Envoyer

- **« M'envoyer l'aperçu »** d'abord : le message arrive sur vos appareils.
- **Horaires** : avant 8 h, après 20 h et le dimanche (heure de Paris), l'admin demande une confirmation de plus.
- Un envoi « maintenant » ne s'annule plus une fois parti ; tant qu'il est « En file » (lancement en attente), **« Annuler »** reste possible dans l'historique.
- Un double clic ou une réponse perdue n'envoie jamais deux fois. Un message **corrigé** prend une nouvelle clé : jamais l'ancien texte envoyé à sa place (le serveur refuse une clé réutilisée avec un autre contenu, rien n'est créé).
- Message à une ou quelques pharmacies : le résultat s'affiche sous le bouton quelques secondes après (« 1 pharmacie jointe (2 appareils). », « Aucun appareil joint. E-mail de secours : e-mail envoyé (2 adresses). »).
- Un message resté « En file » (lancement perdu, autre diffusion en cours) est **relancé automatiquement** toutes les 5 minutes, **aux heures ouvertes seulement** (8 h – 20 h, hors dimanche). Prévu depuis plus de 3 heures, il ne part plus : l'historique l'indique en erreur (« Non envoyé : prévu le … »). Dans ces 3 heures, « Relancer » reste possible à la main, avec une confirmation le soir et le dimanche.

---

## 5. Programmer un message

- Envoi → **« Programmer »** → date et heure, **heure de Paris** (passage à l'heure d'été et d'hiver compris ; une heure qui n'existe pas, le dernier dimanche de mars entre 2 h et 3 h, est refusée). Date proposée : le prochain jour hors dimanche, 8 h 30. La phrase « Envoi prévu le jeudi 22 octobre à 08:30 » confirme la date sous le champ.
- Au plus tôt dans 5 minutes, au plus tard dans 60 jours ; 50 messages programmés en attente au plus.
- Confirmation de plus si l'heure choisie tombe avant 8 h, après 20 h ou un dimanche.
- Le message part **au plus 5 minutes après l'heure prévue** (fonction `push-programmes`). Destinataires, ouverture et plafonds sont ceux **du moment de l'envoi**.
- **Annuler** : dans l'historique, bloc « À venir » en tête, bouton « Annuler » tant que le message est « Programmé » ou « En file ». **« Annuler et modifier »** le reprend dans « Nouveau message » (type, texte, lien, destinataires, date) pour le corriger, puis le renvoyer ou le reprogrammer.
- Sécurité : un message dû depuis **plus de 3 heures** (service arrêté, panne, lancement perdu même après son passage « En file ») n'est **jamais** envoyé en retard ; l'historique l'indique en erreur (« Non envoyé : prévu le … »). Une fermeture annoncée deux jours trop tard ferait plus de mal que de bien. Les relances automatiques ne partent jamais le soir, la nuit ni le dimanche.
- L'historique garde l'heure de composition et affiche « prévu le … · parti le … ».
- Deux passages simultanés de la fonction n'envoient jamais un message deux fois.

---

## 6. API de l'outil entrepôt (Réclamations, Tickets)

L'outil entrepôt (elixirentrepot) peut prévenir automatiquement une pharmacie quand une réclamation, un ticket ou une commande change de statut. Côté site, tout est prêt ; **l'outil entrepôt n'a pas été modifié** : il faut lui ajouter l'appel ci-dessous, puis le secret (§ 3 b).

**Adresse** : `POST https://elixir-commande.expepharma.com/.netlify/functions/push-evenement`

**Signature** : exactement le contrat de l'API « chatbot-intake » de l'Assistant Elixir (`docs/assistant-contrat.md`, `_chat-demandes.js`, `versEntrepot`), dans l'autre sens :

| En-tête | Valeur |
|---|---|
| `Content-Type` | `application/json` |
| `X-Elixir-Horodatage` | l'heure en secondes depuis 1970 (±5 minutes) |
| `X-Elixir-Signature` | `sha256=` + HMAC-SHA256 hexadécimal de `<horodatage>.<corps brut>`, clé `PUSH_EVENEMENT_SECRET` |
| `Idempotency-Key` | une clé par événement, 8 à 128 caractères (lettres, chiffres, `_ . : -`), par exemple `entrepot-EN-601-2026-12-traitee` |

**Corps** (4 Ko au plus) :

```json
{ "cip": "2000001", "type": "reclamation", "statut": "traitee", "reference": "EN-601-2026-12",
  "titre": "facultatif", "corps": "facultatif", "url": "facultatif, /?commandes=1 par défaut" }
```

Textes par défaut (sans `titre` ni `corps`) :

| type | statut | Titre | Texte |
|---|---|---|---|
| reclamation | recue | Réclamation reçue | Nous avons bien reçu votre réclamation EN-601-…. Réponse sous 24 h ouvrées (du lundi au vendredi). |
| reclamation | en_cours | Réclamation en cours | Votre réclamation … est en cours de traitement par l'équipe Elixir. |
| reclamation | acceptee | Réclamation acceptée | Votre réclamation … est acceptée. |
| reclamation | refusee | Réponse à votre réclamation | Votre réclamation … a reçu une réponse de l'équipe Elixir. |
| reclamation | traitee | Réclamation traitée | Votre réclamation … est traitée. |
| reclamation | avoir_emis | Avoir émis | Un avoir est émis pour votre réclamation …. |
| reclamation | cloturee | Réclamation clôturée | Votre réclamation … est clôturée. |
| ticket | recu, en_cours, resolu, clos | Demande reçue / en cours / traitée / clôturée | Votre demande TK-… … |
| commande | expediee | Commande expédiée | Votre commande … est sortie de l'entrepôt. |
| commande | reliquat | Reliquat sur votre commande | Une partie de votre commande … est en reliquat : elle partira dès réception du stock. |
| commande | annulee | Commande annulée | Votre commande … est annulée. Une question : 01 86 04 39 95. |

- Pour un statut du tableau, **seul le texte par défaut** est admis : `titre` ou `corps` fournis sont refusés (400).
- Un autre statut (minuscules et `_`) est admis s'il vient avec `titre` (60 caractères) et `corps` (160). Jamais de montant (refusé, mêmes règles qu'au § 4.1).
- **Côté outil entrepôt : n'envoyez jamais le texte d'un ticket ni un nom de patient ou de client**, seulement le type, le statut et la référence (et, pour un statut sans texte par défaut, un titre et un texte écrits pour l'écran verrouillé).

**Ce qui se passe** : la pharmacie du CIP reçoit la notification dans **« Mes commandes et réclamations »** (ouverture, alerte choisie, comptes revérifiés et plafond de sécurité de 10 par 24 h respectés), lien « Mes commandes » par défaut. Les statuts successifs d'une même référence **remplacent** la notification précédente sur l'appareil (même étiquette, à clé : la référence n'est jamais lisible par Google ou Apple). Pas d'e-mail de secours ici : l'outil entrepôt envoie ses propres e-mails.
- **Le soir, la nuit et le dimanche** (avant 8 h, après 20 h et le dimanche, heure de Paris), rien ne part tout de suite : l'événement est enregistré (réponse 200 `resultat: "differe"`, avec `envoi_prevu`) et la notification part **le matin suivant à 8 h** (lundi 8 h pour un samedi soir ou un dimanche), par la fonction `push-programmes`, avec les contrôles du moment (alerte, plafond, comptes). Décision prise pour vous, à confirmer : le téléphone d'un pharmacien est souvent personnel, une préparation de nuit ne doit pas le réveiller.
- **Doublons** : le même statut de la même référence pour la même pharmacie, reçu deux fois **en 10 minutes** sous deux clés, n'est notifié qu'une fois. Après 10 minutes (2e reliquat sur la même commande, ticket rouvert), il est notifié de nouveau. Une même clé n'est jamais traitée deux fois (90 jours).
- **Fonction coupée en cours de route** (délai dépassé) : le rejeu de la même clé, au moins 60 secondes après, reprend l'événement et l'envoie.

**Réponses**

| Code | Corps | Sens |
|---|---|---|
| 200 | `{ ok, resultat: "envoye", envoyes, echecs }` | parti (au moins un appareil joint) |
| 200 | `{ ok, resultat: "differe", envoi_prevu }` | reçu le soir, la nuit ou le dimanche : partira à 8 h (ne pas rejouer) |
| 200 | `resultat` : `aucun_appareil`, `fermee`, `hors_pilote`, `plafond` | rien n'est parti, normal (pas une erreur à rejouer) |
| 200 | `{ ok, deja: true, resultat }` | même clé, **ou** même statut de la même référence pour cette pharmacie reçu dans les 10 dernières minutes : rien n'est renvoyé |
| 400 | `requete` (avec `erreurs`), `json`, `idempotency_key` | corps ou en-tête à corriger |
| 401 | `signature` ou `horodatage` | secret différent, corps modifié, horloge décalée de plus de 5 minutes |
| 409 | `idempotency_key_reutilisee` | même clé pour un autre événement |
| 413 | `trop_long` | plus de 4 Ko |
| 429 | `quota` (en-tête `Retry-After`) | plus de 120 appels par minute depuis une même adresse (compté avant la signature : des appels non signés ne bloquent que leur adresse) ou signés, ou 30 par pharmacie et par heure |
| 503 | `configuration` | secret absent ou trop court dans Netlify |
| 503 | `indisponible` (en-tête `Retry-After`, 120 s) | base injoignable, tables absentes, clés VAPID refusées, ou **tous les appareils de la pharmacie en échec** : rien n'est enregistré, **rejouer plus tard avec la même clé** (la notification part alors normalement) |

**Essai depuis l'application Terminal du Mac** (remplacez la valeur entre `<…>` par le secret, sans l'écrire dans un fichier partagé ; CIP d'une pharmacie pilote) :

```
SECRET='<valeur de PUSH_EVENEMENT_SECRET>'
CORPS='{"cip":"2000001","type":"reclamation","statut":"traitee","reference":"EN-601-2026-12"}'
H=$(date +%s)
SIG=$(printf '%s.%s' "$H" "$CORPS" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -sS https://elixir-commande.expepharma.com/.netlify/functions/push-evenement \
  -H 'Content-Type: application/json' -H "X-Elixir-Horodatage: $H" -H "X-Elixir-Signature: sha256=$SIG" \
  -H 'Idempotency-Key: entrepot-EN-601-2026-12-traitee' --data "$CORPS"
```

Côté outil entrepôt (Node), le même calcul que `versEntrepot` :

```js
const corps = JSON.stringify(evenement);
const horodatage = String(Math.floor(Date.now() / 1000));
const signature = crypto.createHmac("sha256", process.env.PUSH_EVENEMENT_SECRET).update(`${horodatage}.${corps}`).digest("hex");
await fetch(URL_PUSH_EVENEMENT, { method: "POST", body: corps, headers: { "Content-Type": "application/json",
  "X-Elixir-Horodatage": horodatage, "X-Elixir-Signature": `sha256=${signature}`, "Idempotency-Key": cleDeLEvenement } });
```

**Journal** : une ligne par événement (type, statut, résultat), jamais le texte, la référence ni le secret. Les événements reçus sont visibles dans l'historique « Outil entrepôt » (§ 7) et effacés après 90 jours. Un événement différé garde son texte et son lien jusqu'à l'envoi (même conservation).

---

## 7. Historiques

Onglet 📲 Notifications → **Historique**, trois vues :
- **Messages** : en tête, **« À venir »** (programmés et en file) avec « Annuler », « Annuler et modifier » et, si besoin, « Relancer » ; puis les plus récents. Pour chacun : date (composé le…, ou « prévu le … · parti le … »), type, titre, texte et lien, destinataires (nom de la pharmacie pour un message unitaire), résultat **en clair** (« 2 pharmacies jointes (2 appareils) · 1 pharmacie écartée par le plafond »), e-mail de secours (§ 4.5), statut. « Envoyé » n'est vert que si une pharmacie a été jointe ; sinon « Envoyé par e-mail » ou « Aucun appareil joint » (orange).
- **Par pharmacie** : toutes les notifications reçues par une pharmacie sur 90 jours, quelle que soit l'origine (message de l'admin, retour en stock, outil entrepôt), avec l'alerte, les appareils joints et l'e-mail de secours ; en tête, ses appareils, ses alertes, sa dernière visite et son nombre d'adresses de compte.
- **Outil entrepôt** : les événements reçus par l'API (§ 6) : nom de la pharmacie et CIP, événement en clair (« Commande expédiée », « Réclamation traitée »), référence, résultat (« envoyée · 1 appareil joint », « différée au matin (8 h) · prévue le … », « aucun appareil joint »).
- Sur téléphone (600 px et moins), les trois vues s'affichent **en cartes** : rien à faire défiler de côté, « Annuler » visible.

Onglet 🏥 Pharmacies → fiche d'une pharmacie (CIP renseigné) : bloc **« Notifications envoyées »**, les 20 dernières, en lecture seule, et **« Écrire à cette pharmacie »**.

---

## 8. Données

- **Stockage** : tables fermées (RLS sans policy), lues seulement par les fonctions, avec la clé serveur.
  - `push_abonnements` (appareils), `push_reglages`, `push_annonces` (messages de l'admin, gardés pour l'historique), `push_envois` (envois par pharmacie : alerte, titre, type, origine, appareils joints, résultat de l'e-mail de secours — jamais l'adresse), `push_hotes_refuses` ;
  - nouvelles : `push_modeles` (modèles enregistrés, auteur), `push_evenements` (événements de l'outil entrepôt : CIP, type, statut, référence, titre, résultat), `push_migrations`.
- **Ce qui est enregistré pour un appareil** : adresse technique du service push (Google, Apple, Mozilla, Microsoft), clés de chiffrement, CIP et e-mail du compte (pris dans le jeton), alertes choisies, libellé (« iPhone · application »), dates d'activation, de dernière visite et de dernier envoi.
- **E-mail de secours** : les adresses sont lues dans la table des pharmacies au moment de l'envoi ; elles ne sont copiées nulle part ; la page de l'admin n'en voit que la forme masquée. Il sert au suivi et à l'information de service (Communication, Réclamation / SAV, Commande), **jamais à la prospection** (pas de Promotion).
- **Contenu des notifications** : aucune donnée de patient ; aucun montant pour les messages transactionnels.
- **Conservation** (`push-menage`, chaque nuit) : envois et événements de l'outil entrepôt effacés après 90 jours ; **messages de l'admin terminés (envoyés, en erreur, annulés) effacés après 12 mois** (texte, destinataires, adresse de l'admin ; durée à confirmer par vous, les messages à venir ne sont jamais effacés) ; appareil supprimé à la désactivation, à la déconnexion, au retrait, quand le service push le dit introuvable, après 12 mois sans visite, et dès que l'e-mail du compte n'est plus rattaché à la pharmacie ; services push refusés effacés après 90 jours.
- **Consentement** : activation par un clic, alertes choisies une à une, retrait à tout moment. La carte de l'accueil dit que l'activation inclut nos informations et nos offres (plafonnées). Pour les appareils déjà abonnés, voir § 3 a.
- **Information des pharmacies** : panneau « Vos données ». Mention à reprendre dans la page « données personnelles » du site (inchangée) :
  > Notifications de l'application Elixir : si vous les activez, Elixir Pharma enregistre pour chaque appareil l'adresse technique et les clés de chiffrement fournies par votre navigateur (Google, Apple, Mozilla ou Microsoft), l'e-mail de votre compte et le CIP de la pharmacie, le type d'appareil, les alertes choisies et les dates d'activation, de dernière visite et de dernier envoi, dans le seul but de vous envoyer ces notifications. Ces données sont supprimées quand vous désactivez les notifications, vous déconnectez ou retirez l'appareil, et automatiquement après 12 mois sans visite. Si aucun de vos téléphones ne reçoit nos notifications, une information de service ou le suivi d'une réclamation ou d'une commande peut vous être envoyé par e-mail à l'adresse de votre compte (jamais une offre commerciale). Accès, effacement : pharmacien@elixirpharma.fr.
- **Demande d'effacement** : admin → « Pharmacies joignables » → **Retirer** sur la ligne de la pharmacie, puis répondre **OK** à la seconde question « effacer aussi l'historique » : ses envois, ses événements de l'outil entrepôt, et son CIP et son nom dans les messages terminés sont effacés (« Annuler » à cette question : seuls les appareils sont retirés). Un message à venir qui la vise s'annule d'abord dans l'historique.

---

## 9. Suites

### 9.1 Retour en stock (branché le 20/10/2026)

Les e-mails « De retour en stock » des alertes retour partent de `netlify/functions/_restock.js`, fonction `passage()`. Juste après un e-mail **réellement parti**, le passage appelle `notifierPharmacie(cip, "stock", { titre, corps, url, tag })` :

| Cas | Titre | Texte | Lien | Étiquette |
|---|---|---|---|---|
| 1 produit | « De retour en stock » | « DOLIPRANE 1000MG CPR B/8 est de nouveau disponible chez Elixir. » | `/?cip=<CIP>` | `stock-<empreinte à clé du CIP>` |
| plusieurs | « 3 produits de retour en stock » | « A, B et 1 autre sont de nouveau disponibles chez Elixir. » | `/?outil=saisie` | `stock-lot-<empreinte à clé des CIP>` |

- Une notification par pharmacie et par appel de `passage()`, jamais attendue par les e-mails, jamais relancée, silencieuse quand le service manque. Écran verrouillé : le nom du produit, jamais de prix. Bilan dans le journal des passages et l'onglet « 🔔 Alertes retour ».
- Depuis cette branche, la ligne d'envoi garde aussi le titre « De retour en stock » (historique de la pharmacie, § 7). Rien d'autre ne change pour les alertes retour.

Ce que garantit `notifierPharmacie(cip, catégorie, contenu, options)` :
- elle ne lève jamais d'erreur et rend `{ envoyes, echecs, retires, raison }` ;
- elle respecte l'ouverture, l'alerte choisie et le plafond de la catégorie (offres et informations : 7 jours ; commandes : sécurité sur 24 h ; retour en stock : aucun) ;
- elle ne sert que les appareils dont le compte est toujours rattaché au CIP ;
- elle trace l'envoi dans `push_envois` (titre, type, origine) ;
- « 0 » ou « false » ne servent jamais personne.

### 9.2 « Mes commandes et réclamations »

Branché : messages « Réclamation / SAV » et « Commande » de l'admin (§ 4), API de l'outil entrepôt (§ 6). Reste à faire côté outil entrepôt : appeler l'API aux changements de statut (le site n'a rien à ajouter).

**Préalable inchangé pour l'ouverture à toutes les pharmacies** : l'étape « Bloc 1 » du plan de fermeture de Supabase (`elixir_pharmacies` fermée à la clé publique, `auth.js` sur la clé serveur). Avant, un compte qui modifierait cette table pourrait se faire passer pour une autre pharmacie ; cela vaut aussi pour l'e-mail de secours, qui lit cette table.

Option possible plus tard : une sortie d'entrepôt lue dans Odoo (`stock.picking` de la société 2, sortants, terminés) toutes les 15 minutes, qui appellerait `notifierPharmacie(cip, "commandes", …, { unique: true })`. À trancher : toutes les commandes (site, logiciel de l'officine, saisies Elixir) ou celles du site seulement ; je déconseille « en préparation » (trop de notifications).

### 9.3 Autres pistes

- Ciblage (département, habitudes d'achat) pour Promotion et Communication.
- E-mail de secours pour « plusieurs pharmacies » (aujourd'hui : message unitaire seulement, volontairement).
- E-mail de secours pour une Promotion : seulement avec un lien « Ne plus recevoir ces e-mails » (et l'en-tête List-Unsubscribe), une liste d'opposition consultée avant chaque envoi, et cette finalité ajoutée à la mention « Vos données ».
- Notifications « déclaratives » d'iOS 18.4, après un essai réel ; pastille sur l'icône ; alertes pour l'équipe Elixir (relais PharmaML muet).

---

## 10. Pour l'équipe technique

**Fichiers de la branche `notifications-messages`**
- Serveur :
  - `netlify/functions/_push-messages.js` (nouveau) : e-mail de secours (charte, envoi Resend borné et idempotent, adresses de compte), joignabilité des pharmacies, programmation (`traiterProgrammes` : relances bornées à 3 h après l'heure prévue, jamais hors heures, expiration), événements différés (`traiterDifferes`), API de l'outil entrepôt (`verifierSignature`, `signer`, textes par défaut, étiquette à clé, empreinte de dédoublonnage par tranche de 10 minutes, `echecPassager`) ;
  - `netlify/functions/_push.js` : catégories et plafonds par type (`dejaRecus`, `plafondDe`, `cipAuPlafond`), `destinataires` par catégorie, `diffuserAnnonce` (types, garde des 3 h, e-mail de secours par `deps.repli` : téléphones seulement, plafond compris, jamais pour une Promotion, statut du refus noté), `notifierPharmacie` (plafonds infos et commandes, ligne d'envoi écrite AVANT l'envoi pour les catégories plafonnées, titre/type/origine tracés), plafonds comptant l'e-mail parti (`or=(nb_reussis.gt.0,email.eq.envoye)`), stockage (`comptesDuCip`, `comptesDesCips`, `chercherPharmacies`, `cipsClientes`, `modeles` avec `remplacer`, `evenements` avec reprise, libération, différés, effacement, programmation des messages avec `en_file_le`, `expirer`, annulation en file, purge à 12 mois, repli sans les colonnes de `push-messages.sql`), ménage, `lancerEnvoi` partagé ;
  - `push-admin.js` : actions `estimer` (par type ; e-mail de secours par la règle de l'envoi ; comptes revérifiés ; hors pilote pour « toutes »), `envoyer` (types, programmation, e-mail de secours, empreinte du contenu sous la clé idem → 409 `idem_reutilise`), `relancer` (3 h après l'heure prévue), `annuler` (programmé ou en file), `message`, `historique` (global ou `{ cip }`), `evenements` (nom de la pharmacie), `chercher`, `modeles`, `modele_enregistrer` (`remplacer`), `modele_supprimer`, `retirer_pharmacie` (`effacer_historique`) ; jamais d'adresse e-mail complète d'une pharmacie dans une réponse ;
  - `push-envoi-background.js` : passe `creerRepli` à `diffuserAnnonce` ;
  - `push-programmes.js` (nouveau, planifié `*/5 * * * *` dans `netlify.toml`) : messages programmés et en file, événements différés ;
  - `push-evenement.js` (nouveau) : API signée (débit par adresse avant la signature, global après ; 503 rejouable sur échec passager ; reprise d'une réservation orpheline ; différé hors heures) ;
  - `push-abonnement.js` : `plafond_infos_7j` et 4 catégories dans le statut ;
  - `sql/push-messages.sql` (nouveau, à passer après `push-schema.sql`, juste avant la mise en ligne) et `sql/push-messages-apres.sql` (nouveau, rattrapage d'« Informations Elixir » juste après).
- Site :
  - `src/notifications/regles.js` : 4 catégories, types (`TYPES_MESSAGE`, `audiencesDuType`), `verifierMessage` (réclamation à une pharmacie, commande à plusieurs sans référence, pas d'e-mail de secours pour une Promotion), montants (`contientMontant`, élargi) et références (`contientReference`), champs à compléter, programmation et heure de Paris (`parisVersIso`, `isoVersParis`, `horsHeures`, `prochainMatin`), plafonds (`plafondDe`), lien `/?commandes=1` ;
  - `src/notifications/modeles.js` (nouveau) : modèles Elixir, `verifierModele` ;
  - `src/components/AdminMessages.jsx` (nouveau) : composeur (clé idem renouvelée à chaque changement de contenu, destinataire vidé après un message transactionnel, nom dans le bouton, aperçus repliés sur téléphone, modèles avec confirmation et « Remplacer »), choix des destinataires, estimation, programmation, historiques (« À venir », « Annuler et modifier », cartes sous 600 px, résultats en clair), bloc `NotificationsEnvoyees` de la fiche pharmacie (« Écrire à cette pharmacie ») ; aperçus Android et iPhone déplacés ici depuis `AdminNotifications.jsx` (qui garde état du service, ouverture et plafonds, appareils, statistiques, et place les messages en tête) ;
  - `src/AdminPanel.jsx` : bloc « Notifications envoyées » sous la fiche d'une pharmacie, « Écrire à cette pharmacie » ouvre l'onglet ;
  - `src/App.jsx` : lien `?commandes=1` → « Mes commandes » ouvert une fois la pharmacie connue (+0,4 Ko dans le bundle des pharmacies) ;
  - `src/notifications/Notifications.jsx` : textes de la carte (selon les plafonds non nuls) et plafond des informations ;
  - `src/dev/reponses-fictives.js` et `scripts/banc/plugin.mjs` : nouvelles actions (aperçus Netlify et banc local).
- `scripts/verifie-zones.mjs` : `push-evenement` et `push-programmes` ajoutés aux fonctions nouvelles admises (`AJOUTS_AUTORISES`) ; aucune zone protégée ni clé de stockage modifiée par les messages (le brouillon du composeur garde la même clé de session et un seul appel d'écriture, partagé avec « Écrire à cette pharmacie ») ; la clé `appli_admin` de l'appli « Elixir Admin » a son propre lot (`appliAdmin`, ci-dessous).

**Règles tenues**
- Identité de l'admin par `verifyAdmin` ; jamais de 401/403 pour une raison métier.
- Destinataires de l'e-mail de secours décidés par le serveur (adresses de compte du CIP), jamais par la page.
- E-mail de secours : jamais pour une Promotion (règle, serveur, contrainte SQL), compté dans les plafonds, téléphones seulement.
- API : signature à temps constant, horodatage ±5 min, clé d'idempotence obligatoire, dédoublonnage par (pharmacie, type, référence, statut) sur 10 minutes, débit par adresse avant la signature, échec passager rejouable (rien de consommé), réservation orpheline reprise, différé hors heures, texte libre seulement pour un statut sans texte par défaut, journal sans contenu, hôte d'aperçu sans effet.
- Une seule diffusion plafonnée à la fois (index unique recréé par `push-messages.sql` sur les catégories offres et infos) ; les messages transactionnels ne sont jamais bloqués. Plafond de sécurité : approximatif à une ou deux unités près sous forte concurrence.
- Programmation : passages conditionnels (programmée → en file, programmée ou en file → annulée, en file → erreur), jamais au-delà de 3 h après l'heure prévue, relances automatiques jamais hors heures.
- Conservation : messages terminés purgés à 12 mois ; effacement d'une pharmacie à la demande.

**Essais**
- `node scripts/test-push-messages.mjs` (nouveau, 185) : règles, modèles, plafonds par catégorie, e-mail de secours (adresses de compte seulement, piège de l'adresse partagée, idempotence, alerte coupée, plafond — pharmacie sans appareil, appareil en échec, ouverture fermée —, Promotion jamais, téléphones seulement, échappement), Resend borné, programmation (5 min, 60 jours, annulation en file, deux passages simultanés, relance en journée, jamais le soir, expiration après 3 h, garde de diffusion), API (signature identique à chatbot-intake, horodatage, corps altéré, débit avant signature, panne passagère rejouée, réservation orpheline, appareils en échec, doublons sur 10 minutes, statut connu sans texte libre, montants, différé de nuit et envoi à 8 h, plafond, aperçu, charge déchiffrée), actions de l'admin (estimation = envoi, clé idem par contenu, modèles remplacés, effacement), ménage à 12 mois, chemins PostgREST, rendu React de l'onglet, empaquetage esbuild ;
- `node scripts/test-push-serveur.mjs` (259), `test-push-client.mjs` (98), `test-push-sw.mjs` (36, dont 4 de l'appli « Elixir Admin ») : étendus (4 catégories, nouveaux plafonds, lien `/?commandes=1`, empaquetage de `push-evenement` et `push-programmes`) ; stock en mémoire partagé : `scripts/push-stock-memoire.mjs` ;
- `sql/push-schema.sql` puis `sql/push-messages.sql`, deux fois de suite, puis `sql/push-messages-apres.sql` deux fois, sur un Postgres 17 local : contraintes (réclamation à une pharmacie, pas d'e-mail de secours pour une Promotion, nouveaux statuts), index, migration et rattrapage faits une seule fois, RLS ; ancienne version du script puis la nouvelle ;
- banc local (`npm run dev`, données fictives) : onglet 📲 Notifications (pharmacies d'exemple avec et sans appareils, historique, outil entrepôt avec un événement différé), panneau des pharmacies avec 4 alertes (`?banc_push=abonne`) ; contrôles à 375 px (composeur dans le premier écran, aucun défilement horizontal, historique en cartes).

**Appli « Elixir Admin » à l'adresse `/admin`** (branche `appli-admin-ios`, comprise dans celle-ci ; à mettre en ligne avant elle ou avec elle, § 3)
- Fichiers :
  - `index.html` (script en ligne : choix du manifeste, adresse `/admin#admin`), `public/admin.webmanifest` (`start_url` `/admin`) et `src/adresse-admin.js` (nouveau : quitter l'admin, revenir à l'admin) ;
  - `public/sw.js` (fenêtre sur `/admin` reconnue comme l'admin, test de l'admin sans fenêtre → `/admin` ; `VERSION` 2026-10-21.1) et `src/notifications/client.js` (même règle, `surAdresseAdmin`) ;
  - `src/App.jsx` (retour arrière `popstate`, « Ouvrir l'administration Elixir → », cadenas de l'en-tête, « Réinitialiser et recharger »), `src/components/AdminNotifications.jsx` (« Vos appareils » : installation depuis `…/admin`), textes « Session admin expirée » (`App.jsx`, `Notifications.jsx`) ;
  - `scripts/verifie-zones.mjs` : lot `appliAdmin` (clé de stockage `appli_admin`).
- Règles tenues :
  - **Service worker** : aucun gestionnaire `fetch`, aucun cache, servi en `no-store`. Un test met la fenêtre au premier plan sans la recharger ; un aperçu ou une fenêtre sur l'admin (`/admin#admin`, ancienne `/#admin`) ouvre le lien dans une nouvelle fenêtre ; sans fenêtre ouverte, le test de l'admin (`test-admin`) ouvre `/admin`, pas l'accueil des pharmacies. Les catégories et étiquettes des messages (« commandes », « infos », `msg-…`, `evt-…`) suivent les règles d'une fenêtre de pharmacie.
  - **Appli « Elixir Admin » = adresse `/admin`** (21/10/2026). Une icône d'iPhone ajoutée depuis `/#admin` s'ouvrait sur la connexion des pharmacies : l'ancien `index.html` avait une balise manifeste fixe (celle des pharmacies) que le script ne changeait qu'au chargement d'une page déjà sur `#admin` — Safari lit la première balise manifeste de la page et garde le manifeste déjà lu pour la page (WebKit, `DocumentLoader::loadApplicationManifest`), donc un `#admin` ajouté sans rechargement gardait celui des pharmacies — et un fragment `#…` dans l'adresse de départ d'une appli d'écran d'accueil n'est pas fiable sur iOS (perdu selon plusieurs signalements). La cause exacte sur l'iPhone de Zineb ne peut pas être observée d'ici ; la correction écarte les deux. Désormais :
    - `index.html` n'a plus de balise manifeste fixe : son script en ligne en ajoute UNE, avant le démarrage du site, selon l'adresse (`/admin`, `/admin/` ou `#admin` → `admin.webmanifest`, nom « Elixir Admin » ; sinon `manifest.webmanifest`, nom « Elixir ») ;
    - `admin.webmanifest` : `start_url` `/admin` (sans fragment), `id` `/admin` (distinct de `/`, celui des pharmacies : deux applis pour Chrome, vérifié par `Page.getAppId` dans Chrome sur ordinateur ; sur un Android où l'appli des pharmacies est déjà installée, Chrome peut rattacher `/admin` à celle-ci par sa portée `/` et proposer « Ouvrir dans Elixir » : non vérifié, consigne au § 3 f ; la portée des pharmacies n'est pas touchée), `scope` `/` ;
    - le même script complète `/admin`, `/admin/` et l'ancienne `/#admin` en `/admin#admin` (`history.replaceState`) : le site affiche toujours l'admin sur `#admin`. Les liens des e-mails (`…/#admin`) marchent toujours. Netlify sert `index.html` pour `/admin` (`/* /index.html 200`, sans fichier `admin` dans `public/`) ;
    - quitter l'admin (`src/adresse-admin.js`) : « Retour au catalogue », la croix de la connexion et Ctrl+Maj+A mènent à `/`. Dans un navigateur, la page est **rechargée** sur `/` : manifeste et nom des pharmacies (sinon « Sur l'écran d'accueil » ou « Installer l'application » depuis ce catalogue aurait donné une icône « Elixir Admin », ouverte sur `/` si Safari prend l'adresse de la page) ; une modification non enregistrée de l'admin peut faire demander confirmation une seconde fois, par le navigateur ; le retour arrière rouvre `/admin`. Dans l'appli « Elixir Admin », même page : nouvelle entrée d'historique `/`, le retour arrière rouvre l'admin. « Commander pour une pharmacie » remplace l'adresse par `/` (même page, manifeste de l'admin gardé jusqu'au prochain chargement) ; « Réinitialiser et recharger » (erreur de l'admin) recharge `/admin` : connexion de l'admin ;
    - retour à l'admin, page rechargée sur `/admin` : « Ouvrir l'administration Elixir → » sur l'écran de connexion des pharmacies, et le cadenas « Administration Elixir » de l'en-tête du catalogue (aussi pendant une saisie pour une pharmacie), quand ce navigateur a un jeton admin ou dans l'appli « Elixir Admin » (sans barre d'adresse, aucun autre chemin pour revenir). L'appli est reconnue à son ouverture sur l'admin (`OUVERT_EN_APPLI_ADMIN`), puis par la clé `appli_admin` = « 1 » de son stockage (`APPLI_ADMIN`) : une page ouverte plus tard dans l'appli sur une autre adresse (aperçu d'un message, appli fermée) garde ce retour, même sans jeton admin valide. Jamais dans un navigateur ; sur Android, le stockage est partagé avec Chrome et l'appli des pharmacies du même téléphone, qui montre alors aussi ce retour (appareil de l'équipe seulement) ;
    - textes « Session admin expirée » (envoi d'une saisie, choix de la pharmacie, notifications d'une pharmacie servie) : « ouvrez l'administration (elixir-commande.expepharma.com/admin) », plus « #admin ».
- Essais :
  - `node scripts/test-push-sw.mjs` (36, avec les messages) : dont fenêtres sur `/admin#admin` et `/admin`, test de l'admin sans fenêtre → `/admin` ;
  - `node scripts/test-appli-admin.mjs` : script d'`index.html` exécuté pour chaque adresse (une seule balise manifeste, `/admin` → `/admin#admin`, pages des pharmacies inchangées), manifestes, routage Netlify, `src/adresse-admin.js`, textes d'installation ; aussi sur `dist/index.html` après `npm run build` ;
  - `node scripts/banc/controle-appli-admin.mjs <banc>` : Chrome sans tête sur le banc local (manifeste lu par Chrome, identifiants d'appli, admin ou connexion des pharmacies affichés, fermer avec rechargement sur le manifeste des pharmacies, retour arrière, cadenas de l'en-tête, appli « Elixir Admin » simulée).

**Bundle des pharmacies** : 906 018 octets pour un budget de 940 000 (`npm run zones`), soit +1 855 octets depuis `b1dbd3e` : le lien `?commandes=1` (+378) et l'adresse `/admin` (+1 477 : `src/adresse-admin.js`, lien et cadenas de retour à l'admin). L'onglet admin est dans le chunk de l'admin, chargé à la demande.

---

## 11. Limites

- **Ce qui part** : vos messages (4 types), les tests, les retours en stock, et l'outil entrepôt une fois branché (§ 6).
- **E-mail de secours** : message à une pharmacie seulement ; jamais pour une Promotion ; jamais quand le plafond l'écarte (et il y compte) ; jamais pour une Communication si elle a coupé l'alerte ; « joignable » = un téléphone a accepté la notification.
- **Programmation** : envoi dans les 5 minutes après l'heure ; jamais au-delà de 3 h de retard ; relances automatiques aux heures ouvertes seulement.
- **Outil entrepôt** : rien ne part le soir, la nuit ni le dimanche (différé à 8 h).
- **Plafond de sécurité** : frein d'urgence approximatif sous forte concurrence (une ou deux unités).
- **iPhone** : iOS 16.4 ou plus récent, application de l'écran d'accueil, reconnexion une fois. **Ordinateur** : navigateur ouvert.
- **Réception** : Ne pas déranger, Concentration, Résumé programmé, réglages du système, économie de batterie.
- **10 appareils** au plus par pharmacie ; Huawei récents sans services Google et Brave exclus.
- **Clés VAPID** : ne jamais les changer sans raison.

---

## 12. Dépannage

| Situation | Réponse |
|---|---|
| « Je n'ai rien reçu » | Panneau → « Envoyer une notification de test ». Ne pas déranger / Concentration, et droit du navigateur (ou de l'application Elixir) à afficher des notifications dans les réglages du téléphone ou de l'ordinateur. Sur ordinateur, navigateur ouvert. |
| Une pharmacie dit ne pas recevoir vos « Informations » | Historique → Par pharmacie : l'alerte « Informations Elixir » est-elle activée sur ses appareils ? Si elle avait coupé les offres avant la mise en service, elle est coupée aussi (§ 3 a) : elle l'active dans son panneau. |
| Message « Réclamation » écarté par le plafond | 10 messages « Mes commandes et réclamations » en 24 h pour cette pharmacie (outil entrepôt compris) : vérifiez l'historique « Outil entrepôt » (boucle ?), ou relevez le plafond de sécurité dans « Ouverture aux pharmacies ». |
| L'envoi est refusé : « Remplacez les champs entre crochets » | Un « [référence] » ou « [date] » du modèle n'a pas été remplacé. |
| L'envoi est refusé : montant | Retirez le montant d'un message « Réclamation / SAV » ou « Commande » (« 45,90 HT », « solde : 120 » comptent aussi) ; le détail chiffré passe par la facture ou votre e-mail. |
| L'envoi est refusé : « Commande à plusieurs pharmacies » | Le texte contient un numéro propre à une pharmacie (commande, bon) : retirez-le, ou envoyez à « Une pharmacie ». |
| « Pas d'e-mail : plafond atteint » | La pharmacie a déjà reçu son plafond de la semaine (Communication) ou de la journée (Réclamation / Commande), par notification ou par e-mail : rien n'est parti. |
| L'outil entrepôt reçoit 503 « indisponible » | Rien n'a été consommé : il rejoue la même clé après le délai `Retry-After` (2 minutes). Si cela dure : base Supabase, clés VAPID, ou appareils de la pharmacie qui ne répondent plus. |
| Événement « différée au matin (8 h) » | Reçu le soir, la nuit ou le dimanche : il part à 8 h (lundi 8 h le week-end). |
| E-mail de secours « aucune adresse de compte » | La pharmacie n'a pas de compte sur le site (aucune adresse dans la table des pharmacies pour son CIP) : appelez-la, ou faites-lui créer son accès. |
| Message programmé en erreur « Non envoyé : prévu le … » | Le service n'a pas tourné pendant plus de 3 heures autour de l'heure prévue : recomposez-le si c'est encore utile. |
| « En file » qui dure | Une autre diffusion plafonnée est en cours, ou le lancement a été perdu : relance automatique toutes les 5 minutes aux heures ouvertes, pendant 3 heures après l'heure prévue ; ensuite, erreur « Non envoyé ». « Annuler » reste possible tant qu'il est en file. |
| L'outil entrepôt reçoit 401 | Secret différent des deux côtés, ou horloge du serveur de l'outil décalée de plus de 5 minutes. |
| L'outil entrepôt reçoit 503 « configuration » | `PUSH_EVENEMENT_SECRET` absent de Netlify (ou plus court que 32 caractères), ou déploiement pas relancé après l'avoir ajouté. |
| L'icône « Elixir Admin » ouvre l'accueil des pharmacies | Icône ajoutée depuis l'ancienne adresse `/#admin`. Supprimez l'icône, puis ajoutez-la de nouveau depuis Safari à l'adresse `https://elixir-commande.expepharma.com/admin` (§ 3 f). |
| Dans l'appli « Elixir Admin », je suis sur la connexion des pharmacies (après « Retour au catalogue », la croix, ou « Terminer » une saisie pour une pharmacie) | Touchez « Ouvrir l'administration Elixir → » sous le bouton « Continuer » : l'admin se rouvre. |
| Dans l'appli « Elixir Admin », je suis sur le catalogue (session de pharmacie dans l'appli, ou saisie pour une pharmacie) | Touchez le cadenas en haut, à côté du nom de la pharmacie (« Administration Elixir ») : l'admin se rouvre. |
| « Le bouton n'apparaît pas sur mon iPhone » | Ajouter l'application à l'écran d'accueil depuis Safari, puis l'ouvrir depuis l'icône (une ancienne icône qui ouvre Safari : la supprimer et la rajouter). |
| « Bloquées » | Autorisation refusée : iPhone → Réglages → Notifications → Elixir ; Android et ordinateur → icône à gauche de l'adresse → Notifications. |

---

## 13. En cas de problème

1. **Plus rien vers les pharmacies** : ouverture « Fermée ». Plus aucune notification ne part (seuls les e-mails de secours des messages unitaires peuvent encore partir, si vous les demandez). Les abonnements restent.
2. **Un message programmé (ou en file) ne doit pas partir** : historique → « À venir » → « Annuler » (ou « Annuler et modifier » pour le corriger).
3. **L'outil entrepôt emballé** : retirez `PUSH_EVENEMENT_SECRET` de Netlify et redéployez (l'API répond alors 503 à tout), ou baissez le plafond de sécurité.
4. **Arrêt d'urgence du service worker** : faites d'abord le point 1, puis remplacez `public/sw.js` par :
   ```js
   self.addEventListener("install", () => self.skipWaiting());
   self.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister()));
   self.addEventListener("push", (e) => e.waitUntil(self.registration.showNotification("Elixir Pharma", { body: "Nouvelle information dans votre espace Elixir." })));
   ```
   et mettez en ligne.
5. **Retour arrière complet** : Netlify → Deploys → republiez le déploiement précédent (« Publish deploy »). Le script SQL n'a pas besoin d'être défait : la version précédente fonctionne avec. Annulez d'abord les messages programmés : la version précédente ne les enverrait jamais (ils resteraient « Programmé »).

---

## Annexe A. Mise en service initiale (20/10/2026, pour mémoire)

Faite avec la version en ligne `b1dbd3e` ; détail complet dans l'historique git de ce fichier (`git show b1dbd3e:elixir-commande/docs/notifications.md`, § 3).
- Clés VAPID générées par vous sur le Mac (`npx web-push generate-vapid-keys`), jamais montrées à personne, gardées dans votre gestionnaire de mots de passe. Variables Netlify : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret), `VAPID_SUBJECT` = `mailto:pharmacien@elixirpharma.fr` ; déjà en place : `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. **Ne jamais changer les clés VAPID** (tous les appareils devraient se réabonner).
- `sql/push-schema.sql` dans Supabase.
- Ouverture « Fermée », puis « Pilote » avec une ou deux pharmacies volontaires, puis « Toutes » **seulement après l'étape « Bloc 1 » du plan de fermeture de Supabase**.
- Test sur votre téléphone : iPhone → Safari sur `…/#admin` → Partager → « Sur l'écran d'accueil » (« Elixir Admin ») → 📲 Notifications → « Recevoir les notifications sur cet appareil » → « M'envoyer un test ». Depuis l'appli « Elixir Admin » à l'adresse `/admin`, l'installation se fait depuis `https://elixir-commande.expepharma.com/admin` (§ 3 f) ; une icône ajoutée depuis `…/#admin` est à supprimer, puis à rajouter ainsi.
