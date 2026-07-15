-- Système Setter IA (/setter) : conversations SMS automatisées avec les no-shows,
-- console de pilotage, playbook auto-amélioré, utilisateurs dédiés.
-- À exécuter une fois dans l'éditeur SQL Supabase, AVANT le déploiement de /setter.

-- Utilisateurs de la console /setter (login email + mot de passe, hash bcrypt).
create table if not exists public.setter_users (
  id bigint generated always as identity primary key,
  email text not null unique,
  password_hash text not null,
  label text,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.setter_users enable row level security;

insert into public.setter_users (email, password_hash, label)
values ('sonnycourt@gmail.com', '$2b$12$qYnZy3uVOrY8Kp3OEdR5BeP4xpiQxFoWQY7ity3y6HXLBZZBCHXZm', 'Sonny')
on conflict (email) do nothing;

-- Conversations SMS (une par prospect, clé = téléphone normalisé).
create table if not exists public.setter_conversations (
  id bigint generated always as identity primary key,
  registration_id uuid references public.webinaire_registrations(id),
  phone text not null unique,
  prenom text,
  pays text,
  assigned_coach_id bigint references public.closer_access_codes(id),
  status text not null default 'nouveau',    -- nouveau|ouvert|relance|booke|opt_out|handoff|clos
  supervised boolean not null default true,  -- true = réponse IA validée avant envoi (premiers batchs)
  opener_variant text,                       -- variante d'ouverture (A/B testing)
  opener_sent_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  booked_rdv_at timestamptz,
  handoff_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.setter_conversations enable row level security;
create index if not exists idx_setter_conv_status on public.setter_conversations (status, updated_at desc);

-- Messages (entrants et sortants), brouillons IA inclus en mode supervisé.
create table if not exists public.setter_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.setter_conversations(id),
  direction text not null,                   -- in | out
  body text not null,
  ai_generated boolean not null default false,
  status text not null default 'envoye',     -- brouillon|a_valider|envoye|echec|recu
  created_at timestamptz not null default now()
);
alter table public.setter_messages enable row level security;
create index if not exists idx_setter_msg_conv on public.setter_messages (conversation_id, created_at);

-- Opt-out (STOP) : plus jamais contactés, quelle que soit la campagne.
create table if not exists public.setter_suppression (
  phone text primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.setter_suppression enable row level security;

-- Playbook auto-amélioré : leçons tirées des conversations (réinjectées dans le prompt IA).
create table if not exists public.setter_playbook (
  id bigint generated always as identity primary key,
  kind text not null default 'lecon',        -- lecon|objection|opener
  content text not null,
  source text,                               -- ex. 'analyse hebdo 2026-07-20'
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.setter_playbook enable row level security;

-- Réglages du système (mode supervisé global, drip/jour, plages horaires...).
create table if not exists public.setter_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.setter_settings enable row level security;

insert into public.setter_settings (key, value) values
  ('supervised_mode', 'true'::jsonb),
  ('drip_per_day', '100'::jsonb),
  ('send_window', '{"start":"09:30","end":"19:00","days":[1,2,3,4,5,6]}'::jsonb)
on conflict (key) do nothing;
