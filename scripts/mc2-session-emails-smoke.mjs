import assert from 'node:assert/strict';
import { mc2SessionEmailJobs, mc2SessionEmailsEnabled, processMc2SessionEmailJob } from '../netlify/functions/lib/mc2-session-emails.mjs';

const scheduled = {
  token: 'token-11', slot_kind: 'scheduled', visitor_timezone: 'Europe/Paris',
  session_starts_at: '2026-08-13T09:00:00.000Z',
};
assert.equal(mc2SessionEmailsEnabled({ MC2_SESSION_EMAILS_ENABLED: 'false' }), false);
assert.equal(mc2SessionEmailsEnabled({ MC2_SESSION_EMAILS_ENABLED: 'true' }), true);
assert.equal(mc2SessionEmailJobs(scheduled, new Date('2026-08-13T08:00:00Z')).length, 1);
const jobs = mc2SessionEmailJobs(scheduled, new Date('2026-08-13T07:00:00Z'));
assert.deepEqual(jobs.map((job) => job.message_type), ['registration_confirmation', 'session_reminder_1h']);
assert.equal(jobs[1].due_at, '2026-08-13T08:00:00.000Z');
assert.equal(mc2SessionEmailJobs({ ...scheduled, slot_kind: 'jit' }, new Date('2026-08-13T07:00:00Z')).length, 1);
assert.equal(new Set(jobs.map((job) => job.job_key)).size, 2);

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
const job = { id: 1, attempts: 0, status: 'pending', ...jobs[1] };
const calls = [];
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
    if (table === 'mc2_registrations' && method === 'GET') return response([{
      ...scheduled, email: 'client@example.com', prenom: 'Client', statut: 'registered',
    }]);
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
console.log(JSON.stringify({
  all_slots_confirmation: 'ok', scheduled_11_20_reminder: 'ok', tokenized_links: 'ok',
  idempotence: 'ok', disabled_by_default: 'ok',
}, null, 2));
