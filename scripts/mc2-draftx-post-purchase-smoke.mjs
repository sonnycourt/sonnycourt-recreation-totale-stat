import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import webhook from '../netlify/functions/spiffy-purchase-webhook.js';
import status from '../netlify/functions/mc2-spiffy-status.js';
import billing from '../netlify/functions/mc2-billing-info.js';

// All traffic is intercepted. No purchase, customer update, email or SMS.
const originalFetch = globalThis.fetch;
const envKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SPIFFY_SIGNING_SECRET', 'MAILERLITE_API_KEY'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
delete process.env.SPIFFY_SIGNING_SECRET;
delete process.env.MAILERLITE_API_KEY;
const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const purchaseEmail = 'achat@example.invalid';
let registration, events, patches, cancellations, unexpected;
function reset() {
  registration = { token, email: 'optin@example.invalid', prenom: 'Léa', telephone: '+41780000000', pays: 'CH', statut: 'registered', payment_status: 'pending', traffic_source: null };
  events = [];
  patches = [];
  cancellations = [];
  unexpected = [];
}
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  assert.equal(parsed.origin, 'https://supabase.test', 'No real outbound traffic is permitted');
  if (parsed.pathname.endsWith('/mc2_registrations')) {
    if (method === 'GET') {
      const matches = parsed.searchParams.get('token') === `eq.${token}` || parsed.searchParams.get('email') === `eq.${registration.email}`;
      return Response.json(matches ? [registration] : []);
    }
    if (method === 'PATCH') {
      patches.push(body);
      registration = { ...registration, ...body };
      return Response.json([registration]);
    }
  }
  if (parsed.pathname.endsWith('/mc2_funnel_events')) {
    if (method === 'POST') {
      if (events.some(event => event.dedupe_key === body.dedupe_key)) return Response.json({}, { status: 409 });
      events.push(body);
      return Response.json([body], { status: 201 });
    }
    const order = parsed.searchParams.get('metadata->>order_id');
    return Response.json(events.filter(event => !order || order === `eq.${event.metadata.order_id}`).map(event => ({ metadata: event.metadata })));
  }
  if (parsed.pathname.endsWith('/webinaire_registrations')) return Response.json([]);
  if (parsed.pathname.endsWith('/mc2_sms_jobs') || parsed.pathname.endsWith('/mc2_replay_recovery_jobs') || parsed.pathname.endsWith('/mc2_session_email_jobs')) {
    if (method === 'PATCH') cancellations.push({ path: parsed.pathname, body });
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/webinaire_exclusions') && method === 'POST') return Response.json({}, { status: 201 });
  unexpected.push(`${method} ${url}`);
  throw new Error('Unexpected mocked request');
};
function request(path, body) {
  return new Request(`https://sonnycourt.com/.netlify/functions/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
}
try {
  for (const [id, plan, total, recurring] of [['40406', 'twelve', 236400, 19700], ['40422', 'six', 208200, 34700]]) {
    reset();
    const payload = { event_name: 'order:success', order_id: `test-${id}`, checkout: { checkout_id: id }, order_total: 0, subscription_amount: recurring, customer: { email: purchaseEmail, name_first: 'Léa Achat' }, mc2_token: token };
    const first = await webhook(request('spiffy-purchase-webhook', payload));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).type, 'sale');
    assert.equal(registration.statut, 'purchased');
    assert.equal(registration.payment_status, 'paid');
    assert.equal(registration.initial_payment_cents, 0);
    assert.equal(registration.contractual_total_cents, total);
    assert.equal(registration.checkout_last_plan, plan);
    assert.equal(registration.email, 'optin@example.invalid', 'Do not replace the opt-in email');
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.purchase_email, purchaseEmail);
    assert.equal(events[0].metadata.amount_cents, 0);
    assert.ok(cancellations.some(item => item.path.endsWith('/mc2_sms_jobs')));
    const purchasedAt = registration.purchased_at;
    assert.equal((await webhook(request('spiffy-purchase-webhook', payload))).status, 200);
    assert.equal(events.length, 1, 'Webhook retries must not duplicate the purchase record');
    assert.equal(registration.purchased_at, purchasedAt);

    const confirmed = await status(request(`mc2-spiffy-status?t=${token}&order=test-${id}`));
    const customer = await confirmed.json();
    assert.equal(customer.paid, true);
    assert.equal(customer.schedule_ready, true);
    assert.equal(customer.amount_total, 0);
    assert.equal(customer.email, purchaseEmail);
    assert.equal(customer.first_name, 'Léa Achat');
    assert.equal(customer.phone, '+41780000000');
    const wrongOrder = await (await status(request(`mc2-spiffy-status?t=${token}&order=other-order`))).json();
    assert.equal(wrongOrder.paid, false);
    assert.equal(wrongOrder.email, undefined);

    const saved = await billing(request('mc2-billing-info', { provider: 'spiffy', t: token, email: 'cannot-change@example.invalid', first_name: 'Léa', last_name: 'Martin', phone: '+33600000000', street: '1 rue Exemple', zip: '75001', city: 'Paris', country: 'FR' }));
    assert.equal(saved.status, 200);
    assert.equal(patches.at(-1).billing_full_name, 'Léa Martin');
    assert.equal(patches.at(-1).email, undefined, 'The billing endpoint cannot change the purchase email');
    const prefilled = await (await status(request(`mc2-spiffy-status?t=${token}&order=test-${id}`))).json();
    assert.equal(prefilled.email, purchaseEmail);
    assert.equal(prefilled.first_name, 'Léa');
    assert.equal(prefilled.last_name, 'Martin');
    assert.equal(prefilled.phone, '+33600000000');
    assert.equal(prefilled.street, '1 rue Exemple');
    assert.equal(prefilled.city, 'Paris');
    assert.equal(prefilled.country, 'FR');
    assert.deepEqual(unexpected, []);

    for (const event of ['order:failed', 'order:pending', 'subscription:payment_success', 'subscription:cancelled']) {
      reset();
      const result = await (await webhook(request('spiffy-purchase-webhook', { ...payload, event_name: event }))).json();
      assert.equal(result.skipped, 'not_initial_order_success');
      assert.equal(patches.length, 0);
      assert.equal(events.length, 0);
      assert.equal(cancellations.length, 0);
    }
    reset();
    const pending = await (await status(request(`mc2-spiffy-status?t=${token}`))).json();
    assert.equal(pending.paid, false);
    assert.equal(pending.email, undefined);
    assert.equal((await billing(request('mc2-billing-info', { provider: 'spiffy', t: token }))).status, 403);
    assert.equal((await webhook(request('spiffy-purchase-webhook', { ...payload, mc2_token: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }))).status, 200);
    assert.equal(patches.length, 0, 'An unknown token must not fall back to another prospect');
    assert.deepEqual(unexpected, []);

    // Existing email matching still works when no MC2 reference is supplied.
    // A changed email cannot be linked without that reference; do not silently
    // pretend the DraftX iframe currently sends it.
    reset();
    const { mc2_token: omittedToken, ...withoutToken } = payload;
    const unmatched = await (await webhook(request('spiffy-purchase-webhook', withoutToken))).json();
    assert.equal(unmatched.skipped, 'lead_not_found');
    assert.equal(events.length, 0);
    const sameEmail = { ...withoutToken, customer: { email: registration.email, name_first: 'Léa' } };
    assert.equal((await webhook(request('spiffy-purchase-webhook', sameEmail))).status, 200);
    assert.equal(registration.payment_status, 'paid');
    assert.equal(events[0].metadata.purchase_email, registration.email);
    events = [];
    const missingConfirmation = await (await status(request(`mc2-spiffy-status?t=${token}&order=test-${id}`))).json();
    assert.equal(missingConfirmation.paid, false);
    assert.equal(missingConfirmation.email, undefined);
    assert.deepEqual(unexpected, []);
  }
  const page = readFileSync(new URL('../src/pages/commencer/succes.astro', import.meta.url), 'utf8');
  assert.match(page, /id="purchase-email"[^>]*readonly/);
  assert.match(page, /params\.get\('mc2_token'\)/);
  assert.match(page, /localStorage\.getItem\('mc2_registration_token'\)/);
  assert.match(page, /https:\/\/sonnycourt.com\/masterclass\/success\//);
  assert.match(page, /Simulation locale : aucune donnée enregistrée, aucun email envoyé/);
  assert.match(page, /name="referrer" content="no-referrer"/);
  console.log('PASS — J0 deux plans, doublons, refus échecs/mensualités, email achat protégé, coordonnées modifiables/préremplies. Aucun service réel appelé.');
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
