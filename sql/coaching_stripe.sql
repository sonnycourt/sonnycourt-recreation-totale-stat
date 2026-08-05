-- Stripe direct pour Coaching OS.
-- Migration additive : aucune table et aucune donnée existante ne sont supprimées.
-- À exécuter après coaching_wallet_memberships.sql.

alter table public.coaching_clients add column if not exists stripe_customer_id text;
create unique index if not exists coaching_clients_stripe_customer_unique
  on public.coaching_clients(stripe_customer_id) where stripe_customer_id is not null;

alter table public.coaching_offers add column if not exists stripe_product_id text;
alter table public.coaching_offers add column if not exists stripe_price_id text;
create unique index if not exists coaching_offers_stripe_price_unique
  on public.coaching_offers(stripe_price_id) where stripe_price_id is not null;

-- Produits et prix créés dans le compte Stripe Sonny Court le 5 août 2026.
-- La mise à jour ne cible que les sept slugs Coaching OS ci-dessous.
update public.coaching_offers offers
set stripe_product_id = stripe.product_id,
    stripe_price_id = stripe.price_id,
    updated_at = now()
from (values
  ('first-consultation', 'prod_V1CJvClCXbqzjl', 'price_1U19v2Ckb0oA7GrjSUZaJhmB'),
  ('session-1', 'prod_V1CKiVRAZIQ36m', 'price_1U19vNCkb0oA7GrjvsADONSQ'),
  ('pack-3', 'prod_V1CKsS5KVN5iuD', 'price_1U19vQCkb0oA7GrjHAFdnuKP'),
  ('pack-6', 'prod_V1CK3nZ4NTNMmH', 'price_1U19vUCkb0oA7GrjCajl0TvO'),
  ('membership-3', 'prod_V1CKYi13r6H6KB', 'price_1U19vaCkb0oA7GrjPauZaf7h'),
  ('membership-6', 'prod_V1CKyB5QuQCdEv', 'price_1U19veCkb0oA7GrjtOHiSW9A'),
  ('membership-12', 'prod_V1CKcqf1B0jRpi', 'price_1U19vhCkb0oA7Grji5KCneSB')
) as stripe(slug, product_id, price_id)
where offers.slug = stripe.slug;

alter table public.coaching_orders add column if not exists provider_payment_id text;
alter table public.coaching_orders add column if not exists provider_customer_id text;
alter table public.coaching_orders add column if not exists provider_subscription_id text;
create index if not exists coaching_orders_provider_payment_idx
  on public.coaching_orders(provider, provider_payment_id);

alter table public.coaching_subscriptions add column if not exists provider_customer_id text;
alter table public.coaching_subscriptions add column if not exists provider_price_id text;

