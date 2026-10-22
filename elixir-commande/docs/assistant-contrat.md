# Assistant Elixir — contrat d'interfaces (v1)

Demande de Zineb Moulatif (16/10/2026), mot pour mot : « Je veux un chatbot service client. Par ex demander un duplicata de facture, un relevé de facturation, demander le retour d'un produit ou un renseignement sur une commande passée. Moteur IA, connexion à Odoo etc. »

Conception détaillée : `docs/assistant-conception.md` (copie de l'étude du 16/10/2026). **Ce fichier-ci fait foi** pour les noms, signatures et formes de données partagés entre le serveur et l'interface ; la conception fait foi pour le reste. En cas de contradiction, ce fichier gagne.

## Décisions de la cliente (16/10/2026)

| Sujet | Décision |
|---|---|
| Demandes (retours, transmissions) | Cible : **outil entrepôt** (elixirentrepot, réclamations/tickets) via une API signée HMAC — son dépôt n'est pas disponible : on code le client (désactivé tant que `entrepot_url` est vide). En attendant : **e-mail à l'équipe + liste dans l'admin**, et mode `simulation` au pilote. |
| Duplicata | **PDF d'origine d'Odoo tel quel** (`invoice_pdf_report_id`), **sans** tampon « DUPLICATA ». Téléchargement dans l'app. |
| Moteur | `claude-opus-5-5`, `output_config.effort: "low"`, `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`, pensée adaptative implicite (ne pas envoyer `thinking` désactivé ni `budget_tokens`), `tool_choice` auto. |
| Retours | L'assistant **prépare** un brouillon ; la pharmacie **confirme par un bouton** ; aucun refus automatique au-delà de 10 jours (information seulement, le Pharmacien Responsable décide). |
| Bons de livraison (demande du 22/10/2026 : « peux tu faire en sorte qu'une pharmacie obtienne ses bons de livraison via le chatbot ? ») | Odoo ne garde pas le PDF d'un bon de livraison et son calcul est interdit par l'API : **« Duplicata de bon de livraison » généré par le site pour TOUS les bons** (mêmes rubriques que le bon imprimé par l'entrepôt, établi avec les données d'Odoo à la date d'édition), une seule présentation, **aucune écriture Odoo**, aucun jeton du portail, aucune pièce jointe servie. Choix par défaut, révisables par Zineb : pas de téléphone imprimé ; recherche par jour de **sortie de l'entrepôt** (« expédié le … à … » ; un jour de réception = ce jour et les trois d'avant), numéro de bon, commande, facture ou produit ; toute la période en un seul PDF jusqu'à 60 bons ; renvois après retour listés et signalés, réceptions de retour exclues. Le PDF d'Odoo à l'identique (une création dans Odoo) n'est **pas** construit : voir la conception § 2.12. |
| Non tranché → défauts | Délai annoncé « Réponse sous 24 h ouvrées (du lundi au vendredi). » ; e-mail équipe et qualité `pharmacien@elixirpharma.fr` ; téléphone 01 86 04 39 95 ; horaires « lun-ven 9 h 30-17 h, sam 9 h 30-14 h » ; conservation 90 jours ; une seule officine par compte. **Tout cela vit dans les réglages**, jamais en dur dans le texte affiché. |

## Règles absolues

1. **Identité = jeton vérifié côté serveur.** Aucun outil, aucune action HTTP n'accepte un identifiant de pharmacie, un CIP, un e-mail ou une URL venant du navigateur ou du modèle (seule exception : l'admin, avec `pour_odoo_id`, revalidé dans Odoo).
2. **Toute lecture Odoo de factures** : `company_id = 2` ∧ `commercial_partner_id = P` ∧ `state = posted` ∧ `move_type in (out_invoice, out_refund)`. **Commandes** : `company_id = 2` ∧ `partner_id child_of P`. **Bons de livraison** (`stock.picking`) : `company_id = 2` ∧ `partner_id child_of P` ∧ `picking_type_code = outgoing` ∧ `state = done` ∧ `location_dest_id.usage = customer` (lignes, reliquats, commande et adresse : le filtre de la fiche redoublé sur chaque lecture). Toujours `context.allowed_company_ids = [2]`. Jamais `read([id])` sur un id venu du modèle sans ce domaine.
3. **Jamais** d'état de paiement (`payment_state`, `amount_residual`, `credit`…), ni `access_token`, ni notes/fil de discussion, ni e-mail/téléphone, ni prix d'achat dans ce qui sort vers le modèle ou l'écran.
4. Référence inconnue **ou** d'une autre pharmacie → **même** réponse (« Aucun document de ce numéro pour votre pharmacie »).
5. Rien n'est envoyé (demande, e-mail) sans **clic** de la pharmacie, sauf la transmission à un conseiller (demandée explicitement, bornée par quotas).
6. Hôte d'aperçu (`/^[a-z0-9-]+--commandes-elixir\.netlify\.app$/`) : **aucun** appel au modèle, aucune écriture, aucun e-mail → réponses fictives.
7. Journaux : JSON une ligne, **jamais** le texte des messages, montants, e-mails, secrets.
8. Aucune fusion vers `master` sans accord : tout part en production.

