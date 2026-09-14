import assert from 'node:assert/strict';
import { activePlayback, visibleArea, startMc2JourneyTracking } from '../src/lib/mc2-journey-tracking.mjs';
import handler from '../netlify/functions/track-mc2-event.js';
import { mc2FunnelMetaEvents } from '../netlify/functions/lib/mc2-meta-events.mjs';

const sample = { visible: true, paused: false, seeking: false, readyState: 4, previous: 120, current: 121, elapsed: 1 };
const registration = { token: 'test', traffic_source: 'meta_ad', clicked_cta: false };
assert.deepEqual(mc2FunnelMetaEvents({ eventName: 'checkout_clicked', registration }).map(e => e.eventName), ['CTA_Clicked']);
assert.equal(mc2FunnelMetaEvents({ eventName: 'cta_clicked', registration })[0].eventId,
  mc2FunnelMetaEvents({ eventName: 'checkout_clicked', registration })[0].eventId, 'Meta deduplicates legacy and actual-open signals');
assert.equal(activePlayback(sample), true);
for (const patch of [{ visible: false }, { paused: true }, { seeking: true }, { current: 500 }, { current: 120 }, { elapsed: 60 }, { readyState: 1 }]) {
  assert.equal(activePlayback({ ...sample, ...patch }), false, JSON.stringify(patch));
}
let tick, now = 0, hidden = false, available = false, open = false;
const records = [];
const video = { paused: false, seeking: false, readyState: 4, currentTime: 0 };
const offer = { getBoundingClientRect: () => ({ top: 100, bottom: 1000, left: 0, right: 500, width: 500, height: 900 }) };
const doc = { get visibilityState() { return hidden ? 'hidden' : 'visible'; }, addEventListener() {},
  querySelector: selector => selector.includes('masterclass-video') ? video : selector.includes('deal-offer-content') ? offer : open ? {} : null };
const view = { document: doc, crypto: { randomUUID: () => String(Math.random()) }, performance: { now: () => now },
  location: { pathname: '/mc2/session/', search: '?preview=dev' }, __mc2DraftX: { record: (event, meta) => records.push({ event, meta }) },
  innerHeight: 800, innerWidth: 600, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  setInterval: callback => { tick = callback; }, addEventListener() {}, fetch: () => assert.fail('Preview must not send analytics') };
doc.defaultView = view;
const root = { ownerDocument: doc, dataset: { get checkoutAvailable() { return String(available); } }, querySelector: () => null };
const emit = startMc2JourneyTracking(root);
assert.equal(visibleArea(offer, view), true);
for (let i = 0; i < 12; i++) { now += 1000; video.currentTime++; tick(); }
assert.ok(records.some(r => r.event === 'video_active_presence' && r.meta.minute === 0));
hidden = true; available = true;
for (let i = 0; i < 12; i++) { now += 1000; video.currentTime++; tick(); }
assert.ok(!records.some(r => r.event === 'offer_available_present'));
hidden = false; now += 1000; video.currentTime++; tick();
assert.equal(records.filter(r => r.event === 'offer_available_present').length, 1);
emit('checkout_step_viewed', { step: 2 });
assert.equal(records.at(-1).meta.step, 2);

// Backend contract: fully mocked HTTP, no database, message or real payment.
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const savedFetch = globalThis.fetch;
const events = new Map();
let failInsert = false;
globalThis.fetch = async (url, opts = {}) => {
  assert.ok(String(url).startsWith('https://database.invalid/rest/v1/'), 'No external integrations in this test');
  if (!opts.method && String(url).includes('mc2_registrations')) return Response.json([{ token: 'test', clicked_cta: true, checkout_view_count: 1 }]);
  if (!opts.method) {
    const key = new URL(url).searchParams.get('dedupe_key').slice(3);
    return Response.json(events.has(key) ? [{ id: 1 }] : []);
  }
  if (opts.method === 'PATCH') return new Response(null, { status: 204 });
  const body = JSON.parse(opts.body);
  if (failInsert) return Response.json({ error: 'test outage' }, { status: 503 });
  events.set(body.dedupe_key, body);
  return new Response(null, { status: 201 });
};
const request = (event, meta) => handler(new Request('https://site.invalid/track', { method: 'POST', body: JSON.stringify({ token: 'test', event, meta }) }));
try {
  for (const event of ['checkout_step_viewed', 'checkout_plan_selected', 'checkout_closed', 'checkout_payment_ready', 'offer_available_present', 'offer_actually_seen', 'video_active_presence']) {
    const meta = { event_id: event, step: 3, minute: 42, active_seconds: 10.2, email: 'must-not-store@example.invalid' };
    assert.equal((await request(event, meta)).status, 200);
    assert.equal((await (await request(event, meta)).json()).duplicate, true);
    assert.equal(events.get('journey_' + event).metadata.email, undefined);
    assert.equal(events.get('journey_' + event).metadata.active_seconds, 10.2);
  }
  failInsert = true;
  assert.equal((await request('checkout_step_viewed', { event_id: 'failure' })).status, 503);
} finally { globalThis.fetch = savedFetch; }
console.log('PASS — active vs hidden/paused/seeking/stalled; preview isolation; new server events, duplicate retry, metadata privacy, storage failure. No real service called.');
