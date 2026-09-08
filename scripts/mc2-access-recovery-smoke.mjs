import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import requestAccess from '../netlify/functions/request-mc2-access.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const gateSource = read('../src/components/Mc2AccessGate.astro');
const gateScript = gateSource.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const sessionSource = read('../src/pages/mc2/session.astro');
assert.match(gateSource, /ACCÉDER À MA MASTERCLASS/);
assert.doesNotMatch(gateSource, /RECEVOIR MON LIEN|requestLink|is-sent/);
assert.match(sessionSource, /const token = await window\.__MC2_ACCESS__\.resolve\(\)/,
  'La session doit utiliser le token récupéré, pas un ancien paramètre URL invalide.');

const originalFetch = globalThis.fetch;
const previousUrl = process.env.SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
let calls = [];
let scenario = { rows: [{ token: 'fixture-token' }] };
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://supabase.test', 'Aucun appel email ou service externe.');
  assert.equal(options.method || 'GET', 'GET', 'Aucune écriture Supabase.');
  assert.equal(url.pathname, '/rest/v1/mc2_registrations');
  assert.equal(url.searchParams.get('select'), 'token', 'Ne renvoyer aucune donnée de profil.');
  assert.equal(url.searchParams.get('order'), 'registered_at.desc');
  assert.equal(url.searchParams.get('limit'), '1');
  calls.push(url);
  if (scenario.throws) throw new Error('network unavailable');
  return Response.json(scenario.rows ?? [], { status: scenario.status || 200 });
};
async function lookup(body, method = 'POST') {
  const response = await requestAccess(new Request('https://sonnycourt.test/.netlify/functions/request-mc2-access', {
    method,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, data: await response.json() };
}
try {
  assert.equal((await lookup(null, 'GET')).status, 405);
  assert.equal((await lookup(null, 'OPTIONS')).status, 200);
  for (const invalid of [{}, { email: 'not-an-email' }, '{']) {
    assert.equal((await lookup(invalid)).status, 400);
  }
  assert.equal(calls.length, 0);
  for (const page_path of ['/mc2/session/', '/mc2/confirmation/', '/commencer/', '/offre/']) {
    const result = await lookup({ email: '  PERSON+test@EXAMPLE.COM  ', page_path });
    assert.equal(result.status, 200);
    assert.equal(result.data.token, 'fixture-token');
    assert.equal(calls.at(-1).searchParams.get('email'), 'eq.person+test@example.com');
    assert.doesNotMatch(result.data.message, /envoyé/);
  }
  scenario = { rows: [] };
  assert.equal((await lookup({ email: 'unknown@example.com' })).status, 404);
  scenario = { rows: [{ token: '' }] };
  assert.equal((await lookup({ email: 'unknown@example.com' })).status, 404);
  scenario = { status: 500 };
  assert.equal((await lookup({ email: 'person@example.com' })).status, 503);
  scenario = { throws: true };
  assert.equal((await lookup({ email: 'person@example.com' })).status, 503);
} finally {
  globalThis.fetch = originalFetch;
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
}

// Execute the actual inline gate code; all I/O is stubbed (no customer traffic).
const tick = () => new Promise((resolve) => setImmediate(resolve));
function createGate({ path = '/mc2/session/', query = '', stored = '', blockedStorage = false } = {}) {
  const storage = new Map(stored ? [['mc2_registration_token', stored]] : []);
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        hidden: id === 'mc2-access-gate', disabled: false, value: '', textContent: '',
        dataset: { pagePath: path }, listeners: {}, focus() {},
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
        addEventListener(name, fn) { this.listeners[name] = fn; },
      });
    }
    return elements.get(id);
  }
  const document = { cookie: '', getElementById: element, documentElement: element('html') };
  const location = new URL(`https://sonnycourt.test${path}${query}#offer`);
  const localStorage = {
    getItem: (key) => { if (blockedStorage) throw new Error('storage disabled'); return storage.get(key) || null; },
    setItem: (key, value) => { if (blockedStorage) throw new Error('storage disabled'); storage.set(key, value); },
    removeItem: (key) => storage.delete(key),
  };
  let lookupResponse = { status: 200, data: { ok: true, token: 'recovered-token' } };
  let valid = new Set(['recovered-token', 'valid-token']);
  const requests = [];
  const window = { location, setTimeout: (fn) => { fn(); }, history: {
    replaceState: (_state, _title, relative) => { location.href = new URL(relative, location).href; },
  } };
  const fetch = async (input, options) => {
    requests.push({ input, options });
    if (input.startsWith('/.netlify/functions/get-mc2-registration?t=')) {
      const token = new URL(input, location).searchParams.get('t');
      return Response.json({ valid: valid.has(token) }, { status: valid.has(token) ? 200 : 404 });
    }
    assert.equal(input, '/.netlify/functions/request-mc2-access');
    assert.equal(options.method, 'POST');
    return Response.json(lookupResponse.data, { status: lookupResponse.status });
  };
  vm.runInNewContext(gateScript, { window, document, localStorage, URL, URLSearchParams, fetch });
  return { element, document, window, requests, storage,
    setResponse: (value) => { lookupResponse = value; },
    rejectValidation: () => { valid = new Set(); },
    async submit(email) { element('mc2-access-email').value = email; await element('mc2-access-form').listeners.submit({ preventDefault() {} }); },
  };
}

