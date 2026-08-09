import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { payCutoverUnix, payScopeSummary, stripeObjectBelongsToPay } from './lib/pay-forward-scope.mjs';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

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

async function stripeGet(secretKey, path, parameters = []) {
  const search = new URLSearchParams();
  for (const [key, value] of parameters) search.append(key, String(value));
  const suffix = search.size ? `?${search.toString()}` : '';
  const response = await fetch(`${STRIPE_API_BASE}/${path}${suffix}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`stripe_http_${response.status}:${clean(data?.error?.type, 60)}`);
  return data;
}

function amountByCurrency(rows, field) {
  return rows.reduce((totals, row) => {
    const currency = clean(row.currency, 8).toLowerCase() || 'eur';
    totals[currency] = (totals[currency] || 0) + Math.max(0, Number(row[field] || 0));
    return totals;
  }, {});
}

function statusLabel(status) {
  if (status === 'succeeded') return 'Réussi';
  if (status === 'processing' || status === 'requires_capture') return 'En attente';
  if (status === 'canceled') return 'Annulé';
  if (status === 'requires_action') return 'Action requise';
  return 'Incomplet';
}

function paymentSource(intent) {
  const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const billing = charge?.billing_details || {};
  const metadata = intent.metadata || {};
  const customer = clean(billing.name || metadata.customer_name || metadata.customer_first_name || '', 100);
  const email = clean(billing.email || intent.receipt_email || metadata.customer_email || '', 180).toLowerCase();
  const card = charge?.payment_method_details?.card;
  return {
    customer: customer || email || 'Client Stripe',
    email,
    payment_method: card ? `${clean(card.brand, 24)} •••• ${clean(card.last4, 4)}` : clean(charge?.payment_method_details?.type, 40) || 'Stripe',
  };
}

function transaction(intent) {
  const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const refunded = Number(charge?.amount_refunded || 0);
  const amount = Number(intent.amount_received || intent.amount || 0);
  const refundable = Math.max(0, amount - refunded);
  return {
    id: intent.id,
    created: intent.created,
    amount,
    refunded,
    refundable,
    can_refund: intent.status === 'succeeded' && refundable > 0,
    currency: clean(intent.currency, 8).toLowerCase() || 'eur',
    status: refunded > 0 ? (refundable > 0 ? 'Partiel' : 'Remboursé') : statusLabel(intent.status),
    description: clean(intent.description || intent.metadata?.offer_name || intent.metadata?.offer_slug || '', 160) || 'Paiement Stripe',
    ...paymentSource(intent),
  };
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Méthode non autorisée' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });

  const secretKey = clean(process.env.STRIPE_PAY_SECRET_KEY || process.env.STRIPE_SECRET_KEY, 300);
  if (!secretKey) return json(503, { connected: false, error: 'stripe_secret_missing' });

  try {
    const until = Math.floor(Date.now() / 1000);
    const since = Math.max(until - THIRTY_DAYS_SECONDS, payCutoverUnix());
    const [account, balance, paymentIntents, products] = await Promise.all([
      stripeGet(secretKey, 'account'),
      stripeGet(secretKey, 'balance'),
      stripeGet(secretKey, 'payment_intents', [
        ['created[gte]', since],
        ['limit', 100],
        ['expand[]', 'data.latest_charge'],
      ]),
      stripeGet(secretKey, 'products', [
        ['active', true],
        ['limit', 100],
      ]),
    ]);

    const intents = (paymentIntents.data || []).filter((item) => stripeObjectBelongsToPay(item));
    const scopedProducts = (products.data || []).filter((item) => stripeObjectBelongsToPay(item));
    const succeeded = intents.filter((item) => item.status === 'succeeded');
    const pending = intents.filter((item) => item.status === 'processing' || item.status === 'requires_capture');
    const refunded = intents.filter((item) => {
      const charge = item.latest_charge && typeof item.latest_charge === 'object' ? item.latest_charge : null;
      return Number(charge?.amount_refunded || 0) > 0;
    });
    const defaultCurrency = clean(account.default_currency, 8).toLowerCase() || 'eur';
    const accountName = clean(account.settings?.dashboard?.display_name || account.business_profile?.name || '', 120) || 'Compte Stripe';
    const transactionRows = intents.map(transaction);

    return json(200, {
      connected: true,
      mode: balance.livemode ? 'live' : 'test',
      writes_enabled: !balance.livemode || process.env.PAY_STRIPE_LIVE_WRITES_ENABLED === 'true',
      account: {
        name: accountName,
        country: clean(account.country, 4).toUpperCase(),
        currency: defaultCurrency,
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
      },
      balance: {
        available: amountByCurrency(balance.available || [], 'amount'),
        pending: amountByCurrency(balance.pending || [], 'amount'),
      },
      metrics: {
        revenue: amountByCurrency(succeeded, 'amount_received'),
        pending_amount: amountByCurrency(pending, 'amount'),
        refunded_amount: amountByCurrency(transactionRows, 'refunded'),
        total: intents.length,
        successful: succeeded.length,
        pending: pending.length,
        refunded: refunded.length,
        products: scopedProducts.length,
        truncated: Boolean(paymentIntents.has_more || products.has_more),
      },
      transaction_window: {
        since,
        until,
        truncated: Boolean(paymentIntents.has_more),
      },
      scope: payScopeSummary(),
      transactions: transactionRows,
    });
  } catch (error) {
    console.error('pay-stripe-overview:', error);
    return json(502, { connected: false, error: 'stripe_unavailable' });
  }
};
