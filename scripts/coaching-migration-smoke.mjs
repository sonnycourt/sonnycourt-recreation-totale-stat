import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const db = new PGlite({ extensions: { pgcrypto } })

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`)

const migration = await fs.readFile(new URL('../sql/coaching_platform.sql', import.meta.url), 'utf8')
await db.exec(migration)
const diagnosticMigration = await fs.readFile(new URL('../sql/coach_diagnostic.sql', import.meta.url), 'utf8')
await db.exec(diagnosticMigration)

const ids = {
  sonny: '00000000-0000-4000-8000-000000000001',
  romain: '00000000-0000-4000-8000-000000000002',
  alice: '00000000-0000-4000-8000-000000000003',
  lea: '00000000-0000-4000-8000-000000000004',
  bob: '00000000-0000-4000-8000-000000000005',
  stranger: '00000000-0000-4000-8000-000000000006',
  preexisting: '00000000-0000-4000-8000-000000000007'
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const count = async (sql, params = []) => Number((await one(sql, params)).count)
const expectRejected = async (operation, expected) => {
  try {
    await operation()
    assert.fail(`Expected rejection containing: ${expected}`)
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error
    assert.ok(String(error.message).includes(expected), `Expected "${expected}" in: ${error.message}`)
  }
}
const asUser = async (userId, operation) => {
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try {
    return await operation()
  } finally {
    await db.exec('reset role')
  }
}
const asRole = async (role, operation) => {
  await db.exec(`set role ${role}`)
  try {
    return await operation()
  } finally {
    await db.exec('reset role')
  }
}

await db.exec(`
  insert into public.coaching_coaches(slug, first_name, email, status)
  values ('lea', 'Léa', 'lea@example.test', 'active');

  insert into auth.users(id, email, raw_user_meta_data) values
    ('${ids.sonny}', 'sonny@example.test', '{"first_name":"Sonny"}'),
    ('${ids.romain}', 'romain@example.test', '{"first_name":"Romain"}'),
    ('${ids.lea}', 'lea@example.test', '{"first_name":"Léa"}'),
    ('${ids.preexisting}', 'preexisting@example.test', '{"first_name":"Déjà connecté"}');
`)

assert.equal(await count('select count(*) from public.coaching_memberships where user_id = $1', [ids.preexisting]), 0)
assert.equal(await count("select count(*) from public.coaching_clients where email = 'preexisting@example.test'"), 0)

await asRole('service_role', async () => {
  await db.query("select public.coaching_assign_role_by_email($1, 'owner', null)", ['sonny@example.test'])
  await db.query("select public.coaching_assign_role_by_email($1, 'coach', 'romain')", ['romain@example.test'])
  await db.query("select public.coaching_assign_role_by_email($1, 'coach', 'lea')", ['lea@example.test'])
})

const romain = await one("select id from public.coaching_coaches where slug = 'romain'")
const lea = await one("select id from public.coaching_coaches where slug = 'lea'")

const aliceOrder = await asRole('service_role', () => one(`
  select * from public.coaching_record_spiffy_order(
    'spiffy-alice-001', 'alice@example.test', 'Alice', '', 'pack-3',
    59100, 0, 'EUR', 'FR', jsonb_build_object('secret', 'server-only')
  )
`))
const bobOrder = await asRole('service_role', () => one(`
  select * from public.coaching_record_spiffy_order(
    'spiffy-bob-001', 'bob@example.test', 'Bob', '', 'session-1',
    24700, 0, 'EUR', 'CH', '{}'::jsonb
  )
`))
const preexistingOrder = await asRole('service_role', () => one(`
  select * from public.coaching_record_spiffy_order(
    'spiffy-preexisting-001', 'preexisting@example.test', 'Déjà', 'Connecté', 'session-1',
    24700, 0, 'EUR', 'CH', '{}'::jsonb
  )
`))
const alice = { id: aliceOrder.client_id }
const bob = { id: bobOrder.client_id }
assert.equal(await count('select count(*) from public.coaching_clients where id = $1 and auth_user_id = $2', [preexistingOrder.client_id, ids.preexisting]), 1)
assert.equal(await count("select count(*) from public.coaching_memberships where user_id = $1 and role = 'client' and active", [ids.preexisting]), 1)
await db.exec(`
  insert into auth.users(id, email, raw_user_meta_data) values
    ('${ids.alice}', 'alice@example.test', '{"first_name":"Alice"}'),
    ('${ids.bob}', 'bob@example.test', '{"first_name":"Bob"}'),
    ('${ids.stranger}', 'stranger@example.test', '{"first_name":"Inconnu"}');
