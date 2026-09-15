import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  MC2_LIVE_VIDEO_DURATION_SECONDS,
  MC2_LIVE_CTA_SECONDS,
  MC2_OFFER_DURATION_MS,
} from '../src/lib/mc2-timing.mjs';

// Exercise the actual Session decision function, without a browser, network,
// customer token, tracking write or payment call.
const page = readFileSync(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
function source(name) {
  const match = page.match(new RegExp(`            function ${name}\\([^]*?\\n            \\}`));
  assert.ok(match, `${name} exists`);
  return match[0];
}

const liveStartMs = Date.parse('2026-09-15T14:00:00Z');
const endSeconds = MC2_LIVE_VIDEO_DURATION_SECONDS;
function scenario({ elapsed, persisted = false, joined = false, attended = false, currentTime = 0, late = false, expired = false }) {
  const calls = [];
  const context = {
    liveStartMs,
    sessionStartMs: liveStartMs + 15 * 60_000,
    hideCountdownMs: liveStartMs + 60_000,
    expiryMs: expired ? liveStartMs : liveStartMs + MC2_OFFER_DURATION_MS,
    getNowMs: () => liveStartMs + elapsed * 1000,
    getVideoDurationSeconds: () => endSeconds,
    hasPersistedOffer: persisted,
    hasJoinedSession: joined,
    reg: { attendedLive: attended },
    forceLateOverlay: late,
    forceEndedOverlay: false,
    isPreviewPage: false,
    isSessionEnded: false,
    isLiveJoin: false,
    liveStarted: false,
    hasAppliedLiveOffset: false,
    video: { paused: true, currentTime, pause() { calls.push('pause'); } },
    preLive: { style: {} },
    waiting: null,
    endedNote: null,
    playOverlay: { classList: { add() {}, remove() {} } },
    syncMcLateUi: on => { if (on) calls.push('late'); },
    syncMcEndedGateUi: on => { if (on) calls.push('ended-gate'); },
    syncMcUnavailableUi: on => { if (on) calls.push('expired'); },
    applyInlineEndedUi: options => {
      context.isSessionEnded = true;
      calls.push(options?.keepOfferVisible ? 'ended-with-offer' : 'ended');
    },
    activateLiveJoinState: () => calls.push('live'),
    updateCtaStateByTime: () => calls.push('live-offer-timing'),
    updateDiagnosticGuideState() {},
    updateCountdown: () => calls.push('waiting'),
    updateLiveJumpUi() {},
    setOfferCtaEnabled() {},
    hideOfferZone() {},
    setJoinedControlsVisible() {},
    updatePlayOverlayLabel() {},
  };
  const initialExpiry = context.expiryMs;
  runInNewContext(`${source('getBroadcastEndMs')}\n${source('refreshPreLiveCountdown')}\nrefreshPreLiveCountdown();`, context);
  assert.equal(context.expiryMs, initialExpiry, 'A refresh never resets the offer deadline');
  return { calls, ended: context.isSessionEnded };
}

assert.ok(scenario({ elapsed: -60 }).calls.includes('waiting'));
assert.ok(scenario({ elapsed: MC2_LIVE_CTA_SECONDS - 1, attended: true }).calls.includes('live'));
for (const elapsed of [MC2_LIVE_CTA_SECONDS, 6000, endSeconds - 1]) {
  for (const persisted of [false, true]) {
    const result = scenario({ elapsed, persisted, attended: true });
    assert.ok(result.calls.includes('live'), `Offer persisted=${persisted}, ${elapsed}s: live must remain available`);
    assert.ok(result.calls.includes('live-offer-timing'), 'Keep rendering the timed offer beneath the live');
    assert.equal(result.ended, false, 'An offer view does not mean the video ended');
  }
}
assert.ok(scenario({ elapsed: 6000, persisted: true }).calls.includes('live'), 'A persisted offer does not require a fresh server attendance acknowledgement');
for (const elapsed of [endSeconds, endSeconds + 60]) {
  assert.ok(scenario({ elapsed, persisted: true }).calls.includes('ended-with-offer'), 'After the broadcast, restore the existing offer');
  assert.ok(scenario({ elapsed, attended: true }).calls.includes('ended-with-offer'));
}
const trailingViewer = scenario({ elapsed: endSeconds + 10, persisted: true, joined: true, attended: true, currentTime: endSeconds - 30 });
assert.equal(trailingViewer.ended, false, 'Do not cut off a joined viewer who is slightly behind live');
assert.ok(trailingViewer.calls.includes('live-offer-timing'));
assert.ok(scenario({ elapsed: endSeconds + 10, persisted: true, joined: true, currentTime: endSeconds }).calls.includes('ended-with-offer'));
assert.ok(scenario({ elapsed: endSeconds, attended: false }).calls.includes('ended-gate'));
assert.ok(scenario({ elapsed: 6000, late: true }).calls.includes('late'));
const expired = scenario({ elapsed: 6000, persisted: true, expired: true });
assert.ok(expired.calls.includes('expired'));
assert.equal(expired.calls.includes('live'), false);

// Verify the unchanged live seek uses the clock, not the stored offer or zero.
const seekContext = {
  getNowMs: () => liveStartMs + 6_000_000,
  liveStartMs,
  getVideoDurationSeconds: () => endSeconds,
  video: { duration: endSeconds, currentTime: 0, play: () => Promise.resolve() },
  isSessionEnded: false,
  hasAppliedLiveOffset: false,
  pendingForceLiveSeek: false,
  isLiveJoin: false,
  maxWatched: 0,
  liveSeekInProgress: false,
  setTimeout() {},
  updatePlayOverlayLabel() {},
};
runInNewContext(`${source('applySimulatedLiveOffset')}\napplySimulatedLiveOffset();`, seekContext);
assert.equal(seekContext.video.currentTime, 6000, 'A live refresh resumes at 1h40, not at the beginning');

console.log('PASS — live refresh before/after CTA, persisted offer, clock seek, true end, delayed viewer, late gate and offer expiry. No network calls.');
