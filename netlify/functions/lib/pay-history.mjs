const ALLOWED_TABLES = new Set([
  'pay_checkouts',
  'pay_customers',
  'pay_discounts',
  'pay_orders',
  'pay_payment_plans',
  'pay_payments',
  'pay_prices',
  'pay_products',
  'pay_subscriptions',
  'pay_sync_runs',
]);

const HISTORY_RESOURCES = Object.freeze({
  orders: {
    table: 'pay_orders',
    select: 'provider,external_id,status,currency,subtotal_minor,discount_minor,finance_fee_minor,tax_minor,total_minor,refunded_minor,promo_code,source_created_at,source_updated_at,metadata',
    order: 'source_created_at.desc.nullslast',
  },
  customers: {
    table: 'pay_customers',
    select: 'provider,external_id,email,first_name,last_name,display_name,currency,lifetime_value_minor,order_count,source_created_at,source_updated_at',
    order: 'source_created_at.desc.nullslast',
  },
  payment_plans: {
    table: 'pay_payment_plans',
    select: 'provider,external_id,status,currency,installment_amount_minor,installment_count,installments_paid,remaining_minor,interval_unit,interval_count,started_at,next_payment_at,source_created_at,source_updated_at,metadata',
    order: 'source_created_at.desc.nullslast',
  },
  payments: {
    table: 'pay_payments',
    select: 'provider,external_id,status,currency,amount_minor,refunded_minor,fee_minor,net_minor,payment_method_type,payment_method_brand,payment_method_last4,description,paid_at,due_at,source_created_at,source_updated_at,metadata',
    order: 'paid_at.desc.nullslast',
  },
  subscriptions: {
    table: 'pay_subscriptions',
    select: 'provider,external_id,status,currency,amount_minor,interval_unit,interval_count,quantity,started_at,current_period_start,current_period_end,cancel_at,cancelled_at,source_created_at,source_updated_at,metadata',
    order: 'source_created_at.desc.nullslast',
  },
  checkouts: {
    table: 'pay_checkouts',
    select: 'provider,external_id,name,slug,public_url,status,sales_minor_30d,customer_count_30d,source_created_at,source_updated_at,metadata',
    order: 'source_created_at.desc.nullslast',
  },
  discounts: {
    table: 'pay_discounts',
    select: 'provider,external_id,code,status,discount_type,amount_minor,percent_off,currency,applies_to_one_time,applies_to_recurring,once_per_customer,max_redemptions,redeemed_count,expires_at,source_created_at,source_updated_at',
    order: 'source_created_at.desc.nullslast',
  },
});

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
  const allowedStatuses = Array.isArray(options.statuses) && options.statuses.length ? options.statuses : ['active', 'past_due'];
  if (!allowedStatuses.includes(status)) return [];
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

function metadataValue(metadata, ...keys) {
  if (!metadata || typeof metadata !== 'object') return '';
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && String(value).trim()) return clean(String(value), 500);
  }
  return '';
}

function historyCustomer(metadata = {}) {
  const email = metadataValue(metadata, 'customer_email', 'email').toLowerCase();
  const first = metadataValue(metadata, 'name first', 'first name', 'customer first name');
  const last = metadataValue(metadata, 'name last', 'last name', 'customer last name');
  const name = metadataValue(metadata, 'customer name', 'name') || [first, last].filter(Boolean).join(' ') || email || 'Client';
  return { name, email };
}

