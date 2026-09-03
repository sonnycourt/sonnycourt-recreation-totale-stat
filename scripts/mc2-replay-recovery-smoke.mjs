import assert from 'node:assert/strict';
import {
  isMc2Purchased,
  mc2RecoveryDueAt,
  mc2RecoveryJobKey,
  mc2RecoveryMessageTypes,
  mc2RecoveryResumeSeconds,
  mc2RecoverySegment,
  mc2ReplayRecoveryConfig,
  mc2ReplayRecoveryEnabled,
} from '../netlify/functions/lib/mc2-replay-recovery.mjs';

const base = {
  token: 'token-test',
  session_starts_at: '2026-08-12T18:00:00.000Z',
  session_ends_at: '2026-08-12T19:15:00.000Z',
  attended_live: false,
  saw_offer: false,
  watch_max_seconds_live: 0,
  statut: 'registered',
  payment_status: null,
  purchased_at: null,
};
const env = {
  MC2_REPLAY_NO_SHOW_DELAY_MINUTES: '1320',
  MC2_REPLAY_BEFORE_CTA_DELAY_MINUTES: '90',
  MC2_OFFER_FOLLOWUP_DELAY_MINUTES: '15',
  MC2_REPLAY_ACCESS_HOURS: '48',
  MC2_LIVE_COUNTDOWN_SECONDS: '1200',
};

assert.equal(mc2ReplayRecoveryEnabled({ MC2_REPLAY_RECOVERY_ENABLED: 'false' }), false);
assert.equal(mc2ReplayRecoveryEnabled({ MC2_REPLAY_RECOVERY_ENABLED: 'true' }), true);
assert.equal(mc2ReplayRecoveryConfig(env).noShowDelayMinutes, 1_320);
assert.equal(mc2ReplayRecoveryConfig({}).liveCountdownSeconds, 1_200);
assert.equal(mc2ReplayRecoveryConfig({}).replayCtaSeconds, 79 * 60);
assert.equal(
  mc2ReplayRecoveryConfig({}).replayUrl,
  'https://vz-601d6eb4-a9a.b-cdn.net/d8be6839-2fad-472f-89fa-b0e089cc0b56/playlist.m3u8',
);
assert.equal(mc2ReplayRecoveryConfig({
  MC2_REPLAY_CTA_SECONDS: '4648',
}).replayCtaSeconds, 79 * 60);
assert.equal(mc2ReplayRecoveryConfig({
  MC2_REPLAY_VIDEO_URL: 'https://vz-601d6eb4-a9a.b-cdn.net/4b25a40b-d993-45b5-a896-e374629db914/playlist.m3u8',
}).replayUrl, 'https://vz-601d6eb4-a9a.b-cdn.net/d8be6839-2fad-472f-89fa-b0e089cc0b56/playlist.m3u8');
assert.equal(mc2RecoverySegment(base), 'no_show');
assert.equal(mc2RecoveryDueAt(base, 'no_show', env).toISOString(), '2026-08-13T16:00:00.000Z');
assert.equal(
  mc2RecoveryDueAt({ ...base, visitor_timezone: 'Europe/Paris' }, 'no_show', {}).toISOString(),
  '2026-08-13T07:00:00.000Z',
);

assert.deepEqual(mc2RecoveryMessageTypes(base, 'no_show'), [
  'no_show_initial', 'replay_24h', 'replay_4h',
]);
assert.equal(
  mc2RecoveryDueAt(base, 'no_show', env, 'replay_24h').toISOString(),
  '2026-08-14T18:00:00.000Z',
);
assert.equal(
  mc2RecoveryDueAt(base, 'no_show', env, 'replay_4h').toISOString(),
  '2026-08-15T14:00:00.000Z',
);

const left = {
  ...base,
  attended_live: true,
  watch_max_seconds_live: 2_700,
  last_presence_at: '2026-08-12T18:20:00.000Z',
};
assert.equal(mc2RecoverySegment(left), 'left_before_cta');
assert.equal(mc2RecoveryResumeSeconds(left, 'left_before_cta', env), 1_500);
assert.equal(mc2RecoveryDueAt(left, 'left_before_cta', env).toISOString(), '2026-08-12T19:50:00.000Z');
assert.equal(
  mc2RecoveryDueAt({ ...left, last_presence_at: null }, 'left_before_cta', env).toISOString(),
  '2026-08-12T21:29:08.000Z',
);

assert.equal(
  mc2RecoveryResumeSeconds({ ...left, watch_max_seconds_live: 1_200 }, 'left_before_cta', env),
  0,
);
assert.equal(
  mc2RecoveryResumeSeconds({ ...left, watch_max_seconds_live: 1_201 }, 'left_before_cta', env),
  1,
);

const offer = { ...left, saw_offer: true, offer_expires_at: '2026-08-12T20:15:00.000Z' };
assert.equal(mc2RecoverySegment(offer), 'offer_seen_no_purchase');
assert.equal(mc2RecoveryDueAt(offer, 'offer_seen_no_purchase', env).toISOString(), '2026-08-12T20:30:00.000Z');
assert.equal(mc2RecoveryResumeSeconds(offer, 'offer_seen_no_purchase', env), 0);

for (const purchased of [
  { ...offer, statut: 'purchased' },
  { ...offer, payment_status: 'paid' },
  { ...offer, purchased_at: '2026-08-12T19:20:00.000Z' },
]) {
  assert.equal(isMc2Purchased(purchased), true);
  assert.equal(mc2RecoverySegment(purchased), null);
}

assert.equal(
  mc2RecoveryJobKey(base, 'no_show'),
  'mc2_recovery:token-test:2026-08-12T18:00:00.000Z:no_show',
);

console.log(JSON.stringify({
  mc2_replay_recovery_segmentation: 'ok',
  buyer_exclusion: 'ok',
  replay_deadline_independent_from_offer: 'ok',
  smart_no_show_timing: 'ok',
  replay_reminder_sequence: 'ok',
  idempotent_job_key: 'ok',
}, null, 2));
