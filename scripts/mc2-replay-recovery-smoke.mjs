import assert from 'node:assert/strict';
import {
  isMc2Purchased,
  mc2RecoveryDueAt,
  mc2RecoveryJobKey,
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
  MC2_REPLAY_BEFORE_CTA_DELAY_MINUTES: '60',
  MC2_OFFER_FOLLOWUP_DELAY_MINUTES: '15',
  MC2_REPLAY_ACCESS_HOURS: '48',
  MC2_REPLAY_RESUME_REWIND_SECONDS: '30',
};

assert.equal(mc2ReplayRecoveryEnabled({ MC2_REPLAY_RECOVERY_ENABLED: 'false' }), false);
assert.equal(mc2ReplayRecoveryEnabled({ MC2_REPLAY_RECOVERY_ENABLED: 'true' }), true);
assert.equal(mc2ReplayRecoveryConfig(env).replayAccessHours, 48);
assert.equal(mc2RecoverySegment(base), 'no_show');
assert.equal(mc2RecoveryDueAt(base, 'no_show', env).toISOString(), '2026-08-13T16:00:00.000Z');

const left = { ...base, attended_live: true, watch_max_seconds_live: 1_200 };
assert.equal(mc2RecoverySegment(left), 'left_before_cta');
assert.equal(mc2RecoveryResumeSeconds(left, 'left_before_cta', env), 1_170);
assert.equal(mc2RecoveryDueAt(left, 'left_before_cta', env).toISOString(), '2026-08-12T20:15:00.000Z');

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
  real_48h_window: 'ok',
  idempotent_job_key: 'ok',
}, null, 2));
