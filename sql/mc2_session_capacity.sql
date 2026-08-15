-- Rareté réelle MC2 : trois places maximum par session.
-- Migration sûre et réexécutable. Aucune donnée existante n'est supprimée.

create table if not exists public.mc2_session_seat_reservations (
  token text primary key references public.mc2_registrations(token) on delete cascade,
  session_starts_at timestamptz not null,
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mc2_session_seat_reservations_start_expiry
  on public.mc2_session_seat_reservations (session_starts_at, expires_at desc);

alter table public.mc2_session_seat_reservations enable row level security;

comment on table public.mc2_session_seat_reservations is
  'Réservations temporaires et atomiques des places MC2, isolées par session.';

create or replace function public.mc2_session_capacity_v1(
  p_token text,
  p_capacity integer default 3
)
returns table (
  session_starts_at timestamptz,
  capacity integer,
  occupied integer,
  remaining integer,
  reserved boolean,
  reserved_until timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registration public.mc2_registrations%rowtype;
  v_occupied integer := 0;
  v_reserved_until timestamptz;
begin
  if coalesce(trim(p_token), '') = '' or p_capacity < 1 or p_capacity > 20 then
    return;
  end if;

  select * into v_registration
  from public.mc2_registrations
  where token = trim(p_token)
  limit 1;

  if not found then return; end if;

  select count(*)::integer into v_occupied
  from (
    select r.token
    from public.mc2_registrations r
    where r.session_starts_at = v_registration.session_starts_at
      and (
        r.statut = 'purchased'
        or lower(coalesce(r.payment_status, '')) in ('paid', 'succeeded', 'active', 'complete', 'completed')
      )
    union
    select s.token
    from public.mc2_session_seat_reservations s
    where s.session_starts_at = v_registration.session_starts_at
      and s.expires_at > now()
  ) occupied_tokens;

  select s.expires_at into v_reserved_until
  from public.mc2_session_seat_reservations s
  where s.token = v_registration.token
    and s.session_starts_at = v_registration.session_starts_at
    and s.expires_at > now();

  return query select
    v_registration.session_starts_at,
    p_capacity,
    least(v_occupied, p_capacity),
    greatest(0, p_capacity - v_occupied),
    v_reserved_until is not null,
    v_reserved_until;
end;
$$;

create or replace function public.mc2_reserve_session_seat_v1(
  p_token text,
  p_capacity integer default 3,
  p_hold_minutes integer default 15
)
returns table (
  accepted boolean,
  session_starts_at timestamptz,
  capacity integer,
  occupied integer,
  remaining integer,
  reserved_until timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registration public.mc2_registrations%rowtype;
  v_occupied_other integer := 0;
  v_reserved_until timestamptz;
begin
  if coalesce(trim(p_token), '') = '' or p_capacity < 1 or p_capacity > 20
     or p_hold_minutes < 1 or p_hold_minutes > 60 then
    return query select false, null::timestamptz, p_capacity, 0, 0, null::timestamptz, 'invalid_request'::text;
    return;
  end if;

  select * into v_registration
  from public.mc2_registrations
  where token = trim(p_token)
  limit 1;

  if not found then
    return query select false, null::timestamptz, p_capacity, 0, 0, null::timestamptz, 'registration_not_found'::text;
    return;
  end if;

  if v_registration.offer_expires_at is null or v_registration.offer_expires_at <= now() then
    return query select false, v_registration.session_starts_at, p_capacity, 0, 0, null::timestamptz, 'offer_expired'::text;
    return;
  end if;

  -- Une seule transaction peut réserver une place pour cette session à la fois.
  perform pg_advisory_xact_lock(hashtextextended(v_registration.session_starts_at::text, 20260815));

  delete from public.mc2_session_seat_reservations
  where expires_at <= now();

  if v_registration.statut = 'purchased'
     or lower(coalesce(v_registration.payment_status, '')) in ('paid', 'succeeded', 'active', 'complete', 'completed') then
    return query select true, v_registration.session_starts_at, p_capacity, p_capacity, 0,
      null::timestamptz, 'already_purchased'::text;
    return;
  end if;

  select count(*)::integer into v_occupied_other
  from (
    select r.token
    from public.mc2_registrations r
    where r.session_starts_at = v_registration.session_starts_at
      and r.token <> v_registration.token
      and (
        r.statut = 'purchased'
        or lower(coalesce(r.payment_status, '')) in ('paid', 'succeeded', 'active', 'complete', 'completed')
      )
    union
    select s.token
    from public.mc2_session_seat_reservations s
    where s.session_starts_at = v_registration.session_starts_at
      and s.token <> v_registration.token
      and s.expires_at > now()
  ) occupied_tokens;

  if v_occupied_other >= p_capacity then
    return query select false, v_registration.session_starts_at, p_capacity,
      least(v_occupied_other, p_capacity), 0, null::timestamptz, 'session_full'::text;
    return;
  end if;

  v_reserved_until := least(
    v_registration.offer_expires_at,
    now() + make_interval(mins => p_hold_minutes)
  );

  insert into public.mc2_session_seat_reservations (
    token, session_starts_at, reserved_at, expires_at, created_at, updated_at
  ) values (
    v_registration.token,
    v_registration.session_starts_at,
    now(),
    v_reserved_until,
    now(),
    now()
  )
  on conflict (token) do update set
    session_starts_at = excluded.session_starts_at,
    reserved_at = excluded.reserved_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  return query select true, v_registration.session_starts_at, p_capacity,
    v_occupied_other + 1,
    greatest(0, p_capacity - v_occupied_other - 1),
    v_reserved_until,
    'reserved'::text;
end;
$$;

revoke all on function public.mc2_session_capacity_v1(text, integer) from public, anon, authenticated;
revoke all on function public.mc2_reserve_session_seat_v1(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mc2_session_capacity_v1(text, integer) to service_role;
grant execute on function public.mc2_reserve_session_seat_v1(text, integer, integer) to service_role;
