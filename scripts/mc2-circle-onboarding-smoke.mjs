import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  attemptMc2CircleOnboardingImmediately,
  MC2_CIRCLE_TAG_NAME,
  processMc2CircleOnboardingJob,
  queueMc2CircleOnboarding,
} from '../netlify/functions/lib/mc2-circle-onboarding.mjs';
import { routeMc2StripeEvent } from '../netlify/functions/lib/mc2-pay-router.mjs';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-only';

const circleEnv = {
  MC2_CIRCLE_ENABLED: 'true',
  CIRCLE_ADMIN_API_TOKEN: 'circle-test-only',
  CIRCLE_COMMUNITY_HOST: 'volt.sonnycourt.com',
  CIRCLE_ADMIN_API_BASE: 'https://circle.test/api/admin/v2',
  MC2_CIRCLE_MEMBER_TAG_NAME: 'ES 2.0 (AVANCÉ)',
};

function jsonResponse(status, body) {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function claimedJob(overrides = {}) {
  return {
    id: 10,
    token: 'mc2-token',
    job_key: 'circle_mc2_advanced:mc2-token',
    email: 'buyer@example.com',
    member_name: 'Buyer',
    member_tag_name: MC2_CIRCLE_TAG_NAME,
    status: 'processing',
    attempts: 1,
    member_created: false,
    tag_added: false,
    ...overrides,
  };
}

function installMock({ member, searchStatus = 200, failTags = false } = {}) {
  const requests = [];
  const supabasePatches = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({
      url,
      method,
      body,
      headers: init.headers || {},
      hasSignal: Boolean(init.signal),
    });

    if (url.startsWith('https://supabase.test/rest/v1/')) {
      if (method === 'PATCH') {
        supabasePatches.push(body);
        if (url.includes('status=in.(pending,retry)')) {
          return jsonResponse(200, [claimedJob({ attempts: body.attempts })]);
        }
        return jsonResponse(200, [{ ...claimedJob(), ...body }]);
      }
      if (method === 'POST') return jsonResponse(201, []);
      return jsonResponse(200, []);
    }

    assert.equal(url.startsWith('https://circle.test/api/admin/v2/'), true);
    assert.equal(init.headers.Authorization, 'Bearer circle-test-only');
    assert.equal(Object.hasOwn(init.headers, 'host'), false);
    if (url.includes('/member_tags?')) {
      return failTags
        ? jsonResponse(500, { message: 'temporary outage' })
        : jsonResponse(200, { records: [{ id: 77, name: MC2_CIRCLE_TAG_NAME }] });
    }
    if (url.includes('/community_members/search?')) {
      if (searchStatus === 404) return jsonResponse(404, { message: 'Missing record' });
      return jsonResponse(200, member);
    }
    if (url.endsWith('/community_members') && method === 'POST') {
      assert.deepEqual(body, {
        email: 'buyer@example.com',
        name: 'Buyer',
        skip_invitation: false,
      });
      return jsonResponse(201, {
        community_member: { id: 501, email: 'buyer@example.com', member_tags: [] },
      });
    }
    if (url.endsWith('/tagged_members') && method === 'POST') {
      assert.deepEqual(body, { user_email: 'buyer@example.com', member_tag_id: 77 });
      return jsonResponse(201, { message: 'Person tagged successfully!' });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  return { requests, supabasePatches };
}

// Existing member + exact tag: read-only provider path, no invitation, no mutation.
{
  const mock = installMock({
    member: {
      id: 42,
      email: 'buyer@example.com',
      member_tags: [{ id: 77, name: MC2_CIRCLE_TAG_NAME }],
    },
  });
  const result = await processMc2CircleOnboardingJob({ id: 10, attempts: 0 }, { env: circleEnv });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.memberCreated, false);
  assert.equal(result.tagAdded, false);
  assert.deepEqual(
    mock.requests.filter((request) => request.url.startsWith('https://circle.test')).map((request) => request.method),
    ['GET', 'GET'],
  );
}

// Missing member: one invitation followed by one exact tag assignment.
{
  const mock = installMock({ searchStatus: 404 });
  const result = await attemptMc2CircleOnboardingImmediately(
    { id: 10, attempts: 0 },
    { env: circleEnv, timeoutMs: 1_000 },
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.memberCreated, true);
  assert.equal(result.tagAdded, true);
  const circleRequests = mock.requests.filter((request) => request.url.startsWith('https://circle.test'));
  assert.deepEqual(circleRequests.map((request) => request.method), ['GET', 'GET', 'POST', 'POST']);
  assert.equal(circleRequests.every((request) => request.hasSignal), true);
  assert.equal(circleRequests.some((request) => ['DELETE', 'PUT', 'PATCH'].includes(request.method)), false);
  assert.equal(mock.supabasePatches.some((body) => body.status === 'succeeded'), true);
}

// Temporary provider error: no member mutation and a durable safe retry.
{
  const mock = installMock({ failTags: true });
  const result = await attemptMc2CircleOnboardingImmediately(
    { id: 10, attempts: 0 },
    { env: circleEnv, timeoutMs: 1_000 },
  );
  assert.equal(result.status, 'retry');
  assert.equal(mock.supabasePatches.some((body) => body.status === 'retry' && body.next_attempt_at), true);
  assert.equal(
    mock.requests.filter((request) => request.url.startsWith('https://circle.test')).some((request) => request.method === 'POST'),
    false,
  );
}

// An unpaid Checkout event is marked once but never queues or calls Circle;
// the identical Stripe delivery is then ignored by the event idempotency key.
{
  let processed = false;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    requests.push({ url, method });
    assert.equal(url.startsWith('https://supabase.test/rest/v1/'), true);
    if (url.includes('/mc2_stripe_webhook_events?') && method === 'GET') {
      return jsonResponse(200, processed ? [{ event_id: 'evt_unpaid_duplicate' }] : []);
    }
    if (url.endsWith('/mc2_stripe_webhook_events') && method === 'POST') {
      processed = true;
      return jsonResponse(201, null);
    }
    throw new Error(`Unexpected unpaid request ${method} ${url}`);
  };
  const unpaidEvent = {
    id: 'evt_unpaid_duplicate',
    type: 'checkout.session.completed',
    livemode: true,
    data: {
      object: {
        id: 'cs_unpaid',
        mode: 'payment',
        payment_status: 'unpaid',
        metadata: { system: 'es2_mc2', mc2_token: 'mc2-token' },
      },
    },
  };
  const first = await routeMc2StripeEvent(unpaidEvent, { stripe: {} });
  const duplicate = await routeMc2StripeEvent(unpaidEvent, { stripe: {} });
  assert.equal(first.skipped, 'payment');
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(requests.some(({ url }) => url.includes('mc2_circle_onboarding_jobs')), false);
  assert.equal(requests.some(({ url }) => url.startsWith('https://circle.test')), false);
}

