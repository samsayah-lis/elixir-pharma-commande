-- ── Assistant Elixir (chatbot service client) : tables du serveur ─────────────────────────────
-- Contrat : docs/assistant-contrat.md (« Stockage ») ; conception : docs/assistant-conception.md § 2.10.
-- À exécuter par Zineb dans l'éditeur SQL de Supabase. Rejouable sans effet (IF [NOT] EXISTS partout).
--
-- Sécurité : RLS ACTIVÉ et AUCUNE policy. Ces tables sont donc illisibles et non modifiables avec la clé anon
-- (SUPABASE_KEY, présente dans le navigateur) : les conversations contiennent numéros de factures et montants.
-- Seules les fonctions du chat y accèdent, avec la clé serveur SUPABASE_SERVICE_ROLE_KEY (variable Netlify
-- à ajouter ; la clé service_role contourne le RLS). Ne jamais ajouter de policy ni désactiver le RLS ici.
--
-- Les messages de l'API sont stockés en TEXTE JSON (jamais jsonb, qui réordonne les clés) et en ajout
-- seulement : l'historique est rejoué octet pour octet au modèle (blocs de réflexion compris).

-- Réglages (une seule ligne, id = 1) : JSON fusionné avec REGLAGES_DEFAUT de _chat-config.js.
-- Pas dans ec_config : ec_config est lisible publiquement par config-get.
create table if not exists chat_reglages (
  id          int primary key default 1 check (id = 1),
  valeur      text not null default '{}',
  updated_at  timestamptz not null default now()
);
insert into chat_reglages (id) values (1) on conflict (id) do nothing;

-- Conversations : une ouverte au plus par fiche Odoo et par auteur (la pharmacie, ou un admin en saisie).
create table if not exists chat_conversations (
  id                     uuid primary key default gen_random_uuid(),
  odoo_id                int not null,                 -- fiche commerciale Odoo (identité vérifiée par le serveur)
  cip                    text,
  pharmacie              text,                         -- nom de la fiche au moment de l'ouverture (admin)
  compte_email           text,                         -- e-mail vérifié du jeton (admin : e-mail admin)
  admin_email            text,                         -- admin en mode « pour une pharmacie », sinon null
  modele                 text not null,                -- figé pour toute la conversation (réflexion liée au modèle)
  prompt_version         text not null,                -- nouvelle conversation si le prompt change
  statut                 text not null default 'ouverte' check (statut in ('ouverte', 'close')),
  messages               text not null default '[]',   -- messages de l'API (JSON), ajouts seulement
  affichage              text not null default '[]',   -- MessageAffiche[] (JSON) : ce que voient la pharmacie et l'admin
  evenements_en_attente  text not null default '[]',   -- événements serveur à dire au modèle après le prochain message
  nb_messages            int not null default 0,       -- messages écrits (pharmacie ou admin)
  version                int not null default 0,       -- écriture conditionnelle (aucune perte entre deux écritures)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists chat_conversations_odoo_created on chat_conversations (odoo_id, created_at);
create index if not exists chat_conversations_updated on chat_conversations (updated_at);
create unique index if not exists chat_conversations_une_ouverte
  on chat_conversations (odoo_id, coalesce(admin_email, '')) where statut = 'ouverte';

-- Tours : un message et sa réponse. Sert aussi de compteur durable (quotas, budget du jour).
create table if not exists chat_tours (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references chat_conversations (id) on delete cascade,
  odoo_id          int not null,
  admin_email      text,
  ctx              text not null default '{}',          -- identité vérifiée par chat.js, relue par l'arrière-plan
  statut           text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'termine', 'erreur')),
  etape            text,                                 -- texte d'attente déduit de l'outil en cours (serveur)
  texte            text,
  ui_actions       text not null default '[]',
  outils           text not null default '[]',           -- noms des outils appelés (admin)
  usage            text,                                 -- 4 compteurs de jetons (JSON)
  cout_eur         numeric(12, 6) not null default 0,
  appels           int not null default 0,
  repli            boolean not null default false,       -- réponse servie par le modèle de repli serveur
  refus            boolean not null default false,
  code             text,                                 -- ok, refus, limite_appels, delai, erreur…
  duree_ms         int,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index if not exists chat_tours_odoo_created on chat_tours (odoo_id, created_at);
