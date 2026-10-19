# Assistant Elixir : mise en service

Pour Zineb Moulatif. Branche `assistant-elixir`, état du 19/10/2026. Détails techniques : `docs/assistant-contrat.md` (fait foi) et `docs/assistant-conception.md`.

**Rien ne part en production sans votre accord** : la fusion de la branche vers `master` met le site en ligne. Après la fusion, l'assistant reste **éteint** (`actif: false`) tant que vous ne l'allumez pas dans l'admin.

---

## 1. Ce qui a été construit

**Pour les pharmacies**, un panneau « Assistant Elixir » dans l'espace de commande. On l'ouvre par :
- la bulle de l'en-tête, placée avant « Mes commandes » ;
- le groupe « AIDE » de la barre latérale, qui affiche aussi le téléphone et les horaires ;
- le bouton « Une question sur cette commande ? » de chaque carte de « Mes commandes » ;
- le lanceur flottant « Une question ? Assistant Elixir » au coin bas droit, au-dessus du panier flottant (ajouté le 19/10/2026) : pastille en haut de page sur ordinateur, bulle ronde dès que la page défile et sur téléphone ; il s'efface là où il recouvrirait un bouton (quantités, « Envoyer »…), la bulle de l'en-tête restant toujours visible.

Pour que la pharmacie comprenne de quoi il s'agit (demande du 19/10/2026), une **fenêtre de présentation** « Nouveau : votre Assistant Elixir » s'affiche d'elle-même quelques secondes après l'arrivée sur le catalogue, après la fenêtre « Offres du moment » s'il y en a une : ce que fait l'assistant, 4 exemples, « Essayer maintenant », « Plus tard », « Ne plus afficher ». Elle revient au plus 2 fois après « Plus tard » (à des sessions suivantes, 20 h au moins entre deux affichages), plus jamais une fois l'assistant ouvert ou « Ne plus afficher » choisi, jamais en saisie Elixir pour une pharmacie ni à l'arrivée par le lien d'un menu promo.

Ce que fait l'assistant, à partir d'Odoo, pour la pharmacie connectée et elle seule :

| Besoin | Réponse |
|---|---|
| Duplicata | Le **PDF d'origine d'Odoo, tel quel** (sans tampon), téléchargé dans l'application. Recherche par numéro ou par date. |
| Relevé de facturation | Factures et avoirs d'une période de 12 mois au plus : totaux HT, TVA par taux et TTC, en PDF et en Excel. **Aucun solde ni état de paiement.** |
| Commande passée | Commandes du site, du logiciel de l'officine ou saisies par Elixir : étapes, quantités servies et non servies, lots et péremptions, factures liées. |
| Retour ou réclamation | L'assistant **prépare** un récapitulatif. Rien ne part tant que la pharmacie n'a pas cliqué sur « Confirmer la demande ». Aucun refus automatique au-delà de 10 jours : la pharmacie est informée et le Pharmacien Responsable décide. |
| Parler à un conseiller | Transmission à l'équipe avec un résumé et un numéro T-… Une alerte qualité est transmise tout de suite, en « URGENT ». |

Garde-fous :
- **Identité** : l'identité vient du jeton de connexion par code. Le modèle ne peut ni choisir une pharmacie ni écrire à une adresse.
- **Montants et fichiers** : ils sont lus par le serveur, jamais rédigés par l'IA.
- **Contrôles d'usage** : quotas par pharmacie, budget par jour, plafond par pharmacie et par jour.
- **Aperçus Netlify** : les réponses y sont fictives.

**Pour Elixir**, l'onglet admin « 💬 Assistant » réunit :
- les demandes (retours et transmissions), avec leur statut à tenir à jour ;
- les conversations, en lecture ;
- les coûts jour par jour ;
- les **réglages** : interrupteur, pilote, acheminement des demandes, adresses, textes affichés, quotas.

**Moteur** : `claude-opus-5-5`, effort bas, repli serveur en cas de refus.

---

## 2. Ce que vous devez faire, dans l'ordre

### Étape 1 : créer les tables (Supabase)

