import assert from 'node:assert/strict';
import { getExampleNumber } from 'libphonenumber-js/max';
import examples from 'libphonenumber-js/mobile/examples';
import { checkMc2RegistrationPhone as check, MC2_REGISTRATION_COUNTRIES } from '../netlify/functions/lib/mc2-registration-country.mjs';
import endpoint from '../netlify/functions/check-mc2-phone-country.js';
import register from '../netlify/functions/register-mc2.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

assert.deepEqual([...MC2_REGISTRATION_COUNTRIES], ['FR','CH','BE','CA','LU','RE','GP','MQ','GF','PF','NC']);
for (const country of MC2_REGISTRATION_COUNTRIES) {
  const phone = getExampleNumber(country, examples);
  assert.ok(phone, country);
  assert.equal(check(phone.number).eligible, true, `${country}: ${phone.number}`);
}
for (const country of ['MA','DO','CD','GA','BF','CG','TG','US','GB','DE','YT']) {
  assert.equal(check(getExampleNumber(country, examples).number).eligible, false, country);
}
for (const phone of ['', null, '0612345678', '+1', '+80012345678', '+33612345678 ext 12', '+33'.repeat(30)]) {
  assert.equal(check(phone).eligible, false, String(phone));
}
assert.equal(check('+18193290000').country, 'CA');
assert.equal(check('+18097620000').country, 'DO');
assert.equal(check('+18097620000').message, 'Malheureusement, la masterclass n’est plus disponible.');
// Explicitly approved: shared GP/MF/BL mobile numbering remains accepted.
assert.equal(check('+590690001234').eligible, true);

process.env.SUPABASE_URL = 'https://database.example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
delete process.env.MAILERLITE_API_KEY;
delete process.env.META_ACCESS_TOKEN;
let existing = null;
let writes = [];
globalThis.fetch = async (url, init = {}) => {
  assert.ok(String(url).startsWith(process.env.SUPABASE_URL), 'No external messages/payments');
  if (init.method && init.method !== 'GET') {
    writes.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json([]);
  }
  return Response.json(String(url).includes('/mc2_registrations?') && existing ? [existing] : []);
};
const body = {
  email: 'country-test@example.invalid', prenom: 'Test', pays: 'France',
  telephone: getExampleNumber('FR', examples).number,
  session_starts_at: new Date(Math.ceil(Date.now() / 900000) * 900000).toISOString(),
  slot_kind: 'jit', visitor_timezone: 'Europe/Paris',
};
const request = (data) => new Request('https://example.invalid/register', { method: 'POST', body: JSON.stringify(data) });
for (const telephone of [getExampleNumber('GA', examples).number, '', '+18097620000']) {
  writes = [];
  const res = await register(request({ ...body, telephone }));
  assert.ok([400,403].includes(res.status));
  assert.equal(writes.length, telephone ? 1 : 0);
  assert.ok(writes.every(x => x.url.includes('/mc2_challenge_contacts?')), 'Only separate Supabase contact storage; no webinar, messaging or CAPI');
}
writes = [];
process.env.MAILERLITE_API_KEY = 'test-only';
process.env.MAILERLITE_GROUP_MC2_REGISTRATIONS = 'test-group';
const databaseFetch = globalThis.fetch;
const mailerWrites = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://connect.mailerlite.com/api/')) {
    if (init.method === 'GET') return Response.json({}, { status: 404 });
    if (init.method === 'POST' && init.body) mailerWrites.push(JSON.parse(init.body));
    return Response.json({ data: { id: 'mock-subscriber', status: 'active' } });
  }
  return databaseFetch(url, init);
};
const partial = await register(request({ ...body, telephone: undefined, pays: undefined }));
assert.equal(partial.status, 200);
assert.equal((await partial.json()).statut, 'partial');
const captured = writes.find(x => x.url.endsWith('/mc2_registrations'))?.body;
assert.equal(captured.email, body.email);
assert.equal(captured.prenom, body.prenom);
assert.equal(captured.registration_completed_at, null);
assert.equal(captured.telephone, null);
assert.ok(mailerWrites.some(x => x.email === body.email && x.fields.first_name === body.prenom));
assert.ok(!writes.some(x => /sms|email_queue|exclusions/.test(x.url)), 'No full-registration messages for partial capture');
existing = captured;
writes = [];
assert.equal((await register(request(body))).status, 200);
assert.ok(writes.some(x => x.url.includes('/mc2_registrations?') && x.body.statut === 'partial'));
assert.equal(captured.entry_payment_required, true);
assert.ok(!writes.some(x => /sms_queue|session_email_jobs|exclusions/.test(x.url)), 'Unpaid contacts cannot receive session reminders');
assert.ok(!writes.some(x => x.url.endsWith('/mc2_registrations')), 'Completion updates the existing partial row');
existing = { ...captured, entry_payment_required: false };
writes = [];
assert.equal((await register(request(body))).status,200);
assert.ok(writes.some(x => x.url.includes('/mc2_registrations?') && x.body.statut === 'registered'), 'Historical partials retain their original free access');
existing = null;
globalThis.fetch = databaseFetch;
delete process.env.MAILERLITE_API_KEY;
writes = [];
assert.equal((await register(request(body))).status, 200);
assert.ok(writes.some(x => x.url.endsWith('/mc2_registrations') && x.body.statut === 'partial' && x.body.entry_payment_required));
existing = { token: 'existing-token', statut: 'registered', session_starts_at: body.session_starts_at };
writes = [];
assert.equal((await register(request({ ...body, telephone: getExampleNumber('GA', examples).number }))).status, 409);
assert.equal(writes.length, 0, 'Existing registrations unchanged');
globalThis.fetch = () => { throw new Error('Validation endpoint must never call a provider'); };
assert.equal((await (await endpoint(request({ telephone: body.telephone }))).json()).eligible, true);
assert.equal((await (await endpoint(request({ telephone: getExampleNumber('TG', examples).number }))).json()).eligible, false);
const source = await readFile(new URL('../src/pages/mc2/index.astro', import.meta.url), 'utf8');
assert.ok(source.includes('saveStep1Lead'));
assert.ok(source.includes('check-mc2-phone-country'));
const clickHandler = source.match(/document\.getElementById\('step2-next'\)\.addEventListener\('click', async function \(\) \{([\s\S]*?)\n            \}\);/)[1];
for (const scenario of ['allowed', 'blocked', 'offline']) {
  let advanced = 0;
  let redirect = '';
  const button = { disabled: false, textContent: 'Continuer' };
  const message = { textContent: '' };
  const context = {
    document: { getElementById: id => id === 'step2-next' ? button : message },
    state: { phone: body.telephone }, validateContactStep: () => true,
    optinFunnelId: 'example', metaOptin: null,
    window: { location: { replace: value => { redirect = value; } } },
    trackOptinEvent: () => {}, goToCommitStep: () => advanced++, AbortSignal,
    fetch: async () => {
      if (scenario === 'offline') throw new Error('offline');
      return Response.json({ eligible: scenario === 'allowed', reason: scenario === 'blocked' ? 'country_not_available' : 'allowed' });
    },
  };
  await vm.runInNewContext(`(async () => {${clickHandler}})()`, context);
  assert.equal(advanced, scenario === 'allowed' ? 1 : 0);
  assert.equal(button.disabled, false);
  assert.equal(Boolean(message.textContent), scenario === 'offline');
  assert.equal(redirect, scenario === 'blocked' ? '/challenge-transformation-offre/' : '');
}
console.log('Country gate: allowlist, shared prefixes, separate contact storage, redirect, no messaging, eligible registration and existing access OK');