create index if not exists chat_tours_admin_created on chat_tours (admin_email, created_at);
create index if not exists chat_tours_created on chat_tours (created_at);
create index if not exists chat_tours_conversation on chat_tours (conversation_id, created_at);
-- un seul tour actif par conversation : un second message pendant une réponse → 409
create unique index if not exists chat_tours_un_actif
  on chat_tours (conversation_id) where statut in ('en_attente', 'en_cours');

-- Demandes (retours et transmissions) : conservées après la purge des conversations (dossier qualité).
create table if not exists chat_demandes (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity,  -- n° lisible : R-2026-0412, T-2026-0187
  numero           text,
  type             text not null check (type in ('retour', 'transmission')),
  categorie        text,                                 -- transmission : catégorie (documents, qualite, reglement…)
  statut           text not null check (statut in ('brouillon', 'confirmee', 'transmise', 'echec', 'expiree', 'annulee', 'traitee', 'rejetee')),
  conversation_id  uuid references chat_conversations (id) on delete set null,
  odoo_id          int not null,
  pharmacie        text,
  admin_email      text,
  brouillon        text not null default '{}',           -- contenu construit par le serveur (JSON)
  resume           text,                                 -- transmission : résumé rédigé par l'assistant
  cible_ref        text,                                 -- référence renvoyée par l'outil entrepôt, ou « email »
  expire_at        timestamptz,                          -- brouillon de retour : 30 min
  created_at       timestamptz not null default now(),
  confirmee_at     timestamptz,
  transmise_at     timestamptz,
  updated_at       timestamptz not null default now(),
  erreur           text
);
create index if not exists chat_demandes_odoo_created on chat_demandes (odoo_id, created_at);
create index if not exists chat_demandes_statut_created on chat_demandes (statut, created_at);
create index if not exists chat_demandes_conversation on chat_demandes (conversation_id);
create unique index if not exists chat_demandes_numero on chat_demandes (numero) where numero is not null;
-- colonne ajoutée après la première version du schéma (19/10/2026) : ajoutée ici si la table existait déjà
alter table chat_demandes add column if not exists categorie text;
-- une seule transmission ouverte par conversation ET par catégorie (dédoublonnage, même pour deux appels simultanés) :
-- une alerte qualité n'est jamais rattachée à une demande d'une autre catégorie (première version : par conversation seule)
drop index if exists chat_demandes_une_transmission;
create unique index if not exists chat_demandes_une_transmission_categorie
  on chat_demandes (conversation_id, coalesce(categorie, '')) where type = 'transmission' and statut in ('confirmee', 'transmise', 'echec');

-- Autorisations de téléchargement (duplicata, relevé) : 128 bits aléatoires, 15 min, 3 usages.
create table if not exists chat_fichiers (
  id          text primary key check (id ~ '^[0-9a-f]{32}$'),
  odoo_id     int not null,
  type        text not null,
  params      text not null default '{}',
  expire_at   timestamptz not null,
  usages      int not null default 0,
  usages_max  int not null default 3,
  created_at  timestamptz not null default now()
);
create index if not exists chat_fichiers_odoo_created on chat_fichiers (odoo_id, created_at);
create index if not exists chat_fichiers_expire on chat_fichiers (expire_at);

-- Alertes déjà envoyées (budget du jour à 80 % et 100 %, pannes) : une seule par jour et par type.
create table if not exists chat_alertes (
  jour        date not null,
  type        text not null,
  created_at  timestamptz not null default now(),
  primary key (jour, type)
);

-- RLS activé, aucune policy (voir l'en-tête) ; droits retirés à anon et authenticated par précaution.
alter table chat_reglages      enable row level security;
alter table chat_conversations enable row level security;
alter table chat_tours         enable row level security;
alter table chat_demandes      enable row level security;
alter table chat_fichiers      enable row level security;
alter table chat_alertes       enable row level security;
revoke all on table chat_reglages, chat_conversations, chat_tours, chat_demandes, chat_fichiers, chat_alertes from anon, authenticated;
