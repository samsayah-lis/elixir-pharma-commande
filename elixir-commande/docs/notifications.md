# Appli Elixir installable et notifications sur le téléphone

Pour Zineb Moulatif. Branche `appli-notifications` (partie de `master` 0177110), état du 20/10/2026, après la revue (sécurité, fiabilité, ergonomie).

Votre demande : « Est ce que c'ets compliqué de faire de tout ça une vraie app qui enverrai des notifications », puis « On peut faire le 1, Donc tu m'assures que avec cette possibilité, le pharmacien reçoit des notifications sur son tel ».

**Rien n'est en ligne tant que vous ne fusionnez pas la branche.** Après la mise en ligne, l'ouverture est **« Fermée »** : seuls les appareils de l'équipe Elixir reçoivent quelque chose. Les pharmacies ne voient rien tant que vous n'ouvrez pas (pilote, puis toutes).

---

## 1. Ce que ça fait

**Pour les pharmacies**
- Le site de commande devient une **application installable** : icône Elixir sur l'écran d'accueil, ouverture en plein écran, nom « Elixir ». Le site reste le même : aucune version à télécharger, aucune mise à jour à faire. L'application montre toujours la dernière version du site.
- Une carte **« Recevez nos alertes sur votre téléphone »** en bas de l'accueil, sous les accès rapides. Elle propose, selon l'appareil :
  - Android : **Activer les notifications**. La demande d'autorisation du téléphone n'apparaît qu'après ce clic.
  - Ordinateur : **Sur mon téléphone** (un code QR à viser avec l'appareil photo du téléphone), ou **Activer sur cet ordinateur**.
  - iPhone dans Safari : **Voir comment faire**, un guide en 5 étapes pour ajouter l'application à l'écran d'accueil.
  - Page ouverte depuis Gmail, Google ou Facebook sur iPhone : **Copier le lien**, pour l'ouvrir dans Safari.
  - « Plus tard » cache la carte 30 jours et indique où retrouver l'activation.
  - La carte ne s'affiche plus quand elle ne sert à rien : sur l'ordinateur d'une pharmacie dont un téléphone reçoit déjà, ou dans Safari quand l'application Elixir est déjà installée sur un iPhone de la pharmacie.
- Un menu **« MON COMPTE → Notifications »** dans la barre latérale (menu ☰ sur téléphone), et une cloche dans l'en-tête sur grand écran. Le panneau permet de :
  - choisir les alertes : **Retour en stock** (bientôt), **Mes commandes** (bientôt), **Offres et nouveautés** (2 par semaine au plus) ;
  - **envoyer une notification de test** à son téléphone ;
  - voir ses appareils, en retirer un (avec confirmation) ;
  - désactiver ;
  - lire « Vos données » : ce qui est enregistré, pourquoi, combien de temps, à qui écrire.
- Le lien **`https://elixir-commande.expepharma.com/?notifications=1`** ouvre directement ce panneau, après connexion. Vous pouvez le mettre dans un mailing ou un SMS.
- À la déconnexion, l'appareil cesse de recevoir les notifications de la pharmacie : cela compte pour un poste partagé.

**Pour vous, dans l'admin, onglet « 🔔 Notifications »**
- **État du service** : des coches, et pour chaque point manquant, ce qu'il faut faire. Aucune clé n'est jamais affichée. Si un navigateur propose un service de notification inconnu, il est signalé ici.
- **Ouverture aux pharmacies** : « Fermée (équipe Elixir) », « Pilote » (les pharmacies que vous choisissez), « Toutes les pharmacies ». On y règle aussi le plafond des offres : 2 par pharmacie sur 7 jours glissants, réglable de 0 à 7.
- **Vos appareils** : pour recevoir vous-même les tests et les aperçus des annonces. Ils ne reçoivent jamais les notifications des pharmacies.
- **Pharmacies joignables** : combien de pharmacies, d'appareils, par alerte et par type d'appareil (iPhone, Android, ordinateur), et la liste. Un bouton **Retirer** enlève les appareils d'une pharmacie (demande d'effacement, téléphone perdu) ; elle pourra les réactiver.
- **Nouvelle annonce « Offres et nouveautés »** :
  - un titre de 60 caractères et un texte de 160 ;
  - un lien vers l'accueil, un menu promo, un menu, un outil ou un produit (les menus masqués aux pharmacies ne sont pas proposés) ;
  - les destinataires : toutes les pharmacies abonnées aux offres, ou celles que vous choisissez ;
  - l'**aperçu Android et iPhone** à l'écran, et **« M'envoyer l'aperçu »** sur votre téléphone ;
  - le brouillon est gardé si vous rechargez la page ou touchez l'aperçu.
