import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpiffyExport } from './lib/pay-spiffy-import.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

function load(name, type) {
  const file = option(`--${name}`);
  if (!file) throw new Error(`missing_${name}_export`);
  return normalizeSpiffyExport(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'), { type });
}

function counts(rows, pick) {
  return rows.reduce((result, item) => {
    const key = String(pick(item) || 'unknown').toLowerCase();
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function moneyByCurrency(rows, pick) {
  return rows.reduce((result, item) => {
    const currency = String(item.row.currency || 'EUR').toUpperCase();
    result[currency] = (result[currency] || 0) + Number(pick(item.row) || 0);
    return result;
  }, {});
}

function dateRange(rows, pick) {
  const values = rows.map((item) => pick(item.row)).filter(Boolean).sort();
  return { first: values[0] || null, last: values.at(-1) || null };
}

const orders = load('orders', 'orders');
const customers = load('customers', 'customers');
const plans = load('plans', 'payment_plans');
const payments = load('payments', 'payments');

const orderIds = new Set(orders.normalized.map((item) => item.row.external_id));
const customerIds = new Set(customers.normalized.map((item) => item.row.external_id));
const linked = (items, metadataKey, target) => items.filter((item) => item.row.metadata?.[metadataKey] && target.has(item.row.metadata[metadataKey])).length;
const missing = (items, metadataKey, target) => items.filter((item) => item.row.metadata?.[metadataKey] && !target.has(item.row.metadata[metadataKey])).length;

const report = {
  mode: 'dry_run',
  generated_at: new Date().toISOString(),
  exports: {
    orders: { rows: orders.rows_valid, checksum: orders.checksum, status: counts(orders.normalized, (item) => item.row.status), contract_value_minor: moneyByCurrency(orders.normalized, (row) => row.total_minor), range: dateRange(orders.normalized, (row) => row.source_created_at) },
    customers: { rows: customers.rows_valid, checksum: customers.checksum, lifetime_value_minor: moneyByCurrency(customers.normalized, (row) => row.lifetime_value_minor), range: dateRange(customers.normalized, (row) => row.source_created_at) },
    payment_plans: { rows: plans.rows_valid, checksum: plans.checksum, status: counts(plans.normalized, (item) => item.row.status), remaining_minor: moneyByCurrency(plans.normalized, (row) => row.remaining_minor), range: dateRange(plans.normalized, (row) => row.source_created_at) },
    payments: { rows: payments.rows_valid, checksum: payments.checksum, provider: counts(payments.normalized, (item) => item.row.provider), status: counts(payments.normalized, (item) => item.row.status), paid_minor: moneyByCurrency(payments.normalized.filter((item) => ['succeeded', 'refunded'].includes(item.row.status)), (row) => row.amount_minor), refunded_minor: moneyByCurrency(payments.normalized, (row) => row.refunded_minor), range: dateRange(payments.normalized, (row) => row.source_created_at) },
  },
  links: {
    payments_to_orders: linked(payments.normalized, 'order_external_id', orderIds),
    payments_missing_order: missing(payments.normalized, 'order_external_id', orderIds),
    plans_to_orders: linked(plans.normalized, 'order_external_id', orderIds),
    plans_missing_order: missing(plans.normalized, 'order_external_id', orderIds),
    payments_to_customers: linked(payments.normalized, 'customer_external_id', customerIds),
    payments_missing_customer: missing(payments.normalized, 'customer_external_id', customerIds),
    plans_to_customers: linked(plans.normalized, 'customer_external_id', customerIds),
    plans_missing_customer: missing(plans.normalized, 'customer_external_id', customerIds),
  },
  safe_to_stage: [orders, customers, plans, payments].every((item) => item.rows_skipped === 0 && item.anomalies.length === 0),
};

console.log(JSON.stringify(report, null, 2));
