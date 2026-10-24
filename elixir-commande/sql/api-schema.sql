-- ── API des pharmacies (/api/v1) : tables privées du serveur ─────────────────────────────────────
-- Conception : note de travail « API Elixir pour les pharmacies — V1 » (§ 3, § 5, § 6, § 17) ; contrat interne à venir
-- dans docs/api.md. À exécuter par Zineb dans l'éditeur SQL de Supabase. Rejouable sans effet (IF [NOT] EXISTS partout).
--
-- Sécurité : RLS ACTIVÉ et AUCUNE policy, droits retirés à anon et authenticated (modèle de sql/chat-schema.sql). Ces
-- tables sont donc illisibles et non modifiables avec la clé anon du navigateur. Seules les fonctions de l'API
-- (api-v1, api-admin, api-compte) y accèdent, avec la clé serveur SUPABASE_SERVICE_ROLE_KEY (déjà en place). Ne jamais
-- ajouter de policy ni désactiver le RLS ici.
--
-- Aucune clé d'API n'est stockée : seulement son empreinte SHA-256 (hex) et un préfixe d'affichage (« elx_live_Ab3d…k9Qz »).
-- Le journal des appels ne contient ni corps de requête, ni adresse IP complète (préfixe /24 ou /64), ni e-mail.
-- Les dates sont en UTC (timestamptz) ; l'API les rend à l'heure de Paris.

-- Réglages (une seule ligne, id = 1) : JSON fusionné avec REGLAGES_DEFAUT de netlify/functions/_api-config.js.
--   actif            : interrupteur général (« Tout couper » : toutes les routes en 503 api_suspendue, sauf /v1/etat) ;
--   commandes_live   : « Commandes par API » — fermées tant que les prérequis ne sont pas tous cochés (le serveur refuse
--                      de les ouvrir avant) ; les commandes de TEST (clés elx_test_) n'en dépendent pas ;
--   prerequis        : liste de contrôle de l'onglet 🔌 API (fait, date, auteur, note).
-- Pas dans ec_config : ec_config est lisible publiquement par config-get.
create table if not exists api_reglages (
  id          int primary key default 1 check (id = 1),
  valeur      text not null default '{}',
  updated_at  timestamptz not null default now()
);
insert into api_reglages (id) values (1) on conflict (id) do nothing;

