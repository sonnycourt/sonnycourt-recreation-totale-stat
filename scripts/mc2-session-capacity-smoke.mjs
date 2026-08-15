import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const page = await fs.readFile(new URL('../src/pages/commencer.astro', import.meta.url), 'utf8');
const sql = await fs.readFile(new URL('../sql/mc2_session_capacity.sql', import.meta.url), 'utf8');

for (const marker of [
  'id="session-scarcity"',
  '/.netlify/functions/mc2-session-capacity',
  'await sessionCapacityRequest({ reserve: true });',
  'sessionCapacityBlocked',
]) {
  assert.ok(page.includes(marker), `checkout marker missing: ${marker}`);
}
assert.ok(page.indexOf('await sessionCapacityRequest({ reserve: true });') < page.indexOf('await recordContractAcceptance();'));

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.mc2_registrations (
    token text primary key,
    session_slot_id text not null,
    session_starts_at timestamptz not null,
    offer_expires_at timestamptz,
    statut text not null default 'registered',
    payment_status text
  );
`);
await db.exec(sql);
await db.exec(sql);
await db.exec(`
  insert into public.mc2_registrations(token, session_slot_id, session_starts_at, offer_expires_at)
  values
    ('token-a', 'jit', '2026-08-15 18:15:00+00', now() + interval '1 hour'),
    ('token-b', 'jit', '2026-08-15 18:15:00+00', now() + interval '1 hour'),
    ('token-c', 'jit', '2026-08-15 18:15:00+00', now() + interval '1 hour'),
    ('token-d', 'jit', '2026-08-15 18:15:00+00', now() + interval '1 hour'),
    ('token-other', 'jit', '2026-08-15 18:30:00+00', now() + interval '1 hour');
`);

const reserveA = await db.query(`select * from public.mc2_reserve_session_seat_v1('token-a', 3, 15)`);
const reserveB = await db.query(`select * from public.mc2_reserve_session_seat_v1('token-b', 3, 15)`);
const reserveC = await db.query(`select * from public.mc2_reserve_session_seat_v1('token-c', 3, 15)`);
const reserveD = await db.query(`select * from public.mc2_reserve_session_seat_v1('token-d', 3, 15)`);
assert.equal(reserveA.rows[0].accepted, true);
assert.equal(reserveB.rows[0].accepted, true);
assert.equal(reserveC.rows[0].accepted, true);
assert.equal(reserveD.rows[0].accepted, false);
assert.equal(reserveD.rows[0].reason, 'session_full');

const capacityA = await db.query(`select * from public.mc2_session_capacity_v1('token-a', 3)`);
assert.equal(capacityA.rows[0].remaining, 0);
assert.equal(capacityA.rows[0].reserved, true);

const otherSlot = await db.query(`select * from public.mc2_session_capacity_v1('token-other', 3)`);
assert.equal(otherSlot.rows[0].remaining, 3);

await db.exec(`
  update public.mc2_registrations set statut = 'purchased' where token = 'token-a';
  delete from public.mc2_session_seat_reservations where token = 'token-a';
`);
const capacityAfterPurchase = await db.query(`select * from public.mc2_session_capacity_v1('token-b', 3)`);
assert.equal(capacityAfterPurchase.rows[0].occupied, 3);
assert.equal(capacityAfterPurchase.rows[0].remaining, 0);

const originalFetch = globalThis.fetch;
const originalEnabled = process.env.MC2_SESSION_SCARCITY_ENABLED;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.MC2_SESSION_SCARCITY_ENABLED = 'true';
process.env.SUPABASE_URL = 'https://supabase.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
const { default: handler } = await import('../netlify/functions/mc2-session-capacity.js');

globalThis.fetch = async () => new Response(JSON.stringify([{
  session_starts_at: '2026-08-15T18:15:00Z', capacity: 3, occupied: 1, remaining: 2,
  reserved: false, reserved_until: null,
}]), { status: 200, headers: { 'Content-Type': 'application/json' } });
const getResponse = await handler(new Request('https://example.test/.netlify/functions/mc2-session-capacity?t=token-a'));
const getBody = await getResponse.json();
assert.equal(getResponse.status, 200);
assert.equal(getBody.remaining, 2);
assert.equal('session_starts_at' in getBody, false, 'internal session timestamp must stay private');

globalThis.fetch = async () => new Response(JSON.stringify([{
  accepted: false, session_starts_at: '2026-08-15T18:15:00Z', capacity: 3, occupied: 3,
  remaining: 0, reserved_until: null, reason: 'session_full',
}]), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fullResponse = await handler(new Request('https://example.test/.netlify/functions/mc2-session-capacity', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'token-c' }),
}));
assert.equal(fullResponse.status, 409);
assert.equal((await fullResponse.json()).reason, 'session_full');

globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PGRST202' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
});
const unavailableResponse = await handler(new Request('https://example.test/.netlify/functions/mc2-session-capacity?t=token-a'));
assert.deepEqual(await unavailableResponse.json(), {
  ok: true, enabled: false, reason: 'capacity_unavailable',
});

globalThis.fetch = originalFetch;
if (originalEnabled == null) delete process.env.MC2_SESSION_SCARCITY_ENABLED;
else process.env.MC2_SESSION_SCARCITY_ENABLED = originalEnabled;
if (originalSupabaseUrl == null) delete process.env.SUPABASE_URL;
else process.env.SUPABASE_URL = originalSupabaseUrl;
if (originalSupabaseKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
await db.close();

console.log('MC2 session capacity smoke: ok');
