-- À exécuter par Sonny uniquement, après les migrations onboarding existantes.
-- Ajout isolé et réexécutable. Aucun achat, accès, message ou agenda modifié.
-- La date du premier coaching reste dans onboarding_cases.coaching_at (compatibilité).
begin;
set local lock_timeout='5s';
create table if not exists public.onboarding_coaching_sessions (
  case_id uuid not null references public.onboarding_cases(id) on delete cascade,
  number smallint not null check(number between 1 and 3),
  status text not null check(status in ('pending','planned','completed','absent','cancelled')),
  scheduled_at timestamptz,
  duration_minutes smallint check(duration_minutes between 1 and 240),
  notes text not null default '' check(length(notes)<=6000),
  updated_at timestamptz not null default now(),
  updated_by bigint not null,
  primary key(case_id,number),
  check(number<>1 or scheduled_at is null)
);
-- Journal privé des versions : une correction n'efface pas la version précédente.
create table if not exists public.onboarding_coaching_revisions (
  command_id uuid primary key references public.onboarding_events(command_id),
  case_id uuid not null references public.onboarding_cases(id) on delete cascade,
  actor_id bigint not null,
  sessions jsonb not null,
  recorded_at timestamptz not null default now()
);
create index if not exists onboarding_coaching_revision_history on public.onboarding_coaching_revisions(case_id,recorded_at desc);
alter table public.onboarding_coaching_sessions enable row level security;
alter table public.onboarding_coaching_revisions enable row level security;
revoke all on public.onboarding_coaching_sessions,public.onboarding_coaching_revisions from public,anon,authenticated;
grant select,insert,update on public.onboarding_coaching_sessions to service_role;
grant select,insert on public.onboarding_coaching_revisions to service_role;

