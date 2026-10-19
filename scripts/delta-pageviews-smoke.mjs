import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePageviewHandler, readPageviews, prunePageviews } from '../netlify/functions/lib/delta-pageviews.mjs';
import { initDeltaPageviews } from '../src/lib/delta-pageviews.mjs';
import admin from '../netlify/functions/admin-delta-vision-pageviews.js';

const records = new Map(), removed = [];
const store = {
  async set(key, value) { records.set(key, value); },
  async list({ prefix = '', directories = false } = {}) {
    return directories ? { directories: [...new Set([...records.keys()].map(k => k.split('/')[0] + '/'))] } :
      { blobs: [...records.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
  },
  async delete(key) { removed.push(key); records.delete(key); },
};
const now = new Date('2026-10-19T12:00:00Z');
const handler = makePageviewHandler({ store: () => store, now: () => now });
const request = (headers = {}, body = 'view') => new Request('https://sonnycourt.com/.netlify/functions/delta-vision-pageview', {
  method: 'POST', headers: { origin: 'https://sonnycourt.com', 'user-agent': 'Mozilla/5.0', ...headers }, body,
});
assert.equal((await handler(request())).status, 204);
assert.equal((await handler(request({ cookie: 'cookieConsent=refused', referer: 'https://sonnycourt.com/delta-vision/?email=private', 'x-forwarded-for': '192.0.2.1' }))).status, 204);
await Promise.all(Array.from({ length: 25 }, () => handler(request())));
assert.equal(records.size, 27, 'concurrent increments must not be lost');
assert([...records.values()].every(x => x === '1'));
assert([...records.keys()].every(k => /^2026-10-19T12\/[a-f0-9-]{36}$/.test(k)));
assert.equal((await handler(request({ origin: 'https://evil.example' }))).status, 403);
assert.equal((await handler(request({ 'user-agent': 'facebookexternalhit bot' }))).status, 204);
assert.equal((await handler(request({ purpose: 'prefetch' }))).status, 204);
assert.equal((await handler(request({}, 'email=private'))).status, 400);
assert.equal((await handler(new Request('https://sonnycourt.com/.netlify/functions/delta-vision-pageview'))).status, 405);
assert.equal(records.size, 27);
assert.equal((await makePageviewHandler({ store: () => ({ set: async () => { throw Error('down'); } }) })(request())).status, 503);
assert.equal((await admin(new Request('https://sonnycourt.com/.netlify/functions/admin-delta-vision-pageviews'))).status, 401);
const report = await readPageviews(Date.parse('2026-10-19T12:00:00Z'), Date.parse('2026-10-19T13:00:00Z'), store);
assert.deepEqual(report, { pageviews: 27, hours: [{ hour: '2026-10-19T12:00:00Z', count: 27 }] });
assert.equal((await readPageviews(Date.parse('2026-10-19T13:00:00Z'), Date.parse('2026-10-19T14:00:00Z'), store)).pageviews, 0);
records.set('2026-01-01T00/old', '1');
await prunePageviews(now, store);
assert.deepEqual(removed, ['2026-01-01T00/old']);
assert.equal(records.size, 27);

function browser({ hostname = 'sonnycourt.com', hidden = false, webdriver = false, hash = '' } = {}) {
  const calls = [], listeners = new Map();
  const doc = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k) };
  const win = { location: { hostname, pathname: '/delta-vision/', hash }, navigator: { webdriver }, fetch: async (...args) => { calls.push(args); } };
  for (const obj of [doc, win]) for (const key of ['cookie', 'localStorage', 'sessionStorage']) Object.defineProperty(obj, key, { get() { throw Error('Storage must never be read'); } });
  return { doc, win, calls, listeners };
}
const b = browser(); initDeltaPageviews(b.doc, b.win); initDeltaPageviews(b.doc, b.win);
assert.equal(b.calls.length, 1);
assert.deepEqual(b.calls[0][1], { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'text/plain' }, body: 'view', keepalive: true });
const hidden = browser({ hidden: true }); initDeltaPageviews(hidden.doc, hidden.win); assert.equal(hidden.calls.length, 0);
hidden.doc.visibilityState = 'visible'; hidden.listeners.get('visibilitychange')(); assert.equal(hidden.calls.length, 1);
for (const options of [{ hostname: 'localhost' }, { hostname: 'preview.netlify.app' }, { webdriver: true }, { hash: '#gift=secret' }]) {
  const b = browser(options); initDeltaPageviews(b.doc, b.win); assert.equal(b.calls.length, 0);
}
const failing = browser(); failing.win.fetch = () => { throw Error('offline'); }; initDeltaPageviews(failing.doc, failing.win);
const page = readFileSync(new URL('../src/pages/delta-vision.astro', import.meta.url), 'utf8');
assert(page.includes('initDeltaPageviews()'));
assert(page.includes('initDeltaAnalytics()'), 'existing consent-based analytics remains');
console.log('PASS: no storage/identity, consent-independent single count, concurrent writes, auth, report, retention, bots, errors and previews');