1. Ouvrez le projet Supabase **du site de commande**, celui dont l'adresse est la variable `SUPABASE_URL` du site Netlify, et non le projet de l'outil entrepôt.
2. Ouvrez **SQL Editor**, puis **New query**.
3. Collez **tout** le fichier `elixir-commande/sql/chat-schema.sql`, puis cliquez sur **Run**. Le script peut être rejoué sans risque.
4. Vérifiez dans **Table Editor** :
   - 6 tables `chat_*` existent : `chat_reglages`, `chat_conversations`, `chat_tours`, `chat_demandes`, `chat_fichiers`, `chat_alertes` ;
   - chacune porte la mention « RLS enabled » ;
   - **aucune policy** n'existe. N'en ajoutez jamais : c'est ce qui rend ces tables illisibles avec la clé publique du site.

### Étape 2 : ajouter les variables Netlify

Où : Netlify, site **commandes-elixir**, **Site configuration**, puis **Environment variables**, puis **Add a variable**. Cochez « Contains secret values » ; la portée **Functions** suffit. **Ne jamais** préfixer ces noms par `VITE_`, sinon la valeur partirait dans le navigateur.

| Variable | Où la trouver | Remarque |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, même projet : **Project Settings**, puis **API Keys**, onglet « Legacy API keys », clé **`service_role`** (Reveal, puis copier) | Cette clé contourne le RLS sur **tout** le projet : elle ne doit vivre que dans Netlify. |
| `CHATBOT_ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) : **Settings**, puis **Workspaces**, créer l'espace de travail « Assistant Elixir ». Dans ses **Limits**, fixer un **plafond de dépense mensuel** d'environ 150 € (la Console compte en dollars : environ 165 $). Ensuite **API Keys**, puis **Create Key** dans cet espace de travail. | Si elle manque, l'assistant prend `ANTHROPIC_API_KEY` (la clé des commandes groupées), qui **n'a pas** ce plafond. |
| `CHATBOT_INTAKE_SECRET` | **Plus tard**, quand l'API de l'outil entrepôt existera (§ 4). Valeur aléatoire, par exemple `openssl rand -hex 32`. | La même valeur doit être posée dans le Netlify du site de commande **et** dans celui de l'outil entrepôt. |

Déjà en place, rien à faire : `SUPABASE_URL`, `SUPABASE_KEY`, `ODOO_*`, `RESEND_API_KEY`, `GP_MAIL_FROM`, `CRON_SECRET`. Les alertes de budget et de panne partent à `GP_ADMIN_MAIL` (à défaut, `pharmacien@elixirpharma.fr`).

Une fonction ne voit une nouvelle variable **qu'après un déploiement**. Ajoutez donc les variables avant la fusion, ou relancez un déploiement ensuite.

### Étape 3 : essayer sur l'aperçu (réponses fictives)

L'aperçu existe dès que la branche est poussée sur GitHub. Son adresse est l'une des deux suivantes :
- déploiement de branche : `https://assistant-elixir--commandes-elixir.netlify.app` ;
- demande de fusion : `https://deploy-preview-<n>--commandes-elixir.netlify.app`.

Sur ces adresses, le mode « essai à blanc » est actif :
- rien ne part, aucun appel à l'IA n'est fait, et le bandeau « Aperçu : aucune commande ne part » s'affiche ;
- l'étape 3 n'a besoin ni des tables ni des variables.

Pour vous connecter, saisissez n'importe quelle adresse e-mail et n'importe quel code à 6 chiffres, sauf `000000`. Vous êtes alors « PHARMACIE D'ESSAI ». Ensuite :

1. Attendez la fenêtre « Nouveau : votre Assistant Elixir » (quelques secondes de calme après le catalogue, après « Offres du moment »), cliquez sur « Plus tard » : le lanceur du coin bas droit s'anime trois fois. Faites défiler la liste : la pastille devient une bulle, qui s'efface quand elle recouvrirait les boutons de quantité. Ouvrez l'assistant par ce lanceur, par la bulle de l'en-tête, puis par le groupe « AIDE ». Pour revoir la fenêtre, effacez les données du site (ou la clé `assistant_presentation_…`).
2. Essayez les pastilles d'accueil.
3. Écrivez « **toutes les cartes** » : toutes les cartes s'affichent (document, choix, relevé, commande, retour à confirmer, transmission, erreur).
4. Cliquez sur « Confirmer la demande » et sur « Annuler ».
5. Vérifiez que le panier et l'assistant ne s'ouvrent jamais ensemble.
6. Sur téléphone (ou en fenêtre de 375 px), vérifiez la feuille plein écran, le bouton Retour et le clavier.

