-- Admin dashboard ES2 — une seule exécution dans Supabase SQL Editor (projet SonnyCourt Main Site).
-- Après exécution : ouvre https://sonnycourt.com/sc-ops-2026/ et définis ton mot de passe dans l’interface.

create table if not exists public.admin_es2_auth (
  id integer primary key default 1 check (id = 1),
  password_hash text,
  updated_at timestamptz default now()
);

comment on table public.admin_es2_auth is 'Hash bcrypt du mot de passe admin dashboard /sc-ops-2026 (accès uniquement via Netlify Functions + service role).';

insert into public.admin_es2_auth (id, password_hash, updated_at)
values (1, null, now())
on conflict (id) do nothing;

alter table public.admin_es2_auth enable row level security;

-- Aucune policy : anon/authenticated n’accèdent pas ; la service role Netlify bypass RLS.
