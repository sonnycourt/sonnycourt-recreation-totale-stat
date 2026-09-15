import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { hasMc2LiveParticipation, createMc2LiveParticipation } from '../src/lib/mc2-live-participation.mjs';

// Run the actual page bootstrap with fake MC2 responses. No service or customer writes.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read(process.env.MC2_SESSION_TEST_PAGE || 'src/pages/mc2/draftx.astro');
const sandbox = read('src/components/mc2/DraftXSandbox.astro').match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
function isolate(href) {
  let nativeCalls = 0;
  let updatedUrl;
  const context = {
    URL, URLSearchParams, Request, Response, Map, navigator: {},
    location: new URL(href), history: { replaceState: (_, __, value) => { updatedUrl = value; } },
    document: { addEventListener() {} },
    window: { fetch: async () => { nativeCalls++; return new Response('{}'); } },
  };
  runInNewContext(sandbox, context);
  return { context, updatedUrl, nativeCalls: () => nativeCalls };
}
for (const key of ['t', 'token', 'access']) {
  const real = isolate(`http://localhost:4342/mc2/draftx/?${key}=mc2-unit-only-1234567890&preview=dev&state=cta-active&checkout=1`);
  assert.equal(real.context.window.__mc2DraftX, undefined, 'A personal link always exits demo mode');
  const params = new URL(real.updatedUrl, 'http://localhost').searchParams;
  assert.equal(params.get(key), 'mc2-unit-only-1234567890');
  assert.equal(params.get('preview'), null);
  assert.equal(params.get('state'), null);
  assert.equal(params.get('checkout'), null);
}
assert.equal(isolate('http://localhost:4342/mc2/draftx/').context.window.__mc2DraftX, undefined);
const demo = isolate('http://localhost:4342/mc2/draftx/?preview=dev');
assert.ok(demo.context.window.__mc2DraftX);
assert.equal(demo.context.window.__mc2DraftX.storage.getItem('mc2_registration_token'), null);
await demo.context.window.fetch('/.netlify/functions/track-mc2-event', { method: 'POST' });
assert.equal(demo.nativeCalls(), 0, 'Demo cannot write to the real MC2 services');

