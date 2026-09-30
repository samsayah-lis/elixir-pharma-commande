-- ═══════════════════════════════════════════════════════════════════
--  Commandes groupées — migration 3 (30/09/2026)
--  Colisage par produit : pack_size = unités par colis ;
--  pack_rule : aucune (indicatif) | minimum (au moins 1 colis) | multiple (colis entiers).
--  Règle vérifiée à chaque livraison, sur la quantité saisie (unités facturées).
--  Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════════
alter table gp_lines add column if not exists pack_size integer check (pack_size is null or pack_size between 1 and 100000);
alter table gp_lines add column if not exists pack_rule text not null default 'aucune' check (pack_rule in ('aucune', 'minimum', 'multiple'));

notify pgrst, 'reload schema';
