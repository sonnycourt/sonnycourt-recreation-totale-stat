import assert from 'node:assert/strict';
import { MC2_PAY_METADATA, isMc2StripeEvent } from '../netlify/functions/lib/mc2-pay-router.mjs';
import {
  MC2_CONTRACT_TOTAL_CENTS,
  MC2_ENTRY_PAYMENT_CENTS,
  MC2_INSTALLMENT_CENTS,
  MC2_INSTALLMENT_COUNT,
  MC2_PAYMENT_PLAN,
  MC2_STRIPE_PRODUCT_ID,
  isValidMc2EntryPrice,
  isValidMc2InstallmentPrice,
} from '../netlify/functions/lib/mc2-stripe.mjs';
import { stripeObjectBelongsToPay } from '../netlify/functions/lib/pay-forward-scope.mjs';
import { payWebhookEnvelope } from '../netlify/functions/lib/pay-webhook-contract.mjs';

const event = {
  id: 'evt_mc2_checkout',
  type: 'checkout.session.completed',
  created: 1_786_290_000,
  livemode: true,
  data: {
    object: {
      id: 'cs_live_mc2',
      object: 'checkout.session',
      created: 1_786_290_000,
      metadata: { ...MC2_PAY_METADATA, mc2_token: 'token-not-persisted-in-envelope' },
    },
  },
};

assert.equal(isMc2StripeEvent(event), true);
assert.equal(stripeObjectBelongsToPay(event, { env: { PAY_FORWARD_ONLY_FROM: '2026-08-09T00:00:00Z' } }), true);
const envelope = payWebhookEnvelope('stripe', event, { rawBody: JSON.stringify(event) });
assert.deepEqual(envelope.routing.targets, [
  'pay',
  'checkout:es2-mc2-commencer',
  'offer:es2-complete',
  'funnel:mc2',
]);
assert.equal(JSON.stringify(envelope).includes('token-not-persisted-in-envelope'), false);
assert.equal(isMc2StripeEvent({ ...event, data: { object: { metadata: { system: 'other' } } } }), false);
assert.equal(MC2_PAYMENT_PLAN, '47_now_then_4x297');
assert.equal(MC2_ENTRY_PAYMENT_CENTS + (MC2_INSTALLMENT_CENTS * MC2_INSTALLMENT_COUNT), MC2_CONTRACT_TOTAL_CENTS);
assert.equal(isValidMc2EntryPrice({
  product: MC2_STRIPE_PRODUCT_ID,
  active: true,
  type: 'one_time',
  currency: 'eur',
  unit_amount: 4700,
  tax_behavior: 'inclusive',
}), true);
assert.equal(isValidMc2EntryPrice({
  product: MC2_STRIPE_PRODUCT_ID,
  active: true,
  type: 'one_time',
  currency: 'eur',
  unit_amount: 29700,
  tax_behavior: 'inclusive',
}), false);
assert.equal(isValidMc2InstallmentPrice({
  product: MC2_STRIPE_PRODUCT_ID,
  active: true,
  type: 'recurring',
  currency: 'eur',
  unit_amount: 29700,
  tax_behavior: 'inclusive',
  recurring: { interval: 'month', interval_count: 1 },
}), true);
assert.equal(isValidMc2InstallmentPrice({
  product: MC2_STRIPE_PRODUCT_ID,
  active: true,
  type: 'recurring',
  currency: 'eur',
  unit_amount: 19700,
  tax_behavior: 'inclusive',
  recurring: { interval: 'month', interval_count: 1 },
}), false);

console.log(JSON.stringify({ mc2_pay_route: 'ok', forward_scope: 'ok', token_minimization: 'ok' }, null, 2));
