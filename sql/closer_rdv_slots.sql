-- Réservation de RDV en ligne (page /rdv) : agenda de disponibilités des closers.
-- Le lead chaud reçoit un lien SMS avec son token, choisit un créneau libre de
-- SON closer assigné ; le RDV apparaît dans la console du closer.
-- À exécuter une fois dans l'éditeur SQL Supabase, AVANT de déployer /rdv.

create table if not exists public.closer_availability_slots (
  id bigint generated always as identity primary key,
  closer_id bigint not null references public.closer_access_codes(id),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  booked_registration_id uuid references public.webinaire_registrations(id),
  booked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (closer_id, slot_start)
);

alter table public.closer_availability_slots enable row level security;

create index if not exists idx_slots_closer_start
  on public.closer_availability_slots (closer_id, slot_start);

-- Colonnes additives sur les inscrits : trace du RDV réservé en ligne.
-- rdv_at est dupliqué depuis le créneau pour lecture directe par la console.
alter table public.webinaire_registrations
  add column if not exists rdv_slot_id bigint references public.closer_availability_slots(id),
  add column if not exists rdv_at timestamptz,
  add column if not exists rdv_booked_at timestamptz;
