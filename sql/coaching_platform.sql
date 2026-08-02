-- Plateforme coaching Sonny Court
-- Migration additive : toutes les tables sont préfixées coaching_.
-- Aucune table existante n'est supprimée ou renommée.

create extension if not exists pgcrypto;

create or replace function public.coaching_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.coaching_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'coach', 'client')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coaching_coaches (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  slug text not null unique,
  first_name text not null,
  last_name text,
  email text,
  avatar_url text,
  timezone text not null default 'Europe/Zurich',
  status text not null default 'active' check (status in ('invited', 'active', 'paused', 'archived')),
  google_calendar_id text,
  calendar_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coaching_coaches add column if not exists avatar_url text;

create unique index if not exists coaching_coaches_email_unique
  on public.coaching_coaches (lower(email)) where email is not null;

create table if not exists public.coaching_clients (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  coach_id uuid references public.coaching_coaches(id) on delete set null,
  first_name text not null,
  last_name text,
  email text not null,
  phone text,
  country text,
  timezone text not null default 'Europe/Zurich',
  status text not null default 'active' check (status in ('lead', 'active', 'paused', 'completed', 'archived')),
  objective text,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists coaching_clients_email_unique
  on public.coaching_clients (lower(email));
create index if not exists coaching_clients_coach_idx on public.coaching_clients(coach_id, status);

create table if not exists public.coaching_offers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sessions_count integer not null check (sessions_count > 0),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR',
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 240),
  validity_days integer check (validity_days is null or validity_days > 0),
  spiffy_checkout_id text,
  spiffy_checkout_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coaching_engagements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  coach_id uuid references public.coaching_coaches(id) on delete set null,
  offer_id uuid references public.coaching_offers(id) on delete set null,
  status text not null default 'active' check (status in ('pending', 'active', 'paused', 'completed', 'cancelled')),
  objective text,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coaching_engagements_client_idx on public.coaching_engagements(client_id, status);
create index if not exists coaching_engagements_coach_idx on public.coaching_engagements(coach_id, status);

create table if not exists public.coaching_availability_slots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaching_coaches(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available', 'held', 'booked', 'blocked')),
  source text not null default 'google' check (source in ('google', 'manual')),
  google_event_id text,
  held_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coach_id, starts_at),
  check (ends_at > starts_at)
);

create index if not exists coaching_availability_open_idx
  on public.coaching_availability_slots(coach_id, starts_at)
  where status = 'available';

create table if not exists public.coaching_availability_rules (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaching_coaches(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null default 60 check (slot_minutes between 15 and 240),
  buffer_minutes integer not null default 15 check (buffer_minutes between 0 and 120),
  timezone text not null default 'Europe/Zurich',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (coach_id, weekday, start_time, end_time)
);

create table if not exists public.coaching_google_connections (
  coach_id uuid primary key references public.coaching_coaches(id) on delete cascade,
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  access_expires_at timestamptz,
  scope text,
  google_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coaching_google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaching_coaches(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  coach_id uuid not null references public.coaching_coaches(id) on delete restrict,
  engagement_id uuid references public.coaching_engagements(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Europe/Zurich',
  status text not null default 'confirmed' check (status in ('held', 'confirmed', 'completed', 'cancelled', 'no_show')),
  source text not null default 'portal' check (source in ('portal', 'spiffy', 'google', 'manual', 'migration')),
  google_event_id text,
  meet_url text,
  cancelled_at timestamptz,
  cancellation_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists coaching_sessions_coach_start_unique
  on public.coaching_sessions(coach_id, starts_at)
  where status in ('held', 'confirmed');
create index if not exists coaching_sessions_client_idx on public.coaching_sessions(client_id, starts_at desc);
create index if not exists coaching_sessions_coach_idx on public.coaching_sessions(coach_id, starts_at desc);

create table if not exists public.coaching_form_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  purpose text not null check (purpose in ('first_consultation', 'session_preparation', 'assessment', 'other')),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, version)
);

create table if not exists public.coaching_form_responses (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.coaching_form_templates(id) on delete restrict,
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  session_id uuid references public.coaching_sessions(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'archived')),
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coaching_form_responses_client_idx on public.coaching_form_responses(client_id, created_at desc);
create index if not exists coaching_form_responses_session_idx on public.coaching_form_responses(session_id);

create table if not exists public.coaching_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.coaching_clients(id) on delete restrict,
  offer_id uuid not null references public.coaching_offers(id) on delete restrict,
  engagement_id uuid references public.coaching_engagements(id) on delete set null,
  provider text not null default 'spiffy',
  provider_order_id text not null,
  status text not null default 'paid' check (status in ('pending', 'paid', 'refunded', 'partially_refunded', 'disputed', 'failed')),
  amount_cents integer not null check (amount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  currency text not null default 'EUR',
  billing_country text,
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_order_id)
);

create index if not exists coaching_orders_client_idx on public.coaching_orders(client_id, purchased_at desc);

create table if not exists public.coaching_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  engagement_id uuid references public.coaching_engagements(id) on delete set null,
  order_id uuid references public.coaching_orders(id) on delete set null,
  session_id uuid references public.coaching_sessions(id) on delete set null,
  quantity integer not null check (quantity <> 0),
  reason text not null check (reason in ('purchase', 'booking', 'cancellation', 'refund', 'manual_adjustment', 'migration')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists coaching_credit_one_booking_debit
  on public.coaching_credit_ledger(session_id, reason) where reason = 'booking';
create index if not exists coaching_credit_client_idx on public.coaching_credit_ledger(client_id, created_at);

create table if not exists public.coaching_session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.coaching_sessions(id) on delete cascade,
  coach_id uuid not null references public.coaching_coaches(id) on delete restrict,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'final')),
  intention text,
  observations text,
  decision text,
  commitment text,
  next_focus text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, coach_id)
);

