import { paypalGet } from './pay-paypal.mjs';

export const PAYPAL_READ_RESOURCES = Object.freeze([
  'products',
  'plans',
  'subscriptions',
  'invoices',
]);

const RESOURCE_CONFIG = Object.freeze({
  products: { path: '/v1/catalogs/products', collection: 'products', pageSize: 20 },
  plans: { path: '/v1/billing/plans', collection: 'plans', pageSize: 20 },
  subscriptions: { path: '/v1/billing/subscriptions', collection: 'subscriptions', pageSize: 20 },
  invoices: { path: '/v2/invoicing/invoices', collection: 'items', pageSize: 100 },
});

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeCount(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function currencyDigits(currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: clean(currency, 8).toUpperCase() || 'EUR' })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

function amountToMinor(amount = {}) {
  const value = Number(amount?.value || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(Math.abs(value) * (10 ** currencyDigits(amount?.currency_code))));
}

function normalizedAmount(amount = {}) {
  const currency = clean(amount?.currency_code, 8).toLowerCase() || 'eur';
  return {
    value: clean(String(amount?.value ?? ''), 60) || '0',
    currency_code: currency.toUpperCase(),
    currency,
    minor: amountToMinor(amount),
  };
}

function normalizedName(name = {}) {
  return {
    given_name: clean(name?.given_name, 100) || null,
    surname: clean(name?.surname, 100) || null,
  };
}

function normalizedFrequency(frequency = {}) {
  return {
    interval_unit: clean(frequency?.interval_unit, 20).toLowerCase() || null,
    interval_count: Math.max(1, safeCount(frequency?.interval_count, 1, 1, 365)),
  };
}

export function normalizePayPalProduct(product = {}) {
  return {
    id: clean(product.id, 255),
    name: clean(product.name, 240) || 'Produit PayPal',
    description: clean(product.description, 1_000) || null,
    type: clean(product.type, 40).toLowerCase() || null,
    category: clean(product.category, 80).toLowerCase() || null,
    image_url: clean(product.image_url, 1_000) || null,
    home_url: clean(product.home_url, 1_000) || null,
    status: clean(product.status, 40).toLowerCase() || 'active',
    create_time: clean(product.create_time, 80) || null,
    update_time: clean(product.update_time || product.create_time, 80) || null,
  };
}

export function normalizePayPalPlan(plan = {}) {
  const cycles = (Array.isArray(plan.billing_cycles) ? plan.billing_cycles : []).map((cycle) => {
    const frequency = normalizedFrequency(cycle?.frequency);
    const amount = normalizedAmount(cycle?.pricing_scheme?.fixed_price);
    return {
      tenure_type: clean(cycle?.tenure_type, 30).toLowerCase() || 'regular',
      sequence: safeCount(cycle?.sequence, 1, 1, 100),
      total_cycles: Math.max(0, safeCount(cycle?.total_cycles, 0, 0, 999)),
      ...frequency,
      amount,
    };
  });
  const regular = [...cycles].reverse().find((cycle) => cycle.tenure_type === 'regular') || cycles.at(-1) || null;
  const totalCycles = Number(regular?.total_cycles || 0);
  const setupFee = normalizedAmount(plan.payment_preferences?.setup_fee);
  return {
    id: clean(plan.id, 255),
    product_id: clean(plan.product_id, 255) || null,
    name: clean(plan.name, 240) || 'Plan PayPal',
    description: clean(plan.description, 1_000) || null,
    status: clean(plan.status, 40).toLowerCase() || 'unknown',
    billing_type: totalCycles > 0 ? 'installment' : 'recurring',
    interval_unit: regular?.interval_unit || null,
    interval_count: regular?.interval_count || null,
    installment_count: totalCycles > 0 ? totalCycles : null,
    amount: regular?.amount || normalizedAmount(),
    unit_amount_minor: regular?.amount?.minor || 0,
    currency: regular?.amount?.currency || setupFee.currency,
    setup_fee_minor: setupFee.minor,
    billing_cycles: cycles,
    payment_failure_threshold: safeCount(plan.payment_preferences?.payment_failure_threshold, 0, 0, 999),
    auto_bill_outstanding: Boolean(plan.payment_preferences?.auto_bill_outstanding),
    tax_percentage: clean(String(plan.taxes?.percentage ?? ''), 30) || null,
    create_time: clean(plan.create_time, 80) || null,
    update_time: clean(plan.update_time || plan.create_time, 80) || null,
  };
}

