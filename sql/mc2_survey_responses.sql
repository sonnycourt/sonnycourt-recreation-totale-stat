-- Questionnaire MC2 v1. À exécuter par Sonny dans le SQL Editor Supabase.
-- Additif et réexécutable : aucune inscription ni donnée existante modifiée.
-- Stockage uniquement : l'API serveur et le formulaire seront branchés ensuite.
begin;

create table if not exists public.mc2_survey_responses (
  registration_id bigint not null references public.mc2_registrations(id) on delete cascade,
  session_generation integer not null check (session_generation >= 0),
  survey_version integer not null default 1 check (survey_version = 1),
  session_starts_at timestamptz not null,
  priority text check (priority in ('finances_work', 'relationships', 'confidence_action', 'stress_balance')),
  familiarity text check (familiarity in ('new', 'some_videos', 'follower')),
  profession text check (profession in ('employee', 'self_employed', 'transition', 'student')),
  urgency text check (urgency in ('exploring', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (registration_id, session_generation, survey_version)
);

-- Horodatage automatique ; les réponses partielles restent enregistrables.
create or replace function public.mc2_survey_responses_set_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.completed_at := null;
  else
    new.created_at := old.created_at;
    new.completed_at := old.completed_at;
  end if;

  if new.priority is not null and new.familiarity is not null
     and new.profession is not null and new.urgency is not null then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists mc2_survey_responses_timestamps on public.mc2_survey_responses;
create trigger mc2_survey_responses_timestamps
before insert or update on public.mc2_survey_responses
for each row execute function public.mc2_survey_responses_set_timestamps();

-- Aucun accès direct depuis le navigateur, même pour un utilisateur connecté.
alter table public.mc2_survey_responses enable row level security;
revoke all on public.mc2_survey_responses from public, anon, authenticated, service_role;
grant select, insert, update on public.mc2_survey_responses to service_role;
revoke all on function public.mc2_survey_responses_set_timestamps() from public, anon, authenticated;
grant execute on function public.mc2_survey_responses_set_timestamps() to service_role;

comment on table public.mc2_survey_responses is
  'Réponses privées au quiz MC2, par inscrit et génération de session. Aucun envoi Meta. Accès serveur uniquement.';
comment on column public.mc2_survey_responses.session_generation is
  'Copie serveur de mc2_registrations.session_generation. Sépare les réinscriptions ; ne jamais accepter un identifiant utilisateur libre depuis le navigateur.';
comment on column public.mc2_survey_responses.session_starts_at is
  'Date de session copiée par le serveur lors de la première réponse ; conservée lors des modifications.';

commit;

-- Le résultat attendu est true / true.
select
  to_regclass('public.mc2_survey_responses') is not null as questionnaire_ready,
  (select relrowsecurity from pg_class
   where oid = 'public.mc2_survey_responses'::regclass) as private_storage;
