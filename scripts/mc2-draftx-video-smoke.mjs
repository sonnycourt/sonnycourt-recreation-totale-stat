import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as timing from '../src/lib/mc2-draftx-timing.mjs';
import * as media from '../src/lib/mc2-draftx-media.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const live = read('src/pages/mc2/draftx.astro');
const replay = read('src/pages/mc2/draftx/replay.astro');
assert.equal(timing.MC2_LIVE_CTA_SECONDS, 5690);
assert.equal(timing.MC2_REPLAY_CTA_SECONDS, 4490);
assert.equal(timing.MC2_LIVE_VIDEO_DURATION_SECONDS, 7920);
assert.equal(timing.MC2_REPLAY_VIDEO_DURATION_SECONDS, 6719);
assert.equal(timing.MC2_SESSION_DURATION_SECONDS, 7020);
assert.match(media.MC2_DRAFTX_LIVE_HLS_URL, /c0135d6e-9cfe-4605-a90b-b2ea2d7d7961\/playlist\.m3u8$/);
assert.match(media.MC2_DRAFTX_REPLAY_HLS_URL, /e538dedd-26e0-4b69-9900-13a7ec8a37f8\/playlist\.m3u8$/);
assert.match(live, /VIDEO_SOURCE_URL_PRIMARY = MC2_DRAFTX_LIVE_HLS_URL/);
assert.match(live, /d.variant !== 'draftx'/, 'An old endpoint must not silently restore the previous video');
assert.match(replay, /VIDEO_SOURCE_URL_PRIMARY = MC2_DRAFTX_REPLAY_HLS_URL/);
assert.doesNotMatch(replay, /return recoveryConfig\?\.videoUrl|Number\(data.ctaSeconds\)/);
assert.match(replay, /DealOfferDraftX\.astro/);
assert.match(replay, /mc2:draftx-registration/);
assert.match(replay, /mc2:draftx-availability/);
assert.match(replay, /launchReplayAfterConfirm\(recoveryResumeSeconds\)/);
assert.match(replay, /launchReplayAfterConfirm\(0\)/);
assert.doesNotMatch(replay, /connect\.facebook|clarity\.ms|spiffy\.load\(/);
assert.match(read('src/pages/mc2/session-archive.astro'), /f0f337ba-a2f9-4b20-a20a-6704320edb6d/);
assert.match(read('src/pages/mc2/replay-archive.astro'), /b7d49161-940c-4305-8706-d56da93effc2/);
assert.doesNotMatch(read('src/pages/mc2/session-archive.astro'), /mc2-draftx-media/);

const update = replay.match(/      function updateCtaStateByVideoTime\(\) \{[\s\S]*?\n      \}/)?.[0];
assert.ok(update);
for (const [seconds, expected] of [[4489.99, 'hidden'], [4490, 'active'], [4490.01, 'active']]) {
  let result;
  runInNewContext(update + '\nupdateCtaStateByVideoTime()', {
    video: { currentTime: seconds },
    CTA_APPEAR_SECONDS: timing.MC2_REPLAY_CTA_SECONDS,
    CTA_ACTIVATE_SECONDS: timing.MC2_REPLAY_CTA_SECONDS,
    activateOfferAndScarcity() { result = 'active'; },
    hideOfferAndScarcity() { result = 'hidden'; },
    showLockedOffer() { result = 'locked'; },
    setOfferExpiredState() {}, isOfferExpiredNow() { return false; },
  });
  assert.equal(result, expected);
}

// Exercise existing endpoints with fake storage only: no customer or external request.
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'draftx-video-test-only';
const token = 'draftx-video-unit-token-1234567890';
const accessCode = 'draftx-replay-access-unit-1234567890';
let registration = {
  token, email: 'test@example.invalid', prenom: 'Test',
  session_starts_at: new Date(Date.now() - 86400000).toISOString(),
  offer_expires_at: null, attended_live: false, saw_offer: false,
  watch_max_seconds_live: 0, watch_max_seconds_replay: 0,
  statut: 'inscrit', payment_status: null, purchased_at: null,
};
globalThis.fetch = async input => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://supabase.test', 'No real service is called');
  if (url.pathname.endsWith('/mc2_registrations')) return Response.json([registration]);
  if (url.pathname.endsWith('/mc2_replay_recovery_jobs')) return Response.json([{ id: 42, access_code: accessCode }]);
  throw new Error('Unexpected test request: ' + url.pathname);
};
const { default: enterReplay } = await import('../netlify/functions/mc2-replay-enter.js');
for (const variant of ['', '&variant=draftx']) {
  const response = await enterReplay(new Request('https://example.invalid/.netlify/functions/mc2-replay-enter?t=' + token + variant));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), (variant ? '/mc2/draftx/replay/' : '/mc2/replay/') + '?access=' + accessCode);
}
registration = { ...registration, saw_offer: true, offer_expires_at: new Date(Date.now() + 86400000).toISOString() };
for (const variant of ['', '&variant=draftx']) {
  const response = await enterReplay(new Request('https://example.invalid/.netlify/functions/mc2-replay-enter?t=' + token + variant));
  assert.equal(response.headers.get('location'), (variant ? '/mc2/draftx/' : '/mc2/session/') + '?t=' + token);
}
const { default: videoConfig } = await import('../netlify/functions/mc2-video-config.js');
const response = await videoConfig(new Request('https://example.invalid/.netlify/functions/mc2-video-config?variant=draftx'));
const config = await response.json();
assert.equal(config.variant, 'draftx');
assert.equal(config.activeUrl, media.MC2_DRAFTX_LIVE_HLS_URL);
assert.equal(config.forceRefreshAt, null);
console.log('PASS — W13B live/replay, timings exacts, nouveau replay + checkout, isolation des sources et routes historiques. Aucun service réel appelé.');
