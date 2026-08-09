import assert from 'node:assert/strict';
import { preparePayWebhookEvent, summarizePreparedWebhook } from '../netlify/functions/lib/pay-webhook-projection.mjs';

const stripePayment = preparePayWebhookEvent('stripe', {
  id: 'evt_pi_succeeded', type: 'payment_intent.succeeded', created: 1_786_240_000, livemode: true,
  data: { object: {
    id: 'pi_123', object: 'payment_intent', created: 1_786_240_000, status: 'succeeded', amount: 4_700,
    amount_received: 4_700, currency: 'eur', metadata: { checkout_id: 'mc2', secret_value: 'do-not-copy' },
    latest_charge: { id: 'ch_123', payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', number: '4242424242424242' } } },
  } },
}, { rawBody: '{signed-stripe-payload}' });
assert.equal(stripePayment.decision, 'projected');
assert.equal(stripePayment.operations[0].table, 'pay_payments');
assert.deepEqual(stripePayment.envelope.routing.targets, ['pay', 'checkout:mc2']);
const stripeSummary = summarizePreparedWebhook(stripePayment);
assert.equal(stripeSummary.operation_count, 1);
assert.deepEqual(stripeSummary.operations_by_table, { pay_payments: 1 });
assert.equal(JSON.stringify(stripePayment).includes('4242424242424242'), false);
assert.equal(JSON.stringify(stripePayment).includes('do-not-copy'), false);

const stripeInvoice = preparePayWebhookEvent('stripe', {
  id: 'evt_invoice_paid', type: 'invoice.payment_succeeded', created: 1_786_240_000,
  data: { object: { id: 'in_123', object: 'invoice', created: 1_786_240_000, subscription: 'sub_mc2', payment_intent: 'pi_123', currency: 'eur', amount_paid: 19_700, period_end: 1_788_832_000 } },
});
assert.equal(stripeInvoice.effects[0].type, 'payment_plan_installment');
assert.equal(stripeInvoice.effects[0].subscription_external_id, 'sub_mc2');
assert.equal(stripeInvoice.operations[0].table, 'pay_payments');

const stripeUpcomingInvoice = preparePayWebhookEvent('stripe', {
  id: 'evt_invoice_upcoming', type: 'invoice.upcoming', created: 1_786_240_000,
  data: { object: { object: 'invoice', subscription: 'sub_mc2', currency: 'eur', amount_due: 19_700, period_end: 1_791_424_000 } },
});
assert.equal(stripeUpcomingInvoice.effects[0].external_id, 'sub_mc2:1791424000');

const stripeDispute = preparePayWebhookEvent('stripe', {
  id: 'evt_dispute', type: 'charge.dispute.created', created: 1_786_240_000,
  data: { object: { id: 'dp_123', object: 'dispute', amount: 4_700, currency: 'eur', status: 'needs_response' } },
});
assert.equal(stripeDispute.decision, 'projected');
assert.deepEqual(stripeDispute.operations.map((item) => item.table), ['pay_disputes', 'pay_alerts']);

const paypalCapture = preparePayWebhookEvent('paypal', {
  id: 'WH-CAPTURE', event_type: 'PAYMENT.CAPTURE.COMPLETED', create_time: '2026-08-09T10:00:00Z',
  resource: {
    id: 'CAPTURE-123', status: 'COMPLETED', create_time: '2026-08-09T09:59:58Z',
    amount: { value: '47.00', currency_code: 'EUR' },
    payer: { email_address: 'buyer@example.test', name: { given_name: 'Ada', surname: 'Test' } },
    payee: { email_address: 'merchant-secret@example.test' },
    seller_receivable_breakdown: { paypal_fee: { value: '1.65', currency_code: 'EUR' } },
    supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
  },
}, { rawBody: '{signed-paypal-payload}' });
assert.deepEqual(paypalCapture.operations.map((item) => item.table), ['pay_customers', 'pay_payments']);
assert.equal(paypalCapture.operations[1].row.status, 'succeeded');
assert.equal(paypalCapture.operations[1].row.amount_minor, 4_700);
assert.equal(paypalCapture.operations[1].row.fee_minor, 165);
assert.equal(JSON.stringify(paypalCapture).includes('merchant-secret@example.test'), false);
assert.equal(JSON.stringify(summarizePreparedWebhook(paypalCapture)).includes('buyer@example.test'), false);

const paypalRefund = preparePayWebhookEvent('paypal', {
  id: 'WH-REFUND', event_type: 'PAYMENT.REFUND.PENDING', create_time: '2026-08-09T11:00:00Z',
  resource: {
    id: 'REFUND-123', status: 'PENDING', amount: { value: '10.00', currency_code: 'EUR' },
    supplementary_data: { related_ids: { capture_id: 'CAPTURE-123' } },
  },
});
assert.equal(paypalRefund.operations[0].table, 'pay_refunds');
assert.equal(paypalRefund.operations[0].row.status, 'pending');
assert.equal(paypalRefund.operations[0].row.metadata.payment_external_id, 'CAPTURE-123');

const paypalSubscription = preparePayWebhookEvent('paypal', {
  id: 'WH-SUB', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', create_time: '2026-08-09T12:00:00Z',
  resource: {
    id: 'I-SUB123', status: 'ACTIVE', plan_id: 'P-PLAN123', quantity: '1', create_time: '2026-08-09T11:58:00Z',
    subscriber: { email_address: 'subscriber@example.test', name: { given_name: 'Lin', surname: 'Test' } },
    billing_info: { next_billing_time: '2026-09-09T12:00:00Z', last_payment: { amount: { value: '197.00', currency_code: 'EUR' } } },
  },
});
assert.deepEqual(paypalSubscription.operations.map((item) => item.table), ['pay_customers', 'pay_subscriptions']);
assert.equal(paypalSubscription.operations[1].row.amount_minor, 19_700);
assert.equal(paypalSubscription.operations[1].row.status, 'active');

const paypalDispute = preparePayWebhookEvent('paypal', {
  id: 'WH-DISPUTE', event_type: 'CUSTOMER.DISPUTE.CREATED', create_time: '2026-08-09T12:00:00Z',
  resource: { id: 'PP-D-123', status: 'OPEN', dispute_amount: { value: '47.00', currency_code: 'EUR' } },
});
assert.equal(paypalDispute.decision, 'projected');
assert.deepEqual(paypalDispute.operations.map((item) => item.table), ['pay_disputes', 'pay_alerts']);

console.log(JSON.stringify({
  stripe_payment_event: 'ok',
  stripe_installment_effect: 'ok',
  stripe_dispute_alert: 'ok',
  paypal_capture_event: 'ok',
  paypal_refund_event: 'ok',
  paypal_subscription_event: 'ok',
  paypal_dispute_alert: 'ok',
  dry_run_summary: 'pii_free',
}, null, 2));