- **Historique** des annonces : lien en clair, pharmacies visées, écartées par le plafond et servies ; appareils joints, en échec et retirés.

**En mode « 🛠 Commander pour une pharmacie »**
- Le panneau « Notifications » montre seulement les appareils de la pharmacie servie et le lien à lui envoyer.
- Votre appareil n'est **jamais** abonné au nom de la pharmacie.

---

## 2. Le pharmacien reçoit-il les notifications sur son téléphone ?

**Oui : sur son téléphone, écran verrouillé et site fermé, à ces conditions.**

**Ce qui part dès la mise en service** : vos annonces « Offres et nouveautés » et les notifications de test. **« Retour en stock »** partira quand le crochet du § 9.1 sera branché (après la fusion des alertes retour) ; **« Mes commandes »** plus tard (§ 9.2). Les deux sont affichés « (bientôt) » dans le panneau.

| Appareil | Ce qu'il faut faire | À savoir |
|---|---|---|
| **Android** (Chrome, Edge, Samsung Internet, Firefox) | Ouvrir le site, se connecter, toucher « Activer les notifications », puis « Autoriser ». | L'installation n'est pas nécessaire. Elle est un plus : « ⋮ → Installer l'application » donne l'icône Elixir et le plein écran. Ne fonctionne pas sur les Huawei récents sans services Google, ni dans le navigateur Brave (notifications coupées par défaut). |
| **iPhone / iPad** | Il faut **iOS 16.4 ou plus récent**, et l'application **ajoutée à l'écran d'accueil** (Partager → « Sur l'écran d'accueil »), puis ouverte depuis l'icône. Il faut **se reconnecter une fois par code** : l'application a sa propre session, séparée de Safari. Ensuite : « Activer les notifications », puis « Autoriser ». | **Impossible dans Safari sans installation** : c'est une règle d'Apple, la même pour tous les sites. Impossible aussi sur l'iPhone 7 et plus anciens, bloqués en iOS 15. Possible à partir de l'iPhone 8. Une icône Elixir posée avant cette version ouvre Safari : il faut la supprimer et l'ajouter de nouveau. |
| **Ordinateur** (Chrome, Edge, Firefox, Safari sur Mac) | « Activer sur cet ordinateur ». | Utile au comptoir. **Le navigateur doit rester ouvert** (la fenêtre du site peut être fermée) : après avoir quitté Chrome, rien n'arrive jusqu'à sa réouverture. |

Même tout activé, plusieurs choses peuvent retarder ou cacher une notification :
- le mode **Ne pas déranger** ou **Concentration** ;
- le **Résumé programmé** (iPhone) ;
- les notifications **du navigateur** coupées dans les réglages du système : Android (Réglages → Applications → Chrome → Notifications), Mac (Réglages Système → Notifications → Chrome), Windows (Paramètres → Système → Notifications). C'est la cause la plus fréquente : l'autorisation du site est accordée, mais rien ne s'affiche ;
- une économie de batterie agressive (certains Android) ;
- l'application supprimée de l'écran d'accueil.

**L'activation se fait appareil par appareil** : le téléphone du titulaire, celui de l'adjoint, l'ordinateur du comptoir. Chacun active les siens.

**L'e-mail reste la voie des informations importantes** : confirmations, factures, retours en stock. La notification s'ajoute à l'e-mail. Elle n'est jamais la seule trace.

On ne peut donc pas promettre « tous les pharmaciens ». On peut promettre que **chaque pharmacien qui l'active** reçoit vos annonces, puis ses retours en stock une fois le § 9.1 branché :
- sur Android : deux touches ;
- sur iPhone : une installation de 30 secondes, puis deux touches.

