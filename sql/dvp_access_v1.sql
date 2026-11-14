-- DVP personal presentation access. Additive and rerunnable.
-- Execute manually in Supabase SQL Editor. No emails are sent by this migration.
begin;
create table if not exists public.dvp_access (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  email text not null unique check (email=lower(btrim(email))),
  first_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  position_seconds double precision not null default 0 check (position_seconds>=0),
  offer_unlocked boolean not null default false,
  mailerlite_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.dvp_access enable row level security;
revoke all on public.dvp_access from public,anon,authenticated;
grant select,insert,update on public.dvp_access to service_role;
create index if not exists dvp_access_expiry_idx on public.dvp_access(expires_at);

create or replace function public.dvp_register_access(p_email text,p_first_name text,p_browser_deadline timestamptz default null)
returns setof public.dvp_access language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if length(p_email)>254 or p_email not like '%@%.%' or length(btrim(p_first_name)) not between 1 and 100 then
    raise exception 'invalid_identity';
  end if;
  return query insert into public.dvp_access as a(email,first_name,expires_at)
  values(lower(btrim(p_email)),btrim(p_first_name),least(now()+interval '24 hours',coalesce(p_browser_deadline,now()+interval '24 hours')))
  on conflict(email) do update set
    first_name=excluded.first_name,
    expires_at=least(a.expires_at,excluded.expires_at),
    updated_at=now()
  returning a.*;
end; $$;
revoke all on function public.dvp_register_access(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.dvp_register_access(text,text,timestamptz) to service_role;

create or replace function public.dvp_save_progress(p_token uuid,p_position double precision,p_unlocked boolean default false)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.dvp_access set position_seconds=greatest(position_seconds,least(greatest(p_position,0),86400)),
    offer_unlocked=offer_unlocked or p_unlocked,updated_at=now()
  where token=p_token;
$$;
revoke all on function public.dvp_save_progress(uuid,double precision,boolean) from public,anon,authenticated;
grant execute on function public.dvp_save_progress(uuid,double precision,boolean) to service_role;
commit;
