import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/circle-lesson-progress.js';
import { parseCircleEvent } from '../netlify/functions/lib/circle-lesson-events.mjs';
const secret = 'test-only-secret-not-for-production-0000000000';
const env = { CIRCLE_LESSON_WEBHOOK_SECRET: secret, CIRCLE_LESSON_COMMUNITY_ID: '214213',
  CIRCLE_LESSON_ALLOWED_SPACE_IDS: '2758877', CIRCLE_LESSON_TRACKING_ENABLED: 'true',
  SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test' };
const payload = { body: { type: 'courses_lesson_completed', data: {
  community_id: 214213, community_member_id: 99, space_id: 2758877, lesson_id: 4232151,
} } };
const request = (p = payload, query = { key: secret }) => ({ httpMethod: 'POST', body: JSON.stringify(p), queryStringParameters: query });
const run = (override = {}, fetchImpl = async () => ({ ok: true })) => createHandler({ env: { ...env, ...override }, fetchImpl });
const noNetwork = async () => { throw new Error('Unexpected network'); };

test('stores an identified completion, no writes to existing tables', async () => {
  let saved;
  const handler = run({}, async (url, options) => {
    assert.equal(url, 'https://example.invalid/rest/v1/circle_lesson_events');
    assert.equal(options.method, 'POST'); saved = JSON.parse(options.body);
    return { ok: true };
  });
  assert.equal((await handler(request())).statusCode, 200);
  assert.equal(saved.lesson_id, 4232151);
  assert.equal(saved.community_member_id, 99);
  assert.equal(saved.provider_occurred_at, null);
  assert.equal(saved.resolution_status, 'identified');
  assert.equal(saved.payload_sha256.length, 64);
  assert.equal(saved.received_at, undefined); // database timestamp, not browser clock
});
test('unknown lesson is retained explicitly, never inferred from course', async () => {
  const copy = structuredClone(payload); delete copy.body.data.lesson_id;
  const result = parseCircleEvent(copy, { communityId: 214213, spaceIds: [2758877] });
  assert.equal(result.row.lesson_id, null); assert.equal(result.row.resolution_status, 'needs_lesson_id');
});
test('rejects missing/wrong secrets and malformed bodies without network', async () => {
  assert.equal((await run({}, noNetwork)(request(payload, {}))).statusCode, 401);
  assert.equal((await run({}, noNetwork)(request(payload, { key: 'wrong' }))).statusCode, 401);
  assert.equal((await run({ CIRCLE_LESSON_WEBHOOK_SECRET: '' }, noNetwork)(request())).statusCode, 503);
  assert.equal((await run({}, noNetwork)({ ...request(), body: '{' })).statusCode, 400);
  assert.equal((await run({}, noNetwork)({ ...request(), body: 'x'.repeat(140000) })).statusCode, 413);
  assert.equal((await run({}, noNetwork)({ ...request(), httpMethod: 'GET' })).statusCode, 405);
});
test('scope filter and feature flag fail closed', async () => {
  assert.equal((await run({ CIRCLE_LESSON_TRACKING_ENABLED: 'false' }, noNetwork)(request())).statusCode, 503);
  assert.equal((await run({ CIRCLE_LESSON_ALLOWED_SPACE_IDS: 'invalid' }, noNetwork)(request())).statusCode, 503);
  const copy = structuredClone(payload); copy.body.data.space_id = 999;
  assert.deepEqual(JSON.parse((await run({}, noNetwork)(request(copy))).body), { ignored: 'outside_scope' });
});
test('probe returns only field names and does not write', async () => {
  const result = await run({}, noNetwork)(request(payload, { key: secret, probe: '1' }));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).probe, true);
  assert.ok(!result.body.includes('4232151'));
});
test('storage failure is not acknowledged as success', async () => {
  assert.equal((await run({}, async () => ({ ok: false, status: 500, json: async () => ({}) }))(request())).statusCode, 503);
  assert.equal((await run({}, async () => { throw new Error('offline'); })(request())).statusCode, 503);
});
test('deduplicates only a provider event ID unique conflict', async () => {
  const conflict = async () => ({ ok: false, status: 409, json: async () => ({ code: '23505', message: 'circle_lesson_provider_event_unique' }) });
  const copy = structuredClone(payload); copy.body.id = 'event-1';
  assert.equal(JSON.parse((await run({}, conflict)(request(copy))).body).duplicate, true);
  assert.equal((await run({}, conflict)(request())).statusCode, 503);
});
test('provider timestamps are explicit and future dates rejected', () => {
  const copy = structuredClone(payload); copy.body.data.completed_at = '2026-10-15T12:00:00Z';
  const options = { communityId: 214213, spaceIds: [2758877], now: new Date('2026-10-15T12:01:00Z') };
  assert.equal(parseCircleEvent(copy, options).row.provider_occurred_at, '2026-10-15T12:00:00.000Z');
  copy.body.data.completed_at = '2036-01-01T00:00:00Z'; assert.throws(() => parseCircleEvent(copy, options));
});
