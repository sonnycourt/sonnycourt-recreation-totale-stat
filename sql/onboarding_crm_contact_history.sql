-- CRM onboarding : saisie datée et suppression réversible de l'historique.
-- À exécuter par Sonny uniquement. Transaction sûre et réexécutable.
-- Aucun achat, accès, tracking, email, SMS ou calendrier externe n'est modifié.
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='onboarding_cases' and column_name='coaching_booked') then
    alter table public.onboarding_cases add column coaching_booked boolean not null default false;
    update public.onboarding_cases set coaching_booked=true where coaching_at is not null;
  end if;
end $$;
alter table public.onboarding_events add column if not exists deleted_at timestamptz;
alter table public.onboarding_events add column if not exists deleted_by bigint;
alter table public.onboarding_events add column if not exists recorded_at timestamptz;
update public.onboarding_events set recorded_at=occurred_at where recorded_at is null;
alter table public.onboarding_events alter column recorded_at set default now();
alter table public.onboarding_events alter column recorded_at set not null;
alter table public.onboarding_events drop constraint if exists onboarding_events_kind_check;
alter table public.onboarding_events add constraint onboarding_events_kind_check
  check(kind in ('updated','call_no_answer','sms_sent','whatsapp_sent','contacted','completed','note','call_answered','unreachable'));
create or replace function public.onboarding_save_case_v2(
  p_actor bigint,p_case uuid,p_version integer,p_command uuid,p_patch jsonb,p_kind text,p_note text,p_occurred_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c public.onboarding_cases; v_role text; v_event public.onboarding_events; v_saved public.onboarding_cases;
begin
  select s.role into v_role from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id
  where s.closer_id=p_actor and s.active and a.active and a.email is not null and a.password_hash is not null;
  if v_role is null then raise exception 'onboarding_forbidden' using errcode='42501'; end if;
  select * into c from public.onboarding_cases where id=p_case for update;
  if not found or (v_role <> 'owner' and c.assigned_closer_id <> p_actor) then
    raise exception 'onboarding_forbidden' using errcode='42501';
  end if;
  select * into v_event from public.onboarding_events where command_id=p_command;
  if found then
    if v_event.case_id <> p_case or v_event.actor_id <> p_actor then raise exception 'onboarding_command_conflict'; end if;
    return to_jsonb(c);
  end if;
  if p_version is null or c.version <> p_version then raise exception 'onboarding_version_conflict' using errcode='40001'; end if;
  if p_kind not in ('updated','call_no_answer','sms_sent','whatsapp_sent','contacted','completed','note','call_answered','unreachable')
    or p_kind is null or p_note is null or length(p_note)>4000 or p_command is null
    or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'onboarding_invalid'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
    ('status','next_action','followup_at','onboarding_at','coaching_at','goal','motivations','obstacles',
     'routine','notes','training_access','community_access','feedback_explained','coaching_booked')) then raise exception 'onboarding_invalid_field'; end if;
  if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at < '2000-01-01'::timestamptz or p_occurred_at > now()+interval '5 minutes' then raise exception 'onboarding_invalid_time'; end if;
  v_saved := jsonb_populate_record(c,p_patch);
  if v_saved.coaching_at is not null and (v_saved.coaching_at at time zone 'Europe/Paris')::date
    < (c.purchased_at at time zone 'Europe/Paris')::date+33 then raise exception 'onboarding_coaching_too_early'; end if;
  -- Une saisie rétroactive ne remplace pas la progression d'un contact plus récent.
  if not exists (select 1 from public.onboarding_events where case_id=p_case and deleted_at is null and kind<>'note' and occurred_at>p_occurred_at) then
  if p_kind='call_no_answer' then
    v_saved.status:='contacting'; v_saved.next_action:='sms'; v_saved.followup_at:=p_occurred_at;
  elsif p_kind='sms_sent' then
    v_saved.status:='awaiting'; v_saved.next_action:='whatsapp'; v_saved.followup_at:=p_occurred_at+interval '24 hours';
  elsif p_kind='whatsapp_sent' then
    v_saved.status:='awaiting'; v_saved.next_action:='followup'; v_saved.followup_at:=null;
  elsif p_kind in ('contacted','call_answered') then
    v_saved.status:='contacted'; v_saved.next_action:='onboarding'; v_saved.followup_at:=null;
  elsif p_kind='unreachable' then
    v_saved.status:='contacting'; v_saved.next_action:='followup'; v_saved.followup_at:=null;
  elsif p_kind='completed' then
    v_saved.status:='done'; v_saved.next_action:='none'; v_saved.followup_at:=null;
  end if;
  end if;
  update public.onboarding_cases set
    status=v_saved.status,next_action=v_saved.next_action,followup_at=v_saved.followup_at,
    onboarding_at=v_saved.onboarding_at,coaching_at=v_saved.coaching_at,
    goal=v_saved.goal,motivations=v_saved.motivations,obstacles=v_saved.obstacles,routine=v_saved.routine,
    notes=v_saved.notes,training_access=v_saved.training_access,community_access=v_saved.community_access,
    feedback_explained=v_saved.feedback_explained,coaching_booked=v_saved.coaching_booked,version=c.version+1,updated_at=now()
  where id=p_case returning * into c;
  insert into public.onboarding_events (command_id,case_id,actor_id,kind,note,occurred_at)
  values (p_command,p_case,p_actor,p_kind,p_note,p_occurred_at);
  return to_jsonb(c);
