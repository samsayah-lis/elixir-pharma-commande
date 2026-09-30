-- ═══════════════════════════════════════════════════════════════════
--  Commandes groupées — migration 2 (30/09/2026)
--  Remises 2 et 3 par produit : [{ mode, pct, tiers, combine }]
--  (mode : aucune | unitaire | paliers ; combine : cascade | additionnelle).
--  La remise 1 reste dans discount_mode / discount_pct / discount_tiers.
--  Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════════
alter table gp_lines add column if not exists extra_discounts jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