L'onglet admin montre combien de pharmacies sont joignables, et sur quels appareils.

---

## 3. Mise en service (dans l'ordre)

Rien n'est en ligne avant l'étape d. Rien n'est visible des pharmacies avant l'étape g.

**a. Créer les deux clés VAPID — vous-même, sur votre Mac.** Elles signent les notifications. Ouvrez Terminal et tapez :

```
npx --yes web-push@3.6.7 generate-vapid-keys
```

Deux clés s'affichent : « Public Key » et « Private Key ».
- **Gardez une copie des deux clés dans votre gestionnaire de mots de passe** (Trousseau iCloud, 1Password…). Netlify ne permet plus de relire la clé privée une fois enregistrée : sans copie, une erreur de collage obligerait à tout réactiver.
- **Ne les mettez jamais ailleurs** : ni e-mail, ni conversation (Claude compris), ni le dépôt de code.
- Fermez ensuite la fenêtre du Terminal.

**b. Les coller dans Netlify.** Netlify → site *commandes-elixir* → Site configuration → Environment variables → Add a variable. Trois variables :

| Nom | Valeur |
|---|---|
| `VAPID_PUBLIC_KEY` | la « Public Key » |
| `VAPID_PRIVATE_KEY` | la « Private Key » ; cochez « Contains secret values » |
| `VAPID_SUBJECT` | `mailto:pharmacien@elixirpharma.fr` |

Déjà en place pour l'Assistant Elixir, rien à faire : `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.

**Ne changez jamais ces clés ensuite** : tous les appareils devraient réactiver leurs notifications. Une partie se renouvelle seule à la prochaine ouverture du site, mais pas toutes (sur iPhone en particulier).

**c. Créer les tables.** Supabase → SQL Editor → collez le contenu de `elixir-commande/sql/push-schema.sql` → Run. Vous pouvez le relancer sans risque (vérifié : deux passages de suite sur un Postgres 17).
- Le script crée 5 tables : abonnements, réglages, annonces, envois, services push refusés.
- Elles sont fermées : RLS activé et aucune policy, comme celles de l'assistant. Le navigateur ne peut ni les lire ni les modifier.
- Un index empêche deux annonces de partir en même temps (le plafond des offres reste juste).

**d. Mise en ligne** (vous la lancez) :

```
cd ~/Downloads/elixir-pharma-repo
git fetch origin && git checkout master && git pull
git merge appli-notifications
git push origin master
```

Voir aussi « Fusion avec master » en fin de document : 5 petits conflits à résoudre en gardant les deux versions.

Les variables de l'étape b ne sont lues par les fonctions qu'après un déploiement. Si vous les ajoutez après la mise en ligne, relancez un déploiement : Netlify → Deploys → Trigger deploy.

**e. Vérifier.** Ouvrez l'admin → 🔔 Notifications → « État du service » : toutes les coches doivent être vertes. L'ouverture est « Fermée » : les pharmacies ne voient encore rien.

**f. Tester sur votre téléphone d'abord.**

*Sur iPhone :*
1. Ouvrez Safari à l'adresse `https://elixir-commande.expepharma.com/#admin`.
2. Touchez Partager → « Sur l'écran d'accueil ». Le nom proposé est « Elixir Admin ». Touchez Ajouter.
3. Ouvrez l'icône « Elixir Admin » et connectez-vous à l'admin.
4. Allez dans 🔔 Notifications → « Recevoir les notifications sur cet appareil », puis « Autoriser ».
5. Touchez « M'envoyer un test » et verrouillez l'écran : la notification doit arriver.
6. Composez une annonce et touchez « M'envoyer l'aperçu ». Toucher l'aperçu ouvre son lien dans une nouvelle fenêtre : votre brouillon reste en place.
7. Profitez-en pour relire le guide iPhone du panneau (côté pharmacie) : sur iOS 26, le libellé exact de l'interrupteur « Ouvrir en tant qu'app web » est à confirmer.

