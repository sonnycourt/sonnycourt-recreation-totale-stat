-- Webinaire Esprit Subconscient 2.0 — à exécuter dans Supabase (SQL editor)
-- Source de vérité : Supabase. Les Netlify Functions utilisent SUPABASE_SERVICE_ROLE_KEY.
khjioh
create table if not exists public.webinaire_registrations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  email text not null unique,
  prenom text,
  telephone text,
  pays text,
  creneau text not null check (creneau in ('14h', '20h')),
  session_date timestamptz not null,
  session_ends_at timestamptz not null,
  offre_expires_at timestamptz not null,
  statut text not null default 'inscrit'
    check (statut in ('inscrit', 'present', 'acheteur', 'no-show', 'non-acheteur')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.webinaire_registrations
  add column if not exists mailerlite_group_added_at timestamptz;

alter table public.webinaire_registrations
  add column if not exists whatsapp_group_number integer;

alter table public.webinaire_registrations
  add column if not exists whatsapp_link text;

create index if not exists idx_webinaire_registrations_token
  on public.webinaire_registrations (token);

create index if not exists idx_webinaire_registrations_email
  on public.webinaire_registrations (email);

create index if not exists idx_webinaire_registrations_offre_statut
  on public.webinaire_registrations (offre_expires_at, statut);

create table if not exists public.webinaire_exclusions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  raison text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_webinaire_exclusions_email
  on public.webinaire_exclusions (email);

-- Optionnel : trigger updated_at (PostgreSQL / Supabase)
create or replace function public.set_webinaire_registrations_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_webinaire_registrations_updated_at on public.webinaire_registrations;
create trigger tr_webinaire_registrations_updated_at
  before update on public.webinaire_registrations
  for each row execute function public.set_webinaire_registrations_updated_at();

-- RLS : accès via service role uniquement (recommandé pour ces tables)
alter table public.webinaire_registrations enable row level security;
alter table public.webinaire_exclusions enable row level security;

-- Aucune policy publique : la clé service bypass RLS.

comment on table public.webinaire_registrations is 'Inscriptions webinaire ES 2.0 evergreen';
comment on table public.webinaire_exclusions is 'Emails exclus du webinaire (acheteurs formations, etc.)';
