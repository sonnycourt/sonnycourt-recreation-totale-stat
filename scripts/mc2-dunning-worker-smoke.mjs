import assert from 'node:assert/strict';
import { processMc2DunningJob } from '../netlify/functions/lib/mc2-payment-recovery.mjs';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const calls = [];
let paymentStatus = 'past_due';
const job = {
  id: 42,
  token: 'mc2-test-token',
  stripe_invoice_id: 'in_failed',
  message_type: 'payment_failed',
  dunning_stage: 2,
  due_at: '2026-08-12T12:00:00.000Z',
  status: 'pending',
  attempts: 0,
};

function response(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? {} : { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ host: parsed.host, path: parsed.pathname, method, body });
  if (parsed.host === 'supabase.test') {
    const table = parsed.pathname.split('/').at(-1);
    if (method === 'PATCH' && table === 'mc2_dunning_jobs') {
      if (body.status === 'processing') return response([{ ...job, ...body }]);
      return response([{ ...job, ...body }]);
    }
    if (method === 'GET' && table === 'mc2_registrations') {
      return response([{ token: job.token, email: 'client@example.com', prenom: 'Client', payment_status: paymentStatus }]);
    }
  }
  if (parsed.host === 'connect.mailerlite.com') {
    if (method === 'GET' && parsed.pathname.endsWith('/subscribers/client%40example.com')) {
      return response({ data: { id: 'ml_subscriber_1', status: 'active' } });
    }
    if (method === 'POST' && parsed.pathname.endsWith('/groups/ml_group_2')) return response(null, 204);
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};

const env = {
  MAILERLITE_API_KEY: 'ml-test-key',
  ML_MC2_FAIL_2: 'ml_group_2',
};
const sent = await processMc2DunningJob(job, {
  now: new Date('2026-08-12T12:00:00.000Z'),
  env,
});
assert.equal(sent.status, 'sent');
assert.equal(sent.groupId, 'ml_group_2');
assert(calls.some((call) => call.host === 'connect.mailerlite.com' && call.method === 'POST'));
assert(calls.some((call) => call.host === 'supabase.test' && call.method === 'PATCH' && call.body.status === 'sent'));

calls.length = 0;
paymentStatus = 'paid';
const skipped = await processMc2DunningJob({ ...job, id: 43 }, {
  now: new Date('2026-08-12T12:01:00.000Z'),
  env,
});
assert.equal(skipped.status, 'skipped');
assert.equal(skipped.reason, 'already_recovered');
assert.equal(calls.some((call) => call.host === 'connect.mailerlite.com'), false);

console.log(JSON.stringify({
  mailerlite_stage_assignment: 'ok',
  recovered_customer_not_emailed: 'ok',
}, null, 2));
