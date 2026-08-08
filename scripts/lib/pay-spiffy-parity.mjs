import { buildPayHistoryDashboard } from '../../netlify/functions/lib/pay-history.mjs';

const SUCCESSFUL = new Set(['succeeded', 'refunded', 'paid', 'complete', 'completed']);

function isoTime(value) {
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : null;
}

function inRange(value, start, endExclusive) {
  const time = isoTime(value);
  return time !== null && time >= start && time < endExclusive;
}

function addMoney(target, currency, amount) {
  const code = String(currency || 'EUR').toUpperCase();
  target[code] = (target[code] || 0) + Number(amount || 0);
}

function countBy(rows, pick) {
  return rows.reduce((result, item) => {
    const key = String(pick(item) || 'unknown').toLowerCase();
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function linkedCount(items, metadataKey, targets, missing = false) {
  return items.filter((item) => {
    const id = item.row.metadata?.[metadataKey];
    return id && (missing ? !targets.has(id) : targets.has(id));
  }).length;
}

function sumNestedMoney(days = {}) {
  const totals = {};
  for (const currencies of Object.values(days)) {
    for (const [currency, amount] of Object.entries(currencies || {})) addMoney(totals, currency, amount);
  }
  return totals;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function expectedLeaves(value, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => expectedLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return [{ path: prefix, expected: value }];
}

export function compareSpiffyParity(actual, expected) {
  const checks = expectedLeaves(expected).map((check) => {
    const observed = getPath(actual, check.path);
    return { ...check, actual: observed, ok: Object.is(observed, check.expected) };
  });
  return { passed: checks.every((check) => check.ok), checks, mismatches: checks.filter((check) => !check.ok) };
}

export function buildSpiffyParity({ orders, customers, plans, payments }, snapshot) {
  const normalizedOrders = orders.normalized || [];
  const normalizedCustomers = customers.normalized || [];
  const normalizedPlans = plans.normalized || [];
  const normalizedPayments = payments.normalized || [];
  const start = isoTime(snapshot.range_start);
  const endExclusive = isoTime(snapshot.range_end_exclusive);
  if (start === null || endExclusive === null || endExclusive <= start) throw new Error('spiffy_parity_range_invalid');

  const orderIds = new Set(normalizedOrders.map((item) => item.row.external_id));
  const customerIds = new Set(normalizedCustomers.map((item) => item.row.external_id));
  const periodOrders = normalizedOrders.filter((item) => SUCCESSFUL.has(item.row.status) && inRange(item.row.source_created_at, start, endExclusive));
  const periodPayments = normalizedPayments.filter((item) => SUCCESSFUL.has(item.row.status) && inRange(item.row.paid_at || item.row.source_created_at, start, endExclusive));
  const periodRefunds = normalizedPayments.filter((item) => Number(item.row.refunded_minor || 0) > 0 && inRange(item.row.metadata?.['refunded at'] || item.row.source_updated_at, start, endExclusive));
  const revenueMinor = {};
  const refundedMinor = {};
  periodPayments.forEach((item) => addMoney(revenueMinor, item.row.currency, item.row.amount_minor));
  periodRefunds.forEach((item) => addMoney(refundedMinor, item.row.currency, item.row.refunded_minor));

  const projectionInput = normalizedPlans.map((item) => item.row);
  const dashboardProjection = buildPayHistoryDashboard({ plans: projectionInput }, {
    now: snapshot.anchor_at,
    rangeStart: snapshot.range_start,
    rangeEnd: snapshot.range_end_inclusive,
    timeZone: snapshot.time_zone || 'Europe/Zurich',
  });
  const activeProjection = buildPayHistoryDashboard({ plans: projectionInput }, {
    now: snapshot.anchor_at,
    rangeStart: snapshot.anchor_at,
    rangeEnd: snapshot.cashflow_report_end,
    timeZone: snapshot.time_zone || 'Europe/Zurich',
    planStatuses: ['active'],
  });

  return {
    exports: {
      orders: { rows: orders.rows_valid, checksum: orders.checksum },
      customers: { rows: customers.rows_valid, checksum: customers.checksum },
      payment_plans: { rows: plans.rows_valid, checksum: plans.checksum, status: countBy(normalizedPlans, (item) => item.row.status) },
      payments: { rows: payments.rows_valid, checksum: payments.checksum, provider: countBy(normalizedPayments, (item) => item.row.provider) },
    },
    links: {
      payments_to_orders: linkedCount(normalizedPayments, 'order_external_id', orderIds),
      payments_missing_order: linkedCount(normalizedPayments, 'order_external_id', orderIds, true),
      plans_to_orders: linkedCount(normalizedPlans, 'order_external_id', orderIds),
      plans_missing_order: linkedCount(normalizedPlans, 'order_external_id', orderIds, true),
      payments_to_customers: linkedCount(normalizedPayments, 'customer_external_id', customerIds),
      payments_missing_customer: linkedCount(normalizedPayments, 'customer_external_id', customerIds, true),
      plans_to_customers: linkedCount(normalizedPlans, 'customer_external_id', customerIds),
      plans_missing_customer: linkedCount(normalizedPlans, 'customer_external_id', customerIds, true),
    },
    dashboard: {
      order_count: periodOrders.length,
      successful_payment_count: periodPayments.length,
      revenue_minor: revenueMinor,
      refund_count: periodRefunds.length,
      refunded_minor: refundedMinor,
      cashflow_current_minor: dashboardProjection.cashflow_current_minor,
      past_due_count: dashboardProjection.past_due_count,
    },
    cashflow_report_30d: {
      scheduled_minor: sumNestedMoney(activeProjection.plans_due_by_day),
    },
    safe_to_import: [orders, customers, plans, payments].every((item) => item.rows_skipped === 0 && item.anomalies.length === 0),
  };
}
