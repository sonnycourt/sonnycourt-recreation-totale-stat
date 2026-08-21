import Stripe from 'stripe';
import { supabaseGet } from './supabase-rest.mjs';

export const MC2_STRIPE_PRODUCT_ID = process.env.MC2_STRIPE_PRODUCT_ID || 'prod_V2GyqoqalbZxqn';
export const MC2_STRIPE_ENTRY_PRICE_ID = process.env.MC2_STRIPE_ENTRY_PRICE_ID || 'price_1U2CQaCkb0oA7GrjzVHLkKVh';
// No fallback is allowed for the new 297 EUR installment Price. The previous
// live IDs belonged to the retired 150 + 11 x 197 schedule; silently reusing
// them would create a contract/Stripe mismatch. Configure the recurring Price
// explicitly after its amount and tax behavior have been verified in Stripe.
export const MC2_STRIPE_INSTALLMENT_PRICE_ID = String(
  process.env.MC2_STRIPE_INSTALLMENT_PRICE_ID || '',
).trim();
export const MC2_CONTRACT_TOTAL_CENTS = 123500;
export const MC2_ENTRY_PAYMENT_CENTS = 4700;
export const MC2_INSTALLMENT_CENTS = 29700;
export const MC2_INSTALLMENT_COUNT = 4;
export const MC2_INSTALLMENT_FIRST_OFFSET_DAYS = 14;
export const MC2_INSTALLMENT_INTERVAL_DAYS = 21;
export const MC2_INSTALLMENT_OFFSETS_DAYS = Object.freeze([14, 35, 56, 77]);
export const MC2_PAYMENT_PLAN = '47_now_then_4x297_days_14_35_56_77';

// Offre affichée directement sous la masterclass. L'ancien plan ci-dessus
// reste supporté pour les sessions Stripe et webhooks déjà créés.
export const MC2_SESSION_MONTHLY_PLAN = '197_now_then_11x197_monthly';
export const MC2_SESSION_ONE_TIME_PLAN = '1997_once';
export const MC2_SESSION_MONTHLY_PAYMENT_CENTS = 19700;
export const MC2_SESSION_MONTHLY_PAYMENT_COUNT = 12;
export const MC2_SESSION_MONTHLY_TOTAL_CENTS = 236400;
export const MC2_SESSION_ONE_TIME_CENTS = 199700;
export const MC2_SESSION_REMAINING_PAYMENT_COUNT = 11;

const MC2_SESSION_PRICE_SPECS = Object.freeze({
  monthly_entry: Object.freeze({
    env: 'MC2_STRIPE_MONTHLY_ENTRY_PRICE_ID',
    lookupKey: 'es2_mc2_12x197_entry_live_v1',
    amount: MC2_SESSION_MONTHLY_PAYMENT_CENTS,
    type: 'one_time',
    nickname: 'ES2 — première mensualité 197 EUR',
  }),
  monthly_recurring: Object.freeze({
    env: 'MC2_STRIPE_MONTHLY_RECURRING_PRICE_ID',
    lookupKey: 'es2_mc2_11x197_recurring_live_v1',
    amount: MC2_SESSION_MONTHLY_PAYMENT_CENTS,
    type: 'recurring',
    nickname: 'ES2 — mensualité récurrente 197 EUR',
  }),
  one_time: Object.freeze({
    env: 'MC2_STRIPE_ONE_TIME_PRICE_ID',
    lookupKey: 'es2_mc2_1997_once_live_v1',
    amount: MC2_SESSION_ONE_TIME_CENTS,
    type: 'one_time',
    nickname: 'ES2 — paiement unique 1 997 EUR',
  }),
});

export function mc2SessionPlan(value) {
  const plan = String(value || '').trim().toLowerCase();
  return plan === 'once' || plan === MC2_SESSION_ONE_TIME_PLAN
    ? MC2_SESSION_ONE_TIME_PLAN
    : MC2_SESSION_MONTHLY_PLAN;
}

export function mc2SessionPlanConfig(value) {
  const paymentPlan = mc2SessionPlan(value);
  if (paymentPlan === MC2_SESSION_ONE_TIME_PLAN) {
    return Object.freeze({
      paymentPlan,
      initialPaymentCents: MC2_SESSION_ONE_TIME_CENTS,
      contractualTotalCents: MC2_SESSION_ONE_TIME_CENTS,
      installmentCount: 1,
      priceKey: 'one_time',
      requiresFuturePayments: false,
    });
  }
  return Object.freeze({
    paymentPlan,
    initialPaymentCents: MC2_SESSION_MONTHLY_PAYMENT_CENTS,
    contractualTotalCents: MC2_SESSION_MONTHLY_TOTAL_CENTS,
    installmentCount: MC2_SESSION_MONTHLY_PAYMENT_COUNT,
    priceKey: 'monthly_entry',
    requiresFuturePayments: true,
  });
}

export function mc2SessionPaymentSchedule(value) {
  const plan = mc2SessionPlanConfig(value);
  if (!plan.requiresFuturePayments) {
    return [{ label: 'Paiement unique', due_offset_months: 0, amount_cents: plan.initialPaymentCents, installments: 1 }];
  }
  return [
    { label: 'Première mensualité', due_offset_months: 0, amount_cents: MC2_SESSION_MONTHLY_PAYMENT_CENTS, installments: 1 },
    { label: 'Mensualités suivantes', due_offset_months: 1, amount_cents: MC2_SESSION_MONTHLY_PAYMENT_CENTS, installments: MC2_SESSION_REMAINING_PAYMENT_COUNT },
  ];
}

