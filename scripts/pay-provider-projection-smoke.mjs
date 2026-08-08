import assert from 'node:assert/strict';
import { projectPayPalTransaction, projectStripeResource, validatePayProjection } from '../netlify/functions/lib/pay-provider-projection.mjs';

const stripePayment = projectStripeResource('payment_intents', {
  id: 'pi_live_test', object: 'payment_intent', created: 1_786_240_000, status: 'succeeded', currency: 'eur',
  amount: 19_700, amount_received: 19_700, description: 'Esprit Subconscient 2.0', customer: 'cus_test',
  metadata: { checkout_id: 'es2-standard', customer_email: 'client@example.test', forbidden_secret: 'never-copy' },
  latest_charge: { id: 'ch_test', amount_refunded: 2_000, billing_details: { name: 'Client Test', email: 'client@example.test' }, payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', number: '4242424242424242' } } },
});
assert.equal(stripePayment[0].table, 'pay_payments');
assert.equal(stripePayment[0].row.amount_minor, 19_700);
assert.equal(stripePayment[0].row.refunded_minor, 2_000);
assert.equal(stripePayment[0].row.payment_method_last4, '4242');
assert.equal(stripePayment[0].row.metadata.forbidden_secret, undefined);
assert.equal(JSON.stringify(stripePayment).includes('4242424242424242'), false);

const stripePlan = projectStripeResource('subscriptions', {
  id: 'sub_mc2', created: 1_786_240_000, status: 'active', customer: 'cus_mc2', current_period_end: 1_788_832_000,
  metadata: { checkout_id: 'mc2', installment_count: '11', installments_paid: '2' },
  items: { data: [{ quantity: 1, price: { id: 'price_mc2', unit_amount: 19_700, currency: 'eur', product: 'prod_mc2', recurring: { interval: 'month', interval_count: 1 } } }] },
});
assert.equal(stripePlan[0].table, 'pay_payment_plans');
assert.equal(stripePlan[0].row.installment_count, 11);
assert.equal(stripePlan[0].row.installments_paid, 2);
assert.equal(stripePlan[0].row.remaining_minor, 177_300);

const expiredStripeCoupon = projectStripeResource('coupons', {
  id: 'coupon_expired', created: 1_786_240_000, valid: false, percent_off: 20, duration: 'once', currency: 'eur',
});
assert.equal(expiredStripeCoupon[0].row.status, 'expired');

const paypalSale = projectPayPalTransaction({
  id: '5TY-SALE', created: 1_786_240_000, updated: '2026-08-09T11:00:00Z', kind: 'sale', status: 'Réussi',
  amount: 9_700, signed_amount: 9_700, refunded: 0, fee: 320, currency: 'eur', description: 'Consultation',
  customer: 'Client PayPal', email: 'paypal@example.test', country: 'FR', reference_id: 'ORDER-PP', event_code: 'T0006',
});
assert.deepEqual(paypalSale.map((item) => item.table), ['pay_customers', 'pay_payments']);
assert.equal(paypalSale[1].row.payment_method_type, 'paypal');
assert.equal(paypalSale[1].row.metadata.customer_external_id, 'paypal@example.test');

const paypalRefund = projectPayPalTransaction({
  id: '5TY-REFUND', created: 1_786_240_100, kind: 'refund', status: 'Remboursé', amount: 4_000, refunded: 4_000,
  currency: 'eur', reference_id: '5TY-SALE', event_code: 'T1107',
});
assert.equal(paypalRefund[0].table, 'pay_refunds');
assert.equal(paypalRefund[0].row.metadata.payment_external_id, '5TY-SALE');

validatePayProjection([...stripePayment, ...stripePlan, ...paypalSale, ...paypalRefund]);
assert.throws(() => projectStripeResource('events', { id: 'evt_test' }), /pay_projection_resource_invalid/);
assert.throws(() => projectPayPalTransaction({}), /pay_projection_identity_missing/);

console.log(JSON.stringify({
  stripe_payment_projection: 'ok',
  stripe_plan_projection: 'ok',
  stripe_coupon_projection: 'ok',
  paypal_sale_projection: 'ok',
  paypal_refund_projection: 'ok',
  sensitive_payload_minimization: 'ok',
}, null, 2));
