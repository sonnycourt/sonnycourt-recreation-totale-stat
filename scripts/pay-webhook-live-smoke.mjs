import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyPayPalWebhookSignature, verifyStripeWebhookSignature } from '../netlify/functions/lib/pay-webhook-security.mjs';
import { storePreparedPayWebhook } from '../netlify/functions/lib/pay-webhook-storage.mjs';

const raw = JSON.stringify({ id: 'evt_pay_1' });
const timestamp = 1_786_300_000;
const secret = 'whsec_test_pay';
const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
assert.equal(verifyStripeWebhookSignature(raw, `t=${timestamp},v1=${signature}`, secret, { now: timestamp * 1_000 }), true);
assert.equal(verifyStripeWebhookSignature(raw, `t=${timestamp},v1=bad`, secret, { now: timestamp * 1_000 }), false);
assert.equal(verifyStripeWebhookSignature(raw, `t=${timestamp},v1=${signature}`, secret, { now: (timestamp + 301) * 1_000 }), false);

const paypalRequest = new Request('https://pay.sonnycourt.com/.netlify/functions/pay-webhook?provider=paypal', {
  method: 'POST',
  headers: {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.paypal.com/cert.pem',
    'paypal-transmission-id': 'transmission-1',
    'paypal-transmission-sig': 'signature-1',
    'paypal-transmission-time': '2026-08-09T10:00:00Z',
  },
});
let verificationBody = null;
assert.equal(await verifyPayPalWebhookSignature(paypalRequest, { id: 'WH-1' }, {
  env: { PAYPAL_WEBHOOK_ID: 'WEBHOOK-1' },
  requestImpl: async (_path, request) => {
    verificationBody = request.body;
    return { verification_status: 'SUCCESS' };
  },
}), true);
assert.equal(verificationBody.webhook_id, 'WEBHOOK-1');
assert.equal(verificationBody.webhook_event.id, 'WH-1');

const calls = [];
const prepared = {
  envelope: {
    provider: 'stripe', event_id: 'evt_pay_1', event_type: 'payment_intent.succeeded',
    object_type: 'payment_intent', object_id: 'pi_pay_1', livemode: true,
    source_created_at: '2026-08-09T10:00:00.000Z', source_updated_at: '2026-08-09T10:00:00.000Z',
    payload_hash: 'a'.repeat(64), status: 'received', attempts: 0, routing: {},
  },
  operations: [{
    table: 'pay_payments', conflict: 'provider,external_id',
    row: { provider: 'stripe', external_id: 'pi_pay_1', status: 'succeeded', currency: 'eur', amount_minor: 4_700 },
  }],
  effects: [],
};
const adapters = {
  get: async () => ({ ok: true, data: [] }),
  patch: async (table, query, body) => {
    calls.push({ kind: 'patch', table, query, body });
    return { ok: true, data: [body] };
  },
  upsert: async (table, body, options) => {
    calls.push({ kind: 'upsert', table, body, options });
    return { ok: true, data: [body] };
  },
};
const stored = await storePreparedPayWebhook(prepared, adapters);
assert.equal(stored.status, 'completed');
assert.equal(stored.operations, 1);
assert.deepEqual(calls.filter((item) => item.kind === 'upsert').map((item) => item.table), ['pay_webhook_events', 'pay_payments']);
assert.equal(calls.at(-1).body.status, 'completed');

const duplicate = await storePreparedPayWebhook(prepared, {
  ...adapters,
  get: async () => ({ ok: true, data: [{ status: 'completed', attempts: 1 }] }),
});
assert.equal(duplicate.duplicate, true);

console.log(JSON.stringify({ stripe_signature: 'ok', paypal_signature: 'ok', supabase_upsert: 'ok', webhook_dedupe: 'ok' }, null, 2));
