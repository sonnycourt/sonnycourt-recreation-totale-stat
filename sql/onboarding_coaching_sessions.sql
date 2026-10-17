-- À exécuter par Sonny uniquement, après les migrations onboarding existantes.
-- Ajout isolé et réexécutable. Aucun achat, accès, message ou agenda modifié.
-- La date du premier coaching reste dans onboarding_cases.coaching_at (compatibilité).
begin;
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
  and to_regprocedure('public.onboarding_save_with_coachings(bigint,uuid,integer,uuid,jsonb,text,text,timestamp with time zone,jsonb)') is not null
  as coaching_tracking_ready;