create table if not exists public.coaching_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.coaching_clients(id) on delete cascade,
  coach_id uuid references public.coaching_coaches(id) on delete cascade,
  session_id uuid references public.coaching_sessions(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  visibility text not null default 'coach' check (visibility in ('coach', 'client', 'owner')),
  origin text not null default 'manual' check (origin in ('manual', 'automation')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coaching_activity_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  client_id uuid references public.coaching_clients(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists coaching_activity_created_idx on public.coaching_activity_log(created_at desc);
create index if not exists coaching_activity_client_idx on public.coaching_activity_log(client_id, created_at desc);

-- Jetons à usage unique envoyés après un achat. Seul le hash est stocké :
-- le lien brut n'existe que dans l'email du client.
create table if not exists public.coaching_account_activations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  order_id uuid references public.coaching_orders(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coaching_activations_open_idx
  on public.coaching_account_activations(expires_at)
  where used_at is null;

create table if not exists public.coaching_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.coaching_sessions(id) on delete cascade,
  order_id uuid references public.coaching_orders(id) on delete cascade,
  client_id uuid references public.coaching_clients(id) on delete cascade,
  kind text not null,
  recipient_email text not null,
  provider text not null default 'mailersend',
  status text not null default 'sent' check (status in ('sent', 'failed')),
  created_at timestamptz not null default now(),
  unique (session_id, kind, recipient_email)
);

alter table public.coaching_email_deliveries add column if not exists order_id uuid references public.coaching_orders(id) on delete cascade;
create unique index if not exists coaching_email_order_delivery_unique
  on public.coaching_email_deliveries(order_id, kind, recipient_email);

-- Helpers d'autorisation : les rôles sont lus dans une table contrôlée, jamais
-- dans les métadonnées modifiables par l'utilisateur.
create or replace function public.coaching_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.coaching_memberships
  where user_id = auth.uid() and active = true
  limit 1
$$;

create or replace function public.coaching_current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.coaching_clients where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.coaching_current_coach_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.coaching_coaches where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.coaching_can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.coaching_current_role() = 'owner'
    or p_client_id = public.coaching_current_client_id()
    or exists (
      select 1 from public.coaching_clients c
      where c.id = p_client_id
        and c.coach_id = public.coaching_current_coach_id()
    )
$$;

revoke all on function public.coaching_current_role() from public;
revoke all on function public.coaching_current_client_id() from public;
revoke all on function public.coaching_current_coach_id() from public;
revoke all on function public.coaching_can_access_client(uuid) from public;
grant execute on function public.coaching_current_role() to authenticated;
grant execute on function public.coaching_current_client_id() to authenticated;
grant execute on function public.coaching_current_coach_id() to authenticated;
grant execute on function public.coaching_can_access_client(uuid) to authenticated;

-- Rattachement sûr d'un compte à un client déjà connu. Un visiteur qui utilise
-- Google SSO sans achat ou invitation ne crée aucun dossier vide et ne reçoit
-- aucun rôle. Les coachs et propriétaires sont attribués côté serveur.
create or replace function public.coaching_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
  v_client_id uuid;
begin
  v_first_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'Élève');
  v_last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');

  if new.email is not null then
    update public.coaching_clients
    set auth_user_id = new.id,
        first_name = coalesce(nullif(public.coaching_clients.first_name, ''), v_first_name),
        last_name = coalesce(public.coaching_clients.last_name, v_last_name),
        updated_at = now()
    where lower(email) = lower(new.email)
      and (auth_user_id is null or auth_user_id = new.id)
    returning id into v_client_id;

    if v_client_id is not null then
      insert into public.coaching_memberships(user_id, role, active)
      values (new.id, 'client', true)
      on conflict (user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists coaching_auth_user_created on auth.users;
create trigger coaching_auth_user_created
after insert on auth.users
for each row execute function public.coaching_handle_new_auth_user();

-- Timestamps.
do $$
declare
  t text;
begin
  foreach t in array array[
    'coaching_memberships','coaching_coaches','coaching_clients','coaching_offers',
    'coaching_engagements','coaching_availability_slots','coaching_availability_rules','coaching_sessions','coaching_form_templates',
    'coaching_form_responses','coaching_orders','coaching_session_notes','coaching_actions','coaching_google_connections'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.coaching_set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- RLS.
alter table public.coaching_memberships enable row level security;
alter table public.coaching_coaches enable row level security;
alter table public.coaching_clients enable row level security;
alter table public.coaching_offers enable row level security;
alter table public.coaching_engagements enable row level security;
alter table public.coaching_availability_slots enable row level security;
alter table public.coaching_availability_rules enable row level security;
alter table public.coaching_google_connections enable row level security;
alter table public.coaching_google_oauth_states enable row level security;
alter table public.coaching_sessions enable row level security;
alter table public.coaching_form_templates enable row level security;
alter table public.coaching_form_responses enable row level security;
alter table public.coaching_orders enable row level security;
alter table public.coaching_credit_ledger enable row level security;
alter table public.coaching_session_notes enable row level security;
alter table public.coaching_actions enable row level security;
alter table public.coaching_activity_log enable row level security;
alter table public.coaching_account_activations enable row level security;
alter table public.coaching_email_deliveries enable row level security;

drop policy if exists coaching_memberships_read on public.coaching_memberships;
create policy coaching_memberships_read on public.coaching_memberships for select to authenticated
using (user_id = auth.uid() or public.coaching_current_role() = 'owner');
drop policy if exists coaching_memberships_owner_write on public.coaching_memberships;
create policy coaching_memberships_owner_write on public.coaching_memberships for all to authenticated
using (public.coaching_current_role() = 'owner') with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_coaches_read on public.coaching_coaches;
create policy coaching_coaches_read on public.coaching_coaches for select to authenticated
using (
  public.coaching_current_role() = 'owner'
  or auth_user_id = auth.uid()
  or id = (select coach_id from public.coaching_clients where auth_user_id = auth.uid() limit 1)
);
drop policy if exists coaching_coaches_owner_write on public.coaching_coaches;
create policy coaching_coaches_owner_write on public.coaching_coaches for all to authenticated
using (public.coaching_current_role() = 'owner') with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_clients_read on public.coaching_clients;
create policy coaching_clients_read on public.coaching_clients for select to authenticated
using (public.coaching_can_access_client(id));
drop policy if exists coaching_clients_staff_write on public.coaching_clients;
create policy coaching_clients_staff_write on public.coaching_clients for update to authenticated
using (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id())
with check (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id());
drop policy if exists coaching_clients_owner_insert on public.coaching_clients;
create policy coaching_clients_owner_insert on public.coaching_clients for insert to authenticated
with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_offers_public_read on public.coaching_offers;
create policy coaching_offers_public_read on public.coaching_offers for select to anon, authenticated
using (is_active = true);
drop policy if exists coaching_offers_owner_read on public.coaching_offers;
create policy coaching_offers_owner_read on public.coaching_offers for select to authenticated
using (public.coaching_current_role() = 'owner');
drop policy if exists coaching_offers_owner_write on public.coaching_offers;
create policy coaching_offers_owner_write on public.coaching_offers for all to authenticated
using (public.coaching_current_role() = 'owner') with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_engagements_read on public.coaching_engagements;
create policy coaching_engagements_read on public.coaching_engagements for select to authenticated
using (public.coaching_can_access_client(client_id));
drop policy if exists coaching_engagements_staff_write on public.coaching_engagements;
create policy coaching_engagements_staff_write on public.coaching_engagements for all to authenticated
using (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and exists (
      select 1 from public.coaching_clients c
      where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
    )
  )
) with check (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and exists (
      select 1 from public.coaching_clients c
      where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
    )
  )
);

drop policy if exists coaching_availability_read on public.coaching_availability_slots;
create policy coaching_availability_read on public.coaching_availability_slots for select to authenticated
using (
  (status = 'available' and coach_id = (select coach_id from public.coaching_clients where auth_user_id = auth.uid() limit 1))
  or public.coaching_current_role() = 'owner'
  or coach_id = public.coaching_current_coach_id()
);
drop policy if exists coaching_availability_staff_write on public.coaching_availability_slots;
create policy coaching_availability_staff_write on public.coaching_availability_slots for all to authenticated
using (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id())
with check (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id());

drop policy if exists coaching_availability_rules_staff on public.coaching_availability_rules;
create policy coaching_availability_rules_staff on public.coaching_availability_rules for all to authenticated
using (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id())
with check (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id());

drop policy if exists coaching_sessions_read on public.coaching_sessions;
create policy coaching_sessions_read on public.coaching_sessions for select to authenticated
using (public.coaching_can_access_client(client_id));
drop policy if exists coaching_sessions_staff_write on public.coaching_sessions;
create policy coaching_sessions_staff_write on public.coaching_sessions for all to authenticated
using (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and exists (
      select 1 from public.coaching_clients c
      where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
    )
  )
) with check (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and exists (
      select 1 from public.coaching_clients c
      where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
    )
  )
);

