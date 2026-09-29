-- ═══════════════════════════════════════════════════════════════════
--  Commandes groupées — schéma Supabase (à exécuter une fois dans le SQL Editor)
--  Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════════

-- Opérations de commande groupée
create table if not exists gp_operations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  supplier_name    text,
  supplier_odoo_id integer,
  status           text not null default 'brouillon',   -- brouillon | ouverte | cloturee | commandee | terminee | annulee
  start_date       date,
  end_date         date,
  tier_mode        text not null default 'collectif',   -- collectif (paliers sur le total du groupe) | individuel
  fee_pct          numeric not null default 2,          -- frais de traitement Elixir (%)
  centralizer_type text not null default 'elixir',      -- elixir | pharmacie
  centralizer_cip  text,
  centralizer_name text,
  objective_type   text not null default 'aucun',       -- aucun | unites | montant_brut | montant_net
  objective_value  numeric,
  delivery_slots   jsonb not null default '[]'::jsonb,  -- [{id, date, label}] : cadencement des livraisons
  rfa_pct          numeric not null default 0,          -- remise de fin d'année (%)
  coop_mode        text not null default 'aucune',      -- aucune | par_pharmacie | total
  coop_amount      numeric not null default 0,          -- € (par pharmacie ou total selon coop_mode)
  coop_label       text,
  conditions_text  text,                                -- conditions commerciales en clair
  notes            text,
  po_odoo_id       integer,                             -- bon de commande au labo (Odoo)
  po_created_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Produits d'une opération
create table if not exists gp_lines (
  id              uuid primary key default gen_random_uuid(),
  operation_id    uuid not null references gp_operations(id) on delete cascade,
  position        integer not null default 0,
  cip             text not null,
  name            text not null,
  odoo_product_id integer,
  price_gross     numeric not null default 0,           -- prix brut unitaire HT de l'offre
  discount_mode   text not null default 'aucune',       -- aucune | unitaire | paliers
  discount_pct    numeric not null default 0,
  discount_tiers  jsonb not null default '[]'::jsonb,   -- [{min_qty, pct}]
  ug_tiers        jsonb not null default '[]'::jsonb,   -- [{min_qty (facturées), free_qty}]
  weight          numeric not null default 1,           -- 2 = compte double dans l'objectif en unités
  vat_rate        numeric,
  notes           text
);
create index if not exists gp_lines_op on gp_lines(operation_id);

-- Pharmacies autorisées à voir l'onglet « Commandes groupées »
create table if not exists gp_access (
  pharmacy_cip  text primary key,
  pharmacy_name text,
  email         text,
  created_at    timestamptz not null default now()
);

-- Pharmacies participant à une opération
create table if not exists gp_participants (
  operation_id  uuid not null references gp_operations(id) on delete cascade,
  pharmacy_cip  text not null,
  pharmacy_name text,
  email         text,
  fee_pct       numeric,                                -- frais spécifiques (sinon ceux de l'opération)
  primary key (operation_id, pharmacy_cip)
);

-- Commande d'une pharmacie pour une opération (en-tête)
create table if not exists gp_orders (
  operation_id  uuid not null references gp_operations(id) on delete cascade,
  pharmacy_cip  text not null,
  pharmacy_name text,
  email         text,
  status        text not null default 'brouillon',      -- brouillon | confirmee
  source        text,                                   -- formulaire | fichier
  file_name     text,
  confirmed_at  timestamptz,
  email_sent_at timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (operation_id, pharmacy_cip)
);

-- Quantités : une ligne par produit × date de livraison (slot_id = 'immediat' ou id de la date)
create table if not exists gp_order_lines (
  operation_id uuid not null references gp_operations(id) on delete cascade,
  pharmacy_cip text not null,
  line_id      uuid not null references gp_lines(id) on delete cascade,
  slot_id      text not null,
  qty          integer not null default 0,
  primary key (operation_id, pharmacy_cip, line_id, slot_id)
);
create index if not exists gp_order_lines_op on gp_order_lines(operation_id);

-- Commandes clients créées dans Odoo au déclenchement (une par pharmacie et par date)
create table if not exists gp_triggers (
  operation_id       uuid not null references gp_operations(id) on delete cascade,
  slot_id            text not null,
  pharmacy_cip       text not null,
  odoo_sale_order_id integer,
  created_at         timestamptz not null default now(),
  primary key (operation_id, slot_id, pharmacy_cip)
);

-- Accès : comme les autres tables du site, ces tables ne sont lues et écrites que
-- par les fonctions Netlify (clé serveur, jamais publiée dans le navigateur).
-- On l'écrit explicitement pour que le script marche quel que soit le réglage
-- « RLS automatique sur les nouvelles tables » du projet Supabase.
do $$
declare t text;
begin
  foreach t in array array['gp_operations','gp_lines','gp_access','gp_participants','gp_orders','gp_order_lines','gp_triggers'] loop
    execute format('alter table %I disable row level security', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated, service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
