import Stripe from 'stripe';
import { supabaseGet } from './supabase-rest.mjs';

const OFFER_SLUGS = new Set([
  'first-consultation',
  'session-1',
  'pack-3',
  'pack-6',
  'membership-3',
  'membership-6',
  'membership-12',
]);

let client;

export function coachingStripe() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('stripe_secret_missing');
  if (!client) client = new Stripe(secretKey, { maxNetworkRetries: 2 });
  return client;
}

export function coachingStripePublishableKey() {
  const key = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
  if (!key) throw new Error('stripe_publishable_key_missing');
  return key;
}

export function validCoachingOfferSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return OFFER_SLUGS.has(slug) ? slug : null;
}

export async function loadCoachingOffer(slug) {
  const result = await supabaseGet(
    `coaching_offers?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&select=id,slug,name,sessions_count,price_cents,currency,duration_minutes,validity_days,stripe_product_id,stripe_price_id,metadata&limit=1`,
  );
  const offer = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!offer) throw new Error('coaching_offer_not_found');
  if (!offer.stripe_price_id) throw new Error('coaching_stripe_price_missing');
  return offer;
}

export async function authenticatedCoachingClient(req) {
  const authorization = req.headers.get('authorization') || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!authorization.startsWith('Bearer ') || !serviceKey || !supabaseUrl) return null;

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  const user = userResponse.ok ? await userResponse.json().catch(() => null) : null;
  if (!user?.id) return null;

  const result = await supabaseGet(
    `coaching_clients?auth_user_id=eq.${encodeURIComponent(user.id)}&select=id,auth_user_id,first_name,last_name,email,country,stripe_customer_id&limit=1`,
  );
  const coachingClient = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  return coachingClient ? { user, client: coachingClient } : null;
}

export function stripeSubscriptionStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'canceled') return 'cancelled';
  if (status === 'incomplete_expired' || status === 'unpaid') return 'expired';
  return ['trialing', 'active', 'past_due', 'paused'].includes(status) ? status : 'active';
}
