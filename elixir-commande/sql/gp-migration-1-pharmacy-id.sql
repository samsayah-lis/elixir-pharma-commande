-- ═══════════════════════════════════════════════════════════════════
--  Commandes groupées — migration 1 (29/09/2026)
--  1. Les pharmacies sont identifiées par leur fiche client Odoo Elixir
--     (identifiant de la fiche commerciale) et non plus par leur CIP :
--     850 fiches sur 959 avaient un CIP vide ou « 0 ».
--  2. Un produit qui a des quantités commandées ne peut plus être supprimé
--     par erreur : la base refuse au lieu d'effacer les quantités en cascade
--     (la suppression d'une opération entière reste possible).
--  Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['gp_access','gp_participants','gp_orders','gp_order_lines','gp_triggers'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'pharmacy_cip')
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'pharmacy_id') then
      execute format('alter table %I rename column pharmacy_cip to pharmacy_id', t);
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gp_operations' and column_name = 'centralizer_cip') then
    alter table gp_operations rename column centralizer_cip to centralizer_id;
  end if;
end $$;

-- CIP conservé pour l'affichage
alter table gp_access       add column if not exists pharmacy_cip text;
alter table gp_participants add column if not exists pharmacy_cip text;

-- Quantités protégées : suppression d'un produit refusée tant qu'il a des quantités
alter table gp_order_lines drop constraint if exists gp_order_lines_line_id_fkey;
alter table gp_order_lines add constraint gp_order_lines_line_id_fkey
  foreign key (line_id) references gp_lines(id);

notify pgrst, 'reload schema';
