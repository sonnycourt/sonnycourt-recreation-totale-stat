import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sendMc2MetaEvents, mc2LastKnownBrowserContext } from '../netlify/functions/lib/mc2-meta-events.mjs';
import { deliverTrackingMeta } from '../netlify/functions/lib/mc2-tracking-meta-worker.mjs';
import { routeMc2StripeEvent, MC2_PAY_METADATA } from '../netlify/functions/lib/mc2-pay-router.mjs';
import { MC2_SESSION_MONTHLY_PLAN, MC2_SESSION_MONTHLY_TOTAL_CENTS } from '../netlify/functions/lib/mc2-stripe.mjs';

// Every request is intercepted; no real database, payment, email or Meta event.
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.META_ACCESS_TOKEN = 'fixture';
process.env.META_PIXEL_ID = 'fixture';
process.env.CONTEXT = 'production';
delete process.env.META_CAPI_ALLOW_NON_PRODUCTION;
delete process.env.MAILERLITE_API_KEY;
process.env.MC2_CIRCLE_ENABLED = 'false';
process.env.MC2_CONTRACT_DOCUMENTS_ENABLED = 'false';
const originalFetch = globalThis.fetch;
const token = '11111111-1111-4111-8111-111111111111';
const reg = { token, email: 'fixture@example.invalid', telephone: '+33600000000', traffic_source: 'meta_ad',
  meta_fbc: 'fb.1.fixture', meta_fbp: 'fb.1.browser', purchased_at: null,
  stripe_subscription_schedule_id: 'sub_sched_fixture', paid_total_cents: 0, paid_installment_count: 0 };
const receipts = new Map(), calls = [], writes = [], processed = new Set();
let mode = 'success', ackLost = false;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
  if (url.hostname === 'graph.facebook.com') {
    calls.push(body.data[0]);
    if (mode === 'timeout') throw new Error('fixture timeout');
    return Response.json(mode === 'empty' ? { events_received: 0 } : { events_received: 1 });
  }
  assert.equal(url.hostname, 'database.invalid', 'No external services allowed');
  const table = url.pathname.split('/').at(-1);
  if (method !== 'GET') writes.push({ table, method, body });
  if (table === 'mc2_tracking_meta_outbox') {
    if (method === 'GET' && url.searchParams.has('token')) return Response.json([
      { context: { source: 'payment_webhook', ip: '192.0.2.99', userAgent: 'provider' } },
      { context: {} }, { context: { route: '/mc2/replay/', ip: '203.0.113.8', userAgent: 'Actual browser' } },
    ]);
    if (method === 'GET') return Response.json([...receipts.values()].filter(r => ['pending', 'processing', 'retry'].includes(r.status)));
    if (method === 'POST') {
      if (receipts.has(body.delivery_key)) return Response.json([]);
      receipts.set(body.delivery_key, { attempts: 0, ...body }); return Response.json([body], { status: 201 });
    }
    const key = url.searchParams.get('delivery_key')?.slice(3), row = receipts.get(key);
    if (!row || `eq.${row.status}` !== url.searchParams.get('status') || `eq.${row.attempts}` !== url.searchParams.get('attempts')) return Response.json([]);
    if (ackLost && body.status === 'sent') return Response.json({}, { status: 503 });
    Object.assign(row, body); return Response.json([row]);
  }
  if (table === 'mc2_tracking_test_registrations') return Response.json([]);
  if (table === 'mc2_registrations') {
    if (method === 'PATCH') Object.assign(reg, body);
    return Response.json([{ ...reg }]);
  }
  if (table === 'mc2_stripe_webhook_events') {
    if (method === 'POST') { processed.add(body.event_id); return Response.json([]); }
    return Response.json(processed.has(url.searchParams.get('event_id')?.slice(3)) ? [{ event_id: 'fixture' }] : []);
  }
  if (method === 'GET') return Response.json([]);
  return Response.json(body ? [body] : []);
};
const event = (name, id) => ({ eventName: name, eventId: id, contentName: 'Fixture' });
const send = (name, id, extra = {}) => sendMc2MetaEvents({ events: [event(name, id)], registration: reg,
  context: { source: 'payment_webhook', url: 'https://sonnycourt.com/mc2/session/' }, ...extra });