`)
assert.equal(await count('select count(*) from public.coaching_memberships where user_id = $1', [ids.stranger]), 0)
assert.equal(await count("select count(*) from public.coaching_clients where email = 'stranger@example.test'"), 0)
await expectRejected(
  () => asRole('service_role', () => db.query("select public.coaching_assign_role_by_email($1, 'client', null)", ['stranger@example.test'])),
  'client_profile_not_found'
)
await db.query('update public.coaching_clients set coach_id = $1 where id = $2', [lea.id, bob.id])
await db.query('update public.coaching_engagements set coach_id = $1 where id = $2', [lea.id, bobOrder.engagement_id])

const aliceSlot = await one(`
  insert into public.coaching_availability_slots(coach_id, starts_at, ends_at, status, source)
  values ($1, now() + interval '3 days', now() + interval '3 days 1 hour', 'available', 'manual')
  returning id
`, [romain.id])
await db.query(`
  insert into public.coaching_availability_slots(coach_id, starts_at, ends_at, status, source)
  values
    ($1, now() + interval '4 days', now() + interval '4 days 1 hour', 'blocked', 'manual'),
    ($2, now() + interval '3 days', now() + interval '3 days 1 hour', 'available', 'manual')
`, [romain.id, lea.id])
const bobSlot = await one("select id from public.coaching_availability_slots where coach_id = $1 and status = 'available'", [lea.id])

const template = await one("select id from public.coaching_form_templates where slug = 'session-preparation-v1' and status = 'active'")
const aliceResponse = await one(`
  insert into public.coaching_form_responses(template_id, client_id, submitted_by, status, answers, submitted_at)
  values ($1, $2, $3, 'submitted', '{"focus":"confiance"}'::jsonb, now())
  returning id
`, [template.id, alice.id, ids.alice])

const alicePastSession = await one(`
  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, status, source)
  values ($1, $2, $3, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'completed', 'manual')
  returning id
`, [alice.id, romain.id, aliceOrder.engagement_id])
const bobPastSession = await one(`
  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, status, source)
  values ($1, $2, $3, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'completed', 'manual')
  returning id
`, [bob.id, lea.id, bobOrder.engagement_id])
const aliceToComplete = await one(`
  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, status, source)
  values ($1, $2, $3, now() - interval '1 hour', now() - interval '1 minute', 'confirmed', 'manual')
  returning id
`, [alice.id, romain.id, aliceOrder.engagement_id])
await db.query(`
  insert into public.coaching_session_notes(session_id, coach_id, author_user_id, status, observations)
  values
    ($1, $2, $3, 'final', 'Note privée Alice'),
    ($4, $5, $6, 'final', 'Note privée Bob')
`, [alicePastSession.id, romain.id, ids.romain, bobPastSession.id, lea.id, ids.lea])

const tables = await db.query(`
  select count(*)::integer as count
  from pg_tables
  where schemaname = 'public' and tablename like 'coaching_%'
`)
const rls = await db.query(`
  select count(*)::integer as count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'coaching_%' and c.relrowsecurity
`)
const diagnosticTables = await count(`
  select count(*) from pg_tables
  where schemaname = 'public' and tablename like 'coach_diagnostic_%'
`)
const diagnosticRls = await count(`
  select count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'coach_diagnostic_%' and c.relrowsecurity