## Fichiers et propriétaires (travail en parallèle)

| Fichier | Propriétaire |
|---|---|
| `netlify/functions/order-list.js`, `pharmacy-lookup.js`, `restock-alert.js` | Lot 0 (sécurité de l'existant) — en ligne sur `master` depuis les correctifs de sécurité du 19/10/2026, version de `master` reprise à la fusion (l'agrégat de campagne `?agrege=1` est retiré : les autres pharmacies comptent par `group-order`) |
| `netlify/functions/_chat-perimetre.js`, `_chat-outils.js` (+ `_chat-outils-liste.js` : définitions seules, sans dépendance), `_chat-releve.js`, `_chat-bl.js` (duplicata de bon de livraison, 22/10/2026), `chat-fichier.js`, `scripts/test-chat-perimetre.mjs`, `scripts/test-chat-outils.mjs`, `scripts/test-chat-bl.mjs`, `scripts/chat-essai-odoo.mjs` | Lot 1 (Odoo, outils, fichiers) |
| `netlify/functions/_chat-stock.js`, `_chat-config.js`, `_chat-systeme.js`, `_chat-moteur.js`, `_chat-demandes.js`, `chat.js`, `chat-tour-background.js`, `chat-purge.js`, `chat-admin.js`, `sql/chat-schema.sql`, `scripts/test-chat-moteur.mjs`, `scripts/test-chat-api.mjs`, `scripts/test-chat-demandes.mjs`, `scripts/eval-chat.mjs` | Lot 2-3-5 (moteur, API, demandes, stockage) |
| `src/components/AssistantPanel.jsx`, `src/components/assistant/*`, `src/assistant-client.js`, entrées dans `src/App.jsx` et `src/components/MyOrdersPanel.jsx`, cas `chat` de `src/dev/reponses-fictives.js` et du banc `scripts/banc/*` | Lot 4 (interface) |
| `src/jetons.js` (renouvellement des jetons, un seul échange à la fois, partagé par `appelAuthentifie` d'App et `assistant-client.js`) | Correctifs de sécurité du 19/10/2026 (repris d'App.jsx à la fusion) |
| `src/components/AdminAssistant.jsx` + son onglet dans l'admin | Lot 7 (admin) |
| `package.json` / `package-lock.json` | Lot 1 seulement (ajout éventuel de `pdf-lib`) |
| `scripts/test-chat-integration.mjs` (vrais modules branchés entre eux, doublures aux extrémités seulement) | Intégration |

## Réglages (`_chat-config.js`)

Stockés dans la table `chat_reglages` (une ligne `id = 1`, colonne `valeur text` = JSON), **RLS sans policy** (illisible avec la clé anon ; `ec_config` est lisible publiquement par `config-get`, donc pas là). Lus par `lireReglages(deps)` avec ces défauts fusionnés :

