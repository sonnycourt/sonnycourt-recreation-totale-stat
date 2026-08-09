import Stripe from 'stripe';
import { supabaseGet } from './supabase-rest.mjs';

export const MC2_STRIPE_PRODUCT_ID = process.env.MC2_STRIPE_PRODUCT_ID || 'prod_V2GyqoqalbZxqn';
export const MC2_STRIPE_ENTRY_PRICE_ID = process.env.MC2_STRIPE_ENTRY_PRICE_ID || 'price_1U2CQaCkb0oA7GrjzVHLkKVh';
export const MC2_STRIPE_D14_PRICE_ID = process.env.MC2_STRIPE_D14_PRICE_ID || 'price_1U2CR0Ckb0oA7GrjmobcXUPp';
export const MC2_STRIPE_MONTHLY_PRICE_ID = process.env.MC2_STRIPE_MONTHLY_PRICE_ID || 'price_1U2CQjCkb0oA7GrjUY1u2gcg';
export const MC2_STRIPE_FIRST_INVOICE_COUPON_ID = process.env.MC2_STRIPE_FIRST_INVOICE_COUPON_ID || 'es2_mc2_first_invoice_adjustment_47_v1';
export const MC2_CONTRACT_TOTAL_CENTS = 236400;

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
