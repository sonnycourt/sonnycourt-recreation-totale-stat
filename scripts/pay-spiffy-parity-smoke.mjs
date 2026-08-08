import assert from 'node:assert/strict';
import { buildSpiffyParity, compareSpiffyParity } from './lib/pay-spiffy-parity.mjs';

const item = (row) => ({ table: 'test', row });
const source = (normalized, checksum) => ({ normalized, checksum, rows_valid: normalized.length, rows_skipped: 0, anomalies: [] });
const inputs = {
  orders: source([item({ external_id: 'order_1', status: 'succeeded', currency: 'EUR', source_created_at: '2026-08-08T08:00:00Z' })], 'orders-hash'),
  customers: source([item({ external_id: 'customer_1' })], 'customers-hash'),
  plans: source([item({
    external_id: 'plan_1', status: 'active', currency: 'EUR', installment_amount_minor: 1000,
    installment_count: 2, installments_paid: 0, remaining_minor: 2000, interval_unit: 'month', interval_count: 1,
    next_payment_at: '2026-08-10T08:00:00Z', metadata: { order_external_id: 'order_1', customer_external_id: 'customer_1' },
  })], 'plans-hash'),
  payments: source([item({
    external_id: 'pi_1', provider: 'stripe', status: 'succeeded', currency: 'EUR', amount_minor: 4700,
    refunded_minor: 0, paid_at: '2026-08-08T08:00:00Z', metadata: { order_external_id: 'order_1', customer_external_id: 'customer_1' },
  })], 'payments-hash'),
};
const snapshot = {
  anchor_at: '2026-08-08T00:00:00+02:00', range_start: '2026-08-08T00:00:00+02:00',
  range_end_inclusive: '2026-08-08T23:59:59+02:00', range_end_exclusive: '2026-08-09T00:00:00+02:00',
  cashflow_report_end: '2026-09-07T23:59:59+02:00', time_zone: 'Europe/Zurich',
};
const actual = buildSpiffyParity(inputs, snapshot);
assert.equal(actual.dashboard.order_count, 1);
assert.equal(actual.dashboard.successful_payment_count, 1);
assert.deepEqual(actual.dashboard.revenue_minor, { EUR: 4700 });
assert.deepEqual(actual.dashboard.cashflow_current_minor, { EUR: 1000 });
assert.deepEqual(actual.cashflow_report_30d.scheduled_minor, { EUR: 1000 });
assert.equal(actual.safe_to_import, true);
const passing = compareSpiffyParity(actual, { dashboard: { order_count: 1, revenue_minor: { EUR: 4700 } } });
assert.equal(passing.passed, true);
const failing = compareSpiffyParity(actual, { dashboard: { order_count: 2 } });
assert.equal(failing.passed, false);
assert.equal(failing.mismatches[0].path, 'dashboard.order_count');

console.log(JSON.stringify({ exact_metrics: 'ok', nested_comparison: 'ok', mismatch_gate: 'ok' }, null, 2));