*Sur Android :* ouvrez Chrome à la même adresse `…/#admin`, puis suivez les mêmes boutons. L'installation est facultative (⋮ → Installer l'application).

*Si l'icône « Elixir Admin » de l'iPhone ouvre l'accueil des pharmacies au lieu de l'admin* : faites l'essai sur Android ou sur votre ordinateur. Vous pouvez aussi faire le pilote avec une pharmacie amie. Ce cas n'a pas pu être vérifié avant votre essai.

**g. Pilote.** De préférence **après le branchement du retour en stock (§ 9.1)** : sinon, les pharmacies du pilote ne recevront que vos annonces.
1. Mettez l'ouverture sur « Pilote » et ajoutez une ou deux pharmacies volontaires (recherche par nom, ville ou CIP).
2. Elles voient la carte de l'accueil : deux touches sur Android, le guide sur iPhone, le code QR sur ordinateur.
3. Elles s'envoient un test.
4. Vous vérifiez « Pharmacies joignables ».

**h. Ouverture à toutes.** **Seulement après l'étape « Bloc 1 » du plan de fermeture de Supabase** : table `elixir_pharmacies` fermée à la clé publique et `auth.js` passé sur la clé serveur. Avant, un compte qui modifierait cette table pourrait se faire passer pour une autre pharmacie (défaut déjà présent sur le site, que les notifications ne doivent pas élargir). Ensuite, passez sur « Toutes les pharmacies » ; vous pouvez l'annoncer par mailing avec le lien `https://elixir-commande.expepharma.com/?notifications=1`.

---

## 4. Envoyer une annonce « Offres et nouveautés »

- **Titre** : 60 caractères au plus. Au-delà de 40, il peut être coupé sur Android.
- **Texte** : 160 caractères au plus.
- **Lien** : une page du site seulement (accueil, menu promo, menu, outil, produit).
- **Contenu interdit** : jamais de donnée de patient, de montant de facture ni de solde. La notification s'affiche sur l'écran verrouillé, lisible par tous.
- **Plafond** : 2 annonces par pharmacie sur 7 jours glissants (réglable). Une pharmacie déjà à 2 est écartée de l'envoi, et l'estimation le dit avant l'envoi. Une annonce compte dès son départ, même si l'envoi est interrompu.
- **Aperçu** : touchez toujours « M'envoyer l'aperçu » d'abord.
- **Horaires** : évitez d'envoyer avant 8 h, après 20 h et le dimanche. L'admin demande une confirmation de plus dans ces cas.
- **Pas d'annulation** : un envoi ne s'annule pas. Un double clic n'envoie jamais deux fois.
- **Une à la fois** : une annonce ne part jamais pendant qu'une autre est en cours d'envoi.
- **Suivi** : l'envoi prend de quelques secondes à quelques minutes. Suivez-le dans l'historique. Si une annonce reste « En file » plus de 2 minutes, touchez « Relancer » (possible pendant 24 heures ; au-delà, recomposez-la).

---

## 5. Limites

- **Ce qui part aujourd'hui** : vos annonces et les tests. **Retour en stock** n'envoie rien tant que le § 9.1 n'est pas branché ; **Mes commandes** n'envoie rien avant le § 9.2.
- **iPhone** : iOS 16.4 ou plus récent, et seulement dans l'application de l'écran d'accueil. Il faut se reconnecter une fois dans l'application.
- **Ordinateur** : le navigateur doit rester ouvert.
- **Réception** : Ne pas déranger, Concentration, Résumé programmé, les réglages du système et l'économie de batterie retardent ou cachent les notifications.
- **Un appareil à la fois** : chaque téléphone ou ordinateur s'active séparément. 10 appareils au plus par pharmacie.
- **Appareils exclus** : Huawei récents sans services Google, navigateur Brave.
- **E-mail** : l'e-mail reste la voie des informations importantes.
- **Clés VAPID** : ne jamais les changer sans raison.

---

## 6. Dépannage

