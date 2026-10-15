-- Sonny exécute ce fichier dans Supabase. Aucun accès public aux historiques.
-- Réexécutable, ne modifie ni les achats, ni les accès Circle, ni les élèves.
begin;

create table if not exists public.circle_lesson_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  provider_occurred_at timestamptz,
  provider_event_id text,
  community_id bigint not null check (community_id > 0),
  community_member_id bigint not null check (community_member_id > 0),
  space_id bigint not null check (space_id > 0),
  lesson_id bigint check (lesson_id > 0),
  event_type text not null check (event_type = 'courses_lesson_completed'),
  payload_sha256 text not null check (length(payload_sha256) = 64),
  payload jsonb not null,
  resolution_status text not null check (resolution_status in ('identified', 'needs_lesson_id')),
  constraint circle_lesson_resolution_consistent check (
    (lesson_id is not null and resolution_status = 'identified') or
    (lesson_id is null and resolution_status = 'needs_lesson_id')
  )
);

-- Les renvois ne sont dédupliqués que si Circle fournit un identifiant d'événement.
-- Sans identifiant, garder chaque réception : ne pas effacer une vraie revalidation.
create unique index if not exists circle_lesson_provider_event_unique
  on public.circle_lesson_events(community_id, provider_event_id)
  where provider_event_id is not null;
create index if not exists circle_lesson_member_timeline_idx
  on public.circle_lesson_events(community_member_id, received_at, id);
create index if not exists circle_lesson_pending_idx
  on public.circle_lesson_events(received_at) where lesson_id is null;

alter table public.circle_lesson_events enable row level security;
revoke all on public.circle_lesson_events from public, anon, authenticated, service_role;
revoke all on sequence public.circle_lesson_events_id_seq from public, anon, authenticated, service_role;
grant select, insert on public.circle_lesson_events to service_role;
grant usage, select on sequence public.circle_lesson_events_id_seq to service_role;

-- Une ligne = une réception. Le délai utilise les horodatages Circle seulement
-- lorsque les deux événements en possèdent ; sinon il s'agit du délai observé.
create or replace view public.circle_lesson_timeline
with (security_invoker = true) as
with ordered as (
  select id, community_id, community_member_id, space_id, lesson_id,
    provider_occurred_at, received_at, resolution_status,
    lag(lesson_id) over w as previous_lesson_id,
    lag(provider_occurred_at) over w as previous_provider_at,
    lag(received_at) over w as previous_received_at
  from public.circle_lesson_events
  window w as (partition by community_id, community_member_id order by received_at, id)
)
select *,
  case when provider_occurred_at is not null and previous_provider_at is not null
    then extract(epoch from provider_occurred_at - previous_provider_at)
    else extract(epoch from received_at - previous_received_at)
  end as seconds_since_previous,
  case when provider_occurred_at is not null and previous_provider_at is not null
    then 'provider' else 'received' end as interval_basis
from ordered;
revoke all on public.circle_lesson_timeline from public, anon, authenticated, service_role;
grant select on public.circle_lesson_timeline to service_role;

commit;

select to_regclass('public.circle_lesson_events') is not null
  and to_regclass('public.circle_lesson_timeline') is not null as lesson_tracking_ready;
