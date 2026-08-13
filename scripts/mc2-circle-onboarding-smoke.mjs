import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MC2_CIRCLE_TAG_NAME,
  processMc2CircleOnboardingJob,
  queueMc2CircleOnboarding,
} from '../netlify/functions/lib/mc2-circle-onboarding.mjs';

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
    requests.push({ url, method, body, headers: init.headers || {} });

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
  const result = await processMc2CircleOnboardingJob({ id: 10, attempts: 0 }, { env: circleEnv });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.memberCreated, true);
  assert.equal(result.tagAdded, true);
  const circleRequests = mock.requests.filter((request) => request.url.startsWith('https://circle.test'));
  assert.deepEqual(circleRequests.map((request) => request.method), ['GET', 'GET', 'POST', 'POST']);
  assert.equal(circleRequests.some((request) => ['DELETE', 'PUT', 'PATCH'].includes(request.method)), false);
  assert.equal(mock.supabasePatches.some((body) => body.status === 'succeeded'), true);
}

// Temporary provider error: no member mutation and a durable safe retry.
{
  const mock = installMock({ failTags: true });
  const result = await processMc2CircleOnboardingJob({ id: 10, attempts: 0 }, { env: circleEnv });
  assert.equal(result.status, 'retry');
  assert.equal(mock.supabasePatches.some((body) => body.status === 'retry' && body.next_attempt_at), true);
  assert.equal(
    mock.requests.filter((request) => request.url.startsWith('https://circle.test')).some((request) => request.method === 'POST'),
    false,
  );
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
  assert.equal(paidGuard >= 0 && circleQueue > paidGuard, true);
  assert.equal(router.slice(paidGuard, circleQueue).includes('mc2_purchase_update_'), true);
}

console.log(JSON.stringify({
  circle_existing_member: 'ok',
  circle_invite_and_tag: 'ok',
  circle_retry: 'ok',
  stripe_duplicate_idempotence: 'ok',
  destructive_guard: 'ok',
}, null, 2));
