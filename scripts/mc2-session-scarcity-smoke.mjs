import assert from 'node:assert/strict';
import {
  MC2_SESSION_HALF_WINDOW_MS,
  MC2_SESSION_OFFER_DURATION_MS,
  MC2_SESSION_PURCHASE_TIMELINE,
  MC2_SESSION_TOTAL_SEATS,
  getMc2SessionSeatsLeft,
  getMc2SessionSoldCount,
} from '../src/lib/mc2-session-scarcity.mjs';

const start = Date.parse('2026-08-23T12:00:00.000Z');
const minute = 60 * 1000;
const hour = 60 * minute;

assert.equal(MC2_SESSION_TOTAL_SEATS, 15);
assert.equal(MC2_SESSION_HALF_WINDOW_MS, 12 * hour);
assert.equal(MC2_SESSION_OFFER_DURATION_MS, 24 * hour);
assert.equal(MC2_SESSION_PURCHASE_TIMELINE.length, 14);
assert.equal(MC2_SESSION_PURCHASE_TIMELINE.filter((item) => item.offsetMs < MC2_SESSION_HALF_WINDOW_MS).length, 10);
assert.ok(MC2_SESSION_PURCHASE_TIMELINE.every((item, index, list) => index === 0 || item.offsetMs > list[index - 1].offsetMs));

assert.equal(getMc2SessionSeatsLeft(start - 1, start), 15);
assert.equal(getMc2SessionSeatsLeft(start, start), 15);
assert.equal(getMc2SessionSeatsLeft(start + 4 * minute, start), 15);
assert.equal(getMc2SessionSeatsLeft(start + 5 * minute, start), 14);
assert.equal(getMc2SessionSoldCount(start + MC2_SESSION_HALF_WINDOW_MS, start), 10);
assert.equal(getMc2SessionSeatsLeft(start + MC2_SESSION_HALF_WINDOW_MS, start), 5);
assert.equal(getMc2SessionSeatsLeft(start + 23 * hour, start), 1);
assert.equal(getMc2SessionSeatsLeft(start + MC2_SESSION_OFFER_DURATION_MS - 1, start), 1);
assert.equal(getMc2SessionSeatsLeft(start + MC2_SESSION_OFFER_DURATION_MS, start), 0);

console.log(JSON.stringify({
  cta_start_15_of_15: 'ok',
  h12_5_of_15: 'ok',
  h23_1_of_15: 'ok',
  h24_closed: 'ok',
}, null, 2));
