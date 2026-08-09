import { createHash } from 'node:crypto';

export const PAY_CATALOG_CONFIRMATIONS = Object.freeze({
  product: 'PUBLIER PRODUIT',
  checkout: 'PUBLIER CHECKOUT',
  discount: 'PUBLIER REDUCTION',
});

const BILLING_TYPES = new Set(['one_time', 'recurring', 'payment_plan']);
const INTERVALS = new Set(['day', 'week', 'month', 'year']);
const INTERVAL_LIMITS = Object.freeze({ day: 1095, week: 156, month: 36, year: 3 });

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function currency(value) {
  const code = clean(value, 8).toLowerCase();
  if (!/^[a-z]{3}$/.test(code)) throw new Error('pay_catalog_currency_invalid');
  return code;
}

function currencyDigits(code) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code.toUpperCase() })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    throw new Error('pay_catalog_currency_invalid');
  }
}

function minor(value, code, { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) throw new Error('pay_catalog_amount_invalid');
  const factor = 10 ** currencyDigits(code);
  const result = Math.round(amount * factor);
  if (!Number.isSafeInteger(result) || result < 0 || (!allowZero && result === 0)) throw new Error('pay_catalog_amount_invalid');
  return result;
}

function idempotencyKey(value) {
  const key = clean(value, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/.test(key)) throw new Error('pay_catalog_idempotency_invalid');
  return key;
}

function metadata(source = {}) {
  const result = { pay_route: 'pay', pay_origin: 'sonnycourt_pay', source: 'sonnycourt_pay' };
  for (const key of ['checkout_id', 'offer_slug', 'funnel', 'payment_plan_id']) {
    const value = clean(source[key], 200);
    if (value) result[key] = value;
  }
  return result;
}

function interval(input = {}) {
  const unit = clean(input.interval_unit || input.interval, 20).toLowerCase() || 'month';
  const count = integer(input.interval_count, 1);
  if (!INTERVALS.has(unit) || count < 1 || count > INTERVAL_LIMITS[unit]) throw new Error('pay_catalog_interval_invalid');
  return { interval: unit, interval_count: count };
}

function httpsUrl(value) {
  const raw = clean(value, 1_000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
      throw new Error('pay_catalog_success_url_invalid');
    }
    return parsed.toString();
  } catch {
    throw new Error('pay_catalog_success_url_invalid');
  }
}

function productPlan(input) {
  const name = clean(input.name, 120);
  const description = clean(input.description, 600);
  const billingType = clean(input.billing_type || input.billingType, 30).replace('-', '_');
  if (!name) throw new Error('pay_catalog_name_required');
  if (!BILLING_TYPES.has(billingType) || billingType === 'payment_plan') throw new Error('pay_catalog_product_billing_invalid');
  const code = currency(input.currency);
  const priceData = {
    currency: code,
    unit_amount: minor(input.amount, code),
    metadata: metadata(input.metadata),
  };
  if (billingType === 'recurring') priceData.recurring = interval(input);
  return {
    kind: 'product',
    operations: [{
      id: 'product',
      stripe_method: 'products.create',
      idempotency_suffix: 'product',
      params: {
        name,
        ...(description ? { description } : {}),
        metadata: metadata(input.metadata),
        default_price_data: priceData,
      },
    }],
  };
}

function paymentPlanPhases(input, code) {
  const plan = input.plan || {};
  const deposit = minor(plan.deposit ?? 0, code, { allowZero: true });
  const bridgeAmount = minor(plan.bridge_amount ?? plan.bridgeAmount ?? 0, code, { allowZero: true });
  const bridgeDelayDays = integer(plan.bridge_delay_days ?? plan.bridgeDelayDays, 0);
  const installments = integer(plan.installments, 0);
  const installmentAmount = minor(input.amount, code);
  if (deposit < 1) throw new Error('pay_catalog_deposit_required');
  if (bridgeAmount > 0 && (bridgeDelayDays < 1 || bridgeDelayDays > 365)) throw new Error('pay_catalog_bridge_delay_invalid');
  if (installments < 1 || installments > 60) throw new Error('pay_catalog_installments_invalid');
  const phases = [];
  if (deposit > 0) phases.push({ sequence: 1, kind: 'immediate', due_offset_days: 0, count: 1, amount_minor: deposit });
  if (bridgeAmount > 0) phases.push({ sequence: phases.length + 1, kind: 'bridge', due_offset_days: bridgeDelayDays, count: 1, amount_minor: bridgeAmount });
  phases.push({
    sequence: phases.length + 1,
    kind: 'installments',
    starts_after_days: bridgeAmount > 0 ? bridgeDelayDays : 0,
    interval: 'month',
    interval_count: 1,
    count: installments,
    amount_minor: installmentAmount,
  });
  return {
    phases,
    total_minor: deposit + bridgeAmount + installments * installmentAmount,
    installment_count: installments,
  };
}