export function isValidMc2SessionPrice(price, key) {
  const spec = MC2_SESSION_PRICE_SPECS[key];
  if (!spec) return false;
  const recurringOk = spec.type === 'recurring'
    ? price?.type === 'recurring'
      && price?.recurring?.interval === 'month'
      && Number(price?.recurring?.interval_count || 0) === 1
    : price?.type === 'one_time';
  return Boolean(
    price
    && price.active === true
    && stripeId(price.product) === MC2_STRIPE_PRODUCT_ID
    && String(price.currency || '').toLowerCase() === 'eur'
    && Number(price.unit_amount || 0) === spec.amount
    && price.tax_behavior === 'inclusive'
    && recurringOk
  );
}

export async function ensureMc2SessionPrices(stripe = mc2Stripe()) {
  const configured = {};
  for (const [key, spec] of Object.entries(MC2_SESSION_PRICE_SPECS)) {
    const configuredId = String(process.env[spec.env] || '').trim();
    if (!configuredId) continue;
    const price = await stripe.prices.retrieve(configuredId);
    if (!isValidMc2SessionPrice(price, key)) throw new Error(`mc2_${key}_price_mismatch`);
    configured[key] = price;
  }

  const missing = Object.entries(MC2_SESSION_PRICE_SPECS).filter(([key]) => !configured[key]);
  if (missing.length) {
    const listed = await stripe.prices.list({
      lookup_keys: missing.map(([, spec]) => spec.lookupKey),
      limit: 100,
    });
    for (const [key, spec] of missing) {
      const existing = listed.data.find((price) => price.lookup_key === spec.lookupKey && price.active);
      if (existing) {
        if (!isValidMc2SessionPrice(existing, key)) throw new Error(`mc2_${key}_price_mismatch`);
        configured[key] = existing;
        continue;
      }
      const created = await stripe.prices.create({
        product: MC2_STRIPE_PRODUCT_ID,
        currency: 'eur',
        unit_amount: spec.amount,
        tax_behavior: 'inclusive',
        nickname: spec.nickname,
        lookup_key: spec.lookupKey,
        transfer_lookup_key: true,
        ...(spec.type === 'recurring'
          ? { recurring: { interval: 'month', interval_count: 1 } }
          : {}),
        metadata: {
          system: 'es2_mc2',
          catalog_version: 'mc2-session-v1',
          price_role: key,
        },
      }, { idempotencyKey: `mc2-session-price:${spec.lookupKey}:v1` });
      if (!isValidMc2SessionPrice(created, key)) throw new Error(`mc2_${key}_price_creation_mismatch`);
      configured[key] = created;
    }
  }
  return Object.freeze({
    monthlyEntry: configured.monthly_entry,
    monthlyRecurring: configured.monthly_recurring,
    oneTime: configured.one_time,
  });
}

export function isValidMc2EntryPrice(price) {
  return Boolean(
    price
    && price.active === true
    && stripeId(price.product) === MC2_STRIPE_PRODUCT_ID
    && price.type === 'one_time'
    && String(price.currency || '').toLowerCase() === 'eur'
    && Number(price.unit_amount || 0) === MC2_ENTRY_PAYMENT_CENTS
    && price.tax_behavior === 'inclusive'
  );
}

export function isValidMc2InstallmentPrice(price) {
  return Boolean(
    price
    && price.active === true
    && stripeId(price.product) === MC2_STRIPE_PRODUCT_ID
    && price.type === 'recurring'
    && String(price.currency || '').toLowerCase() === 'eur'
    && Number(price.unit_amount || 0) === MC2_INSTALLMENT_CENTS
    && price.tax_behavior === 'inclusive'
    && price.recurring?.interval === 'month'
    && Number(price.recurring?.interval_count || 0) === 1
  );
}

let stripeClient;

export function mc2Stripe() {
  // MC2 uses its own key first so activating the new funnel never requires
  // replacing the Stripe key used by the existing production integrations.
  const secretKey = String(
    process.env.STRIPE_MC2_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '',
  ).trim();
  if (!secretKey) throw new Error('stripe_secret_missing');
  if (!stripeClient) stripeClient = new Stripe(secretKey, { maxNetworkRetries: 2 });
  return stripeClient;
}

export function mc2StripePublishableKey() {
  const key = String(
    process.env.STRIPE_MC2_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || '',
  ).trim();
  if (!key) throw new Error('stripe_publishable_key_missing');
  return key;
}

export function cleanMc2Token(value) {
  return typeof value === 'string' ? value.trim().slice(0, 128) : '';
}

export async function loadMc2Registration(token, select = '*') {
  const safeToken = cleanMc2Token(token);
  if (!safeToken) return null;
  const result = await supabaseGet(
    `mc2_registrations?token=eq.${encodeURIComponent(safeToken)}&select=${encodeURIComponent(select)}&limit=1`,
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

export function mc2PublicOrigin(req) {
  const configured = String(process.env.MC2_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export function stripeId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}