try {
  assert.deepEqual(await mc2LastKnownBrowserContext(token), { ip: '203.0.113.8', userAgent: 'Actual browser' });
  // Timeout/empty acknowledgment: original timestamp + identity + paid value survive.
  mode = 'timeout'; const when = Math.floor(Date.now() / 1000) - 123;
  await send('Lead', 'original-lead', { eventTime: when });
  let row = [...receipts.values()][0];
  assert.equal(row.event_time, new Date(when * 1000).toISOString());
  assert.equal(row.event_id, calls.at(-1).event_id);
  mode = 'success'; await deliverTrackingMeta();
  assert.equal(calls.at(-1).event_time, when); assert.equal(row.status, 'sent');
  mode = 'empty'; await send('QualifiedLead', 'empty-ack');
  assert.equal([...receipts.values()].at(-1).status, 'pending');
  mode = 'success'; await deliverTrackingMeta();

  // A durable insert claims a payment exactly once, even for simultaneous webhooks.
  let count = calls.length;
  await Promise.all([send('Purchase', 'purchase-durable', { durable: true, value: 197, currency: 'EUR', eventTime: when }),
    send('Purchase', 'purchase-durable', { durable: true, value: 197, currency: 'EUR', eventTime: when })]);
  assert.equal(calls.length, count + 1);
  await send('Purchase', 'purchase-durable', { durable: true, value: 197 });
  assert.equal(calls.length, count + 1, 'Receipt prevents late duplicates');
  mode = 'timeout';
  await send('MC2_InstallmentPaid', 'month-2', { durable: true, value: 197, currency: 'EUR', eventTime: when });
  await send('MC2_InstallmentPaid', 'month-3', { durable: true, value: 197, currency: 'EUR', eventTime: when });
  assert.equal([...receipts.values()].filter(r => r.event_name === 'MC2_InstallmentPaid').length, 2);
  mode = 'success'; await deliverTrackingMeta();
  assert.equal(calls.at(-1).custom_data.value, 197);
  ackLost = true; await send('MC2_Refund', 'refund-1', { durable: true, value: 50, eventTime: when });
  row = [...receipts.values()].find(r => r.event_id === 'refund-1'); assert.equal(row.status, 'processing');
  ackLost = false; await deliverTrackingMeta({ now: Date.now() + 360000 });
  assert.equal(row.status, 'sent'); assert.equal(calls.at(-1).event_time, when);
  process.env.CONTEXT = 'deploy-preview'; count = calls.length; const written = writes.length;
  await send('Purchase', 'preview-forbidden', { durable: true });
  assert.equal(calls.length, count); assert.equal(writes.length, written);
  process.env.CONTEXT = 'production';

  // Execute the actual Stripe router, not just a source-code regex.
  const stripe = { subscriptionSchedules: { retrieve: async () => ({ id: 'sub_sched_fixture' }) },
    subscriptions: { retrieve: async () => ({ id: 'sub_fixture', schedule: 'sub_sched_fixture', metadata: { mc2_token: token } }) } };
  const metadata = { ...MC2_PAY_METADATA, mc2_token: token, payment_plan: MC2_SESSION_MONTHLY_PLAN, contractual_total_cents: String(MC2_SESSION_MONTHLY_TOTAL_CENTS) };
  const checkout = { id: 'cs_fixture', metadata, mode: 'payment', payment_status: 'paid', amount_total: 19700,
    customer: 'cus_fixture', payment_intent: 'pi_fixture', currency: 'eur' };
  const route = (id, type, object, previous_attributes) => routeMc2StripeEvent({ id, type, created: when,
    data: { object, previous_attributes } }, { stripe });
  count = calls.length;
  await route('evt_checkout', 'checkout.session.completed', checkout);
  assert.equal(reg.payment_status, 'paid', 'Tracking cannot bypass the business update');
  assert.equal(reg.initial_payment_cents, 19700);
  assert.equal(calls.at(-1).event_name, 'Purchase'); assert.equal(calls.at(-1).custom_data.value, 197);
  assert.equal(calls.at(-1).user_data.client_user_agent, 'Actual browser');
  await route('evt_checkout', 'checkout.session.completed', checkout);
  await route('evt_checkout_async', 'checkout.session.async_payment_succeeded', checkout);
  assert.equal(calls.length, count + 1, 'Completed + async success = one purchase');
  const invoice = { id: 'in_month2', metadata, subscription: 'sub_fixture', status: 'paid', amount_paid: 19700,
    billing_reason: 'subscription_create', currency: 'eur' };
  await route('evt_invoice', 'invoice.paid', invoice);
  assert.equal(calls.at(-1).event_name, 'MC2_InstallmentPaid');
  assert.equal(reg.paid_total_cents, 39400);
  await route('evt_refund', 'charge.refunded', { id: 'ch_fixture', metadata, payment_intent: 'pi_fixture', amount_refunded: 5000,
    refunded: false, currency: 'eur' }, { amount_refunded: 0 });
  assert.equal(calls.at(-1).event_name, 'MC2_Refund'); assert.equal(calls.at(-1).custom_data.value, 50);
  assert.equal(reg.payment_status, 'paid', 'Partial-refund analytics must not change access policy');

  const component = fs.readFileSync(new URL('../src/components/mc2/Mc2MetaPixelPageView.astro', import.meta.url), 'utf8');
  const script = component.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
  for (const [host, search, expected] of [['sonnycourt.com', '', 1], ['localhost', '', 0], ['preview.netlify.app', '', 0], ['sonnycourt.com', '?preview=dev', 0]]) {
    const pixel = [], fbq = (...args) => pixel.push(args);
    const context = { window: { fbq }, fbq, location: { hostname: host, search }, URLSearchParams, document: {} };
    vm.runInNewContext(script, context); vm.runInNewContext(script, context);
    assert.equal(pixel.filter(c => c[0] === 'track').length, expected);
    assert.ok(pixel.every(c => c[0] === 'init' || c[1] === 'PageView'));
  }
} finally { globalThis.fetch = originalFetch; }
console.log('PASS robustness: timeouts, original IDs/times, durable concurrency, separate installments, lost ACK, context, preview isolation, real Stripe router and PageView-only pixel. All external services mocked.');