Sur l'aperçu, ceci ne fonctionne pas, et c'est normal :
- les téléchargements de PDF ou d'Excel (message « lien expiré ») ;
- l'entrée « Mes commandes » (la pharmacie d'essai n'a pas de CIP) ;
- l'admin ;
- les vraies réponses.

### Étape 4 : fusionner, puis essayer vous-même en production

Les changements du **lot 0** (§ 5) sont **déjà en ligne** : ils sont partis avec les correctifs de sécurité du 19/10/2026 (`master`), fusionnés dans cette branche le 19/10/2026. La fusion de l'assistant n'ajoute donc, côté pharmacies, que la bulle et ses entrées, invisibles tant que l'assistant reste éteint.

1. Ouvrez l'admin, onglet « 💬 Assistant », sous-onglet **Réglages**. Si les réglages ne se lisent pas, l'étape 1 ou l'étape 2 est incomplète.
2. Cochez **Assistant actif**. Laissez **Ouvert à toutes les pharmacies** décoché, la **liste du pilote vide** et l'acheminement sur **« Simulation (pilote) »**. Cliquez sur **Enregistrer les réglages**.
   - À ce stade, seule l'équipe Elixir peut utiliser l'assistant, en mode « Commander pour une pharmacie ».
   - Comptez **1 minute** (cache du serveur), puis **rechargez la page**.
3. Cliquez sur « Commander pour une pharmacie » (crayon), choisissez par exemple la fiche **595**, puis ouvrez la bulle :
   1. **Relevé.** Demandez « le relevé de septembre 2026 ». Vous devez obtenir 41 factures, 5 avoirs, **HT 89 041,89 €, TVA 2 488,65 €, TTC 91 530,54 €**. Téléchargez le PDF et l'Excel.
   2. **Duplicata.** Demandez « le duplicata de la dernière facture », puis cliquez sur « Télécharger le PDF ». C'est la première lecture des PDF avec la clé Odoo de Netlify : **prévenez-nous si elle échoue**.
   3. **Commande.** Demandez « Où en est ma dernière commande ? ».
   4. **Retour.** Demandez un retour d'une boîte, puis cliquez sur « Confirmer la demande » en **décochant** « Prévenir la pharmacie par e-mail ». Vous devez recevoir un e-mail « **[SIMULATION]** Demande de retour R-… » sur `pharmacien@elixirpharma.fr`, et la demande doit apparaître dans **Demandes**. Passez-la ensuite en « traitée » ou en « rejetée ».
   5. **Conseiller.** Écrivez « Je veux parler à un conseiller » : un n° T-… s'affiche et un e-mail [SIMULATION] arrive.
   6. **Coûts.** Ouvrez l'onglet **Coûts** : quelques centimes.

### Étape 5 : pilote de 5 à 10 pharmacies, en simulation, pendant 2 semaines

1. Dans **Réglages**, puis **Pharmacies du pilote**, cherchez chaque pharmacie (nom, ville, CIP ou e-mail), cliquez sur **Ajouter**, puis enregistrez.
2. Vérifiez les prérequis de chaque pharmacie. Les badges de la recherche aident :
   - **compte sur le site** relié à sa fiche Odoo (sinon badge « sans compte ») ;
   - **CIP** sur la fiche (sinon badge « sans CIP »).
   Sans CIP, ou si l'adresse de connexion n'est plus sur la fiche Odoo, l'assistant ne propose que « parler à un conseiller », sans dire pourquoi.
3. Prévenez les pharmacies :
   - elles doivent être **connectées par code reçu par e-mail** ;
   - elles doivent **recharger la page** pour voir la bulle.
4. Pendant le pilote, en mode « Simulation » :
   - la pharmacie lit « Phase pilote : votre demande est transmise à l'équipe Elixir par e-mail » ;
   - elle **ne reçoit pas** de récapitulatif par e-mail ;
   - **traitez les e-mails [SIMULATION] comme de vraies demandes**, puis mettez leur statut à jour dans **Demandes**.