const functionSource = name => {
  const match = page.match(new RegExp(`        (?:async )?function ${name}\\([^]*?\\n        \\}`));
  assert.ok(match, name + ' exists');
  return match[0];
};
const now = Date.parse('2026-09-14T12:00:00Z');
const token = 'mc2-unit-only-1234567890';
const iso = delta => new Date(now + delta).toISOString();
const defaultData = { valid: true, sessionStartsAt: iso(-10 * 60000), prenom: 'Léa', email: 'lea@example.invalid', statut: 'inscrit' };
async function initialize({ data = {}, resolvedToken = token, ok = true, preview = false, fetchError = false, storage = new Map() } = {}) {
  const calls = [];
  const context = {
    URLSearchParams, Date: class extends Date { static now() { return now; } },
    isDraftPreview: preview, OFFER_DURATION_MS: 72 * 3600000, LIVE_VIDEO_LEAD_MS: 5000, LATE_DIRECT_AFTER_SESSION_MS: 20 * 60000,
    VIDEO_DURATION_FALLBACK_SECONDS: 7920, getNowMs: () => now, hasMc2LiveParticipation,
    pageStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    window: { location: { search: '?state=cta-active' }, __MC2_ACCESS__: { resolve: async () => { calls.push(['resolve']); return resolvedToken; } } },
    document: { querySelector: () => ({ removeAttribute() {} }) },
    initDevBanner: () => calls.push(['preview']),
    fetchActiveVideoSourceConfig: async () => calls.push(['video-config']), setupRecoveryForm() {},
    fetch: async url => { calls.push(['fetch', url]); if (fetchError) throw new Error('offline'); return { ok, json: async () => ({ ...defaultData, ...data }) }; },
    setTokenEverywhere: value => calls.push(['token', value]),
    trackWebinaireEvent: (value, event) => calls.push(['tracking', value, event]),
    showScreen: value => calls.push(['screen', value]),
    showSiteOverload: () => calls.push(['expired']), showBuyerBlocked: () => calls.push(['buyer']),
    showBlocked: title => calls.push(['error', title]),
    maybeMarkPresent: async reg => calls.push(['presence', reg.token]),
    mountVideoAndOffer: reg => calls.push(['mount', reg]),
  };
  const localParticipation = page.includes('function hasLocalLiveParticipation(') ? functionSource('hasLocalLiveParticipation') : '';
  await runInNewContext(`${localParticipation}\n${functionSource('normalizeReg')}\n${functionSource('isBuyer')}\n${functionSource('initializeSessionPage')}\ninitializeSessionPage()`, context);
  return { calls, late: context.window.__mcSessionForceLateOverlay };
}
const has = (result, name) => result.calls.some(call => call[0] === name);
assert.deepEqual((await initialize({ preview: true })).calls, [['preview']], 'Demo never resolves a real stored token');
assert.equal(has(await initialize({ resolvedToken: '' }), 'fetch'), false);
for (const options of [{ ok: false }, { data: { valid: false } }, { data: { sessionStartsAt: null } }]) {
  const result = await initialize(options);
  assert.equal(has(result, 'mount'), false);
  assert.ok(result.calls.some(call => call[1] === 'screen-recovery'));
}
for (const statut of ['paid', 'purchased', 'acheteur']) {
  const result = await initialize({ data: { statut } });
  assert.ok(has(result, 'buyer')); assert.equal(has(result, 'mount'), false);
}
assert.ok(has(await initialize({ data: { purchased: true } }), 'buyer'));
assert.ok(has(await initialize({ data: { statut: 'expired' } }), 'expired'));
assert.ok(has(await initialize({ fetchError: true }), 'error'));
assert.ok(has(await initialize({ data: { sessionStartsAt: 'invalid' } }), 'error'));
const future = await initialize({ data: { sessionStartsAt: iso(3600000) } });
assert.equal(has(future, 'presence'), false);
assert.equal(future.late, false);
const live = await initialize();
assert.ok(has(live, 'presence'));
assert.equal(live.calls.find(call => call[0] === 'mount')[1].token, token);
assert.equal(live.calls.find(call => call[0] === 'mount')[1].email, 'lea@example.invalid');
assert.equal((await initialize({ data: { sessionStartsAt: iso(-3600000) } })).late, true);
assert.equal((await initialize({ data: { sessionStartsAt: iso(-3600000), attended_live: true } })).late, false);
assert.equal((await initialize({ data: { sessionStartsAt: iso(-3600000), saw_offer: true, offreExpiresAt: iso(86400000) } })).late, false);
if (page.includes('function hasLocalLiveParticipation(')) {
  const storage = new Map();
  const controller = createMc2LiveParticipation({
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    token, sessionStartMs: now - 3600000, now: () => now - 3500000,
    send: async () => ({ ok: true }),
  });
  controller.confirmJoin();
  const refreshed = await initialize({ data: { sessionStartsAt: iso(-3600000) }, storage });
  assert.equal(refreshed.late, false, 'Local join-click marker protects a refresh before server acknowledgement');
  const reg = refreshed.calls.find(call => call[0] === 'mount')[1];
  assert.equal(reg.attendedLive, true);
  assert.equal(reg.serverAttendedLive, false, 'Server repair remains necessary');
  assert.equal((await initialize({ data: { sessionStartsAt: iso(-3700000) }, storage })).late, true, 'A marker from another scheduled session is ignored');
  for (const data of [{ purchased: true }, { statut: 'expired' }, { valid: false }]) {
    assert.equal(has(await initialize({ data, storage }), 'mount'), false, 'Local marker cannot override server access controls');
  }
  controller.destroy();
}
assert.match(page, /<Mc2AccessGate pagePath=/);
assert.match(page, /checkoutAvailable = String\(isEnabled\)/);
assert.match(page, /registrationToken: isDraftPreview \? '' : reg.token/);
console.log('PASS — vrai token prioritaire, aperçu isolé, avant/en cours/retard/offre conservée/acheteur/expiré/invalide. Aucun service réel appelé.');
