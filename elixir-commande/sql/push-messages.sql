-- ── Notifications de l'appli Elixir : messages unitaires et collectifs (types, modèles, programmation, e-mail de secours,
-- API de l'outil entrepôt) ──────────────────────────────────────────────────────────────────────────────────────────────
-- Documentation : docs/notifications.md (§ 3 et § 10). À exécuter par Zineb dans l'éditeur SQL de Supabase, APRÈS
-- sql/push-schema.sql et juste AVANT la mise en ligne de la branche notifications-messages (puis, juste après la mise en
-- ligne, sql/push-messages-apres.sql). Déjà passé dans une version précédente : le relancer, il complète sans rien défaire.
-- Rejouable sans effet (IF NOT EXISTS, contraintes supprimées puis recréées à l'identique, migration des catégories notée
-- dans push_migrations et faite une seule fois). Compatible avec le code déjà en ligne : il ne fait qu'ajouter.
--
-- Sécurité : comme sql/push-schema.sql, RLS ACTIVÉ et AUCUNE policy sur les nouvelles tables ; droits retirés à anon et
-- authenticated. Seules les fonctions push-*.js y accèdent, avec la clé serveur SUPABASE_SERVICE_ROLE_KEY. Ne jamais
-- ajouter de policy ni désactiver le RLS ici. Aucune donnée patient, aucun montant, aucune adresse e-mail stockée ici.