-- Accès : une ligne par fiche commerciale Odoo (société 2, ou partagée cliente d'Elixir), ouverte par Elixir à la demande.
-- La pharmacie crée ensuite ses clés dans son compte (api-compte) ; variante admin tracée pour une pharmacie sans compte.
create table if not exists api_acces (
  odoo_id                 int primary key check (odoo_id > 0),
  nom                     text,                         -- relevés dans Odoo à l'ouverture (admin, /v1/etat)
  cip                     text,
  ville                   text,
  actif                   boolean not null default true,   -- false : accès suspendu (403 acces_suspendu)
  portees                 text[] not null default '{lecture,commande,documents}'
                          check (portees <@ array['lecture', 'commande', 'documents']::text[]),
  -- auto   : commande acceptée, mise en file après le délai d'annulation (sauf anomalie : « à vérifier ») ;
  -- bloque : nouvelles commandes refusées (403 commandes_bloquees), celles en attente ne partent pas
  mode                    text not null default 'auto' check (mode in ('auto', 'bloque')),
  delai_annulation_min    int not null default 10 check (delai_annulation_min between 0 and 20),
  -- plafonds (réglables pharmacie par pharmacie)
  plafond_lignes          int not null default 100 check (plafond_lignes between 1 and 200),
  plafond_boites          int not null default 1000 check (plafond_boites between 1 and 100000),
  plafond_montant_ht      numeric(12, 2) not null default 3000 check (plafond_montant_ht > 0),
  plafond_commandes_jour  int not null default 10 check (plafond_commandes_jour between 1 and 200),
  -- anomalies nettes → commande gardée « à vérifier » (jamais d'envoi automatique) :
  --   ligne au-delà de anomalie_facteur × la quantité mensuelle habituelle de ce produit pour cette pharmacie ;
  --   quasi-doublon d'une commande reçue depuis moins de anomalie_doublon_min minutes, tous canaux (0 : contrôle coupé)
  anomalie_active         boolean not null default true,
  anomalie_facteur        numeric(6, 2) not null default 10 check (anomalie_facteur >= 2),
  anomalie_doublon_min    int not null default 30 check (anomalie_doublon_min between 0 and 1440),
  ip_autorisees           text[],                       -- adresses ou réseaux (CIDR) autorisés ; null : tous
  liste_prix_id           int,                          -- liste de prix de la fiche (Odoo, société 2)
  liste_prix_lue_le       timestamptz,
  test_valide_le          timestamptz,                  -- parcours de test réussi (ou validé par l'admin, tracé)
  test_valide_par         text,
  cgu_version             text,                         -- conditions d'utilisation de l'API acceptées (preuve)
  cgu_acceptees_le        timestamptz,
  cgu_acceptees_par       text,
  cgu_preuve              text,                         -- JSON : empreinte du texte, réseau, mode (en ligne, signature)
  ouvert_par              text not null,
  ouvert_le               timestamptz not null default now(),
  suspendu_le             timestamptz,
  suspendu_par            text,
  motif_suspension        text,
  note                    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Clés : une par outil (libellé), live ou test. Le secret n'est montré qu'UNE fois, à la création.
create table if not exists api_cles (
  id                    uuid primary key default gen_random_uuid(),
  odoo_id               int not null references api_acces (odoo_id),
  environnement         text not null check (environnement in ('live', 'test')),
  empreinte             text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),   -- sha256 hex de la clé
  prefixe               text not null,                 -- affichage : « elx_live_Ab3d…k9Qz »
  libelle               text not null check (char_length(libelle) between 1 and 60),
  portees               text[] not null check (portees <@ array['lecture', 'commande', 'documents']::text[] and cardinality(portees) > 0),
  creee_par             text not null,
  creee_par_role        text not null check (creee_par_role in ('pharmacie', 'admin')),
  created_at            timestamptz not null default now(),
  expire_le             timestamptz,                   -- rotation : l'ancienne clé reste valide 7 jours
  revoquee_le           timestamptz,
  revoquee_par          text,
  motif_revocation      text,
  remplace              uuid references api_cles (id),
  derniere_utilisation  timestamptz,                   -- mise à jour au plus une fois par minute
  dernier_reseau        text                           -- préfixe /24 ou /64
);
create index if not exists api_cles_fiche on api_cles (odoo_id, environnement);

-- Commandes reçues par l'API : réservation (idempotence) puis preuve. Une ligne par (fiche, environnement, Idempotency-Key).
-- Le numéro de commande (order_id) est choisi par le serveur et écrit AVANT l'insertion dans elixir_orders.
create table if not exists api_commandes (
  id                 uuid primary key default gen_random_uuid(),
  odoo_id            int not null,
  cle_id             uuid not null references api_cles (id),
  test               boolean not null,
  idempotency_key    text not null check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  empreinte_requete  text not null,                    -- sha256 du corps normalisé
  reference_client   text check (reference_client is null or char_length(reference_client) <= 40),
  order_id           text,                             -- elixir_orders.id (« T… » en test : jamais dans elixir_orders)
  etat               text not null,                    -- en_cours, refusee, recue, a_verifier, envoi_demande, annulee…
  motif              text,
  statut_http        int,
  demande            text,                             -- corps normalisé (preuve), jamais de donnée personnelle
  reponse            text,                             -- réponse rendue (rejeu à l'identique)
  envoi_apres        timestamptz,                      -- fin du délai d'annulation
  envoi_resultat     text,
  recu_le            timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (odoo_id, test, idempotency_key)
);
-- reference_client unique par fiche hors commandes refusées ET annulées (une commande annulée libère sa référence : la
-- commande corrigée peut la reprendre). L'ancien index (hors refusées seulement) est remplacé.
drop index if exists api_commandes_reference;
create unique index if not exists api_commandes_reference_v2 on api_commandes (odoo_id, test, reference_client)
  where reference_client is not null and etat not in ('refusee', 'annulee');
create index if not exists api_commandes_a_envoyer on api_commandes (etat, envoi_apres);
create index if not exists api_commandes_commande on api_commandes (order_id);
create index if not exists api_commandes_fiche on api_commandes (odoo_id, recu_le);

-- Journal des appels : ni corps, ni IP complète, ni e-mail. Conservé 13 mois.
create table if not exists api_journal (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  request_id     uuid not null,
  cle_id         uuid,
  odoo_id        int,
  environnement  text,
  methode        text not null,
  route          text not null,                        -- gabarit : /v1/commandes/{id}
  statut         int not null,
  code           text,                                 -- code d'erreur (problem+json) ou null
  duree_ms       int,
  reseau         text                                  -- préfixe /24 ou /64
);
create index if not exists api_journal_at on api_journal (at);
create index if not exists api_journal_cle on api_journal (cle_id, at);
create index if not exists api_journal_fiche on api_journal (odoo_id, at);
-- support : recherche d'un appel par son X-Request-Id (onglet 🔌 API, « Rechercher un X-Request-Id »)
create index if not exists api_journal_requete on api_journal (request_id);

-- Événements de cycle de vie (preuve) : accès ouvert ou modifié, CGU acceptées, clé créée, remplacée ou révoquée,
-- test validé par l'admin, réglages, prérequis, « Tout couper ». Jamais de secret.
create table if not exists api_evenements (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  type      text not null,
  odoo_id   int,
  cle_id    uuid,
  par       text,                                      -- compte (pharmacie) ou e-mail admin
  role      text check (role in ('pharmacie', 'admin', 'systeme')),
  detail    text                                       -- JSON
);
create index if not exists api_evenements_fiche on api_evenements (odoo_id, at);

-- Compteurs de débit durables (communs à toutes les instances) : fenêtre fixe, incrément atomique.
-- Clés : « ip:<empreinte> », « ipko:<empreinte> », « cle:<uuid>:<classe>:<fenêtre> » (aucune IP en clair). Purge : 2 jours.
create table if not exists api_compteurs (
  cle      text not null,
  fenetre  timestamptz not null,
  n        int not null default 0,
  primary key (cle, fenetre)
);
create index if not exists api_compteurs_fenetre on api_compteurs (fenetre);

-- début de la fenêtre en cours : fenêtre d'un jour (86 400 s) = jour de Paris (minuit, heure de Paris : le « jour » des
-- débits est celui du plafond de commandes) ; autres fenêtres : fixes, alignées sur l'époque
create or replace function api_fenetre(p_fenetre_s int) returns timestamptz
language sql stable set search_path = public as $$
  select case when p_fenetre_s = 86400 then (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')
    else to_timestamp(floor(extract(epoch from now()) / p_fenetre_s) * p_fenetre_s) end;
$$;
-- +1 sur la fenêtre en cours → nouvelle valeur
create or replace function api_compter(p_cle text, p_fenetre_s int) returns int
language sql set search_path = public as $$
  insert into api_compteurs (cle, fenetre, n)
  values (p_cle, api_fenetre(p_fenetre_s), 1)
  on conflict (cle, fenetre) do update set n = api_compteurs.n + 1
  returning n;
$$;
-- valeur de la fenêtre en cours, sans incrément (lue avant de compter : une requête refusée par le débit n'est pas comptée)
create or replace function api_lire_compteur(p_cle text, p_fenetre_s int) returns int
language sql stable set search_path = public as $$
  select coalesce((select n from api_compteurs where cle = p_cle and fenetre = api_fenetre(p_fenetre_s)), 0);
$$;
revoke all on function api_fenetre(int) from public, anon, authenticated;
revoke all on function api_compter(text, int) from public, anon, authenticated;
revoke all on function api_lire_compteur(text, int) from public, anon, authenticated;
grant execute on function api_fenetre(int) to service_role;
grant execute on function api_compter(text, int) to service_role;
grant execute on function api_lire_compteur(text, int) to service_role;

-- ── Phase 2 (lecture) : prix de la liste de chaque pharmacie ──────────────────────────────────────
-- Prix HT calculés par Odoo lui-même (rapport de liste de prix, comme le contrôle des écarts de la péremption) pour chaque
-- liste utilisée par un accès ouvert, la nuit (api-cron → api-prix-background, une liste par passage) ou à la demande de
-- l'admin. Odoo facture le MINIMUM des règles applicables : le rapport donne ce prix facturé, quantité 1 puis chaque
-- quantité de palier de la liste. Jamais de nom ni de numéro de liste dans les réponses de l'API.
create table if not exists api_prix (
  liste_id    int not null,
  cip         text not null,                           -- CIP13 du catalogue (odoo_catalog.cip)
  prix_ht     numeric(12, 2),                          -- null : pas de prix calculable (prix de base nul…)
  paliers     text,                                    -- JSON [{ "a_partir_de": 12, "prix_ht": 3.70 }] (prix strictement décroissants)
  calcule_le  timestamptz not null,
  primary key (liste_id, cip)
);
create index if not exists api_prix_calcul on api_prix (liste_id, calcule_le);

-- État du calcul de chaque liste (onglet 🔌 API, déclenchement par api-cron) :
--   a_calculer : demandé (nouvel accès, liste changée dans Odoo, bouton de l'admin) ; en_cours ; pret ; erreur.
create table if not exists api_prix_listes (
  liste_id    int primary key check (liste_id > 0),
  etat        text not null default 'a_calculer' check (etat in ('a_calculer', 'en_cours', 'pret', 'erreur')),
  demande_le  timestamptz,
  debut_le    timestamptz,
  fin_le      timestamptz,
  produits    int,                                     -- produits du catalogue traités au dernier calcul
  sans_prix   int,
  appels      int,                                     -- appels du rapport d'Odoo au dernier calcul (charge)
  erreur      text,                                    -- message court, jamais de donnée
  updated_at  timestamptz not null default now()
);

-- ── Phase 3 (commandes) ────────────────────────────────────────────────────────────────────────────
-- Parcours de test (conception § 9) : étapes réussies avec une clé elx_test_ (JSON { etat, simulation, commande, relecture,
-- annulation, rejeu : date }) ; les six faites → test_valide_le posé (clé de production possible). Lue et écrite à part par
-- l'API : tant que ce fichier n'est pas rejoué, le parcours ne se valide pas seul (l'admin peut toujours « Valider le test »).
alter table api_acces add column if not exists test_parcours text;
-- api_commandes (déjà créée en phase 1) : états d'une commande reçue par l'API
--   en_cours      réservation (Idempotency-Key) pendant les contrôles ; order_id + reponse notés AVANT l'insertion ;
--   refusee       réponse 4xx enregistrée (rejouée à l'identique ; reference_client libérée) ;
--   recue         acceptée, délai d'annulation jusqu'à envoi_apres (DELETE possible) ; puis api-commandes-cron l'envoie ;
--   a_verifier    gardée par Elixir (anomalie nette, doublon, envoi coupé ou manqué) : jamais envoyée seule ;
--   envoi_demande prise par api-envoi-background ; envoyee : mise en file du relais (l'état suit ensuite le relais et Odoo) ;
--   non_servie    toutes les lignes en rupture (si_rupture « retirer ») ; annulee : annulée par la pharmacie.
-- Les commandes réelles sont aussi dans elixir_orders (source « api », sans e-mail, CIP de la fiche) : onglet Commandes,
-- contingentement, « Mes commandes », relais. Les commandes de test (« T… ») ne sont QUE dans api_commandes.
comment on column api_commandes.etat is 'en_cours, refusee, recue, a_verifier, envoi_demande, envoyee, non_servie, annulee';

-- ── Revue du 24/10/2026 ──────────────────────────────────────────────────────────────────────────
-- Droit « documents » (factures, avoirs, bons de livraison et leurs PDF), séparé de « lecture » : contraintes élargies
-- (tables déjà créées) et, UNE SEULE FOIS (événement « migration_documents »), ajouté aux accès et aux clés qui avaient
-- « lecture » (compatible : rien ne change pour eux). Rejouer ce fichier ne le redonne jamais à un accès qui l'a perdu.
alter table api_acces drop constraint if exists api_acces_portees_check;
alter table api_acces add constraint api_acces_portees_check check (portees <@ array['lecture', 'commande', 'documents']::text[]);
alter table api_acces alter column portees set default '{lecture,commande,documents}';
alter table api_cles drop constraint if exists api_cles_portees_check;
alter table api_cles add constraint api_cles_portees_check check (portees <@ array['lecture', 'commande', 'documents']::text[] and cardinality(portees) > 0);
do $$
begin
  if not exists (select 1 from api_evenements where type = 'migration_documents') then
    update api_acces set portees = portees || '{documents}'::text[] where 'lecture' = any(portees) and not ('documents' = any(portees));
    update api_cles set portees = portees || '{documents}'::text[] where 'lecture' = any(portees) and not ('documents' = any(portees));
    insert into api_evenements (type, role, detail) values ('migration_documents', 'systeme', '{"droit":"documents"}');
  end if;
end $$;

-- Marques de l'API sur les lignes d'une commande du site (annulation par la pharmacie, rupture retirée à l'envoi) : en UNE
-- transaction, commande verrouillée, seulement sur les lignes sans synced_at ni handled_at (une ligne partie ou traitée par
-- Elixir n'est jamais touchée) ; processed posé si toutes les lignes sont faites → nombre de lignes marquées (-1 : commande
-- absente). Remplace la relecture puis réécriture de tout le tableau : une marque d'envoi posée entre-temps n'est plus
-- écrasée. Tant que ce fichier n'est pas rejoué, l'API garde l'ancienne écriture (rien ne casse).
create or replace function api_marquer_lignes(p_order_id text, p_idx int[], p_motif text, p_at text) returns int
language plpgsql set search_path = public as $$
declare
  v_type_items text;
  v_type_id text;
  v_items jsonb;
  v_it jsonb;
  v_n int := 0;
  v_tous boolean;
begin
  if p_motif is null or p_motif not in ('annulee', 'rupture') then raise exception 'api_marquer_lignes : motif inconnu'; end if;
  if p_order_id !~ '^1[7-9][0-9]{11}$' then return -1; end if;
  select format_type(atttypid, atttypmod) into v_type_items from pg_attribute
    where attrelid = 'public.elixir_orders'::regclass and attname = 'items' and not attisdropped;
  select format_type(atttypid, atttypmod) into v_type_id from pg_attribute
    where attrelid = 'public.elixir_orders'::regclass and attname = 'id' and not attisdropped;
  execute format('select items::jsonb from elixir_orders where id = $1::%s for update', v_type_id) into v_items using p_order_id;
  if v_items is null then return -1; end if;
  if jsonb_typeof(v_items) = 'string' then v_items := (v_items #>> '{}')::jsonb; end if;
  if jsonb_typeof(v_items) <> 'array' then return 0; end if;
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    v_it := v_items -> i;
    if jsonb_typeof(v_it) = 'object' and (p_idx is null or i = any(p_idx))
       and coalesce(v_it ->> 'synced_at', '') = '' and coalesce(v_it ->> 'handled_at', '') = '' then
      v_items := jsonb_set(v_items, array[i::text], v_it || jsonb_build_object('handled_at', p_at, 'api_motif', p_motif));
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    select bool_and(coalesce(x ->> 'synced_at', '') <> '' or coalesce(x ->> 'handled_at', '') <> '') into v_tous from jsonb_array_elements(v_items) x;
    execute format('update elixir_orders set items = $1::%s, processed = (coalesce(processed, false) or $2) where id = $3::%s', v_type_items, v_type_id)
      using v_items, coalesce(v_tous, false), p_order_id;
  end if;
  return v_n;
end $$;
revoke all on function api_marquer_lignes(text, int[], text, text) from public, anon, authenticated;
grant execute on function api_marquer_lignes(text, int[], text, text) to service_role;

-- RLS activé, aucune policy (voir l'en-tête) ; droits retirés à anon et authenticated.
alter table api_reglages   enable row level security;
alter table api_acces      enable row level security;
alter table api_cles       enable row level security;
alter table api_commandes  enable row level security;
alter table api_journal    enable row level security;
alter table api_evenements enable row level security;
alter table api_compteurs  enable row level security;
alter table api_prix       enable row level security;
alter table api_prix_listes enable row level security;
revoke all on table api_reglages, api_acces, api_cles, api_commandes, api_journal, api_evenements, api_compteurs,
  api_prix, api_prix_listes
  from anon, authenticated;
