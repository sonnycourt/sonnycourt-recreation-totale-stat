import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import handler, { seal, WHATSAPP_URL } from '../netlify/functions/mc2-whatsapp.js';

process.env.SUPABASE_URL = 'https://database.example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-secret';
const token = '00000000-0000-4000-8000-000000000001';
const base = 'https://sonnycourt.com/.netlify/functions/mc2-whatsapp';
let status = 'purchased';
let fail = false;
let writes = [];
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).startsWith(process.env.SUPABASE_URL));
  assert.ok(options.signal, 'Every database request has a deadline');
  if (fail) throw new Error('Database offline');
  if (options.method === 'GET') return Response.json([{ statut: status }]);
  assert.equal(String(url), `${process.env.SUPABASE_URL}/rest/v1/mc2_funnel_events`);
  assert.equal(options.method, 'POST', 'No mutation of registration/onboarding');
  const body = JSON.parse(options.body);
  const duplicate = writes.some((row) => row.dedupe_key === body.dedupe_key);
  if (!duplicate) writes.push(body);
  return new Response(null, { status: duplicate ? 409 : 201 });
};
const post = (action, extra = {}) => handler(new Request(base, { method: 'POST', headers: { origin: 'https://sonnycourt.com', ...extra }, body: JSON.stringify({ token, action }) }));

const prepared = await post('prepare');
assert.equal(prepared.status, 200);
const { qr } = await prepared.json();
assert.ok(Buffer.from(qr.split(',')[1], 'base64').toString().includes('<svg'));
assert.equal(writes.length, 0, 'Displaying QR does not count as opening it');
assert.equal((await post('button_clicked')).status, 200);
assert.equal((await post('button_clicked')).status, 200);
assert.equal(writes.length, 1);
assert.equal(writes[0].event_name, 'success_whatsapp_button_clicked');
assert.equal(writes[0].metadata.message_sent_confirmed, false);
const reference = seal(token);
assert.ok(!reference.includes(token));
const redirect = await handler(new Request(`${base}?r=${reference}`));
assert.equal(redirect.status, 302);
assert.equal(redirect.headers.get('location'), WHATSAPP_URL);
assert.equal(redirect.headers.get('referrer-policy'), 'no-referrer');
assert.equal(writes[1].token, token);
assert.equal(writes[1].event_name, 'success_whatsapp_qr_opened');
writes = [];
for (const init of [{ method: 'HEAD' }, { headers: { purpose: 'prefetch' } }, { headers: { 'user-agent': 'Googlebot' } }]) {
  assert.equal((await handler(new Request(`${base}?r=${reference}`, init))).status, 302);
}
assert.equal(writes.length, 0);
await handler(new Request(`${base}?r=${reference.slice(0, 40)}tampered`));
assert.equal(writes.length, 0, 'Tampered references cannot write');
const originalNow = Date.now;
Date.now = () => originalNow() + 31 * 86400000;
await handler(new Request(`${base}?r=${reference}`));
Date.now = originalNow;
assert.equal(writes.length, 0, 'Expired references cannot write');
status = 'registered';
assert.equal((await post('prepare')).status, 404);
assert.equal((await post('button_clicked')).status, 404);
assert.equal((await post('prepare', { origin: 'https://other.invalid' })).status, 403);
fail = true;
assert.equal((await handler(new Request(`${base}?r=${reference}`))).headers.get('location'), WHATSAPP_URL);
assert.equal((await post('prepare')).status, 503);

const source = (await readFile(new URL('../src/scripts/success-whatsapp.js', import.meta.url), 'utf8')).replace('export function', 'function');
async function frontend({ blocked = false, preview = false, noIdentity = false } = {}) {
  const listeners = {};
  const calls = [];
  const image = { src: '/original.svg' };
  const context = {
    URLSearchParams,
    location: { search: preview ? '?preview=dev' : '', hash: noIdentity ? '' : `#mc2_whatsapp=${token}` },
    sessionStorage: { setItem() {}, getItem() { return ''; } },
    localStorage: { getItem() { return ''; } },
    document: { getElementById(id) { return id === 'coach-whatsapp' ? { addEventListener(name, fn) { listeners[name] = fn; } } : image; } },
    Image: class { set src(value) { this.onload(); } },
    fetch: async (url, options) => {
      calls.push(JSON.parse(options.body));
      if (blocked) throw new Error('Offline');
      return { ok: true, json: async () => ({ qr: 'data:image/svg+xml;base64,test' }) };
    },
  };
  vm.runInNewContext(source + '\ninitSuccessWhatsApp();', context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  listeners.click?.({ preventDefault() { throw new Error('Must not intercept click'); } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { calls, image };
}
assert.deepEqual((await frontend()).calls.map((call) => call.action), ['prepare', 'button_clicked']);
assert.equal((await frontend({ blocked: true })).image.src, '/original.svg');
assert.equal((await frontend({ preview: true })).calls.length, 0);
assert.equal((await frontend({ noIdentity: true })).calls.length, 0);
console.log('WhatsApp: attribution, deduplication, QR, isolation, preview, and failure fallback OK');
