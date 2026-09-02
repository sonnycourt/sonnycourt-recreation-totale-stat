import assert from 'node:assert/strict';
import {
  MC2_LIVE_CTA_SECONDS,
  MC2_LIVE_VIDEO_LEAD_MS,
  MC2_OFFER_DURATION_MS,
  MC2_OFFER_SMS_LEAD_MS,
  mc2LiveCtaAt,
} from '../netlify/functions/lib/mc2-offer-deadline.mjs';
import { getMc2VideoSources } from '../netlify/functions/lib/mc2-video-config.mjs';
import { mc2SmsMessage } from '../netlify/functions/lib/mc2-sms.mjs';

assert.equal(MC2_LIVE_CTA_SECONDS, 97 * 60 + 28);
assert.equal(MC2_LIVE_VIDEO_LEAD_MS, 15 * 60 * 1000);
assert.equal(MC2_OFFER_DURATION_MS, 72 * 60 * 60 * 1000);
assert.equal(MC2_OFFER_SMS_LEAD_MS, 4 * 60 * 60 * 1000);
assert.equal(
  getMc2VideoSources({}).primary,
  'https://vz-601d6eb4-a9a.b-cdn.net/eb8f090e-919d-4994-92b9-a9b516b35600/playlist.m3u8',
);

const activatedAt = mc2LiveCtaAt({ session_starts_at: '2026-08-13T18:00:00.000Z' });
assert.equal(activatedAt.toISOString(), '2026-08-13T19:22:28.000Z');

const sessionStartsAt = new Date('2026-08-13T18:00:00.000Z');
assert.equal(
  new Date(sessionStartsAt.getTime() + MC2_OFFER_DURATION_MS).toISOString(),
  '2026-08-16T18:00:00.000Z',
);
assert.equal(
  new Date(sessionStartsAt.getTime() + MC2_OFFER_DURATION_MS - MC2_OFFER_SMS_LEAD_MS).toISOString(),
  '2026-08-16T14:00:00.000Z',
);

const deadlineMessage = mc2SmsMessage('offer_deadline', 'token-test', { liveCode: 'A1b2C' });
assert.match(deadlineMessage, /expire dans 4 heures/);
assert.match(deadlineMessage, /\/offre\/A1b2C/);
assert.doesNotMatch(deadlineMessage, /15 minutes/);

console.log(JSON.stringify({
  cta_live_013728: 'ok',
  offer_window_72h_from_session: 'ok',
  sms_deadline_minus_4h: 'ok',
  sms_deadline_copy_4h: 'ok',
}, null, 2));
