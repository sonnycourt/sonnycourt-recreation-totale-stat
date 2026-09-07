import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createMc2MetaOptin } from '../src/lib/mc2-optin-meta.mjs';

function environment({ search = '', storage = new Map(), blockedStorage = false, cookies = '' } = {}) {
  const calls = [];
  const listeners = new Map();
  const scripts = [];
  const localStorage = {
    getItem(key) { if (blockedStorage) throw new Error('storage blocked'); return storage.get(key) || null; },
    setItem(key, value) { if (blockedStorage) throw new Error('storage blocked'); storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  const document = {
    cookie: cookies,
    readyState: 'complete',
    querySelector: () => scripts[0] || null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild: (script) => scripts.push(script) },
  };
  const window = {
    location: { search, href: 'https://sonnycourt.com/meta/mc2/' + search },
    localStorage,
    fbq: (...args) => calls.push(args),
    addEventListener: (name, fn) => listeners.set(name, fn),
    requestIdleCallback: (fn) => fn(),
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  };
  return { window, document, calls, scripts, storage, listeners, localStorage };
}

const env = environment({
  search: '?utm_source=facebook&utm_medium=cpc&utm_campaign=watchers&utm_content=creative-1&utm_term=lal&fbclid=current-click',
  cookies: '_fbc=fb.1.100.old-click; _fbp=fb.1.200.browser',
});
const opts = { funnelId: '11111111-2222-4333-8444-555555555555', variant: 'mc2_meta_v5' };
const tracking = createMc2MetaOptin({ ...env, ...opts });
const payload = tracking.getPayload();
assert.equal(payload.traffic_source, 'meta_ad');
assert.equal(payload.utm_campaign, 'watchers');
assert.equal(payload.utm_content, 'creative-1');
assert.equal(payload.utm_term, 'lal');
assert.equal(payload.meta_fbp, 'fb.1.200.browser');
assert.match(payload.meta_fbc, /^fb\.1\.\d+\.current-click$/);
assert.equal(payload.optin_funnel_id, opts.funnelId);
assert.equal(payload.meta_event_id, tracking.getPayload().meta_event_id);
assert.deepEqual(env.calls, [['init', '3367958190030822'], ['track', 'PageView']]);
assert.equal(env.scripts.length, 1);
env.listeners.get('pointerdown')();
env.listeners.get('keydown')();
assert.equal(env.scripts.length, 1, 'one pixel script even after multiple interactions');
createMc2MetaOptin({ ...env, ...opts });
assert.equal(env.calls.length, 2, 'one initialization and PageView per page');

const events = [
  { eventName: 'EmailCaptured', eventId: 'server-email-id' },
  { eventName: 'Lead', eventId: 'server-lead-id' },
];
tracking.fireEvents(events);
tracking.fireEvents(events);
tracking.fireEvents([null, { eventName: 'Lead' }, { eventName: 'Purchase', eventId: 'bad' }]);
assert.deepEqual(env.calls.slice(2).map((call) => [call[0], call[1], call[3].eventID]), [
  ['trackCustom', 'EmailCaptured', 'server-email-id'],
  ['track', 'Lead', 'server-lead-id'],
]);
env.window.fbq = () => { throw new Error('pixel blocked'); };
assert.doesNotThrow(() => tracking.fireEvents([{ eventName: 'Lead', eventId: 'another' }]));

const returning = createMc2MetaOptin({ ...environment({ storage: env.storage }), ...opts, disabled: true });
assert.equal(returning.getPayload().utm_campaign, 'watchers');
assert.equal(returning.getPayload().meta_fbc, payload.meta_fbc);
const expiredStorage = new Map([['meta_tracking_params', JSON.stringify({
  utm_campaign: 'expired', captured_at: Date.now() - 31 * 24 * 3600 * 1000,
})]]);
assert.equal(createMc2MetaOptin({ ...environment({ storage: expiredStorage }), ...opts }).getPayload().utm_campaign, null);
const blocked = createMc2MetaOptin({ ...environment({ search: '?utm_campaign=still-captured', blockedStorage: true }), ...opts });
assert.equal(blocked.getPayload().utm_campaign, 'still-captured');
const preview = environment();
const disabled = createMc2MetaOptin({ ...preview, ...opts, disabled: true });
disabled.fireEvents(events);
assert.equal(preview.calls.length, 0, 'no Meta events in preview/internal mode');
assert.equal(preview.scripts.length, 0);

// Exercise the real shared page's registration code against an in-memory
// backend. No real registrations, email/SMS, CAPI requests or browser actions.
const pageSource = await readFile(new URL('../src/pages/mc2/index.astro', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../src/pages/meta/mc2/index.astro', import.meta.url), 'utf8');
assert.match(wrapper, /import Mc2OptinPage from '\.\.\/\.\.\/mc2\/index\.astro'/);
assert.match(wrapper, /trafficSource="meta_ad" trackingPath="\/meta\/mc2\/"/);
assert.doesNotMatch(wrapper, /Mc2PaidOptinAdapter|MetaMasterclassPage|Mc2ScheduleEnhancer/);
const script = pageSource.match(/<script>\s*\/\/ @ts-nocheck([\s\S]*?)<\/script>/)[1]
  .replace(/import \{ createMc2MetaOptin \} from '[^']+';/, '');

for (const source of ['meta_ad', null]) {
  for (const slot of ['jit', 'fixed-1', 'fixed-2']) {
    const test = environment({ search: '?utm_campaign=watchers&fbclid=click' });
    const requests = [];
    const elements = new Map();
    test.document.documentElement = { dataset: { mc2Source: source, mc2TrackingPath: source ? '/meta/mc2/' : '/mc2/' } };
    test.document.addEventListener = () => {};
    test.document.getElementById = (id) => {
      if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
      return elements.get(id);
    };
    test.window.location.hostname = 'sonnycourt.com';
    const context = vm.createContext({
      window: test.window, document: test.document, localStorage: test.localStorage,
      createMc2MetaOptin, URLSearchParams, URL, Intl, console,
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url, body });
        if (url.endsWith('track-mc2-optin')) return { ok: true };
        return { ok: true, status: 200, json: async () => ({
          success: true, token: 'test-token',
          metaEvents: source ? [{
            eventName: body.telephone ? 'Lead' : 'EmailCaptured',
            eventId: body.telephone ? body.meta_event_id : 'server-email',
          }] : [],
        }) };
      },
    });
    vm.runInContext(script, context);
    vm.runInContext(`
      state.name = 'Test'; state.email = 'test@example.com';
      state.phone = '+33612345678'; state.country = 'France';
      getSelectedMc2Slot = () => ({ id: '${slot}', kind: '${slot === 'jit' ? 'jit' : 'fixed'}', startsAt: new Date('2026-09-08T18:00:00Z') });
    `, context);
    await vm.runInContext('saveStep1Lead()', context);
    await vm.runInContext('submitRegistration()', context);
    const registrations = requests.filter((req) => req.url.endsWith('register-mc2'));
    assert.equal(registrations.length, 2);
    for (const { body } of registrations) {
      assert.equal(body.creneau, slot);
      assert.equal(body.session_starts_at, '2026-09-08T18:00:00.000Z');
      assert.equal(body.slot_kind, slot === 'jit' ? 'jit' : 'fixed');
      assert.ok(body.visitor_timezone);
      assert.equal(body.traffic_source, source || undefined);
      if (source) {
        assert.equal(body.utm_campaign, 'watchers');
        assert.ok(body.meta_event_id);
        assert.equal(body.optin_funnel_id, opts.funnelId);
      }
    }
    assert.equal(registrations[0].body.telephone, undefined, 'partial capture is not a completed registration');
    assert.equal(registrations[1].body.sms_consent, true);
    assert.equal(test.window.location.href, '/mc2/confirmation?t=test-token');
    const completed = requests.find((req) => req.body.event_name === 'registration_completed');
    assert.equal(completed.body.path, source ? '/meta/mc2/' : '/mc2/');
    assert.equal(completed.body.traffic_source, source);
    assert.equal(test.calls.filter((call) => call[1] === 'Lead').length, source ? 1 : 0);
    if (!source) assert.equal(test.calls.length, 0, 'organic MC2 does not initialize Meta');
  }
}

// Optional built-output parity: the routes differ only in attribution data.
if (process.argv.includes('--built')) {
  const readPage = (path) => readFile(new URL('../dist/' + path + '/index.html', import.meta.url), 'utf8');
  const normalize = (html) => html.replace(/ data-mc2-source="meta_ad"/g, '')
    .replace(/data-mc2-tracking-path="\/meta\/mc2\/"/g, 'data-mc2-tracking-path="/mc2/"');
  assert.equal(normalize(await readPage('meta/mc2')), normalize(await readPage('mc2')));
}
console.log('MC2 Meta optin: shared page, 3 slots, attribution, partial/full registration, dedup, preview, organic isolation: OK');
