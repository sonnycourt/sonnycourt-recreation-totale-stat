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
fresh.controller.confirmJoin();
assert.equal(fresh.saved(), true, 'The local marker exists before any network acknowledgement');
await settle();
fresh.controller.confirmJoin();
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
retry.controller.confirmJoin();
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
hung.controller.confirmJoin();
await settle();
for (let i = 0; i < 5; i++) { hung.controller.confirmJoin(); void hung.controller.retry(); }
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
pending.controller.confirmJoin();
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
unavailable.controller.confirmJoin();
await settle();
assert.equal(withoutStorageCalls, 1, 'Storage failure does not block server attendance');

let alreadyRecordedCalls = 0;
const acknowledged = fixture({ participated: true, acknowledged: true, send: async () => { alreadyRecordedCalls++; } });
await acknowledged.controller.retry();
assert.equal(alreadyRecordedCalls, 0, 'A server-confirmed return needs no repair');

// Navigation lets the keepalive request finish, but never schedules another retry.
let finishRequest;
let navigationSignal;
const navigating = fixture({ send: signal => {
  navigationSignal = signal;
  return new Promise(resolve => { finishRequest = resolve; });
} });
navigating.controller.confirmJoin();
await settle();
navigating.controller.destroy({ abortPending: false });
assert.equal(navigationSignal.aborted, false);
finishRequest(null);
await settle();
assert.equal(navigating.timers.size, 0);

// Exercise the real page's click guard and handler, not a rewritten copy.
const page = readFileSync(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const guard = page.match(/            function trackSessionJoinedIfEligible\(\) \{[\s\S]*?\n            \}/)[0];
function join(overrides = {}) {
  let confirmed = 0;
  const context = {
    hasJoinedSession: false, video: { paused: true, readyState: 0 }, isSessionEnded: false,
    forceLateOverlay: false, forceEndedOverlay: false, hasPersistedOffer: false, isOfferExpired: false,
    getNowMs: () => sessionStartMs + 62 * 60000, liveStartMs, getBroadcastEndMs: () => broadcastEndMs,
    expiryMs: sessionStartMs + 72 * 3600000,
    liveParticipation: { confirmJoin() { confirmed++; } }, reg: {}, ...overrides,
  };
  runInNewContext(guard + '\ntrackSessionJoinedIfEligible();', context);
  return confirmed;
}
assert.equal(join(), 1, 'An admitted viewer can join after the cutoff even if the player is not ready');
assert.equal(join({ video: { paused: false, readyState: 4 } }), 1);
for (const overrides of [
  { isSessionEnded: true },
  { forceLateOverlay: true }, { forceEndedOverlay: true }, { hasPersistedOffer: true },
  { isOfferExpired: true }, { getNowMs: () => liveStartMs - 1 }, { getNowMs: () => broadcastEndMs },
  { expiryMs: sessionStartMs },
]) assert.equal(join(overrides), 0);
assert.doesNotMatch(page, /addEventListener\('(?:play|playing)', trackSessionJoinedIfEligible\)/);
assert.doesNotMatch(page.match(/addEventListener\('loadedmetadata',[\s\S]*?refreshPreLiveCountdown\(\);/)[0], /trackSessionJoinedIfEligible\(\)/);
const clickSource = page.match(/            playBtn.addEventListener\('click', function \(\) \{[\s\S]*?\n            \}\);/)[0];
async function clickJoin({ readyState = 0, late = false, beforeStart = false } = {}) {
  const sequence = [];
  let handler;
  const context = {
    hasJoinedSession: false, pendingForceLiveSeek: false, isSessionEnded: false,
    forceLateOverlay: late, forceEndedOverlay: false, hasPersistedOffer: false, isOfferExpired: false,
    getNowMs: () => beforeStart ? liveStartMs - 1 : sessionStartMs + 62 * 60000,
    liveStartMs, getBroadcastEndMs: () => broadcastEndMs, expiryMs: broadcastEndMs + 3600000,
    liveParticipation: { confirmJoin() { sequence.push('entry'); } }, reg: {},
    playBtn: { addEventListener(event, fn) { assert.equal(event, 'click'); handler = fn; } },
    video: { paused: true, readyState, play() { sequence.push('play'); return Promise.reject(new Error('simulated player failure')); } },
    setJoinedControlsVisible() {}, applySimulatedLiveOffset(options) { assert.equal(options.force, true); sequence.push('seek-live'); },
    waiting: null, playOverlay: { classList: { add() {} } }, updateLiveJumpUi() {}, syncMobileControlsAutoHide() {},
  };
  runInNewContext(guard + '\n' + clickSource, context);
  handler();
  await settle();
  return { sequence, context };
}
const notReady = await clickJoin();
assert.deepEqual(notReady.sequence, ['entry', 'play'], 'Entry is recorded synchronously before playback, even when play rejects');
assert.equal(notReady.context.hasJoinedSession, true);
assert.equal(notReady.context.pendingForceLiveSeek, true, 'Existing deferred live positioning is preserved');
assert.equal(notReady.context.reg.attendedLive, true);
assert.deepEqual((await clickJoin({ readyState: 4 })).sequence, ['entry', 'seek-live', 'play']);
assert.deepEqual((await clickJoin({ late: true })).sequence, []);
assert.deepEqual((await clickJoin({ beforeStart: true })).sequence, []);
console.log('PASS — explicit join click, failed playback, acknowledgements/retries, hung requests, refresh, session/access isolation, live seek and timer cleanup; zero external writes.');
