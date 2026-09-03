import assert from 'node:assert/strict';
import { processMc2ReplayRecoveryJob } from '../netlify/functions/lib/mc2-replay-recovery.mjs';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const now = new Date('2026-08-13T16:00:00.000Z');
const job = {
  id: 91,
  token: 'mc2-replay-test',
  job_key: 'test',
  segment: 'no_show',
  session_starts_at: '2026-08-12T18:00:00.000Z',
  status: 'pending',
  attempts: 0,
  due_at: now.toISOString(),
  resume_seconds: 0,
};
let purchased = false;
let subscriberExists = true;
let registrationOverrides = {};
const calls = [];

function response(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? {} : { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ host: url.host, path: url.pathname, method, body });
  if (url.host === 'supabase.test') {
    const table = url.pathname.split('/').at(-1);
    if (table === 'mc2_replay_recovery_jobs' && method === 'PATCH') return response([{ ...job, ...body }]);
    if (table === 'mc2_registrations' && method === 'GET') return response([{
      token: job.token,
      email: 'client@example.com',
      prenom: 'Client',
      session_starts_at: job.session_starts_at,
      session_ends_at: '2026-08-12T19:15:00.000Z',
      attended_live: false,
      saw_offer: false,
      watch_max_seconds_live: 0,
      statut: purchased ? 'purchased' : 'registered',
      payment_status: purchased ? 'paid' : null,
      purchased_at: purchased ? now.toISOString() : null,
      ...registrationOverrides,
    }]);
  }
  if (url.host === 'connect.mailerlite.com') {
    if (method === 'GET') return subscriberExists
      ? response({ data: { id: 'subscriber-1', status: 'active' } })
      : response({}, 404);
    if (method === 'PUT') return response({ data: { id: 'subscriber-1' } });
    if (method === 'DELETE') return response(null, 204);
    if (method === 'POST' && url.pathname === '/api/subscribers') {
      subscriberExists = true;
      return response({ data: { id: 'subscriber-1' } });
    }
    if (method === 'POST') return response(null, 204);
  }
  throw new Error(`Unexpected ${method} ${input}`);
};

const env = {
  MAILERLITE_API_KEY: 'ml-test',
  MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW: 'group-no-show',
  MAILERLITE_GROUP_MC2_REPLAY_24H: 'group-replay-24h',
  MC2_PUBLIC_BASE_URL: 'https://sonnycourt.com',
  MC2_REPLAY_ACCESS_HOURS: '48',
};
const delivered = await processMc2ReplayRecoveryJob(job, now, env);
assert.equal(delivered.status, 'delivered');
const accessPatch = calls.find((call) => call.host === 'supabase.test' && call.body?.access_expires_at);
assert(accessPatch);
assert.equal(accessPatch.body.access_expires_at, '2026-08-15T18:00:00.000Z');
assert(calls.some((call) => call.host === 'connect.mailerlite.com' && call.method === 'POST'));

calls.length = 0;
const retryDelivery = await processMc2ReplayRecoveryJob({ ...job, id: 95, attempts: 1 }, now, env);
assert.equal(retryDelivery.status, 'delivered');
assert.equal(
  calls.some((call) => call.host === 'connect.mailerlite.com' && call.method === 'DELETE'),
  false,
);

calls.length = 0;
subscriberExists = false;
const deliveredForNewSubscriber = await processMc2ReplayRecoveryJob({ ...job, id: 94 }, now, env);
assert.equal(deliveredForNewSubscriber.status, 'delivered');

calls.length = 0;
purchased = true;
const cancelled = await processMc2ReplayRecoveryJob({ ...job, id: 92 }, now, env);
assert.equal(cancelled.status, 'cancelled');
assert.equal(calls.some((call) => call.host === 'connect.mailerlite.com'), false);

calls.length = 0;
purchased = false;
const rescheduled = await processMc2ReplayRecoveryJob({
  ...job,
  id: 93,
  session_starts_at: '2026-08-11T18:00:00.000Z',
}, now, env);
assert.equal(rescheduled.status, 'skipped');
assert.equal(rescheduled.reason, 'session_rescheduled');

calls.length = 0;
registrationOverrides = {
  attended_live: true,
  watch_max_seconds_live: 1_200,
  last_presence_at: '2026-08-13T15:30:00.000Z',
};
const postponed = await processMc2ReplayRecoveryJob({
  ...job,
  id: 96,
  segment: 'left_before_cta',
}, now, env);
assert.equal(postponed.status, 'rescheduled');
assert.equal(postponed.reason, 'viewer_still_active');
assert.equal(postponed.dueAt, '2026-08-13T17:00:00.000Z');
assert(calls.some((call) => call.host === 'supabase.test'
  && call.body?.status === 'pending'
  && call.body?.due_at === '2026-08-13T17:00:00.000Z'));
assert.equal(calls.some((call) => call.host === 'connect.mailerlite.com'), false);

calls.length = 0;
registrationOverrides = {
  attended_live: true,
  saw_offer: false,
  watch_max_seconds_live: 2_700,
  last_presence_at: '2026-08-13T12:00:00.000Z',
  offer_expires_at: null,
};
const replayReminderNow = new Date('2026-08-14T18:00:00.000Z');
const replayReminder = await processMc2ReplayRecoveryJob({
  ...job,
  id: 97,
  segment: 'no_show',
  message_type: 'replay_24h',
}, replayReminderNow, env);
assert.equal(replayReminder.status, 'delivered');
const reminderAccess = calls.find((call) => call.host === 'supabase.test' && call.body?.access_expires_at);
assert.equal(reminderAccess.body.resume_seconds, 1_500);
const reminderFields = calls.find((call) => call.host === 'connect.mailerlite.com' && call.method === 'PUT')?.body?.fields;
assert.equal(reminderFields.mc2_recovery_segment, 'left_before_cta');

calls.length = 0;
registrationOverrides = {
  ...registrationOverrides,
  saw_offer: true,
};
const switchedToOffer = await processMc2ReplayRecoveryJob({
  ...job,
  id: 98,
  segment: 'no_show',
  message_type: 'replay_24h',
}, now, env);
assert.match(switchedToOffer.reason, /^segment_changed:/);
assert.equal(calls.some((call) => call.host === 'connect.mailerlite.com'), false);

console.log(JSON.stringify({
  mailerlite_delivery: 'ok',
  buyer_suppression: 'ok',
  reschedule_suppression: 'ok',
  active_viewer_postponement: 'ok',
  access_expiry_matches_global_replay: 'ok',
  replay_resume_resegmented_at_send_time: 'ok',
  replay_sequence_stops_after_offer_seen: 'ok',
}, null, 2));
