-- Delta Vision gifts. Execute in Supabase SQL editor as project owner.
-- Additive and re-runnable. No existing funnel table is modified.
-- Browser roles have no access; only the server's service_role may use these objects.
begin;

create table if not exists public.dv_gift_orders (
  id uuid primary key default gen_random_uuid(),
  spiffy_order_id text not null unique check (spiffy_order_id ~ '^[0-9]+$'),
  buyer_email text not null check (buyer_email = lower(trim(buyer_email))),
  buyer_name text not null default '',
  pack_count integer not null check (pack_count in (1,3,5)),
  amount_cents integer not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'paid' check (status in ('paid','revoked')),
  created_at timestamptz not null default now(),
  constraint dv_gift_pack_price check ((pack_count=1 and amount_cents=4700) or (pack_count=3 and amount_cents=8100) or (pack_count=5 and amount_cents=8500))
);
create table if not exists public.dv_gifts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.dv_gift_orders(id),
  slot integer not null check (slot between 1 and 5),
  recipient_email text check (recipient_email = lower(trim(recipient_email))),
  recipient_name text,
  state text not null default 'available' check (state in ('available','assigned','activating','active','revoked')),
  assigned_at timestamptz,
  activated_at timestamptz,
  circle_member_id text,
  created_at timestamptz not null default now(),
  unique(order_id,slot),
  constraint dv_gift_recipient_state check ((state='available' and recipient_email is null) or state='revoked' or (state in ('assigned','activating','active') and recipient_email is not null))
);
-- A recipient cannot consume two paid gifts accidentally, including across two orders.
create unique index if not exists dv_gifts_one_recipient on public.dv_gifts(recipient_email) where state in ('assigned','activating','active');
create table if not exists public.dv_gift_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  kind text not null check (kind in ('owner_email','gift_email','activate')),
  order_id uuid not null references public.dv_gift_orders(id),
  gift_id uuid references public.dv_gifts(id),
  state text not null default 'pending' check (state in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists dv_gift_jobs_pending on public.dv_gift_jobs(state,run_at);
create table if not exists public.dv_gift_throttles (
  key_hash text primary key,
  allowed_after timestamptz not null
);

alter table public.dv_gift_orders enable row level security;
alter table public.dv_gifts enable row level security;
alter table public.dv_gift_jobs enable row level security;
alter table public.dv_gift_throttles enable row level security;
revoke all on public.dv_gift_orders,public.dv_gifts,public.dv_gift_jobs,public.dv_gift_throttles from public,anon,authenticated;
grant select,insert,update on public.dv_gift_orders,public.dv_gifts,public.dv_gift_jobs,public.dv_gift_throttles to service_role;

create or replace function public.dv_gift_record_order(p_spiffy_order text,p_email text,p_name text,p_pack integer,p_amount integer)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.dv_gift_orders;
begin
  if p_spiffy_order !~ '^[0-9]+$' or p_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(p_email)>254 then raise exception 'invalid_order'; end if;
  insert into public.dv_gift_orders(spiffy_order_id,buyer_email,buyer_name,pack_count,amount_cents)
    values(p_spiffy_order,lower(trim(p_email)),left(p_name,100),p_pack,p_amount)
    on conflict(spiffy_order_id) do nothing;
  select * into strict o from public.dv_gift_orders where spiffy_order_id=p_spiffy_order for update;
  if o.buyer_email<>lower(trim(p_email)) or o.pack_count<>p_pack or o.amount_cents<>p_amount then raise exception 'order_conflict'; end if;
  if o.status<>'paid' then raise exception 'order_revoked'; end if;
  insert into public.dv_gifts(order_id,slot) select o.id,generate_series(1,o.pack_count) on conflict(order_id,slot) do nothing;
  insert into public.dv_gift_jobs(job_key,kind,order_id) values('owner:'||o.id,'owner_email',o.id) on conflict(job_key) do nothing;
  return o.id;
end $$;

create or replace function public.dv_gift_assign(p_order uuid,p_recipients jsonb)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.dv_gift_orders; g public.dv_gifts; item jsonb; e text; n integer:=0;
begin
  select * into strict o from public.dv_gift_orders where id=p_order for update;
  if o.status<>'paid' then raise exception 'order_revoked'; end if;
  if jsonb_typeof(p_recipients)<>'array' or jsonb_array_length(p_recipients) not between 1 and o.pack_count then raise exception 'invalid_recipients'; end if;
  for item in select * from jsonb_array_elements(p_recipients) loop
    e:=lower(trim(item->>'email'));
    if e is null or e !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(e)>254 then raise exception 'invalid_email'; end if;
    select * into strict g from public.dv_gifts where order_id=o.id and slot=(item->>'slot')::integer for update;
    if g.recipient_email=e and g.state in ('assigned','activating','active') then continue; end if;
    if g.state<>'available' then raise exception 'gift_already_assigned'; end if;
    update public.dv_gifts set recipient_email=e,state='assigned',assigned_at=now() where id=g.id;
    insert into public.dv_gift_jobs(job_key,kind,order_id,gift_id) values('invitation:'||g.id,'gift_email',o.id,g.id) on conflict(job_key) do nothing;
    n:=n+1;
  end loop;
  return n;
end $$;

create or replace function public.dv_gift_activate(p_gift uuid,p_email text,p_name text)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.dv_gifts; o public.dv_gift_orders;
begin
  select * into strict g from public.dv_gifts where id=p_gift;
  select * into strict o from public.dv_gift_orders where id=g.order_id for update;
  select * into strict g from public.dv_gifts where id=p_gift for update;
  if o.status<>'paid' or g.state not in ('assigned','activating','active') or g.recipient_email<>lower(trim(p_email)) then raise exception 'gift_invalid'; end if;
  if g.state='active' then return 'active'; end if;
  if length(trim(p_name)) not between 1 and 100 then raise exception 'invalid_name'; end if;
  update public.dv_gifts set recipient_name=trim(p_name),state='activating' where id=g.id;
  insert into public.dv_gift_jobs(job_key,kind,order_id,gift_id) values('activate:'||g.id,'activate',o.id,g.id) on conflict(job_key) do nothing;
  return 'activating';
end $$;

create or replace function public.dv_gift_throttle(p_key text,p_seconds integer)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare touched integer;
begin
  if p_key !~ '^[a-f0-9]{64}$' or p_seconds not between 30 and 86400 then raise exception 'invalid_throttle'; end if;
  insert into public.dv_gift_throttles(key_hash,allowed_after) values(p_key,now()+make_interval(secs=>p_seconds))
    on conflict(key_hash) do update set allowed_after=excluded.allowed_after where dv_gift_throttles.allowed_after<=now();
  get diagnostics touched=row_count;
  return touched=1;
end $$;

create or replace function public.dv_gift_claim_jobs(p_kinds text[],p_limit integer default 5)
returns setof public.dv_gift_jobs language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  -- A worker that lost the response after sending an email must not automatically
  -- send it again. Such email jobs require review; activation is safe to retry.
  update public.dv_gift_jobs set state=case when kind='activate' then 'pending' else 'failed' end,
    last_error='worker_timeout',lock_token=null where state='processing' and locked_at<now()-interval '5 minutes';
  return query
  with picked as (select id from public.dv_gift_jobs where state='pending' and kind=any(p_kinds) and run_at<=now() and attempts<5 order by run_at for update skip locked limit least(greatest(p_limit,1),10))
  update public.dv_gift_jobs j set state='processing',locked_at=now(),lock_token=gen_random_uuid(),attempts=attempts+1
    from picked where j.id=picked.id returning j.*;
end $$;

revoke all on function public.dv_gift_record_order(text,text,text,integer,integer),public.dv_gift_assign(uuid,jsonb),public.dv_gift_activate(uuid,text,text),public.dv_gift_throttle(text,integer),public.dv_gift_claim_jobs(text[],integer) from public,anon,authenticated;
grant execute on function public.dv_gift_record_order(text,text,text,integer,integer),public.dv_gift_assign(uuid,jsonb),public.dv_gift_activate(uuid,text,text),public.dv_gift_throttle(text,integer),public.dv_gift_claim_jobs(text[],integer) to service_role;

commit;
select to_regclass('public.dv_gift_orders') is not null and to_regclass('public.dv_gifts') is not null and to_regprocedure('public.dv_gift_assign(uuid,jsonb)') is not null as delta_gifts_ready;
