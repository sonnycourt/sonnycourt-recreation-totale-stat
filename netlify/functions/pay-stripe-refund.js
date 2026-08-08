import crypto from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const ALLOWED_REASONS = new Set(['requested_by_customer', 'duplicate', 'fraudulent']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sameOrigin(req) {
  const origin = clean(req.headers.get('origin'), 300);
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

async function stripeRequest(secretKey, path, options = {}) {
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`stripe_http_${response.status}`);
    error.status = response.status;
    error.stripeCode = clean(data?.error?.code || data?.error?.type, 80);
    throw error;
  }
  return data;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });
  if (!sameOrigin(req)) return json(403, { error: 'Origine non autorisée' });
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json(415, { error: 'Format non autorisé' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Requête invalide' });
  }

  const paymentIntentId = clean(body?.payment_intent, 100);
  const confirmation = clean(body?.confirmation, 40);
  const reason = clean(body?.reason, 40) || 'requested_by_customer';
  const requestedAmount = body?.amount == null ? null : Number(body.amount);

  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return json(400, { error: 'Paiement invalide' });
  if (confirmation !== 'REMBOURSER') return json(400, { error: 'Confirmation requise' });
  if (!ALLOWED_REASONS.has(reason)) return json(400, { error: 'Motif invalide' });
  if (requestedAmount !== null && (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0)) {
    return json(400, { error: 'Montant invalide' });
  }

  const secretKey = clean(process.env.STRIPE_PAY_SECRET_KEY || process.env.STRIPE_SECRET_KEY, 300);
  if (!secretKey) return json(503, { error: 'stripe_secret_missing' });

  try {
    const intent = await stripeRequest(
      secretKey,
      `payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`,
    );
    const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (intent.status !== 'succeeded' || !charge) return json(409, { error: 'Paiement non remboursable' });

    const remaining = Math.max(0, Number(intent.amount_received || 0) - Number(charge.amount_refunded || 0));
    const amount = requestedAmount ?? remaining;
    if (!remaining) return json(409, { error: 'Paiement déjà remboursé' });
    if (amount > remaining) return json(409, { error: 'Montant supérieur au solde remboursable', remaining });

    const liveWritesEnabled = process.env.PAY_STRIPE_LIVE_WRITES_ENABLED === 'true';
    if (intent.livemode && !liveWritesEnabled) {
      return json(403, { error: 'stripe_writes_disabled' });
    }

    const clientNonce = clean(body?.idempotency_key, 120);
    const idempotencyKey = `pay-refund-${paymentIntentId}-${clientNonce || crypto.randomUUID()}`.slice(0, 255);
    const parameters = new URLSearchParams({
      payment_intent: paymentIntentId,
      amount: String(amount),
      reason,
      'metadata[source]': 'sonnycourt_pay',
    });
    const refund = await stripeRequest(secretKey, 'refunds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: parameters,
    });

    console.info('pay-stripe-refund: created', {
      refund_id: clean(refund.id, 100),
      payment_intent: paymentIntentId,
      amount,
      currency: clean(refund.currency || intent.currency, 8).toLowerCase(),
      livemode: Boolean(intent.livemode),
    });

    return json(200, {
      ok: true,
      refund: {
        id: clean(refund.id, 100),
        status: clean(refund.status, 40),
        amount: Number(refund.amount || amount),
        currency: clean(refund.currency || intent.currency, 8).toLowerCase(),
        payment_intent: paymentIntentId,
      },
    });
  } catch (error) {
    console.error('pay-stripe-refund:', error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? 409 : 502;
    return json(status, { error: 'stripe_refund_failed', code: clean(error?.stripeCode, 80) });
  }
};