drop policy if exists coaching_templates_read on public.coaching_form_templates;
create policy coaching_templates_read on public.coaching_form_templates for select to authenticated
using (status = 'active' or public.coaching_current_role() = 'owner');
drop policy if exists coaching_templates_owner_write on public.coaching_form_templates;
create policy coaching_templates_owner_write on public.coaching_form_templates for all to authenticated
using (public.coaching_current_role() = 'owner') with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_responses_read on public.coaching_form_responses;
create policy coaching_responses_read on public.coaching_form_responses for select to authenticated
using (public.coaching_can_access_client(client_id));
drop policy if exists coaching_responses_client_insert on public.coaching_form_responses;
create policy coaching_responses_client_insert on public.coaching_form_responses for insert to authenticated
with check (client_id = public.coaching_current_client_id() and submitted_by = auth.uid());
drop policy if exists coaching_responses_client_update on public.coaching_form_responses;
create policy coaching_responses_client_update on public.coaching_form_responses for update to authenticated
using (client_id = public.coaching_current_client_id() and submitted_by = auth.uid() and session_id is null)
with check (client_id = public.coaching_current_client_id() and submitted_by = auth.uid() and session_id is null);
drop policy if exists coaching_responses_staff_write on public.coaching_form_responses;
create policy coaching_responses_staff_write on public.coaching_form_responses for all to authenticated
using (public.coaching_current_role() = 'owner' or exists (
  select 1 from public.coaching_clients c where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
)) with check (public.coaching_current_role() = 'owner' or exists (
  select 1 from public.coaching_clients c where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
));

