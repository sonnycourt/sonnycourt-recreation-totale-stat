import { createHash } from 'node:crypto';
import { getPayPalTransactions } from './pay-paypal-data.mjs';
import { getPayPalResources } from './pay-paypal-resources.mjs';
import {
  projectPayPalPlan,
  projectPayPalProduct,
  projectPayPalSubscription,
  projectPayPalTransaction,
  projectStripeResource,
  validatePayProjection,
} from './pay-provider-projection.mjs';
import { getPayStripePage } from './pay-stripe-data.mjs';

export const PAY_STRIPE_BACKFILL_RESOURCES = Object.freeze([
  'customers',
  'products',
  'prices',
  'payment_links',
  'checkout_sessions',
  'subscriptions',
  'payment_intents',
  'refunds',
  'coupons',
  'promotion_codes',
]);

const DAY_MS = 86_400_000;

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function date(value) {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function safeCount(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function projectionKey(operation) {
  return `${operation.table}:${operation.row.provider}:${operation.row.external_id}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function version(operation) {
  return clean(operation.row.source_updated_at || operation.row.source_created_at, 80);
}

function versionWins(existing, incoming) {
  if (!existing) return true;
  const first = date(existing.version);
  const second = date(incoming.version);
  if (!second) return !first && incoming.digest >= existing.digest;
  if (!first) return true;
  if (second.getTime() !== first.getTime()) return second.getTime() > first.getTime();
  return incoming.digest >= existing.digest;
}

export function createPayBackfillAccumulator() {
  const records = new Map();
  const state = {
    rows_seen: 0,
    pages_seen: 0,
    duplicates: 0,
    stale: 0,
    truncated: false,
    by_source: {},
    errors: {},
  };

  function addSource(provider, resource, rows = 0) {
    const key = `${provider}:${resource}`;
    increment(state.by_source, key, Number(rows || 0));
    state.rows_seen += Number(rows || 0);
    state.pages_seen += 1;
  }

  function addOperations(operations) {
    validatePayProjection(operations);
    for (const operation of operations) {
      const key = projectionKey(operation);
      const incoming = {
        operation,
        version: version(operation),
        digest: createHash('sha256').update(stableJson(operation.row)).digest('hex'),
      };
      const existing = records.get(key);
      if (existing) {
        state.duplicates += 1;
        if (!versionWins(existing, incoming)) {
          state.stale += 1;
          continue;
        }
      }
      records.set(key, incoming);
    }
  }

  function addError(error) {
    increment(state.errors, clean(error?.message, 120) || 'pay_backfill_projection_error');
  }

  function markTruncated() {
    state.truncated = true;
  }

  function report() {
    const byTable = {};
    const leaves = [];
    for (const [key, item] of records) {
      increment(byTable, item.operation.table);
      leaves.push(createHash('sha256').update(`${key}:${item.version}:${item.digest}`).digest('hex'));
    }
    const checksum = createHash('sha256').update(leaves.sort().join('\n')).digest('hex');
    const errorCount = Object.values(state.errors).reduce((total, count) => total + count, 0);
    return {
      mode: 'dry_run',
      ready: errorCount === 0 && !state.truncated,
      rows_seen: state.rows_seen,
      pages_seen: state.pages_seen,
      operations_unique: records.size,
      duplicates: state.duplicates,
      stale: state.stale,
      truncated: state.truncated,
      by_source: { ...state.by_source },
      by_table: byTable,
      errors: { ...state.errors },
      checksum,
    };
  }

  return { addSource, addOperations, addError, markTruncated, report };
}

export function splitPayPalBackfillRange(startValue, endValue, segmentDays = 360) {
  const start = date(startValue);
  const end = date(endValue);
  if (!start || !end || start > end) throw new Error('pay_backfill_range_invalid');
  const days = safeCount(segmentDays, 360, 1, 365);
  const segments = [];
  let cursor = start;
  while (cursor <= end) {
    const segmentEnd = new Date(Math.min(end.getTime(), cursor.getTime() + days * DAY_MS - 1));
    segments.push({ start: new Date(cursor), end: segmentEnd });
    cursor = new Date(segmentEnd.getTime() + 1);
  }
  return segments;
}

export async function runStripeBackfillDryRun(options = {}) {
  const fetchPage = options.fetchPage || getPayStripePage;
  const resources = Array.isArray(options.resources) && options.resources.length
    ? options.resources.map((item) => clean(item, 80))
    : PAY_STRIPE_BACKFILL_RESOURCES;
  const unsupported = resources.filter((resource) => !PAY_STRIPE_BACKFILL_RESOURCES.includes(resource));
  if (unsupported.length) throw new Error('pay_backfill_resource_invalid');
  const accumulator = options.accumulator || createPayBackfillAccumulator();
  const maxPages = safeCount(options.maxPages, 1_000, 1, 10_000);
  const start = date(options.start);
  const end = date(options.end);
  if ((options.start && !start) || (options.end && !end) || (start && end && start > end)) throw new Error('pay_backfill_range_invalid');
  const createdGte = start?.getTime();
  const createdLte = end?.getTime();

  for (const resource of resources) {
    let cursor = '';
    const seenCursors = new Set();
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await fetchPage(resource, {
        limit: 100,
        startingAfter: cursor || undefined,
        createdGte: createdGte ? Math.floor(createdGte / 1_000) : undefined,
        createdLte: createdLte ? Math.floor(createdLte / 1_000) : undefined,
      });
      const rows = Array.isArray(page?.data) ? page.data : [];
      accumulator.addSource('stripe', resource, rows.length);
      for (const row of rows) {
        try {
          accumulator.addOperations(projectStripeResource(resource, row));
        } catch (error) {
          accumulator.addError(error);
        }
      }
      if (!page?.has_more) break;
      const next = clean(page?.next_cursor, 255);
      if (!next || next === cursor || seenCursors.has(next)) throw new Error('pay_backfill_cursor_invalid');
      if (pageNumber === maxPages) {
        accumulator.markTruncated();
        break;
      }
      seenCursors.add(next);
      cursor = next;
    }
  }
  return accumulator.report();
}

export async function runPayPalBackfillDryRun(options = {}) {
  const fetchTransactions = options.fetchTransactions || getPayPalTransactions;
  const fetchResources = options.fetchResources || getPayPalResources;
  const start = date(options.start);
  const end = date(options.end);
  if (!start || !end || start > end) throw new Error('pay_backfill_range_invalid');
  const accumulator = options.accumulator || createPayBackfillAccumulator();
  const segments = splitPayPalBackfillRange(start, end, options.segmentDays);
  for (const segment of segments) {
    const result = await fetchTransactions({ start: segment.start, end: segment.end });
    const rows = Array.isArray(result?.transactions) ? result.transactions : [];
    accumulator.addSource('paypal', 'transactions', rows.length);
    for (const row of rows) {
      try {
        const operations = projectPayPalTransaction(row);
        if (operations.length) accumulator.addOperations(operations);
      } catch (error) {
        accumulator.addError(error);
      }
    }
  }
  const resources = {};
  for (const resource of ['products', 'plans', 'subscriptions']) {
    try {
      const result = await fetchResources(resource, { maxPages: safeCount(options.resourceMaxPages, 100, 1, 1_000) });
      const rows = Array.isArray(result?.data) ? result.data : [];
      resources[resource] = rows;
      accumulator.addSource('paypal', resource, rows.length);
      if (result?.truncated) accumulator.markTruncated();
    } catch {
      accumulator.addError(new Error(`paypal_${resource}_unavailable`));
      resources[resource] = [];
    }
  }
  const plansById = new Map(resources.plans.map((plan) => [clean(plan.id, 255), plan]));
  for (const product of resources.products) {
    try { accumulator.addOperations([projectPayPalProduct(product)]); }
    catch (error) { accumulator.addError(error); }
  }
  for (const plan of resources.plans) {
    try { accumulator.addOperations([projectPayPalPlan(plan)]); }
    catch (error) { accumulator.addError(error); }
  }
  for (const subscription of resources.subscriptions) {
    try {
      accumulator.addOperations(projectPayPalSubscription({
        ...subscription,
        pay_plan: plansById.get(clean(subscription.plan_id, 255)) || null,
      }));
    } catch (error) {
      accumulator.addError(error);
    }
  }
  return accumulator.report();
}
