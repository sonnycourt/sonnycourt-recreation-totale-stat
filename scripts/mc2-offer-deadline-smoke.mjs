import assert from 'node:assert/strict';
import {
  MC2_LIVE_CTA_SECONDS,
  MC2_LIVE_VIDEO_LEAD_MS,
  MC2_OFFER_DURATION_MS,
  MC2_OFFER_SMS_LEAD_MS,
  mc2LiveCtaAt,
} from '../netlify/functions/lib/mc2-offer-deadline.mjs';

assert.equal(MC2_LIVE_CTA_SECONDS, 90 * 60 + 13);
assert.equal(MC2_LIVE_VIDEO_LEAD_MS, 15 * 60 * 1000);
assert.equal(MC2_OFFER_DURATION_MS, 24 * 60 * 60 * 1000);
assert.equal(MC2_OFFER_SMS_LEAD_MS, 15 * 60 * 1000);

const activatedAt = mc2LiveCtaAt({ session_starts_at: '2026-08-13T18:00:00.000Z' });
assert.equal(activatedAt.toISOString(), '2026-08-13T19:15:13.000Z');
assert.equal(
  new Date(activatedAt.getTime() + MC2_OFFER_DURATION_MS).toISOString(),
  '2026-08-14T19:15:13.000Z',
);
assert.equal(
  new Date(activatedAt.getTime() + MC2_OFFER_DURATION_MS - MC2_OFFER_SMS_LEAD_MS).toISOString(),
  '2026-08-14T19:00:13.000Z',
);

console.log(JSON.stringify({
  cta_live_013013: 'ok',
  offer_window_24h: 'ok',
  sms_deadline_minus_15m: 'ok',
}, null, 2));
