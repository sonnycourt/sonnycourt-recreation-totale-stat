import assert from 'node:assert/strict';
import handler from '../netlify/functions/spiffy-purchase-webhook.js';
import { mc2OrderReference, readMc2SpiffyIdentity } from '../netlify/functions/lib/mc2-spiffy-identity.mjs';

const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const field = value => ({ field_id: 'account_3340', field_type: 'text', field_name: 'mc2_token', value });
assert.deepEqual(mc2OrderReference({ fields: [field(token)] }), { state: 'valid', token });
assert.equal(mc2OrderReference({ mc2_token: token, fields: [field(token)] }).state, 'valid');
assert.equal(mc2OrderReference({ mc2_token: token, fields: [field(other)] }).state, 'conflict');
assert.equal(mc2OrderReference({ mc2_token: { value: token } }).state, 'invalid');
assert.equal(mc2OrderReference({ mc2_token: 'bad', metadata: { mc2_token: token } }).state, 'invalid');
assert.equal(mc2OrderReference({ customer: { fields: [field(token)] } }).state, 'absent');
assert.equal(mc2OrderReference({ telephone: token, name_first: token }).state, 'absent');
assert.equal(mc2OrderReference({ fields: [field(null)] }).state, 'absent');
assert.equal((await readMc2SpiffyIdentity({ orderId: 'bad' }, { env: {} })).state, 'invalid');
assert.equal((await readMc2SpiffyIdentity({ orderId: 900001 }, { env: {} })).state, 'unavailable');