drop policy if exists coaching_orders_read on public.coaching_orders;
create policy coaching_orders_read on public.coaching_orders for select to authenticated
using (public.coaching_current_role() = 'owner' or client_id = public.coaching_current_client_id());

drop policy if exists coaching_credits_read on public.coaching_credit_ledger;
create policy coaching_credits_read on public.coaching_credit_ledger for select to authenticated
using (public.coaching_can_access_client(client_id));

-- Les notes privées appartiennent au coach. Même le rôle propriétaire ne les
-- lit pas depuis le navigateur.
drop policy if exists coaching_notes_coach_only on public.coaching_session_notes;
create policy coaching_notes_coach_only on public.coaching_session_notes for all to authenticated
using (
  coach_id = public.coaching_current_coach_id()
  and author_user_id = auth.uid()
  and exists (
    select 1
    from public.coaching_sessions s
    join public.coaching_clients c on c.id = s.client_id
    where s.id = session_id
      and s.coach_id = public.coaching_current_coach_id()
      and c.coach_id = public.coaching_current_coach_id()
  )
) with check (
  coach_id = public.coaching_current_coach_id()
  and author_user_id = auth.uid()
  and exists (
    select 1
    from public.coaching_sessions s
    join public.coaching_clients c on c.id = s.client_id
    where s.id = session_id
      and s.coach_id = public.coaching_current_coach_id()
      and c.coach_id = public.coaching_current_coach_id()
  )
);

drop policy if exists coaching_actions_read on public.coaching_actions;
create policy coaching_actions_read on public.coaching_actions for select to authenticated
using (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and (
      client_id is null
      or exists (
        select 1 from public.coaching_clients c
        where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
      )
    )
  )
  or (visibility = 'client' and client_id = public.coaching_current_client_id())
);
drop policy if exists coaching_actions_staff_write on public.coaching_actions;
create policy coaching_actions_staff_write on public.coaching_actions for all to authenticated
using (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and (
      client_id is null
      or exists (
        select 1 from public.coaching_clients c
        where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
      )
    )
  )
) with check (
  public.coaching_current_role() = 'owner'
  or (
    coach_id = public.coaching_current_coach_id()
    and (
      client_id is null
      or exists (
        select 1 from public.coaching_clients c
        where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
      )
    )
  )
);

drop policy if exists coaching_activity_owner_read on public.coaching_activity_log;
create policy coaching_activity_owner_read on public.coaching_activity_log for select to authenticated
using (public.coaching_current_role() = 'owner');

-- Grants minimaux. Les écritures de paiements et crédits passent uniquement par
-- le service role ou les fonctions contrôlées ci-dessous.
grant select on public.coaching_offers to anon;
grant select, insert, update on public.coaching_memberships to authenticated;
grant select, insert, update on public.coaching_coaches to authenticated;
grant select, insert, update on public.coaching_clients to authenticated;
grant select, insert, update on public.coaching_offers to authenticated;
grant select, insert, update on public.coaching_engagements to authenticated;
grant select, insert, update on public.coaching_availability_slots to authenticated;
grant select, insert, update, delete on public.coaching_availability_rules to authenticated;
grant select, insert, update on public.coaching_sessions to authenticated;
grant select, insert, update on public.coaching_form_templates to authenticated;
grant select, insert, update on public.coaching_form_responses to authenticated;
revoke select on public.coaching_orders from authenticated;
grant select (
  id, client_id, offer_id, engagement_id, provider, provider_order_id, status,
  amount_cents, tax_cents, currency, billing_country, purchased_at, refunded_at,
  created_at, updated_at
) on public.coaching_orders to authenticated;
grant select on public.coaching_credit_ledger to authenticated;
grant select, insert, update on public.coaching_session_notes to authenticated;
grant select, insert, update on public.coaching_actions to authenticated;
grant select on public.coaching_activity_log to authenticated;
grant usage, select on sequence public.coaching_activity_log_id_seq to authenticated;
grant all on public.coaching_memberships, public.coaching_coaches, public.coaching_clients,
  public.coaching_offers, public.coaching_engagements, public.coaching_availability_slots,
  public.coaching_availability_rules, public.coaching_google_connections,
  public.coaching_google_oauth_states, public.coaching_sessions,
  public.coaching_form_templates, public.coaching_form_responses, public.coaching_orders,
  public.coaching_credit_ledger, public.coaching_session_notes, public.coaching_actions,
  public.coaching_activity_log, public.coaching_account_activations,
  public.coaching_email_deliveries to service_role;
