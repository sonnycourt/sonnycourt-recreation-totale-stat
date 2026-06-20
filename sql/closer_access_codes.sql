-- Codes d'accès closer pour la page /closer — une seule exécution dans Supabase SQL Editor (projet SonnyCourt Main Site).
-- Un code unique par closer + tracking des visites (qui est venu voir l'offre).

create table if not exists public.closer_access_codes (
  id bigint generated always as identity primary key,
  label text not null,
  code text not null unique,
  active boolean not null default true,
  visit_count integer not null default 0,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Si la table existe déjà : ajoute la colonne de consentement confidentialité.
alter table public.closer_access_codes add column if not exists consent_at timestamptz;

comment on table public.closer_access_codes is 'Codes d''accès uniques à /closer + tracking visites. Accès uniquement via Netlify Functions + service role.';

create index if not exists closer_access_codes_code_idx on public.closer_access_codes (code);

alter table public.closer_access_codes enable row level security;

-- Aucune policy : anon/authenticated n'accèdent pas ; la service role Netlify bypass RLS.
