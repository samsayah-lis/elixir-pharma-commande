-- ── Péremption courte, « Odoo facture la remise » (V1) : tables du serveur ─────────────────────────────────────────
-- Exploitation : docs/peremption-odoo.md. Code : netlify/functions/_peremption.js (seul lecteur et seul écrivain).
-- À exécuter par Zineb dans l'éditeur SQL de Supabase (SQL Editor → New query → coller → Run). Rejouable sans effet
-- (« if not exists » partout, « or replace » pour la fonction du journal).
--
-- Sécurité : RLS ACTIVÉ et AUCUNE policy, comme les tables de l'assistant (sql/chat-schema.sql). Ces tables sont
-- illisibles et non modifiables avec la clé anon du navigateur (SUPABASE_KEY) : elles portent le coût d'achat, la marge
-- et les identifiants des règles de prix posées dans Odoo. Seules les fonctions peremption*.js y accèdent, avec la clé
-- serveur SUPABASE_SERVICE_ROLE_KEY (déjà utilisée par l'assistant). Ne jamais ajouter de policy ni désactiver le RLS.
--
-- Rien ici n'écrit dans Odoo. La fonction est livrée en mode « simulation » (ligne de réglages créée avec mode =
-- 'simulation') : aucune écriture Odoo tant que la variable Netlify PEREMPTION_ODOO_ECRITURE=1 n'existe pas ET que
-- l'admin n'a pas choisi le mode « Actif ».

-- Réglages (une seule ligne, id = 1). Propositions de la conception en attendant les réponses de Zineb (§ 16.3) :
-- modifiables dans l'admin (onglet Péremptions → Réglages) sans toucher au code.
create table if not exists peremption_reglages (
  id                          int primary key default 1 check (id = 1),
  mode                        text not null default 'simulation' check (mode in ('simulation','actif','creations_suspendues')),
  listes                      int[] not null default '{5,15,1110,1112,1114,25}',   -- jamais la 4 (Export), toujours la 5
  base_remise                 text not null default 'prix_base' check (base_remise in ('prix_base','prix_liste5')),
  remise_auto_pct             int check (remise_auto_pct is null or remise_auto_pct between 1 and 90),  -- null : aucune remise automatique
  remise_max_pct              int not null default 90 check (remise_max_pct between 1 and 90),
  sous_cout                   text not null default 'confirmation' check (sous_cout in ('confirmation','interdit')),
  perte_max_produit           numeric(12,2),                     -- null : pas de plafond de perte par produit
  budget_perte_mensuel        numeric(12,2),                     -- null : pas de budget mensuel de perte
  lot_long_recu               text not null default 'retrait' check (lot_long_recu in ('retrait','maintien')),
  ventes_lgo_max              int,                               -- null : remise aussi pour les produits vendus par LGO
  plafond_produits_par_lot    int not null default 40,           -- 240 règles
  plafond_produits_factures   int not null default 120,          -- 720 règles au plus en même temps
  plafond_regles_par_passage  int not null default 60,           -- compléments faits par la nuit ou le filet
  seuil_annonce_pct           numeric(5,2) not null default 5,  -- économie minimale vs prix habituel pour annoncer une remise
  delai_retrait_min           int not null default 120,          -- entre « caché sur le site » et la suppression dans Odoo
  disjoncteur_sortie_pct      int not null default 30,           -- sorties pour cause de stock mises en attente au-delà
  filet_dates_odoo            text not null default 'a_prouver' check (filet_dates_odoo in ('a_prouver','oui','non')),  -- essai T1
  droits                      jsonb,                             -- dernier contrôle « Droits Odoo » (T0)
  verrou_jusqua               timestamptz,                       -- un seul appel à la fois (écriture conditionnelle)
  verrou_passage              uuid,                              -- passage de l'appel qui tient le verrou (affichage)
  verrou_appel                uuid,                              -- jeton de l'appel : seul lui prolonge ou rend le verrou
  updated_at                  timestamptz not null default now(),
  updated_by                  text
);
insert into peremption_reglages (id) values (1) on conflict (id) do nothing;

-- Faits frais lus dans Odoo, une ligne par CIP de la page ou d'une décision ouverte (réécrite à chaque passage)
create table if not exists peremption_faits (
  cip           text primary key,
  odoo_pid      int not null,
  odoo_tmpl_id  int not null,
  nom           text,
  lu_at         timestamptz not null,
  list_price    numeric(12,2),
  cout          numeric(12,4),                 -- standard_price société 2 (« PFHT »)
  court_qte     int not null,                  -- stock libre des lots qui périment d'aujourd'hui à la fin de la fenêtre
  court_fin     date,                          -- lot le plus proche de ce stock
  long_qte      int not null,                  -- stock libre au-delà de la fenêtre
  long_debut    date,
  autre_qte     int not null,                  -- sans lot ou lot sans date (stock libre)
  prix_listes   jsonb,                         -- {"5": 9.76, "15": 9.76, …} rapport Odoo, qté 1
  ventes_30j    jsonb,                         -- {"lgo": 26, "site": 7, "autre": 0}
  exclusions    text[] not null default '{}'   -- multi_cip, menu_promo, campagne, justificatif, sanofipro, variantes
);

