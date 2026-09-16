import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTrackingTransport } from '../src/lib/mc2-tracking-transport.mjs';
import { startMc2JourneyTracking } from '../src/lib/mc2-journey-tracking.mjs';
import { trackingMedia } from '../src/lib/mc2-tracking-contract.mjs';
import handler, { validateJourneyEvent } from '../netlify/functions/track-mc2-journey.js';
import legacyHandler from '../netlify/functions/track-mc2-event.js';
import { summarizeTracking, unionSeconds } from '../netlify/functions/lib/mc2-tracking-report.mjs';

const token = randomUUID(), visit = randomUUID();
const sample = (name = 'journey_started', metadata = {}) => ({ event_id: randomUUID(), token, visit_id: visit, route: '/mc2/session/', event_name: name, client_occurred_at: new Date().toISOString(), metadata });
const storage = new Map(), timers = new Map(), listeners = new Map(); let timerId = 0, sent = [], fail = false;
const view = { sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, navigator: { onLine: true },
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {},
  fetch: async (url, options) => { assert.equal(url, '/.netlify/functions/track-mc2-journey'); const batch = JSON.parse(options.body); sent.push({ batch, options }); if (fail) throw new Error('offline'); return Response.json({ accepted: batch.events.map(e => e.event_id), rejected: [] }); } };
let transport = createTrackingTransport(view);
const first = sample(); transport.enqueue(first); fail = true; await transport.flush();
assert.equal(transport.snapshot().queued, 1, 'No ACK = keep event');
transport.stop(); transport = createTrackingTransport(view); fail = false; await transport.flush();
assert.equal(sent.at(-1).batch.events[0].event_id, first.event_id, 'Same ID after reload');
assert.equal(transport.snapshot().queued, 0);
assert.equal(sent.at(-1).options.keepalive, undefined, 'Ordinary traffic never uses keepalive');
for (let i = 0; i < 900; i++) transport.enqueue(sample('player_state'));
assert.ok(transport.snapshot().queued <= 600); assert.ok(transport.snapshot().dropped >= 300);
while (transport.snapshot().queued) await transport.flush();
assert.ok(sent.every(s => s.batch.events.length <= 24));
transport.stop();
const brokenStorage = { ...view, sessionStorage: { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } } };
transport = createTrackingTransport(brokenStorage); transport.enqueue(sample()); await transport.flush(); assert.equal(transport.snapshot().acknowledged, 1); transport.stop();

// Full 132/112-minute simulations. Video object cannot be changed by the tracker.
const OriginalDate = Date;
function simulate(route, { seek = false, hidden = false, frozen = false, zeroCounter = false } = {}) {
  const start = OriginalDate.now(); let now = start, tick, at = 0, paused = false, available = false, fullscreen = false;
  globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  try {
    const records = [], docListeners = new Map();
    const video = Object.freeze({ get currentTime() { return at; }, get paused() { return paused; }, ended: false, seeking: false, readyState: 4, playbackRate: 1,
      play() { assert.fail('Analytics must never play'); }, pause() { assert.fail('Analytics must never pause'); },
      getVideoPlaybackQuality: () => ({ totalVideoFrames: zeroCounter ? 0 : frozen ? 50 : Math.floor(at * 25) }) });
    const offer = { getBoundingClientRect: () => ({ top: 100, bottom: 1100, width: 500, height: 1000, left: 0, right: 500 }), querySelector: () => null };
    const doc = { visibilityState: hidden ? 'hidden' : 'visible', get fullscreenElement() { return fullscreen ? video : null; },
      addEventListener: (name, fn) => docListeners.set(name, fn), removeEventListener() {},
      querySelector: selector => selector.includes('masterclass-video') ? video : selector === '#deal-offer-content' ? offer : null };
    const w = { document: doc, location: { pathname: route, search: '?preview=dev', hostname: 'localhost' },
      __mc2DraftX: { record: (name, metadata) => records.push({ name, metadata }) }, crypto: { randomUUID }, performance: { now: () => now - start },
      innerHeight: 800, innerWidth: 600, scrollY: 0, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {}, fetch() { assert.fail('Preview cannot send'); } };
    doc.defaultView = w;
    const root = { ownerDocument: doc, dataset: { registrationToken: token, get checkoutAvailable() { return String(available); } } };
    const tracker = startMc2JourneyTracking(root), media = trackingMedia(route);
    for (let i = 0; i <= media.duration; i++) { now += 1000; at = seek && i === 100 ? media.cta + 30 : at + 1; available = at >= media.cta; tick(); if (seek && i > 120) break; }
    const intervals = records.filter(r => r.name === 'v2:playback_interval');
    assert.ok(intervals.length > 0);
    assert.ok(intervals.every(r => r.metadata.position_end > r.metadata.position_start && r.metadata.elapsed_seconds <= 15));
    const cta = records.filter(r => r.name === 'v2:cta_playback_present');
    assert.equal(cta.length, hidden || seek || frozen ? 0 : 1, `CTA qualification: ${route}`);
    if (!seek) assert.ok(intervals.length > 400, 'Beyond former 40-minute cutoff');
    if (hidden) assert.equal(records.some(r => r.name === 'v2:offer_visible'), false);
    tracker('checkout_clicked', { step: 1, plan: 'twelve', email: 'private@example.invalid' });
    tracker('checkout_step_viewed', { step: 1 }); tracker('checkout_step_viewed', { step: 2 }); tracker('checkout_step_viewed', { step: 3 });
    assert.ok(records.some(r => r.name === 'v2:checkout_opened'));
    assert.equal(records.at(-1).metadata.step, 3); assert.equal(JSON.stringify(records).includes('private@example.invalid'), false);
    assert.equal(tracker.status().observerErrors, 0, 'No silently swallowed observer errors');
    tracker.stop(); return records;
  } finally { globalThis.Date = OriginalDate; }
}
simulate('/mc2/session/'); simulate('/mc2/replay/'); simulate('/mc2/session/', { seek: true });
simulate('/mc2/replay/', { hidden: true }); simulate('/mc2/session/', { frozen: true }); simulate('/mc2/replay/', { zeroCounter: true });
assert.equal(trackingMedia('/mc2/session/').cta - trackingMedia('/mc2/replay/').cta, 1200);

