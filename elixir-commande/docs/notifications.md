# Appli Elixir installable et notifications sur le téléphone

Pour Zineb Moulatif. État du 21/10/2026 : branche `notifications-messages` (partie de la version en ligne `b1dbd3e`), messages unitaires et collectifs.

Vos demandes :
- 20/10/2026 : « Est ce que c'ets compliqué de faire de tout ça une vraie app qui enverrai des notifications », puis « On peut faire le 1 ». C'est en ligne : appli installable, notifications « Retour en stock » et annonces « Offres et nouveautés ».
- 21/10/2026 : « prévoir l'envoi d'une notification unitaire ou collective : communication, promotion, traitement d'une reclamation, etc. ». C'est l'objet de cette branche (§ 3 à 7).

**Rien de nouveau n'est en ligne tant que vous ne lancez pas la commande de mise en ligne** (§ 3 c). Le script SQL se passe **avant** (§ 3 a).

---

## 1. Ce que ça fait

**Pour les pharmacies**
- Le site de commande est une **application installable** : icône Elixir sur l'écran d'accueil, plein écran. Elle montre toujours la dernière version du site.
- Une carte **« Recevez nos alertes sur votre téléphone »** en bas de l'accueil propose l'activation selon l'appareil (Android : deux touches ; iPhone : guide d'installation ; ordinateur : code QR ou activation sur place).
- Un menu **« MON COMPTE → Notifications »** (menu ☰ sur téléphone) et une cloche dans l'en-tête sur grand écran. Le panneau permet de choisir **4 alertes**, chacune par un interrupteur :

| Alerte | Ce qu'elle reçoit | Plafond |
|---|---|---|
| **Retour en stock** | les produits pour lesquels la pharmacie a cliqué « M’avertir du retour », juste après l'e-mail | aucun |
| **Mes commandes et réclamations** (nouveau nom de « Mes commandes ») | vos messages « Réclamation / SAV » et « Commande », et plus tard l'outil entrepôt (§ 6) | sécurité : 10 par 24 h |
| **Informations Elixir** (nouvelle) | vos messages « Communication » : fermetures exceptionnelles, changements de service, nouveautés du site | 2 par 7 jours |
| **Offres et nouveautés** | vos messages « Promotion » | 2 par 7 jours |

- Le panneau sert aussi à envoyer une notification de test, voir et retirer ses appareils, désactiver, et lire « Vos données ».
- Le lien **`https://elixir-commande.expepharma.com/?notifications=1`** ouvre directement le panneau (mailing, SMS).
- Nouveau : le lien **`/?commandes=1`** d'une notification ouvre directement **« Mes commandes »** de la pharmacie.

**Pour vous, dans l'admin, onglet « 📲 Notifications »**
- **État du service** : des coches. Nouveau point : « Tables des messages » (script `sql/push-messages.sql`).
- **Ouverture aux pharmacies** (fermée, pilote, toutes) et les **trois plafonds** : offres, informations, sécurité des commandes et réclamations.
- **Vos appareils** : pour recevoir vous-même les tests et les aperçus.
- **Pharmacies joignables** : statistiques par alerte et par appareil, liste, retrait.
- **Nouveau message** (§ 4) : type, modèle, texte, lien, destinataires (une pharmacie, plusieurs, toutes), e-mail de secours, envoi maintenant ou **programmé** (§ 5), estimation avant l'envoi, aperçus Android et iPhone.
- **Historique** (§ 7) : messages, par pharmacie, outil entrepôt.

**Onglet « 🏥 Pharmacies »** : la fiche d'une pharmacie (CIP renseigné) montre un bloc **« Notifications envoyées »** (90 derniers jours).

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

**L'e-mail reste la voie des informations importantes.** Pour un message à **une** pharmacie, vous pouvez demander l'**e-mail de secours** : il part si aucun de ses appareils n'a reçu la notification (§ 4.5).

On ne peut pas promettre « tous les pharmaciens ». On peut promettre que **chaque pharmacien qui l'active** reçoit vos messages, et que l'estimation vous dit avant l'envoi combien de pharmacies seront jointes.

---

## 3. Mise en service des messages (dans l'ordre)

La branche part de la version en ligne (`b1dbd3e`). Rien n'est à fusionner tant qu'aucune autre branche n'est mise en ligne avant elle.