`)

assert.equal(Number(tables.rows[0].count), 19)
assert.equal(Number(rls.rows[0].count), 19)
assert.equal(diagnosticTables, 2)
assert.equal(diagnosticRls, 2)
assert.equal((await one("select has_function_privilege('anon', 'public.coaching_book_session(uuid,text)', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('authenticated', 'public.coaching_book_session(uuid,text)', 'EXECUTE') as allowed")).allowed, true)
assert.equal((await one("select has_function_privilege('authenticated', 'public.coaching_assign_role_by_email(text,text,text)', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('authenticated', 'public.coaching_record_spiffy_order(text,text,text,text,text,integer,integer,text,text,jsonb)', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('authenticated', 'public.coaching_refund_spiffy_order(text)', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('authenticated', 'public.coaching_handle_new_auth_user()', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('anon', 'public.hold_coach_diagnostic_slot(bigint,text,text)', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('authenticated', 'public.hold_coach_diagnostic_slot(bigint,text,text)', 'EXECUTE') as allowed")).allowed, false)
assert.equal((await one("select has_function_privilege('service_role', 'public.hold_coach_diagnostic_slot(bigint,text,text)', 'EXECUTE') as allowed")).allowed, true)

const diagnosticSlot = await one(`
  insert into public.coach_diagnostic_slots(starts_at, ends_at)
  values (now() + interval '5 days', now() + interval '5 days 45 minutes')
  returning id
`)
const diagnosticBooking = await asRole('service_role', () => one(
  'select * from public.hold_coach_diagnostic_slot($1, $2, $3)',
  [diagnosticSlot.id, 'Camille', 'camille@example.test']
))
assert.ok(diagnosticBooking.booking_token)
assert.equal(await count("select count(*) from public.coach_diagnostic_bookings where customer_email = 'camille@example.test' and status = 'pending_payment'"), 1)
await expectRejected(
  () => asRole('service_role', () => db.query('select * from public.hold_coach_diagnostic_slot($1, $2, $3)', [diagnosticSlot.id, 'Autre', 'autre@example.test'])),
  'slot_unavailable'
)

await asRole('anon', async () => {
  assert.equal(await count('select count(*) from public.coaching_offers'), 3)
  await expectRejected(() => db.query('select * from public.coaching_clients'), 'permission denied')
})

await asUser(ids.sonny, async () => {
  assert.equal((await one('select public.coaching_current_role() as role')).role, 'owner')
  assert.equal(await count('select count(*) from public.coaching_clients where id in ($1, $2)', [alice.id, bob.id]), 2)
  assert.equal(await count('select count(*) from public.coaching_session_notes'), 0)
})

let aliceActionId = null
await asUser(ids.romain, async () => {
  assert.equal((await one('select public.coaching_current_role() as role')).role, 'coach')
  assert.equal(await count('select count(*) from public.coaching_clients where id = $1', [alice.id]), 1)
  assert.equal(await count('select count(*) from public.coaching_clients where id = $1', [bob.id]), 0)
  assert.equal(await count('select count(*) from public.coaching_session_notes'), 1)
  assert.equal((await one('select public.coaching_replace_my_availability_rules(array[1,3]::smallint[], $1::time, $2::time, 60, 15, $3) as count', ['09:00', '17:00', 'Europe/Zurich'])).count, 2)
  aliceActionId = (await one(`
    insert into public.coaching_actions(client_id, coach_id, title, priority, visibility, origin)
    values ($1, $2, 'Préparer le bilan Alice', 'high', 'coach', 'manual')
    returning id
  `, [alice.id, romain.id])).id
  assert.equal((await db.query("update public.coaching_actions set status = 'done', completed_at = now() where id = $1", [aliceActionId])).affectedRows, 1)
  assert.equal(await count("select count(*) from public.coaching_actions where id = $1 and status = 'done' and completed_at is not null", [aliceActionId]), 1)
  assert.equal((await db.query("update public.coaching_actions set status = 'open', completed_at = null where id = $1", [aliceActionId])).affectedRows, 1)
  assert.equal(await count("select count(*) from public.coaching_actions where id = $1 and status = 'open' and completed_at is null", [aliceActionId]), 1)

  await expectRejected(
    () => db.query(`insert into public.coaching_session_notes(session_id, coach_id, author_user_id, observations) values ($1, $2, $3, 'intrusion')`, [bobPastSession.id, romain.id, ids.romain]),
    'row-level security'
  )
  await expectRejected(
    () => db.query(`insert into public.coaching_sessions(client_id, coach_id, starts_at, ends_at) values ($1, $2, now() + interval '10 days', now() + interval '10 days 1 hour')`, [bob.id, romain.id]),
    'row-level security'
  )
  await expectRejected(
    () => db.query(`insert into public.coaching_engagements(client_id, coach_id, status) values ($1, $2, 'active')`, [bob.id, romain.id]),
    'row-level security'
  )
  await expectRejected(
    () => db.query(`insert into public.coaching_actions(client_id, coach_id, title) values ($1, $2, 'intrusion')`, [bob.id, romain.id]),
    'row-level security'
  )
  await expectRejected(() => db.query('select public.coaching_complete_session($1)', [bobPastSession.id]), 'session_not_found')
  assert.equal((await one('select public.coaching_complete_session($1) as id', [aliceToComplete.id])).id, aliceToComplete.id)
  assert.equal(await count("select count(*) from public.coaching_sessions where id = $1 and status = 'completed'", [aliceToComplete.id]), 1)
})

await asUser(ids.lea, async () => {
  assert.equal(await count('select count(*) from public.coaching_clients where id = $1', [alice.id]), 0)
  assert.equal(await count('select count(*) from public.coaching_clients where id = $1', [bob.id]), 1)
  assert.equal((await db.query("update public.coaching_clients set objective = 'intrusion' where id = $1", [alice.id])).affectedRows, 0)
  assert.equal((await db.query("update public.coaching_actions set status = 'done', completed_at = now() where id = $1", [aliceActionId])).affectedRows, 0)
})

await asUser(ids.bob, async () => {
  assert.equal((await one('select public.coaching_credit_balance($1) as balance', [bob.id])).balance, 1)
  await expectRejected(() => db.query('select * from public.coaching_book_session($1, $2)', [bobSlot.id, 'Europe/Zurich']), 'preparation_required')
})

await db.query(`
  insert into public.coaching_form_responses(template_id, client_id, submitted_by, status, answers, submitted_at)
  values ($1, $2, $3, 'submitted', '{"subject":"test expiration"}'::jsonb, now())
