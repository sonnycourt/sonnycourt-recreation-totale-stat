import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { deliverTrackingMeta } from '../netlify/functions/lib/mc2-tracking-meta-worker.mjs';

// The exact SQL runs locally, never against Supabase production.
const db = new PGlite();
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE mc2_registrations(token text primary key, traffic_source text); INSERT INTO mc2_registrations VALUES ('fixture-registration-1234','meta_ad'), ('fixture-test-123456789',NULL);");
const read = name => fs.readFileSync(new URL('../sql/' + name, import.meta.url), 'utf8');
await db.exec(read('mc2_tracking_v2.sql')); await db.exec(read('mc2_tracking_v2_meta_delivery.sql'));
await db.exec(read('mc2_tracking_v2.sql')); await db.exec(read('mc2_tracking_v2_meta_delivery.sql'));
await db.exec("INSERT INTO mc2_tracking_test_registrations(token,reason) VALUES ('fixture-test-123456789','local fixture');");
const event = { event_id: 'ac8d6388-b119-4a3f-ab2f-f1d5b5beb900', token: 'fixture-registration-1234', event_name: 'offer_visible', client_occurred_at: new Date().toISOString(), visit_id: 'bc8d6388-b119-4a3f-ab2f-f1d5b5beb901', route: '/mc2/session/', webinar_version: 'w13b-live', offer_version: 'es2-j7-2026-09', metadata: {} };
const ingest = items => db.query('select mc2_tracking_ingest_v2($1::jsonb,$2::jsonb)', [JSON.stringify(items), '{}']);
await ingest([event]); await ingest([event]);
await ingest([{ ...event, event_id: 'cc8d6388-b119-4a3f-ab2f-f1d5b5beb902', token: 'fixture-test-123456789' }]);
assert.equal((await db.query('select count(*)::int count from mc2_tracking_meta_outbox')).rows[0].count, 1);
await assert.rejects(ingest([{ ...event, event_id: 'dc8d6388-b119-4a3f-ab2f-f1d5b5beb903' }, { ...event, token: 'fixture-test-123456789' }]));
assert.equal((await db.query('select count(*)::int count from mc2_tracking_events_v2')).rows[0].count, 2, 'Conflict rolls back the whole batch');
assert.equal((await db.query("select has_function_privilege('anon','mc2_tracking_ingest_v2(jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed, false);
await db.close();

// Entire HTTP and Meta delivery path mocked. No real advertising events.
const original = globalThis.fetch;
process.env.CONTEXT = 'production'; process.env.SUPABASE_URL = 'https://database.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.META_ACCESS_TOKEN = 'fixture'; process.env.META_PIXEL_ID = 'fixture';
let row, sends = [], isTest = false, acknowledgement = true, failSavedAck = false;
const reset = () => { row = { delivery_key: 'fixture-delivery', token: event.token, event_name: 'OfferViewed', event_id: 'opaque-id', event_time: new Date().toISOString(), context: { route: '/mc2/session/' }, status: 'pending', attempts: 0 }; };
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url); assert.equal(u.hostname, 'database.invalid');
  if (u.pathname.endsWith('mc2_registrations')) return Response.json([{ token: event.token, traffic_source: 'meta_ad', email: 'fixture@example.invalid' }]);
  if (u.pathname.endsWith('mc2_tracking_test_registrations')) return Response.json(isTest ? [{ token: event.token }] : []);
  assert.ok(u.pathname.endsWith('mc2_tracking_meta_outbox'));
  if (options.method !== 'PATCH') return Response.json(['pending', 'retry', 'processing'].includes(row.status) ? [{ ...row }] : []);
  if ('eq.' + row.status !== u.searchParams.get('status') || 'eq.' + row.attempts !== u.searchParams.get('attempts')) return Response.json([]);
  const patch = JSON.parse(options.body);
  if (failSavedAck && patch.status === 'sent') return Response.json({}, { status: 503 });
  Object.assign(row, patch); return Response.json([{ ...row }]);
};
const send = async payload => { sends.push(payload); return acknowledgement ? { ok: true, response: { events_received: 1 } } : { ok: false }; };
try {
  reset(); await Promise.all([deliverTrackingMeta({ send }), deliverTrackingMeta({ send })]);
  assert.equal(sends.length, 1, 'Concurrent workers claim once'); assert.equal(row.status, 'sent');
  assert.equal(sends[0].url, 'https://sonnycourt.com/mc2/session/'); assert.equal(sends[0].url.includes(event.token), false);
  reset(); acknowledgement = false; await deliverTrackingMeta({ send }); assert.equal(row.status, 'retry');
  acknowledgement = true; await deliverTrackingMeta({ send }); assert.equal(row.status, 'sent');
  assert.equal(sends.at(-1).eventId, sends.at(-2).eventId, 'Retries share deduplication ID');
  reset(); failSavedAck = true; await deliverTrackingMeta({ send }); assert.equal(row.status, 'processing');
  failSavedAck = false; await deliverTrackingMeta({ send, now: Date.now() + 360000 }); assert.equal(row.status, 'sent');
  reset(); isTest = true; const before = sends.length; await deliverTrackingMeta({ send }); assert.equal(sends.length, before); assert.equal(row.status, 'skipped');
  reset(); isTest = false; process.env.CONTEXT = 'deploy-preview'; await deliverTrackingMeta({ send }); assert.equal(row.status, 'pending');
} finally { globalThis.fetch = original; }
console.log('PASS Meta v2: SQL rerunnable, atomic rollback, deduplication, test exclusion, RLS grants, concurrent claims, lost ACK recovery, safe URL, preview isolation. No external calls.');
