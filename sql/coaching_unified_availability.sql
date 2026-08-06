-- Disponibilités unifiées Coaching Sonny Court
-- Migration additive et idempotente : aucune table ni donnée existante n'est supprimée.
-- Une plage coach est découpée en unités techniques de 15 minutes. Les élèves
-- peuvent ensuite réserver 30, 45, 60 ou 90 minutes sans double réservation.

create index if not exists coaching_availability_atomic_idx
  on public.coaching_availability_slots(coach_id, starts_at, ends_at, status);

-- UX coach simplifiée : le coach choisit seulement ses jours et sa plage horaire.
create or replace function public.coaching_replace_my_availability_windows(
  p_weekdays smallint[],
  p_start_time time,
  p_end_time time,
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
  if public.coaching_current_role() <> 'coach' or v_coach_id is null then
    raise exception 'coach_required';
  end if;
  if coalesce(array_length(p_weekdays, 1), 0) = 0
    or exists (
      select 1 from unnest(p_weekdays) as d(day_number)
      where day_number not between 1 and 7
    ) then
    raise exception 'invalid_weekdays';
  end if;
  if p_end_time <= p_start_time then raise exception 'invalid_schedule'; end if;

  delete from public.coaching_availability_rules where coach_id = v_coach_id;
  insert into public.coaching_availability_rules(
    coach_id, weekday, start_time, end_time, slot_minutes, buffer_minutes, timezone
  )
  select
    v_coach_id,
    day,
    p_start_time,
    p_end_time,
    15,
    0,
    left(coalesce(nullif(trim(p_timezone), ''), 'Europe/Zurich'), 80)
  from (select distinct unnest(p_weekdays) as day) days;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.coaching_replace_my_availability_windows(smallint[], time, time, text)
  from public, anon, authenticated;
grant execute on function public.coaching_replace_my_availability_windows(smallint[], time, time, text)
  to authenticated;

-- L'ancien RPC reste présent pour ne casser aucune dépendance historique, mais
-- le front ne peut plus l'appeler directement avec une durée fixe.
revoke all on function public.coaching_replace_my_availability_rules(smallint[], time, time, integer, integer, text)
  from public, anon, authenticated;

-- Empêche tout chevauchement de séances, y compris entre une première
-- consultation et un suivi réservé depuis l'espace élève.
create or replace function public.coaching_guard_session_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('held', 'confirmed') and exists (
    select 1
    from public.coaching_sessions existing
    where existing.coach_id = new.coach_id
      and existing.id <> new.id
      and existing.status in ('held', 'confirmed')
      and existing.starts_at < new.ends_at
      and existing.ends_at > new.starts_at
  ) then
    raise exception 'session_overlap';
  end if;
  return new;
end;
$$;

drop trigger if exists coaching_sessions_guard_overlap on public.coaching_sessions;
create trigger coaching_sessions_guard_overlap
before insert or update of starts_at, ends_at, status, coach_id
on public.coaching_sessions
for each row execute function public.coaching_guard_session_overlap();

-- Une séance confirmée consomme toutes les unités de 15 minutes qu'elle couvre.
-- Une annulation les libère, sauf si une autre séance active les utilise.
create or replace function public.coaching_sync_session_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    update public.coaching_availability_slots slot
    set status = 'booked', held_until = null
    where slot.coach_id = new.coach_id
      and slot.starts_at >= new.starts_at
      and slot.starts_at < new.ends_at
      and slot.status in ('available', 'held');
  elsif tg_op = 'UPDATE' and old.status in ('held', 'confirmed') and new.status = 'cancelled' then
    update public.coaching_availability_slots slot
    set status = 'available', held_until = null
    where slot.coach_id = new.coach_id
      and slot.starts_at >= new.starts_at
      and slot.starts_at < new.ends_at
      and slot.status = 'booked'
      and not exists (
        select 1 from public.coaching_sessions other
        where other.id <> new.id
          and other.coach_id = new.coach_id
          and other.status in ('held', 'confirmed')
          and other.starts_at < slot.ends_at
          and other.ends_at > slot.starts_at
      );
  end if;
  return new;
end;
$$;

drop trigger if exists coaching_sessions_sync_inventory on public.coaching_sessions;
create trigger coaching_sessions_sync_inventory
after insert or update of status
on public.coaching_sessions
for each row execute function public.coaching_sync_session_inventory();

-- Réservation d'un suivi à durée choisie. 1 crédit = 15 minutes.
create or replace function public.coaching_book_session(
  p_slot_id uuid,
  p_duration_minutes integer,
  p_timezone text default 'Europe/Zurich'
)
returns table(
  session_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  credits_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.coaching_clients%rowtype;
  v_engagement public.coaching_engagements%rowtype;
  v_start_slot public.coaching_availability_slots%rowtype;
  v_piece record;
  v_bucket record;
  v_session public.coaching_sessions%rowtype;
  v_slot_ids uuid[] := array[]::uuid[];
  v_expected timestamptz;
  v_end timestamptz;
  v_units integer;
  v_cost integer;
  v_balance integer;
  v_to_debit integer;
  v_coach_slug text;
begin
  if public.coaching_current_role() <> 'client' then raise exception 'client_required'; end if;
  if p_duration_minutes not in (30, 45, 60, 90) then raise exception 'invalid_duration'; end if;

  v_units := p_duration_minutes / 15;
  v_cost := v_units;

  select * into v_client
  from public.coaching_clients
  where auth_user_id = auth.uid()
  for update;
  if v_client.id is null then raise exception 'client_profile_missing'; end if;
  if v_client.coach_id is null then raise exception 'coach_not_assigned'; end if;

  select slot.* into v_start_slot
  from public.coaching_availability_slots slot
  where slot.id = p_slot_id
    and slot.coach_id = v_client.coach_id
    and slot.status = 'available'
    and slot.starts_at > now() + interval '2 hours'
  for update;
  if v_start_slot.id is null then raise exception 'slot_unavailable'; end if;

  v_expected := v_start_slot.starts_at;
  v_end := v_start_slot.starts_at + make_interval(mins => p_duration_minutes);

  for v_piece in
    select slot.id, slot.starts_at, slot.ends_at, slot.status
    from public.coaching_availability_slots slot
    where slot.coach_id = v_client.coach_id
      and slot.starts_at >= v_start_slot.starts_at
      and slot.starts_at < v_end
    order by slot.starts_at
    for update
  loop
    if v_piece.status <> 'available'
      or v_piece.starts_at <> v_expected
      or v_piece.ends_at <> v_expected + interval '15 minutes' then
      raise exception 'slot_unavailable';
    end if;
    v_slot_ids := array_append(v_slot_ids, v_piece.id);
    v_expected := v_expected + interval '15 minutes';
  end loop;

  if coalesce(array_length(v_slot_ids, 1), 0) <> v_units or v_expected <> v_end then
    raise exception 'slot_too_short';
  end if;

  select slug into v_coach_slug from public.coaching_coaches where id = v_client.coach_id;
  if exists (
    select 1 from public.coach_diagnostic_slots diagnostic
    where diagnostic.coach_slug = v_coach_slug
      and diagnostic.status in ('held', 'booked')
      and (diagnostic.status = 'booked' or diagnostic.held_until > now())
      and diagnostic.starts_at < v_end
      and diagnostic.ends_at > v_start_slot.starts_at
  ) then
    raise exception 'slot_unavailable';
  end if;

  if not exists (
    select 1 from public.coaching_form_responses response
    where response.client_id = v_client.id
      and response.status = 'submitted'
      and response.session_id is null
  ) then
    raise exception 'preparation_required';
  end if;

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
  if v_balance < v_cost then raise exception 'insufficient_credits'; end if;

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

  update public.coaching_availability_slots
  set status = 'booked', held_until = null
  where id = any(v_slot_ids) and status = 'available';
  if not found then raise exception 'slot_unavailable'; end if;

  insert into public.coaching_sessions(
    client_id, coach_id, engagement_id, starts_at, ends_at,
    timezone, status, source, credits_cost
  ) values (
    v_client.id, v_client.coach_id, v_engagement.id,
    v_start_slot.starts_at, v_end,
    left(coalesce(nullif(trim(p_timezone), ''), 'Europe/Zurich'), 80),
    'confirmed', 'portal', v_cost
  ) returning * into v_session;

  v_to_debit := v_cost;
  for v_bucket in
    select
      engagement.id,
      coalesce(sum(ledger.quantity), 0)::integer as available
    from public.coaching_engagements engagement
    join public.coaching_credit_ledger ledger on ledger.engagement_id = engagement.id
    where engagement.client_id = v_client.id
      and engagement.status = 'active'
      and (engagement.expires_at is null or engagement.expires_at > now())
    group by engagement.id, engagement.expires_at, engagement.started_at
    having coalesce(sum(ledger.quantity), 0) > 0
    order by engagement.expires_at asc nulls last, engagement.started_at asc
  loop
    exit when v_to_debit <= 0;
    insert into public.coaching_credit_ledger(
      client_id, engagement_id, session_id, quantity, reason, created_by
    ) values (
      v_client.id, v_bucket.id, v_session.id,
      -least(v_bucket.available, v_to_debit), 'booking', auth.uid()
    );
    v_to_debit := v_to_debit - least(v_bucket.available, v_to_debit);
  end loop;
  if v_to_debit <> 0 then raise exception 'credit_debit_incomplete'; end if;

  update public.coaching_form_responses
  set session_id = v_session.id
  where id = (
    select response.id
    from public.coaching_form_responses response
    where response.client_id = v_client.id
      and response.status = 'submitted'
      and response.session_id is null
    order by response.submitted_at desc nulls last, response.created_at desc
    limit 1
  );

  insert into public.coaching_activity_log(
    actor_user_id, event_type, entity_type, entity_id, client_id, metadata
  ) values (
    auth.uid(), 'session.booked', 'session', v_session.id, v_client.id,
    jsonb_build_object(
      'starts_at', v_session.starts_at,
      'duration_minutes', p_duration_minutes,
      'credits', v_cost
    )
  );

  return query
    select v_session.id, v_session.starts_at, v_session.ends_at, v_balance - v_cost;
exception
  when unique_violation then raise exception 'slot_unavailable';
end;
$$;

revoke all on function public.coaching_book_session(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.coaching_book_session(uuid, integer, text)
  to authenticated;

-- L'ancien endpoint à durée implicite n'est plus exposé aux utilisateurs.
revoke all on function public.coaching_book_session(uuid, text)
  from public, anon, authenticated;

-- Première consultation : verrouille les trois unités de 15 minutes du même
-- inventaire avant de lancer Stripe. Toute erreur annule la transaction entière.
create or replace function public.hold_coach_diagnostic_slot(
  p_slot_id bigint,
  p_name text,
  p_email text
)
returns table(
  booking_token uuid,
  expires_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.coach_diagnostic_slots%rowtype;
  v_booking public.coach_diagnostic_bookings%rowtype;
  v_piece record;
  v_coach_id uuid;
  v_slot_ids uuid[] := array[]::uuid[];
  v_expected timestamptz;
  v_expires timestamptz := now() + interval '20 minutes';
begin
  update public.coach_diagnostic_bookings booking
  set status = 'expired'
  where booking.status = 'pending_payment' and booking.expires_at < now();

  update public.coach_diagnostic_slots slot
  set status = 'available', held_until = null
  where slot.status = 'held' and slot.held_until < now();

  update public.coaching_availability_slots slot
  set status = 'available', held_until = null
  where slot.status = 'held' and slot.held_until < now();

  update public.coach_diagnostic_slots slot
  set status = 'held', held_until = v_expires
  where slot.id = p_slot_id
    and slot.coach_slug = 'romain'
    and slot.starts_at > now() + interval '2 hours'
    and slot.status = 'available'
  returning slot.* into v_slot;
  if v_slot.id is null then raise exception 'slot_unavailable'; end if;
  if v_slot.ends_at <> v_slot.starts_at + interval '45 minutes' then
    raise exception 'invalid_diagnostic_duration';
  end if;

  select id into v_coach_id
  from public.coaching_coaches
  where slug = v_slot.coach_slug and status = 'active'
  limit 1;
  if v_coach_id is null then raise exception 'coach_not_found'; end if;

  if exists (
    select 1 from public.coaching_sessions session
    where session.coach_id = v_coach_id
      and session.status in ('held', 'confirmed')
      and session.starts_at < v_slot.ends_at
      and session.ends_at > v_slot.starts_at
  ) then
    raise exception 'slot_unavailable';
  end if;

  v_expected := v_slot.starts_at;
  for v_piece in
    select atom.id, atom.starts_at, atom.ends_at, atom.status
    from public.coaching_availability_slots atom
    where atom.coach_id = v_coach_id
      and atom.starts_at >= v_slot.starts_at
      and atom.starts_at < v_slot.ends_at
    order by atom.starts_at
    for update
  loop
    if v_piece.status <> 'available'
      or v_piece.starts_at <> v_expected
      or v_piece.ends_at <> v_expected + interval '15 minutes' then
      raise exception 'slot_unavailable';
    end if;
    v_slot_ids := array_append(v_slot_ids, v_piece.id);
    v_expected := v_expected + interval '15 minutes';
  end loop;
  if coalesce(array_length(v_slot_ids, 1), 0) <> 3 or v_expected <> v_slot.ends_at then
    raise exception 'slot_unavailable';
  end if;

  update public.coaching_availability_slots
  set status = 'held', held_until = v_expires
  where id = any(v_slot_ids) and status = 'available';

  insert into public.coach_diagnostic_bookings(
    slot_id, coach_slug, customer_name, customer_email, expires_at
  ) values (
    v_slot.id,
    v_slot.coach_slug,
    left(trim(p_name), 60),
    lower(left(trim(p_email), 254)),
    v_expires
  ) returning * into v_booking;

  return query
    select v_booking.public_token, v_expires, v_slot.starts_at, v_slot.ends_at;
end;
$$;

revoke all on function public.hold_coach_diagnostic_slot(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.hold_coach_diagnostic_slot(bigint, text, text)
  to service_role;