```js
export const REGLAGES_DEFAUT = {
  actif: false,                 // interrupteur général
  ouvert_a_tous: false,         // false = seulement `pilote` (+ admins en mode « pour une pharmacie »)
  pilote: [],                   // odoo_id (nombres)
  modele: "claude-opus-5-5",
  effort: "low",
  budget_jour_eur: 8,
  budget_fiche_jour_eur: 1.5,   // plafond de coût par pharmacie et par jour (saisie Elixir : 3 × par admin) ; 0 = sans plafond
  demandes: "simulation",       // "simulation" | "email" | "entrepot"
  entrepot_url: "",             // URL de l'API chatbot-intake de l'outil entrepôt (vide = non branché)
  email_equipe: "pharmacien@elixirpharma.fr",
  email_qualite: "pharmacien@elixirpharma.fr",
  delai_annonce: "Réponse sous 24 h ouvrées (du lundi au vendredi).",
  telephone: "01 86 04 39 95",
  horaires: "lun-ven 9 h 30-17 h, sam 9 h 30-14 h",
  conservation_jours: 90,
  quotas: { messages_heure: 15, messages_jour: 40, fichiers_jour: 20, retours_jour: 5, transmissions_jour: 3, admin_messages_jour: 60 },
  profondeur: { factures_mois: 24, releve_mois: 12, commandes_mois: 6 },
};
```
Modèles acceptés (`MODELES`) : `claude-opus-5-5` seulement. Pas Haiku 5.5 (pas de repli serveur) ; pas Sonnet 5.5 (relecture du 19/10/2026) : son repli serveur tourne sur Claude Sonnet 5, qui refuse les messages `role:"system"` en cours de conversation, alors que la requête repliée doit rester valable pour le modèle de repli. `budget_jour_eur: 0` = sans plafond.

## Identité (`_chat-perimetre.js`)

```js
// Lève une Erreur { status, code } : 401 "reconnexion" | 403 "fiche" | 403 "admin_fiche"
export async function identifier(event, body, deps = {}) → ctx
ctx = {
  odooId: number,               // fiche commerciale (parent_id = false), société 2 ou partagée acheteuse
  cip: string | null,
  nom: string, ville: string | null,
  compteEmail: string,          // e-mail vérifié du jeton (admin : e-mail admin)
  comptes: string[],            // adresses de compte de la fiche (elixir_pharmacies.odoo_id = P) — seules destinataires d'e-mails
  admin: string | null,         // e-mail de l'admin en mode « pour une pharmacie », sinon null
  mode: "complet" | "conseiller_seul",   // conseiller_seul : fiche sans CIP
}
```
- Pharmacie : `Authorization: Bearer <pharmacy_token>` ; on relit `/auth/v1/user` et on exige `email_confirmed_at` ; puis `elixir_pharmacies` (email) → `odoo_id` (repli `fichePharmacie({cip})`) → contrôle Odoo (active, `parent_id = false`, `company_id in [2, false]`, si partagée : au moins une vente société 2).
- Admin : jeton admin (`isAdmin`) + `body.pour_odoo_id` (entier) validé par le même contrôle Odoo. **Pas** `fichePharmacie({odooId})` seul (ne vérifie pas la société).

## Outils (`_chat-outils.js`)

