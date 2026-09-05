import assert from 'node:assert/strict';
import {
  MC2_LIVE_CTA_SECONDS,
  MC2_LIVE_VIDEO_LEAD_MS,
  MC2_OFFER_DURATION_MS,
  MC2_OFFER_SMS_LEAD_MS,
  mc2OfferActivatedAt,
  mc2OfferDeadlineCandidate,
  mc2LiveCtaAt,
} from '../netlify/functions/lib/mc2-offer-deadline.mjs';
import { MC2_REPLAY_OFFER_DURATION_MS } from '../src/lib/mc2-timing.mjs';
import { getMc2VideoSources } from '../netlify/functions/lib/mc2-video-config.mjs';
import { mc2SmsMessage } from '../netlify/functions/lib/mc2-sms.mjs';

assert.equal(MC2_LIVE_CTA_SECONDS, (94 * 60) + 51);
assert.equal(MC2_LIVE_VIDEO_LEAD_MS, 15 * 60 * 1000);
assert.equal(MC2_OFFER_DURATION_MS, 72 * 60 * 60 * 1000);
assert.equal(MC2_REPLAY_OFFER_DURATION_MS, (72 * 60 * 60 - ((74 * 60) + 51)) * 1000);
assert.equal(MC2_OFFER_SMS_LEAD_MS, 4 * 60 * 60 * 1000);
assert.equal(
  getMc2VideoSources({}).primary,
  'https://vz-601d6eb4-a9a.b-cdn.net/f0f337ba-a2f9-4b20-a20a-6704320edb6d/playlist.m3u8',
);
assert.equal(
  getMc2VideoSources({
    MC2_LIVE_VIDEO_URL_PRIMARY: 'https://vz-601d6eb4-a9a.b-cdn.net/eb8f090e-919d-4994-92b9-a9b516b35600/playlist.m3u8',
  }).primary,
  'https://vz-601d6eb4-a9a.b-cdn.net/f0f337ba-a2f9-4b20-a20a-6704320edb6d/playlist.m3u8',
);
assert.equal(
  getMc2VideoSources({
    MC2_LIVE_VIDEO_URL_PRIMARY: 'https://vz-601d6eb4-a9a.b-cdn.net/b253a12e-7673-4447-ba19-1b868051efd6/playlist.m3u8',
  }).primary,
  'https://vz-601d6eb4-a9a.b-cdn.net/f0f337ba-a2f9-4b20-a20a-6704320edb6d/playlist.m3u8',
);

const activatedAt = mc2LiveCtaAt({ session_starts_at: '2026-08-13T18:00:00.000Z' });
assert.equal(activatedAt.toISOString(), '2026-08-13T19:19:51.000Z');

const sessionStartsAt = new Date('2026-08-13T18:00:00.000Z');
assert.equal(
  new Date(sessionStartsAt.getTime() + MC2_OFFER_DURATION_MS).toISOString(),
  '2026-08-16T18:00:00.000Z',
);

const replayCtaAt = new Date('2026-08-15T12:00:00.000Z');
const replayDeadline = mc2OfferDeadlineCandidate({
  registration: { session_starts_at: sessionStartsAt.toISOString() },
  source: 'replay',
  now: replayCtaAt,
});
assert.equal(replayDeadline.toISOString(), '2026-08-18T10:45:09.000Z');
assert.equal(mc2OfferActivatedAt({
  registration: { session_starts_at: sessionStartsAt.toISOString() },
  expiresAt: replayDeadline,
}).toISOString(), replayCtaAt.toISOString());
assert.equal(mc2OfferActivatedAt({
  registration: { session_starts_at: sessionStartsAt.toISOString() },
  expiresAt: new Date(sessionStartsAt.getTime() + MC2_OFFER_DURATION_MS),
}).toISOString(), activatedAt.toISOString());
assert.equal(
  new Date(sessionStartsAt.getTime() + MC2_OFFER_DURATION_MS - MC2_OFFER_SMS_LEAD_MS).toISOString(),
  '2026-08-16T14:00:00.000Z',
);

const deadlineMessage = mc2SmsMessage('offer_deadline', 'token-test', { liveCode: 'A1b2C' });
assert.match(deadlineMessage, /expire dans 4 heures/);
assert.match(deadlineMessage, /\/offre\/A1b2C/);
assert.doesNotMatch(deadlineMessage, /15 minutes/);

console.log(JSON.stringify({
  cta_live_013451: 'ok',
  offer_window_live_72h_from_session: 'ok',
  offer_window_replay_72h_minus_pre_cta: 'ok',
  sms_deadline_minus_4h: 'ok',
  sms_deadline_copy_4h: 'ok',
}, null, 2));
