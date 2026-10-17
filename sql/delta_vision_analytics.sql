-- Tracking interne Delta Vision uniquement. Sonny exécute ce fichier.
-- Réexécutable : aucune modification des paiements, des contacts ou des avis.
begin;
create table if not exists public.delta_vision_analytics_events (
  id uuid primary key,
  visit_id uuid not null,
  visitor_id uuid not null,
  visit_started_at timestamptz not null,
  received_at timestamptz not null default now(),
  event_name text not null check (event_name in ('visit','heartbeat','section','cta_seen','cta_click','video','video_progress','performance','error','checkout_loaded')),
  source text not null check (length(source)<=80),
  medium text not null check (length(medium)<=80),
  campaign text not null check (length(campaign)<=100),
  device text not null check (device in ('mobile','desktop')),
  is_returning boolean not null,
  price smallint not null check (price in (27,47,97,147)),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=20000)
);
create index if not exists dv_analytics_visit_date_idx on public.delta_vision_analytics_events(visit_started_at, visit_id);
create index if not exists dv_analytics_received_idx on public.delta_vision_analytics_events(received_at);
alter table public.delta_vision_analytics_events enable row level security;
revoke all on public.delta_vision_analytics_events from public, anon, authenticated;
grant select,insert,delete on public.delta_vision_analytics_events to service_role;

-- Lecture uniquement. Les mesures concernent des visites ayant accepté le suivi.
create or replace function public.delta_vision_analytics_report(p_from timestamptz, p_to timestamptz, p_source text default '', p_device text default '', p_price integer default 0)
returns jsonb language sql stable security invoker set search_path=public as $$
with e as materialized (
 select * from public.delta_vision_analytics_events
 where visit_started_at>=p_from and visit_started_at<p_to
 and p_to>p_from and p_to-p_from<=interval '32 days'
 and (p_source='' or source=p_source) and (p_device='' or device=p_device)
 and (p_price=0 or price=p_price)
), v as (
 select visit_id, min(visitor_id::text) visitor_id, min(visit_started_at) started_at,
 min(source) source, min(medium) medium, min(campaign) campaign, min(device) device,
 bool_or(is_returning) is_returning, min(price) price,
 max(coalesce((metadata->>'active')::numeric,0)) active,
 max(coalesce((metadata->>'scroll')::numeric,0)) scroll,
 bool_or(event_name='video' and metadata->>'action'='play') video_started,
 bool_or(event_name='cta_seen' and metadata->>'target' in ('hero','closing')) offer_seen,
 bool_or(event_name='cta_click') clicked,
 bool_or(event_name='checkout_loaded') checkout_loaded,
 max(coalesce((metadata->>'watched')::numeric,0)) watched,
 max(coalesce((metadata->>'duration')::numeric,0)) duration,
 min((metadata->>'startup')::numeric) startup,
 min(case when event_name='cta_click' then (metadata->>'elapsed')::numeric end) click_after,
 count(*) filter(where event_name='error') errors
 from e group by visit_id
), ct as (
 select metadata->>'target' target,
 count(distinct visit_id) filter(where event_name='cta_seen') exposures,
 count(distinct visit_id) filter(where event_name='cta_click') clicks
 from e where event_name in ('cta_seen','cta_click') group by 1
), sec as (
 select visit_id,metadata->>'target' target,max((metadata->>'seconds')::numeric) seconds
 from e where event_name='section' group by 1,2
), rb as (
 select visit_id,(b->>0)::int bucket,max((b->>1)::numeric) seconds
 from e cross join lateral jsonb_array_elements(coalesce(metadata->'bins','[]')) b
 where event_name='video_progress' group by 1,2
), errs as (
 select metadata->>'code' code,count(*) occurrences,count(distinct visit_id) visits
 from e where event_name='error' group by 1
), perf as (
 select metadata->>'metric' metric,percentile_cont(0.5) within group(order by (metadata->>'value')::float) median,
 percentile_cont(0.75) within group(order by (metadata->>'value')::float) p75,count(*) samples
 from e where event_name='performance' group by 1
)
select jsonb_build_object(
 'visits',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from v order by started_at desc limit 10001) x),'[]'),
 'visit_count',(select count(*) from v),
 'ctas',coalesce((select jsonb_agg(to_jsonb(ct)) from ct),'[]'),
 'sections',coalesce((select jsonb_agg(to_jsonb(x)) from (select target,count(*) visits,percentile_cont(0.5) within group(order by seconds) median_seconds from sec group by target) x),'[]'),
 'retention',coalesce((select jsonb_agg(to_jsonb(x) order by bucket) from (select bucket,count(*) filter(where seconds>=1) visits from rb group by bucket) x),'[]'),
 'errors',coalesce((select jsonb_agg(to_jsonb(errs)) from errs),'[]'),
 'performance',coalesce((select jsonb_agg(to_jsonb(perf)) from perf),'[]')
);
$$;
revoke all on function public.delta_vision_analytics_report(timestamptz,timestamptz,text,text,integer) from public,anon,authenticated;
grant execute on function public.delta_vision_analytics_report(timestamptz,timestamptz,text,text,integer) to service_role;
comment on table public.delta_vision_analytics_events is 'Mesures pseudonymisées consenties Delta Vision. Aucun email, IP, texte saisi ou donnée bancaire. Rétention 90 jours via fonction Netlify dédiée.';
commit;
select to_regclass('public.delta_vision_analytics_events') is not null
 and exists(select 1 from pg_class where oid='public.delta_vision_analytics_events'::regclass and relrowsecurity)
 and not has_table_privilege('anon','public.delta_vision_analytics_events','SELECT')
 and not has_table_privilege('anon','public.delta_vision_analytics_events','INSERT')
 and not has_table_privilege('authenticated','public.delta_vision_analytics_events','SELECT')
 and not has_function_privilege('anon','public.delta_vision_analytics_report(timestamptz,timestamptz,text,text,integer)','EXECUTE')
 and has_table_privilege('service_role','public.delta_vision_analytics_events','INSERT') as delta_analytics_ready;
