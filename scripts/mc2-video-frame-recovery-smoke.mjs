import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual page functions, not a second implementation. No network,
// tracking requests, payments or customer records are touched by this harness.
function fixture(mode, { hangingPlay = false, rejectedPlay = false } = {}) {
  const live = mode === 'session';
  const source = readFileSync(new URL(`../src/pages/mc2/${mode}.astro`, import.meta.url), 'utf8');
  const indent = live ? '            ' : '      ';
  const fn = name => {
    const match = source.match(new RegExp(`${indent}(?:async )?function ${name}\\([^]*?\\n${indent}\\}`));
    assert.ok(match, `${mode}: actual ${name} function exists`);
    return match[0];
  };
  let at = 2_000_000, frames = 0, reloads = 0, visible = true, overlay = false;
  const events = new Map(), payloads = [];
  const video = {
    currentTime: 1000, duration: 7020, paused: false, ended: false, seeking: false, readyState: 4,
    addEventListener: (event, handler) => events.set(event, handler),
    removeEventListener: event => events.delete(event),
    play() { return rejectedPlay ? Promise.reject(new Error('autoplay blocked')) : hangingPlay ? new Promise(() => {}) : Promise.resolve(); },
  };
  const context = {
    Date: class extends Date { static now() { return at; } }, video,
    reg: { token: 'unit-only' }, token: 'unit-only',
    trackWebinaireEvent: (_token, _name, payload) => payloads.push(JSON.parse(payload)),
    freezeRecoveryOverlay: { classList: { toggle: (_name, on) => { overlay = on; } }, setAttribute() {} },
    frameMonitor: { reset() {}, frameCount: () => frames, isVisible: () => visible },
    FREEZE_RECOVERY_ENABLED: true, FREEZE_PROGRESS_EPSILON_SEC: 0.1,
    FREEZE_THRESHOLD_MS: live ? 24000 : 12000, FREEZE_WATCHDOG_INTERVAL_MS: 2000,
    FREEZE_RECOVERY_COOLDOWN_MS: 10000, FREEZE_RECOVERY_VALIDATE_WINDOW_MS: live ? 12000 : 10000,
    FREEZE_VISIBILITY_GRACE_MS: 3000, MAX_FREEZE_RECOVERIES: 2,
    lastProgressCurrentTime: 1000, stalledAccumulatedMs: 0, suppressFreezeDetectionUntilMs: 0,
    freezeRecoveryCount: 0, lastRecoveryAtMs: 0, pendingRecoveryValidation: null,
    recoveryValidationDeadlineMs: 0, isRecoveringInProgress: false, frameRecoveryRetryPending: false,
    frameRecoveryResumeHandler: null, allowProgrammaticSeek: false,
    isSessionEnded: false, hasJoinedSession: true, pendingSourceSwitch: null,
    hasAppliedLiveOffset: false, pendingForceLiveSeek: false, isLiveJoin: false,
    liveStartMs: 0, getNowMs: () => at, getVideoDurationSeconds: () => video.duration,
    liveSeekInProgress: false, maxWatched: 1000,
    setTimeout() {}, updatePlayOverlayLabel() {},
    hlsInstance: null, hlsDiagnostics: { softRecoveries: 0, hardReloads: 0 },
    reloadVideoSource() { reloads++; video.currentTime = 0; video.readyState = 0; video.duration = NaN; },
  };
  const functions = ['setFreezeRecoveryOverlayVisible', 'trackFreezeRecoveryPayload',
    live ? 'buildFreezeRecoveryPayload' : 'buildFreezePayload', 'resetFreezeProgressBaseline',
    'isVideoActivelyPlayingForFreeze', 'finishRecoveryValidation',
    ...(live ? ['runRecoveryStrategy', 'applySimulatedLiveOffset'] : []),
    'triggerFreezeRecovery', 'runFreezeWatchdogTick'];
  runInNewContext(functions.map(fn).join('\n'), context);
  return { context, video, payloads, events,
    trigger: () => context.triggerFreezeRecovery('frame_stall', 5),
    async tick(ms = 2000, delivered = 0) {
      at += ms; video.currentTime += ms / 1000; frames += delivered;
      context.runFreezeWatchdogTick();
      await Promise.resolve(); await Promise.resolve();
    },
    visible(value) { visible = value; },
    metadata() {
      video.readyState = 4; video.duration = 7020;
      if (live && context.pendingForceLiveSeek) context.applySimulatedLiveOffset({ force: true });
      else events.get('loadedmetadata')?.();
    },
    reloads: () => reloads, overlay: () => overlay, clock: () => Math.floor(at / 1000),
  };
}