grant usage, select on sequence public.coaching_activity_log_id_seq to service_role;
revoke all on public.coaching_account_activations from anon, authenticated;
grant all on public.coaching_account_activations to service_role;
revoke all on public.coaching_email_deliveries from anon, authenticated;
grant all on public.coaching_email_deliveries to service_role;
revoke all on public.coaching_google_connections, public.coaching_google_oauth_states from anon, authenticated;
grant all on public.coaching_google_connections, public.coaching_google_oauth_states to service_role;

-- Solde de crédits calculé depuis le journal append-only.
create or replace function public.coaching_credit_balance(p_client_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)::integer
  from public.coaching_credit_ledger ledger
  left join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
  where ledger.client_id = p_client_id
    and public.coaching_can_access_client(p_client_id)
    and (
      ledger.engagement_id is null
      or (
        engagement.status = 'active'
        and (engagement.expires_at is null or engagement.expires_at > now())
      )
    )
$$;
revoke all on function public.coaching_credit_balance(uuid) from public;
grant execute on function public.coaching_credit_balance(uuid) to authenticated;

create or replace function public.coaching_replace_my_availability_rules(
  p_weekdays smallint[],
  p_start_time time,
  p_end_time time,
  p_slot_minutes integer,
  p_buffer_minutes integer,
  p_timezone text default 'Europe/Zurich'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid := public.coaching_current_coach_id();
  v_count integer;
begin
  if public.coaching_current_role() <> 'coach' or v_coach_id is null then raise exception 'coach_required'; end if;
  if coalesce(array_length(p_weekdays, 1), 0) = 0 or exists (select 1 from unnest(p_weekdays) as d(day_number) where day_number not between 1 and 7) then raise exception 'invalid_weekdays'; end if;
  if p_end_time <= p_start_time or p_slot_minutes not between 15 and 240 or p_buffer_minutes not between 0 and 120 then raise exception 'invalid_schedule'; end if;
  delete from public.coaching_availability_rules where coach_id = v_coach_id;
  insert into public.coaching_availability_rules(coach_id, weekday, start_time, end_time, slot_minutes, buffer_minutes, timezone)
  select v_coach_id, day, p_start_time, p_end_time, p_slot_minutes, p_buffer_minutes, left(coalesce(p_timezone, 'Europe/Zurich'), 80)
  from (select distinct unnest(p_weekdays) as day) days;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.coaching_replace_my_availability_rules(smallint[], time, time, integer, integer, text) from public;
grant execute on function public.coaching_replace_my_availability_rules(smallint[], time, time, integer, integer, text) to authenticated;

-- Réservation transactionnelle depuis le portail élève.
create or replace function public.coaching_book_session(
  p_slot_id uuid,
  p_timezone text default 'Europe/Zurich'
)
returns table(session_id uuid, starts_at timestamptz, ends_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.coaching_clients%rowtype;
  v_engagement public.coaching_engagements%rowtype;
  v_duration integer := 60;
  v_balance integer;
  v_session public.coaching_sessions%rowtype;
  v_slot public.coaching_availability_slots%rowtype;
begin
  if public.coaching_current_role() <> 'client' then raise exception 'client_required'; end if;

  select * into v_client from public.coaching_clients where auth_user_id = auth.uid() for update;
  if v_client.id is null then raise exception 'client_profile_missing'; end if;
  if v_client.coach_id is null then raise exception 'coach_not_assigned'; end if;

  select slot.* into v_slot
  from public.coaching_availability_slots slot
  where slot.id = p_slot_id
    and slot.coach_id = v_client.coach_id
    and slot.status = 'available'
    and slot.starts_at > now() + interval '2 hours'
  for update;
  if v_slot.id is null then raise exception 'slot_unavailable'; end if;
  if not exists (
    select 1 from public.coaching_form_responses response
    where response.client_id = v_client.id
      and response.status = 'submitted'
      and response.session_id is null
  ) then raise exception 'preparation_required'; end if;

  -- Consomme d'abord le cycle qui expire le plus tôt. Un engagement expiré
  -- ou sans crédit propre ne peut jamais financer une nouvelle séance.
  select engagement.* into v_engagement
  from public.coaching_engagements engagement
  where engagement.client_id = v_client.id
    and engagement.status = 'active'
    and (engagement.expires_at is null or engagement.expires_at > now())
    and (
      select coalesce(sum(ledger.quantity), 0)
      from public.coaching_credit_ledger ledger
      where ledger.engagement_id = engagement.id
    ) > 0
  order by engagement.expires_at asc nulls last, engagement.started_at asc
  limit 1;
  if v_engagement.id is null then raise exception 'engagement_missing'; end if;

  select coalesce(sum(quantity), 0)::integer into v_balance
  from public.coaching_credit_ledger ledger
  left join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
  where ledger.client_id = v_client.id
    and (
      ledger.engagement_id is null
      or (
        engagement.status = 'active'
        and (engagement.expires_at is null or engagement.expires_at > now())
      )
    );
  if v_balance <= 0 then raise exception 'no_credit'; end if;

  select coalesce(o.duration_minutes, 60) into v_duration
  from public.coaching_offers o where o.id = v_engagement.offer_id;
  v_duration := coalesce(v_duration, 60);

  update public.coaching_availability_slots
  set status = 'booked', held_until = null
  where id = v_slot.id;

  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, timezone, status, source)
  values (v_client.id, v_client.coach_id, v_engagement.id, v_slot.starts_at, least(v_slot.ends_at, v_slot.starts_at + make_interval(mins => v_duration)), left(coalesce(p_timezone, 'Europe/Zurich'), 80), 'confirmed', 'portal')
  returning * into v_session;

  insert into public.coaching_credit_ledger(client_id, engagement_id, session_id, quantity, reason, created_by)
  values (v_client.id, v_engagement.id, v_session.id, -1, 'booking', auth.uid());

  update public.coaching_form_responses
  set session_id = v_session.id
  where id = (
    select response.id from public.coaching_form_responses response
    where response.client_id = v_client.id and response.status = 'submitted' and response.session_id is null
    order by response.submitted_at desc nulls last, response.created_at desc
    limit 1
  );

  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id, metadata)
  values (auth.uid(), 'session.booked', 'session', v_session.id, v_client.id, jsonb_build_object('starts_at', v_session.starts_at));

  return query select v_session.id, v_session.starts_at, v_session.ends_at, v_balance - 1;
