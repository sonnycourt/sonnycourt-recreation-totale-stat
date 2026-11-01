-- À exécuter par Sonny dans Supabase. Réexécutable, sans import ni envoi.
-- Ne modifie ni es2_feedback, ni les notes/états du CRM, ni les automatisations.
begin;
set local lock_timeout = '5s';
create table if not exists public.es2_feedback_replies (
  id uuid primary key,
  feedback_id bigint unique references public.es2_feedback(id),
  email text not null check(email = lower(btrim(email)) and length(email) <= 254),
  prenom text not null default '' check(length(prenom) <= 150),
  question text not null check(length(btrim(question)) > 0 and length(question) <= 100000),
  answer text not null check(length(btrim(answer)) > 0 and length(answer) <= 100000),
  answered_on date not null,
  version integer not null check(version > 0),
  created_by bigint not null,
  updated_by bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists es2_feedback_replies_email_date on public.es2_feedback_replies(email, answered_on desc);
-- Historique séparé et append-only, sans cascade de suppression.
create table if not exists public.es2_feedback_reply_revisions (
  command_id uuid primary key,
  reply_id uuid not null,
  actor_id bigint not null,
  request_data jsonb not null,
  before_data jsonb,
  after_data jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.es2_feedback_replies enable row level security;
alter table public.es2_feedback_reply_revisions enable row level security;
revoke all on public.es2_feedback_replies, public.es2_feedback_reply_revisions from public, anon, authenticated, service_role;
grant select, insert, update on public.es2_feedback_replies to service_role;
grant select, insert on public.es2_feedback_reply_revisions to service_role;

create or replace function public.es2_feedback_save_reply(
  p_actor bigint, p_id uuid, p_command uuid, p_version integer, p_feedback bigint,
  p_email text, p_prenom text, p_question text, p_answer text, p_date date
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare old_row public.es2_feedback_replies; saved public.es2_feedback_replies;
  revision public.es2_feedback_reply_revisions; original_email text; request_data jsonb;
begin
  if not exists(select 1 from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id
    where s.closer_id=p_actor and s.active and s.role='owner' and a.active and a.email is not null and a.password_hash is not null)
    then raise exception 'feedback_forbidden' using errcode='42501'; end if;
  if p_id is null or p_command is null or p_version is null or p_version < 0
    or p_email is null or p_email<>lower(btrim(p_email)) or length(p_email)>254 or p_email !~ '^[^[:space:]@<>"(),]+@[^[:space:]@<>"(),]+\.[^[:space:]@<>"(),]+$'
    or p_prenom is null or length(p_prenom)>150 or p_question is null or length(btrim(p_question))=0 or length(p_question)>100000
    or p_answer is null or length(btrim(p_answer))=0 or length(p_answer)>100000 or p_date is null or p_date>current_date+1
    then raise exception 'feedback_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into old_row from public.es2_feedback_replies where id=p_id for update;
  request_data:=jsonb_build_object('id',p_id,'version',p_version,'feedback_id',p_feedback,'email',p_email,'prenom',p_prenom,'question',p_question,'answer',p_answer,'answered_on',p_date);
  select * into revision from public.es2_feedback_reply_revisions where command_id=p_command;
  if found then
    if revision.actor_id<>p_actor or revision.reply_id<>p_id or revision.request_data<>request_data then raise exception 'feedback_command_conflict'; end if;
    return to_jsonb(old_row);
  end if;
  if p_version<>coalesce(old_row.version,0) then raise exception 'feedback_version_conflict' using errcode='40001'; end if;
  if old_row.id is not null and (old_row.email<>p_email or old_row.feedback_id is distinct from p_feedback) then raise exception 'feedback_identity_conflict'; end if;
  if p_feedback is not null then
    select lower(btrim(email)) into original_email from public.es2_feedback where id=p_feedback;
    if not found or original_email<>p_email then raise exception 'feedback_identity_conflict'; end if;
    if exists(select 1 from public.es2_feedback_replies where feedback_id=p_feedback and id<>p_id) then raise exception 'feedback_version_conflict'; end if;
  end if;
  insert into public.es2_feedback_replies(id,feedback_id,email,prenom,question,answer,answered_on,version,created_by,updated_by)
    values(p_id,p_feedback,p_email,p_prenom,p_question,p_answer,p_date,1,p_actor,p_actor)
    on conflict(id) do update set prenom=excluded.prenom,question=excluded.question,answer=excluded.answer,
      answered_on=excluded.answered_on,version=es2_feedback_replies.version+1,updated_by=p_actor,updated_at=now()
    returning * into saved;
  insert into public.es2_feedback_reply_revisions(command_id,reply_id,actor_id,request_data,before_data,after_data)
    values(p_command,p_id,p_actor,request_data,case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(saved));
  return to_jsonb(saved);
end $$;
revoke all on function public.es2_feedback_save_reply(bigint,uuid,uuid,integer,bigint,text,text,text,text,date) from public,anon,authenticated;
grant execute on function public.es2_feedback_save_reply(bigint,uuid,uuid,integer,bigint,text,text,text,text,date) to service_role;

create or replace function public.es2_feedback_inbox(p_actor bigint,p_filter text default 'pending',p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id
    where s.closer_id=p_actor and s.active and s.role='owner' and a.active and a.email is not null and a.password_hash is not null)
    then raise exception 'feedback_forbidden' using errcode='42501'; end if;
  if p_filter is null or p_filter not in ('pending','answered','all') or p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>120 then raise exception 'feedback_invalid'; end if;
  with items as (
    select f.id as feedback_id,r.id as reply_id,lower(btrim(f.email)) as email,coalesce(nullif(r.prenom,''),f.prenom,'') as prenom,
      f.created_at as received_at,r.answered_on,(r.id is not null) as answered
    from public.es2_feedback f left join public.es2_feedback_replies r on r.feedback_id=f.id
    union all
    select null,r.id,r.email,r.prenom,r.created_at,r.answered_on,true from public.es2_feedback_replies r where r.feedback_id is null
  ), filtered as (
    select * from items where (p_filter='all' or (p_filter='answered' and answered) or (p_filter='pending' and not answered))
      and (p_search='' or strpos(lower(email||' '||prenom),lower(btrim(p_search)))>0)
  ), page as (select * from filtered order by received_at desc,feedback_id desc nulls last,reply_id limit 50 offset p_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by received_at desc,feedback_id desc nulls last,reply_id) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),'pending',(select count(*) from items where not answered),'answered',(select count(*) from items where answered)) into result;
  return result;
end $$;
revoke all on function public.es2_feedback_inbox(bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.es2_feedback_inbox(bigint,text,text,integer) to service_role;
notify pgrst, 'reload schema';
commit;
select to_regclass('public.es2_feedback_replies') is not null and to_regprocedure('public.es2_feedback_save_reply(bigint,uuid,uuid,integer,bigint,text,text,text,text,date)') is not null as sonny_feedback_ready;