alter table public.coach_diagnostic_bookings add column if not exists payment_provider text;
alter table public.coach_diagnostic_bookings add column if not exists provider_order_id text;
alter table public.coach_diagnostic_bookings add column if not exists provider_payment_id text;
alter table public.coach_diagnostic_bookings add column if not exists stripe_checkout_session_id text;
create unique index if not exists coach_diagnostic_stripe_session_unique
  on public.coach_diagnostic_bookings(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create or replace function public.coaching_record_stripe_order(
  p_checkout_session_id text,
  p_payment_id text,
  p_customer_id text,
  p_subscription_id text,
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
set search_path = public, auth
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
  if nullif(trim(p_checkout_session_id), '') is null then raise exception 'checkout_session_required'; end if;
  if nullif(trim(p_email), '') is null then raise exception 'email_required'; end if;

  select * into v_existing from public.coaching_orders
  where provider = 'stripe' and provider_order_id = p_checkout_session_id;
  if v_existing.id is not null then
    return query select v_existing.id, v_existing.client_id, v_existing.engagement_id, 0, true;
    return;
  end if;

  select * into v_offer from public.coaching_offers where slug = p_offer_slug and is_active = true;
  if v_offer.id is null then raise exception 'offer_not_found'; end if;

  select * into v_client from public.coaching_clients where lower(email) = lower(trim(p_email)) limit 1;
  if v_client.id is null then
    select id into v_coach_id from public.coaching_coaches where slug = 'romain' and status = 'active' limit 1;
    insert into public.coaching_clients(coach_id, first_name, last_name, email, country, stripe_customer_id)
    values (
      v_coach_id,
      left(coalesce(nullif(trim(p_first_name), ''), 'Élève'), 100),
      nullif(left(trim(coalesce(p_last_name, '')), 100), ''),
      lower(trim(p_email)),
      nullif(upper(left(trim(coalesce(p_country, '')), 2)), ''),
      nullif(left(trim(coalesce(p_customer_id, '')), 255), '')
    )
    returning * into v_client;
  elsif nullif(trim(coalesce(p_customer_id, '')), '') is not null then
    if v_client.stripe_customer_id is null then
      update public.coaching_clients
      set stripe_customer_id = left(trim(p_customer_id), 255)
      where id = v_client.id;
      v_client.stripe_customer_id := left(trim(p_customer_id), 255);
    elsif v_client.stripe_customer_id <> trim(p_customer_id) then
      raise exception 'stripe_customer_conflict';
    end if;
  end if;

  v_coach_id := v_client.coach_id;
  if v_coach_id is null then
    select id into v_coach_id from public.coaching_coaches where slug = 'romain' and status = 'active' limit 1;
    update public.coaching_clients set coach_id = v_coach_id where id = v_client.id;
  end if;

  select u.id into v_auth_user_id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_auth_user_id is not null then
    select role into v_auth_role from public.coaching_memberships where user_id = v_auth_user_id and active = true;
    if v_auth_role is null or v_auth_role = 'client' then
      if v_client.auth_user_id is null then
        update public.coaching_clients set auth_user_id = v_auth_user_id where id = v_client.id and auth_user_id is null;
        v_client.auth_user_id := v_auth_user_id;
      elsif v_client.auth_user_id <> v_auth_user_id then
        raise exception 'client_auth_conflict';
      end if;
      insert into public.coaching_memberships(user_id, role, active)
      values (v_auth_user_id, 'client', true)
      on conflict (user_id) do update set active = true, updated_at = now()
      where public.coaching_memberships.role = 'client';
    end if;
  end if;

  insert into public.coaching_engagements(client_id, coach_id, offer_id, status, expires_at)
  values (
    v_client.id,
    v_coach_id,
    v_offer.id,
    'active',
    case when v_offer.validity_days is null then null else now() + make_interval(days => v_offer.validity_days) end
  )
  returning id into v_engagement_id;

  insert into public.coaching_orders(
    client_id, offer_id, engagement_id, provider, provider_order_id,
    provider_payment_id, provider_customer_id, provider_subscription_id,
    status, amount_cents, tax_cents, currency, billing_country, raw_payload
  ) values (
    v_client.id, v_offer.id, v_engagement_id, 'stripe', left(trim(p_checkout_session_id), 255),
    nullif(left(trim(coalesce(p_payment_id, '')), 255), ''),
    nullif(left(trim(coalesce(p_customer_id, '')), 255), ''),
    nullif(left(trim(coalesce(p_subscription_id, '')), 255), ''),
    'paid', greatest(p_amount_cents, 0), greatest(coalesce(p_tax_cents, 0), 0),
    upper(left(coalesce(p_currency, 'EUR'), 3)), nullif(upper(left(trim(coalesce(p_country, '')), 2)), ''), p_raw_payload
  )
  returning id into v_order_id;

  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, quantity, reason)
  values (v_client.id, v_engagement_id, v_order_id, v_offer.sessions_count, 'purchase');

  insert into public.coaching_activity_log(event_type, entity_type, entity_id, client_id, metadata)
  values (
    'order.paid', 'order', v_order_id, v_client.id,
    jsonb_build_object('provider', 'stripe', 'offer', v_offer.slug, 'credits', v_offer.sessions_count)
  );

  return query select v_order_id, v_client.id, v_engagement_id, v_offer.sessions_count, false;
end;
$$;

revoke all on function public.coaching_record_stripe_order(text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.coaching_record_stripe_order(text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb) to service_role;

create or replace function public.coaching_upsert_stripe_subscription(
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_price_id text,
  p_client_id uuid,
  p_offer_slug text,
  p_status text default 'active',
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_subscription_id uuid;
  v_status text := case when p_status in ('trialing','active','past_due','paused','cancelled','expired') then p_status else 'active' end;
begin
  if nullif(trim(p_provider_subscription_id), '') is null then raise exception 'subscription_id_required'; end if;
  select id into v_offer_id from public.coaching_offers
  where slug = p_offer_slug and metadata ->> 'kind' = 'membership' and is_active = true;
  if v_offer_id is null then raise exception 'membership_offer_not_found'; end if;
  if not exists (select 1 from public.coaching_clients where id = p_client_id) then raise exception 'client_not_found'; end if;

  insert into public.coaching_subscriptions(
    client_id, offer_id, provider, provider_subscription_id, provider_customer_id, provider_price_id,
    status, current_period_start, current_period_end, cancel_at_period_end, cancelled_at
  ) values (
    p_client_id, v_offer_id, 'stripe', left(trim(p_provider_subscription_id), 255),
    nullif(left(trim(coalesce(p_provider_customer_id, '')), 255), ''),
    nullif(left(trim(coalesce(p_provider_price_id, '')), 255), ''),
    v_status, p_current_period_start, p_current_period_end, coalesce(p_cancel_at_period_end, false),
    case when v_status = 'cancelled' then now() else null end
  )
  on conflict (provider, provider_subscription_id) do update set
    client_id = excluded.client_id,
    offer_id = excluded.offer_id,
    provider_customer_id = excluded.provider_customer_id,
    provider_price_id = excluded.provider_price_id,
    status = excluded.status,
    current_period_start = coalesce(excluded.current_period_start, public.coaching_subscriptions.current_period_start),
    current_period_end = coalesce(excluded.current_period_end, public.coaching_subscriptions.current_period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancelled_at = case when excluded.status = 'cancelled' then now() else null end,
    updated_at = now()
  returning id into v_subscription_id;
  return v_subscription_id;
end;
$$;

revoke all on function public.coaching_upsert_stripe_subscription(text, text, text, uuid, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.coaching_upsert_stripe_subscription(text, text, text, uuid, text, text, timestamptz, timestamptz, boolean) to service_role;

create or replace function public.coaching_refund_stripe_order(p_provider_reference text)
returns table(order_id uuid, client_id uuid, engagement_id uuid, credits_removed integer, already_processed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coaching_orders%rowtype;
  v_offer public.coaching_offers%rowtype;
begin
  select * into v_order from public.coaching_orders
  where provider = 'stripe'
    and (provider_order_id = p_provider_reference or provider_payment_id = p_provider_reference)
  order by created_at desc
  limit 1
  for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.status = 'refunded' then
    return query select v_order.id, v_order.client_id, v_order.engagement_id, 0, true;
    return;
  end if;
  select * into v_offer from public.coaching_offers where id = v_order.offer_id;

  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, session_id, quantity, reason, note)
  select session.client_id, session.engagement_id, v_order.id, session.id, abs(debit.quantity), 'cancellation', 'Annulation automatique après remboursement Stripe'
  from public.coaching_sessions session
  join public.coaching_credit_ledger debit on debit.session_id = session.id and debit.reason = 'booking' and debit.quantity < 0
  where session.engagement_id = v_order.engagement_id
    and session.status = 'confirmed'
    and session.starts_at > now()
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

  update public.coaching_sessions session
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Remboursement Stripe'
  where session.engagement_id = v_order.engagement_id and session.status = 'confirmed' and session.starts_at > now();

  update public.coaching_orders orders set status = 'refunded', refunded_at = now() where orders.id = v_order.id;
  update public.coaching_engagements engagement set status = 'cancelled' where engagement.id = v_order.engagement_id and engagement.status <> 'completed';
  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, quantity, reason, note)
  values (v_order.client_id, v_order.engagement_id, v_order.id, -v_offer.sessions_count, 'refund', 'Remboursement Stripe');
  insert into public.coaching_activity_log(event_type, entity_type, entity_id, client_id, metadata)
  values ('order.refunded', 'order', v_order.id, v_order.client_id, jsonb_build_object('provider', 'stripe'));
  return query select v_order.id, v_order.client_id, v_order.engagement_id, v_offer.sessions_count, false;
end;
$$;

revoke all on function public.coaching_refund_stripe_order(text) from public, anon, authenticated;
grant execute on function public.coaching_refund_stripe_order(text) to service_role;

create or replace function public.coaching_import_first_consultation_stripe(
  p_checkout_session_id text,
  p_booking_id uuid
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
  where orders.provider = 'stripe'
    and orders.provider_order_id = p_checkout_session_id
    and orders.status = 'paid'
    and offers.slug = 'first-consultation'
  limit 1;
  if v_order.id is null then raise exception 'first_consultation_order_not_found'; end if;

  select * into v_client from public.coaching_clients where id = v_order.client_id;
  select * into v_engagement from public.coaching_engagements where id = v_order.engagement_id;
  select * into v_booking from public.coach_diagnostic_bookings where id = p_booking_id;
  if v_client.id is null or v_engagement.id is null or v_booking.id is null then raise exception 'first_consultation_context_missing'; end if;
  if v_booking.status <> 'paid' then raise exception 'first_consultation_booking_not_paid'; end if;
  if lower(v_booking.customer_email) <> lower(v_client.email) then raise exception 'first_consultation_identity_mismatch'; end if;
  if v_booking.provider_order_id is distinct from p_checkout_session_id then raise exception 'first_consultation_order_mismatch'; end if;

  select * into v_slot from public.coach_diagnostic_slots where id = v_booking.slot_id;
  if v_slot.id is null then raise exception 'first_consultation_slot_missing'; end if;

  select id into v_session_id from public.coaching_sessions
  where engagement_id = v_engagement.id and starts_at = v_slot.starts_at limit 1;

  if v_session_id is null then
    begin
      insert into public.coaching_sessions(
        client_id, coach_id, engagement_id, starts_at, ends_at, timezone, status, source
      ) values (
        v_client.id, v_engagement.coach_id, v_engagement.id,
        v_slot.starts_at, v_slot.ends_at, 'Europe/Zurich', 'confirmed', 'portal'
      ) returning id into v_session_id;
      v_created := true;
    exception when unique_violation then
      select id into v_session_id from public.coaching_sessions
      where client_id = v_client.id and coach_id = v_engagement.coach_id
        and starts_at = v_slot.starts_at and status in ('held', 'confirmed') limit 1;
      if v_session_id is null then raise; end if;
    end;
  end if;

  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, session_id, quantity, reason, note)
  values (v_client.id, v_engagement.id, v_order.id, v_session_id, -1, 'booking', 'Première consultation réservée avant paiement')
  on conflict do nothing;

  if v_created then
    insert into public.coaching_activity_log(event_type, entity_type, entity_id, client_id, metadata)
    values (
      'session.booked', 'session', v_session_id, v_client.id,
      jsonb_build_object('source', 'first_consultation', 'provider', 'stripe', 'legacy_booking_id', v_booking.id)
    );
  end if;
  return v_session_id;
end;
$$;

revoke all on function public.coaching_import_first_consultation_stripe(text, uuid) from public, anon, authenticated;
grant execute on function public.coaching_import_first_consultation_stripe(text, uuid) to service_role;

comment on column public.coaching_offers.stripe_price_id is 'Prix Stripe actif pour la checkout Coaching OS. Aucun montant n’est accepté depuis le navigateur.';
comment on column public.coaching_clients.stripe_customer_id is 'Identifiant Stripe Customer utilisé pour Billing et le portail client.';
