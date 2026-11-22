-- À exécuter par l'administratrice dans l'éditeur SQL de Supabase.
-- Lot 1, docs/crm-conception.md. Rejouable. Aucune donnée métier préchargée.
-- RLS sans politique ; accès exclusivement par SUPABASE_SERVICE_ROLE_KEY.
-- L'audit par déclencheur appartient à la transaction de l'écriture PostgREST.
begin;
create table if not exists public.crm_comptes (
  id uuid primary key default gen_random_uuid(),
  odoo_id bigint check (odoo_id > 0), finess text check (finess ~ '^\d{9}$'),
  siret text check (siret ~ '^\d{14}$'), cip text check (cip ~ '^\d{7,13}$'),
  nom text not null check (length(trim(nom)) > 0), adresse text, code_postal text check (code_postal ~ '^\d{5}$'),
  ville text, departement text, telephone text, email text,
  statut text not null default 'prospect' check (statut in ('prospect', 'client', 'ancien_client', 'hors_cible')),
  source text not null default 'saisie' check (source in ('odoo', 'annuaire', 'saisie')),
  commercial_email text, groupement text, logiciel text, etiquettes text[] not null default '{}', notes text,
  archive boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists crm_comptes_odoo on public.crm_comptes (odoo_id) where odoo_id is not null;
create unique index if not exists crm_comptes_finess on public.crm_comptes (finess) where finess is not null;
create index if not exists crm_comptes_commercial on public.crm_comptes (commercial_email);
create index if not exists crm_comptes_statut on public.crm_comptes (archive, statut, departement);
create index if not exists crm_comptes_nom on public.crm_comptes (nom, id);
create index if not exists crm_comptes_updated on public.crm_comptes (updated_at, id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(), compte_id uuid not null references public.crm_comptes(id),
  nom text not null check (length(trim(nom)) > 0), prenom text,
  fonction text not null default 'autre' check (fonction in ('titulaire', 'cotitulaire', 'adjoint', 'preparateur', 'acheteur', 'comptable', 'autre')),
  telephone text, mobile text, email text, canal_prefere text check (canal_prefere in ('telephone', 'email', 'visite')),
  principal boolean not null default false, actif boolean not null default true, notes text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, compte_id)
);
create index if not exists crm_contacts_compte on public.crm_contacts (compte_id);

create table if not exists public.crm_opportunites (
  id uuid primary key default gen_random_uuid(), compte_id uuid not null references public.crm_comptes(id),
  titre text not null check (length(trim(titre)) > 0),
  etape text not null default 'a_qualifier' check (etape in ('a_qualifier', 'premier_contact', 'rdv', 'proposition', 'ouverture_compte', 'gagnee', 'perdue')),
  montant_mensuel_estime numeric check (montant_mensuel_estime between 0 and 999999999999),
  probabilite numeric check (probabilite between 0 and 100), date_visee date, motif_perte text,
  proprietaire_email text not null, notes text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, compte_id)
);
create index if not exists crm_opportunites_compte on public.crm_opportunites (compte_id);
create index if not exists crm_opportunites_proprietaire on public.crm_opportunites (proprietaire_email);
create index if not exists crm_opportunites_etape on public.crm_opportunites (etape, date_visee);

