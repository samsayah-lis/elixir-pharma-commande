-- ═══════════════════════════════════════════════════════════════════
--  Centrale OTC : laboratoire de chaque produit (16/10/2026, docs/labo-otc.md)
--  labo = fabricant Medipim (« Renseigner les laboratoires manquants » de l'admin) ou saisie de l'admin ;
--  sert au tri et au filtre par laboratoire du site. Vide = non renseigné.
--  Idempotent. Sans cette colonne, le site fonctionne : tri et filtre ne s'affichent pas, le champ
--  Laboratoire de l'admin est désactivé.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.elixir_products ADD COLUMN IF NOT EXISTS labo TEXT;

notify pgrst, 'reload schema';
