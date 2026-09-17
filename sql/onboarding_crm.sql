-- CRM onboarding isolé. À exécuter par Sonny dans Supabase, jamais par l'agent.
-- Réexécutable : aucun changement aux tables, fonctions ou webhooks existants.
-- Aucun email, SMS, WhatsApp, paiement ou réservation externe n'est déclenché.
begin;

create table if not exists public.onboarding_staff (
  closer_id bigint primary key,
  role text not null check (role in ('coach', 'owner')),
  active boolean not null default true,
  default_assignee boolean not null default false,
  check (not default_assignee or (active and role = 'coach'))
);
create unique index if not exists onboarding_one_default on public.onboarding_staff (default_assignee) where default_assignee;

create table if not exists public.onboarding_cases (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email))),
  registration_id bigint unique,
  source text not null check (source in ('mc2', 'legacy')),
  assigned_closer_id bigint not null,
  display_name text not null,
  preferred_name text,
  phone text,
  country text,
  country_override text,
  city text,
  purchased_at timestamptz not null,
  plan text not null check (plan in ('twelve', 'six', 'legacy_three')),
  payment_status text,
  paid_installment_count integer not null default 0,
  payment_date_override date,
  payment_date_source text,
  special_instructions text,
  status text not null default 'new' check (status in ('new','contacting','awaiting','contacted','booked','done','paused')),
  next_action text not null default 'call' check (next_action in ('call','sms','whatsapp','followup','onboarding','none')),
  followup_at timestamptz,
  onboarding_at timestamptz,
  coaching_at timestamptz,
  goal text not null default '' check (length(goal) <= 4000),
  motivations text not null default '' check (length(motivations) <= 4000),
  obstacles text not null default '' check (length(obstacles) <= 4000),
  routine text not null default '' check (length(routine) <= 4000),
  notes text not null default '' check (length(notes) <= 12000),
  training_access boolean not null default false,
  community_access boolean not null default false,
  feedback_explained boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_cases_coach_status on public.onboarding_cases (assigned_closer_id,status,followup_at);

create table if not exists public.onboarding_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  case_id uuid not null references public.onboarding_cases(id) on delete cascade,
  actor_id bigint not null,
  kind text not null check (kind in ('updated','call_no_answer','sms_sent','whatsapp_sent','contacted','completed','note')),
  note text not null default '' check (length(note) <= 4000),
  occurred_at timestamptz not null default now()
);
create index if not exists onboarding_events_history on public.onboarding_events (case_id,occurred_at desc);

-- Pas d'accès depuis le navigateur / clé publique Supabase, même authentifié.
alter table public.onboarding_staff enable row level security;
alter table public.onboarding_cases enable row level security;
alter table public.onboarding_events enable row level security;
revoke all on public.onboarding_staff, public.onboarding_cases, public.onboarding_events from public, anon, authenticated;
grant select,insert,update,delete on public.onboarding_staff, public.onboarding_cases, public.onboarding_events to service_role;

-- Autorisations séparées du CRM closer : ne modifie ni mot de passe ni droits existants.
insert into public.onboarding_staff (closer_id,role,default_assignee)
select id,'coach',true from public.closer_access_codes
where lower(email)='2romainorfila@gmail.com' and active and password_hash is not null
on conflict (closer_id) do nothing;
insert into public.onboarding_staff (closer_id,role)
select id,'owner' from public.closer_access_codes
where lower(email)='sonnycourt@gmail.com' and active and password_hash is not null
on conflict (closer_id) do nothing;

-- Rattrapage idempotent au chargement du CRM et à chaque actualisation (60 s).
-- Aucun trigger sur l'achat : une panne de CRM ne peut pas bloquer un achat.
create or replace function public.onboarding_sync_cases() returns integer
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_coach bigint; v_count integer;
begin
  select s.closer_id into v_coach from public.onboarding_staff s
  join public.closer_access_codes a on a.id=s.closer_id
  where s.active and s.default_assignee and a.active and a.password_hash is not null;
  if v_coach is null then raise exception 'onboarding_default_coach_missing'; end if;

  insert into public.onboarding_cases (
    email,registration_id,source,assigned_closer_id,display_name,phone,country,city,
    purchased_at,plan,payment_status,paid_installment_count
  )
  select distinct on (lower(btrim(r.email)))
    lower(btrim(r.email)),r.id,'mc2',v_coach,
    coalesce(nullif(btrim(r.billing_full_name),''),nullif(btrim(r.prenom),''),'Client'),
    coalesce(nullif(r.billing_phone,''),r.telephone),
    coalesce(nullif(r.billing_country,''),r.pays),r.billing_city,
    r.purchased_at,
    case r.checkout_last_payment_mode when 'spiffy_j7_6x347' then 'six' else 'twelve' end,
    r.payment_status,coalesce(r.paid_installment_count,0)
  from public.mc2_registrations r
  where r.purchased_at is not null and r.statut='purchased' and r.initial_payment_cents=0
    and r.checkout_last_payment_mode in ('spiffy_j7_12x197','spiffy_j7_6x347')
    and nullif(btrim(r.email),'') is not null
    and lower(r.email) <> 'demariae.cloer@vertexinbox.com'
    and lower(r.email) !~ '(sandbox|@example[.]com$)'
    and lower(coalesce(r.prenom,'')) !~ '(^|[[:space:]])test([[:space:]]|$)'
    and not exists (select 1 from public.mc2_tracking_test_registrations t where t.token=r.token)
  order by lower(btrim(r.email)),r.purchased_at asc,r.id asc
  on conflict (email) do update set
    display_name=excluded.display_name,phone=excluded.phone,country=excluded.country,city=excluded.city,
    payment_status=excluded.payment_status,paid_installment_count=excluded.paid_installment_count
  where onboarding_cases.source='mc2' and onboarding_cases.registration_id=excluded.registration_id
    and (onboarding_cases.display_name,onboarding_cases.phone,onboarding_cases.country,onboarding_cases.city,
      onboarding_cases.payment_status,onboarding_cases.paid_installment_count)
      is distinct from (excluded.display_name,excluded.phone,excluded.country,excluded.city,
      excluded.payment_status,excluded.paid_installment_count);
  get diagnostics v_count=row_count;
  return v_count;