create table if not exists public.crm_activites (
  id uuid primary key default gen_random_uuid(), compte_id uuid not null references public.crm_comptes(id),
  titre text not null check (length(trim(titre)) > 0),
  type text not null check (type in ('appel', 'visite', 'email', 'rendez_vous', 'note', 'tache')),
  echeance timestamptz, realise_at timestamptz,
  statut text not null default 'a_faire' check (statut in ('a_faire', 'fait', 'annule')),
  resultat text, auteur_email text not null, assigne_email text, notes text,
  contact_id uuid, opportunite_id uuid,
  foreign key (contact_id, compte_id) references public.crm_contacts(id, compte_id),
  foreign key (opportunite_id, compte_id) references public.crm_opportunites(id, compte_id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists crm_activites_compte on public.crm_activites (compte_id);
create index if not exists crm_activites_echeance on public.crm_activites (statut, echeance);
create index if not exists crm_activites_assigne on public.crm_activites (assigne_email, echeance);
create index if not exists crm_activites_auteur on public.crm_activites (auteur_email);
create index if not exists crm_activites_contact on public.crm_activites (contact_id);
create index if not exists crm_activites_opportunite on public.crm_activites (opportunite_id);

create table if not exists public.crm_equipe (
  id uuid primary key default gen_random_uuid(), utilisateur_id uuid not null unique references auth.users(id),
  email text not null unique, nom_affiche text not null check (length(trim(nom_affiche)) > 0),
  role text not null check (role in ('admin', 'commercial', 'service_client', 'lecture')),
  territoires text[] not null default '{}', objectif_mensuel numeric check (objectif_mensuel between 0 and 999999999999),
  actif boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.crm_reglages (
  id uuid primary key default gen_random_uuid(), unique_ligne boolean not null default true unique check (unique_ligne),
  cibles_indicateurs jsonb, territoire_indicateurs text[],
  objectif_mensuel_global numeric check (objectif_mensuel_global between 0 and 999999999999),
  jalons jsonb not null default '{}' check (jsonb_typeof(jalons) = 'object'),
  cibles_par_pharmacie jsonb not null default '{}' check (jsonb_typeof(cibles_par_pharmacie) = 'object'),
  seuils jsonb not null default '{}' check (jsonb_typeof(seuils) = 'object'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.crm_journal (
  id uuid primary key default gen_random_uuid(), acteur_id uuid, acteur_email text,
  action text not null, objet text not null check (objet in ('comptes', 'contacts', 'activites', 'opportunites', 'equipe', 'reglages')),
  objet_id uuid not null, avant jsonb, apres jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists crm_journal_objet on public.crm_journal (objet, objet_id, created_at);
create index if not exists crm_journal_date on public.crm_journal (created_at, id);

create or replace function public.crm_auditer() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  entetes jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  insert into public.crm_journal (acteur_id, acteur_email, action, objet, objet_id, avant, apres)
  values (nullif(entetes->>'x-crm-acteur', '')::uuid, entetes->>'x-crm-email',
    coalesce(entetes->>'x-crm-action', lower(TG_OP)), substr(TG_TABLE_NAME, 5),
    coalesce(NEW.id, OLD.id), case when TG_OP <> 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP <> 'DELETE' then to_jsonb(NEW) end);
  return null;
end;
$$;
revoke all on function public.crm_auditer() from public, anon, authenticated;

create or replace function public.crm_journal_immuable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Le journal CRM est en ajout seul';
end;
$$;
revoke all on function public.crm_journal_immuable() from public, anon, authenticated;
drop trigger if exists crm_journal_immuable on public.crm_journal;
create trigger crm_journal_immuable before update or delete or truncate on public.crm_journal
for each statement execute function public.crm_journal_immuable();

-- UUID uniquement : aucune séquence créée. La boucle retire aussi les droits d'une
-- éventuelle séquence appartenant aux tables CRM, sans toucher aux autres tables.
do $$
declare t text; s record;
begin
  foreach t in array array['comptes','contacts','activites','opportunites','equipe','reglages','journal'] loop
    execute format('alter table public.%I enable row level security', 'crm_' || t);
    execute format('revoke all on table public.%I from anon, authenticated', 'crm_' || t);
    if t <> 'journal' then
      execute format('grant select, insert, update on table public.%I to service_role', 'crm_' || t);
      execute format('drop trigger if exists crm_audit on public.%I', 'crm_' || t);
      execute format('create trigger crm_audit after insert or update or delete on public.%I for each row execute function public.crm_auditer()', 'crm_' || t);
    end if;
  end loop;
  for s in select distinct ns.nspname, c.relname from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_depend d on d.objid = c.oid
    join pg_class tab on tab.oid = d.refobjid
    where c.relkind = 'S' and ns.nspname = 'public'
      and tab.relname in ('crm_comptes','crm_contacts','crm_activites','crm_opportunites','crm_equipe','crm_reglages','crm_journal')
  loop
    execute format('revoke all on sequence %I.%I from anon, authenticated', s.nspname, s.relname);
  end loop;
end;
$$;
revoke all on table public.crm_journal from service_role;
grant select on table public.crm_journal to service_role;
-- Lot 2 : instantanés privés, passages et publication atomique.
alter table public.crm_reglages add column if not exists cibles_indicateurs jsonb;
alter table public.crm_reglages add column if not exists territoire_indicateurs text[];
create table if not exists public.crm_indicateurs (
  odoo_id bigint not null check (odoo_id >= 0), periode_fin date not null,
  calcule_le timestamptz not null default now(), donnees jsonb not null check (jsonb_typeof(donnees) = 'object'),
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (odoo_id, periode_fin)
);
create table if not exists public.crm_synchros (
  id uuid primary key default gen_random_uuid(), periode_fin date not null,
  debut timestamptz not null default now(), fin timestamptz,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'termine', 'erreur', 'abandonne')),
  compteurs jsonb not null default '{}', erreur text,
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists crm_synchros_debut on public.crm_synchros (debut desc);
create unique index if not exists crm_synchros_un_actif on public.crm_synchros ((true)) where statut = 'en_cours';
alter table public.crm_indicateurs enable row level security;
alter table public.crm_synchros enable row level security;
revoke all on table public.crm_indicateurs, public.crm_synchros from anon, authenticated;
grant select, insert, update, delete on public.crm_indicateurs to service_role;
grant select, insert, update on public.crm_synchros to service_role;
-- Ces deux tables ont uniquement des clés UUID ou composites : aucune séquence.

-- La prise du verrou est une seule transaction, y compris l'expiration de l'ancien passage.
create or replace function public.crm_commencer_synchro(p_date date) returns setof public.crm_synchros
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(20261122, 2);
  if exists (select 1 from public.crm_synchros where statut = 'en_cours' and debut > clock_timestamp() - interval '20 minutes') then return; end if;
  update public.crm_synchros set statut = 'abandonne', fin = clock_timestamp(), updated_at = clock_timestamp(),
    version = version + 1, erreur = 'Passage interrompu, délai dépassé' where statut = 'en_cours';
  return query insert into public.crm_synchros (periode_fin) values (p_date) returning *;
end;
$$;

-- Aucun instantané partiel visible : tous les comptes, le global, la rétention et la fin
-- du passage sont publiés dans la même transaction. Un ancien détenteur ne peut publier.
create or replace function public.crm_publier_indicateurs(p_id uuid, p_instantanes jsonb, p_compteurs jsonb)
returns setof public.crm_synchros language plpgsql security invoker set search_path = pg_catalog, public as $$
declare passage public.crm_synchros;
begin
  select * into passage from public.crm_synchros where id = p_id and statut = 'en_cours' for update;
  if passage.id is null or passage.debut <= clock_timestamp() - interval '20 minutes' then
    raise exception 'Passage expiré' using errcode = '40001';
  end if;
  if jsonb_typeof(p_instantanes) <> 'array' or not exists (
    select 1 from jsonb_to_recordset(p_instantanes) as x(odoo_id bigint, donnees jsonb) where x.odoo_id = 0
  ) then raise exception 'Instantané global absent' using errcode = '23514'; end if;
  insert into public.crm_indicateurs (odoo_id, periode_fin, calcule_le, donnees)
    select x.odoo_id, passage.periode_fin, clock_timestamp(), x.donnees
    from jsonb_to_recordset(p_instantanes) as x(odoo_id bigint, donnees jsonb)
    on conflict (odoo_id, periode_fin) do update set donnees = excluded.donnees,
      calcule_le = excluded.calcule_le, updated_at = clock_timestamp(), version = crm_indicateurs.version + 1;
  delete from public.crm_indicateurs i using (
    select odoo_id, periode_fin, row_number() over (partition by odoo_id order by periode_fin desc) as rang
    from public.crm_indicateurs
  ) anciens where i.odoo_id = anciens.odoo_id and i.periode_fin = anciens.periode_fin and anciens.rang > 26;
  return query update public.crm_synchros set statut = 'termine', fin = clock_timestamp(), updated_at = clock_timestamp(),
    compteurs = p_compteurs, version = version + 1 where id = p_id returning *;
end;
$$;
revoke all on function public.crm_commencer_synchro(date), public.crm_publier_indicateurs(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_commencer_synchro(date), public.crm_publier_indicateurs(uuid, jsonb, jsonb) to service_role;

-- Lot 4 : provenance et stockage durable de la collecte (aucune donnée préchargée).
alter table public.crm_comptes add column if not exists annuaire_maj timestamptz;
alter table public.crm_comptes add column if not exists annuaire_site text;
alter table public.crm_contacts add column if not exists rpps text check (rpps ~ '^\d{11}$');
alter table public.crm_contacts add column if not exists source text not null default 'saisie' check (source in ('saisie','annuaire'));
alter table public.crm_contacts add column if not exists annuaire_maj timestamptz;
create unique index if not exists crm_contacts_rpps on public.crm_contacts(rpps) where rpps is not null;
create index if not exists crm_comptes_siret on public.crm_comptes(siret) where siret is not null;
create table if not exists public.crm_rapprochements (
  id uuid primary key default gen_random_uuid(), cle_site text not null,
  finess text check (finess ~ '^\d{9}$'), siret text check (siret ~ '^\d{14}$'),
  compte_propose uuid not null references public.crm_comptes(id), site jsonb not null,
  motif text not null, statut text not null default 'a_valider' check (statut in ('a_valider','valide','rejete')),
  auteur uuid, auteur_email text, date_decision timestamptz,
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(cle_site,compte_propose)
);
create index if not exists crm_rapprochements_statut on public.crm_rapprochements(statut,created_at);
create table if not exists public.crm_annuaire_etat (
  id uuid primary key default gen_random_uuid(), unique_ligne boolean not null default true unique check(unique_ligne),
  passage uuid not null default gen_random_uuid(), debut timestamptz not null default now(), fin timestamptz,
  date_extraction date, statut text not null default 'en_cours' check(statut in ('en_cours','pause','termine','erreur')),
  phase text not null default 'collecte' check(phase in ('collecte','ecriture','fin','termine')),
  compteurs jsonb not null default '{}', territoire text[] not null default '{}',
  source_url text, etag text, octets bigint not null default 0, reste text not null default '', entete boolean not null default true,
  sites jsonb not null default '{}', curseur text not null default '',
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Auteur textuel : UUID de l'admin, ou « automatique » pour un rapprochement calculé.
alter table public.crm_rapprochements alter column auteur type text using auteur::text;
alter table public.crm_annuaire_etat add column if not exists plan jsonb;
alter table public.crm_activites add column if not exists import_empreinte text;
create unique index if not exists crm_activites_import_empreinte on public.crm_activites(import_empreinte) where import_empreinte is not null;
-- sites est un tampon privé par identifiant de site/RPPS, jamais renvoyé par annuaire.etat.
-- Les octets et le fragment non terminé permettent Range + reprise sans couper un caractère UTF-8.
alter table public.crm_rapprochements enable row level security;
alter table public.crm_annuaire_etat enable row level security;
revoke all on public.crm_rapprochements,public.crm_annuaire_etat from public,anon,authenticated;
grant select,insert,update on public.crm_rapprochements,public.crm_annuaire_etat to service_role;
-- Clés UUID : aucune séquence pour ces nouvelles tables.
alter table public.crm_journal drop constraint if exists crm_journal_objet_check;
alter table public.crm_journal add constraint crm_journal_objet_check check(objet in ('comptes','contacts','activites','opportunites','equipe','reglages','rapprochements'));
drop trigger if exists crm_audit on public.crm_rapprochements;
create trigger crm_audit after insert or update or delete on public.crm_rapprochements for each row execute function public.crm_auditer();

-- Vue privée : filtrage et pagination SQL sur le dernier instantané de chaque compte.
-- Propriétaire de la vue = administratrice SQL ; aucun droit public ou navigateur.
create or replace view public.crm_comptes_indicateurs as
select c.id,c.odoo_id,c.finess,c.siret,c.cip,c.nom,c.adresse,c.code_postal,c.ville,c.departement,c.telephone,c.email,
  c.statut,c.source,c.commercial_email,c.groupement,c.logiciel,c.etiquettes,c.notes,c.archive,c.version,c.created_at,c.updated_at,
  i.donnees as indicateurs, i.periode_fin,
  (i.donnees->>'ca')::numeric as ca,
  case when (i.donnees->>'prev')::numeric > 0 then
    ((i.donnees->>'ca')::numeric / (i.donnees->>'prev')::numeric - 1) * 100 end as evolution,
  i.donnees->>'profil' as profil, i.donnees->>'action' as action_proposee,
  (i.donnees->>'ns_fond')::numeric + (i.donnees->>'ns_cher')::numeric + (i.donnees->>'ns_glp')::numeric as non_servi, c.annuaire_maj,c.annuaire_site
from public.crm_comptes c left join lateral (
  select donnees, periode_fin from public.crm_indicateurs where odoo_id = c.odoo_id order by periode_fin desc limit 1
) i on true;
revoke all on public.crm_comptes_indicateurs from public, anon, authenticated;
grant select on public.crm_comptes_indicateurs to service_role;

-- Verrou durable et clôture conditionnelle : un ancien détenteur ne peut plus écrire.
create or replace function public.crm_annuaire_verrou(p_passage uuid) returns public.crm_annuaire_etat
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.crm_annuaire_etat;
begin
  select * into e from public.crm_annuaire_etat where passage=p_passage for update;
  if e.id is null or e.statut <> 'en_cours' or e.debut <= clock_timestamp()-interval '20 minutes' then
    raise exception 'Passage annuaire expiré' using errcode='40001';
  end if;
  return e;
end; $$;
create or replace function public.crm_annuaire_commencer(p_territoire text[]) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.crm_annuaire_etat;
begin
  perform pg_advisory_xact_lock(20261122,4);
  select * into e from public.crm_annuaire_etat where unique_ligne for update;
  if e.statut='en_cours' and e.debut>clock_timestamp()-interval '20 minutes' then return null; end if;
  if e.id is null then
    insert into public.crm_annuaire_etat(territoire) values(p_territoire) returning * into e;
  else
    if e.statut='termine' or e.territoire is distinct from p_territoire then
      update public.crm_annuaire_etat set plan=null,sites='{}',curseur='',octets=0,reste='',entete=true,phase='collecte',source_url=null,etag=null,date_extraction=null,compteurs='{}' where id=e.id;
    end if;
    update public.crm_annuaire_etat set passage=gen_random_uuid(),debut=clock_timestamp(),fin=null,statut='en_cours',territoire=p_territoire,
      updated_at=clock_timestamp(),version=version+1 where id=e.id returning * into e;
  end if;
  return to_jsonb(e)-'sites'-'plan';
end; $$;
create or replace function public.crm_annuaire_checkpoint(p_passage uuid,p_meta jsonb,p_lot jsonb default '[]') returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.crm_annuaire_etat; l jsonb; tampon jsonb; cle text;
begin
  e:=public.crm_annuaire_verrou(p_passage);tampon:=case when (p_meta->>'reset')::boolean is true then '{}'::jsonb else e.sites end;
  for l in select value from jsonb_array_elements(p_lot) loop
    cle:=l->>'cle';
    tampon:=jsonb_set(tampon,array[cle],coalesce(tampon->cle,'{}'::jsonb)||jsonb_build_object((l->>'rpps')||':'||(l->>'section'),l),true);
  end loop;
  update public.crm_annuaire_etat set sites=tampon,plan=case when (p_meta->>'reset')::boolean is true then null when p_meta?'plan' then p_meta->'plan' else plan end,
    source_url=coalesce(p_meta->>'source_url',source_url),date_extraction=coalesce((p_meta->>'date_extraction')::date,date_extraction),
    etag=case when p_meta?'etag' then p_meta->>'etag' else etag end,
    octets=coalesce((p_meta->>'octets')::bigint,octets),reste=coalesce(p_meta->>'reste',reste),entete=coalesce((p_meta->>'entete')::boolean,entete),
    phase=coalesce(p_meta->>'phase',phase),curseur=case when (p_meta->>'reset')::boolean is true then '' else curseur end,
    compteurs=case when (p_meta->>'reset')::boolean is true then coalesce(p_meta->'compteurs','{}') else compteurs||coalesce(p_meta->'compteurs','{}') end,
    version=version+1,updated_at=clock_timestamp() where id=e.id returning * into e;
  return to_jsonb(e)-'sites'-'plan';
end; $$;
create or replace function public.crm_annuaire_arreter(p_passage uuid,p_statut text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.crm_annuaire_etat;
begin
  e:=public.crm_annuaire_verrou(p_passage);
  if p_statut not in ('pause','erreur') then raise exception 'Statut invalide' using errcode='23514'; end if;
  update public.crm_annuaire_etat set statut=p_statut,fin=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 where id=e.id returning * into e;
  return to_jsonb(e)-'sites'-'plan';
end; $$;

-- Fusion minimale, atomique avec les contacts et le journal. Les champs CRM restent intacts.
create or replace function public.crm_annuaire_appliquer(p_site jsonb,p_cible uuid,p_mode text) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c public.crm_comptes; doublon public.crm_comptes; contact public.crm_contacts; personne jsonb;
  f text:=nullif(p_site->>'finess',''); s text:=nullif(p_site->>'siret','');
begin
  -- Ordre stable des verrous pour les rapprochements concurrents.
  perform id from public.crm_comptes where id=p_cible or (f is not null and finess=f) or (s is not null and siret=s) order by id for update;
  if exists(select 1 from public.crm_comptes where statut='hors_cible' and (id=p_cible or finess=f or siret=s)) then return null; end if;
  if p_cible is not null then
    select * into c from public.crm_comptes where id=p_cible;
    if c.odoo_id is null or (p_mode='automatique' and c.finess is not null and c.finess is distinct from f) or (p_mode='sur' and c.siret is distinct from s) or (p_mode='lie' and c.finess is distinct from f) then
      raise exception 'Compte proposé modifié' using errcode='40001';
    end if;
    if exists(select 1 from public.crm_comptes where id<>c.id and odoo_id is not null and finess=f) then raise exception 'FINESS déjà rattaché' using errcode='40001'; end if;
    for doublon in select * from public.crm_comptes where id<>c.id and odoo_id is null and (finess=f or siret=s) loop
      if not doublon.archive or doublon.finess is not null then
        update public.crm_comptes set archive=true,finess=null,annuaire_site=null,version=version+1,updated_at=clock_timestamp() where id=doublon.id;
      end if;
    end loop;
    update public.crm_comptes set finess=coalesce(f,finess),siret=coalesce(s,siret),annuaire_site=p_site->>'cle',annuaire_maj=clock_timestamp(),
      etiquettes=array_remove(etiquettes,'absente de l''annuaire'),version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  else
    -- Une ancienne liaison rejetée ne doit pas empêcher la recréation du prospect.
    update public.crm_comptes a set finess=case when a.finess=f then null else a.finess end,
      siret=case when a.siret=s then null else a.siret end,annuaire_site=null,version=a.version+1,updated_at=clock_timestamp()
      where a.odoo_id is not null and a.statut<>'hors_cible' and (a.finess=f or a.siret=s)
      and exists(select 1 from public.crm_rapprochements r where r.cle_site=p_site->>'cle' and r.compte_propose=a.id and r.statut='rejete');
    select * into c from public.crm_comptes where odoo_id is null and ((f is not null and finess=f) or (s is not null and siret=s and not archive and (f is null or finess is null)))
      order by (finess=f) desc nulls last,archive,id limit 1;
    if c.odoo_id is not null then raise exception 'Client à rapprocher' using errcode='40001'; end if;
    if c.id is null then
      insert into public.crm_comptes(nom,source,statut,finess,siret) values(p_site->>'nom','annuaire','prospect',f,s) returning * into c;
      if (p_site->>'doublon_possible')::boolean is true then update public.crm_comptes set etiquettes=array_append(etiquettes,'doublon possible') where id=c.id; end if;
    end if;
    update public.crm_comptes set nom=p_site->>'nom',adresse=p_site->>'adresse',code_postal=p_site->>'code_postal',ville=p_site->>'ville',
      departement=p_site->>'departement',telephone=p_site->>'telephone',email=p_site->>'email',finess=coalesce(f,finess),siret=coalesce(s,siret),
      annuaire_site=p_site->>'cle',annuaire_maj=clock_timestamp(),etiquettes=array_remove(etiquettes,'absente de l''annuaire'),
      version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
  for personne in select value from jsonb_array_elements(p_site->'contacts') loop
    select * into contact from public.crm_contacts where rpps=personne->>'rpps' for update;
    if contact.id is not null and (contact.source='saisie' or exists(select 1 from public.crm_comptes where id=contact.compte_id and statut='hors_cible')) then continue; end if;
    -- Ne pas casser la référence composite d'une activité existante en déplaçant un contact.
    if contact.id is not null and contact.compte_id<>c.id and exists(select 1 from public.crm_activites where contact_id=contact.id) then
      continue; -- Son historique reste attaché à son ancien compte.
    end if;
    if contact.id is null then
      insert into public.crm_contacts(compte_id,rpps,source,nom,prenom,fonction,annuaire_maj)
        values(c.id,personne->>'rpps','annuaire',personne->>'nom',personne->>'prenom',personne->>'fonction',clock_timestamp());
    else
      update public.crm_contacts set compte_id=c.id,nom=personne->>'nom',prenom=personne->>'prenom',fonction=personne->>'fonction',actif=true,
        annuaire_maj=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 where id=contact.id;
    end if;
  end loop;
  return c.id;
end; $$;

create or replace function public.crm_annuaire_lot(p_passage uuid,p_lot jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.crm_annuaire_etat; item jsonb; site_import jsonb; decision jsonb; cible text; resultat uuid; n integer:=0; proposes integer:=0; ignores integer:=0; automatiques integer:=0; doublons integer:=0;
begin
  perform pg_advisory_xact_lock(20261122,4);
  e:=public.crm_annuaire_verrou(p_passage);
  if e.phase<>'ecriture' then raise exception 'Collecte non terminée' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(p_lot) loop
    site_import:=item->'site';decision:=item->'decision';
    if (site_import->>'cle')<=e.curseur then continue; end if;
    if exists(select 1 from public.crm_rapprochements where cle_site=site_import->>'cle' and statut='rejete')
      and not exists(select 1 from public.crm_rapprochements where cle_site=site_import->>'cle' and statut='valide')
      and decision->>'type'<>'ignore' then decision:=jsonb_build_object('type','nouveau','comptes','[]'::jsonb); end if;
    if decision->>'type'='ignore' then ignores:=ignores+1;
    elsif decision->>'type'='a_valider' then
      for cible in select jsonb_array_elements_text(decision->'comptes') loop
        insert into public.crm_rapprochements(cle_site,finess,siret,compte_propose,site,motif)
          values(site_import->>'cle',site_import->>'finess',site_import->>'siret',cible::uuid,site_import,decision->>'motif')
          on conflict(cle_site,compte_propose) do update set site=excluded.site,finess=excluded.finess,siret=excluded.siret,
            motif=excluded.motif,updated_at=clock_timestamp(),version=crm_rapprochements.version+1 where crm_rapprochements.statut='a_valider';
        proposes:=proposes+1;
      end loop;
    else
      resultat:=public.crm_annuaire_appliquer(site_import,(decision->'comptes'->>0)::uuid,decision->>'type');
      if resultat is null then ignores:=ignores+1;else
        n:=n+1;
        if (site_import->>'doublon_possible')::boolean is true then doublons:=doublons+1;end if;
        if decision->>'type' in ('automatique','sur') then
          insert into public.crm_rapprochements(cle_site,finess,siret,compte_propose,site,motif,statut,auteur,date_decision)
            values(site_import->>'cle',site_import->>'finess',site_import->>'siret',resultat,site_import,decision->>'motif','valide','automatique',clock_timestamp())
            on conflict(cle_site,compte_propose) do update set statut='valide',auteur='automatique',date_decision=clock_timestamp(),
              finess=excluded.finess,siret=excluded.siret,site=excluded.site,motif=excluded.motif,version=crm_rapprochements.version+1,updated_at=clock_timestamp()
              where crm_rapprochements.statut='a_valider';
          automatiques:=automatiques+1;
        end if;
      end if;
    end if;
    e.curseur:=site_import->>'cle';
  end loop;
  update public.crm_annuaire_etat set curseur=e.curseur,compteurs=compteurs||jsonb_build_object(
    'automatiques',coalesce((compteurs->>'automatiques')::integer,0)+automatiques,
    'doublons_possibles',coalesce((compteurs->>'doublons_possibles')::integer,0)+doublons,
    'sites_traites',coalesce((compteurs->>'sites_traites')::integer,0)+n,
    'rapprochements',coalesce((compteurs->>'rapprochements')::integer,0)+proposes,
    'ignores',coalesce((compteurs->>'ignores')::integer,0)+ignores),version=version+1,updated_at=clock_timestamp() where id=e.id returning * into e;
  return to_jsonb(e)-'sites'-'plan';
end; $$;

create or replace function public.crm_annuaire_fin(p_passage uuid,p_sites jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.crm_annuaire_etat; n integer; m integer;
begin
  e:=public.crm_annuaire_verrou(p_passage);
  if e.phase<>'fin' or (jsonb_array_length(p_sites)=0 and cardinality(e.territoire)>0) then raise exception 'Extraction incomplète' using errcode='23514'; end if;
  with vus as (select distinct c->>'rpps' rpps from jsonb_array_elements(p_sites) s cross join lateral jsonb_array_elements(s->'contacts') c)
    update public.crm_contacts c set actif=false,version=c.version+1,updated_at=clock_timestamp()
    from public.crm_comptes a where c.compte_id=a.id and c.source='annuaire' and c.actif and a.statut<>'hors_cible'
      and a.departement=any(e.territoire) and not exists(select 1 from vus where vus.rpps=c.rpps);
  get diagnostics n=row_count;
  update public.crm_comptes a set etiquettes=array_append(a.etiquettes,'absente de l''annuaire'),version=a.version+1,updated_at=clock_timestamp()
    where a.annuaire_site is not null and a.statut<>'hors_cible' and not a.archive and a.departement=any(e.territoire)
      and not ('absente de l''annuaire'=any(a.etiquettes))
      and not exists(select 1 from jsonb_array_elements(p_sites) s where s->>'cle'=a.annuaire_site or s->>'finess'=a.finess or s->>'siret'=a.siret);
  get diagnostics m=row_count;
  update public.crm_annuaire_etat set statut='termine',phase='termine',fin=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
    compteurs=compteurs||jsonb_build_object('contacts_desactives',n,'officines_absentes',m),sites='{}',plan=null,reste='' where id=e.id returning * into e;
  return to_jsonb(e)-'sites'-'plan';
end; $$;

create or replace function public.crm_annuaire_decider(p_id uuid,p_version integer,p_action text,p_version_compte integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.crm_rapprochements; c public.crm_comptes; cible uuid; h jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  perform pg_advisory_xact_lock(20261122,4);
  select * into r from public.crm_rapprochements where id=p_id for update;
  if r.id is null or r.version<>p_version or r.statut<>(case when p_action='defaire' then 'valide' else 'a_valider' end) then raise exception 'Rapprochement modifié' using errcode='40001'; end if;
  if p_action='defaire' then
    select * into c from public.crm_comptes where id=r.compte_propose for update;
    if c.version is distinct from p_version_compte or c.statut='hors_cible' or (c.finess is not null and c.finess is distinct from r.finess) then raise exception 'Compte proposé modifié' using errcode='40001';end if;
    update public.crm_comptes set finess=null,siret=null,annuaire_site=null,annuaire_maj=null,
      version=version+1,updated_at=clock_timestamp() where id=c.id;
  elsif p_action='valider' then
    select * into c from public.crm_comptes where id=r.compte_propose for update;
    if c.version is distinct from p_version_compte or c.statut='hors_cible' or c.odoo_id is null then raise exception 'Compte proposé modifié' using errcode='40001'; end if;
    cible:=public.crm_annuaire_appliquer(r.site,r.compte_propose,'valide');
    if cible is null then raise exception 'Compte hors cible' using errcode='40001'; end if;
    update public.crm_rapprochements set statut='rejete',version=version+1,updated_at=clock_timestamp(),date_decision=clock_timestamp(),
      auteur=nullif(h->>'x-crm-acteur',''),auteur_email=h->>'x-crm-email' where cle_site=r.cle_site and id<>r.id and statut='a_valider';
  elsif p_action<>'rejeter' then raise exception 'Action invalide' using errcode='23514'; end if;
  update public.crm_rapprochements set statut=case when p_action='valider' then 'valide' else 'rejete' end,
    auteur=nullif(h->>'x-crm-acteur',''),auteur_email=h->>'x-crm-email',date_decision=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
    where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;
-- Aucun RPC n'est exécutable avec une clé navigateur. Pas de GRANT implicite PUBLIC.
revoke all on function public.crm_annuaire_verrou(uuid),public.crm_annuaire_commencer(text[]),public.crm_annuaire_checkpoint(uuid,jsonb,jsonb),
  public.crm_annuaire_arreter(uuid,text),public.crm_annuaire_appliquer(jsonb,uuid,text),public.crm_annuaire_lot(uuid,jsonb),
  public.crm_annuaire_fin(uuid,jsonb),public.crm_annuaire_decider(uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function public.crm_annuaire_verrou(uuid),public.crm_annuaire_commencer(text[]),public.crm_annuaire_checkpoint(uuid,jsonb,jsonb),
  public.crm_annuaire_arreter(uuid,text),public.crm_annuaire_appliquer(jsonb,uuid,text),public.crm_annuaire_lot(uuid,jsonb),
  public.crm_annuaire_fin(uuid,jsonb),public.crm_annuaire_decider(uuid,integer,text,integer) to service_role;
-- Une transaction pour l'ensemble du classeur ; la contrainte unique arbitre les imports concurrents.
create or replace function public.crm_importer_suivi(p_lignes jsonb) returns table(creees integer)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l jsonb; c uuid; n integer; total integer:=0;
begin
  for l in select value from jsonb_array_elements(p_lignes) loop
    perform id from public.crm_comptes where cip=l->>'cip' order by id for share;
    select count(*),min(id::text)::uuid into n,c from public.crm_comptes where cip=l->>'cip';
    if n<>1 or c is distinct from (l->>'compte_id')::uuid then raise exception 'CIP modifié' using errcode='40001';end if;
    insert into public.crm_activites(compte_id,type,titre,statut,echeance,realise_at,notes,auteur_email,import_empreinte)
      values(c,l->>'type',l->>'titre',l->>'statut',(l->>'echeance')::timestamptz,(l->>'realise_at')::timestamptz,
        l->>'notes',l->>'auteur_email',l->>'import_empreinte')
      on conflict(import_empreinte) where import_empreinte is not null do nothing;
    get diagnostics n=row_count;total:=total+n;
  end loop;
  return query select total;
end; $$;
revoke all on function public.crm_importer_suivi(jsonb) from public,anon,authenticated;
grant execute on function public.crm_importer_suivi(jsonb) to service_role;
commit;