exception
  when unique_violation then raise exception 'slot_unavailable';
end;
$$;
revoke all on function public.coaching_book_session(uuid, text) from public;
grant execute on function public.coaching_book_session(uuid, text) to authenticated;

create or replace function public.coaching_cancel_session(p_session_id uuid, p_reason text default null)
returns table(session_id uuid, credits_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.coaching_sessions%rowtype;
  v_balance integer;
begin
  select * into v_session from public.coaching_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if not public.coaching_can_access_client(v_session.client_id) then raise exception 'forbidden'; end if;
  if v_session.status <> 'confirmed' then raise exception 'session_not_cancellable'; end if;
  if v_session.starts_at <= now() then raise exception 'session_already_started'; end if;

  update public.coaching_sessions
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = left(p_reason, 500)
  where id = v_session.id;

  update public.coaching_availability_slots
  set status = 'available'
  where coach_id = v_session.coach_id
    and starts_at = v_session.starts_at
    and status = 'booked';

  -- Seule une séance ayant réellement débité un crédit peut en restituer un.
  -- Une séance manuelle ou migrée ne doit jamais permettre de créer du solde.
  insert into public.coaching_credit_ledger(client_id, engagement_id, session_id, quantity, reason, created_by)
  select v_session.client_id, v_session.engagement_id, v_session.id, 1, 'cancellation', auth.uid()
  where exists (
    select 1 from public.coaching_credit_ledger debit
    where debit.session_id = v_session.id and debit.reason = 'booking' and debit.quantity < 0
  )
  and not exists (
    select 1 from public.coaching_credit_ledger credit
    where credit.session_id = v_session.id and credit.reason = 'cancellation'
  );

  select coalesce(sum(quantity), 0)::integer into v_balance
  from public.coaching_credit_ledger ledger
  left join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
  where ledger.client_id = v_session.client_id
    and (
      ledger.engagement_id is null
      or (
        engagement.status = 'active'
        and (engagement.expires_at is null or engagement.expires_at > now())
      )
    );

  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id)
  values (auth.uid(), 'session.cancelled', 'session', v_session.id, v_session.client_id);

  return query select v_session.id, v_balance;
end;
$$;
revoke all on function public.coaching_cancel_session(uuid, text) from public;
grant execute on function public.coaching_cancel_session(uuid, text) to authenticated;

-- Clôture explicite par le coach : la séance sort de l'agenda actif, reste
-- dans l'historique du client et génère une trace opérationnelle sans exposer
-- la note privée.
create or replace function public.coaching_complete_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.coaching_sessions%rowtype;
begin
  if public.coaching_current_role() <> 'coach' then raise exception 'coach_required'; end if;
  select session.* into v_session
  from public.coaching_sessions session
  where session.id = p_session_id
    and session.coach_id = public.coaching_current_coach_id()
  for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_session.status <> 'confirmed' then raise exception 'session_not_completable'; end if;
  if v_session.starts_at > now() + interval '15 minutes' then raise exception 'session_too_early'; end if;

  update public.coaching_sessions
  set status = 'completed', completed_at = now()
  where id = v_session.id;

  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id)
  values (auth.uid(), 'session.completed', 'session', v_session.id, v_session.client_id);
  return v_session.id;
end;
$$;
revoke all on function public.coaching_complete_session(uuid) from public;
grant execute on function public.coaching_complete_session(uuid) to authenticated;

