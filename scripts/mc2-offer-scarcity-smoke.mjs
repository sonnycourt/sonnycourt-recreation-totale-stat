import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MC2_OFFER_INITIAL_REMAINING_SEATS,
  MC2_OFFER_TIMELINE_PURCHASES,
  MC2_OFFER_TOTAL_SEATS,
  snapshotMc2OfferScarcity,
} from '../netlify/functions/lib/mc2-offer-scarcity.mjs';
import handler from '../netlify/functions/mc2-offer-scarcity.js';
import {
  prefetchMc2OfferScarcity,
  startMc2OfferScarcityDisplay,
} from '../src/lib/mc2-offer-scarcity-display.mjs';

const start = Date.parse('2026-08-13T19:20:32.000Z');
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const duration = 72 * hour;
const end = start + duration;

function seatsAt(offsetMs, seenSoldCount = null) {
  return snapshotMc2OfferScarcity({
    windowStartMs: start,
    windowEndMs: end,
    nowMs: start + offsetMs,
    seenSoldCount,
  });
}

assert.equal(MC2_OFFER_TOTAL_SEATS, 100);
assert.equal(MC2_OFFER_INITIAL_REMAINING_SEATS, 37);
assert.equal(MC2_OFFER_TIMELINE_PURCHASES, 37);

assert.equal(seatsAt(-1).seatsLeft, 37);
assert.equal(seatsAt(0).seatsLeft, 37);
assert.equal(seatsAt(3 * minute - 1).seatsLeft, 37);
assert.equal(seatsAt(3 * minute).seatsLeft, 36);
assert.equal(seatsAt(6 * minute).seatsLeft, 35);
assert.equal(seatsAt(7 * minute).seatsLeft, 34);
assert.equal(seatsAt(9 * minute).seatsLeft, 33);
assert.equal(seatsAt(24 * hour).seatsLeft, 20);
assert.equal(seatsAt(48 * hour).seatsLeft, 5);
assert.equal(seatsAt(duration - 1).seatsLeft, 1);
assert.equal(seatsAt(duration).seatsLeft, 0);
assert.equal(seatsAt(duration).soldOut, true);
assert.equal(seatsAt(duration).expired, true);
assert.equal(seatsAt(duration).remainingMs, 0);
assert.equal(seatsAt(hour).remainingMs, duration - hour);

const firstPurchase = seatsAt(3 * minute, 0);
assert.equal(firstPurchase.soldCount, 1);
assert.deepEqual(firstPurchase.purchases, [{ name: 'Thomas', flag: '🇫🇷' }]);
assert.equal(Object.hasOwn(firstPurchase.purchases[0], 'offsetMs'), false);

const baseline = seatsAt(3 * minute, null);
assert.deepEqual(baseline.purchases, []);
assert.equal(baseline.soldCount, 1);

const hidden = JSON.stringify(seatsAt(9 * minute, 0));
assert.doesNotMatch(hidden, /offsetMs|FIRST_DAY|BUYERS|phase2_note/);

const publicPages = [
  '../src/pages/mc2/session.astro',
  '../src/pages/mc2/replay.astro',
  '../src/pages/mc2/draftx.astro',
  '../src/pages/mc2/draftx/replay.astro',
  '../src/pages/mc2/session-archive.astro',
  '../src/pages/mc2/replay-archive.astro',
  '../src/lib/mc2-offer-scarcity-display.mjs',
];
for (const page of publicPages) {
  const source = await readFile(new URL(page, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /FIRST_DAY_OFFSETS_MS|FINAL_PHASE_FRACTIONS|createMc2OfferTimeline/);
  assert.doesNotMatch(source, /mc2-draftx-scarcity-engine|from ['"].*scarcity-engine['"]/);
  assert.match(source, /prefetchMc2OfferScarcity/);
}
const replayAccess = await readFile(new URL('../netlify/functions/mc2-replay-access.js', import.meta.url), 'utf8');
assert.match(replayAccess, /mc2OfferActivatedAt/);
assert.match(replayAccess, /offerActivatedAt/);

const response = await handler(new Request('https://sonnycourt.com/.netlify/functions/mc2-offer-scarcity', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    windowStartMs: start,
    windowEndMs: end,
    nowMs: start + 6 * minute,
    seenSoldCount: 1,
  }),
}));
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
const payload = await response.json();
assert.equal(payload.seatsLeft, 35);
assert.equal(payload.totalSeats, 100);
assert.equal(payload.remainingMs, duration - 6 * minute);
assert.deepEqual(payload.purchases, [{ name: 'Sophie', flag: '🇧🇪' }]);
assert.equal(Object.hasOwn(payload, 'timeline'), false);
assert.doesNotMatch(JSON.stringify(payload), /offsetMs/);

const rejected = await handler(new Request('https://sonnycourt.com/.netlify/functions/mc2-offer-scarcity', {
  method: 'GET',
}));
assert.equal(rejected.status, 405);

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
let prefetchCalls = 0;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
};
globalThis.fetch = async () => {
  prefetchCalls += 1;
  return new Response(JSON.stringify({
    evaluatedNowMs: start + hour,
    remainingMs: duration - hour,
    seatsLeft: 20,
    soldCount: 17,
    phase: 'phase1',
    nextChangeInMs: 5000,
    purchases: [],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const firstPrefetch = prefetchMc2OfferScarcity({
  windowStartMs: start,
  windowEndMs: end,
  nowMs: start + hour,
});
const secondPrefetch = prefetchMc2OfferScarcity({
  windowStartMs: start,
  windowEndMs: end,
  nowMs: start + hour,
});
assert.equal(firstPrefetch, secondPrefetch);
const prefetched = await firstPrefetch;
assert.equal(prefetched.seatsLeft, 20);
assert.equal(prefetchCalls, 1);
let paintedSeats = null;
const display = startMc2OfferScarcityDisplay({
  now: () => start + hour,
  windowStartMs: start,
  windowEndMs: end,
  onSeatsLeft(seatsLeft) { paintedSeats = seatsLeft; },
});
assert.equal(display.hasSnapshot(), true);
assert.equal(paintedSeats, 20);
display.stop();
globalThis.fetch = originalFetch;
globalThis.document = originalDocument;

console.log(JSON.stringify({
  server_snapshot_37_20_5_0: 'ok',
  public_pages_without_schedule: 'ok',
  endpoint_returns_display_only: 'ok',
}, null, 2));
