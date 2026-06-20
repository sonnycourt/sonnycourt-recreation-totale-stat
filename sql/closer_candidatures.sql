-- Candidatures closer (page /closer-formulaire) — une seule exécution dans Supabase SQL Editor (projet SonnyCourt Main Site).
-- Reliée au code d'accès utilisé (closer_access_codes) pour savoir quel closer a candidaté.

create table if not exists public.closer_candidatures (
  id bigint generated always as identity primary key,
  code_id bigint references public.closer_access_codes (id),
  code_label text,
  code text,
  full_name text not null,
  email text not null,
  phone text not null,
  closed_highticket text not null,     -- Oui / Non
  ok_commission text not null,         -- Oui / Non / J'ai des questions
  ok_recording text not null,          -- Oui / Non
  available_jul3 text not null,        -- Oui / Non / Après le 3
  results text not null,
  audio_url text not null,
  motivation text not null,
  status text not null default 'nouveau',   -- nouveau | top | plus_tard | poubelle
  created_at timestamptz not null default now()
);

-- Si la table existe déjà : ajoute la colonne de tri.
alter table public.closer_candidatures add column if not exists status text not null default 'nouveau';

comment on table public.closer_candidatures is 'Candidatures /closer-formulaire. Accès uniquement via Netlify Functions + service role.';

create index if not exists closer_candidatures_created_idx on public.closer_candidatures (created_at desc);

alter table public.closer_candidatures enable row level security;

-- Aucune policy : anon/authenticated n'accèdent pas ; la service role Netlify bypass RLS.
