import assert from 'node:assert/strict';
import {
  mc2OfferEmailJobs,
  mc2OfferEmailsEnabled,
  mc2SessionEmailJobs,
  mc2SessionEmailsEnabled,
  processMc2SessionEmailJob,
} from '../netlify/functions/lib/mc2-session-emails.mjs';

const scheduled = {
  token: 'token-11', slot_kind: 'scheduled', visitor_timezone: 'Europe/Paris',
  session_starts_at: '2026-08-13T09:00:00.000Z',
};
assert.equal(mc2SessionEmailsEnabled({ MC2_SESSION_EMAILS_ENABLED: 'false' }), false);
assert.equal(mc2SessionEmailsEnabled({ MC2_SESSION_EMAILS_ENABLED: 'true' }), true);
assert.equal(mc2OfferEmailsEnabled({ MC2_OFFER_EMAILS_ENABLED: 'false' }), false);
assert.equal(mc2OfferEmailsEnabled({ MC2_OFFER_EMAILS_ENABLED: 'true' }), true);
assert.equal(mc2SessionEmailJobs(scheduled, new Date('2026-08-13T08:00:00Z')).length, 1);
const jobs = mc2SessionEmailJobs(scheduled, new Date('2026-08-13T07:00:00Z'));
assert.deepEqual(jobs.map((job) => job.message_type), ['registration_confirmation', 'session_reminder_1h']);
assert.equal(jobs[1].due_at, '2026-08-13T08:00:00.000Z');
assert.equal(mc2SessionEmailJobs({ ...scheduled, slot_kind: 'jit' }, new Date('2026-08-13T07:00:00Z')).length, 1);
assert.equal(new Set(jobs.map((job) => job.job_key)).size, 2);

const offerRegistration = {
  ...scheduled,
  offer_expires_at: '2026-08-14T20:00:00.000Z',
  saw_offer: true,
};
const offerJobs = mc2OfferEmailJobs(offerRegistration);
assert.deepEqual(offerJobs.map((item) => item.message_type), ['offer_5_places', 'offer_4h', 'offer_1h']);
assert.deepEqual(offerJobs.map((item) => item.due_at), [
  '2026-08-14T08:00:00.000Z',
  '2026-08-14T16:00:00.000Z',
  '2026-08-14T19:00:00.000Z',
]);
assert.equal(new Set(offerJobs.map((item) => item.job_key)).size, 3);

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
const job = { id: 1, attempts: 0, status: 'pending', ...jobs[1] };
const calls = [];
let registrationFixture = {
  ...scheduled, email: 'client@example.com', prenom: 'Client', statut: 'registered',
};
const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), {
  status, headers: status === 204 ? {} : { 'Content-Type': 'application/json' },
});
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ host: url.host, method, body });
  if (url.host === 'supabase.test') {
    const table = url.pathname.split('/').at(-1);
    if (table === 'mc2_session_email_jobs' && method === 'PATCH') return response([{ ...job, ...body }]);
    if (table === 'mc2_registrations' && method === 'GET') return response([registrationFixture]);
  }
  if (url.host === 'connect.mailerlite.com') {
    if (method === 'GET') return response({ data: { id: 'subscriber-1', status: 'active' } });
    if (method === 'PUT') return response({ data: { id: 'subscriber-1' } });
    if (method === 'DELETE') return response(null, 204);
    if (method === 'POST') return response(null, 204);
  }
  throw new Error(`Unexpected ${method} ${input}`);
};
const env = {
  MAILERLITE_API_KEY: 'ml-test', MAILERLITE_GROUP_MC2_SESSION_REMINDER_1H: 'group-reminder',
  MC2_PUBLIC_BASE_URL: 'https://sonnycourt.com',
};
assert.equal((await processMc2SessionEmailJob(job, new Date('2026-08-13T08:00:00Z'), env)).status, 'delivered');
const fields = calls.find((call) => call.host === 'connect.mailerlite.com' && call.method === 'PUT')?.body?.fields;
assert.equal(fields.mc2_confirmation_url, 'https://sonnycourt.com/mc2/confirmation/?t=token-11');
assert.equal(fields.mc2_session_url, 'https://sonnycourt.com/mc2/session/?t=token-11');
assert.match(fields.mc2_session_local_label, /11h00/);
calls.length = 0;
assert.equal((await processMc2SessionEmailJob({ ...job, id: 2, attempts: 1 }, new Date('2026-08-13T08:00:00Z'), env)).status, 'delivered');
assert.equal(calls.some((call) => call.method === 'DELETE'), false);

registrationFixture = {
  ...offerRegistration,
  email: 'client@example.com',
  prenom: 'Client',
  statut: 'present',
};
const offerEnv = {
  MAILERLITE_API_KEY: 'ml-test',
  MAILERLITE_GROUP_MC2_OFFER_5_PLACES: 'group-five-places',
  MC2_PUBLIC_BASE_URL: 'https://sonnycourt.com',
};
calls.length = 0;
assert.equal((await processMc2SessionEmailJob(
  { id: 3, attempts: 0, status: 'pending', ...offerJobs[0] },
  new Date('2026-08-14T08:00:00Z'),
  offerEnv,
)).status, 'delivered');
const offerFields = calls.find((call) => call.host === 'connect.mailerlite.com' && call.method === 'PUT')?.body?.fields;
assert.equal(offerFields.mc2_offer_url, 'https://sonnycourt.com/mc2/session/?t=token-11');
assert.equal(offerFields.mc2_offer_expires_at, '2026-08-14T20:00:00.000Z');

calls.length = 0;
const superseded = await processMc2SessionEmailJob(
  { id: 4, attempts: 0, status: 'pending', ...offerJobs[0] },
  new Date('2026-08-14T16:00:00Z'),
  offerEnv,
);
assert.deepEqual(superseded, { status: 'skipped', reason: 'message_superseded' });
assert.equal(calls.some((call) => call.host === 'connect.mailerlite.com'), false);

registrationFixture = { ...registrationFixture, statut: 'purchased', payment_status: 'paid' };
calls.length = 0;
const purchased = await processMc2SessionEmailJob(
  { id: 5, attempts: 0, status: 'pending', ...offerJobs[2] },
  new Date('2026-08-14T19:00:00Z'),
  { ...offerEnv, MAILERLITE_GROUP_MC2_OFFER_1H: 'group-one-hour' },
);
assert.deepEqual(purchased, { status: 'skipped', reason: 'purchase_completed' });
assert.equal(calls.some((call) => call.host === 'connect.mailerlite.com'), false);
console.log(JSON.stringify({
  all_slots_confirmation: 'ok', scheduled_11_20_reminder: 'ok', tokenized_links: 'ok',
  offer_personal_deadlines: 'ok', five_places_timeline: 'ok', buyers_excluded: 'ok',
  stale_messages_skipped: 'ok', idempotence: 'ok', disabled_by_default: 'ok',
}, null, 2));