// Duplicate Stripe delivery: an existing job is returned, never inserted twice.
{
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), method: String(init.method || 'GET').toUpperCase() });
    return jsonResponse(200, [{ id: 22, job_key: 'circle_mc2_advanced:mc2-token', status: 'succeeded' }]);
  };
  const result = await queueMc2CircleOnboarding({
    token: 'mc2-token',
    email: 'buyer@example.com',
    name: 'Buyer',
    stripeEventId: 'evt_duplicate',
  });
  assert.equal(result.ok, true);
  assert.equal(result.existing, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
}

// Static destructive-action guard: the provider adapter must expose no removal path.
{
  const source = fs.readFileSync(new URL('../netlify/functions/lib/mc2-circle-onboarding.mjs', import.meta.url), 'utf8');
  assert.equal(/method\s*:\s*['"]DELETE['"]/i.test(source), false);
  assert.equal(/delete_member|untag|removeCircle/i.test(source), false);
  const sql = fs.readFileSync(new URL('../sql/mc2_circle_onboarding.sql', import.meta.url), 'utf8');
  assert.equal(/on\s+delete\s+cascade/i.test(sql), false);
  assert.equal(sql.includes("('pending', 'processing', 'retry', 'succeeded', 'failed')"), true);
  const router = fs.readFileSync(new URL('../netlify/functions/lib/mc2-pay-router.mjs', import.meta.url), 'utf8');
  const paidGuard = router.indexOf("session.payment_status !== 'paid'");
  const circleQueue = router.indexOf('queueMc2CircleOnboarding({');
  const circleImmediate = router.indexOf('attemptMc2CircleOnboardingImmediately(circleQueued.row)');
  assert.equal(paidGuard >= 0 && circleQueue > paidGuard, true);
  assert.equal(router.slice(paidGuard, circleQueue).includes('mc2_purchase_update_'), true);
  assert.equal(circleImmediate > circleQueue, true);
}

console.log(JSON.stringify({
  circle_existing_member: 'ok',
  circle_immediate_invite_and_tag: 'ok',
  circle_immediate_retry_fallback: 'ok',
  stripe_duplicate_job_idempotence: 'ok',
  stripe_duplicate_event_idempotence: 'ok',
  stripe_non_paid_guard: 'ok',
  destructive_guard: 'ok',
}, null, 2));
