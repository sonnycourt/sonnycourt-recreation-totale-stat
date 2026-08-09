import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPayPalConfig, paypalRequest } from './pay-paypal.mjs';

function clean(value, max = 4_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function constantTimeEqual(first, second) {
  const left = Buffer.from(String(first || ''), 'utf8');
  const right = Buffer.from(String(second || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyStripeWebhookSignature(rawBody, signatureHeader, secret, options = {}) {
  const header = clean(signatureHeader, 8_000);
  const secrets = (Array.isArray(secret) ? secret : String(secret || '').split(','))
    .map((item) => clean(item, 500)).filter(Boolean);
  if (!header || !secrets.length) return false;
  const parts = header.split(',').map((part) => part.split('=', 2));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => clean(value, 128));
  if (!Number.isSafeInteger(timestamp) || !signatures.length) return false;
  const now = Number(options.now ?? Date.now());
  const toleranceSeconds = Math.max(30, Number(options.toleranceSeconds || 300));
  if (Math.abs(now - timestamp * 1_000) > toleranceSeconds * 1_000) return false;
  const signedPayload = `${timestamp}.${String(rawBody || '')}`;
  return secrets.some((item) => {
    const expected = createHmac('sha256', item).update(signedPayload).digest('hex');
    return signatures.some((candidate) => constantTimeEqual(candidate, expected));
  });
}

export async function verifyPayPalWebhookSignature(req, event, options = {}) {
  const env = options.env || process.env;
  const webhookId = clean(env.PAYPAL_WEBHOOK_ID || env.PAYPAL_PAY_WEBHOOK_ID, 300);
  if (!webhookId) return false;
  const verification = await (options.requestImpl || paypalRequest)('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: clean(req.headers.get('paypal-auth-algo'), 100),
      cert_url: clean(req.headers.get('paypal-cert-url'), 1_000),
      transmission_id: clean(req.headers.get('paypal-transmission-id'), 300),
      transmission_sig: clean(req.headers.get('paypal-transmission-sig'), 2_000),
      transmission_time: clean(req.headers.get('paypal-transmission-time'), 100),
      webhook_id: webhookId,
      webhook_event: event,
    },
  }, options);
  return clean(verification?.verification_status, 40).toUpperCase() === 'SUCCESS';
}

export function payWebhookMode(provider, env = process.env) {
  if (provider === 'stripe') {
    const key = clean(env.STRIPE_PAY_SECRET_KEY || env.STRIPE_SECRET_KEY, 300);
    return key.startsWith('sk_test_') ? 'test' : 'live';
  }
  return getPayPalConfig(env).mode;
}
