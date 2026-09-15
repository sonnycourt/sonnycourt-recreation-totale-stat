import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createMc2LiveParticipation, hasMc2LiveParticipation } from '../src/lib/mc2-live-participation.mjs';

// All storage, time and requests are simulated: no real prospect or service.
const sessionStartMs = Date.parse('2026-09-14T18:00:00Z');
const liveStartMs = sessionStartMs - 15 * 60000;
const broadcastEndMs = liveStartMs + 7920 * 1000;
const token = 'unit-test-only';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture({ send = async () => ({ ok: true }), storage, ...options } = {}) {
  let nowMs = sessionStartMs + 5 * 60000;
  let seq = 0;
  const timers = new Map();
  const values = new Map();
  storage ||= { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const args = {
    storage, token, sessionStartMs, send, now: () => nowMs,
    setTimer: (callback, delay) => { const id = ++seq; timers.set(id, { callback, at: nowMs + delay }); return id; },
    clearTimer: id => timers.delete(id),
    ...options,
  };
  return {
    controller: createMc2LiveParticipation(args), args, values, timers,
    saved: (overrides = {}) => hasMc2LiveParticipation({ storage, token, sessionStartMs, liveStartMs, broadcastEndMs, nowMs, ...overrides }),
    async advance(ms) {
      nowMs += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= nowMs) { timers.delete(id); timer.callback(); }
      }
      await settle();
    },
  };
}

let calls = 0;
const fresh = fixture({ send: async () => { calls++; return { ok: true }; } });
await fresh.controller.retry();
assert.equal(calls, 0, 'Opening a page does not declare attendance');
assert.equal(fresh.saved(), false);
fresh.controller.confirmPlayback();
assert.equal(fresh.saved(), true, 'The local marker exists before any network acknowledgement');
await settle();
fresh.controller.confirmPlayback();
await fresh.controller.retry();
assert.equal(calls, 1, 'Acknowledged attendance is not sent repeatedly');
assert.equal(fresh.timers.size, 0);
assert.equal(fresh.saved({ token: 'someone-else' }), false);
assert.equal(fresh.saved({ sessionStartMs: sessionStartMs + 86400000 }), false);
assert.equal(fresh.saved({ nowMs: sessionStartMs }), false, 'Future-dated markers are ignored');
const key = [...fresh.values.keys()][0];
for (const invalid of ['broken', '{}', JSON.stringify({ sessionStartMs, joinedAtMs: liveStartMs - 1 }), JSON.stringify({ sessionStartMs, joinedAtMs: broadcastEndMs })]) {
  fresh.values.set(key, invalid);
  assert.equal(fresh.saved({ nowMs: broadcastEndMs + 1 }), false);
}

let attempts = 0;
const retry = fixture({ send: async () => { attempts++; return attempts < 3 ? null : { ok: true }; } });
retry.controller.confirmPlayback();
await settle();
await retry.advance(2000);
assert.equal(attempts, 2);
await retry.advance(5000);
assert.equal(attempts, 3);
await retry.advance(60000);
assert.equal(attempts, 3);
assert.equal(retry.timers.size, 0);

let requestSignal;
let hungCalls = 0;
const hung = fixture({ send: signal => { requestSignal = signal; hungCalls++; return new Promise(() => {}); } });
hung.controller.confirmPlayback();
await settle();
for (let i = 0; i < 5; i++) { hung.controller.confirmPlayback(); void hung.controller.retry(); }
await settle();
assert.equal(hungCalls, 1, 'No concurrent presence requests');
await hung.advance(10000);
assert.equal(requestSignal.aborted, true, 'A hung request is released');
await hung.advance(2000);
assert.equal(hungCalls, 2);
hung.controller.destroy();
await settle();
assert.equal(hung.timers.size, 0);
await hung.advance(60000);
assert.equal(hungCalls, 2, 'Unmount/unload stops further retries');

let repaired = 0;
const pending = fixture({ send: () => new Promise(() => {}) });
pending.controller.confirmPlayback();
await settle();
pending.controller.destroy();
await settle();
// Reload after the late cutoff, while the same broadcast is still in progress.
const restored = createMc2LiveParticipation({
  ...pending.args, participated: pending.saved({ nowMs: sessionStartMs + 62 * 60000 }),
  send: async () => { repaired++; return { ok: true }; },
});
await restored.retry();
assert.equal(repaired, 1, 'A refresh retries an unacknowledged real join even after the cutoff');
restored.destroy();

let withoutStorageCalls = 0;
const unavailable = fixture({
  storage: { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } },
  send: async () => { withoutStorageCalls++; return { ok: true }; },
});
assert.equal(unavailable.saved(), false);
unavailable.controller.confirmPlayback();
await settle();
assert.equal(withoutStorageCalls, 1, 'Storage failure does not block server attendance');

let alreadyRecordedCalls = 0;
const acknowledged = fixture({ participated: true, acknowledged: true, send: async () => { alreadyRecordedCalls++; } });
await acknowledged.controller.retry();
assert.equal(alreadyRecordedCalls, 0, 'A server-confirmed return needs no repair');

// Exercise the real page's playback guard, not a rewritten copy of its logic.
const page = readFileSync(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const guard = page.match(/            function trackSessionJoinedIfEligible\(\) \{[\s\S]*?\n            \}/)[0];
function play(overrides = {}) {
  let confirmed = 0;
  const context = {
    hasJoinedSession: true, video: { paused: false, ended: false }, isSessionEnded: false,
    forceLateOverlay: false, forceEndedOverlay: false, hasPersistedOffer: false, isOfferExpired: false,
    getNowMs: () => sessionStartMs + 62 * 60000, liveStartMs, getBroadcastEndMs: () => broadcastEndMs,
    liveParticipation: { confirmPlayback() { confirmed++; } }, reg: {}, ...overrides,
  };
  runInNewContext(guard + '\ntrackSessionJoinedIfEligible();', context);
  return confirmed;
}
assert.equal(play(), 1, 'An admitted viewer is recorded even if playback starts after the cutoff');
for (const overrides of [
  { hasJoinedSession: false }, { video: { paused: true, ended: false } },
  { video: { paused: false, ended: true } }, { isSessionEnded: true },
  { forceLateOverlay: true }, { forceEndedOverlay: true }, { hasPersistedOffer: true },
  { isOfferExpired: true }, { getNowMs: () => liveStartMs - 1 }, { getNowMs: () => broadcastEndMs },
]) assert.equal(play(overrides), 0);
assert.match(page, /addEventListener\('playing', trackSessionJoinedIfEligible\)/);
assert.doesNotMatch(page.match(/addEventListener\('loadedmetadata',[\s\S]*?refreshPreLiveCountdown\(\);/)[0], /trackSessionJoinedIfEligible\(\)/);
console.log('PASS — presence acknowledged/retried, hung request, refresh, session isolation, real-play guards, timer cleanup; zero external writes.');