5. Relisez les **Conversations** et faites le bilan :
   - taux de transmission à un conseiller ;
   - coût réel ;
   - réponses à corriger ;
   - avis des pharmacies.

Facultatif : une évaluation réelle sur 51 scénarios, `node scripts/eval-chat.mjs --payant`, coûte quelques dollars. Elle n'a pas été lancée et attend votre accord.

### Étape 6 : ouvrir à toutes les pharmacies

1. Réglez d'abord l'acheminement sur **« E-mail à l'équipe »** (§ 3) : chaque pharmacie recevra alors son récapitulatif par e-mail.
2. Cochez **Ouvert à toutes les pharmacies**, puis enregistrez.
   - Les pharmacies connectées par code voient la bulle après avoir rechargé la page.
   - Celles qui ont une session ancienne, sans code, voient la bulle avec l'encart « Me reconnecter ».

**Arrêt d'urgence** : décochez **Assistant actif** (effet en 1 minute environ). Vous pouvez aussi révoquer la clé dans la Console Anthropic.

---

## 3. Acheminement des demandes (Réglages, puis Demandes)

| Mode | Équipe | Pharmacie | Outil entrepôt |
|---|---|---|---|
| **Simulation (pilote)** | E-mail « [SIMULATION] … » | Aucun e-mail (carte « Phase pilote ») | Rien |
| **E-mail à l'équipe** | E-mail | Récapitulatif aux adresses du compte encore présentes sur la fiche Odoo | Rien |
| **Outil entrepôt** | E-mail **seulement si l'API échoue** (la demande passe alors en « échec » dans l'admin) | Récapitulatif | Envoi signé (§ 4) |

Destinataires :
- les alertes qualité vont à « E-mail qualité (Pharmacien Responsable) », avec l'objet « URGENT – Qualité » ;
- tout le reste va à « E-mail de l'équipe » (aujourd'hui `pharmacien@elixirpharma.fr` dans les deux cas).

Une précision ajoutée plus tard à une transmission part **par e-mail** (« Complément à T-… »), dans tous les modes.

---

## 4. Passer à l'outil entrepôt : API `chatbot-intake` à créer dans elixirentrepot

Le site de commande est prêt : le client est codé et testé. Il reste à créer dans l'outil entrepôt une fonction qui reçoit les demandes, par exemple `https://<outil entrepôt>/.netlify/functions/chatbot-intake`. Ensuite :

1. Posez `CHATBOT_INTAKE_SECRET` dans **les deux** sites Netlify, avec la même valeur, puis redéployez.
2. Dans **Réglages**, renseignez « Adresse de l'API de l'outil entrepôt » (`https://…`), puis choisissez **Outil entrepôt**.
3. Faites une demande d'essai en mode « Commander pour une pharmacie » et vérifiez sa « Référence cible » dans **Demandes**.

**Requête envoyée par le site** : `POST`, corps JSON. En-têtes :

| En-tête | Valeur |
|---|---|
| `Content-Type` | `application/json` |
| `X-Elixir-Horodatage` | heure d'envoi en secondes Unix, par exemple `1760870000` |
| `X-Elixir-Signature` | `sha256=` suivi de HMAC-SHA256 en hexadécimal, avec la clé `CHATBOT_INTAKE_SECRET`, calculé sur le message `<horodatage>.<corps brut>` |
| `Idempotency-Key` | identifiant de la demande (uuid), le même que `demande_id` |

Contrôles à faire côté outil entrepôt :

```js
// corps : texte brut reçu (avant JSON.parse)
const h = event.headers["x-elixir-horodatage"], sig = event.headers["x-elixir-signature"] || "";
const attendu = "sha256=" + crypto.createHmac("sha256", process.env.CHATBOT_INTAKE_SECRET).update(`${h}.${corps}`).digest("hex");
const ok = sig.length === attendu.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu))
  && Math.abs(Date.now() / 1000 - Number(h)) <= 300;            // sinon : 401
// même Idempotency-Key déjà reçue : renvoyer la même référence, sans rien créer (le site peut renvoyer après une coupure)
```

