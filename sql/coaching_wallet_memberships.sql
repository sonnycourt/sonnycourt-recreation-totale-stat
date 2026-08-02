-- Wallet Coaching Sonny Court
-- Migration additive : 1 credit = 15 minutes. Aucun objet existant n'est supprimé.

alter table public.coaching_clients add column if not exists avatar_url text;
alter table public.coaching_coaches add column if not exists phone text;
alter table public.coaching_coaches add column if not exists country text;
alter table public.coaching_sessions add column if not exists credits_cost integer not null default 1 check (credits_cost > 0);

create table if not exists public.coaching_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  offer_id uuid not null references public.coaching_offers(id) on delete restrict,
  provider text not null default 'spiffy',
  provider_subscription_id text not null,
  status text not null default 'active' check (status in ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index if not exists coaching_subscriptions_client_idx
  on public.coaching_subscriptions(client_id, status);

create table if not exists public.coaching_coach_compensation_rules (
  coach_id uuid primary key references public.coaching_coaches(id) on delete cascade,
  base_cents_per_credit integer not null default 2500 check (base_cents_per_credit >= 0),
  quality_bonus_cents_per_credit integer not null default 500 check (quality_bonus_cents_per_credit >= 0),
  first_consultation_cents integer not null default 4850 check (first_consultation_cents >= 0),
  currency text not null default 'EUR',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coaching_coach_payout_ledger (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaching_coaches(id) on delete restrict,
  client_id uuid not null references public.coaching_clients(id) on delete restrict,
  session_id uuid not null unique references public.coaching_sessions(id) on delete restrict,
  credits_delivered integer not null check (credits_delivered > 0),
  base_amount_cents integer not null check (base_amount_cents >= 0),
  bonus_amount_cents integer not null default 0 check (bonus_amount_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  approved_at timestamptz,
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coaching_payout_coach_idx
  on public.coaching_coach_payout_ledger(coach_id, status, created_at desc);

create table if not exists public.coaching_client_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.coaching_sessions(id) on delete cascade,
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  coach_id uuid not null references public.coaching_coaches(id) on delete cascade,
  score smallint not null check (score between 1 and 10),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'coaching_subscriptions',
    'coaching_coach_compensation_rules',
    'coaching_coach_payout_ledger',
    'coaching_client_feedback'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.coaching_set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

alter table public.coaching_subscriptions enable row level security;
alter table public.coaching_coach_compensation_rules enable row level security;
alter table public.coaching_coach_payout_ledger enable row level security;
alter table public.coaching_client_feedback enable row level security;

drop policy if exists coaching_subscriptions_read on public.coaching_subscriptions;
create policy coaching_subscriptions_read on public.coaching_subscriptions for select to authenticated
using (
  public.coaching_current_role() = 'owner'
  or client_id = public.coaching_current_client_id()
  or exists (
    select 1 from public.coaching_clients c
    where c.id = client_id and c.coach_id = public.coaching_current_coach_id()
  )
);
drop policy if exists coaching_subscriptions_owner_write on public.coaching_subscriptions;
create policy coaching_subscriptions_owner_write on public.coaching_subscriptions for all to authenticated
using (public.coaching_current_role() = 'owner')
with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_compensation_read on public.coaching_coach_compensation_rules;
create policy coaching_compensation_read on public.coaching_coach_compensation_rules for select to authenticated
using (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id());
drop policy if exists coaching_compensation_owner_write on public.coaching_coach_compensation_rules;
create policy coaching_compensation_owner_write on public.coaching_coach_compensation_rules for all to authenticated
using (public.coaching_current_role() = 'owner')
with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_payout_read on public.coaching_coach_payout_ledger;
create policy coaching_payout_read on public.coaching_coach_payout_ledger for select to authenticated
using (public.coaching_current_role() = 'owner' or coach_id = public.coaching_current_coach_id());
drop policy if exists coaching_payout_owner_write on public.coaching_coach_payout_ledger;
create policy coaching_payout_owner_write on public.coaching_coach_payout_ledger for update to authenticated
using (public.coaching_current_role() = 'owner')
with check (public.coaching_current_role() = 'owner');

drop policy if exists coaching_feedback_client_write on public.coaching_client_feedback;
create policy coaching_feedback_client_write on public.coaching_client_feedback for all to authenticated
using (client_id = public.coaching_current_client_id())
with check (
  client_id = public.coaching_current_client_id()
  and exists (
    select 1 from public.coaching_sessions s
    where s.id = session_id and s.client_id = public.coaching_current_client_id() and s.status = 'completed'
  )
);
drop policy if exists coaching_feedback_owner_read on public.coaching_client_feedback;
create policy coaching_feedback_owner_read on public.coaching_client_feedback for select to authenticated
using (public.coaching_current_role() = 'owner');

grant select on public.coaching_subscriptions, public.coaching_coach_compensation_rules,
  public.coaching_coach_payout_ledger, public.coaching_client_feedback to authenticated;
grant insert, update on public.coaching_subscriptions, public.coaching_coach_compensation_rules,
  public.coaching_coach_payout_ledger to authenticated;
grant insert, update on public.coaching_client_feedback to authenticated;
grant all on public.coaching_subscriptions, public.coaching_coach_compensation_rules,
  public.coaching_coach_payout_ledger, public.coaching_client_feedback to service_role;

-- Les checkouts existants deviennent les trois recharges ponctuelles du wallet.
insert into public.coaching_offers(slug, name, sessions_count, price_cents, currency, duration_minutes, validity_days, is_active, metadata)
values
  ('session-1', '3 crédits · Le prochain pas', 3, 24700, 'EUR', 45, 90, true, '{"kind":"credit_pack","credit_minutes":15,"featured":false}'::jsonb),
  ('pack-3', '9 crédits · Le mouvement', 9, 59100, 'EUR', 45, 120, true, '{"kind":"credit_pack","credit_minutes":15,"featured":false}'::jsonb),
  ('pack-6', '18 crédits · La transformation', 18, 88200, 'EUR', 45, 240, true, '{"kind":"credit_pack","credit_minutes":15,"featured":true}'::jsonb),
  ('membership-3', 'Membership · 3 crédits par mois', 3, 17700, 'EUR', 45, 90, true, '{"kind":"membership","billing_interval":"month","credit_minutes":15,"featured":false}'::jsonb),
  ('membership-6', 'Membership · 6 crédits par mois', 6, 31800, 'EUR', 45, 90, true, '{"kind":"membership","billing_interval":"month","credit_minutes":15,"featured":true}'::jsonb),
  ('membership-12', 'Membership · 12 crédits par mois', 12, 58800, 'EUR', 45, 90, true, '{"kind":"membership","billing_interval":"month","credit_minutes":15,"featured":false}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  sessions_count = excluded.sessions_count,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  duration_minutes = excluded.duration_minutes,
  validity_days = excluded.validity_days,
  is_active = excluded.is_active,
  metadata = coalesce(public.coaching_offers.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

insert into public.coaching_coach_compensation_rules(coach_id)
select id from public.coaching_coaches where status = 'active'
on conflict (coach_id) do nothing;

-- Plusieurs poches de crédits peuvent financer une même séance (FIFO).
drop index if exists public.coaching_credit_one_booking_debit;
create unique index if not exists coaching_credit_booking_bucket_unique
  on public.coaching_credit_ledger(session_id, engagement_id, reason)
  where reason = 'booking';
create unique index if not exists coaching_credit_cancellation_bucket_unique
  on public.coaching_credit_ledger(session_id, engagement_id, reason)
  where reason = 'cancellation';

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
  v_bucket record;
  v_duration integer := 45;
  v_cost integer := 3;
  v_to_debit integer;
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
  where slot.id = p_slot_id and slot.coach_id = v_client.coach_id
    and slot.status = 'available' and slot.starts_at > now() + interval '2 hours'
  for update;
  if v_slot.id is null then raise exception 'slot_unavailable'; end if;
  if not exists (
    select 1 from public.coaching_form_responses response
    where response.client_id = v_client.id and response.status = 'submitted' and response.session_id is null
  ) then raise exception 'preparation_required'; end if;

  select engagement.* into v_engagement
  from public.coaching_engagements engagement
  join public.coaching_offers offer on offer.id = engagement.offer_id
  where engagement.client_id = v_client.id and engagement.status = 'active'
    and (engagement.expires_at is null or engagement.expires_at > now())
    and (select coalesce(sum(ledger.quantity), 0) from public.coaching_credit_ledger ledger where ledger.engagement_id = engagement.id) > 0
  order by engagement.expires_at asc nulls last, engagement.started_at asc
  limit 1;
  if v_engagement.id is null then raise exception 'engagement_missing'; end if;

  select coalesce(offer.duration_minutes, 45) into v_duration
  from public.coaching_offers offer where offer.id = v_engagement.offer_id;
  v_duration := greatest(15, least(v_duration, 240));
  v_cost := greatest(1, ceil(v_duration / 15.0)::integer);

  select coalesce(sum(quantity), 0)::integer into v_balance
  from public.coaching_credit_ledger ledger
  left join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
  where ledger.client_id = v_client.id
    and (ledger.engagement_id is null or (engagement.status = 'active' and (engagement.expires_at is null or engagement.expires_at > now())));
  if v_balance < v_cost then raise exception 'insufficient_credits'; end if;
  if v_slot.ends_at < v_slot.starts_at + make_interval(mins => v_duration) then raise exception 'slot_too_short'; end if;

  update public.coaching_availability_slots set status = 'booked', held_until = null where id = v_slot.id;
  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, timezone, status, source, credits_cost)
  values (v_client.id, v_client.coach_id, v_engagement.id, v_slot.starts_at, v_slot.starts_at + make_interval(mins => v_duration), left(coalesce(p_timezone, 'Europe/Zurich'), 80), 'confirmed', 'portal', v_cost)
  returning * into v_session;

  v_to_debit := v_cost;
  for v_bucket in
    select engagement.id, coalesce(sum(ledger.quantity), 0)::integer as available
    from public.coaching_engagements engagement
    join public.coaching_credit_ledger ledger on ledger.engagement_id = engagement.id
    where engagement.client_id = v_client.id and engagement.status = 'active'
      and (engagement.expires_at is null or engagement.expires_at > now())
    group by engagement.id, engagement.expires_at, engagement.started_at
    having coalesce(sum(ledger.quantity), 0) > 0
    order by engagement.expires_at asc nulls last, engagement.started_at asc
  loop
    exit when v_to_debit <= 0;
    insert into public.coaching_credit_ledger(client_id, engagement_id, session_id, quantity, reason, created_by)
    values (v_client.id, v_bucket.id, v_session.id, -least(v_bucket.available, v_to_debit), 'booking', auth.uid());
    v_to_debit := v_to_debit - least(v_bucket.available, v_to_debit);
  end loop;
  if v_to_debit <> 0 then raise exception 'credit_debit_incomplete'; end if;

  update public.coaching_form_responses set session_id = v_session.id
  where id = (
    select response.id from public.coaching_form_responses response
    where response.client_id = v_client.id and response.status = 'submitted' and response.session_id is null
    order by response.submitted_at desc nulls last, response.created_at desc limit 1
  );
  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id, metadata)
  values (auth.uid(), 'session.booked', 'session', v_session.id, v_client.id, jsonb_build_object('starts_at', v_session.starts_at, 'credits', v_cost));
  return query select v_session.id, v_session.starts_at, v_session.ends_at, v_balance - v_cost;
exception when unique_violation then raise exception 'slot_unavailable';
end;
$$;

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
  update public.coaching_sessions set status = 'cancelled', cancelled_at = now(), cancellation_reason = left(p_reason, 500) where id = v_session.id;
  update public.coaching_availability_slots set status = 'available'
  where coach_id = v_session.coach_id and starts_at = v_session.starts_at and status = 'booked';

  insert into public.coaching_credit_ledger(client_id, engagement_id, session_id, quantity, reason, created_by)
  select debit.client_id, debit.engagement_id, debit.session_id, -debit.quantity, 'cancellation', auth.uid()
  from public.coaching_credit_ledger debit
  where debit.session_id = v_session.id and debit.reason = 'booking' and debit.quantity < 0
  on conflict do nothing;

  select coalesce(sum(quantity), 0)::integer into v_balance
  from public.coaching_credit_ledger ledger
  left join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
  where ledger.client_id = v_session.client_id
    and (ledger.engagement_id is null or (engagement.status = 'active' and (engagement.expires_at is null or engagement.expires_at > now())));
  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id)
  values (auth.uid(), 'session.cancelled', 'session', v_session.id, v_session.client_id);
  return query select v_session.id, v_balance;
end;
$$;

create or replace function public.coaching_complete_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.coaching_sessions%rowtype;
  v_rule public.coaching_coach_compensation_rules%rowtype;
  v_offer_slug text;
  v_base integer;
begin
  if public.coaching_current_role() <> 'coach' then raise exception 'coach_required'; end if;
  select session.* into v_session from public.coaching_sessions session
  where session.id = p_session_id and session.coach_id = public.coaching_current_coach_id() for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_session.status <> 'confirmed' then raise exception 'session_not_completable'; end if;
  if v_session.starts_at > now() + interval '15 minutes' then raise exception 'session_too_early'; end if;

  update public.coaching_sessions set status = 'completed', completed_at = now() where id = v_session.id;
  select offer.slug into v_offer_slug
  from public.coaching_engagements engagement join public.coaching_offers offer on offer.id = engagement.offer_id
  where engagement.id = v_session.engagement_id;
  select * into v_rule from public.coaching_coach_compensation_rules where coach_id = v_session.coach_id and active = true;
  if v_rule.coach_id is null then
    insert into public.coaching_coach_compensation_rules(coach_id) values (v_session.coach_id)
    on conflict (coach_id) do update set updated_at = now() returning * into v_rule;
  end if;
  v_base := case when v_offer_slug = 'first-consultation'
    then v_rule.first_consultation_cents
    else v_session.credits_cost * v_rule.base_cents_per_credit end;
  insert into public.coaching_coach_payout_ledger(coach_id, client_id, session_id, credits_delivered, base_amount_cents, currency)
  values (v_session.coach_id, v_session.client_id, v_session.id, v_session.credits_cost, v_base, v_rule.currency)
  on conflict (session_id) do nothing;
  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id, metadata)
  values (auth.uid(), 'session.completed', 'session', v_session.id, v_session.client_id, jsonb_build_object('credits', v_session.credits_cost, 'coach_base_cents', v_base));
  return v_session.id;
end;
$$;

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
  where provider = 'spiffy' and provider_order_id = p_provider_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.status = 'refunded' then
    return query select v_order.id, v_order.client_id, 0, true;
    return;
  end if;
  select * into v_offer from public.coaching_offers where id = v_order.offer_id;

  -- Une réservation peut avoir consommé plusieurs poches. Chaque débit est
  -- restitué exactement avant le retrait de la poche remboursée.
  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, session_id, quantity, reason, note)
  select debit.client_id, debit.engagement_id, v_order.id, debit.session_id, -debit.quantity,
    'cancellation', 'Annulation automatique après remboursement'
  from public.coaching_credit_ledger debit
  join public.coaching_sessions session on session.id = debit.session_id
  where session.engagement_id = v_order.engagement_id
    and session.status = 'confirmed' and session.starts_at > now()
    and debit.reason = 'booking' and debit.quantity < 0
  on conflict do nothing;

  update public.coaching_availability_slots slot set status = 'available', held_until = null
  where slot.status = 'booked' and exists (
    select 1 from public.coaching_sessions session
    where session.engagement_id = v_order.engagement_id and session.status = 'confirmed'
      and session.starts_at > now() and session.coach_id = slot.coach_id and session.starts_at = slot.starts_at
  );
  update public.coaching_sessions set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Remboursement Spiffy'
  where engagement_id = v_order.engagement_id and status = 'confirmed' and starts_at > now();
  update public.coaching_orders set status = 'refunded', refunded_at = now() where id = v_order.id;
  update public.coaching_engagements set status = 'cancelled' where id = v_order.engagement_id and status <> 'completed';
  insert into public.coaching_credit_ledger(client_id, engagement_id, order_id, quantity, reason, note)
  values (v_order.client_id, v_order.engagement_id, v_order.id, -v_offer.sessions_count, 'refund', 'Remboursement Spiffy');
  insert into public.coaching_activity_log(event_type, entity_type, entity_id, client_id)
  values ('order.refunded', 'order', v_order.id, v_order.client_id);
  return query select v_order.id, v_order.client_id, v_offer.sessions_count, false;
end;
$$;

create or replace function public.coaching_update_my_profile(
  p_first_name text,
  p_last_name text default null,
  p_phone text default null,
  p_country text default null,
  p_timezone text default 'Europe/Zurich',
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.coaching_current_role();
begin
  if nullif(trim(p_first_name), '') is null then raise exception 'first_name_required'; end if;
  if v_role = 'client' then
    update public.coaching_clients set
      first_name = left(trim(p_first_name), 100), last_name = nullif(left(trim(p_last_name), 100), ''),
      phone = nullif(left(trim(p_phone), 40), ''), country = nullif(upper(left(trim(p_country), 2)), ''),
      timezone = left(coalesce(nullif(trim(p_timezone), ''), 'Europe/Zurich'), 80),
      avatar_url = nullif(left(trim(p_avatar_url), 1000), '')
    where auth_user_id = auth.uid();
  elsif v_role = 'coach' then
    update public.coaching_coaches set
      first_name = left(trim(p_first_name), 100), last_name = nullif(left(trim(p_last_name), 100), ''),
      phone = nullif(left(trim(p_phone), 40), ''), country = nullif(upper(left(trim(p_country), 2)), ''),
      timezone = left(coalesce(nullif(trim(p_timezone), ''), 'Europe/Zurich'), 80),
      avatar_url = nullif(left(trim(p_avatar_url), 1000), '')
    where auth_user_id = auth.uid();
  else
    raise exception 'profile_role_not_supported';
  end if;
  return jsonb_build_object('ok', true, 'role', v_role);
end;
$$;

create or replace function public.coaching_upsert_spiffy_subscription(
  p_provider_subscription_id text,
  p_client_id uuid,
  p_offer_slug text,
  p_status text default 'active',
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null
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
    client_id, offer_id, provider, provider_subscription_id, status,
    current_period_start, current_period_end,
    cancelled_at
  ) values (
    p_client_id, v_offer_id, 'spiffy', left(trim(p_provider_subscription_id), 255), v_status,
    p_current_period_start, p_current_period_end,
    case when v_status = 'cancelled' then now() else null end
  )
  on conflict (provider, provider_subscription_id) do update set
    client_id = excluded.client_id,
    offer_id = excluded.offer_id,
    status = excluded.status,
    current_period_start = coalesce(excluded.current_period_start, public.coaching_subscriptions.current_period_start),
    current_period_end = coalesce(excluded.current_period_end, public.coaching_subscriptions.current_period_end),
    cancelled_at = case when excluded.status = 'cancelled' then now() else null end,
    updated_at = now()
  returning id into v_subscription_id;
  return v_subscription_id;
end;
$$;

revoke all on function public.coaching_book_session(uuid, text) from public, anon, authenticated;
revoke all on function public.coaching_cancel_session(uuid, text) from public, anon, authenticated;
revoke all on function public.coaching_complete_session(uuid) from public, anon, authenticated;
revoke all on function public.coaching_update_my_profile(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.coaching_refund_spiffy_order(text) from public, anon, authenticated;
revoke all on function public.coaching_upsert_spiffy_subscription(text, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.coaching_book_session(uuid, text) to authenticated;
grant execute on function public.coaching_cancel_session(uuid, text) to authenticated;
grant execute on function public.coaching_complete_session(uuid) to authenticated;
grant execute on function public.coaching_update_my_profile(text, text, text, text, text, text) to authenticated;
grant execute on function public.coaching_refund_spiffy_order(text) to service_role;
grant execute on function public.coaching_upsert_spiffy_subscription(text, uuid, text, text, timestamptz, timestamptz) to service_role;

comment on table public.coaching_subscriptions is 'État des memberships récurrents. Chaque renouvellement ajoute une nouvelle poche de crédits via le journal.';
comment on table public.coaching_coach_payout_ledger is 'Montants dus aux coachs, créés à la clôture des séances. Les bonus restent approuvés par le propriétaire.';
comment on column public.coaching_sessions.credits_cost is 'Nombre de crédits consommés ; un crédit représente 15 minutes.';
