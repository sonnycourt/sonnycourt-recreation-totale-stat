import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sessionSource = fs.readFileSync(path.join(root, 'src/pages/mc2/session.astro'), 'utf8');
const replaySource = fs.readFileSync(path.join(root, 'src/pages/mc2/replay.astro'), 'utf8');

assert.match(sessionSource, /reg\.sawOffer === true && Number\.isFinite\(expiryMs\)/);
assert.match(sessionSource, /keepOfferVisible: true/);
assert.match(sessionSource, /const OFFER_INITIAL_REMAINING_SEATS = 37;/);
assert.match(sessionSource, /timeline: createMc2OfferTimeline\(scarcityWindowEndMs - scarcityWindowStartMs\)/);
assert.match(sessionSource, /const seats = Math\.max\(0, OFFER_INITIAL_REMAINING_SEATS - placesConsumed\)/);
assert.match(sessionSource, /mc2-replay-enter\?t=/);
assert.doesNotMatch(sessionSource, /window\.location\.replace\('\/mc2\/replay\?t=/);
assert.match(replaySource, /\.offer-zone\.visible\s*\{[\s\S]*?transform:\s*none;/);
assert.match(replaySource, /animation:\s*offerZoneFadeIn\s+0\.4s\s+ease\s+forwards;/);
assert.doesNotMatch(
  replaySource,
  /\.offer-zone\.visible\s*\{[\s\S]*?animation:\s*ctaFadeIn/,
  'Le bloc offre du replay ne doit jamais créer un contenant transformé autour du CTA fixed.',
);

const token = '15f15f15-15f1-45f1-85f1-15f15f15f15f';
const now = Date.now();
let registration = {
  token,
  email: 'replay-test@sonnycourt.com',
  prenom: 'Replay',
  session_starts_at: new Date(now - 3 * 60 * 60_000).toISOString(),
  session_ends_at: new Date(now - 90 * 60_000).toISOString(),
  offer_expires_at: null,
  attended_live: false,
  saw_offer: false,
  watch_max_seconds_live: 0,
  statut: 'registered',
  payment_status: null,
  purchased_at: null,
};
let savedJob = null;

globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const table = parsed.pathname.split('/').pop();
  const method = String(init.method || 'GET').toUpperCase();
  if (table === 'mc2_registrations' && method === 'GET') return Response.json([registration]);
  if (table === 'mc2_replay_recovery_jobs' && method === 'GET') return Response.json([]);
  if (table === 'mc2_replay_recovery_jobs' && method === 'POST') {
    savedJob = JSON.parse(String(init.body || '{}'));
    return Response.json([{ id: 1, ...savedJob }]);
  }
  throw new Error(`Unexpected ${method} ${url}`);
};

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const { default: enterReplay } = await import('../netlify/functions/mc2-replay-enter.js');
const directResponse = await enterReplay(new Request(`https://sonnycourt.com/.netlify/functions/mc2-replay-enter?t=${token}`));
assert.equal(directResponse.status, 302);
assert.match(directResponse.headers.get('location') || '', /^\/mc2\/replay\/\?access=[A-Za-z0-9_-]{24,128}$/);
assert.equal(savedJob?.token, token);
assert.equal(savedJob?.status, 'delivered');
assert.equal(savedJob?.segment, 'no_show');

registration = {
  ...registration,
  saw_offer: true,
  offer_expires_at: new Date(now + 20 * 60 * 60_000).toISOString(),
};
savedJob = null;
const offerResponse = await enterReplay(new Request(`https://sonnycourt.com/.netlify/functions/mc2-replay-enter?t=${token}`));
assert.equal(offerResponse.status, 302);
assert.equal(offerResponse.headers.get('location'), `/mc2/session/?t=${token}`);
assert.equal(savedJob, null);

console.log(JSON.stringify({
  replay_only_late_user: 'temporary_replay_access',
  replay_offer_seen: 'session_checkout_from_persisted_token_deadline',
  expired_offer: 'session_closed_offer_state',
}, null, 2));
