import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const replaySource = fs.readFileSync(path.join(root, 'src/pages/mc2/replay.astro'), 'utf8');

assert.match(replaySource, /Reprendre à \$\{formatResumeTime\(recoveryResumeSeconds\)\}/);
assert.match(replaySource, /Recommencer depuis le début/);
assert.match(replaySource, /const MIN_USEFUL_RESUME_SECONDS = 60/);
assert.match(replaySource, /launchReplayAfterConfirm\(recoveryResumeSeconds\)/);
assert.match(replaySource, /launchReplayAfterConfirm\(0\)/);
assert.match(replaySource, /replayConfirmOverlay\?\.classList\.remove\('hidden'\)/);
assert.doesNotMatch(
  replaySource,
  /watch_max_seconds_replay\s*[:=]\s*0/,
  'Recommencer ne doit jamais effacer la progression serveur.',
);

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const accessCode = 'resume-choice-access-code-1234567890';
let registration = {
  token: 'resume-choice-registration-token',
  email: 'resume@example.com',
  prenom: 'Camille',
  pays: 'France',
  session_starts_at: '2026-09-02T18:00:00.000Z',
  session_ends_at: '2026-09-02T19:39:00.000Z',
  offer_expires_at: null,
  attended_live: true,
  saw_offer: false,
  watch_max_seconds_live: 2_700,
  watch_max_seconds_replay: 2_537,
  statut: 'registered',
  payment_status: null,
  purchased_at: null,
};
const job = {
  id: 42,
  token: registration.token,
  segment: 'left_before_cta',
  status: 'delivered',
  access_code: accessCode,
  access_starts_at: '2026-09-02T20:00:00.000Z',
  access_expires_at: '2026-09-05T21:00:00.000Z',
  resume_seconds: 1_500,
};

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const table = url.pathname.split('/').at(-1);
  if (table === 'mc2_replay_recovery_jobs') return Response.json([job]);
  if (table === 'mc2_registrations') return Response.json([registration]);
  throw new Error(`Unexpected request ${input}`);
};

const { default: replayAccess } = await import('../netlify/functions/mc2-replay-access.js');
const requestUrl = `https://sonnycourt.com/.netlify/functions/mc2-replay-access?access=${accessCode}`;
const latestResponse = await replayAccess(new Request(requestUrl));
assert.equal(latestResponse.status, 200);
assert.equal((await latestResponse.json()).resumeSeconds, 2_537);

registration = {
  ...registration,
  attended_live: false,
  watch_max_seconds_live: 0,
  watch_max_seconds_replay: 0,
};
job.segment = 'no_show';
job.resume_seconds = 0;
const noShowResponse = await replayAccess(new Request(requestUrl));
assert.equal(noShowResponse.status, 200);
assert.equal((await noShowResponse.json()).resumeSeconds, 0);

console.log(JSON.stringify({
  latest_replay_progress_used: 'ok',
  legacy_access_tokens_supported: 'ok',
  no_show_starts_normally: 'ok',
  explicit_restart_keeps_server_memory: 'ok',
}, null, 2));
