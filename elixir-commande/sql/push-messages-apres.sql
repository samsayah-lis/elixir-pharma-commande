-- ── Notifications de l'appli Elixir : rattrapage de la catégorie « Informations Elixir », JUSTE APRÈS la mise en ligne ──
-- Documentation : docs/notifications.md § 3 d. À exécuter par Zineb dans l'éditeur SQL de Supabase, une fois Netlify sur
-- « Published » pour la branche notifications-messages (jamais avant : il serait sans objet).
-- Pourquoi : sql/push-messages.sql active « Informations Elixir » sur les appareils qui reçoivent les offres, AVANT la mise
-- en ligne. Entre ce passage et la fin du déploiement, la version d'avant tourne encore : elle ne connaît pas « infos », la
-- retire d'un appareil dont la pharmacie touche un interrupteur, et une activation faite à ce moment-là n'en a pas. Ce
-- script la rend à ces appareils seulement (modifiés depuis le passage de push-messages.sql, qui reçoivent encore les offres).
-- Une seule fois (noté dans push_migrations) : relancé, il ne fait rien ; il ne réactive jamais une alerte coupée ensuite.
-- 1. Contrôle (lecture seule) : appareils concernés
select count(*) as appareils_a_rattraper
  from push_abonnements
 where role = 'pharmacie' and 'offres' = any (categories) and not ('infos' = any (categories))
   and updated_at >= (select fait_le from push_migrations where nom = 'categorie_infos_2026_10');
-- 2. Rattrapage, une seule fois
do $$
begin
  if exists (select 1 from push_migrations where nom = 'categorie_infos_2026_10')
     and not exists (select 1 from push_migrations where nom = 'categorie_infos_2026_10_apres') then
    update push_abonnements
       set categories = array_append(categories, 'infos'), updated_at = now()
     where role = 'pharmacie' and 'offres' = any (categories) and not ('infos' = any (categories))
       and updated_at >= (select fait_le from push_migrations where nom = 'categorie_infos_2026_10');
    insert into push_migrations (nom) values ('categorie_infos_2026_10_apres');
  end if;
end $$;
