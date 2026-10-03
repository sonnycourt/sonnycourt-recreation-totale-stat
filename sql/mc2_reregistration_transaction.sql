-- Deuxième prérequis, à exécuter par Sonny après mc2_reregistration_history.sql.
-- Installation seulement : aucune session modifiée, aucun message envoyé.
-- La fonction n'est accessible qu'au backend service_role.
begin;
alter table public.mc2_registrations
  add column if not exists session_generation integer not null default 0;

create or replace function public.mc2_reregister_session(
  p_token text, p_expected_generation integer, p_session jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.mc2_registrations%rowtype;
  new_start timestamptz;
  new_end timestamptz;
begin
  select * into r from public.mc2_registrations where token = p_token for update;
  if not found then raise exception 'registration_missing'; end if;
  if r.session_generation <> p_expected_generation then
    raise exception 'session_changed';
  end if;
  if r.purchased_at is not null or r.statut in ('purchased','acheteur')
     or coalesce(r.payment_status,'') in ('paid','succeeded','active','complete','completed') then
    raise exception 'buyer';
  end if;
  if exists (select 1 from public.mc2_tracking_events_v2
             where token = p_token and event_name = 'cta_playback_present') then
    raise exception 'cta_playback';
  end if;
  if exists (select 1 from public.webinaire_registrations w
             where lower(w.email) = lower(r.email)
             and (w.purchased is true or w.purchased_at is not null
                  or w.statut in ('purchased','acheteur'))) then
    raise exception 'legacy_buyer';
  end if;
  if exists (select 1 from public.webinaire_exclusions e
             where lower(e.email) = lower(r.email)
             and coalesce(e.raison,'') not in ('inscrit_mc2','inscrit_webinaire',
                 'participant_mc2','participant_webinaire','no_show_reactive_mc2')) then
    raise exception 'protected_exclusion';
  end if;
  if r.session_ends_at is null or r.session_ends_at > now() then
    raise exception 'session_active_or_unknown';
  end if;
  if r.entry_payment_required is true then
    raise exception 'historical_paid_entry_requires_review';
  end if;
  new_start := (p_session->>'session_starts_at')::timestamptz;
  new_end := (p_session->>'session_ends_at')::timestamptz;
  if new_start is null or new_end is null or new_start <= now()
     or new_end <= new_start or new_end > new_start + interval '6 hours'
     or coalesce(p_session->>'slot_kind','') not in ('jit','scheduled')
     or nullif(p_session->>'session_slot_id','') is null
     or nullif(p_session->>'visitor_timezone','') is null then
    raise exception 'invalid_session';
  end if;

  -- Verrouiller aussi les jobs : un worker ne doit pas prendre un ancien job
  -- entre la vérification et la replanification. Si déjà pris, on attend une
  -- nouvelle tentative plutôt que risquer un envoi en double.
  perform id from public.mc2_sms_jobs where token = p_token for update;
  perform id from public.mc2_session_email_jobs where token = p_token for update;
  perform id from public.mc2_replay_recovery_jobs where token = p_token for update;
  if exists(select 1 from public.mc2_sms_jobs where token=p_token and status='processing')
     or exists(select 1 from public.mc2_session_email_jobs where token=p_token and status='processing')
     or exists(select 1 from public.mc2_replay_recovery_jobs where token=p_token and status='processing') then
    raise exception 'notification_in_flight';
  end if;

  insert into public.mc2_registration_history
    (registration_id,token,session_starts_at,reason,snapshot)
  values(r.id,r.token,r.session_starts_at,'reregistration',to_jsonb(r));

  update public.mc2_sms_jobs set status='skipped',skip_reason='session_rescheduled'
    where token=p_token and status in ('pending','retry');
  update public.mc2_session_email_jobs set status='skipped',skip_reason='session_rescheduled'
    where token=p_token and status in ('pending','retry');
  update public.mc2_replay_recovery_jobs set status='skipped',skip_reason='session_rescheduled'
    where token=p_token and status in ('pending','retry');

  update public.mc2_registrations set
    session_generation = session_generation + 1,
    session_slot_id = p_session->>'session_slot_id',
    slot_kind = p_session->>'slot_kind', visitor_timezone = p_session->>'visitor_timezone',
    session_starts_at = new_start, session_ends_at = new_end,
    registration_completed_at = now(), statut = 'registered',
    attended_live = false, session_joined_at = null,
    watch_first_second_live = null, watch_max_seconds_live = 0,
    watch_max_seconds_replay = 0, watch_max_minutes = 0,
    saw_offer = false, offer_expires_at = null,
    clicked_cta = false, cta_clicked_at = null,
    last_presence_at = null, updated_at = now()
  where token=p_token returning * into r;
  -- Acquisition, identité, consentements, paiements et événements conservés.
  return to_jsonb(r);
end;
$$;
revoke all on function public.mc2_reregister_session(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.mc2_reregister_session(text,integer,jsonb) to service_role;
commit;

select to_regprocedure('public.mc2_reregister_session(text,integer,jsonb)') is not null as transaction_ready;