// API contract: mocked DB, no production services.
process.env.SUPABASE_URL = 'https://database.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'audit-only'; process.env.CONTEXT = 'production';
const originalFetch = globalThis.fetch; let writes = [], dbFails = false;
globalThis.fetch = async (input, options = {}) => {
  assert.ok(String(input).startsWith('https://database.invalid/rest/v1/'));
  if (!options.method) return Response.json([{ token }]);
  assert.equal(options.method, 'POST'); assert.ok(String(input).includes('rpc/mc2_tracking_ingest_v2'));
  const body = JSON.parse(options.body); writes.push(body.items);
  return Response.json({ accepted: body.items.map(e => e.event_id) }, { status: dbFails ? 503 : 200 });
};
const request = events => handler(new Request('https://site.invalid/.netlify/functions/track-mc2-journey', { method: 'POST', body: JSON.stringify({ schema_version: 2, events }) }));
try {
  const e = sample('checkout_opened', { step: 1, email: 'secret@example.invalid' });
  let response = await request([e]); assert.equal(response.status, 200); assert.deepEqual((await response.json()).accepted, [e.event_id]);
  assert.equal(writes[0][0].metadata.email, undefined);
  response = await request([sample('purchase_completed')]); assert.equal((await response.json()).rejected.length, 1);
  dbFails = true; assert.equal((await request([e])).status, 503);
  assert.equal((await legacyHandler(new Request('https://site.invalid/track', { method: 'POST', body: JSON.stringify({ token, event: 'purchase_completed' }) }))).status, 400);
} finally { globalThis.fetch = originalFetch; }
assert.equal(validateJourneyEvent(sample('playback_interval', { position_start: 0, position_end: 5000, elapsed_seconds: 1 })), null);
assert.equal(unionSeconds([[1, 5], [2, 6], [8, 10]]), 7);
const r = { id: 1, token, pays: 'France', registration_completed_at: new Date().toISOString() };
const intervalMeta = { foreground: true, position_start: 5685, position_end: 5695, interval_started_at: new Date(Date.now() - 10000).toISOString(), interval_ended_at: new Date().toISOString() };
const duplicatedIntervals = [sample('playback_interval', intervalMeta), sample('playback_interval', intervalMeta)];
const report = summarizeTracking({ registrations: [r], events: [sample(), ...duplicatedIntervals], purchaseEvents: [] });
assert.equal(report.totals.ctaPresent, 1); assert.equal(report.people[0].observedForegroundSeconds, 10); assert.ok(report.retention.every(row => row.people === 1));
assert.equal(summarizeTracking({ registrations: [r], events: [], tests: [{ token }] }).totals.registrations, 0);
for (const file of ['src/lib/mc2-journey-tracking.mjs', 'netlify/functions/track-mc2-journey.js']) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.play\(|\.pause\(|currentTime\s*=|location\.assign|supabasePatch\(/, 'Observer must not drive the experience');
}
console.log('PASS v2: long live/replay, 20-minute offset, seeks, hidden tabs, frozen/unsupported frames, durable ACK queue, limits, failed storage, privacy, read-only observers, payments rejected, interval union, test exclusions. No external calls.');