const savedFetch = globalThis.fetch;
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SPIFFY_SIGNING_SECRET', 'SPIFFY_ONBOARDING_API_KEY', 'MAILERLITE_API_KEY'];
const savedEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
Object.assign(process.env, { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'unit-only', SPIFFY_ONBOARDING_API_KEY: 'unit-only' });
delete process.env.SPIFFY_SIGNING_SECRET;
delete process.env.MAILERLITE_API_KEY;
let writes, reads, order, registration, purchaseEvents, apiStatus, duplicateEmail, lookupStatus, insertCollision;
function reset() {
  writes = []; reads = []; purchaseEvents = []; apiStatus = 200; lookupStatus = 200; duplicateEmail = false; insertCollision = false;
  registration = { token, email: 'optin@example.invalid', prenom: 'Test', traffic_source: null, payment_status: 'pending', statut: 'registered' };
  order = { id: 900001, checkout: { id: 40006 }, customer: { email: 'achat@example.invalid' }, payment_status: 'succeeded', fields: [field(token)] };
}
const payload = () => ({ type: 'order:success', api_version: 'v2', data: { object: {
  // Real v2 shape: display_total, no order_total, no fields in the webhook.
  id: 900001, checkout: { id: 40006 }, customer: { email: 'achat@example.invalid' },
  display_total: 236400, payment_status: 'succeeded', preserved_params: {}, detail: { due_today: 19700 },
} } });
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url), method = options.method || 'GET';
  if (u.origin === 'https://api.spiffy.co') {
    assert.equal(method, 'GET', 'Never mutate a payment');
    assert.equal(u.pathname, '/v2/orders/900001');
    assert.equal(u.searchParams.get('include'), 'fields,customer,checkout');
    reads.push('spiffy');
    return Response.json({ data: order }, { status: apiStatus });
  }
  assert.equal(u.origin, 'https://supabase.test', 'No real network or communications allowed');
  const table = u.pathname.split('/').pop();
  if (method === 'GET') {
    reads.push(table);
    if (table === 'mc2_registrations') {
      if (lookupStatus !== 200) return Response.json({}, { status: lookupStatus });
      const match = u.searchParams.get('token') === `eq.${token}` || u.searchParams.get('email') === `eq.${registration.email}`;
      return Response.json(match ? duplicateEmail ? [registration, { ...registration, token: other }] : [registration] : []);
    }
    if (table === 'mc2_funnel_events') return Response.json(purchaseEvents);
    return Response.json([]);
  }
  const body = JSON.parse(options.body);
  writes.push({ table, method, body });
  if (table === 'mc2_funnel_events') {
    if (insertCollision) { purchaseEvents = [{ token: other }]; return Response.json({}, { status: 409 }); }
    if (purchaseEvents.length) return Response.json({}, { status: 409 });
    purchaseEvents.push(body);
  }
  if (table === 'mc2_registrations' && method === 'PATCH') Object.assign(registration, body);
  return Response.json([]);
};
const run = async (body = payload()) => {
  const response = await handler(new Request('https://unit.invalid/webhook', { method: 'POST', body: JSON.stringify(body) }));
  return { status: response.status, ...await response.json() };
};
const noWrites = () => assert.equal(writes.length, 0, 'Uncertain association must have no database or messaging side effects');
try {
  reset();
  assert.equal((await run()).type, 'sale');
  assert.equal(registration.email, 'optin@example.invalid');
  assert.equal(registration.payment_status, 'paid');
  assert.equal(registration.initial_payment_cents, 19700);
  assert.equal(registration.contractual_total_cents, 236400);
  assert.equal(purchaseEvents[0].metadata.purchase_email, 'achat@example.invalid');
  assert.equal(purchaseEvents[0].metadata.identity_source, 'spiffy_order_fields');
  assert.equal((await run()).type, 'sale');
  assert.equal(purchaseEvents.length, 1, 'Duplicate notification does not duplicate a sale');

  reset(); order.checkout.id = 40007;
  const once = payload(); once.data.object.checkout.id = 40007; once.data.object.display_total = 129700;
  once.data.object.detail.due_today = 129700;
  assert.equal((await run(once)).type, 'sale');
  assert.equal(registration.initial_payment_cents, 129700);
  assert.equal(registration.checkout_last_payment_mode, 'spiffy_one_time_1297');

  for (const mutate of [
    () => { order.id = 900002; },
    () => { order.checkout.id = 40007; },
    () => { order.customer.email = 'another@example.invalid'; },
    () => { order.payment_status = 'pending'; },
    () => { order.fields = [field(token), field(other)]; },
    () => { order.fields = [field('bad')]; },
    () => { order.fields = [field(other)]; },
    () => { purchaseEvents = [{ token: other }]; },
  ]) { reset(); mutate(); assert.ok((await run()).skipped); noWrites(); }

  reset(); apiStatus = 503; assert.equal((await run()).status, 503); noWrites();
  reset(); delete order.fields; assert.equal((await run()).status, 503); noWrites();
  reset(); lookupStatus = 503; assert.equal((await run()).status, 503); noWrites();
  reset(); delete process.env.SPIFFY_ONBOARDING_API_KEY;
  assert.equal((await run()).status, 503); noWrites(); process.env.SPIFFY_ONBOARDING_API_KEY = 'unit-only';
  reset(); order.fields = []; assert.equal((await run()).skipped, 'lead_not_found'); noWrites();
  reset(); order.fields = []; registration.email = order.customer.email;
  assert.equal((await run()).type, 'sale', 'Existing unique exact-email association still works');
  reset(); order.fields = []; registration.email = order.customer.email; duplicateEmail = true;
  assert.equal((await run()).skipped, 'purchase_identity_ambiguous'); noWrites();

  reset(); const conflict = payload(); conflict.data.object.mc2_token = token; conflict.data.object.fields = [field(other)];
  assert.equal((await run(conflict)).skipped, 'purchase_identity_conflict'); noWrites(); assert.equal(reads.length, 0);
  reset(); insertCollision = true;
  assert.equal((await run()).skipped, 'purchase_order_already_linked');
  assert.equal(registration.payment_status, 'pending', 'A concurrent order claim must not mark another person paid');
  assert.ok(writes.every(item => item.table === 'mc2_funnel_events'), 'No downstream side effects on a concurrent identity conflict');
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log('MC2 Spiffy order identity: parser, native fields, changed email, ambiguity, retries and historical fallback OK');