-- Décisions de l'admin : une par produit et par épisode (un lot court) ; un seul épisode ouvert par CIP
create table if not exists peremption_decisions (
  id                  uuid primary key default gen_random_uuid(),
  cip                 text not null,
  odoo_pid            int not null,
  odoo_tmpl_id        int not null,
  nom                 text,
  remise_pct          int not null check (remise_pct between 1 and 90),
  percent_price       numeric(9,4) not null,       -- valeur posée dans Odoo (= remise_pct si la base est le prix de base)
  lot_court_fin       date not null,
  date_fin_regle      timestamptz not null,
  force_lot_long      boolean not null default false,
  long_qte_accepte    int,
  sous_cout_confirme  boolean not null default false,
  simulee             boolean not null default false,   -- décidée en simulation : aucune règle dans Odoo
  prix_base           numeric(12,2) not null,
  prix_habituel       jsonb not null,               -- par liste, figés à la décision (accueil, page, aperçu)
  prix_attendu        jsonb not null,
  cout                numeric(12,4),
  apercu              jsonb,                        -- empreinte et chiffres de l'aperçu confirmé (pertes, stock, effet LGO, base)
  modification        jsonb,                        -- nouvelle remise en cours : { remise, percent_price, prix_attendu, sous_cout,
                                                    --   demandee_at, baisse (attend le délai et les commandes), ecriture_at }
  statut              text not null check (statut in ('voulue','partielle','facturee','retrait_demande','retiree','erreur','modifiee_odoo')),
  raison_fin          text,                         -- remise_retiree, sortie_date, court_epuise, lot_long_recu, tout_retirer, …
  retrait_immediat    boolean not null default false,
  decide_par          text not null,
  decide_at           timestamptz not null default now(),
  facturee_at         timestamptz,
  cachee_at           timestamptz,
  retiree_at          timestamptz,
  essais              int not null default 0,
  erreur              text,
  updated_at          timestamptz not null default now()
);
create unique index if not exists peremption_decisions_ouverte on peremption_decisions (cip)
  where statut in ('voulue','partielle','facturee','retrait_demande','erreur','modifiee_odoo');

-- Règles Odoo du site : une par décision et par liste. Le site ne touche jamais une règle absente de cette table.
create table if not exists peremption_regles (
  id             uuid primary key default gen_random_uuid(),
  decision_id    uuid not null references peremption_decisions (id),
  cip            text not null,
  pricelist_id   int not null check (pricelist_id <> 4),
  odoo_tmpl_id   int not null,
  odoo_item_id   int,                                  -- null tant que la création n'est pas enregistrée
  operation_id   uuid not null,
  date_start     timestamptz not null,                 -- repère exact posé dans Odoo (identique sur les listes d'une opération)
  percent_price  numeric(9,4) not null,
  date_end       timestamptz not null,
  statut         text not null check (statut in ('reservee','active','a_retirer','retiree','echec','modifiee_odoo')),
  verifiee_at    timestamptz,
  prix_verifie   numeric(12,2),
  instantane     jsonb,                                -- tous les champs relus (pour recréer à l'identique)
  cible          jsonb,                                -- écriture du site en cours ({ percent_price | date_end, at }), posée AVANT
                                                       -- l'écriture Odoo : la relecture la finalise ou l'abandonne
  created_at     timestamptz not null default now(),
  retiree_at     timestamptz,
  erreur         text
);
create unique index if not exists peremption_regles_une on peremption_regles (cip, pricelist_id)
  where statut in ('reservee','active','a_retirer','modifiee_odoo');
create unique index if not exists peremption_regles_odoo on peremption_regles (odoo_item_id) where odoo_item_id is not null;

-- Journal (ajout seul : modification et suppression refusées par un déclencheur, même avec la clé service_role)
create table if not exists peremption_journal (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  passage_id    uuid,
  acteur        text not null,                 -- e-mail de l'admin, « nuit », « filet » ou « automatique »
  mode          text not null,
  action        text not null,                 -- decision, apercu, creer, relire, controler, modifier, cacher, prix_site, retirer, adopter, alerte, mode, reglages, refus
  cip           text,
  pricelist_id  int,
  odoo_item_id  int,
  avant         jsonb,
  apres         jsonb,
  resultat      text not null,                 -- ok, simule, echec, reporte, ignore
  message       text
);
create index if not exists peremption_journal_cip on peremption_journal (cip, at desc);
create index if not exists peremption_journal_action on peremption_journal (action, at desc);
create or replace function peremption_journal_ajout_seul() returns trigger language plpgsql as $$
begin
  raise exception 'peremption_journal : ajout seul (ni modification ni suppression)';
end $$;
drop trigger if exists peremption_journal_ajout_seul on peremption_journal;
create trigger peremption_journal_ajout_seul before update or delete on peremption_journal
  for each row execute function peremption_journal_ajout_seul();

-- Passages (admin pas à pas, nuit, filet horaire)
create table if not exists peremption_passages (
  id        uuid primary key default gen_random_uuid(),
  acteur    text not null,
  mode      text not null,
  debut     timestamptz not null default now(),
  fin       timestamptz,
  statut    text,                              -- en_cours, fini, erreur, verrou
  plan      jsonb,
  resume    jsonb,
  erreurs   jsonb,
  curseur   int not null default 0
);
create index if not exists peremption_passages_debut on peremption_passages (debut desc);

-- Colonnes ajoutées par la revue de la V1 (21/10/2026) : sans effet si le script a déjà été exécuté avec elles
alter table peremption_reglages  add column if not exists verrou_appel uuid;
alter table peremption_decisions add column if not exists modification jsonb;
alter table peremption_regles    add column if not exists cible jsonb;

alter table peremption_reglages  enable row level security;
alter table peremption_faits     enable row level security;
alter table peremption_decisions enable row level security;
alter table peremption_regles    enable row level security;
alter table peremption_journal   enable row level security;
alter table peremption_passages  enable row level security;
-- Ne jamais ajouter de policy.

-- Contrôle après exécution (doit afficher 6 lignes « true » et le mode « simulation ») :
-- select relname, relrowsecurity from pg_class where relname like 'peremption\_%' and relkind = 'r';
-- select mode, listes from peremption_reglages;