`, [template.id, bob.id, ids.bob])
await db.query("update public.coaching_engagements set expires_at = now() - interval '1 minute' where id = $1", [bobOrder.engagement_id])
await asUser(ids.bob, async () => {
  assert.equal((await one('select public.coaching_credit_balance($1) as balance', [bob.id])).balance, 0)
  await expectRejected(() => db.query('select * from public.coaching_book_session($1, $2)', [bobSlot.id, 'Europe/Zurich']), 'engagement_missing')
  assert.equal((await db.query("update public.coaching_memberships set role = 'owner' where user_id = $1", [ids.bob])).affectedRows, 0)
})

let booked
await asUser(ids.alice, async () => {
  assert.equal((await one('select public.coaching_current_role() as role')).role, 'client')
  assert.equal(await count('select count(*) from public.coaching_clients where id = $1', [alice.id]), 1)
  assert.equal(await count('select count(*) from public.coaching_clients where id = $1', [bob.id]), 0)
  assert.equal(await count("select count(*) from public.coaching_availability_slots where status = 'available'"), 1)
  assert.equal(await count('select count(*) from public.coaching_session_notes'), 0)
  assert.equal((await one('select public.coaching_credit_balance($1) as balance', [alice.id])).balance, 3)
  await db.query("update public.coaching_form_responses set answers = '{\"focus\":\"nouveau\"}'::jsonb where id = $1", [aliceResponse.id])
  await expectRejected(() => db.query('select raw_payload from public.coaching_orders'), 'permission denied')

  booked = await one('select * from public.coaching_book_session($1, $2)', [aliceSlot.id, 'Europe/Zurich'])
  assert.equal(booked.credits_remaining, 2)
  assert.equal(await count('select count(*) from public.coaching_form_responses where id = $1 and session_id = $2', [aliceResponse.id, booked.session_id]), 1)
  assert.equal((await db.query("update public.coaching_form_responses set answers = '{\"focus\":\"interdit\"}'::jsonb where id = $1", [aliceResponse.id])).affectedRows, 0)
  await expectRejected(() => db.query('select * from public.coaching_book_session($1, $2)', [aliceSlot.id, 'Europe/Zurich']), 'slot_unavailable')

  const cancelled = await one('select * from public.coaching_cancel_session($1, $2)', [booked.session_id, 'Test'])
  assert.equal(cancelled.credits_remaining, 3)
  assert.equal(await count("select count(*) from public.coaching_availability_slots where id = $1 and status = 'available'", [aliceSlot.id]), 1)
  await expectRejected(() => db.query('select * from public.coaching_cancel_session($1, $2)', [booked.session_id, 'Test 2']), 'session_not_cancellable')
})

const manualFutureSession = await one(`
  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, status, source)
  values ($1, $2, $3, now() + interval '20 days', now() + interval '20 days 1 hour', 'confirmed', 'manual')
  returning id
