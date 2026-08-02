-- Pont additif entre la checkout Spiffy de première consultation et Coaching OS.
-- Idempotent : peut être exécuté plusieurs fois sans dupliquer offre, séance ou crédit.

insert into public.coaching_offers (
  slug, name, sessions_count, price_cents, currency, duration_minutes, validity_days, is_active
)
values (
  'first-consultation', 'Première consultation avec Romain', 1, 9700, 'EUR', 45, 90, true
)
on conflict (slug) do update set
  name = excluded.name,
  sessions_count = excluded.sessions_count,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  duration_minutes = excluded.duration_minutes,
  validity_days = excluded.validity_days,
  is_active = excluded.is_active,
  updated_at = now();

create or replace function public.coaching_import_first_consultation(
  p_provider_order_id text,
  p_legacy_booking_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coaching_orders%rowtype;
  v_client public.coaching_clients%rowtype;
  v_engagement public.coaching_engagements%rowtype;
  v_booking public.coach_diagnostic_bookings%rowtype;
  v_slot public.coach_diagnostic_slots%rowtype;
  v_session_id uuid;
  v_created boolean := false;
begin
  select orders.* into v_order
  from public.coaching_orders orders
  join public.coaching_offers offers on offers.id = orders.offer_id
  where orders.provider = 'spiffy'
    and orders.provider_order_id = p_provider_order_id
    and orders.status = 'paid'
    and offers.slug = 'first-consultation'
  limit 1;
  if v_order.id is null then raise exception 'first_consultation_order_not_found'; end if;

  select * into v_client from public.coaching_clients where id = v_order.client_id;
  select * into v_engagement from public.coaching_engagements where id = v_order.engagement_id;
  select * into v_booking from public.coach_diagnostic_bookings where id = p_legacy_booking_id;
  if v_client.id is null or v_engagement.id is null or v_booking.id is null then
    raise exception 'first_consultation_context_missing';
  end if;
  if v_booking.status <> 'paid' then raise exception 'first_consultation_booking_not_paid'; end if;
  if lower(v_booking.customer_email) <> lower(v_client.email) then
    raise exception 'first_consultation_identity_mismatch';
  end if;
  if v_booking.spiffy_order_id is distinct from p_provider_order_id then
    raise exception 'first_consultation_order_mismatch';
  end if;

  select * into v_slot from public.coach_diagnostic_slots where id = v_booking.slot_id;
  if v_slot.id is null then raise exception 'first_consultation_slot_missing'; end if;

  select id into v_session_id
  from public.coaching_sessions
  where engagement_id = v_engagement.id
    and starts_at = v_slot.starts_at
    and source = 'spiffy'
  limit 1;

  if v_session_id is null then
    begin
      insert into public.coaching_sessions (
        client_id, coach_id, engagement_id, starts_at, ends_at, timezone, status, source
      ) values (
        v_client.id, v_engagement.coach_id, v_engagement.id,
        v_slot.starts_at, v_slot.ends_at, 'Europe/Zurich', 'confirmed', 'spiffy'
      )
      returning id into v_session_id;
      v_created := true;
    exception when unique_violation then
      select id into v_session_id
      from public.coaching_sessions
      where client_id = v_client.id
        and coach_id = v_engagement.coach_id
        and starts_at = v_slot.starts_at
        and status in ('held', 'confirmed')
      limit 1;
      if v_session_id is null then raise; end if;
    end;
  end if;

  insert into public.coaching_credit_ledger (
    client_id, engagement_id, order_id, session_id, quantity, reason, note
  ) values (
    v_client.id, v_engagement.id, v_order.id, v_session_id, -1, 'booking',
    'Première consultation réservée avant paiement'
  )
  on conflict do nothing;

  if v_created then
    insert into public.coaching_activity_log (
      event_type, entity_type, entity_id, client_id, metadata
    ) values (
      'session.booked', 'session', v_session_id, v_client.id,
      jsonb_build_object('source', 'first_consultation', 'legacy_booking_id', v_booking.id)
    );
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.coaching_import_first_consultation(text, uuid) from public, anon, authenticated;
grant execute on function public.coaching_import_first_consultation(text, uuid) to service_role;