| Situation | Réponse |
|---|---|
| « Je n'ai rien reçu » | Panneau → « Envoyer une notification de test ». Vérifiez Ne pas déranger / Concentration, **et que le navigateur (ou l'application Elixir) a le droit d'afficher des notifications dans les réglages du téléphone ou de l'ordinateur** : Android → Réglages → Applications → Chrome → Notifications ; iPhone → Réglages → Notifications → Elixir ; Mac → Réglages Système → Notifications → Chrome ; Windows → Paramètres → Système → Notifications. Sur ordinateur, le navigateur doit être ouvert. |
| « Le bouton n'apparaît pas sur mon iPhone » | La page est ouverte dans Safari : il faut d'abord ajouter l'application à l'écran d'accueil (guide du panneau), puis l'ouvrir depuis l'icône. **Si une icône Elixir existe déjà et ouvre Safari (barre d'adresse visible), supprimez-la puis ajoutez-la de nouveau depuis Safari.** |
| « Bloquées » | L'autorisation a été refusée. Le panneau indique où la rétablir : iPhone → Réglages → Notifications → Elixir ; Android → icône à gauche de l'adresse (cadenas ou réglages) → Notifications ; ordinateur → même icône → Notifications. |
| « Cet appareil n'était plus joignable » | Le service de Google ou d'Apple ne connaît plus l'appareil (données effacées, appli réinstallée). Touchez « Activer les notifications » : un nouvel abonnement est pris, sans nouvelle demande. |
| « ⚠ ne répond plus » dans la liste | L'appareil n'a pas pu être joint plusieurs fois de suite (téléphone éteint longtemps, appli supprimée). Il est retiré automatiquement dès que le service de Google ou d'Apple le dit introuvable. |
| La carte et le menu n'apparaissent nulle part | Service incomplet (onglet admin → État du service), ouverture « Fermée », ou pharmacie hors pilote. |
| « Services push refusés » dans l'état du service | Un navigateur a proposé un service de notification hors de la liste admise : ses utilisateurs ne peuvent pas s'abonner. Transmettez le nom affiché à l'équipe technique, qui jugera s'il faut l'ajouter. |

---

## 7. En cas de problème

1. **Plus rien de nouveau côté pharmacies** : passez l'ouverture sur « Fermée ».
   - La carte et le menu disparaissent.
   - Plus aucune annonce ni notification automatique ne part.
   - Les abonnements restent : réouvrir suffit.
2. **Arrêt d'urgence du service worker** (cas grave, peu probable : il ne fait qu'afficher les notifications, il ne touche jamais aux pages).
   - **Faites d'abord le point 1 (ouverture « Fermée »)** : la carte et le menu disparaissent, et plus rien ne réenregistre le service worker. Sinon, chaque visite le réinstallerait et l'activation échouerait en boucle.
   - Remplacez ensuite le contenu de `elixir-commande/public/sw.js` par :
     ```js
     self.addEventListener("install", () => self.skipWaiting());
     self.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister()));
     // messages déjà en route pendant la transition : iOS exige d'en afficher un
     self.addEventListener("push", (e) => e.waitUntil(self.registration.showNotification("Elixir Pharma", { body: "Nouvelle information dans votre espace Elixir." })));
     ```
   - Puis mettez en ligne. Les appareils l'abandonnent à leur visite suivante.
   - Les abonnements deviennent invalides et sont nettoyés au premier envoi.
3. **Retour arrière complet** : Netlify → Deploys → republiez le déploiement précédent (« Publish deploy »).

---

## 8. Données

- **Stockage** : 5 tables fermées (RLS sans policy), lues seulement par les fonctions, avec la clé serveur.
- **Ce qui est enregistré pour un appareil** :
  - l'adresse technique de Google, d'Apple, de Mozilla ou de Microsoft ;
  - ses clés de chiffrement ;
  - le CIP et l'e-mail du compte, pris dans le jeton de connexion ;
  - les alertes choisies ;
  - un libellé (« iPhone · application ») : jamais l'user-agent complet ;
  - les dates d'activation, de dernière visite et de dernier envoi.
