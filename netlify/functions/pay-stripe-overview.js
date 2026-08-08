import Stripe from 'stripe';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

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
  return {
    id: intent.id,
    created: intent.created,
    amount: Number(intent.amount_received || intent.amount || 0),
    refunded,
    currency: clean(intent.currency, 8).toLowerCase() || 'eur',
    status: refunded > 0 ? 'Remboursé' : statusLabel(intent.status),
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
    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });
    const since = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SECONDS;
    const [account, balance, paymentIntents, products] = await Promise.all([
      stripe.accounts.retrieve(),
      stripe.balance.retrieve(),
      stripe.paymentIntents.list({
        created: { gte: since },
        limit: 100,
        expand: ['data.latest_charge'],
      }),
      stripe.products.list({ active: true, limit: 100 }),
    ]);

    const intents = paymentIntents.data || [];
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
        products: (products.data || []).length,
        truncated: Boolean(paymentIntents.has_more || products.has_more),
      },
      transactions: transactionRows.slice(0, 50),
    });
  } catch (error) {
    console.error('pay-stripe-overview:', error);
    return json(502, { connected: false, error: 'stripe_unavailable' });
  }
};
