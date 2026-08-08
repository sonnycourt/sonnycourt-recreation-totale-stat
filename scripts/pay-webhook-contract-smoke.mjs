import assert from 'node:assert/strict';
import {
  PAY_WEBHOOK_CONFLICT_TARGET,
  payEventTargets,
  payIncomingVersionWins,
  payRoutingMetadata,
  payWebhookDedupeKey,
  payWebhookEnvelope,
} from '../netlify/functions/lib/pay-webhook-contract.mjs';

const stripeEvent = {
  id: 'evt_mc2_paid',
  type: 'checkout.session.completed',
  created: 1_786_240_000,
  livemode: true,
  data: {
    object: {
      id: 'cs_live_mc2',
      object: 'checkout.session',
      created: 1_786_240_000,
      customer_email: 'must-not-enter-the-ledger@example.test',
      metadata: {
        checkout_id: 'mc2-main',
        offer_slug: 'masterclass-2',
        funnel: 'mc2',
        pay_route: 'funnel-tracking',
        payment_plan_id: 'plan_mc2_47_150_197',
        forbidden_secret: 'never-copied',
      },
    },
  },
};

const stripe = payWebhookEnvelope('stripe', stripeEvent, { rawBody: JSON.stringify(stripeEvent) });
assert.equal(payWebhookDedupeKey(stripe), 'stripe:evt_mc2_paid');
assert.equal(PAY_WEBHOOK_CONFLICT_TARGET, 'provider,event_id');
assert.deepEqual(stripe.routing.targets, ['pay', 'funnel-tracking', 'checkout:mc2-main', 'offer:masterclass-2', 'funnel:mc2']);
assert.equal(stripe.routing.metadata.payment_plan_id, 'plan_mc2_47_150_197');
assert.equal(stripe.routing.metadata.forbidden_secret, undefined);
assert.equal(JSON.stringify(stripe).includes('must-not-enter-the-ledger'), false);
assert.match(stripe.payload_hash, /^[a-f0-9]{64}$/);

const repeated = payWebhookEnvelope('stripe', stripeEvent, { rawBody: JSON.stringify(stripeEvent) });
assert.equal(repeated.payload_hash, stripe.payload_hash);
assert.equal(payWebhookDedupeKey(repeated), payWebhookDedupeKey(stripe));

const paypal = payWebhookEnvelope('paypal', {
  id: 'WH-PP-1',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  create_time: '2026-08-09T10:15:00Z',
  resource: { id: '5TY00001', resource_type: 'capture', metadata: { checkout_id: 'paypal-checkout' } },
});
assert.equal(payWebhookDedupeKey(paypal), 'paypal:WH-PP-1');
assert.deepEqual(paypal.routing.targets, ['pay', 'checkout:paypal-checkout']);
assert.equal(paypal.object_id, '5TY00001');

assert.deepEqual(payRoutingMetadata({ email: 'private@example.test', funnel: 'sales' }), { funnel: 'sales' });
assert.deepEqual(payEventTargets({ checkout_id: '../../bad route', offer_slug: 'offer-ok' }), ['pay', 'offer:offer-ok']);
assert.equal(payIncomingVersionWins('2026-08-09T10:00:00Z', '2026-08-09T10:00:00Z'), true);
assert.equal(payIncomingVersionWins('2026-08-09T11:00:00Z', '2026-08-09T10:00:00Z'), false);
assert.equal(payIncomingVersionWins(null, '2026-08-09T10:00:00Z'), true);
assert.equal(payIncomingVersionWins('2026-08-09T10:00:00Z', null), false);
assert.throws(() => payWebhookEnvelope('other', stripeEvent), /pay_webhook_provider_invalid/);
assert.throws(() => payWebhookEnvelope('stripe', {}), /pay_webhook_identity_missing/);

console.log(JSON.stringify({
  stripe_deduplication: 'ok',
  paypal_deduplication: 'ok',
  metadata_routing: 'ok',
  pii_minimization: 'ok',
  stale_event_guard: 'ok',
}, null, 2));