end $$;

-- Une commande = sauvegarde + historique dans UNE transaction.
-- Verrou/version : deux onglets ne peuvent pas écraser silencieusement leurs notes.
-- command_id : rejouer après un délai réseau ne duplique pas un contact.
create or replace function public.onboarding_save_case(
  p_actor bigint,p_case uuid,p_version integer,p_command uuid,p_patch jsonb,p_kind text,p_note text
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
  if p_kind not in ('updated','call_no_answer','sms_sent','whatsapp_sent','contacted','completed','note')
    or p_kind is null or p_note is null or length(p_note)>4000 or p_command is null
    or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'onboarding_invalid'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
    ('status','next_action','followup_at','onboarding_at','coaching_at','goal','motivations','obstacles',
     'routine','notes','training_access','community_access','feedback_explained')) then raise exception 'onboarding_invalid_field'; end if;
  v_saved := jsonb_populate_record(c,p_patch);
  if v_saved.coaching_at is not null and (v_saved.coaching_at at time zone 'Europe/Paris')::date
    < (c.purchased_at at time zone 'Europe/Paris')::date+33 then raise exception 'onboarding_coaching_too_early'; end if;
  if p_kind='call_no_answer' then
    v_saved.status:='contacting'; v_saved.next_action:='sms'; v_saved.followup_at:=now();
  elsif p_kind='sms_sent' then
    v_saved.status:='awaiting'; v_saved.next_action:='whatsapp'; v_saved.followup_at:=now()+interval '24 hours';
  elsif p_kind='whatsapp_sent' then
    v_saved.status:='awaiting'; v_saved.next_action:='followup'; v_saved.followup_at:=null;
  elsif p_kind='contacted' then
    v_saved.status:='contacted'; v_saved.next_action:='onboarding'; v_saved.followup_at:=null;
  elsif p_kind='completed' then
    v_saved.status:='done'; v_saved.next_action:='none'; v_saved.followup_at:=null;
  end if;
  update public.onboarding_cases set
    status=v_saved.status,next_action=v_saved.next_action,followup_at=v_saved.followup_at,
    onboarding_at=v_saved.onboarding_at,coaching_at=v_saved.coaching_at,
    goal=v_saved.goal,motivations=v_saved.motivations,obstacles=v_saved.obstacles,routine=v_saved.routine,
    notes=v_saved.notes,training_access=v_saved.training_access,community_access=v_saved.community_access,
    feedback_explained=v_saved.feedback_explained,version=c.version+1,updated_at=now()
  where id=p_case returning * into c;
  insert into public.onboarding_events (command_id,case_id,actor_id,kind,note)
  values (p_command,p_case,p_actor,p_kind,p_note);
  return to_jsonb(c);
end $$;

revoke all on function public.onboarding_sync_cases() from public,anon,authenticated;
revoke all on function public.onboarding_save_case(bigint,uuid,integer,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.onboarding_sync_cases() to service_role;
grant execute on function public.onboarding_save_case(bigint,uuid,integer,uuid,jsonb,text,text) to service_role;

create or replace function public.onboarding_list_cases(p_actor bigint,p_filter text default 'all',p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_role text; result jsonb;
begin
  select s.role into v_role from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id
  where s.closer_id=p_actor and s.active and a.active and a.email is not null and a.password_hash is not null;
  if v_role is null then raise exception 'onboarding_forbidden' using errcode='42501'; end if;
  if p_filter not in ('all','new','due','booked','done','paused') or p_offset<0 or p_offset>100000 or length(p_search)>120 then
    raise exception 'onboarding_invalid';
  end if;
  with scoped as (
    select *, (status not in ('done','paused') and (status='new' or followup_at<=now())) as is_due
    from public.onboarding_cases where assigned_closer_id=p_actor or v_role='owner'
  ), filtered as (
    select * from scoped where
      (p_filter='all' or (p_filter='due' and is_due) or status=p_filter)
      and (p_search='' or strpos(lower(concat_ws(' ',display_name,preferred_name,email,phone,country,country_override,city,
        case country when 'FR' then 'France' when 'CA' then 'Canada' when 'BE' then 'Belgique'
          when 'CH' then 'Suisse' when 'MA' then 'Maroc' when 'GA' then 'Gabon' when 'CD' then 'RDC Congo'
          when 'BF' then 'Burkina Faso' when 'DO' then 'République dominicaine' when 'LU' then 'Luxembourg' end)),lower(p_search))>0)
  ), page as (
    select * from filtered order by is_due desc,coalesce(followup_at,purchased_at),id limit 50 offset p_offset
  )
  select jsonb_build_object(
    'cases',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'counts',(select jsonb_build_object('all',count(*),'new',count(*) filter (where status='new'),
      'due',count(*) filter (where is_due),'booked',count(*) filter (where status='booked'),
      'done',count(*) filter (where status='done'),'paused',count(*) filter (where status='paused')) from scoped)
  ) into result;
  return result;
end $$;
revoke all on function public.onboarding_list_cases(bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.onboarding_list_cases(bigint,text,text,integer) to service_role;

-- Premier rattrapage, limité aux tables onboarding, sans contacter personne.
select public.onboarding_sync_cases();
commit;