end $$;

-- Compatibilité des anciennes prévisualisations : même protocole, nouvelle transaction.
create or replace function public.onboarding_save_case(
  p_actor bigint,p_case uuid,p_version integer,p_command uuid,p_patch jsonb,p_kind text,p_note text
) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
  select public.onboarding_save_case_v2(p_actor,p_case,p_version,p_command,p_patch,p_kind,p_note,now());
$$;

-- L'entrée est masquée, pas détruite. Les notes / rendez-vous / état de fiche restent intacts.
-- Seul l'auteur ou Sonny propriétaire peut supprimer, dans un dossier auquel il a accès.
create or replace function public.onboarding_delete_event(p_actor bigint,p_case uuid,p_version integer,p_event uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c public.onboarding_cases; e public.onboarding_events; v_role text;
begin
  select s.role into v_role from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id
    where s.closer_id=p_actor and s.active and a.active and a.email is not null and a.password_hash is not null;
  if v_role is null then raise exception 'onboarding_forbidden' using errcode='42501'; end if;
  select * into c from public.onboarding_cases where id=p_case for update;
  if not found or (v_role<>'owner' and c.assigned_closer_id<>p_actor) then raise exception 'onboarding_forbidden' using errcode='42501'; end if;
  select * into e from public.onboarding_events where id=p_event and case_id=p_case;
  if not found or (v_role<>'owner' and e.actor_id<>p_actor) then raise exception 'onboarding_forbidden' using errcode='42501'; end if;
  if e.deleted_at is not null then return to_jsonb(c); end if;
  if p_version is null or c.version<>p_version then raise exception 'onboarding_version_conflict' using errcode='40001'; end if;
  update public.onboarding_events set deleted_at=now(),deleted_by=p_actor where id=p_event;
  update public.onboarding_cases set version=version+1,updated_at=now() where id=p_case returning * into c;
  return to_jsonb(c);
end $$;

revoke all on function public.onboarding_save_case_v2(bigint,uuid,integer,uuid,jsonb,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.onboarding_save_case(bigint,uuid,integer,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.onboarding_delete_event(bigint,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.onboarding_save_case_v2(bigint,uuid,integer,uuid,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.onboarding_save_case(bigint,uuid,integer,uuid,jsonb,text,text) to service_role;
grant execute on function public.onboarding_delete_event(bigint,uuid,integer,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
