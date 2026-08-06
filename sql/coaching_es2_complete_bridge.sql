-- Pont additif ES2 Complet -> Coaching OS.
-- 12 crédits libres (1 crédit = 15 minutes), origine visible et rémunération
-- totale exacte de 400 EUR lorsque les 12 crédits ES2 ont été consommés.

insert into public.coaching_offers (
  slug, name, sessions_count, price_cents, currency, duration_minutes,
  validity_days, is_active, metadata
)
values (
  'es2-complete-coaching',
  'ES2 Complet · 4 consultations incluses',
  12,
  0,
  'EUR',
  45,
  null,
  true,
  '{"kind":"included_coaching","origin":"es2_complete","credit_minutes":15,"included_consultations":4,"coach_payout_total_cents":40000,"coach_payout_credits":12}'::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  sessions_count = excluded.sessions_count,
  currency = excluded.currency,
  duration_minutes = excluded.duration_minutes,
  validity_days = excluded.validity_days,
  is_active = excluded.is_active,
  metadata = coalesce(public.coaching_offers.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

alter table public.coaching_sessions
  add column if not exists booking_origin text not null default 'direct';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coaching_sessions_booking_origin_check'
      and conrelid = 'public.coaching_sessions'::regclass
  ) then
    alter table public.coaching_sessions
      add constraint coaching_sessions_booking_origin_check
      check (booking_origin in ('direct', 'first_consultation', 'es2_complete', 'mixed'));
  end if;
end $$;

create or replace function public.coaching_refresh_session_origin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_es2 boolean;
  v_has_first boolean;
  v_has_direct boolean;
begin
  if new.session_id is null or new.reason <> 'booking' then return new; end if;

  select
    coalesce(bool_or(offer.slug = 'es2-complete-coaching' or offer.metadata ->> 'origin' = 'es2_complete'), false),
    coalesce(bool_or(offer.slug = 'first-consultation'), false),
    coalesce(bool_or(
      offer.slug <> 'first-consultation'
      and offer.slug <> 'es2-complete-coaching'
      and coalesce(offer.metadata ->> 'origin', '') <> 'es2_complete'
    ), false)
  into v_has_es2, v_has_first, v_has_direct
  from public.coaching_credit_ledger ledger
  left join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
  left join public.coaching_offers offer on offer.id = engagement.offer_id
  where ledger.session_id = new.session_id
    and ledger.reason = 'booking'
    and ledger.quantity < 0;

  update public.coaching_sessions
  set booking_origin = case
    when v_has_es2 and (v_has_direct or v_has_first) then 'mixed'
    when v_has_es2 then 'es2_complete'
    when v_has_first and v_has_direct then 'mixed'
    when v_has_first then 'first_consultation'
    else 'direct'
  end
  where id = new.session_id;

  return new;
end;
$$;

drop trigger if exists coaching_credit_refresh_session_origin on public.coaching_credit_ledger;
create trigger coaching_credit_refresh_session_origin
after insert on public.coaching_credit_ledger
for each row
when (new.session_id is not null and new.reason = 'booking')
execute function public.coaching_refresh_session_origin();

-- Rattrape l'origine des séances déjà présentes sans modifier leurs crédits.
update public.coaching_sessions session
set booking_origin = case
  when exists (
    select 1 from public.coaching_credit_ledger ledger
    join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
    join public.coaching_offers offer on offer.id = engagement.offer_id
    where ledger.session_id = session.id and ledger.reason = 'booking' and ledger.quantity < 0
      and (offer.slug = 'es2-complete-coaching' or offer.metadata ->> 'origin' = 'es2_complete')
  ) and exists (
    select 1 from public.coaching_credit_ledger ledger
    join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
    join public.coaching_offers offer on offer.id = engagement.offer_id
    where ledger.session_id = session.id and ledger.reason = 'booking' and ledger.quantity < 0
      and offer.slug <> 'es2-complete-coaching'
      and coalesce(offer.metadata ->> 'origin', '') <> 'es2_complete'
  ) then 'mixed'
  when exists (
    select 1 from public.coaching_credit_ledger ledger
    join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
    join public.coaching_offers offer on offer.id = engagement.offer_id
    where ledger.session_id = session.id and ledger.reason = 'booking' and ledger.quantity < 0
      and (offer.slug = 'es2-complete-coaching' or offer.metadata ->> 'origin' = 'es2_complete')
  ) then 'es2_complete'
  when exists (
    select 1 from public.coaching_credit_ledger ledger
    join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
    join public.coaching_offers offer on offer.id = engagement.offer_id
    where ledger.session_id = session.id and ledger.reason = 'booking' and ledger.quantity < 0
      and offer.slug = 'first-consultation'
  ) then 'first_consultation'
  else 'direct'
end
where exists (
  select 1 from public.coaching_credit_ledger ledger
  where ledger.session_id = session.id and ledger.reason = 'booking' and ledger.quantity < 0
);

-- Une séance peut consommer plusieurs poches. La rémunération est calculée
-- poche par poche. Pour ES2, un arrondi cumulatif garantit exactement 400 EUR
-- au total, quelles que soient les durées choisies (30, 45, 60 ou 90 min).
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
  v_bucket record;
  v_base integer := 0;
  v_bucket_count integer := 0;
  v_completed_credits integer;
  v_previous_credits integer;
  v_payout_total integer;
  v_payout_credits integer;
  v_es2_credits integer := 0;
  v_direct_credits integer := 0;
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

  select offer.slug into v_offer_slug
  from public.coaching_engagements engagement
  join public.coaching_offers offer on offer.id = engagement.offer_id
  where engagement.id = v_session.engagement_id;

  select * into v_rule
  from public.coaching_coach_compensation_rules
  where coach_id = v_session.coach_id and active = true;
  if v_rule.coach_id is null then
    insert into public.coaching_coach_compensation_rules(coach_id)
    values (v_session.coach_id)
    on conflict (coach_id) do update set updated_at = now()
    returning * into v_rule;
  end if;

  if v_offer_slug = 'first-consultation' then
    v_base := v_rule.first_consultation_cents;
  else
    for v_bucket in
      select
        ledger.engagement_id,
        (-sum(ledger.quantity))::integer as credits,
        offer.slug,
        offer.sessions_count,
        offer.metadata
      from public.coaching_credit_ledger ledger
      join public.coaching_engagements engagement on engagement.id = ledger.engagement_id
      join public.coaching_offers offer on offer.id = engagement.offer_id
      where ledger.session_id = v_session.id
        and ledger.reason = 'booking'
        and ledger.quantity < 0
      group by ledger.engagement_id, offer.slug, offer.sessions_count, offer.metadata
    loop
      v_bucket_count := v_bucket_count + 1;
      perform 1 from public.coaching_engagements where id = v_bucket.engagement_id for update;

      if v_bucket.slug = 'es2-complete-coaching' or v_bucket.metadata ->> 'origin' = 'es2_complete' then
        v_payout_total := case
          when coalesce(v_bucket.metadata ->> 'coach_payout_total_cents', '') ~ '^[0-9]+$'
            then (v_bucket.metadata ->> 'coach_payout_total_cents')::integer
          else 40000
        end;
        v_payout_credits := case
          when coalesce(v_bucket.metadata ->> 'coach_payout_credits', '') ~ '^[1-9][0-9]*$'
            then (v_bucket.metadata ->> 'coach_payout_credits')::integer
          else greatest(v_bucket.sessions_count, 1)
        end;

        select coalesce(sum(-ledger.quantity), 0)::integer
        into v_completed_credits
        from public.coaching_credit_ledger ledger
        join public.coaching_sessions completed_session on completed_session.id = ledger.session_id
        where ledger.engagement_id = v_bucket.engagement_id
          and ledger.reason = 'booking'
          and ledger.quantity < 0
          and completed_session.status = 'completed';

        v_previous_credits := greatest(v_completed_credits - v_bucket.credits, 0);
        v_base := v_base
          + round(v_completed_credits::numeric * v_payout_total / v_payout_credits)::integer
          - round(v_previous_credits::numeric * v_payout_total / v_payout_credits)::integer;
        v_es2_credits := v_es2_credits + v_bucket.credits;
      else
        v_base := v_base + v_bucket.credits * v_rule.base_cents_per_credit;
        v_direct_credits := v_direct_credits + v_bucket.credits;
      end if;
    end loop;

    -- Compatibilité avec une ancienne séance créée manuellement sans débit.
    if v_bucket_count = 0 then
      v_base := v_session.credits_cost * v_rule.base_cents_per_credit;
      v_direct_credits := v_session.credits_cost;
    end if;
  end if;

  insert into public.coaching_coach_payout_ledger(
    coach_id, client_id, session_id, credits_delivered,
    base_amount_cents, currency, note
  ) values (
    v_session.coach_id, v_session.client_id, v_session.id,
    v_session.credits_cost, v_base, v_rule.currency,
    case
      when v_offer_slug = 'first-consultation' then 'Première consultation'
      when v_es2_credits > 0 and v_direct_credits > 0 then 'Crédits ES2 Complet + coaching direct'
      when v_es2_credits > 0 then 'Crédits ES2 Complet'
      else 'Crédits coaching direct'
    end
  )
  on conflict (session_id) do nothing;

  insert into public.coaching_activity_log(
    actor_user_id, event_type, entity_type, entity_id, client_id, metadata
  ) values (
    auth.uid(), 'session.completed', 'session', v_session.id, v_session.client_id,
    jsonb_build_object(
      'credits', v_session.credits_cost,
      'es2_credits', v_es2_credits,
      'direct_credits', v_direct_credits,
      'coach_base_cents', v_base
    )
  );

  return v_session.id;
end;
$$;

revoke all on function public.coaching_complete_session(uuid)
  from public, anon, authenticated;
grant execute on function public.coaching_complete_session(uuid)
  to authenticated;

-- Un remboursement ES2 annule aussi une séance future qui aurait été financée
-- par plusieurs poches. Tous les débits de cette séance sont restitués avant
-- le retrait des 12 crédits de la commande remboursée.
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
  select * into v_order
  from public.coaching_orders
  where provider = 'spiffy' and provider_order_id = p_provider_order_id
  for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.status = 'refunded' then
    return query select v_order.id, v_order.client_id, 0, true;
    return;
  end if;

  select * into v_offer from public.coaching_offers where id = v_order.offer_id;

  insert into public.coaching_credit_ledger(
    client_id, engagement_id, order_id, session_id, quantity, reason, note
  )
  select
    debit.client_id,
    debit.engagement_id,
    v_order.id,
    debit.session_id,
    -debit.quantity,
    'cancellation',
    'Annulation automatique après remboursement'
  from public.coaching_credit_ledger debit
  join public.coaching_sessions session on session.id = debit.session_id
  where session.status = 'confirmed'
    and session.starts_at > now()
    and debit.reason = 'booking'
    and debit.quantity < 0
    and exists (
      select 1
      from public.coaching_credit_ledger target_debit
      where target_debit.session_id = session.id
        and target_debit.engagement_id = v_order.engagement_id
        and target_debit.reason = 'booking'
        and target_debit.quantity < 0
    )
  on conflict do nothing;

  update public.coaching_sessions session
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = 'Remboursement Spiffy'
  where session.status = 'confirmed'
    and session.starts_at > now()
    and exists (
      select 1
      from public.coaching_credit_ledger target_debit
      where target_debit.session_id = session.id
        and target_debit.engagement_id = v_order.engagement_id
        and target_debit.reason = 'booking'
        and target_debit.quantity < 0
    );

  update public.coaching_orders
  set status = 'refunded', refunded_at = now()
  where id = v_order.id;
  update public.coaching_engagements
  set status = 'cancelled'
  where id = v_order.engagement_id and status <> 'completed';
  insert into public.coaching_credit_ledger(
    client_id, engagement_id, order_id, quantity, reason, note
  ) values (
    v_order.client_id, v_order.engagement_id, v_order.id,
    -v_offer.sessions_count, 'refund', 'Remboursement Spiffy'
  );
  insert into public.coaching_activity_log(
    event_type, entity_type, entity_id, client_id
  ) values ('order.refunded', 'order', v_order.id, v_order.client_id);

  return query select v_order.id, v_order.client_id, v_offer.sessions_count, false;
end;
$$;

revoke all on function public.coaching_refund_spiffy_order(text)
  from public, anon, authenticated;
grant execute on function public.coaching_refund_spiffy_order(text)
  to service_role;

comment on column public.coaching_sessions.booking_origin is
  'Origine commerciale des crédits consommés : direct, première consultation, ES2 Complet ou mixte.';
