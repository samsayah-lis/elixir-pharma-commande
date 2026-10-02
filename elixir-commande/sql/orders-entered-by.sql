-- ═══════════════════════════════════════════════════════════════════
--  Commandes du site — saisie par Elixir pour une pharmacie (02/10/2026)
--  entered_by = e-mail de l'admin qui a passé la commande à la place de la pharmacie
--  (pharmacie sans accès, commande par téléphone…). Vide = commande passée par la pharmacie.
--  Idempotent. Sans cette colonne, le site fonctionne : la mention n'est simplement pas gardée.
-- ═══════════════════════════════════════════════════════════════════
alter table elixir_orders add column if not exists entered_by text;

notify pgrst, 'reload schema';