-- Enregistrement idempotent d'une commande Spiffy. Exécutable uniquement avec
-- la clé service role côté serveur.
create or replace function public.coaching_record_spiffy_order(
  p_provider_order_id text,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_offer_slug text,
  p_amount_cents integer,
  p_tax_cents integer default 0,
  p_currency text default 'EUR',
  p_country text default null,
  p_raw_payload jsonb default null
)
returns table(order_id uuid, client_id uuid, engagement_id uuid, credits_added integer, already_processed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.coaching_orders%rowtype;
  v_client public.coaching_clients%rowtype;
  v_offer public.coaching_offers%rowtype;
  v_coach_id uuid;
  v_auth_user_id uuid;
  v_auth_role text;
  v_engagement_id uuid;
  v_order_id uuid;
begin
  select * into v_existing from public.coaching_orders
  where provider = 'spiffy' and provider_order_id = p_provider_order_id;
  if v_existing.id is not null then
    return query select v_existing.id, v_existing.client_id, v_existing.engagement_id, 0, true;
    return;
  end if;

  select * into v_offer from public.coaching_offers where slug = p_offer_slug and is_active = true;
  if v_offer.id is null then raise exception 'offer_not_found'; end if;

  select * into v_client from public.coaching_clients where lower(email) = lower(trim(p_email)) limit 1;
  if v_client.id is null then
    select id into v_coach_id from public.coaching_coaches where slug = 'romain' and status = 'active' limit 1;
    insert into public.coaching_clients(coach_id, first_name, last_name, email, country)
    values (v_coach_id, left(trim(p_first_name), 100), nullif(left(trim(p_last_name), 100), ''), lower(trim(p_email)), nullif(left(trim(p_country), 2), ''))
    returning * into v_client;
  end if;

  v_coach_id := v_client.coach_id;
  if v_coach_id is null then
    select id into v_coach_id from public.coaching_coaches where slug = 'romain' and status = 'active' limit 1;
    update public.coaching_clients set coach_id = v_coach_id where id = v_client.id;
  end if;

  -- Un prospect peut avoir essayé Google SSO avant son achat. Dans ce cas,
  -- son compte Auth existe déjà mais le déclencheur n'avait encore aucun
  -- dossier client à rattacher. L'achat effectue ce rattachement sans jamais
  -- écraser un rôle propriétaire ou coach existant.
  select u.id into v_auth_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
  if v_auth_user_id is not null then
    select role into v_auth_role
    from public.coaching_memberships
    where user_id = v_auth_user_id and active = true;
    if v_auth_role is null or v_auth_role = 'client' then
      if v_client.auth_user_id is null then
        update public.coaching_clients
        set auth_user_id = v_auth_user_id
        where id = v_client.id
          and auth_user_id is null;
        v_client.auth_user_id := v_auth_user_id;
      elsif v_client.auth_user_id <> v_auth_user_id then
        raise exception 'client_auth_conflict';
      end if;
      insert into public.coaching_memberships(user_id, role, active)
      values (v_auth_user_id, 'client', true)
      on conflict (user_id) do update
      set active = true, updated_at = now()
      where public.coaching_memberships.role = 'client';
    end if;
  end if;

  insert into public.coaching_engagements(client_id, coach_id, offer_id, status, expires_at)
  values (v_client.id, v_coach_id, v_offer.id, 'active', case when v_offer.validity_days is null then null else now() + make_interval(days => v_offer.validity_days) end)
  returning id into v_engagement_id;

  insert into public.coaching_orders(client_id, offer_id, engagement_id, provider, provider_order_id, status, amount_cents, tax_cents, currency, billing_country, raw_payload)
  values (v_client.id, v_offer.id, v_engagement_id, 'spiffy', left(p_provider_order_id, 255), 'paid', greatest(p_amount_cents, 0), greatest(coalesce(p_tax_cents, 0), 0), upper(left(coalesce(p_currency, 'EUR'), 3)), nullif(left(p_country, 2), ''), p_raw_payload)
  returning id into v_order_id;

  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, quantity, reason)
  values (v_client.id, v_engagement_id, v_order_id, v_offer.sessions_count, 'purchase');

  insert into public.coaching_activity_log(event_type, entity_type, entity_id, client_id, metadata)
  values ('order.paid', 'order', v_order_id, v_client.id, jsonb_build_object('offer', v_offer.slug, 'credits', v_offer.sessions_count));

  return query select v_order_id, v_client.id, v_engagement_id, v_offer.sessions_count, false;
end;
$$;
revoke all on function public.coaching_record_spiffy_order(text, text, text, text, text, integer, integer, text, text, jsonb) from public;
grant execute on function public.coaching_record_spiffy_order(text, text, text, text, text, integer, integer, text, text, jsonb) to service_role;

