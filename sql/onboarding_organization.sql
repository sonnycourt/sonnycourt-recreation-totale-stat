-- À exécuter par Sonny uniquement. Aucun email ni service externe.
-- Données d'organisation séparées des notes ; aucune fiche existante supprimée.
begin;
set local lock_timeout='5s';
create table if not exists public.onboarding_case_organization (
  case_id uuid primary key references public.onboarding_cases(id),
  version integer not null default 0 check(version>=0),
  archived_at timestamptz,
  archive_reason text not null default '' check(archive_reason in ('','abandon','unfinished','other')),
  time_zone text not null default '' check(length(time_zone)<=100),
  meeting_links jsonb not null default '{}'::jsonb check(jsonb_typeof(meeting_links)='object'),
  updated_at timestamptz not null default now(),
  updated_by bigint
);
-- Historique append-only, indépendant d'une suppression de fiche.
create table if not exists public.onboarding_organization_revisions (
  command_id uuid primary key,
  case_id uuid not null,
  actor_id bigint not null,
  before_data jsonb not null,
  after_data jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.onboarding_case_organization enable row level security;
alter table public.onboarding_organization_revisions enable row level security;
revoke all on public.onboarding_case_organization,public.onboarding_organization_revisions from public,anon,authenticated,service_role;
grant select,insert,update on public.onboarding_case_organization to service_role;
grant select,insert on public.onboarding_organization_revisions to service_role;
create or replace function public.onboarding_save_organization(
  p_actor bigint,p_case uuid,p_version integer,p_command uuid,p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c public.onboarding_cases; v_role text; previous public.onboarding_case_organization;
  following public.onboarding_case_organization; rev public.onboarding_organization_revisions; pair record;
begin
  select s.role into v_role from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id
    where s.closer_id=p_actor and s.active and a.active and a.email is not null and a.password_hash is not null;
  select * into c from public.onboarding_cases where id=p_case for update;
  if v_role is null or not found or (v_role<>'owner' and c.assigned_closer_id<>p_actor) then
    raise exception 'onboarding_forbidden' using errcode='42501'; end if;
  select * into previous from public.onboarding_case_organization where case_id=p_case;
  if not found then previous.case_id:=p_case; previous.version:=0; previous.archive_reason:=''; previous.time_zone:=''; previous.meeting_links:='{}'; end if;
  select * into rev from public.onboarding_organization_revisions where command_id=p_command;
  if found then
    if rev.case_id<>p_case or rev.actor_id<>p_actor then raise exception 'onboarding_command_conflict'; end if;
    return to_jsonb(previous);
  end if;
  if p_version is null or p_version<>previous.version then raise exception 'onboarding_organization_conflict' using errcode='40001'; end if;
  if p_command is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('archived','archive_reason','time_zone','meeting_links')) then raise exception 'onboarding_invalid_organization'; end if;
  following:=previous;
  if p_patch?'time_zone' then
    if jsonb_typeof(p_patch->'time_zone')<>'string' or length(p_patch->>'time_zone')>100
      or ((p_patch->>'time_zone')<>'' and not exists(select 1 from pg_timezone_names where name=p_patch->>'time_zone')) then raise exception 'onboarding_invalid_organization'; end if;
    following.time_zone:=p_patch->>'time_zone';
  end if;
  if p_patch?'meeting_links' then
    if jsonb_typeof(p_patch->'meeting_links')<>'object' then raise exception 'onboarding_invalid_organization'; end if;
    for pair in select * from jsonb_each(p_patch->'meeting_links') loop
      if pair.key not in ('onboarding','coaching1','coaching2','coaching3') or jsonb_typeof(pair.value)<>'string'
        or length(pair.value#>>'{}')>1000 or ((pair.value#>>'{}')<>'' and (pair.value#>>'{}')!~ '^https://[^/@[:space:]]+([/:?]|$)') then raise exception 'onboarding_invalid_organization'; end if;
    end loop;
    following.meeting_links:=p_patch->'meeting_links';
  end if;
  if p_patch?'archived' then
    if jsonb_typeof(p_patch->'archived')<>'boolean' then raise exception 'onboarding_invalid_organization'; end if;
    if (p_patch->>'archived')::boolean then
      if coalesce(p_patch->>'archive_reason','') not in ('abandon','unfinished','other') then raise exception 'onboarding_invalid_organization'; end if;
      following.archived_at:=coalesce(previous.archived_at,now());following.archive_reason:=p_patch->>'archive_reason';
    else following.archived_at:=null;following.archive_reason:=''; end if;
  end if;
  following.version:=previous.version+1;following.updated_at:=now();following.updated_by:=p_actor;
  insert into public.onboarding_case_organization select (following).*
    on conflict(case_id) do update set version=excluded.version,archived_at=excluded.archived_at,
      archive_reason=excluded.archive_reason,time_zone=excluded.time_zone,meeting_links=excluded.meeting_links,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  insert into public.onboarding_organization_revisions(command_id,case_id,actor_id,before_data,after_data)
    values(p_command,p_case,p_actor,to_jsonb(previous),to_jsonb(following));
  return to_jsonb(following);
end $$;
revoke all on function public.onboarding_save_organization(bigint,uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.onboarding_save_organization(bigint,uuid,integer,uuid,jsonb) to service_role;

-- Correction ciblée de la régression : un échange ne défait pas un accueil réalisé.
-- Conserve notes, dates, version, verrou, idempotence et réouverture manuelle (updated).
do $migration$
declare definition text; marker text := '-- onboarding_done_contact_guard_v1';
begin
  definition:=pg_get_functiondef('public.onboarding_save_case_v2(bigint,uuid,integer,uuid,jsonb,text,text,timestamp with time zone)'::regprocedure);
  if strpos(definition,marker)=0 then
    if strpos(definition,'  update public.onboarding_cases set')=0 then raise exception 'Version onboarding inattendue : migration annulée'; end if;
    definition:=replace(definition,'  update public.onboarding_cases set',
      '  -- onboarding_done_contact_guard_v1
  if c.status=''done'' and p_kind not in (''updated'',''completed'') then
    v_saved.status:=''done''; v_saved.next_action:=c.next_action; v_saved.followup_at:=c.followup_at;
  end if;
  update public.onboarding_cases set');
    execute definition;
  end if;
end $migration$;

-- Réparation strictement bornée aux trois dossiers vérifiés le 22/10/2026.
-- Si Romain a modifié la fiche depuis le diagnostic, on la laisse intacte.
-- Journal privé des seuls statuts/rappels avant et après ; aucune note réécrite.
create table if not exists public.onboarding_status_repairs (
  case_id uuid not null,
  repair_key text not null,
  before_data jsonb not null,
  after_data jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key(case_id,repair_key)
);
alter table public.onboarding_status_repairs enable row level security;
revoke all on public.onboarding_status_repairs from public,anon,authenticated,service_role;
grant select on public.onboarding_status_repairs to service_role;
do $repair$
declare target record; c public.onboarding_cases; previous jsonb;
begin
  for target in select * from (values
    ('133464e0-c07c-4705-819e-afe6defded5d'::uuid,14),
    ('35b94a01-f2b5-4f2b-ba56-229d7abe052e'::uuid,10),
    ('daf599b7-b80b-45eb-a5f2-b3297c8e469c'::uuid,7)
  ) as x(id,expected_version) loop
    select * into c from public.onboarding_cases where id=target.id for update;
    if found and c.version=target.expected_version and c.status='contacted' and c.next_action='onboarding' and c.followup_at is null
      and exists(select 1 from public.onboarding_events where case_id=c.id and kind='completed' and deleted_at is null)
      and not exists(select 1 from public.onboarding_status_repairs where case_id=c.id and repair_key='completed-2026-10-22') then
      previous:=jsonb_build_object('status',c.status,'next_action',c.next_action,'followup_at',c.followup_at,'version',c.version);
      update public.onboarding_cases set status='done',next_action='none',followup_at=null,version=version+1,updated_at=now()
        where id=c.id returning * into c;
      insert into public.onboarding_status_repairs(case_id,repair_key,before_data,after_data)
        values(c.id,'completed-2026-10-22',previous,jsonb_build_object('status',c.status,'next_action',c.next_action,'followup_at',c.followup_at,'version',c.version));
    end if;
  end loop;
end $repair$;
notify pgrst, 'reload schema';
commit;
select to_regclass('public.onboarding_case_organization') is not null
  and to_regclass('public.onboarding_organization_revisions') is not null
  and strpos(pg_get_functiondef('public.onboarding_save_case_v2(bigint,uuid,integer,uuid,jsonb,text,text,timestamp with time zone)'::regprocedure),'onboarding_done_contact_guard_v1')>0
  as onboarding_organization_ready;
