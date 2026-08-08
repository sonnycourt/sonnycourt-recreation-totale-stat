import assert from 'node:assert/strict';
import fs from 'node:fs';
import payHistoryHandler from '../netlify/functions/pay-history.js';
import { buildPayHistoryDashboard, getPayHistoryDashboard, getPayHistoryResource, paySupabaseSelect, projectPaymentPlan } from '../netlify/functions/lib/pay-history.mjs';

const plans = [
  { external_id: 'active_1', status: 'active', currency: 'eur', installment_amount_minor: 10_000, installment_count: 4, installments_paid: 1, remaining_minor: 30_000, interval_unit: 'month', interval_count: 1, next_payment_at: '2026-08-10T10:00:00Z' },
  { external_id: 'late_1', status: 'past_due', currency: 'eur', installment_amount_minor: 5_000, installment_count: 2, installments_paid: 0, remaining_minor: 10_000, next_payment_at: '2026-08-15T10:00:00Z' },
  { external_id: 'unpaid_1', status: 'unpaid', currency: 'eur', installment_amount_minor: 99_000, remaining_minor: 99_000, next_payment_at: '2026-08-12T10:00:00Z' },
  { external_id: 'done_1', status: 'completed', currency: 'eur', installment_amount_minor: 99_000, remaining_minor: 99_000, next_payment_at: '2026-08-12T10:00:00Z' },
];

assert.equal(projectPaymentPlan(plans[0]).length, 3);
assert.equal(projectPaymentPlan(plans[2]).length, 0);
assert.equal(projectPaymentPlan(plans[1], { statuses: ['active'] }).length, 0);

const dashboard = buildPayHistoryDashboard({
  orders: [
    { external_id: 'order_1', status: 'succeeded', currency: 'eur', source_created_at: '2026-08-08T09:00:00Z' },
    { external_id: 'order_2', status: 'refunded', currency: 'eur', source_created_at: '2026-08-08T12:00:00Z' },
    { external_id: 'order_3', status: 'failed', currency: 'eur', source_created_at: '2026-08-08T13:00:00Z' },
  ],
  plans,
  syncRuns: [{ completed_at: '2026-08-08T16:00:00Z' }],
}, {
  now: '2026-08-08T08:00:00Z',
  rangeStart: '2026-08-08T00:00:00Z',
  rangeEnd: '2026-08-31T00:00:00Z',
});

assert.equal(dashboard.orders_by_day['2026-08-08'], 2);
assert.equal(dashboard.past_due_count, 1);
assert.equal(dashboard.cashflow_current_minor.EUR, 15_000);
assert.equal(dashboard.cashflow_next_minor.EUR, 15_000);
assert.equal(dashboard.plans_due_by_day['2026-08-10'].EUR, 10_000);
assert.equal(dashboard.plans_due_by_day['2026-08-15'].EUR, 5_000);
assert.equal(dashboard.plans_due_count_by_day['2026-08-15'].EUR, 1);

const scheduledOnly = buildPayHistoryDashboard({ plans }, {
  now: '2026-08-08T08:00:00Z', rangeStart: '2026-08-08T00:00:00Z', rangeEnd: '2026-08-31T00:00:00Z', planStatuses: ['active'],
});
assert.equal(scheduledOnly.cashflow_current_minor.EUR, 10_000);
assert.equal(scheduledOnly.plans_due_by_day['2026-08-15'], undefined);
assert.equal(scheduledOnly.past_due_count, 1);

const selected = [];
const viaSelect = await getPayHistoryDashboard({
  now: '2026-08-08T08:00:00Z',
  rangeStart: '2026-08-02T00:00:00Z',
  rangeEnd: '2026-08-08T00:00:00Z',
  select: async (table, parameters) => {
    selected.push({ table, parameters });
    if (table === 'pay_orders') return [{ external_id: 'order_1', status: 'succeeded', currency: 'eur', source_created_at: '2026-08-08T09:00:00Z' }];
    if (table === 'pay_payment_plans') return plans;
    return [];
  },
});
assert.equal(viaSelect.ready, true);
assert.deepEqual(selected.map((item) => item.table), ['pay_orders', 'pay_payment_plans', 'pay_sync_runs']);

