import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MC2_SESSION_HALF_WINDOW_MS,
  MC2_SESSION_OFFER_DURATION_MS,
  MC2_SESSION_PURCHASE_TIMELINE,
  MC2_SESSION_TOTAL_SEATS,
  formatMc2SessionRelativeTime,
  getMc2SessionRegistrationAction,
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
assert.deepEqual(MC2_SESSION_PURCHASE_TIMELINE.map((item) => item.offsetMs), [
  3 * minute,
  5 * minute,
  12 * minute,
  13 * minute,
  17 * minute,
  49 * minute,
  1 * hour + 10 * minute,
  3 * hour + 15 * minute,
  8 * hour + 30 * minute,
  12 * hour,
  13 * hour + 30 * minute,
  16 * hour,
  19 * hour + 30 * minute,
  23 * hour,
]);
assert.ok(MC2_SESSION_PURCHASE_TIMELINE.every((item, index, list) => index === 0 || item.offsetMs > list[index - 1].offsetMs));

assert.equal(getMc2SessionSeatsLeft(start - 1, start), 15);
assert.equal(getMc2SessionSeatsLeft(start, start), 15);
assert.equal(getMc2SessionSeatsLeft(start + 3 * minute - 1, start), 15);
assert.equal(getMc2SessionSeatsLeft(start + 3 * minute, start), 14);
assert.equal(getMc2SessionSeatsLeft(start + 5 * minute, start), 13);
assert.equal(getMc2SessionSeatsLeft(start + 12 * minute, start), 12);
assert.equal(getMc2SessionSeatsLeft(start + 13 * minute, start), 11);
assert.equal(getMc2SessionSeatsLeft(start + 17 * minute, start), 10);
assert.equal(getMc2SessionSeatsLeft(start + 49 * minute, start), 9);
assert.equal(getMc2SessionSeatsLeft(start + 1 * hour + 10 * minute, start), 8);
assert.equal(getMc2SessionSeatsLeft(start + 3 * hour + 15 * minute, start), 7);
assert.equal(getMc2SessionSeatsLeft(start + 8 * hour + 30 * minute, start), 6);
assert.equal(getMc2SessionSoldCount(start + MC2_SESSION_HALF_WINDOW_MS, start), 10);
assert.equal(getMc2SessionSeatsLeft(start + MC2_SESSION_HALF_WINDOW_MS, start), 5);
assert.equal(getMc2SessionSeatsLeft(start + 13 * hour + 30 * minute, start), 4);
assert.equal(getMc2SessionSeatsLeft(start + 16 * hour, start), 3);
assert.equal(getMc2SessionSeatsLeft(start + 19 * hour + 30 * minute, start), 2);
assert.equal(getMc2SessionSeatsLeft(start + 23 * hour, start), 1);
assert.equal(getMc2SessionSeatsLeft(start + MC2_SESSION_OFFER_DURATION_MS - 1, start), 1);
assert.equal(getMc2SessionSeatsLeft(start + MC2_SESSION_OFFER_DURATION_MS, start), 0);

assert.equal(getMc2SessionRegistrationAction({ gender: 'female' }), 's’est inscrite');
assert.equal(getMc2SessionRegistrationAction({ gender: 'male' }), 's’est inscrit');
assert.equal(formatMc2SessionRelativeTime(start + minute, start), 'il y a 1 minute');
assert.equal(formatMc2SessionRelativeTime(start + 3 * minute, start), 'il y a 3 minutes');
assert.equal(formatMc2SessionRelativeTime(start + hour, start), 'il y a 1 heure');
assert.equal(formatMc2SessionRelativeTime(
  Date.parse('2026-08-23T10:30:00.000Z'),
  Date.parse('2026-08-23T08:00:00.000Z'),
), 'aujourd’hui');
assert.equal(formatMc2SessionRelativeTime(
  Date.parse('2026-08-24T00:30:00.000Z'),
  Date.parse('2026-08-23T20:00:00.000Z'),
), 'hier');

const sessionPageSource = await readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
assert.match(sessionPageSource, /const PURCHASE_TOAST_TEST_MODE = false;/);
assert.match(sessionPageSource, /get\('scarcity_test'\) === '1'/);
assert.match(sessionPageSource, /isPreviewPage\s*\n\s*\|\| new URLSearchParams/);
assert.doesNotMatch(sessionPageSource, /purchaseToastFastDemo|scheduleDemo|purchase_demo/);
assert.match(sessionPageSource, />MODE TEST<\/span>/);

console.log(JSON.stringify({
  cta_start_15_of_15: 'ok',
  h12_5_of_15: 'ok',
  h23_1_of_15: 'ok',
  h24_closed: 'ok',
}, null, 2));
