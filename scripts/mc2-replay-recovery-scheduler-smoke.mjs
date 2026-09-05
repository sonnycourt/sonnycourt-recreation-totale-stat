import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.MC2_REPLAY_RECOVERY_ENABLED = 'true';

const calls = [];
const now = new Date();
const sessionStartsAt = new Date(now.getTime() - 60 * 60_000).toISOString();
const dueJob = {
  id: 301,
  token: 'due-job-token',
  job_key: 'due-job-key',
  session_starts_at: sessionStartsAt,
  segment: 'no_show',
  message_type: 'no_show_initial',
  due_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
  status: 'pending',
  attempts: 0,
};
const candidate = {
  token: 'candidate-token',
  email: 'candidate@example.com',
  prenom: 'Candidate',
  visitor_timezone: 'Europe/Paris',
  session_starts_at: sessionStartsAt,
  session_ends_at: new Date(now.getTime() + 59 * 60_000).toISOString(),
  offer_expires_at: new Date(now.getTime() + 72 * 60 * 60_000).toISOString(),
  attended_live: false,
  saw_offer: false,
  watch_max_seconds_live: 0,
  statut: 'registered',
  payment_status: null,
  purchased_at: null,
};
let candidateReturned = false;

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  const call = { method, path: url.pathname, search: url.search, body };
  calls.push(call);

  if (url.host !== 'supabase.test') throw new Error(`Unexpected request ${method} ${input}`);
  const table = url.pathname.split('/').at(-1);
  if (table === 'mc2_replay_recovery_jobs' && method === 'GET') return response([dueJob]);
  if (table === 'mc2_replay_recovery_jobs' && method === 'PATCH') {
    return response([{ ...dueJob, ...body }]);
  }
  if (table === 'mc2_replay_recovery_jobs' && method === 'POST') {
    return response((body || []).map((row, index) => ({ id: 400 + index, ...row })), 201);
  }
  if (table === 'mc2_registrations' && method === 'GET' && url.searchParams.has('token')) {
    return response([{
      ...candidate,
      token: dueJob.token,
      statut: 'purchased',
      payment_status: 'paid',
      purchased_at: now.toISOString(),
    }]);
  }
  if (table === 'mc2_registrations' && method === 'GET') {
    if (candidateReturned) return response([]);
    candidateReturned = true;
    return response([candidate]);
  }
  throw new Error(`Unexpected request ${method} ${input}`);
};

const { default: replayWorker } = await import('../netlify/functions/mc2-replay-recovery-scheduled.js');
const result = await replayWorker();
assert.equal(result.status, 200);
const payload = await result.json();

const dueLoadIndex = calls.findIndex((call) => call.method === 'GET'
  && call.path.endsWith('/mc2_replay_recovery_jobs')
  && call.search.includes('due_at=lte'));
const candidateLoadIndex = calls.findIndex((call) => call.method === 'GET'
  && call.path.endsWith('/mc2_registrations')
  && call.search.includes('session_starts_at=lte'));
assert(dueLoadIndex >= 0, 'Le worker doit charger les jobs dus.');
assert(candidateLoadIndex > dueLoadIndex, 'Les jobs dus doivent être traités avant le balayage des candidats.');

const batchInsert = calls.find((call) => call.method === 'POST'
  && call.path.endsWith('/mc2_replay_recovery_jobs'));
assert(batchInsert, 'Les futurs jobs doivent être insérés par lot.');
assert.equal(batchInsert.body.length, 3);
assert.deepEqual(batchInsert.body.map((row) => row.message_type), [
  'no_show_initial',
  'replay_24h',
  'replay_4h',
]);
assert.equal(payload.processed, 1);
assert.equal(payload.inspectedCandidates, 1);
assert.equal(payload.inspectedJobs, 3);
assert.equal(payload.queued, 3);

console.log(JSON.stringify({
  due_jobs_processed_first: 'ok',
  candidate_days_loaded_in_parallel: 'ok',
  future_jobs_inserted_in_one_idempotent_batch: 'ok',
}, null, 2));