- **Sur l'appareil** : la date du « Plus tard » de la carte, sous une empreinte du compte (aucune adresse e-mail en clair, même sur un poste partagé) ; le brouillon d'annonce de l'admin, pour l'onglet seulement.
- **Contenu des notifications** : aucune donnée de patient.
- **Durée de conservation** (fonction `push-menage`, chaque nuit) :
  - les envois sont effacés après 90 jours ;
  - un appareil est supprimé à la désactivation, à la déconnexion, au retrait (par la pharmacie ou par vous), quand le service push le dit introuvable, **après 12 mois sans visite du site sur cet appareil**, et **dès que l'e-mail du compte n'est plus rattaché à la pharmacie** (pharmacie qui n'est plus cliente, e-mail corrigé, ancien salarié) ;
  - les services push refusés sont effacés après 90 jours.
- **Consentement** : il est donné par un clic (« Activer » puis « Autoriser » du téléphone). La carte indique que l'activation inclut les offres (2 par semaine au plus), désactivables à tout moment. Il se retire à tout moment : interrupteurs, « Désactiver », réglages du téléphone.
- **Information des pharmacies** : le panneau « Notifications » contient « Vos données » (ce qui est enregistré, pourquoi, combien de temps, contact `pharmacien@elixirpharma.fr`). Avant le pilote, ajoutez la même mention à la page « données personnelles » du site, par exemple :
  > Notifications de l'application Elixir : si vous les activez, Elixir Pharma enregistre pour chaque appareil l'adresse technique et les clés de chiffrement fournies par votre navigateur (Google, Apple, Mozilla ou Microsoft), l'e-mail de votre compte et le CIP de la pharmacie, le type d'appareil, les alertes choisies et les dates d'activation, de dernière visite et de dernier envoi, dans le seul but de vous envoyer ces notifications. Ces données sont supprimées quand vous désactivez les notifications, vous déconnectez ou retirez l'appareil, et automatiquement après 12 mois sans visite. Accès, effacement : pharmacien@elixirpharma.fr.
- **Demande d'effacement** : admin → « Pharmacies joignables » → **Retirer** sur la ligne de la pharmacie.

---

## 9. Suites (préparées, pas encore branchées)

### 9.1 Retour en stock

Les e-mails « De retour en stock » (alertes retour, désormais dans `master`) partent de `netlify/functions/_restock.js`, fonction `passage()`. Le branchement se fait juste après un e-mail réellement parti pour une pharmacie : dans le bloc `if (issue === "envoye" || issue === "deja") { … b.envoyes++; … }` (~l. 560), avant le `continue;`, et seulement pour `issue === "envoye"` (« deja » : e-mail déjà reçu, notification déjà partie) :

```js
import { notifierPharmacie } from "./_push.js";
// … e-mail parti pour g (pharmacie) ; produits = produits revenus ({ cip, nom })
if (issue === "envoye" && peut(3000, envois)) await notifierPharmacie(g.pharmacy_cip, "stock", {
  titre: produits.length > 1 ? `${produits.length} produits de retour en stock` : "De retour en stock",
  corps: produits.length > 1 ? "Les produits pour lesquels vous avez demandé une alerte sont de nouveau disponibles."
    : `${produits[0].nom} est de nouveau disponible chez Elixir.`,
  url: produits.length === 1 ? `/?cip=${produits[0].cip}` : "/?outil=saisie",
  tag: produits.length === 1 ? `stock-${produits[0].cip}` : undefined,
}, { delaiMs: 2500 });
```

Au même moment, retirez la mention « (bientôt) » de « Retour en stock » dans `src/notifications/regles.js` et le texte de la carte (« et bientôt vos retours en stock ») dans `Notifications.jsx`.

Ce que garantit `notifierPharmacie(cip, catégorie, contenu, options)` :
- **Elle ne lève jamais d'erreur** : l'e-mail n'échoue jamais à cause d'une notification. Elle rend `{ envoyes, echecs, retires, raison }`.
- Elle respecte l'ouverture (fermée, pilote) et l'alerte choisie par la pharmacie.
- Elle ne sert que les appareils dont le compte est toujours rattaché à ce CIP (les autres sont supprimés).
- Elle trace l'envoi dans `push_envois`.
- Le CIP est nettoyé (espaces) ; « 0 » ou « false » ne servent jamais personne.

Pour la fusion : `_restock.js` est une fonction admise de la branche alertes-retour (`AJOUTS_AUTORISES`). La modifier ne demande pas de nouvelle allocation.

### 9.2 « Mes commandes » : sortie d'entrepôt (plan)

**Préalable** : l'étape « Bloc 1 » du plan de fermeture de Supabase (voir § 3 h). Tant que `elixir_pharmacies` est modifiable avec la clé publique, une notification de commande pourrait arriver chez quelqu'un qui s'est rattaché à une autre pharmacie.

**Source.** La donnée existe déjà dans Odoo, et l'assistant la lit (`_chat-perimetre.js`) :
- les livraisons `stock.picking` de la société 2 sortantes (`picking_type_code = outgoing`), terminées (`state = done`), hors retours (`return_id` vide), avec leur `date_done` ;
- la pharmacie, par `partner_id` → fiche commerciale → CIP ;
- la commande `sale.order` : `name`, `delivery_status` (full / partial) et `x_studio_tourne` (tournée N ou Chronopost) ;
- le libellé déjà utilisé par l'assistant : « Sortie de l'entrepôt le … (tournée N) ». Jamais « livrée chez vous » : Elixir ne sait pas quand le livreur arrive.

**Fonction.** `push-commandes-cron.js`, planifiée toutes les 15 minutes de 7 h à 20 h (heure de Paris) :
- lecture d'Odoo seulement ;
- un curseur : la dernière `date_done` traitée, gardée dans `push_reglages` ou `kv_store` ;
- 200 livraisons au plus par passage ;
- pour chacune, `notifierPharmacie(cip, "commandes", { titre: "Commande sortie de l'entrepôt", corps: "Votre commande S0xxxx est partie (tournée 3).", url: "/?commandes=1", tag: "cmd-<id de la livraison>" }, { unique: true })`. L'option `unique` empêche tout doublon.

**Petit ajout côté site.** Un lien `/?commandes=1` qui ouvre « Mes commandes », à ajouter aux liens admis (`regles.js`), et la mention « (bientôt) » à retirer.

**À trancher par vous :**
- toutes les commandes (site, logiciel de l'officine via PharmaML, saisies Elixir), ce que je recommande, ou celles du site seulement ?
- notifier aussi « en préparation » ? Je le déconseille : trop de notifications.

**Allocations.** Nouvelle fonction dans `AJOUTS_AUTORISES`, nouveau cron dans `elixir-commande/netlify.toml`.

### 9.3 Autres pistes

- Les notifications « déclaratives » d'iOS 18.4, après un essai réel.
- Les annonces programmées.
- Le ciblage (département, habitudes d'achat).
- Des alertes pour l'équipe Elixir : relais PharmaML muet.
- Une pastille sur l'icône de l'application.

---

## 10. Pour l'équipe technique

**Fichiers**
- Serveur :
  - `netlify/functions/_push.js` : configuration VAPID, stockage, envoi, comptes revérifiés, ménage, `notifierPharmacie`, annonces ;
  - `push-abonnement.js` (pharmacies) ;
  - `push-admin.js` (admin) ;
  - `push-envoi-background.js` (annonces) ;
  - `push-menage.js` (planifié chaque nuit, `netlify.toml`) ;
  - `sql/push-schema.sql`.
- Site :
  - `src/notifications/` : `regles.js` partagé avec le serveur (catégories, liens, services push admis `HOTES_PUSH`), `plateforme.js`, `client.js`, `demarrage.js`, `memo.js`, `Notifications.jsx`, `entree.jsx` (seul fichier dans le bundle), `banc.js` (développement seulement) ;
  - `src/components/AdminNotifications.jsx`.
- Appli installable :
  - `public/manifest.webmanifest`, `public/admin.webmanifest`, `public/sw.js`, `public/icones/`, `public/apple-touch-icon.png` ;
  - les icônes sont générées depuis `scripts/icones/*.svg` par `node scripts/genere-icones.mjs` (Chrome sans interface + sips, sur le Mac).
- Dépendances épinglées à la version exacte : `web-push` 3.6.7 (serveur), `qrcode-generator` 2.0.4 (code QR, chunk chargé à la demande).

**Règles tenues**
- **Identité = jeton**, jamais le corps de la requête. CIP nettoyé et lisible (7 à 14 chiffres), sinon 403 « fiche ». Un jeton admin est refusé pour abonner un appareil au nom d'une pharmacie.
- **Comptes revérifiés** à chaque envoi (annonce, `notifierPharmacie`) et chaque nuit : l'e-mail du compte doit toujours être rattaché au CIP de l'abonnement.
- **Service worker** : aucun gestionnaire `fetch`, aucun cache, servi en `no-store`. Un test met la fenêtre au premier plan sans la recharger ; un aperçu ou une fenêtre sur `#admin` ouvre le lien dans une nouvelle fenêtre.
- **Anti-SSRF** : seules les adresses https de Google (FCM), Mozilla, Apple et Microsoft (WNS) sont admises, et aucune redirection n'est suivie. Un hôte refusé est noté (hôte seul).
- **Configuration** : une erreur de configuration VAPID ne supprime jamais d'abonnement ; elle est contrôlée comme web-push avant d'afficher « prêt ».
- **404/410** du service push : l'abonnement est supprimé côté serveur, et désinscrit côté navigateur au test suivant (la réactivation prend toujours une nouvelle adresse).
- **Une diffusion à la fois** (index unique) ; envois tracés avant l'envoi (plafond garanti).
- **Écritures groupées par tranches** de 100 identifiants (URL PostgREST bornée).
- **Aperçus Netlify** : réponses fictives côté page et côté fonction, rien n'est enregistré ni envoyé.
- **Clés ou tables absentes** : tout se cache côté pharmacies.

**Essais**
- Tests :
  - `node scripts/test-push-serveur.mjs` (250) : faux service push local, corps déchiffré, jeton VAPID vérifié, CIP « 0 » et « false », sujets refusés par web-push, comptes retirés, ménage, diffusions simultanées, redirection 307, 1 000 appareils et 500 CIP, empaquetage esbuild comme Netlify ;
  - `node scripts/test-push-sw.mjs` (29) ;
  - `node scripts/test-push-client.mjs` (92) : dont abonnement mort réactivé avec une nouvelle adresse, carte utile, écoute après activation.
- Banc local (`npm run dev`) :
  - notifications simulées, aucun vrai abonnement : `?banc_push=android`, `bureau`, `ios-safari`, `ios-app`, `ios-ancien`, `ios-gmail`, `refuse`, `abonne`, `brave` ;
  - `BANC_PUSH=reconnexion` fait répondre 401 au statut.

**Bundle des pharmacies.** 895 736 octets pour un budget de 940 000 (+3,0 Ko pour le lot). Le reste est chargé à la demande (panneau 32 Ko, code QR 21 Ko).

**Fusion avec master.** `origin/master` contient les alertes retour, arrivées après le départ de cette branche. La fusion donne 5 petits conflits. Dans chaque cas, **gardez les deux versions** :

| Fichier | Résolution |
|---|---|
| `scripts/verifie-zones.mjs` | Réunir les deux expressions `AJOUTS_AUTORISES` : `…|_accueil-[a-z-]+|restock-notify(-cron)?|_restock|_push(-[a-z-]+)?|push-(abonnement|admin|envoi-background|menage))\.js$` et les deux commentaires. Libellé du fichier modifié : accueil / restock / push. Résumé du dossier : « Assistant Elixir, page d'accueil, alertes retour, notifications ». |
| `netlify.toml` (elixir-commande) | Garder les deux fonctions planifiées : `restock-notify-cron` et `push-menage`. |
| `src/AdminPanel.jsx` | Garder les deux imports : `AdminAlertesRetour` et `AdminNotifications`. |
| `scripts/banc/plugin.mjs` | Garder les deux commentaires d'en-tête : notifications, et `BANC_PHOTOS=prive`. |
| `src/dev/reponses-fictives.js` | Garder les deux cas : `restock-notify`, et `push-abonnement` / `push-admin`. |

Puis relancer `npm run zones`, `npm run zones -- --ref origin/master`, le build et tous les `scripts/test-*.mjs`.
