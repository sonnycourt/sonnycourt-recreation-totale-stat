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