for (const mode of ['session', 'replay']) {
  const f = fixture(mode);
  await f.trigger();
  assert.equal(f.video.currentTime, mode === 'session' ? f.clock() : 1000,
    mode + ': first recovery rejoins the live clock / preserves replay');
  assert.equal(f.reloads(), 0, 'First attempt does not reload the player');
  assert.equal(f.context.freezeRecoveryCount, 1);
  await f.trigger();
  assert.equal(f.context.freezeRecoveryCount, 1, 'No concurrent recovery');
  await f.tick(4000);
  assert.ok(f.context.pendingRecoveryValidation, 'Audio alone is not proof of recovery');
  assert.equal(f.payloads.length, 0);
  await f.tick(2000, 1);
  assert.ok(f.context.pendingRecoveryValidation, 'One seek frame is not sufficient');
  await f.tick(2000, 1);
  assert.equal(f.context.pendingRecoveryValidation, null);
  assert.equal(f.context.freezeRecoveryCount, 0);
  assert.equal(f.payloads.at(-1).recovered, true, 'New frames and timeline progression confirm recovery');

  const broken = fixture(mode);
  await broken.trigger();
  const secondPosition = broken.video.currentTime + 14;
  await broken.tick(14000);
  assert.equal(broken.reloads(), 1, 'Failed soft recovery gets one source reload');
  assert.equal(broken.context.freezeRecoveryCount, 2);
  assert.equal(broken.video.currentTime, 0, 'Source reset is held until metadata');
  broken.metadata();
  assert.equal(broken.video.currentTime, mode === 'session' ? broken.clock() : secondPosition,
    'Reload resolves the current live clock / restores the replay passage');
  assert.equal(broken.events.size, 0, 'Metadata recovery handler is cleaned up');
  await broken.tick(14000);
  assert.equal(broken.overlay(), true, 'Persistent failure offers manual recovery');
  for (let i = 0; i < 10; i++) await broken.tick(2000);
  assert.equal(broken.reloads(), 1, 'Never enter an automatic reload loop');
  assert.equal(broken.payloads.filter(p => !p.recovered).length, 2);

  const hidden = fixture(mode);
  await hidden.trigger();
  hidden.visible(false);
  await hidden.tick(14000);
  assert.equal(hidden.reloads(), 0, 'No second recovery while video is off-screen');
  await hidden.tick(2000, 2);
  hidden.visible(true);
  await hidden.tick();
  assert.equal(hidden.reloads(), 0, 'Frames that return before retry prevent an unnecessary reload');

  const paused = fixture(mode);
  await paused.trigger();
  paused.video.paused = true;
  await paused.tick(14000);
  assert.equal(paused.reloads(), 0, 'No forced replay while paused');

  for (const options of [{ hangingPlay: true }, { rejectedPlay: true }]) {
    const pendingPlay = fixture(mode, options);
    await pendingPlay.trigger();
    assert.ok(pendingPlay.context.pendingRecoveryValidation, 'play() cannot leave recovery permanently locked');
  }

  const legacy = fixture(mode);
  legacy.context.pendingRecoveryValidation = { trigger: 'watchdog', frameCountBefore: 0,
    currentTimeAtFreeze: 1000, freezeDurationSec: 24, recoveryAttemptNumber: 1 };
  legacy.context.recoveryValidationDeadlineMs = Infinity;
  await legacy.tick(4000);
  assert.equal(legacy.context.pendingRecoveryValidation, null, 'Legacy time-stall recovery remains unchanged');
}
console.log('PASS — actual live/replay recovery: clock/position, frame-based validation, bounded retries, metadata, pause/offscreen guards and non-blocking play.');
