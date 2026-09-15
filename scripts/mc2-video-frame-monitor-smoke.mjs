import assert from 'node:assert/strict';
import { createMc2VideoFrameMonitor } from '../src/lib/mc2-video-frame-monitor.mjs';

function fixture({ supported = true, graceMs = 3000 } = {}) {
  let at = 0, callback, poll, cancelled = false, cleared = false, eligible = true;
  const events = new Map(), docEvents = new Map(), incidents = [];
  const rect = { top: 0, left: 0, bottom: 400, right: 700, width: 700, height: 400 };
  const video = {
    currentTime: 0, paused: false, ended: false, seeking: false, readyState: 4,
    getBoundingClientRect: () => rect,
    addEventListener: (event, fn) => events.set(event, fn), removeEventListener: event => events.delete(event),
    ...(supported ? {
      requestVideoFrameCallback(fn) { callback = fn; return 1; },
      cancelVideoFrameCallback() { cancelled = true; },
    } : {}),
  };
  const doc = {
    visibilityState: 'visible', defaultView: { innerHeight: 800, innerWidth: 1000 },
    addEventListener: (event, fn) => docEvents.set(event, fn), removeEventListener: event => docEvents.delete(event),
  };
  const monitor = createMc2VideoFrameMonitor(video, {
    document: doc, now: () => at, isEligible: () => eligible, graceMs,
    setInterval(fn) { poll = fn; return 1; }, clearInterval() { cleared = true; },
    onFrozen: incident => incidents.push(incident),
  });
  const advance = (ms, { frames = true, audio = true } = {}) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 500) {
      at += 500;
      if (audio) video.currentTime += 0.5;
      if (frames) callback?.();
      poll?.();
    }
  };
  return { video, doc, rect, incidents, monitor, advance, events, docEvents,
    eligible: value => { eligible = value; },
    suspended(ms) { at += ms; video.currentTime += ms / 1000; poll?.(); },
    cleanup: () => ({ cancelled, cleared }),
  };
}

const moving = fixture();
moving.advance(20000);
assert.equal(moving.incidents.length, 0, 'A static slide still delivers video frames, regardless of identical pixels');
assert.ok(moving.monitor.frameCount() > 0);
moving.advance(4500, { frames: false });
assert.equal(moving.incidents.length, 0, 'No recovery before five seconds');
moving.advance(500, { frames: false });
assert.equal(moving.incidents.length, 1, 'Audio advancing without frames triggers at five seconds');
moving.advance(20000, { frames: false });
assert.equal(moving.incidents.length, 1, 'Only one signal per uninterrupted frame outage');
moving.advance(5000);
moving.advance(5000, { frames: false });
assert.equal(moving.incidents.length, 2, 'A genuinely new outage is detected after frames return');

for (const kind of ['paused', 'ended', 'seeking', 'buffering', 'hidden', 'offscreen', 'ineligible']) {
  const f = fixture();
  f.advance(10000);
  if (['paused', 'ended', 'seeking'].includes(kind)) f.video[kind] = true;
  if (kind === 'buffering') f.video.readyState = 1;
  if (kind === 'hidden') f.doc.visibilityState = 'hidden';
  if (kind === 'offscreen') f.rect.top = 1000;
  if (kind === 'ineligible') f.eligible(false);
  f.advance(15000, { frames: false });
  assert.equal(f.incidents.length, 0, kind + ' must not trigger recovery');
  f.monitor.destroy();
}
const buffer = fixture();
buffer.advance(10000);
buffer.advance(15000, { frames: false, audio: false });
assert.equal(buffer.incidents.length, 0, 'Ordinary whole-player buffering remains with the existing watchdog');

const tab = fixture();
tab.advance(10000);
tab.doc.visibilityState = 'hidden';
tab.advance(20000, { frames: false });
tab.doc.visibilityState = 'visible';
tab.docEvents.get('visibilitychange')();
tab.advance(5000, { frames: false });
assert.equal(tab.incidents.length, 0, 'Tab return has a grace period');
tab.advance(5000);
assert.equal(tab.incidents.length, 0);
tab.suspended(15000);
tab.advance(3000, { frames: false });
assert.equal(tab.incidents.length, 0, 'A suspended JS main thread is not proof of stalled video');

const seek = fixture();
seek.advance(10000);
seek.video.currentTime += 500;
seek.events.get('seeking')();
seek.events.get('seeked')();
seek.advance(5000, { frames: false });
assert.equal(seek.incidents.length, 0, 'Seek grace prevents a false recovery');
seek.advance(2000);
seek.monitor.destroy();
assert.deepEqual(seek.cleanup(), { cancelled: true, cleared: true });
assert.equal(seek.events.size, 0);
assert.equal(seek.docEvents.size, 0);
const frameCount = seek.monitor.frameCount();
seek.advance(20000);
assert.equal(seek.monitor.frameCount(), frameCount, 'Callbacks after teardown cannot revive the monitor');

const legacy = fixture({ supported: false });
assert.equal(legacy.monitor.supported, false);
legacy.advance(20000, { frames: false });
assert.equal(legacy.incidents.length, 0, 'Unsupported browsers retain existing recovery behavior');
legacy.monitor.destroy();
console.log('PASS — 5s frame stall, static slide, no signal flood, visibility/seek/startup safeguards, unsupported browser and cleanup.');
