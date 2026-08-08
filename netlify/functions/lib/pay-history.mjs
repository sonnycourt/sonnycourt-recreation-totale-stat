const ALLOWED_TABLES = new Set([
  'pay_orders',
  'pay_payment_plans',
  'pay_sync_runs',
]);

const MAX_ROWS = 20_000;
const PAGE_SIZE = 1_000;
const DEFAULT_TIME_ZONE = 'Europe/Zurich';

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function historyError(code, status = 500) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function safeIso(value, fallback) {
  const date = value instanceof Date ? new Date(value) : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function addMonths(date, count = 1) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + count);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function addInterval(date, unit = 'month', count = 1) {
  const amount = Math.max(1, positiveInteger(count, 1));
  if (unit === 'day') return addDays(date, amount);
  if (unit === 'week') return addDays(date, amount * 7);
  if (unit === 'year') return addMonths(date, amount * 12);
  return addMonths(date, amount);
}

export function payDateKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function payMonthKey(value, timeZone = DEFAULT_TIME_ZONE) {
  return payDateKey(value, timeZone).slice(0, 7);
}

function currencyCode(value) {
  const code = clean(value, 8).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'EUR';
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export async function paySupabaseSelect(table, parameters = {}, options = {}) {
  if (!ALLOWED_TABLES.has(table)) throw historyError('pay_history_table_invalid', 400);
  const supabaseUrl = clean(options.supabaseUrl || process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const serviceKey = clean(options.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY, 1_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!supabaseUrl || !serviceKey || typeof fetchImpl !== 'function') throw historyError('pay_history_not_configured', 503);

  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    query.set('limit', String(PAGE_SIZE));
    query.set('offset', String(offset));
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?${query}`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const missing = response.status === 404 || body?.code === '42P01' || body?.code === 'PGRST205';
      throw historyError(missing ? 'pay_history_not_initialized' : `pay_history_http_${response.status}`, missing ? 503 : 502);
    }
    const page = Array.isArray(body) ? body : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw historyError('pay_history_row_limit', 422);
}

export function projectPaymentPlan(plan, options = {}) {
  const status = clean(plan?.status, 40).toLowerCase();
  if (!['active', 'past_due'].includes(status)) return [];
  const firstDue = new Date(String(plan?.next_payment_at || ''));
  const installment = positiveInteger(Number(plan?.installment_amount_minor));
  let remaining = Math.max(0, Number(plan?.remaining_minor || 0));
  if (!Number.isFinite(firstDue.getTime()) || !installment || !remaining) return [];

  const explicitRemaining = Math.max(0, positiveInteger(plan?.installment_count) - Math.max(0, Number(plan?.installments_paid || 0)));
  const calculatedRemaining = Math.ceil(remaining / installment);
  const count = Math.min(240, explicitRemaining || calculatedRemaining);
  const currency = currencyCode(plan?.currency);
  const intervalUnit = ['day', 'week', 'month', 'year'].includes(clean(plan?.interval_unit, 20).toLowerCase()) ? clean(plan.interval_unit, 20).toLowerCase() : 'month';
  const intervalCount = positiveInteger(plan?.interval_count, 1);
  const projected = [];
  let due = firstDue;
  for (let sequence = 0; sequence < count && remaining > 0; sequence += 1) {
    const amount = Math.min(installment, remaining);
    projected.push({
      external_id: clean(plan?.external_id, 255),
      status,
      currency,
      amount_minor: amount,
      due_at: due.toISOString(),
    });
    remaining -= amount;
    due = addInterval(due, intervalUnit, intervalCount);
  }
  return projected;
}

function addCurrencyAmount(target, currency, amount) {
  const code = currencyCode(currency);
  target[code] = (target[code] || 0) + Number(amount || 0);
}

function successfulOrder(status) {
  return ['succeeded', 'paid', 'complete', 'completed', 'refunded', 'active'].includes(clean(status, 40).toLowerCase());
}

export function buildPayHistoryDashboard({ orders = [], plans = [], syncRuns = [] } = {}, options = {}) {
  const timeZone = clean(options.timeZone, 80) || DEFAULT_TIME_ZONE;
  const now = new Date(safeIso(options.now, new Date().toISOString()));
  const rangeStart = new Date(safeIso(options.rangeStart, addDays(now, -6).toISOString()));
  const rangeEndInclusive = new Date(safeIso(options.rangeEnd, now.toISOString()));
  const rangeEndExclusive = addDays(rangeEndInclusive, 1);
  const ordersByDay = {};
  const orderCurrencies = {};

  for (const order of orders) {
    if (!successfulOrder(order?.status)) continue;
    const created = new Date(String(order?.source_created_at || ''));
    if (!Number.isFinite(created.getTime()) || created < rangeStart || created >= rangeEndExclusive) continue;
    const key = payDateKey(created, timeZone);
    ordersByDay[key] = (ordersByDay[key] || 0) + 1;
    orderCurrencies[currencyCode(order?.currency)] = (orderCurrencies[currencyCode(order?.currency)] || 0) + 1;
  }

  const projected = plans.flatMap((plan) => projectPaymentPlan(plan, { timeZone }));
  const plansDueByDay = {};
  const currentCashflowMinor = {};
  const nextCashflowMinor = {};
  const currentMonth = payMonthKey(now, timeZone);
  const nextMonth = payMonthKey(addMonths(now), timeZone);
  for (const installment of projected) {
    const due = new Date(installment.due_at);
    const month = payMonthKey(due, timeZone);
    if (month === currentMonth && due >= now) addCurrencyAmount(currentCashflowMinor, installment.currency, installment.amount_minor);
    if (month === nextMonth) addCurrencyAmount(nextCashflowMinor, installment.currency, installment.amount_minor);
    if (due >= rangeStart && due < rangeEndExclusive) {
      const key = payDateKey(due, timeZone);
      plansDueByDay[key] ||= {};
      addCurrencyAmount(plansDueByDay[key], installment.currency, installment.amount_minor);
    }
  }

  return {
    ready: true,
    source: 'supabase_pay_projection',
    generated_at: now.toISOString(),
    range: { start: rangeStart.toISOString(), end: rangeEndInclusive.toISOString() },
    orders_by_day: ordersByDay,
    order_currencies: orderCurrencies,
    plans_due_by_day: plansDueByDay,
    cashflow_current_minor: currentCashflowMinor,
    cashflow_next_minor: nextCashflowMinor,
    past_due_count: plans.filter((plan) => clean(plan?.status, 40).toLowerCase() === 'past_due').length,
    last_sync_at: syncRuns.map((run) => safeIso(run?.completed_at, '')).filter(Boolean).sort().at(-1) || null,
  };
}

export async function getPayHistoryDashboard(options = {}) {
  const select = options.select || paySupabaseSelect;
  const now = new Date(safeIso(options.now, new Date().toISOString()));
  const rangeStart = new Date(safeIso(options.rangeStart, addDays(now, -6).toISOString()));
  const rangeEnd = new Date(safeIso(options.rangeEnd, now.toISOString()));
  if (rangeEnd < rangeStart || rangeEnd.getTime() - rangeStart.getTime() > 366 * 86_400_000) {
    throw historyError('pay_history_range_invalid', 400);
  }
  const rangeEndExclusive = addDays(rangeEnd, 1);
  const [orders, plans, syncRuns] = await Promise.all([
    select('pay_orders', {
      select: 'external_id,status,currency,source_created_at',
      source_created_at: `gte.${rangeStart.toISOString()}`,
      and: `(source_created_at.lt.${rangeEndExclusive.toISOString()})`,
      order: 'source_created_at.asc',
    }, options),
    select('pay_payment_plans', {
      select: 'external_id,status,currency,installment_amount_minor,installment_count,installments_paid,remaining_minor,interval_unit,interval_count,next_payment_at',
      status: 'in.(active,past_due)',
      order: 'next_payment_at.asc.nullslast',
    }, options),
    select('pay_sync_runs', {
      select: 'provider,status,completed_at,checksum',
      status: 'eq.completed',
      order: 'completed_at.desc',
    }, options),
  ]);
  return buildPayHistoryDashboard({ orders, plans, syncRuns }, {
    now,
    rangeStart,
    rangeEnd,
    timeZone: options.timeZone,
  });
}