`, [alice.id, romain.id, aliceOrder.engagement_id])
await asUser(ids.alice, async () => {
  const before = (await one('select public.coaching_credit_balance($1) as balance', [alice.id])).balance
  const cancelled = await one('select * from public.coaching_cancel_session($1, $2)', [manualFutureSession.id, 'Séance manuelle'])
  assert.equal(cancelled.credits_remaining, before)
  assert.equal(await count("select count(*) from public.coaching_credit_ledger where session_id = $1 and reason = 'cancellation'", [manualFutureSession.id]), 0)
})

const refundableSlot = await one(`
  insert into public.coaching_availability_slots(coach_id, starts_at, ends_at, status, source)
  values ($1, now() + interval '25 days', now() + interval '25 days 1 hour', 'booked', 'manual')
  returning id, starts_at, ends_at
`, [romain.id])
const refundableSession = await one(`
  insert into public.coaching_sessions(client_id, coach_id, engagement_id, starts_at, ends_at, status, source)
  values ($1, $2, $3, $4, $5, 'confirmed', 'portal')
  returning id
`, [alice.id, romain.id, aliceOrder.engagement_id, refundableSlot.starts_at, refundableSlot.ends_at])
await db.query(`
  insert into public.coaching_credit_ledger(client_id, engagement_id, session_id, quantity, reason)
  values ($1, $2, $3, -1, 'booking')
`, [alice.id, aliceOrder.engagement_id, refundableSession.id])

const repeatOrder = await asRole('service_role', () => one(`
  select * from public.coaching_record_spiffy_order(
    'spiffy-alice-001', 'alice@example.test', 'Alice', '', 'pack-3',
    59100, 0, 'EUR', 'FR', '{}'::jsonb
  )
`))
assert.equal(repeatOrder.already_processed, true)
assert.equal(repeatOrder.credits_added, 0)
assert.equal(await count("select count(*) from public.coaching_credit_ledger where client_id = $1 and reason = 'purchase'", [alice.id]), 1)

const refunded = await asRole('service_role', () => one("select * from public.coaching_refund_spiffy_order('spiffy-alice-001')"))
assert.equal(refunded.already_processed, false)
assert.equal(refunded.credits_removed, 3)
assert.equal(await count("select count(*) from public.coaching_sessions where id = $1 and status = 'cancelled' and cancellation_reason = 'Remboursement Spiffy'", [refundableSession.id]), 1)
assert.equal(await count("select count(*) from public.coaching_availability_slots where id = $1 and status = 'available'", [refundableSlot.id]), 1)
assert.equal(await count("select count(*) from public.coaching_credit_ledger where session_id = $1 and reason = 'cancellation'", [refundableSession.id]), 1)
assert.equal(Number((await one('select coalesce(sum(quantity), 0) as balance from public.coaching_credit_ledger where client_id = $1', [alice.id])).balance), 0)
const repeatRefund = await asRole('service_role', () => one("select * from public.coaching_refund_spiffy_order('spiffy-alice-001')"))
assert.equal(repeatRefund.already_processed, true)
assert.equal(repeatRefund.credits_removed, 0)
assert.equal(await count("select count(*) from public.coaching_credit_ledger where client_id = $1 and reason = 'refund'", [alice.id]), 1)

console.log(JSON.stringify({
  migration: 'ok',
  tables: Number(tables.rows[0].count),
  rls: Number(rls.rows[0].count),
  diagnostic_tables: diagnosticTables,
  diagnostic_rls: diagnosticRls,
  diagnostic_hold: 'ok',
  function_privileges: 'ok',
  authorization: 'ok',
  action_workflow: 'ok',
  booking: 'ok',
  cancellation: 'ok',
  expired_credits: 'ok',
  cancellation_credit_integrity: 'ok',
  refund_future_sessions: 'ok',
  role_escalation: 'blocked',
  session_completion: 'ok',
  preexisting_sso_purchase_link: 'ok',
  spiffy_idempotency: 'ok',
  refund_idempotency: 'ok'
}))
await db.close()