```js
export const OUTILS;            // tableau figé des 8 définitions JSON (strict: true), ordre et octets stables (réexporté de _chat-outils-liste.js)
export const VERSION_OUTILS;    // chaîne, change si une définition change
export const ETAPES;            // { nom_outil: "Je recherche vos factures…" } (texte d'attente affiché)
// Valide `entree` (Zod), applique le périmètre de ctx, renvoie toujours un objet (ne lève pas pour une erreur métier)
export async function executerOutil(nom, entree, ctx, deps) → {
  contenu: object,              // JSON compact pour le tool_result (liste blanche ; ≤ 20 éléments ; textes ≤ 120 car.)
  erreur: boolean,              // true → tool_result is_error
  ui_actions: UiAction[],       // cartes construites par le serveur (voir plus bas)
}
// deps = { odoo, sb, stock, demandes, maintenant: () => Date }   (injectables pour les tests)
```
Noms (ordre figé) : `rechercher_factures`, `duplicata_facture`, `releve_facturation`, `rechercher_commandes`, `detail_commande`, `bons_de_livraison`, `preparer_demande_retour`, `transmettre_a_un_conseiller`. Schémas : ceux de la conception § 2.5 (sauf `duplicata_facture.envoi` : garder l'énumération `telechargement | email_compte`).

- `bons_de_livraison` (22/10/2026) : `{ date_debut: "AAAA-MM-JJ"|null, date_fin: "AAAA-MM-JJ"|null, recherche: string|null (≤ 60), page: entier ≥ 1 }`. Période = jours de **sortie de l'entrepôt** à l'heure de Paris (14 jours par défaut, toute la profondeur `factures_mois` si une recherche est donnée). `recherche` : n° de bon (`EP/OUT/…`, « BL 1003 », « BL n°1003 », « OUT/1003 », ou le nombre lu sur le papier), commande `S…`, référence du site (13 chiffres), n° de facture (ses commandes), CIP13/CIP7 ou mot du nom d'un produit (ce qui est **sorti**). Renvoie 20 bons par page, les plus récents d'abord : `{ numero, date_sortie, heure_sortie, commande (relue dans le domaine des commandes, sinon null), nb_produits, produits (3 au plus : { produit, cip }), renvoi?, reste_a_livrer? }` — jamais la référence client, l'adresse ni l'id Odoo. `note` : seulement si une date de début demandée a été ramenée à la profondeur, si la recherche par produit a atteint 5 000 mouvements (les plus récents d'abord), ou si la période dépasse le fichier unique (60 bons). Un jour sans sortie : `jours_proches` (le jour de sortie précédent et le suivant). Crée **une** autorisation `chat_fichiers` de type `bl` (bons de la période si elle en compte 60 au plus, sinon ceux de la page) et la carte `bons_livraison`.
- `detail_commande` : en plus, `bons_de_livraison: [{ numero, date }]` (sorties validées de la commande) vers le modèle, et `livraisons` sur la carte `commande`. Ligne avec un reliquat encore ouvert : `a_livrer` (quantité des mouvements sortants ouverts), et `non_servi = commandé − servi − a_livrer`.

- `preparer_demande_retour` : `_chat-outils` résout et contrôle dans Odoo (document → livraison validée, lignes, lots, quantité ≤ livrée − déjà retournée, date de sortie d'entrepôt), puis appelle `deps.demandes.creerBrouillon(ctx, brouillon)` → `{ demande_id, expire_at }` et renvoie l'action `recap_retour`.
- `transmettre_a_un_conseiller` : appelle `deps.demandes.transmettre(ctx, { categorie, resume, reference, urgence, rappel, conversation_id })` → `{ numero, delai, deja_transmise?, complement?, complement_envoye? }` et renvoie l'action `transmission`. Une transmission ouverte par conversation **et par catégorie** (une alerte qualité n'est jamais rattachée à une autre catégorie) ; même catégorie avec un nouveau texte = complément (e-mail « Complément à T-… ») ; même texte = rien de nouveau, jamais annoncé comme « transmis ». Appelé seulement avec l'accord explicite de la pharmacie, sauf qualité (immédiat).
- Fichiers (duplicata, relevé) : `deps.stock.fichiers.creer({ odoo_id, type, params, ttl_min: 15, usages_max: 3 })` → `id` (128 bits aléatoires, hex 32). Bons de livraison : `type: "bl"`, `params: { picking_ids: number[] (60 au plus, ordre de la liste) }`, `ttl_min: 15`, `usages_max: min(60, 3 × (n + 1))` (n = bons de la page : 3 par bon et 3 pour l'ensemble). `deps.stock.fichiers.lire(id, odoo_id)` lit une autorisation sans la consommer. `compter.fichiers` compte les fichiers préparés (facture, relevé) et les autorisations `bl` **utilisées** (`usages > 0`) : une liste de bons parcourue ne consomme pas le quota.

## Stockage (`_chat-stock.js`, clé `SUPABASE_SERVICE_ROLE_KEY`)

Tables de `sql/chat-schema.sql` (RLS activé, aucune policy) : `chat_reglages`, `chat_conversations`, `chat_tours`, `chat_demandes`, `chat_fichiers` (colonnes : conception § 2.10). Les messages de l'API sont stockés en **texte** JSON, en ajout seulement.

```js
export function creerStock(deps = {}) → {
  conversations: { ouverte(odooId, admin), creer(ctx, { modele, prompt_version }), lire(id, odooId), ajouterMessages(id, odooId, msgs), fermer(id, odooId), evenement(id, odooId, texte) },
  tours: { creer(conv, ctx), demarrer(id) /* en_attente→en_cours conditionnel, renvoie bool */, etape(id, texte), terminer(id, { texte, ui_actions, usage, cout_eur, repli, duree_ms }), erreur(id, code, bilan?) /* coût gardé */, noterCout(id, bilan), lire(id, odooId), enCours(convId) },
  fichiers: { creer({ odoo_id, type, params, ttl_min, usages_max }), consommer(id, odooId) /* null si expiré, épuisé ou autre fiche */ },
  demandes: { creer({ …, categorie? }), lire(id, odooId), passer(id, de, vers, extra) /* transition conditionnelle */, reprendre(id, updatedAt) /* envoi interrompu, un seul repreneur */, lister(filtre) },
  compter: { messages(odooId, depuisIso) /* sans les messages d'un admin */, fichiers(odooId, depuisIso), demandes(odooId, type, depuisIso), coutJour(jourIso), coutFiche(odooId, depuisIso), coutAdmin(admin, depuisIso) },
}
```
En plus (compatibles) : `conversations.modifier`, `afficher`, `lister`, `lireAdmin` ; `tours.lireServeur`, `lister` ; `compter.messagesAdmin`, `erreurs` ; `reglages.lire`, `ecrire(valeur, base)` ; `alertes` ; `purger`. Une demande de retour reçoit son numéro (`R-AAAA-NNNN`) dès le brouillon.

## API HTTP

Toutes les réponses : CORS de `cors.js` (y compris 401/403/409/410/429/503), `Cache-Control: no-store`, JSON. Limite de débit par IP et par famille d'actions (attente : 150/min, état : 40/min, autres : 30/min) ; identité gardée 60 s par jeton pour l'attente et l'état. Jeton : `Authorization: Bearer` (pharmacie : `freshPharmacyToken()` ; admin « pour une pharmacie » : `admin_token` + `pour_odoo_id` dans le corps ou la requête).

| Appel | Corps / paramètres | Réponse |
|---|---|---|
| `POST /.netlify/functions/chat` `{action:"etat"}` | `pour_odoo_id?` | `200 { disponible: boolean, mode: "complet"|"conseiller_seul"|null, raison: null|"inactif"|"hors_pilote"|"reconnexion"|"budget", infos?, ouvert? }` (`infos` si disponible) — n'échoue jamais en 401 : `disponible:false, raison:"reconnexion"` (+ `ouvert: true` si l'assistant est ouvert à toutes les pharmacies : bouton et encart « Me reconnecter ») ; `raison: null` = échec passager (relu par le navigateur) |
| `{action:"ouvrir", conversation_id?}` | | `200 { conversation_id, pharmacie: { nom, ville }, admin: string|null, mode, messages: MessageAffiche[], infos: { delai_annonce, telephone, horaires, conservation_jours }, tour_en_cours: string|null }` |
| `{action:"message", conversation_id, texte, contexte?: { commande_site_id?: string }}` | texte ≤ 2 000 car. | `202 { tour_id }` · `409 { error:"tour_en_cours", tour_id }` · `410 { error:"conversation_fermee", message }` (conversation fermée ailleurs, inconnue, ou prompt/outils mis à jour : le panneau en ouvre une nouvelle et garde le texte) · `429 { error:"quota", message }` (messages, coût du jour de la fiche) · `503 { error:"indisponible", message }` |
| `GET /.netlify/functions/chat?tour=<id>&conversation_id=<id>` | long-poll ≤ 8 s | `200 { statut: "en_attente"|"en_cours"|"termine"|"erreur", etape: string|null, message: MessageAffiche|null }` |
| `{action:"confirmer", conversation_id, demande_id, decision: "confirmer"|"annuler", prevenir_pharmacie?: boolean}` | sans IA ; `prevenir_pharmacie` : admin seulement (défaut true) | `200 { message: MessageAffiche }` (id `d-<demande_id>` ; carte `demande_enregistree` ou texte « Demande annulée ») · `410 { error:"expiree" }` · `503` (recontrôle Odoo impossible : le brouillon reste) |
| `{action:"nouvelle", conversation_id?}` | ferme l'ouverte | `200` comme `ouvrir` |
| `GET /.netlify/functions/chat-fichier?id=<hex32>` (+ `n=<rang>` pour un seul des bons de livraison d'une autorisation `bl`, 0 à 59 ; + `pour_odoo_id` en admin) | | PDF ou XLSX en `attachment`, `no-store`, `nosniff` · `404` sinon (même réponse pour un id inconnu, expiré, épuisé, d'une autre fiche, un rang hors bornes — refusé avant de consommer un usage —, un bon de l'autorisation que le domaine de la fiche ne retrouve plus, ou une adresse de livraison hors du périmètre de la fiche) · `429 { error: "quota", message }` au premier téléchargement d'une autorisation `bl` quand le quota de fichiers sur 24 h est atteint. Bons de livraison : **tous** les `picking_ids` de l'autorisation sont relus avec le domaine de la fiche avant d'en servir un seul, puis ceux à imprimer encore une fois ; nom `Duplicata_BL_EP_OUT_<n°>.pdf` (un bon) ou `Duplicatas_BL_<jour>[_<jour>].pdf` (plusieurs) |

Erreurs d'identité : `401 { error:"reconnexion" }`, `403 { error:"fiche" }`.

```ts
MessageAffiche = { id: string, role: "pharmacie" | "assistant", texte: string, ui_actions: UiAction[], at: string /* ISO */ }
```
Seuls les textes visibles sont rendus (pas les blocs thinking, tool_use, tool_result, system).

## Cartes `UiAction` (construites par le serveur uniquement)

Montants en nombre (euros, 2 décimales, signés pour les avoirs), dates `AAAA-MM-JJ` (heure de Paris), aucun lien.

```ts
{ type: "document", piece: "facture"|"avoir", numero, date, montant_ttc, pdf_disponible: boolean, fichier_id: string|null }
{ type: "documents", items: Array<{ piece, numero, date, montant_ttc, pdf_disponible }> }          // choix entre candidats ; clic = message prérempli « Le document <numero> »
{ type: "releve", debut, fin, nb_factures, nb_avoirs, total_ht, total_tva, total_ttc, tva: Array<{ taux, base, montant }>, fichiers: { pdf: string, xlsx: string }, mention: "Liste des documents émis ; ne reflète pas les règlements." }
{ type: "commande", reference, date, origine: "site"|"logiciel"|"saisie", etapes: Array<{ cle: "recue"|"preparation"|"sortie"|"facturee", libelle, date: string|null, fait: boolean }>, lignes: Array<{ produit, cip, commande, servi, non_servi, a_livrer? }>, lots: Array<{ produit, lot, peremption, quantite }>, factures: string[], livraisons: Array<{ numero, date }> /* sorties validées : bouton « Bon de livraison » = message « Je voudrais le bon de livraison <numero>. » */, commande_site_id: string|null }
{ type: "bons_livraison", periode: { debut, fin } | null /* null : référence ou produit cherchés sans date */, total, page, pages, items: Array<{ numero, date /* sortie de l'entrepôt */, heure: "HH:MM", commande: string|null, nb_produits, produits: string[] /* 3 au plus */, renvoi: boolean, reste_a_livrer: boolean, rang: number /* place dans l'autorisation */ }>, fichier_id: string|null /* null : quota atteint */, ensemble: number /* bons du fichier unique */, ensemble_periode: boolean /* le fichier unique couvre toute la période */, mention: string }   // bouton par bon : chat-fichier ?id=<fichier_id>&n=<rang> ; « en un seul PDF » : sans n ; un seul bon : bouton principal
{ type: "recap_retour", demande_id, expire_at, document: { numero, date_sortie }, lignes: Array<{ produit, cip, lot, peremption, quantite }>, motif, souhait, info_delai: string }
{ type: "demande_enregistree", numero, date, delai, email_masque, simulation: boolean }
{ type: "transmission", numero, delai, telephone, horaires }
{ type: "erreur", texte }
```

## E-mails

Resend via `sendMail` de `_gp-mail.js`. Destinataires : `ctx.comptes` (pharmacie) et réglages (`email_equipe`, `email_qualite`) — **jamais** une adresse écrite dans la conversation. Textes libres échappés. Mode `simulation` : objet préfixé « [SIMULATION] », rien vers l'outil entrepôt.

## Tests (aucun appel réel au modèle, aucune écriture réelle)

`node scripts/test-chat-*.mjs` : doublures d'Odoo, Supabase, Anthropic, Resend par injection (`deps`). Seule exception : `scripts/chat-essai-odoo.mjs` lit le vrai Odoo **en lecture seule** via `~/Downloads/pharmaml-audit/odoo.mjs` (enveloppe qui refuse toute méthode autre que `search_read`, `read`, `search`, `search_count`, `fields_get`) pour vérifier domaines et totaux (relevé de la fiche 595 en septembre 2026 : HT 89 041,89 · TVA 2 488,65 · TTC 91 530,54). Contrôles généraux : `npm run build`, `npm run lint`, `npm run zones` (budget du bundle principal 940 000 octets, panneau chargé à la demande).