-- Filet de sécurité commun aux notes historiques ET nouvelles.
-- Aucun FK/cascade : une suppression accidentelle du dossier ne supprime pas ses copies.
-- Append-only pour l'application (pas de UPDATE / DELETE / TRUNCATE autorisé).
create table if not exists public.onboarding_notes_archive (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  entity text not null check(entity in ('onboarding_cases','onboarding_events','onboarding_coaching_sessions')),
  source_key text not null,
  operation text not null check(operation in ('BASELINE','INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data jsonb,
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index if not exists onboarding_notes_archive_baseline
  on public.onboarding_notes_archive(entity,source_key) where operation='BASELINE';
create index if not exists onboarding_notes_archive_case on public.onboarding_notes_archive(case_id,recorded_at desc);
alter table public.onboarding_notes_archive enable row level security;
revoke all on public.onboarding_notes_archive from public,anon,authenticated,service_role;
grant select,insert on public.onboarding_notes_archive to service_role;

create or replace function public.onboarding_notes_snapshot(p_entity text,p_row jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog,public as $$
  select case when p_entity='onboarding_cases' then
    (select jsonb_object_agg(key,value) from jsonb_each(p_row)
      where key in ('id','goal','motivations','obstacles','routine','notes','coaching_at','version','updated_at'))
    else p_row end;
$$;
create or replace function public.onboarding_archive_notes_change()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare previous jsonb; following jsonb; source jsonb; dossier uuid; source_id text;
begin
  if TG_OP<>'INSERT' then previous:=public.onboarding_notes_snapshot(TG_TABLE_NAME,to_jsonb(OLD)); end if;
  if TG_OP<>'DELETE' then following:=public.onboarding_notes_snapshot(TG_TABLE_NAME,to_jsonb(NEW)); end if;
  -- Ne pas dupliquer les notes pour une simple actualisation sans changement de contenu.
  if TG_OP='UPDATE' and (previous-'version'-'updated_at') is not distinct from (following-'version'-'updated_at') then return NEW; end if;
  source:=coalesce(following,previous);
  dossier:=case when TG_TABLE_NAME='onboarding_cases' then (source->>'id')::uuid else (source->>'case_id')::uuid end;
  source_id:=case when TG_TABLE_NAME='onboarding_coaching_sessions' then dossier::text||':'||(source->>'number') else source->>'id' end;
  insert into public.onboarding_notes_archive(case_id,entity,source_key,operation,before_data,after_data)
  values(dossier,TG_TABLE_NAME,source_id,TG_OP,previous,following);
  -- Sans archive, l'écriture échoue aussi : jamais d'écrasement non archivé.
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
revoke all on function public.onboarding_notes_snapshot(text,jsonb) from public,anon,authenticated;
revoke all on function public.onboarding_archive_notes_change() from public,anon,authenticated;
grant execute on function public.onboarding_notes_snapshot(text,jsonb),public.onboarding_archive_notes_change() to service_role;

-- Verrou bref : aucune écriture ne peut se glisser entre la copie initiale et les triggers.
-- Échec sûr après 5 secondes si la base est occupée ; il suffit de réexécuter le fichier.
lock table public.onboarding_cases,public.onboarding_events,public.onboarding_coaching_sessions in share row exclusive mode;
insert into public.onboarding_notes_archive(case_id,entity,source_key,operation,after_data)
select c.id,'onboarding_cases',c.id::text,'BASELINE',public.onboarding_notes_snapshot('onboarding_cases',to_jsonb(c)) from public.onboarding_cases c
on conflict(entity,source_key) where operation='BASELINE' do nothing;
insert into public.onboarding_notes_archive(case_id,entity,source_key,operation,after_data)
select e.case_id,'onboarding_events',e.id::text,'BASELINE',to_jsonb(e) from public.onboarding_events e
on conflict(entity,source_key) where operation='BASELINE' do nothing;
insert into public.onboarding_notes_archive(case_id,entity,source_key,operation,after_data)
select s.case_id,'onboarding_coaching_sessions',s.case_id::text||':'||s.number::text,'BASELINE',to_jsonb(s) from public.onboarding_coaching_sessions s
on conflict(entity,source_key) where operation='BASELINE' do nothing;
create or replace trigger onboarding_cases_notes_archive after insert or update or delete on public.onboarding_cases
  for each row execute function public.onboarding_archive_notes_change();
create or replace trigger onboarding_events_notes_archive after insert or update or delete on public.onboarding_events
  for each row execute function public.onboarding_archive_notes_change();
create or replace trigger onboarding_sessions_notes_archive after insert or update or delete on public.onboarding_coaching_sessions
  for each row execute function public.onboarding_archive_notes_change();

-- Le protocole existant garde la responsabilité de l'autorisation, de la version,
-- de l'idempotence et des règles de l'accueil. Tout est enregistré en une transaction.
create or replace function public.onboarding_save_with_coachings(
  p_actor bigint,p_case uuid,p_version integer,p_command uuid,p_patch jsonb,p_kind text,p_note text,
  p_occurred_at timestamptz,p_sessions jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare result jsonb; replay boolean; s jsonb; n integer; at_time timestamptz; duration integer; session_status text;
begin
  -- Même verrou que l'ancien protocole : aucun écrasement entre les deux interfaces.
  perform 1 from public.onboarding_cases where id=p_case for update;
  select exists(select 1 from public.onboarding_events where command_id=p_command) into replay;
  result:=public.onboarding_save_case_v2(p_actor,p_case,p_version,p_command,p_patch,p_kind,p_note,p_occurred_at);
  if replay then
    return jsonb_build_object('case',result,'coachings',coalesce((select jsonb_agg(to_jsonb(t) order by number) from public.onboarding_coaching_sessions t where case_id=p_case),'[]'::jsonb));
  end if;
  if p_sessions is null or jsonb_typeof(p_sessions)<>'array' then raise exception 'onboarding_invalid_coaching'; end if;
  if jsonb_array_length(p_sessions)<>3 then raise exception 'onboarding_invalid_coaching'; end if;
  for n in 1..3 loop
    s:=p_sessions->(n-1);
    if jsonb_typeof(s)<>'object' then raise exception 'onboarding_invalid_coaching'; end if;
    if (s->>'number') is distinct from n::text or jsonb_typeof(s->'number') is distinct from 'number'
      or (s->>'status') is null or (s->>'status') not in ('pending','planned','completed','absent','cancelled')
      or jsonb_typeof(s->'notes') is distinct from 'string' or length(s->>'notes')>6000
      or not (s ?& array['number','status','scheduled_at','duration_minutes','notes'])
      or exists(select 1 from jsonb_object_keys(s) k where k not in ('number','status','scheduled_at','duration_minutes','notes'))
      then raise exception 'onboarding_invalid_coaching'; end if;
    if jsonb_typeof(s->'scheduled_at') not in ('null','string')
      or jsonb_typeof(s->'duration_minutes') not in ('null','number') then raise exception 'onboarding_invalid_coaching'; end if;
    if s->>'duration_minutes' is not null and (s->>'duration_minutes') !~ '^[0-9]{1,3}$' then raise exception 'onboarding_invalid_coaching'; end if;
    if s->>'scheduled_at' is not null and (s->>'scheduled_at') !~ '^\d{4}-\d{2}-\d{2}T.*Z$' then raise exception 'onboarding_invalid_coaching'; end if;
    at_time:=(s->>'scheduled_at')::timestamptz;
    duration:=(s->>'duration_minutes')::integer;
    session_status:=s->>'status';
    if (at_time is not null and (not isfinite(at_time) or at_time<'2000-01-01'::timestamptz))
      or (duration is not null and (duration<1 or duration>240))
      or (session_status='pending' and at_time is not null)
      or (session_status in ('completed','absent','cancelled') and at_time is null)
      or (session_status in ('completed','absent') and at_time>now()+interval '5 minutes')
      or (session_status='completed' and duration is null)
      or (n=1 and at_time is distinct from (result->>'coaching_at')::timestamptz)
      then raise exception 'onboarding_invalid_coaching'; end if;
    insert into public.onboarding_coaching_sessions(case_id,number,status,scheduled_at,duration_minutes,notes,updated_by)
    values(p_case,n,session_status,case when n=1 then null else at_time end,duration,s->>'notes',p_actor)
    on conflict(case_id,number) do update set status=excluded.status,scheduled_at=excluded.scheduled_at,
      duration_minutes=excluded.duration_minutes,notes=excluded.notes,updated_by=p_actor,updated_at=now();
  end loop;
  insert into public.onboarding_coaching_revisions(command_id,case_id,actor_id,sessions)
  values(p_command,p_case,p_actor,p_sessions);
  return jsonb_build_object('case',result,'coachings',coalesce((select jsonb_agg(to_jsonb(t) order by number) from public.onboarding_coaching_sessions t where case_id=p_case),'[]'::jsonb));
end $$;
revoke all on function public.onboarding_save_with_coachings(bigint,uuid,integer,uuid,jsonb,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.onboarding_save_with_coachings(bigint,uuid,integer,uuid,jsonb,text,text,timestamptz,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
select to_regclass('public.onboarding_coaching_sessions') is not null
  and to_regclass('public.onboarding_coaching_revisions') is not null
  and to_regclass('public.onboarding_notes_archive') is not null
  and (select count(*)=3 from pg_trigger where tgname in ('onboarding_cases_notes_archive','onboarding_events_notes_archive','onboarding_sessions_notes_archive') and tgenabled='O')
  and to_regprocedure('public.onboarding_save_with_coachings(bigint,uuid,integer,uuid,jsonb,text,text,timestamp with time zone,jsonb)') is not null
  as coaching_tracking_ready;
