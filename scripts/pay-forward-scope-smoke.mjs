import assert from 'node:assert/strict';
import {
  PAY_ORIGIN,
  payCutoverIso,
  payMetadataBelongsToPay,
  payPalCatalogObjectIsForward,
  payPalObjectBelongsToPay,
  stripeObjectBelongsToPay,
  stripeResourceIsForwardScoped,
} from '../netlify/functions/lib/pay-forward-scope.mjs';

const env = { PAY_FORWARD_ONLY_FROM: '2026-08-09T00:00:00Z' };
assert.equal(PAY_ORIGIN, 'sonnycourt_pay');
assert.equal(payCutoverIso(env), '2026-08-09T00:00:00.000Z');
assert.equal(payMetadataBelongsToPay({ pay_origin: 'sonnycourt_pay' }), true);
assert.equal(payMetadataBelongsToPay({ source: 'spiffy', pay_origin: 'sonnycourt_pay' }), false);
assert.equal(stripeObjectBelongsToPay({ created: 1_786_230_000, metadata: { pay_origin: PAY_ORIGIN } }, { env }), false);
assert.equal(stripeObjectBelongsToPay({ created: 1_786_290_000, metadata: { pay_origin: PAY_ORIGIN } }, { env }), true);
assert.equal(stripeObjectBelongsToPay({ created: 1_786_290_000, metadata: { is_spiffy: 'true' } }, { env }), false);
assert.equal(stripeObjectBelongsToPay({ object: 'event', created: 1_786_290_000, data: { object: { metadata: { source: PAY_ORIGIN } } } }, { env }), true);
assert.equal(stripeResourceIsForwardScoped('payment_intents'), true);
assert.equal(stripeResourceIsForwardScoped('balance'), false);
assert.equal(payPalObjectBelongsToPay({ create_time: '2026-08-09T10:00:00Z', custom_id: 'pay:mc2' }, { env }), true);
assert.equal(payPalObjectBelongsToPay({ create_time: '2026-08-09T10:00:00Z', invoice_id: 'SPF-123' }, { env }), false);
assert.equal(payPalCatalogObjectIsForward({ create_time: '2026-08-09T10:00:00Z' }, { env, resource: 'plans' }), true);

console.log(JSON.stringify({ forward_only_scope: 'ok', spiffy_excluded: 'ok', providers: ['stripe', 'paypal'] }, null, 2));