**Corps :**

```json
{ "source": "chatbot", "type": "retour",            // ou "transmission"
  "demande_id": "uuid", "numero": "R-2026-0412",     // T-AAAA-NNNN pour une transmission
  "partner_id": 595, "cip": "…", "pharmacie": "nom de la fiche",
  "saisie_elixir": null,                              // e-mail de l'admin en « Commander pour une pharmacie »
  "conversation_id": "uuid", "cree_le": "2026-10-19T12:05:00.000Z",
  "retour": { "reference_document": "…", "document": { "numero": "…", "date_sortie": "AAAA-MM-JJ", "picking_id": 1, "picking_ids": [], "facture_ids": [] },
              "lignes": [{ "produit": "…", "cip": "…", "product_id": 1, "lot": "…", "lot_id": 1, "peremption": "AAAA-MM-JJ", "quantite": 2, "quantite_max": 3 }],
              "motif": "retour_erreur_pharmacie", "souhait": "avoir", "commentaire": null, "hors_delai": false, "limite_retour": "AAAA-MM-JJ" } }
```

Valeurs possibles :
- **Transmission** : la clé `retour` est remplacée par `"transmission": { "categorie", "urgence": "normale|urgente", "rappel": "email|telephone|indifferent", "reference", "resume" }`.
- **`motif` et `souhait`** : codes de l'application de réclamation (`entrepot/bundle.js`).
- **`categorie`** : catégories de `elixir_tickets`, plus `reglement`.

Destination conseillée dans l'outil entrepôt :
- retour : `elixir_reclamations` (statut `nouveau`, source `chatbot`) ;
- transmission : `elixir_tickets` (canal `chatbot`).

**Réponse attendue** :
- en **moins de 4 secondes**, `2xx` avec `{ "reference": "…" }` (sont aussi acceptés `numero_qualite` et `ticket`). Cette référence est affichée dans l'admin ;
- tout autre code, ou un délai dépassé, vaut échec : e-mail à l'équipe et statut « échec ».

---

## 5. Changements déjà en ligne (lot 0, correctifs de sécurité du 19/10/2026)

Ces corrections ferment des accès sans connexion aux données d'autres pharmacies. Elles sont en ligne depuis les correctifs de sécurité du 19/10/2026 (`master`) ; la branche de l'assistant les reprend telles quelles (fusion du 19/10/2026) :

| Où | Avant | Maintenant |
|---|---|---|
| **Mes commandes** | Fonctionnait sans connexion par code | Exige la connexion par code. Une session ancienne (avant le 07/07/2026, jamais reconnectée) voit « Reconnectez-vous » et le bouton **Se reconnecter**. Le panier est gardé ; une seule reconnexion suffit. |
| **Alertes de retour en stock** (saisie de commande) | Sans connexion | Même règle. Message « Reconnectez-vous pour gérer vos alertes ». L'alerte n'apparaît cochée que si elle a été enregistrée. |
| **Barre de progression des campagnes** (U-Labs…) | Sans connexion, commandes de toutes les pharmacies lues | Exige la connexion par code. Les commandes validées comptées sont celles de la pharmacie ; les autres pharmacies comptent par le groupement (`group-order`, identité masquée). |
| **Écran de connexion** | Si le mode de connexion était illisible, retour à l'ancien mode sans code | Connexion **par code** dans tous les cas. La recherche d'une pharmacie par e-mail (ancien mode) est limitée à 5 essais par minute et ne renvoie plus ni rue ni téléphone. |

Si une pharmacie appelle parce que « Mes commandes » lui demande de se reconnecter, c'est normal. Le bouton « Me reconnecter » de l'assistant mène à la même reconnexion par code que le reste du site (panier gardé).

---

## 6. Coûts

Les estimations ci-dessous viennent de la conception (§ 4), avec 1 $ = 0,90 €.

| Usage | Coût |
|---|---|
| Une conversation | 0,02 à 0,10 €, environ **0,055 €** en moyenne |
| Pilote de 10 pharmacies sur 2 semaines | moins de 5 € |
| 180 pharmacies, 1 conversation par semaine | environ **50 € par mois**, plus environ 7 € de cache |
| 180 pharmacies, usage fort (3 par semaine) | environ 135 € par mois |

