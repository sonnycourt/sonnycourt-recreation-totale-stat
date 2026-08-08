import assert from 'node:assert/strict';
import {
  createPayBackfillAccumulator,
  runPayPalBackfillDryRun,
  runStripeBackfillDryRun,
  splitPayPalBackfillRange,
} from '../netlify/functions/lib/pay-backfill-dry-run.mjs';

const stripePages = [];
const stripe = await runStripeBackfillDryRun({
  resources: ['customers'],
  fetchPage: async (resource, options) => {
    stripePages.push({ resource, cursor: options.startingAfter || null });
    if (!options.startingAfter) return {
      data: [{ id: 'cus_1', object: 'customer', email: 'one@example.test', name: 'One Test', created: 1_700_000_000 }],
      has_more: true,
      next_cursor: 'cus_1',
    };
    return {
      data: [
        { id: 'cus_2', object: 'customer', email: 'two@example.test', name: 'Two Test', created: 1_700_000_100 },
        { id: 'cus_1', object: 'customer', email: 'one@example.test', name: 'One Updated', created: 1_700_000_000, updated: 1_700_000_200 },
      ],
      has_more: false,
      next_cursor: null,
    };
  },
});
assert.equal(stripe.ready, true);
assert.equal(stripe.rows_seen, 3);
assert.equal(stripe.operations_unique, 2);
assert.equal(stripe.duplicates, 1);
assert.deepEqual(stripePages, [{ resource: 'customers', cursor: null }, { resource: 'customers', cursor: 'cus_1' }]);
assert.equal(JSON.stringify(stripe).includes('one@example.test'), false);
assert.match(stripe.checksum, /^[a-f0-9]{64}$/);

const segments = splitPayPalBackfillRange('2024-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
assert.equal(segments.length, 3);
for (const segment of segments) assert.ok(segment.end.getTime() - segment.start.getTime() < 366 * 86_400_000);

let paypalCalls = 0;
const paypal = await runPayPalBackfillDryRun({
  start: '2025-01-01T00:00:00Z',
  end: '2026-01-01T00:00:00Z',
  fetchTransactions: async () => {
    paypalCalls += 1;
    return { transactions: [{
      id: `PP-${paypalCalls}`, created: 1_750_000_000 + paypalCalls, kind: 'sale', status: 'Réussi',
      amount: 9_700, signed_amount: 9_700, refunded: 0, fee: 300, currency: 'eur',
      customer: 'PayPal Test', email: `paypal-${paypalCalls}@example.test`,
    }] };
  },
  fetchResources: async (resource) => ({
    data: resource === 'products' ? [{ id: 'PROD-PP', name: 'Produit PayPal', status: 'active' }]
      : resource === 'plans' ? [{ id: 'PLAN-PP', product_id: 'PROD-PP', name: 'Plan PayPal', status: 'active', billing_type: 'installment', unit_amount_minor: 19_700, currency: 'eur', interval_unit: 'month', interval_count: 1, installment_count: 12 }]
        : [{ id: 'SUB-PP', plan_id: 'PLAN-PP', status: 'active', subscriber: { email_address: 'subscription@example.test' }, cycle_executions: [{ cycles_completed: 2 }] }],
    truncated: false,
  }),
});
assert.equal(paypalCalls, 2);
assert.equal(paypal.ready, true);
assert.equal(paypal.by_table.pay_payments, 2);
assert.equal(paypal.by_table.pay_customers, 3);
assert.equal(paypal.by_table.pay_products, 1);
assert.equal(paypal.by_table.pay_prices, 1);
assert.equal(paypal.by_table.pay_payment_plans, 1);
assert.equal(JSON.stringify(paypal).includes('@example.test'), false);

const first = createPayBackfillAccumulator();
const second = createPayBackfillAccumulator();
const operations = [
  { table: 'pay_products', conflict: 'provider,external_id', row: { provider: 'stripe', external_id: 'prod_2', source_updated_at: '2026-01-02T00:00:00Z' } },
  { table: 'pay_products', conflict: 'provider,external_id', row: { provider: 'stripe', external_id: 'prod_1', source_updated_at: '2026-01-01T00:00:00Z' } },
];
first.addOperations(operations);
second.addOperations([...operations].reverse());
assert.equal(first.report().checksum, second.report().checksum);
await assert.rejects(() => runStripeBackfillDryRun({ start: 'not-a-date' }), /pay_backfill_range_invalid/);

const truncated = await runStripeBackfillDryRun({
  resources: ['customers'], maxPages: 1,
  fetchPage: async () => ({ data: [{ id: 'cus_truncated', object: 'customer' }], has_more: true, next_cursor: 'cus_next' }),
});
assert.equal(truncated.ready, false);
assert.equal(truncated.truncated, true);

console.log(JSON.stringify({
  stripe_pagination: 'ok',
  paypal_long_range_segmentation: 'ok',
  provider_identity_deduplication: 'ok',
  deterministic_checksum: 'ok',
  pii_free_report: 'ok',
  truncation_guard: 'ok',
}, null, 2));
