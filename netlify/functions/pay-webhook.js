import { getPayPalConfig, paypalGet } from './lib/pay-paypal.mjs';
import { payPalObjectBelongsToPay, payScopeSummary, stripeObjectBelongsToPay } from './lib/pay-forward-scope.mjs';
import { preparePayWebhookEvent, summarizePreparedWebhook } from './lib/pay-webhook-projection.mjs';
import { payWebhookMode, verifyPayPalWebhookSignature, verifyStripeWebhookSignature } from './lib/pay-webhook-security.mjs';
import { storePreparedPayWebhook } from './lib/pay-webhook-storage.mjs';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const MAX_BODY_BYTES = 1_000_000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function objectId(value) {
  return clean(typeof value === 'string' ? value : value?.id, 255);
}

async function stripeGet(path) {
  const key = clean(process.env.STRIPE_PAY_SECRET_KEY || process.env.STRIPE_SECRET_KEY, 300);
  if (!key) throw new Error('stripe_secret_missing');
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`stripe_scope_http_${response.status}`);
  return data;
}

async function enrichStripeScope(event) {
  if (stripeObjectBelongsToPay(event)) return event;
  const object = event?.data?.object || {};
  let parent = null;
  const paymentIntentId = objectId(object.payment_intent);
  const subscriptionId = objectId(object.subscription);
  if (paymentIntentId.startsWith('pi_')) {
    parent = await stripeGet(`payment_intents/${encodeURIComponent(paymentIntentId)}`);
  } else if (subscriptionId.startsWith('sub_')) {
    parent = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`);
  } else {
    const chargeId = objectId(object.charge);
    if (chargeId.startsWith('ch_')) {
      const charge = await stripeGet(`charges/${encodeURIComponent(chargeId)}`);
      const intentId = objectId(charge.payment_intent);
      parent = intentId.startsWith('pi_') ? await stripeGet(`payment_intents/${encodeURIComponent(intentId)}`) : charge;
    }
  }
  if (parent?.metadata) object.metadata = { ...(object.metadata || {}), ...parent.metadata };
  return event;
}

async function enrichPayPalScope(event) {
  const resource = event?.resource || {};
  if (payPalObjectBelongsToPay(resource)) return event;
  const type = clean(event?.event_type, 180).toUpperCase();
  const subscriptionId = objectId(resource.billing_agreement_id)
    || (type.startsWith('BILLING.SUBSCRIPTION.') ? objectId(resource) : '');
  if (subscriptionId) {
    const subscription = await paypalGet(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (subscription?.custom_id) resource.custom_id = subscription.custom_id;
    if (subscription?.subscriber && !resource.subscriber) resource.subscriber = subscription.subscriber;
  }
  return event;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const provider = clean(new URL(req.url).searchParams.get('provider'), 20).toLowerCase();
  if (!['stripe', 'paypal'].includes(provider)) return json(400, { error: 'provider_invalid' });
  const rawBody = await req.text();
  if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json(413, { error: 'payload_invalid' });
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'json_invalid' });
  }

  try {
    let verified = false;
    if (provider === 'stripe') {
      const secret = clean(process.env.PAY_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_PAY_WEBHOOK_SECRET, 1_000);
      verified = verifyStripeWebhookSignature(rawBody, req.headers.get('stripe-signature'), secret);
    } else {
      verified = await verifyPayPalWebhookSignature(req, event);
    }
    if (!verified) return json(400, { error: 'signature_invalid' });

    const enriched = provider === 'stripe' ? await enrichStripeScope(event) : await enrichPayPalScope(event);
    const belongsToPay = provider === 'stripe'
      ? stripeObjectBelongsToPay(enriched)
      : payPalObjectBelongsToPay(enriched.resource || {});
    if (!belongsToPay) return json(200, { received: true, ignored: true, reason: 'outside_forward_pay_scope', scope: payScopeSummary() });

    const prepared = preparePayWebhookEvent(provider, enriched, {
      rawBody,
      livemode: payWebhookMode(provider) === 'live',
    });
    const stored = await storePreparedPayWebhook(prepared);
    console.info('pay-webhook:', summarizePreparedWebhook(prepared), stored);
    return json(200, { received: true, ...stored });
  } catch (error) {
    console.error('pay-webhook:', provider, clean(error?.message, 180));
    const missing = /(?:secret|webhook|Supabase|configured|configur)/i.test(String(error?.message || ''));
    return json(missing ? 503 : 500, { error: missing ? 'pay_webhook_not_configured' : 'pay_webhook_failed' });
  }
};