export function normalizePayPalSubscription(subscription = {}) {
  const lastPayment = subscription.billing_info?.last_payment || {};
  const outstanding = normalizedAmount(subscription.billing_info?.outstanding_balance);
  const lastAmount = normalizedAmount(lastPayment.amount);
  const cycleExecutions = (Array.isArray(subscription.billing_info?.cycle_executions)
    ? subscription.billing_info.cycle_executions
    : []).map((cycle) => ({
    tenure_type: clean(cycle?.tenure_type, 30).toLowerCase() || null,
    sequence: safeCount(cycle?.sequence, 0, 0, 100),
    cycles_completed: safeCount(cycle?.cycles_completed, 0, 0, 999),
    cycles_remaining: safeCount(cycle?.cycles_remaining, 0, 0, 999),
    current_pricing_scheme_version: safeCount(cycle?.current_pricing_scheme_version, 0, 0, 999),
  }));
  return {
    id: clean(subscription.id, 255),
    plan_id: clean(subscription.plan_id, 255) || null,
    custom_id: clean(subscription.custom_id, 255) || null,
    status: clean(subscription.status, 60).toLowerCase() || 'unknown',
    status_change_note: clean(subscription.status_change_note, 500) || null,
    quantity: Math.max(1, safeCount(subscription.quantity, 1, 1, 1_000_000)),
    subscriber: {
      email_address: clean(subscription.subscriber?.email_address, 200).toLowerCase() || null,
      payer_id: clean(subscription.subscriber?.payer_id, 255) || null,
      name: normalizedName(subscription.subscriber?.name),
    },
    shipping_address: subscription.shipping_address ? {
      country_code: clean(subscription.shipping_address?.address?.country_code, 2).toUpperCase() || null,
    } : null,
    start_time: clean(subscription.start_time, 80) || null,
    create_time: clean(subscription.create_time, 80) || null,
    update_time: clean(subscription.update_time || subscription.create_time, 80) || null,
    next_billing_time: clean(subscription.billing_info?.next_billing_time, 80) || null,
    last_payment_time: clean(lastPayment.time, 80) || null,
    last_payment: lastAmount,
    outstanding_balance: outstanding,
    failed_payments_count: safeCount(subscription.billing_info?.failed_payments_count, 0, 0, 1_000_000),
    cycle_executions: cycleExecutions,
  };
}

export function normalizePayPalInvoice(invoice = {}) {
  const detail = invoice.detail || {};
  return {
    id: clean(invoice.id, 255),
    status: clean(invoice.status, 60).toLowerCase() || 'unknown',
    invoice_number: clean(detail.invoice_number, 120) || null,
    reference: clean(detail.reference, 255) || null,
    invoice_date: clean(detail.invoice_date, 40) || null,
    due_date: clean(detail.due_date, 40) || null,
    currency: clean(detail.currency_code || invoice.amount?.currency_code, 8).toLowerCase() || 'eur',
    amount: normalizedAmount(invoice.amount),
    due_amount: normalizedAmount(invoice.due_amount),
    payer: {
      email_address: clean(invoice.primary_recipients?.[0]?.billing_info?.email_address, 200).toLowerCase() || null,
      name: normalizedName(invoice.primary_recipients?.[0]?.billing_info?.name),
    },
    create_time: clean(invoice.create_time, 80) || null,
    update_time: clean(invoice.update_time || invoice.create_time, 80) || null,
  };
}

function normalizer(resource) {
  if (resource === 'products') return normalizePayPalProduct;
  if (resource === 'plans') return normalizePayPalPlan;
  if (resource === 'subscriptions') return normalizePayPalSubscription;
  if (resource === 'invoices') return normalizePayPalInvoice;
  throw new Error('paypal_resource_invalid');
}

async function expandPayPalPlans(plans, getImpl, requestOptions) {
  const expanded = new Array(plans.length);
  let cursor = 0;
  async function worker() {
    while (cursor < plans.length) {
      const index = cursor;
      cursor += 1;
      const plan = plans[index];
      if (Array.isArray(plan?.billing_cycles) && plan.billing_cycles.length) {
        expanded[index] = plan;
        continue;
      }
      const planId = clean(plan?.id, 255);
      expanded[index] = planId ? await getImpl(`/v1/billing/plans/${encodeURIComponent(planId)}`, [], requestOptions) : plan;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, plans.length) }, worker));
  return expanded;
}

export async function getPayPalResourcePage(resource, options = {}) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) throw new Error('paypal_resource_invalid');
  const page = safeCount(options.page, 1, 1, 10_000);
  const pageSize = safeCount(options.pageSize, config.pageSize, 1, config.pageSize);
  const getImpl = options.getImpl || paypalGet;
  const requestOptions = options.paypalOptions || options;
  const payload = await getImpl(config.path, [
    ['page_size', pageSize],
    ['page', page],
    ['total_required', 'true'],
  ], requestOptions);
  let source = Array.isArray(payload?.[config.collection]) ? payload[config.collection] : [];
  if (resource === 'plans' && options.includeDetails !== false) {
    source = await expandPayPalPlans(source, getImpl, requestOptions);
  }
  const data = source.map(normalizer(resource)).filter((item) => item.id);
  const totalItems = Number.isFinite(Number(payload?.total_items)) ? Number(payload.total_items) : null;
  const totalPages = Number.isFinite(Number(payload?.total_pages))
    ? Math.max(1, Number(payload.total_pages))
    : totalItems == null ? null : Math.max(1, Math.ceil(totalItems / pageSize));
  const linkedNext = Array.isArray(payload?.links) && payload.links.some((link) => link?.rel === 'next');
  const hasMore = totalPages == null ? linkedNext || source.length === pageSize : page < totalPages;
  return {
    connected: true,
    provider: 'paypal',
    resource,
    page,
    page_size: pageSize,
    total_items: totalItems,
    total_pages: totalPages,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
    data,
  };
}

export async function getPayPalResources(resource, options = {}) {
  if (!PAYPAL_READ_RESOURCES.includes(resource)) throw new Error('paypal_resource_invalid');
  const fetchPage = options.fetchPage || getPayPalResourcePage;
  const maxPages = safeCount(options.maxPages, 100, 1, 1_000);
  const data = [];
  let page = 1;
  let last = null;
  for (; page <= maxPages; page += 1) {
    last = await fetchPage(resource, { ...options, page });
    data.push(...(Array.isArray(last?.data) ? last.data : []));
    if (!last?.has_more) break;
  }
  const truncated = Boolean(last?.has_more && page > maxPages);
  return {
    connected: true,
    provider: 'paypal',
    resource,
    data,
    pages_fetched: Math.min(page, maxPages),
    total_items: last?.total_items ?? data.length,
    truncated,
  };
}