function checkoutPlan(input) {
  const name = clean(input.name, 120);
  const description = clean(input.description, 600);
  const slug = clean(input.slug, 180).toLowerCase();
  const billingType = clean(input.billing || input.billing_type, 30).replace('-', '_');
  if (!name) throw new Error('pay_catalog_name_required');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('pay_catalog_slug_invalid');
  if (!BILLING_TYPES.has(billingType)) throw new Error('pay_catalog_checkout_billing_invalid');
  const code = currency(input.currency);
  const routing = metadata({ ...input.metadata, checkout_id: input.metadata?.checkout_id || slug });

  if (billingType === 'payment_plan') {
    const schedule = paymentPlanPhases(input, code);
    const redirect = httpsUrl(input.success_url);
    return {
      kind: 'checkout',
      flow: 'central_payment_plan',
      schedule,
      operations: [{
        id: 'initial_payment_link',
        stripe_method: 'paymentLinks.create',
        idempotency_suffix: 'initial-payment-link',
        params: {
          line_items: [{
            quantity: 1,
            price_data: {
              currency: code,
              unit_amount: schedule.phases[0]?.kind === 'immediate' ? schedule.phases[0].amount_minor : 0,
              product_data: { name, ...(description ? { description } : {}), metadata: routing },
            },
          }],
          metadata: {
            ...routing,
            installment_count: String(schedule.installment_count),
            payment_plan_total_minor: String(schedule.total_minor),
          },
          allow_promotion_codes: Boolean(input.allow_promotion_codes),
          after_completion: redirect
            ? { type: 'redirect', redirect: { url: redirect } }
            : { type: 'hosted_confirmation', hosted_confirmation: { custom_message: clean(input.confirmation_message, 500) || 'Premier paiement confirmé.' } },
        },
      }],
      continuation: {
        trigger: 'checkout.session.completed',
        handler: 'pay_universal_webhook',
        action: 'create_payment_plan_schedule',
        phases: schedule.phases,
      },
    };
  }

  const priceData = {
    currency: code,
    unit_amount: minor(input.amount, code),
    product_data: { name, ...(description ? { description } : {}), metadata: routing },
  };
  if (billingType === 'recurring') priceData.recurring = interval(input);
  const redirect = httpsUrl(input.success_url);
  return {
    kind: 'checkout',
    flow: billingType,
    operations: [{
      id: 'payment_link',
      stripe_method: 'paymentLinks.create',
      idempotency_suffix: 'payment-link',
      params: {
        line_items: [{ quantity: 1, price_data: priceData }],
        metadata: routing,
        allow_promotion_codes: Boolean(input.allow_promotion_codes),
        after_completion: redirect
          ? { type: 'redirect', redirect: { url: redirect } }
          : { type: 'hosted_confirmation', hosted_confirmation: { custom_message: clean(input.confirmation_message, 500) || 'Paiement confirmé.' } },
      },
    }],
  };
}

function discountPlan(input) {
  const code = clean(input.code, 80).toUpperCase();
  const type = clean(input.type || input.discount_type, 30).toLowerCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) throw new Error('pay_catalog_discount_code_invalid');
  if (!['fixed', 'percentage'].includes(type)) throw new Error('pay_catalog_discount_type_invalid');
  const appliesOneTime = input.applies_one_time ?? input.appliesOneTime ?? true;
  const appliesRecurring = input.applies_recurring ?? input.appliesRecurring ?? false;
  if (!appliesOneTime && !appliesRecurring) throw new Error('pay_catalog_discount_scope_required');
  const coupon = {
    duration: appliesRecurring ? 'forever' : 'once',
    name: code,
    metadata: metadata(input.metadata),
  };
  if (type === 'percentage') {
    const percent = Number(input.value);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('pay_catalog_discount_value_invalid');
    coupon.percent_off = percent;
  } else {
    const codeCurrency = currency(input.currency);
    coupon.amount_off = minor(input.value, codeCurrency);
    coupon.currency = codeCurrency;
  }
  const expires = input.expires_at || input.expiresAt;
  const expiresAt = expires ? Math.floor(new Date(expires).getTime() / 1_000) : null;
  if (expires && !Number.isFinite(expiresAt)) throw new Error('pay_catalog_discount_expiry_invalid');
  const maxRedemptions = input.max_redemptions ?? input.maxRedemptions;
  const max = maxRedemptions == null || maxRedemptions === '' ? null : integer(maxRedemptions, 0);
  if (max !== null && max < 1) throw new Error('pay_catalog_discount_max_invalid');
  return {
    kind: 'discount',
    operations: [
      {
        id: 'coupon',
        stripe_method: 'coupons.create',
        idempotency_suffix: 'coupon',
        params: coupon,
      },
      {
        id: 'promotion_code',
        stripe_method: 'promotionCodes.create',
        idempotency_suffix: 'promotion-code',
        depends_on: ['coupon'],
        params: {
          code,
          promotion: { type: 'coupon', coupon: '$coupon.id' },
          ...(expiresAt ? { expires_at: expiresAt } : {}),
          ...(max ? { max_redemptions: max } : {}),
          restrictions: { first_time_transaction: Boolean(input.once_per_customer || input.oncePerCustomer) },
          metadata: metadata(input.metadata),
        },
      },
    ],
  };
}

export function preparePayCatalogCommand(kindValue, input = {}, options = {}) {
  const kind = clean(kindValue, 40).toLowerCase();
  if (!PAY_CATALOG_CONFIRMATIONS[kind]) throw new Error('pay_catalog_command_invalid');
  if (clean(options.confirmation, 40) !== PAY_CATALOG_CONFIRMATIONS[kind]) throw new Error('pay_catalog_confirmation_required');
  const baseKey = idempotencyKey(options.idempotencyKey);
  const plan = kind === 'product' ? productPlan(input) : kind === 'checkout' ? checkoutPlan(input) : discountPlan(input);
  const operations = plan.operations.map((operation) => ({
    ...operation,
    idempotency_key: `${baseKey}:${operation.idempotency_suffix}`.slice(0, 255),
  }));
  const fingerprint = createHash('sha256').update(JSON.stringify({ kind, operations, continuation: plan.continuation || null })).digest('hex');
  return {
    mode: 'dry_run',
    executable: false,
    live_write_flag: 'PAY_STRIPE_CATALOG_WRITES_ENABLED',
    confirmation: PAY_CATALOG_CONFIRMATIONS[kind],
    fingerprint,
    ...plan,
    operations,
  };
}
