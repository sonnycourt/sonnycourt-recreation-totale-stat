-- Tunnel autonome du diagnostic payant avec Romain.
-- Additif uniquement : ne modifie aucune table ni fonction closer/webinaire.
-- À exécuter dans Supabase avant d'activer le checkout Spiffy en production.

create extension if not exists pgcrypto;

create table if not exists public.coach_diagnostic_slots (
  id bigint generated always as identity primary key,
  coach_slug text not null default 'romain',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available'
    check (status in ('available', 'held', 'booked', 'blocked')),
  held_until timestamptz,
  created_at timestamptz not null default now(),
  unique (coach_slug, starts_at)
);

create table if not exists public.coach_diagnostic_bookings (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  slot_id bigint not null references public.coach_diagnostic_slots(id),
  coach_slug text not null default 'romain',
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  focus text,
  note text,
  amount_eur numeric(10, 2) not null default 97,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'expired', 'refunded', 'payment_review')),
  expires_at timestamptz not null,
  paid_at timestamptz,
  refunded_at timestamptz,
  spiffy_order_id text,
  created_at timestamptz not null default now()
);

-- Rend les anciennes installations de ce schéma compatibles avec le nouveau
-- parcours : seules les informations indispensables sont demandées avant paiement.
alter table public.coach_diagnostic_bookings alter column customer_phone drop not null;
alter table public.coach_diagnostic_bookings alter column focus drop not null;

alter table public.coach_diagnostic_slots enable row level security;
alter table public.coach_diagnostic_bookings enable row level security;

grant all on public.coach_diagnostic_slots, public.coach_diagnostic_bookings to service_role;
grant usage, select on sequence public.coach_diagnostic_slots_id_seq to service_role;

create index if not exists idx_coach_diagnostic_slots_available
  on public.coach_diagnostic_slots (coach_slug, starts_at, status);

create index if not exists idx_coach_diagnostic_bookings_email
  on public.coach_diagnostic_bookings (customer_email, created_at desc);

-- Réservation temporaire atomique : un créneau ne peut pas être pris par deux
-- prospects, même si deux paiements sont lancés au même instant.
drop function if exists public.hold_coach_diagnostic_slot(bigint, text, text, text, text, text);

create or replace function public.hold_coach_diagnostic_slot(
  p_slot_id bigint,
  p_name text,
  p_email text
)
returns table (
  booking_token uuid,
  expires_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.coach_diagnostic_slots%rowtype;
  v_booking public.coach_diagnostic_bookings%rowtype;
  v_expires timestamptz := now() + interval '20 minutes';
begin
  update public.coach_diagnostic_bookings as booking
     set status = 'expired'
   where booking.status = 'pending_payment'
     and booking.expires_at < now();

  update public.coach_diagnostic_slots as slot
     set status = 'available', held_until = null
   where slot.status = 'held'
     and slot.held_until < now();

  update public.coach_diagnostic_slots as slot
     set status = 'held', held_until = v_expires
   where slot.id = p_slot_id
     and slot.coach_slug = 'romain'
     and slot.starts_at > now() + interval '2 hours'
     and slot.status = 'available'
  returning slot.* into v_slot;

  if v_slot.id is null then
    raise exception 'slot_unavailable';
  end if;

  insert into public.coach_diagnostic_bookings (
    slot_id,
    coach_slug,
    customer_name,
    customer_email,
    expires_at
  ) values (
    v_slot.id,
    'romain',
    left(trim(p_name), 60),
    lower(left(trim(p_email), 254)),
    v_expires
  )
  returning * into v_booking;

  return query
    select v_booking.public_token, v_expires, v_slot.starts_at, v_slot.ends_at;
end;
$$;

revoke all on function public.hold_coach_diagnostic_slot(bigint, text, text) from public;
grant execute on function public.hold_coach_diagnostic_slot(bigint, text, text) to service_role;

-- Exemple volontairement commenté : les vrais horaires de Romain doivent être
-- ajoutés seulement après validation de son agenda.
-- insert into public.coach_diagnostic_slots (starts_at, ends_at)
-- values ('2026-08-03 09:30:00+02', '2026-08-03 10:15:00+02');