create or replace function public.coaching_refund_spiffy_order(p_provider_order_id text)
returns table(order_id uuid, client_id uuid, credits_removed integer, already_processed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coaching_orders%rowtype;
  v_offer public.coaching_offers%rowtype;
begin
  select * into v_order from public.coaching_orders
  where provider = 'spiffy' and provider_order_id = p_provider_order_id
  for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.status = 'refunded' then
    return query select v_order.id, v_order.client_id, 0, true;
    return;
  end if;
  select * into v_offer from public.coaching_offers where id = v_order.offer_id;

  -- Les rendez-vous futurs liés à une commande remboursée sont annulés. Un
  -- crédit de réservation n'est restitué que s'il avait réellement été
  -- débité ; le retrait de l'achat ramène alors le cycle à zéro. Les séances
  -- déjà réalisées restent dans l'historique et peuvent produire un solde
  -- négatif, ce qui empêche de réserver de nouvelles prestations gratuites.
  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, session_id, quantity, reason, note)
  select session.client_id, session.engagement_id, v_order.id, session.id, 1, 'cancellation', 'Annulation automatique après remboursement'
  from public.coaching_sessions session
  where session.engagement_id = v_order.engagement_id
    and session.status = 'confirmed'
    and session.starts_at > now()
    and exists (
      select 1 from public.coaching_credit_ledger debit
      where debit.session_id = session.id and debit.reason = 'booking' and debit.quantity < 0
    )
    and not exists (
      select 1 from public.coaching_credit_ledger restored
      where restored.session_id = session.id and restored.reason = 'cancellation'
    );

  update public.coaching_availability_slots slot
  set status = 'available', held_until = null
  where slot.status = 'booked'
    and exists (
      select 1 from public.coaching_sessions session
      where session.engagement_id = v_order.engagement_id
        and session.status = 'confirmed'
        and session.starts_at > now()
        and session.coach_id = slot.coach_id
        and session.starts_at = slot.starts_at
    );

  update public.coaching_sessions
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Remboursement Spiffy'
  where engagement_id = v_order.engagement_id
    and status = 'confirmed'
    and starts_at > now();

  update public.coaching_orders set status = 'refunded', refunded_at = now() where id = v_order.id;
  update public.coaching_engagements set status = 'cancelled' where id = v_order.engagement_id and status <> 'completed';
  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, quantity, reason, note)
  values (v_order.client_id, v_order.engagement_id, v_order.id, -v_offer.sessions_count, 'refund', 'Remboursement Spiffy');
  insert into public.coaching_activity_log(event_type, entity_type, entity_id, client_id)
  values ('order.refunded', 'order', v_order.id, v_order.client_id);
  return query select v_order.id, v_order.client_id, v_offer.sessions_count, false;
end;
$$;
revoke all on function public.coaching_refund_spiffy_order(text) from public;
grant execute on function public.coaching_refund_spiffy_order(text) to service_role;

-- Attribution administrative d'un rôle après création du compte par mot de
-- passe ou Google SSO. Jamais exécutable depuis le navigateur.
create or replace function public.coaching_assign_role_by_email(
  p_email text,
  p_role text,
  p_coach_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  if p_role not in ('owner', 'coach', 'client') then raise exception 'invalid_role'; end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then raise exception 'auth_user_not_found'; end if;
  insert into public.coaching_memberships(user_id, role, active)
  values (v_user_id, p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true, updated_at = now();
  if p_role = 'coach' then
    if nullif(trim(p_coach_slug), '') is null then raise exception 'coach_slug_required'; end if;
    update public.coaching_coaches
    set auth_user_id = v_user_id, email = lower(trim(p_email)), status = 'active'
    where slug = p_coach_slug;
    if not found then raise exception 'coach_profile_not_found'; end if;
  elsif p_role = 'client' then
    update public.coaching_clients set auth_user_id = v_user_id where lower(email) = lower(trim(p_email));
    if not found then raise exception 'client_profile_not_found'; end if;
  end if;
  return v_user_id;
end;
$$;
revoke all on function public.coaching_assign_role_by_email(text, text, text) from public;
grant execute on function public.coaching_assign_role_by_email(text, text, text) to service_role;

-- Données de référence alignées sur la promesse affichée sur la page de suite.
insert into public.coaching_coaches(slug, first_name, avatar_url, status, timezone)
values ('romain', 'Romain', '/media/coachs/romain.webp?v=ai-hd', 'active', 'Europe/Zurich')
on conflict (slug) do update set first_name = excluded.first_name, avatar_url = coalesce(public.coaching_coaches.avatar_url, excluded.avatar_url), status = excluded.status, updated_at = now();

insert into public.coaching_offers(slug, name, sessions_count, price_cents, currency, duration_minutes, validity_days, is_active)
values
  ('session-1', 'Le prochain pas', 1, 24700, 'EUR', 60, 90, true),
  ('pack-3', 'Le mouvement', 3, 59100, 'EUR', 60, 120, true),
  ('pack-6', 'La transformation', 6, 88200, 'EUR', 60, 240, true)
on conflict (slug) do update set
  name = excluded.name,
  sessions_count = excluded.sessions_count,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  duration_minutes = excluded.duration_minutes,
  validity_days = excluded.validity_days,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.coaching_form_templates(slug, name, purpose, version, status, questions)
values (
  'session-preparation-v1',
  'Préparation de séance',
  'session_preparation',
  1,
  'active',
  '[
    {"id":"subject","type":"textarea","required":true,"label":"Quel est le sujet principal que tu veux travailler ?"},
    {"id":"progress","type":"textarea","required":true,"label":"Qu’est-ce qui a bougé depuis votre dernière séance ?"},
    {"id":"obstacle","type":"textarea","required":true,"label":"Qu’est-ce qui te bloque ou revient en boucle aujourd’hui ?"},
    {"id":"outcome","type":"textarea","required":true,"label":"À la fin de la séance, qu’aimerais-tu avoir obtenu ?"},
    {"id":"context","type":"textarea","required":false,"label":"Y a-t-il un contexte important à connaître ?"}
  ]'::jsonb
)
on conflict (slug, version) do update set questions = excluded.questions, status = excluded.status, updated_at = now();

comment on table public.coaching_session_notes is 'Notes privées du coach. Non lisibles par le rôle owner via RLS.';
comment on table public.coaching_credit_ledger is 'Journal append-only des mouvements de crédits. Ne jamais remplacer par un simple compteur.';
comment on table public.coaching_activity_log is 'Journal opérationnel sans notes privées ni données de carte.';