const requests = [];
await paySupabaseSelect('pay_orders', { select: 'external_id' }, {
  supabaseUrl: 'https://example.supabase.co',
  serviceKey: 'service-test',
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
assert.equal(requests.length, 1);
assert.equal(requests[0].options.method, 'GET');
await assert.rejects(() => paySupabaseSelect('orders', {}, { supabaseUrl: 'https://example.supabase.co', serviceKey: 'service-test', fetchImpl: async () => new Response('[]') }), /pay_history_table_invalid/);

const historyOrders = await getPayHistoryResource('orders', {
  select: async () => [{
    provider: 'spiffy', external_id: '2475427', status: 'succeeded', currency: 'eur', total_minor: 116_400,
    subtotal_minor: 100_000, discount_minor: 0, finance_fee_minor: 0, tax_minor: 16_400,
    source_created_at: '2026-08-07T07:26:24Z', metadata: { customer_email: 'client@example.com', 'name first': 'Client', product_name: 'ES2.0', country: 'CH' },
  }],
});
assert.equal(historyOrders.ready, true);
assert.equal(historyOrders.rows[0].id, '2475427');
assert.equal(historyOrders.rows[0].customer, 'Client');
assert.equal(historyOrders.rows[0].description, 'ES2.0');
assert.equal(historyOrders.rows[0].tax, 16_400);
assert.equal(historyOrders.rows[0].subtotal, 100_000);
assert.equal(historyOrders.rows[0].country, 'CH');

const historyPayments = await getPayHistoryResource('payments', {
  select: async () => [{
    provider: 'paypal', external_id: 'capture_1', status: 'succeeded', currency: 'eur', amount_minor: 19_700,
    refunded_minor: 0, payment_method_type: 'paypal', description: 'Échéance ES2.0', paid_at: '2026-08-07T07:26:24Z',
    source_created_at: '2026-08-07T07:26:24Z', metadata: { customer_email: 'client@example.com', order_external_id: '2475427' },
  }],
});
assert.equal(historyPayments.rows[0].provider, 'paypal');
assert.equal(historyPayments.rows[0].amount, 19_700);
assert.equal(historyPayments.rows[0].payment_method, 'paypal');
assert.equal(historyPayments.rows[0].order_id, '2475427');

const historyProducts = await getPayHistoryResource('products', {
  select: async (table) => table === 'pay_products'
    ? [{ id: 'product_uuid', provider: 'stripe', external_id: 'prod_1', name: 'ES2.0', active: true, source_created_at: '2026-08-07T07:26:24Z' }]
    : [{ product_id: 'product_uuid', provider: 'stripe', external_id: 'price_1', currency: 'eur', unit_amount_minor: 19_700, billing_type: 'recurring', interval_unit: 'month', interval_count: 1, active: true }],
});
assert.equal(historyProducts.rows[0].prices[0].id, 'price_1');
assert.equal(historyProducts.rows[0].prices[0].amount, 19_700);
await assert.rejects(() => getPayHistoryResource('unknown', { select: async () => [] }), /pay_history_resource_invalid/);

const unauthenticated = await payHistoryHandler(new Request('https://pay.sonnycourt.com/.netlify/functions/pay-history'));
assert.equal(unauthenticated.status, 401);
const wrongMethod = await payHistoryHandler(new Request('https://pay.sonnycourt.com/.netlify/functions/pay-history', { method: 'POST' }));
assert.equal(wrongMethod.status, 405);

const sources = [
  fs.readFileSync(new URL('../netlify/functions/pay-history.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../netlify/functions/lib/pay-history.mjs', import.meta.url), 'utf8'),
].join('\n');
assert.doesNotMatch(sources, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);

console.log(JSON.stringify({ history_projection: 'ok', exact_order_semantics: 'ok', exact_past_due_semantics: 'ok', read_only: 'ok' }, null, 2));