Le reste (Netlify, Resend, Supabase) est négligeable.

Garde-fous, réglables dans l'admin :
- budget de **8 € par jour**, avec alerte à 80 % et à 100 % ;
- plafond de **1,50 € par pharmacie et par jour** ;
- 15 messages par heure et 40 par 24 h par pharmacie ;
- en dernier recours, le **plafond mensuel de la Console Anthropic**.

Le suivi se fait dans l'onglet **Coûts**.

---

## 7. Décisions encore ouvertes (les défauts sont dans les réglages)

1. **Délai annoncé.** Défaut : « Réponse sous 24 h ouvrées (du lundi au vendredi). » Faut-il aligner la fin du formulaire de réclamation de l'outil entrepôt, qui annonce « dans l'heure » ?
2. **Contact qualité (Pharmacien Responsable).** Quelle adresse et quel téléphone pour les alertes « URGENT » ? Aujourd'hui, c'est `pharmacien@elixirpharma.fr`, comme pour l'équipe.
3. **Pharmacies du pilote.** Lesquelles (5 à 10) ?
4. **Avoirs sans PDF.** Environ 46 % des avoirs depuis juillet n'ont jamais été envoyés, donc n'ont pas de PDF dans Odoo. Faut-il les envoyer automatiquement comme les factures ? En attendant, l'assistant propose de transmettre la demande.
5. **Retours.** Le délai de 10 jours compte à partir du lendemain de la sortie d'entrepôt : à confirmer. La phrase « attendez l'accord d'Elixir avant tout renvoi » est à valider.
6. **Questions de règlement.** Elles partent à l'e-mail de l'équipe avec « [Règlement] » : faut-il une autre personne ?
7. **RGPD.** Il faut citer Anthropic comme sous-traitant dans les mentions et les CGU de l'espace (le panneau le dit déjà dans « Vos données »). Vérifiez aussi l'accord de traitement des données du compte Anthropic.
8. **Petites limites de la v1.**
   - Le duplicata se télécharge seulement : l'envoi par e-mail n'est pas proposé.
   - Le PDF du relevé est en Helvetica, pas en Inter.
   - Une adresse e-mail partagée par plusieurs officines ne voit qu'une officine.
   - Le statut des demandes n'est pas encore relu depuis l'outil entrepôt.

---

## Annexe : contrôles du 19/10/2026 (aucun appel à l'IA, aucune écriture)

**Tests automatiques : tous passent.** Ils se lancent avec `node scripts/test-*.mjs`.

| Script | Résultat |
|---|---|
| `test-chat-api` | 101 OK, 0 échec |
| `test-chat-demandes` | 65 OK, 0 échec |
| `test-chat-integration` | 39 OK, 0 échec |
| `test-chat-moteur` | 80 OK, 0 échec |
| `test-chat-outils` | 103 OK, 0 échec |
| `test-chat-perimetre` | 82 OK, 0 échec |
| `test-lot0` | 61 OK, 0 échec |
| `test-securite-2` | 188 OK, 0 échec |
| `test-quota` | 17 OK, 0 échec |
| `test-gp-pricing` | 71 OK, 0 échec |
| `test-labo` | 27 OK, 0 échec |
| `scripts/banc/test-assistant-interface.mjs` | 128 OK, 0 échec |

**Construction, vérifications et poids du code :**
- `npm run build` : réussite ;
- `npm run lint` : aucune erreur, de même pour les fonctions `chat*` et le lot 0 ;
- `npm run zones` (contre `master` local, et `npm run zones -- --ref origin/master`) : « aucun écart » ; bundle des pharmacies à 888 833 octets pour un budget de 940 000.

**Lecture réelle d'Odoo, en lecture seule** (`node scripts/chat-essai-odoo.mjs`, fiches 595 et 5007) : 28 contrôles réussis, 0 échec, 163 appels Odoo conformes (société 2 et filtre de la fiche à chaque appel). Le relevé de la fiche 595 pour 09/2026 est exact : HT 89 041,89 €, TVA 2 488,65 €, TTC 91 530,54 €.
