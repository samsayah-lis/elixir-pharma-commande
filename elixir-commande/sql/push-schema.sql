-- ── Notifications de l'appli Elixir (Web Push) : abonnements, réglages, annonces, envois ──────────────────────
-- Documentation : docs/notifications.md (mise en service, étape c). À exécuter par Zineb dans l'éditeur SQL de Supabase.
-- Rejouable sans effet (IF NOT EXISTS partout, ON CONFLICT DO NOTHING).
--
-- Sécurité : RLS ACTIVÉ et AUCUNE policy (comme sql/chat-schema.sql, et dans la ligne du plan de fermeture de Supabase :
-- aucune nouvelle table ouverte à anon). Ces tables sont donc illisibles et non modifiables avec la clé anon (SUPABASE_KEY,
-- présente dans le navigateur) : un abonnement Web Push (endpoint + clés) permettrait d'envoyer des notifications au
-- téléphone d'une pharmacie avec la clé privée VAPID. Seules les fonctions push-*.js y accèdent, avec la clé serveur
-- SUPABASE_SERVICE_ROLE_KEY (déjà en place pour l'Assistant Elixir). Ne jamais ajouter de policy ni désactiver le RLS ici.
-- Aucune donnée patient ; libellé d'appareil sans user-agent. Conservation (push-menage, chaque nuit) : envois 90 jours ;
-- appareil supprimé sans ouverture du site depuis 12 mois, ou dès que l'e-mail du compte n'est plus rattaché à la pharmacie.

-- Un appareil (navigateur ou appli installée) abonné : une pharmacie (CIP du jeton) ou un admin (tests et aperçus)
create table if not exists push_abonnements (
  id               uuid primary key default gen_random_uuid(),
  endpoint         text not null unique check (char_length(endpoint) <= 1024),   -- adresse du service push (Google, Apple, Mozilla, Microsoft)
  p256dh           text not null check (char_length(p256dh) <= 100),
  auth             text not null check (char_length(auth) <= 40),               -- secret de l'abonnement (preuve à la déconnexion)
  role             text not null default 'pharmacie' check (role in ('pharmacie', 'admin')),
  pharmacy_cip     text,                    -- pharmacie : CIP du JETON (auth.js) ; admin : null
  pharmacie_nom    text,                    -- elixir_pharmacies.name au moment de l'abonnement (affichage de l'admin)
  compte_email     text not null,           -- e-mail vérifié du jeton (pharmacie ou admin)
  categories       text[] not null default array['stock','commandes','offres']::text[],
  appareil         text,                    -- libellé seulement (« iPhone · application »), jamais le user-agent
  plateforme       text check (plateforme in ('ios', 'android', 'ordinateur', 'autre')),
  installe         boolean not null default false,   -- ouvert en application (écran d'accueil)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_seen_at     timestamptz,             -- dernière ouverture du site (au plus une écriture par 12 h)
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  failures         int not null default 0,  -- échecs d'envoi consécutifs (remis à 0 au premier succès)
  last_error       text,                    -- « HTTP 429 », « délai dépassé »… (jamais de contenu)
  constraint push_abonnements_identite check (role = 'admin' or pharmacy_cip is not null)
);
create index if not exists push_abonnements_cip   on push_abonnements (pharmacy_cip) where role = 'pharmacie';
create index if not exists push_abonnements_admin on push_abonnements (compte_email) where role = 'admin';

-- Réglages (une seule ligne, id = 1, JSON en texte) : { ouverture: "fermee" | "pilote" | "toutes", pilote_cips: [], plafond_offres_7j: 2 }
-- Ligne créée vide : ouverture « fermee » par défaut (admins seulement) tant que Zineb ne l'ouvre pas dans l'admin.
create table if not exists push_reglages (
  id          int primary key default 1 check (id = 1),
  valeur      text not null default '{}',
  updated_at  timestamptz not null default now()
);
insert into push_reglages (id) values (1) on conflict (id) do nothing;

-- Annonces « Offres et nouveautés » de l'admin (historique de l'onglet 📲 Notifications)
create table if not exists push_annonces (
  id             uuid primary key default gen_random_uuid(),
  idem           text unique,             -- clé d'idempotence du navigateur (double clic, réponse perdue : une seule annonce)
  titre          text not null check (char_length(titre) between 1 and 60),
  corps          text not null check (char_length(corps) between 1 and 160),
  url            text not null check (char_length(url) <= 200),     -- chemin du site seulement (lienValide)
  audience       text not null check (audience in ('toutes', 'liste')),
  cips           text[],                                            -- audience « liste »
  admin_email    text not null,
  statut         text not null default 'en_file' check (statut in ('en_file', 'en_cours', 'envoyee', 'erreur')),
  erreur         text,
  nb_visees      int,   -- pharmacies abonnées aux offres dans l'audience
  nb_plafonnees  int,   -- écartées par le plafond (déjà assez d'offres ces 7 jours)
  nb_pharmacies  int,   -- pharmacies servies (au moins un appareil joint)
  nb_appareils   int, nb_reussis int, nb_echecs int, nb_retires int,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index if not exists push_annonces_created on push_annonces (created_at desc);
-- Une seule annonce en cours de diffusion à la fois : deux diffusions simultanées liraient le même plafond des offres.
-- La seconde reste « en_file » (bouton « Relancer » de l'admin) ; une annonce bloquée « en_cours » (fonction coupée) est
-- libérée après 20 minutes.
create unique index if not exists push_annonces_une_en_cours on push_annonces ((true)) where statut = 'en_cours';

-- Envois par pharmacie (plafond des offres, traçabilité des envois automatiques) ; purgés après 90 jours
create table if not exists push_envois (
  id            bigint generated always as identity primary key,
  categorie     text not null check (categorie in ('stock', 'commandes', 'offres')),
  pharmacy_cip  text not null,
  annonce_id    uuid references push_annonces (id) on delete set null,
  tag           text,
  nb_appareils  int not null default 0,
  nb_reussis    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists push_envois_plafond on push_envois (categorie, created_at, pharmacy_cip);
create index if not exists push_envois_tag     on push_envois (pharmacy_cip, tag);

-- Services push refusés (hôte seulement, jamais l'adresse complète qui contient le jeton de l'appareil) : un navigateur a
-- proposé une adresse hors de la liste admise (regles.js, HOTES_PUSH). Affiché dans l'admin (État du service) pour élargir
-- la liste à bon escient ; purgé après 90 jours.
create table if not exists push_hotes_refuses (
  hote   text primary key check (char_length(hote) <= 100),
  vu_le  timestamptz not null default now()
);

-- RLS activé, aucune policy (voir l'en-tête) ; droits retirés à anon et authenticated par précaution.
alter table push_abonnements   enable row level security;
alter table push_reglages      enable row level security;
alter table push_annonces      enable row level security;
alter table push_envois        enable row level security;
alter table push_hotes_refuses enable row level security;
revoke all on table push_abonnements, push_reglages, push_annonces, push_envois, push_hotes_refuses from anon, authenticated;
revoke all on sequence push_envois_id_seq from anon, authenticated;
