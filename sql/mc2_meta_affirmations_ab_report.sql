-- One row per arm. Browser-based counts deduplicate refreshes and repeat visits.
-- Pitch includes live and replay. Run again after the cohorts' sessions have passed.
with arms(variant) as (
  values ('mc2_meta_affirmations_v1_a'), ('mc2_meta_affirmations_v1_b')
), visitors as (
  select e.variant, e.funnel_id, e.occurred_at
  from public.mc2_optin_events e join arms using (variant)
  where e.path = '/meta/mc2/' and e.event_name = 'page_view'
), outcomes as (
  select v.variant, v.funnel_id,
         bool_or(r.token is not null) as registered,
         bool_or(r.session_starts_at > now()) as session_upcoming,
         bool_or(exists (
           select 1 from public.mc2_tracking_events_v2 t
           where t.token = r.token and t.event_name = 'cta_playback_present'
             and t.received_at >= r.registration_completed_at
         )) as reached_pitch
  from visitors v
  left join public.mc2_registrations r on r.optin_funnel_id = v.funnel_id
    and r.optin_variant = v.variant and r.registration_completed_at is not null
    and not exists (select 1 from public.mc2_tracking_test_registrations t where t.token = r.token)
  group by v.variant, v.funnel_id
)
select right(a.variant, 1) as version, count(o.funnel_id) as visiteurs,
       count(*) filter (where registered) as inscrits,
       round(100.0 * count(*) filter (where registered) / nullif(count(o.funnel_id), 0), 2) as pct_inscrits,
       count(*) filter (where reached_pitch) as presents_au_pitch,
       round(100.0 * count(*) filter (where reached_pitch) / nullif(count(o.funnel_id), 0), 2) as pitch_pour_100_visiteurs,
       count(*) filter (where session_upcoming and not reached_pitch) as inscrits_session_a_venir
from arms a left join outcomes o using (variant)
group by a.variant order by a.variant;