**a. Passer le script SQL, avant la mise en ligne.** Dans l'application Terminal du Mac, tapez cette ligne : elle copie le script dans le presse-papiers (rien ne s'affiche).

```
pbcopy < ~/Downloads/elixir-notif-msg-wt/elixir-commande/sql/push-messages.sql
```

Puis Supabase → SQL Editor → New query → Cmd+V → Run.
- Le script **ajoute** seulement : colonnes, contraintes, deux tables (modèles, événements de l'outil entrepôt) et une table de suivi des migrations. Il ne supprime rien.
- Il est compatible avec la version déjà en ligne : vous pouvez le passer aujourd'hui, même si la mise en ligne attend.
- Vous pouvez le relancer sans risque (vérifié : deux passages de suite sur un Postgres 17, `push-schema.sql` relancé entre les deux).
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

- Ne supprimez pas le dossier `~/Downloads/elixir-notif-msg-wt` avant.
- Netlify déploie en 2 à 3 minutes (Deploys : « Published »).
- Si Git répond « rejected » ou « non-fast-forward » : une autre branche a été mise en ligne entre-temps (par exemple l'appli admin iPhone ou la Péremption à −50 %). **Ne forcez rien** : demandez une intégration de la branche, puis relancez la même commande.
- La fonction planifiée `push-programmes` (messages programmés, toutes les 5 minutes) démarre seule avec le déploiement.

**d. Vérifier dans l'admin.** 📲 Notifications → « État du service » : toutes les coches vertes, aucune ligne « Tables des messages absentes ». Les plafonds de « Ouverture aux pharmacies » affichent 2, 2 et 10.

**e. Essayer avec une pharmacie pilote** (votre propre téléphone ne reçoit que les tests et les aperçus, jamais les messages des pharmacies) :
1. « M'envoyer l'aperçu » d'un message : il arrive sur votre téléphone.
2. Un message « Réclamation / SAV » à **une** pharmacie pilote prévenue, sans e-mail de secours. L'historique affiche « Envoyé » et le nombre d'appareils joints.
3. L'e-mail de secours : **il part vraiment** aux adresses du compte de la pharmacie. Faites le premier essai avec une pharmacie amie prévenue, ou un compte de test à votre adresse s'il en existe un.
4. Un message programmé dans 10 minutes, puis annulé ; un autre laissé partir.

---

## 4. Envoyer un message

### 4.1 Les types

| Type | Arrive dans l'alerte | Destinataires | Plafond par pharmacie | Contenu |
|---|---|---|---|---|
| **Promotion** | Offres et nouveautés | une, plusieurs ou toutes | 2 sur 7 jours glissants (réglable 0 à 7) | prix admis |
| **Communication** | Informations Elixir | une, plusieurs ou toutes | 2 sur 7 jours glissants, à part des offres (réglable 0 à 7) | fermetures, service, nouveautés |
| **Réclamation / SAV** | Mes commandes et réclamations | **une ou 20 au plus**, jamais toutes | sécurité : 10 sur 24 h (réglable 1 à 50) | **aucun montant** |
| **Commande** | Mes commandes et réclamations | **une ou 20 au plus**, jamais toutes | même plafond de sécurité | **aucun montant** |

- Les messages « Réclamation / SAV » et « Commande » ne comptent **pas** dans les plafonds des offres et des informations. Leur plafond de sécurité arrête un emballement (double saisie, outil entrepôt qui boucle) ; il compte aussi les notifications de l'outil entrepôt.
- **Montants** : « Réclamation / SAV » et « Commande » refusent tout montant en euros (« 12,50 € », « 30 euros »), même dans un avoir : la notification s'affiche sur l'écran verrouillé. Le détail chiffré part par e-mail ou dans l'espace de la pharmacie.
- Jamais de donnée de patient, quel que soit le type.
- **Une seule diffusion plafonnée à la fois** (Promotion ou Communication en cours d'envoi : l'autre attend). Les messages « Réclamation / SAV » et « Commande » ne sont jamais bloqués par une diffusion en cours.

### 4.2 Les destinataires

- **Une pharmacie** : recherchez-la par **nom, ville ou CIP**. Seules les pharmacies qui ont un **compte sur le site** apparaissent : les autres ne peuvent recevoir ni notification ni e-mail de secours. Pour chacune, vous voyez :
  - ses appareils (nombre et type) et si elle reçoit l'alerte du type choisi (✓ ou ✗) ;
  - quand un de ses appareils activés a ouvert le site pour la dernière fois, et la dernière notification reçue ;
  - les adresses de secours, **masquées** (« co…@…fr ») ;
  - « hors pilote » si l'ouverture est en pilote sans elle.
- **Plusieurs pharmacies** : la même recherche (« Ajouter »), ou la liste des pharmacies abonnées à l'alerte. 500 au plus pour Promotion et Communication, 20 pour Réclamation / SAV et Commande.
- **Toutes les pharmacies abonnées** : Promotion et Communication seulement.

### 4.3 L'estimation, avant l'envoi

Elle se met à jour à chaque changement :
- combien de pharmacies **recevront** la notification, et sur combien d'appareils ;
- combien sont **écartées par le plafond** ;
- combien sont **non joignables** : sans appareil, avec l'alerte coupée, hors pilote. Pour « toutes » : combien de pharmacies clientes n'ont pas activé les notifications ;
- pour un message unitaire avec e-mail de secours : combien d'adresses de compte (masquées) le recevraient.

Les destinataires réels sont recalculés au moment de l'envoi : comptes revérifiés, ouverture et plafonds du moment.

### 4.4 Les modèles

**Modèles Elixir** (prêts, modifiables avant l'envoi) :

| Modèle | Type | Titre | Texte |
|---|---|---|---|
| Réclamation reçue | Réclamation / SAV | Réclamation reçue | Nous avons bien reçu votre réclamation [référence]. Réponse sous 24 h ouvrées (du lundi au vendredi). |
| Réclamation traitée | Réclamation / SAV | Réclamation traitée | Votre réclamation [référence] est traitée. Le détail vous est envoyé par e-mail. |
| Retour accepté | Réclamation / SAV | Retour accepté | Votre demande de retour [référence] est acceptée. Les modalités de reprise vous sont envoyées par e-mail. |
| Avoir émis | Réclamation / SAV | Avoir émis | Un avoir est émis pour votre réclamation [référence]. Le détail vous est envoyé par e-mail. (sans montant) |
| Commande expédiée | Commande | Commande expédiée | Votre commande [n° de commande] est sortie de l'entrepôt (tournée [n° de tournée]). |
| Reliquat | Commande | Reliquat sur votre commande | Une partie de votre commande [n° de commande] est en reliquat : elle partira dès réception du stock. |
| Fermeture exceptionnelle | Communication | Fermeture exceptionnelle | Elixir Pharma sera fermé le [date]. Les commandes reçues ce jour-là partiront le [date de reprise]. |
| Nouveau menu | Communication | Nouveau sur votre espace Elixir | Découvrez le menu [nom du menu] : [ce qu'il apporte]. |
| Offre du moment | Promotion | Offre du moment | [produit ou gamme] : [avantage] jusqu'au [date]. |

- Les champs **entre crochets en minuscules** sont à remplacer : l'envoi (et l'aperçu) est refusé tant qu'il en reste. « [NOUVEAU] » en majuscules reste admis.
- Les modèles de réclamation et de commande ouvrent **« Mes commandes »** au toucher (`/?commandes=1`).
- **« Enregistrer comme modèle »** garde le message en cours (type, titre, texte, lien) sous un nom, côté serveur : il est partagé entre les admins, dans « Vos modèles ». 100 au plus, noms uniques ; « Supprimer ce modèle » le retire (les messages déjà envoyés ne changent pas).

### 4.5 L'e-mail de secours (message à une pharmacie)

Case **« Si la pharmacie n'est pas joignable sur téléphone, envoyer aussi par e-mail »**.
- Il part **seulement si aucun appareil de la pharmacie n'a reçu la notification** : pas d'appareil, envois en échec, ou ouverture fermée.
- Destinataires : les **adresses de connexion de son compte** sur le site (celles de la table des pharmacies qui portent son CIP), 5 au plus, **un e-mail par adresse**. Jamais l'e-mail de la fiche Odoo : il peut être partagé avec une autre officine du même titulaire (le piège déjà corrigé pour « Commander pour une pharmacie »). Jamais une adresse tapée dans la page : la page ne voit que des adresses masquées.
- Il ne contourne **jamais** un choix de la pharmacie ni un plafond :
  - plafond atteint : ni notification ni e-mail ;
  - Promotion ou Communication, alerte coupée sur tous ses appareils : pas d'e-mail ;
  - Réclamation / SAV ou Commande, alerte coupée : l'e-mail part quand même (c'est le suivi de son dossier, et l'e-mail est la voie habituelle).
- L'e-mail reprend la charte de l'e-mail « De retour en stock » : en-tête pétrole, titre, texte, bouton vers la page du lien (« Voir mes commandes », « Voir le produit »…), expéditeur `pharmacien@elixirpharma.fr`, réponse à la même adresse. Le pied explique pourquoi il arrive par e-mail et comment activer les notifications.
- Il ne part jamais deux fois : clé d'idempotence par message et par adresse.
- Avec l'ouverture « fermée », un message unitaire avec e-mail de secours peut partir quand même : seul l'e-mail part.

### 4.6 Envoyer

- **« M'envoyer l'aperçu »** d'abord : le message arrive sur vos appareils.
- **Horaires** : avant 8 h, après 20 h et le dimanche (heure de Paris), l'admin demande une confirmation de plus.
- Un envoi « maintenant » ne s'annule pas ; un double clic n'envoie jamais deux fois.
- Message à une ou quelques pharmacies : le résultat s'affiche sous le bouton quelques secondes après (« Envoyé : 2 appareils joints », « Aucun appareil joint. E-mail de secours : e-mail envoyé (2 adresses) »).
- Un message resté « En file » (lancement perdu, autre diffusion en cours) est **relancé automatiquement** toutes les 5 minutes pendant 24 heures ; « Relancer » reste possible à la main.

---

## 5. Programmer un message

- Envoi → **« Programmer »** → date et heure, **heure de Paris** (passage à l'heure d'été et d'hiver compris ; une heure qui n'existe pas, le dernier dimanche de mars entre 2 h et 3 h, est refusée).
- Au plus tôt dans 5 minutes, au plus tard dans 60 jours ; 50 messages programmés en attente au plus.
- Confirmation de plus si l'heure choisie tombe avant 8 h, après 20 h ou un dimanche.
- Le message part **au plus 5 minutes après l'heure prévue** (fonction `push-programmes`). Destinataires, ouverture et plafonds sont ceux **du moment de l'envoi**.
- **Annuler** : dans l'historique, bouton « Annuler » tant que le message est « Programmé ». Après, il est parti.
- Sécurité : un message dû depuis **plus de 3 heures** (service arrêté, panne) n'est **jamais** envoyé en retard ; l'historique l'indique en erreur (« Non envoyé : prévu le … »). Une fermeture annoncée deux jours trop tard ferait plus de mal que de bien.
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

Un autre statut (minuscules et `_`) est admis s'il vient avec `titre` (60 caractères) et `corps` (160). Jamais de montant (refusé).

**Ce qui se passe** : la pharmacie du CIP reçoit la notification dans **« Mes commandes et réclamations »** (ouverture, alerte choisie, comptes revérifiés et plafond de sécurité de 10 par 24 h respectés), lien « Mes commandes » par défaut. Les statuts successifs d'une même référence **remplacent** la notification précédente sur l'appareil (même étiquette, à clé : la référence n'est jamais lisible par Google ou Apple). Pas d'e-mail de secours ici : l'outil entrepôt envoie ses propres e-mails.

**Réponses**

| Code | Corps | Sens |
|---|---|---|
| 200 | `{ ok, resultat: "envoye", envoyes, echecs }` | parti |
| 200 | `resultat` : `aucun_appareil`, `fermee`, `hors_pilote`, `plafond`, `configuration` | rien n'est parti, normal (pas une erreur à rejouer) |
| 200 | `{ ok, deja: true, resultat }` | même clé, **ou** même statut déjà notifié pour cette référence et cette pharmacie : rien n'est renvoyé |
| 400 | `requete` (avec `erreurs`), `json`, `idempotency_key` | corps ou en-tête à corriger |
| 401 | `signature` ou `horodatage` | secret différent, corps modifié, horloge décalée de plus de 5 minutes |
| 409 | `idempotency_key_reutilisee` | même clé pour un autre événement |
| 413 | `trop_long` | plus de 4 Ko |
| 429 | `quota` (en-tête `Retry-After`) | plus de 120 appels par minute, ou 30 par pharmacie et par heure |
| 503 | `configuration` ou `indisponible` | secret absent, tables absentes, base injoignable : à rejouer plus tard avec la **même** clé |

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

**Journal** : une ligne par événement (type, statut, résultat), jamais le texte, la référence ni le secret. Les événements reçus sont visibles dans l'historique « Outil entrepôt » (§ 7) et effacés après 90 jours.

---

## 7. Historiques

Onglet 📲 Notifications → **Historique**, trois vues :
- **Messages** : programmés d'abord (avec « Annuler »), puis les plus récents. Pour chacun : date (ou heure prévue), type, titre, texte et lien, destinataires (nom de la pharmacie pour un message unitaire), résultat (pharmacies visées / écartées par le plafond / servies, appareils réussis / en échec / retirés), e-mail de secours (envoyé, en échec, aucune adresse, non nécessaire), statut.
- **Par pharmacie** : toutes les notifications reçues par une pharmacie sur 90 jours, quelle que soit l'origine (message de l'admin, retour en stock, outil entrepôt), avec l'alerte, les appareils joints et l'e-mail de secours ; en tête, ses appareils, ses alertes, sa dernière visite et son nombre d'adresses de compte.
- **Outil entrepôt** : les événements reçus par l'API (§ 6) et leur résultat.

Onglet 🏥 Pharmacies → fiche d'une pharmacie (CIP renseigné) : bloc **« Notifications envoyées »**, les 20 dernières, en lecture seule.

---

## 8. Données

- **Stockage** : tables fermées (RLS sans policy), lues seulement par les fonctions, avec la clé serveur.
  - `push_abonnements` (appareils), `push_reglages`, `push_annonces` (messages de l'admin, gardés pour l'historique), `push_envois` (envois par pharmacie : alerte, titre, type, origine, appareils joints, résultat de l'e-mail de secours — jamais l'adresse), `push_hotes_refuses` ;
  - nouvelles : `push_modeles` (modèles enregistrés, auteur), `push_evenements` (événements de l'outil entrepôt : CIP, type, statut, référence, titre, résultat), `push_migrations`.
- **Ce qui est enregistré pour un appareil** : adresse technique du service push (Google, Apple, Mozilla, Microsoft), clés de chiffrement, CIP et e-mail du compte (pris dans le jeton), alertes choisies, libellé (« iPhone · application »), dates d'activation, de dernière visite et de dernier envoi.
- **E-mail de secours** : les adresses sont lues dans la table des pharmacies au moment de l'envoi ; elles ne sont copiées nulle part ; la page de l'admin n'en voit que la forme masquée.
- **Contenu des notifications** : aucune donnée de patient ; aucun montant pour les messages transactionnels.
- **Conservation** (`push-menage`, chaque nuit) : envois et événements de l'outil entrepôt effacés après 90 jours ; appareil supprimé à la désactivation, à la déconnexion, au retrait, quand le service push le dit introuvable, après 12 mois sans visite, et dès que l'e-mail du compte n'est plus rattaché à la pharmacie ; services push refusés effacés après 90 jours.
- **Consentement** : activation par un clic, alertes choisies une à une, retrait à tout moment. La carte de l'accueil dit que l'activation inclut nos informations et nos offres (plafonnées). Pour les appareils déjà abonnés, voir § 3 a.
- **Information des pharmacies** : panneau « Vos données ». Mention à reprendre dans la page « données personnelles » du site (inchangée) :
  > Notifications de l'application Elixir : si vous les activez, Elixir Pharma enregistre pour chaque appareil l'adresse technique et les clés de chiffrement fournies par votre navigateur (Google, Apple, Mozilla ou Microsoft), l'e-mail de votre compte et le CIP de la pharmacie, le type d'appareil, les alertes choisies et les dates d'activation, de dernière visite et de dernier envoi, dans le seul but de vous envoyer ces notifications. Ces données sont supprimées quand vous désactivez les notifications, vous déconnectez ou retirez l'appareil, et automatiquement après 12 mois sans visite. Accès, effacement : pharmacien@elixirpharma.fr.
- **Demande d'effacement** : admin → « Pharmacies joignables » → **Retirer** sur la ligne de la pharmacie.

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
- Notifications « déclaratives » d'iOS 18.4, après un essai réel ; pastille sur l'icône ; alertes pour l'équipe Elixir (relais PharmaML muet).

---

## 10. Pour l'équipe technique

**Fichiers de la branche `notifications-messages`**
- Serveur :
  - `netlify/functions/_push-messages.js` (nouveau) : e-mail de secours (charte, envoi Resend borné et idempotent, adresses de compte), joignabilité des pharmacies, programmation (`traiterProgrammes`), API de l'outil entrepôt (`verifierSignature`, `signer`, textes par défaut, étiquette à clé, empreinte de dédoublonnage) ;
  - `netlify/functions/_push.js` : catégories et plafonds par type (`dejaRecus`, `plafondDe`), `destinataires` par catégorie, `diffuserAnnonce` (types, e-mail de secours par `deps.repli`, une seule diffusion plafonnée à la fois), `notifierPharmacie` (plafonds infos et commandes, titre/type/origine tracés), stockage (`comptesDuCip`, `comptesDesCips`, `chercherPharmacies`, `cipsClientes`, `modeles`, `evenements`, programmation des messages, repli sans les colonnes de `push-messages.sql`), `lancerEnvoi` partagé ;
  - `push-admin.js` : actions `estimer` (par type), `envoyer` (types, programmation, e-mail de secours), `annuler`, `message`, `historique` (global ou `{ cip }`), `evenements`, `chercher`, `modeles`, `modele_enregistrer`, `modele_supprimer` ; jamais d'adresse e-mail complète d'une pharmacie dans une réponse ;
  - `push-envoi-background.js` : passe `creerRepli` à `diffuserAnnonce` ;
  - `push-programmes.js` (nouveau, planifié `*/5 * * * *` dans `netlify.toml`) ;
  - `push-evenement.js` (nouveau) : API signée ;
  - `push-abonnement.js` : `plafond_infos_7j` et 4 catégories dans le statut ;
  - `sql/push-messages.sql` (nouveau, à passer après `push-schema.sql`).
- Site :
  - `src/notifications/regles.js` : 4 catégories, types (`TYPES_MESSAGE`), `verifierMessage`, montants et champs à compléter, programmation et heure de Paris (`parisVersIso`, `isoVersParis`, `horsHeures`), plafonds (`plafondDe`), lien `/?commandes=1` ;
  - `src/notifications/modeles.js` (nouveau) : modèles Elixir, `verifierModele` ;
  - `src/components/AdminMessages.jsx` (nouveau) : composeur, choix des destinataires, estimation, programmation, historiques, bloc `NotificationsEnvoyees` de la fiche pharmacie ; aperçus Android et iPhone déplacés ici depuis `AdminNotifications.jsx` (qui garde état du service, ouverture et plafonds, appareils, statistiques) ;
  - `src/AdminPanel.jsx` : bloc « Notifications envoyées » sous la fiche d'une pharmacie ;
  - `src/App.jsx` : lien `?commandes=1` → « Mes commandes » ouvert une fois la pharmacie connue (+0,4 Ko dans le bundle des pharmacies) ;
  - `src/notifications/Notifications.jsx` : textes de la carte et plafond des informations ;
  - `src/dev/reponses-fictives.js` et `scripts/banc/plugin.mjs` : nouvelles actions (aperçus Netlify et banc local).
- `scripts/verifie-zones.mjs` : `push-evenement` et `push-programmes` ajoutés aux fonctions nouvelles admises (`AJOUTS_AUTORISES`) ; aucune zone protégée ni clé de stockage modifiée (le brouillon du composeur garde la même clé de session).

**Règles tenues**
- Identité de l'admin par `verifyAdmin` ; jamais de 401/403 pour une raison métier.
- Destinataires de l'e-mail de secours décidés par le serveur (adresses de compte du CIP), jamais par la page.
- API : signature à temps constant, horodatage ±5 min, clé d'idempotence obligatoire, dédoublonnage par (pharmacie, type, référence, statut), débit borné, journal sans contenu, hôte d'aperçu sans effet.
- Une seule diffusion plafonnée à la fois (index unique recréé par `push-messages.sql` sur les catégories offres et infos) ; les messages transactionnels ne sont jamais bloqués.
- Programmation : passages conditionnels (programmée → en file, programmée → annulée), abandon au-delà de 3 h de retard.

**Essais**
- `node scripts/test-push-messages.mjs` (nouveau, 141) : règles, modèles, plafonds par catégorie, e-mail de secours (adresses de compte seulement, piège de l'adresse partagée, idempotence, alerte coupée, plafond, ouverture fermée, échappement), Resend borné, programmation (5 min, 60 jours, annulation, deux passages simultanés, relance, retard de 3 h), API (signature identique à chatbot-intake, horodatage, corps altéré, doublons, plafond, débit, aperçu, charge déchiffrée), actions de l'admin, chemins PostgREST, rendu React de l'onglet, empaquetage esbuild ;
- `node scripts/test-push-serveur.mjs` (259), `test-push-client.mjs` (98), `test-push-sw.mjs` (32) : étendus (4 catégories, nouveaux plafonds, lien `/?commandes=1`, empaquetage de `push-evenement` et `push-programmes`) ; stock en mémoire partagé : `scripts/push-stock-memoire.mjs` ;
- `sql/push-schema.sql` puis `sql/push-messages.sql`, deux fois de suite, sur un Postgres 17 local : contraintes, index unique, migration faite une seule fois, RLS ;
- banc local (`npm run dev`, données fictives) : onglet 📲 Notifications (pharmacies d'exemple avec et sans appareils, historique, outil entrepôt), panneau des pharmacies avec 4 alertes (`?banc_push=abonne`).

**Bundle des pharmacies** : 904 540 octets pour un budget de 940 000 (+377 octets, le lien `?commandes=1`). L'onglet admin est dans le chunk de l'admin, chargé à la demande.

---

## 11. Limites

- **Ce qui part** : vos messages (4 types), les tests, les retours en stock, et l'outil entrepôt une fois branché (§ 6).
- **E-mail de secours** : message à une pharmacie seulement ; jamais quand le plafond l'écarte ; jamais pour Promotion ou Communication si elle a coupé l'alerte.
- **Programmation** : envoi dans les 5 minutes après l'heure ; jamais au-delà de 3 h de retard.
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
| L'envoi est refusé : montant | Retirez le montant d'un message « Réclamation / SAV » ou « Commande » ; il part par e-mail ou dans l'espace de la pharmacie. |
| E-mail de secours « aucune adresse de compte » | La pharmacie n'a pas de compte sur le site (aucune adresse dans la table des pharmacies pour son CIP) : appelez-la, ou faites-lui créer son accès. |
| Message programmé en erreur « Non envoyé : prévu le … » | Le service n'a pas tourné pendant plus de 3 heures autour de l'heure prévue : recomposez-le si c'est encore utile. |
| « En file » qui dure | Une autre diffusion plafonnée est en cours, ou le lancement a été perdu : relance automatique toutes les 5 minutes pendant 24 heures. |
| L'outil entrepôt reçoit 401 | Secret différent des deux côtés, ou horloge du serveur de l'outil décalée de plus de 5 minutes. |
| L'outil entrepôt reçoit 503 « configuration » | `PUSH_EVENEMENT_SECRET` absent de Netlify (ou plus court que 32 caractères), ou déploiement pas relancé après l'avoir ajouté. |
| « Le bouton n'apparaît pas sur mon iPhone » | Ajouter l'application à l'écran d'accueil depuis Safari, puis l'ouvrir depuis l'icône (une ancienne icône qui ouvre Safari : la supprimer et la rajouter). |
| « Bloquées » | Autorisation refusée : iPhone → Réglages → Notifications → Elixir ; Android et ordinateur → icône à gauche de l'adresse → Notifications. |

---

## 13. En cas de problème

1. **Plus rien vers les pharmacies** : ouverture « Fermée ». Plus aucune notification ne part (seuls les e-mails de secours des messages unitaires peuvent encore partir, si vous les demandez). Les abonnements restent.
2. **Un message programmé ne doit pas partir** : historique → « Annuler ».
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
- Test sur votre téléphone : iPhone → Safari sur `…/#admin` → Partager → « Sur l'écran d'accueil » (« Elixir Admin ») → 📲 Notifications → « Recevoir les notifications sur cet appareil » → « M'envoyer un test ».
