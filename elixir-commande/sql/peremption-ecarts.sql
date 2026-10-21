-- ── Péremption courte, règle panier (21/10/2026) : suivi de la rectification des écarts ────────────────────────────────
-- Décision de Zineb : « par défaut le −50 s'affiche et c'est la règle panier qui s'applique ; si le travail manuel côté admin
-- n'est pas fait, on rectifiera les écarts depuis l'affichage des écarts ». Exploitation : docs/peremption.md (§ Rectifier
-- les écarts). Code : netlify/functions/_peremption.js (ecarts, ecartsResume, changerStatutEcarts : seul lecteur et seul
-- écrivain), onglet Péremptions de l'admin → Contrôle des écarts.
-- À exécuter par Zineb dans l'éditeur SQL de Supabase (SQL Editor → New query → coller → Run). Rejouable sans effet
-- (« if not exists » partout). Indépendant de sql/peremption.sql (peut être exécuté avant ou après).
--
-- Une ligne par ligne de commande du site dont le statut a été changé dans l'admin (sans ligne : « à rectifier »). Les écarts
-- eux-mêmes sont recalculés à chaque contrôle (commande du site contre ligne de vente Odoo, lecture seule) ; la ligne garde
-- les montants au moment du changement, la référence libre (n° d'avoir, correction de la commande Odoo…), qui et quand.
-- Clé : « <n° de la commande du site>:<CIP> » (« :2 » si le même CIP revient dans la commande).
--
-- Sécurité : RLS ACTIVÉ et AUCUNE policy, comme les tables peremption_* : illisible et non modifiable avec la clé anon du
-- navigateur (SUPABASE_KEY) — elle porte des noms de pharmacies et des montants. Seules les fonctions peremption*.js y
-- accèdent, avec la clé serveur SUPABASE_SERVICE_ROLE_KEY. Ne jamais ajouter de policy ni désactiver le RLS.
-- Rien ici n'écrit dans Odoo.

create table if not exists peremption_ecarts (
  cle            text primary key check (cle ~ '^[0-9]{6,16}:[0-9]{7,14}(:[0-9]{1,3})?$'),
  commande       text not null,                  -- n° de la commande du site (elixir_orders.id)
  cip            text not null,
  pharmacie      text,
  commande_odoo  text,                           -- « S351354 »
  nom            text,
  qte            numeric,                        -- boîtes prises au prix de la page (au plus la quantité de la ligne Odoo)
  prix_page      numeric,                        -- prix unitaire du panier (page Péremption courte)
  prix_facture   numeric,                        -- net unitaire facturé par Odoo
  ecart          numeric,                        -- (prix_facture − prix_page) × qte, au moment du changement de statut
  statut         text not null default 'a_rectifier' check (statut in ('a_rectifier','rectifie')),
  reference      text check (reference is null or char_length(reference) <= 120),
  par            text,                           -- e-mail de l'admin
  le             timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists peremption_ecarts_statut on peremption_ecarts (statut, le desc);
create index if not exists peremption_ecarts_commande on peremption_ecarts (commande);

alter table peremption_ecarts enable row level security;
revoke all on table peremption_ecarts from anon, authenticated;
-- Ne jamais ajouter de policy.

-- Contrôle après exécution (doit afficher « true ») :
-- select relname, relrowsecurity from pg_class where relname = 'peremption_ecarts' and relkind = 'r';