function resourceRow(resource, row) {
  if (resource === 'orders') {
    const customer = historyCustomer(row.metadata);
    return {
      id: row.external_id,
      provider: row.provider,
      status: row.status,
      currency: currencyCode(row.currency).toLowerCase(),
      subtotal: Number(row.subtotal_minor || 0),
      discount: Number(row.discount_minor || 0),
      finance_fee: Number(row.finance_fee_minor || 0),
      tax: Number(row.tax_minor || 0),
      amount: Number(row.total_minor || 0),
      refunded: Number(row.refunded_minor || 0),
      description: metadataValue(row.metadata, 'product_name', 'product', 'offer name') || 'Commande',
      customer: customer.name,
      email: customer.email,
      country: metadataValue(row.metadata, 'country', 'billing country', 'billing_country', 'country code', 'country_code') || null,
      promo_code: row.promo_code || null,
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  if (resource === 'customers') {
    const name = clean(row.display_name, 200) || [clean(row.first_name, 100), clean(row.last_name, 100)].filter(Boolean).join(' ') || clean(row.email, 180) || 'Client';
    return {
      id: row.external_id,
      provider: row.provider,
      email: clean(row.email, 180).toLowerCase(),
      name,
      currency: currencyCode(row.currency).toLowerCase(),
      lifetime_value: Number(row.lifetime_value_minor || 0),
      order_count: Number(row.order_count || 0),
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  if (resource === 'payment_plans') {
    const customer = historyCustomer(row.metadata);
    return {
      id: row.external_id,
      provider: row.provider,
      status: row.status,
      currency: currencyCode(row.currency).toLowerCase(),
      amount: Number(row.installment_amount_minor || 0),
      remaining: Number(row.remaining_minor || 0),
      installment_count: Number(row.installment_count || 0),
      installments_paid: Number(row.installments_paid || 0),
      interval_unit: row.interval_unit || 'month',
      interval_count: Number(row.interval_count || 1),
      next_payment_at: row.next_payment_at,
      started_at: row.started_at,
      product: metadataValue(row.metadata, 'product_name', 'product', 'offer name') || 'Plan de paiement',
      customer: customer.name,
      email: customer.email,
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  if (resource === 'payments') {
    const customer = historyCustomer(row.metadata);
    return {
      id: row.external_id,
      provider: row.provider,
      status: row.status,
      currency: currencyCode(row.currency).toLowerCase(),
      amount: Number(row.amount_minor || 0),
      refunded: Number(row.refunded_minor || 0),
      fee: row.fee_minor == null ? null : Number(row.fee_minor),
      net: row.net_minor == null ? null : Number(row.net_minor),
      description: clean(row.description, 300) || metadataValue(row.metadata, 'product_name', 'product', 'offer name') || 'Paiement',
      customer: customer.name,
      email: customer.email,
      order_id: metadataValue(row.metadata, 'order_external_id', 'order id') || null,
      payment_plan_id: metadataValue(row.metadata, 'payment_plan_external_id', 'paymentplan id', 'payment plan id') || null,
      failure_reason: metadataValue(row.metadata, 'failure reason', 'failure_reason', 'failure code') || null,
      payment_method: [clean(row.payment_method_brand, 60), clean(row.payment_method_last4, 8) ? `•••• ${clean(row.payment_method_last4, 8)}` : ''].filter(Boolean).join(' ') || clean(row.payment_method_type, 80),
      paid_at: row.paid_at || row.source_created_at,
      due_at: row.due_at,
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  if (resource === 'subscriptions') {
    const customer = historyCustomer(row.metadata);
    return {
      id: row.external_id,
      provider: row.provider,
      status: row.status,
      currency: currencyCode(row.currency).toLowerCase(),
      amount: Number(row.amount_minor || 0),
      interval_unit: row.interval_unit || 'month',
      interval_count: Number(row.interval_count || 1),
      quantity: Number(row.quantity || 1),
      customer: customer.name,
      email: customer.email,
      current_period_end: row.current_period_end,
      cancel_at: row.cancel_at,
      cancelled_at: row.cancelled_at,
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  if (resource === 'checkouts') {
    return {
      id: row.external_id,
      provider: row.provider,
      name: row.name,
      slug: row.slug,
      public_url: row.public_url,
      status: row.status,
      sales_30d: Number(row.sales_minor_30d || 0),
      customer_count_30d: Number(row.customer_count_30d || 0),
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  if (resource === 'discounts') {
    return {
      id: row.external_id,
      provider: row.provider,
      code: row.code,
      status: row.status,
      type: row.discount_type,
      amount: row.amount_minor == null ? null : Number(row.amount_minor),
      percent_off: row.percent_off == null ? null : Number(row.percent_off),
      currency: row.currency ? currencyCode(row.currency).toLowerCase() : null,
      applies_to_one_time: Boolean(row.applies_to_one_time),
      applies_to_recurring: Boolean(row.applies_to_recurring),
      once_per_customer: Boolean(row.once_per_customer),
      max_redemptions: row.max_redemptions == null ? null : Number(row.max_redemptions),
      redeemed_count: Number(row.redeemed_count || 0),
      expires_at: row.expires_at,
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    };
  }
  return null;
}

export async function getPayHistoryResource(resource, options = {}) {
  const config = HISTORY_RESOURCES[resource];
  if (!config && resource !== 'products') throw historyError('pay_history_resource_invalid', 400);
  const select = options.select || paySupabaseSelect;
  if (resource === 'products') {
    const [products, prices] = await Promise.all([
      select('pay_products', { select: 'id,provider,external_id,name,description,active,source_created_at,source_updated_at', order: 'source_created_at.desc.nullslast' }, options),
      select('pay_prices', { select: 'product_id,provider,external_id,label,currency,unit_amount_minor,billing_type,interval_unit,interval_count,installment_count,active,source_created_at,source_updated_at', order: 'source_created_at.desc.nullslast' }, options),
    ]);
    const pricesByProduct = new Map();
    for (const price of prices) {
      if (!price.product_id) continue;
      const list = pricesByProduct.get(price.product_id) || [];
      list.push({
        id: price.external_id,
        provider: price.provider,
        label: price.label,
        currency: currencyCode(price.currency).toLowerCase(),
        amount: Number(price.unit_amount_minor || 0),
        billing_type: price.billing_type,
        interval_unit: price.interval_unit,
        interval_count: Number(price.interval_count || 1),
        installment_count: price.installment_count == null ? null : Number(price.installment_count),
        active: Boolean(price.active),
      });
      pricesByProduct.set(price.product_id, list);
    }
    return { ready: true, resource, rows: products.map((product) => ({
      id: product.external_id,
      provider: product.provider,
      name: product.name,
      description: product.description,
      active: Boolean(product.active),
      prices: pricesByProduct.get(product.id) || [],
      created_at: product.source_created_at,
      updated_at: product.source_updated_at,
    })) };
  }
  const rows = await select(config.table, { select: config.select, order: config.order }, options);
  return { ready: true, resource, rows: rows.map((row) => resourceRow(resource, row)).filter(Boolean) };
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

  const projected = plans.flatMap((plan) => projectPaymentPlan(plan, { timeZone, statuses: options.planStatuses }));
  const plansDueByDay = {};
  const plansDueCountByDay = {};
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
      plansDueCountByDay[key] ||= {};
      addCurrencyAmount(plansDueByDay[key], installment.currency, installment.amount_minor);
      plansDueCountByDay[key][installment.currency] = (plansDueCountByDay[key][installment.currency] || 0) + 1;
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
    plans_due_count_by_day: plansDueCountByDay,
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
    planStatuses: options.planStatuses,
  });
}