-- ── 1. Nouvelle catégorie « Informations Elixir » (infos) ──
-- Envois par pharmacie : la catégorie « infos » est admise (plafond des informations, historique de la pharmacie)
alter table push_envois drop constraint if exists push_envois_categorie_check;
alter table push_envois add constraint push_envois_categorie_check check (categorie in ('stock', 'commandes', 'infos', 'offres'));
-- Historique d'une pharmacie : titre et type du message, source (message de l'admin, retour en stock, outil entrepôt),
-- e-mail de secours (jamais l'adresse : le résultat seulement)
alter table push_envois add column if not exists titre  text;
alter table push_envois add column if not exists type   text;
alter table push_envois add column if not exists source text;
alter table push_envois add column if not exists email  text;
alter table push_envois drop constraint if exists push_envois_titre_check;
alter table push_envois add constraint push_envois_titre_check check (titre is null or char_length(titre) <= 80);
-- « envoye » compte dans les plafonds de la pharmacie (comme une notification jointe) : l'e-mail de secours ne les contourne pas
alter table push_envois drop constraint if exists push_envois_email_check;
alter table push_envois add constraint push_envois_email_check check (email is null or email in ('envoye', 'echec', 'aucune_adresse'));
create index if not exists push_envois_pharmacie on push_envois (pharmacy_cip, created_at desc);

-- Nouvel abonnement : toutes les catégories (le site les envoie toujours, valeur par défaut gardée cohérente)
alter table push_abonnements alter column categories set default array['stock', 'commandes', 'infos', 'offres']::text[];

-- Appareils DÉJÀ abonnés : « Informations Elixir » activée si l'appareil reçoit encore « Offres et nouveautés » ; laissée
-- coupée s'il les a coupées (la pharmacie qui a refusé les messages non indispensables ne reçoit rien de nouveau sans le
-- choisir ; elle peut l'activer dans « Notifications »). Une seule fois : une pharmacie qui coupe ensuite « Informations
-- Elixir » ne la voit jamais revenir si le script est relancé.
create table if not exists push_migrations (
  nom      text primary key,
  fait_le  timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from push_migrations where nom = 'categorie_infos_2026_10') then
    update push_abonnements
       set categories = array_append(categories, 'infos'), updated_at = now()
     where role = 'pharmacie' and 'offres' = any (categories) and not ('infos' = any (categories));
    insert into push_migrations (nom) values ('categorie_infos_2026_10');
  end if;
end $$;

-- ── 2. Messages de l'admin (table push_annonces, historique de l'onglet 📲 Notifications) ──
-- Les annonces d'avant restent des « promotion » envoyées à « Offres et nouveautés » (valeurs par défaut).
alter table push_annonces add column if not exists type             text not null default 'promotion';
alter table push_annonces add column if not exists categorie        text not null default 'offres';
alter table push_annonces add column if not exists repli_email      boolean not null default false;   -- e-mail de secours (message unitaire)
alter table push_annonces add column if not exists programme_pour   timestamptz;                      -- programmation (heure exacte, UTC)
alter table push_annonces add column if not exists annule_at        timestamptz;
alter table push_annonces add column if not exists annule_par       text;                             -- e-mail de l'admin qui a annulé
alter table push_annonces add column if not exists destinataire_nom text;                             -- message unitaire : nom de la pharmacie
alter table push_annonces add column if not exists email_statut     text;                             -- e-mail de secours : résultat
alter table push_annonces add column if not exists nb_emails        int;                              -- adresses jointes par e-mail
alter table push_annonces add column if not exists source           text not null default 'admin';
alter table push_annonces add column if not exists en_file_le       timestamptz;                      -- passage en file (programmé : à l'heure prévue)
alter table push_annonces add column if not exists idem_empreinte   text;                             -- empreinte du contenu (clé idem réutilisée : refusée)

alter table push_annonces drop constraint if exists push_annonces_type_check;
alter table push_annonces add constraint push_annonces_type_check check (type in ('promotion', 'communication', 'reclamation', 'commande'));
alter table push_annonces drop constraint if exists push_annonces_categorie_check;
alter table push_annonces add constraint push_annonces_categorie_check check (categorie in ('offres', 'infos', 'commandes'));
-- « une » : message unitaire (une pharmacie) ; « liste » : plusieurs ; « toutes » : toutes les pharmacies abonnées
alter table push_annonces drop constraint if exists push_annonces_audience_check;
alter table push_annonces add constraint push_annonces_audience_check check (audience in ('une', 'liste', 'toutes'));
-- « programmee » (en attente de son heure, annulable), « annulee » ; les autres comme avant
alter table push_annonces drop constraint if exists push_annonces_statut_check;
alter table push_annonces add constraint push_annonces_statut_check
  check (statut in ('programmee', 'en_file', 'en_cours', 'envoyee', 'erreur', 'annulee'));
-- e-mail de secours : « non_requis » (pharmacie jointe sur un téléphone), « plafond » (plafond atteint), « alerte_coupee »
-- (Communication : alerte coupée par la pharmacie) — rien n'est parti dans ces trois cas
alter table push_annonces drop constraint if exists push_annonces_email_statut_check;
alter table push_annonces add constraint push_annonces_email_statut_check
  check (email_statut is null or email_statut in ('envoye', 'echec', 'aucune_adresse', 'non_requis', 'plafond', 'alerte_coupee'));
-- « Réclamation / SAV » et « Commande » : une ou quelques pharmacies choisies, jamais toutes ; « Réclamation / SAV » : une seule
alter table push_annonces drop constraint if exists push_annonces_transactionnel_check;
alter table push_annonces add constraint push_annonces_transactionnel_check check (categorie <> 'commandes' or audience <> 'toutes');
alter table push_annonces drop constraint if exists push_annonces_reclamation_check;
alter table push_annonces add constraint push_annonces_reclamation_check check (type <> 'reclamation' or audience = 'une');
-- e-mail de secours jamais pour une Promotion (prospection par e-mail : aucun moyen d'opposition dans l'e-mail)
alter table push_annonces drop constraint if exists push_annonces_repli_promotion_check;
alter table push_annonces add constraint push_annonces_repli_promotion_check check (not (repli_email and type = 'promotion'));
alter table push_annonces drop constraint if exists push_annonces_programme_check;
alter table push_annonces add constraint push_annonces_programme_check check (statut <> 'programmee' or programme_pour is not null);

create index if not exists push_annonces_programmees on push_annonces (programme_pour) where statut = 'programmee';
-- Une seule diffusion PLAFONNÉE à la fois (offres, informations : deux diffusions simultanées liraient le même plafond).
-- Les messages « commandes » (transactionnels, quelques pharmacies) ne bloquent jamais et ne sont jamais bloqués.
drop index if exists push_annonces_une_en_cours;
create unique index push_annonces_une_en_cours on push_annonces ((true)) where statut = 'en_cours' and categorie in ('offres', 'infos');

-- ── 3. Modèles enregistrés par l'admin (« Enregistrer comme modèle ») ──
create table if not exists push_modeles (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null check (char_length(nom) between 1 and 40),
  type         text not null check (type in ('promotion', 'communication', 'reclamation', 'commande')),
  titre        text not null check (char_length(titre) between 1 and 60),
  corps        text not null check (char_length(corps) between 1 and 160),
  url          text not null default '/' check (char_length(url) <= 200),   -- chemin du site seulement (lienValide)
  admin_email  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists push_modeles_nom on push_modeles (lower(nom));

-- ── 4. Événements de l'outil entrepôt (push-evenement.js) ; purgés après 90 jours (push-menage) ──
-- cle : en-tête Idempotency-Key (même clé = même réponse, rien n'est renvoyé) ; empreinte : pharmacie, type, référence,
-- statut et tranche de 10 minutes (un double envoi de l'outil entrepôt sous une autre clé n'est notifié qu'une fois ; le même
-- statut plus tard, si). resultat « differe » : reçu le soir, la nuit ou le dimanche, envoyé à a_envoyer_le (texte, lien et
-- étiquette gardés : corps, url, etiquette) ; « envoi » : différé en cours d'envoi.
create table if not exists push_evenements (
  cle           text primary key check (char_length(cle) between 8 and 128),
  empreinte     text not null unique check (char_length(empreinte) = 64),
  pharmacy_cip  text not null,
  type          text not null check (type in ('reclamation', 'ticket', 'commande')),
  statut        text not null check (char_length(statut) between 1 and 30),
  reference     text check (char_length(reference) <= 40),
  titre         text check (char_length(titre) <= 60),
  recu_le       timestamptz not null default now(),
  traite_le     timestamptz,
  resultat      text check (char_length(resultat) <= 30),   -- « envoye », « aucun_appareil », « fermee », « plafond »…
  nb_appareils  int,
  nb_reussis    int
);
create index if not exists push_evenements_recu on push_evenements (recu_le desc);
alter table push_evenements add column if not exists corps        text check (char_length(corps) <= 160);
alter table push_evenements add column if not exists url          text check (char_length(url) <= 200);
alter table push_evenements add column if not exists etiquette    text check (char_length(etiquette) <= 64);
alter table push_evenements add column if not exists a_envoyer_le timestamptz;
create index if not exists push_evenements_differes on push_evenements (a_envoyer_le) where resultat = 'differe';
create index if not exists push_evenements_pharmacie on push_evenements (pharmacy_cip);

-- ── RLS activé, aucune policy (voir l'en-tête) ; droits retirés à anon et authenticated par précaution ──
alter table push_modeles    enable row level security;
alter table push_evenements enable row level security;
alter table push_migrations enable row level security;
revoke all on table push_modeles, push_evenements, push_migrations from anon, authenticated;
