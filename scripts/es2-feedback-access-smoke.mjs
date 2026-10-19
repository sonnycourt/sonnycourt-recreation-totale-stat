// Offline only: all reads, inserts and notifications are intercepted before import.
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://feedback-db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
process.env.TELEGRAM_BOT_TOKEN = 'fixture-only';
process.env.TELEGRAM_CHAT_ID = 'fixture-only';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
let rows, calls, writes, notifications, failure;
const legacy = { token: 'old-token', email: 'buyer@example.invalid', prenom: 'Legacy', purchased: true, refunded_at: null };
const mc2 = { token: 'new-token', email: 'buyer@example.invalid', prenom: 'MC2', payment_status: 'paid' };
function reset(old = [], modern = []) {
  rows = { webinaire_registrations: old, mc2_registrations: modern };
  calls = []; writes = []; notifications = []; failure = null;
}
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.telegram.org') { notifications.push(options); return json({ ok: true }); }
  assert.equal(u.hostname, 'feedback-db.test', 'No real network allowed');
  const table = u.pathname.split('/').pop();
  calls.push([table, options.method || 'GET']);
  if (options.method) {
    assert.equal(options.method, 'POST'); assert.equal(table, 'es2_feedback');
    writes.push(JSON.parse(options.body)); return new Response(null, { status: 201 });
  }
  if (failure === table) return json({ message: 'fixture unavailable' }, 503);
  if (table === 'webinaire_registrations' && u.searchParams.get('select').includes('es_purchased')) {
    return json({ code: '42703', message: 'column es_purchased does not exist' }, 400);
  }
  const token = u.searchParams.get('token')?.slice(3);
  const email = u.searchParams.get('email')?.slice(6).replace(/\\(.)/g, '$1');
  return json(rows[table].filter(r => token ? r.token === token : r.email.toLowerCase() === email));
};
const { default: access } = await import('../netlify/functions/get-es2-feedback-access.js');
const { default: submit } = await import('../netlify/functions/submit-es2-feedback.js');
const { resolveEs2FeedbackRegistration } = await import('../netlify/functions/lib/es2-feedback-access.mjs');
const gate = async query => access(new Request('https://fixture.invalid/access?' + new URLSearchParams(query)));
const payload = token => ({ token, module_reached: 'Module 1', daily_practice: 'Chaque jour', what_changed: 'Calme', biggest_win: '', what_blocks: 'Doute', help_needed: 'Conseils', score: 7, email: 'spoof@example.invalid', prenom: 'Spoof' });
const post = token => submit(new Request('https://fixture.invalid/submit', { method: 'POST', body: JSON.stringify(payload(token)) }));

// Exact regression: paid MC2 account, no legacy row. Gate and submission agree.
reset([], [mc2]);
let response = await gate({ email: '  BUYER@EXAMPLE.INVALID  ' });
assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
let identity = await response.json(); assert.equal(identity.token, mc2.token); assert.equal(identity.prenom, 'MC2');
assert.equal(writes.length, 0); assert.equal(notifications.length, 0);
assert.equal((await post(identity.token)).status, 200);
assert.equal(writes.length, 1); assert.equal(writes[0].token, mc2.token); assert.equal(writes[0].email, mc2.email);
assert.equal(writes[0].prenom, 'MC2'); assert.equal(notifications.length, 1);

// Existing paid legacy users keep their token and existing storage contract.
reset([legacy]); assert.equal((await gate({ t: legacy.token })).status, 200);
assert.equal((await post(legacy.token)).status, 200); assert.equal(writes[0].token, legacy.token);
assert(!calls.some(([table]) => table === 'mc2_registrations'));

// Old prospect rows/links must not hide a verified MC2 purchase.
for (const query of [{ email: legacy.email }, { t: legacy.token }, { token: legacy.token }]) {
  reset([{ ...legacy, purchased: false }], [mc2]);
  identity = await (await gate(query)).json(); assert.equal(identity.allowed, true); assert.equal(identity.token, mc2.token);
  assert.equal((await post(legacy.token)).status, 200); assert.equal(writes[0].token, mc2.token);
}

// Nonbuyers / failed / refunded MC2 accounts never gain access from purchased_at alone.
for (const status of [null, 'pending', 'unpaid', 'failed', 'refunded', 'disputed', 'chargeback']) {
  reset([], [{ ...mc2, payment_status: status, purchased_at: '2026-10-03T00:00:00Z' }]);
  assert.equal((await gate({ email: mc2.email })).status, 403, String(status));
  assert.equal((await post(mc2.token)).status, 403); assert.equal(writes.length, 0); assert.equal(notifications.length, 0);
}
reset([{ ...legacy, refunded_at: '2026-10-04T00:00:00Z' }]);
assert.equal((await gate({ email: legacy.email })).status, 403);
reset(); assert.equal((await gate({ email: mc2.email })).status, 404);
assert.equal((await post(mc2.token)).status, 404); assert.equal(notifications.length, 0);

// Token takes precedence: attaching a real buyer email to an unknown token cannot bypass access.
reset([], [mc2]); assert.equal((await gate({ token: 'unknown', email: mc2.email })).status, 404);
reset([], [mc2]); failure = 'mc2_registrations'; assert.equal((await gate({ email: mc2.email })).status, 500);
assert.equal((await post(mc2.token)).status, 500); assert.equal(writes.length, 0);
reset([legacy]); failure = 'webinaire_registrations'; assert.equal((await gate({ email: legacy.email })).status, 500);
assert.equal(writes.length, 0);

// Mixed-case stored addresses and duplicate legacy casing; returned identity is canonical.
reset([{ ...legacy, email: 'BUYER@example.invalid', purchased: false }, legacy]);
assert.equal((await gate({ email: mc2.email })).status, 200);
reset([], [{ ...mc2, email: 'Buyer@Example.Invalid' }]); assert.equal((await gate({ email: mc2.email })).status, 200);
// A broad or malicious lookup result is never trusted without an exact identity match.
let result = await resolveEs2FeedbackRegistration({ email: '*@example.invalid' }, { get: async () => ({ ok: true, data: [legacy, mc2] }) });
assert.deepEqual(result.data, []);
result = await resolveEs2FeedbackRegistration({ token: 'unknown' }, { get: async () => ({ ok: true, data: [legacy, mc2] }) });
assert.deepEqual(result.data, []);
console.log('PASS: MC2 + legacy, both endpoints, old links, case normalization, payment denial, no account writes, canonical identity, error handling. All network mocked.');