for (const path of ['/mc2/session/', '/mc2/confirmation/', '/commencer/']) {
  const ui = createGate({ path, query: '?t=invalid-token&source=test', stored: 'invalid-token' });
  const result = ui.window.__MC2_ACCESS__.resolve();
  await tick();
  assert.equal(ui.element('mc2-access-gate').hidden, false);
  assert.equal(ui.document.documentElement.classList.contains('mc2-access-locked'), true);
  await ui.submit('invalid');
  assert.equal(ui.requests.filter((r) => r.options?.method === 'POST').length, 0);
  ui.setResponse({ status: 404, data: { error: 'Aucune inscription trouvée avec cet email.' } });
  await ui.submit('unknown@example.com');
  assert.equal(ui.element('mc2-access-submit').disabled, false);
  assert.match(ui.element('mc2-access-error').textContent, /Aucune inscription/);
  ui.setResponse({ status: 200, data: { ok: true, token: 'recovered-token' } });
  await ui.submit(' Person@example.com ');
  assert.equal(await result, 'recovered-token', 'La page reprend après la récupération, sans rester en attente.');
  assert.equal(ui.element('mc2-access-gate').hidden, true);
  assert.equal(ui.document.documentElement.classList.contains('mc2-access-locked'), false);
  assert.equal(ui.window.location.pathname, path);
  assert.equal(ui.window.location.searchParams.get('t'), 'recovered-token');
  assert.equal(ui.window.location.searchParams.get('source'), 'test');
  assert.equal(ui.window.location.hash, '#offer');
  assert.equal(ui.storage.get('mc2_registration_token'), 'recovered-token');
  assert.equal(await ui.window.__MC2_ACCESS__.resolve(), 'recovered-token');
}
for (const initial of [{ query: '?t=valid-token' }, { stored: 'valid-token' }]) {
  const ui = createGate(initial);
  assert.equal(await ui.window.__MC2_ACCESS__.resolve(), 'valid-token');
  assert.equal(ui.element('mc2-access-gate').hidden, true);
  assert.equal(ui.requests.length, 1, 'Un lien valide ne déclenche aucune récupération par email.');
}
const blockedStorage = createGate({ blockedStorage: true });
const storageResult = blockedStorage.window.__MC2_ACCESS__.resolve();
await tick();
await blockedStorage.submit('person@example.com');
assert.equal(await storageResult, 'recovered-token');
assert.equal(blockedStorage.window.location.searchParams.get('t'), 'recovered-token');

const invalidRecovery = createGate();
void invalidRecovery.window.__MC2_ACCESS__.resolve();
await tick();
invalidRecovery.rejectValidation();
await invalidRecovery.submit('person@example.com');
assert.equal(invalidRecovery.element('mc2-access-gate').hidden, false);
assert.equal(invalidRecovery.element('mc2-access-submit').disabled, false);
assert.ok(invalidRecovery.element('mc2-access-error').textContent);

console.log('MC2 direct access: read-only lookup, no email, recover/retry, URL/storage, valid access and validation guards passed.');
