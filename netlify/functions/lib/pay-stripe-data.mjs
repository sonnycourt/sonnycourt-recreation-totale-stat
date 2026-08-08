const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export const PAY_STRIPE_RESOURCES = Object.freeze({
  account: { path: 'account', object: 'account', single: true, label: 'Compte' },
  balance: { path: 'balance', object: 'balance', single: true, label: 'Soldes' },
  balance_transactions: { path: 'balance_transactions', object: 'balance_transaction', created: true, label: 'Mouvements de solde' },
  customers: { path: 'customers', object: 'customer', created: true, label: 'Clients' },
  payment_intents: { path: 'payment_intents', object: 'payment_intent', created: true, expand: ['data.latest_charge'], label: 'Intentions de paiement' },
  setup_intents: { path: 'setup_intents', object: 'setup_intent', created: true, label: 'Intentions de configuration' },
  charges: { path: 'charges', object: 'charge', created: true, label: 'Paiements' },
  refunds: { path: 'refunds', object: 'refund', created: true, label: 'Remboursements' },
  disputes: { path: 'disputes', object: 'dispute', created: true, label: 'Litiges' },
  products: { path: 'products', object: 'product', created: true, label: 'Produits' },
  prices: { path: 'prices', object: 'price', created: true, expand: ['data.product'], label: 'Prix' },
  plans: { path: 'plans', object: 'plan', created: true, label: 'Plans historiques' },
  coupons: { path: 'coupons', object: 'coupon', created: true, label: 'Coupons' },
  promotion_codes: { path: 'promotion_codes', object: 'promotion_code', created: true, label: 'Codes promotionnels' },
  tax_rates: { path: 'tax_rates', object: 'tax_rate', created: true, label: 'Taux de taxe' },
  shipping_rates: { path: 'shipping_rates', object: 'shipping_rate', created: true, label: 'Tarifs de livraison' },
  payment_links: { path: 'payment_links', object: 'payment_link', expand: ['data.line_items'], label: 'Liens de paiement' },
  checkout_sessions: { path: 'checkout/sessions', object: 'checkout.session', created: true, expand: ['data.customer'], label: 'Sessions Checkout' },
  invoices: { path: 'invoices', object: 'invoice', created: true, label: 'Factures' },
  invoice_items: { path: 'invoiceitems', object: 'invoiceitem', created: true, label: 'Lignes de facture' },
  credit_notes: { path: 'credit_notes', object: 'credit_note', created: true, label: 'Avoirs' },
  subscriptions: { path: 'subscriptions', object: 'subscription', created: true, defaults: { status: 'all' }, expand: ['data.customer', 'data.items.data.price'], label: 'Abonnements' },
  subscription_schedules: { path: 'subscription_schedules', object: 'subscription_schedule', created: true, label: 'Échéanciers' },
  quotes: { path: 'quotes', object: 'quote', created: true, label: 'Devis' },
  payouts: { path: 'payouts', object: 'payout', created: true, label: 'Virements bancaires' },
  transfers: { path: 'transfers', object: 'transfer', created: true, label: 'Transferts' },
  topups: { path: 'topups', object: 'topup', created: true, label: 'Rechargements' },
  files: { path: 'files', object: 'file', created: true, label: 'Fichiers Stripe' },
  connected_accounts: { path: 'accounts', object: 'account', created: true, label: 'Comptes Connect' },
  webhook_endpoints: { path: 'webhook_endpoints', object: 'webhook_endpoint', label: 'Webhooks' },
  events: { path: 'events', object: 'event', created: true, recentOnly: true, label: 'Événements (30 jours)' },
});

export function cleanStripeValue(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function getPayStripeSecret() {
  return cleanStripeValue(process.env.STRIPE_PAY_SECRET_KEY || process.env.STRIPE_SECRET_KEY, 300);
}

export function stripeResourceCatalog() {
  return Object.entries(PAY_STRIPE_RESOURCES).map(([id, config]) => ({
    id,
    label: config.label,
    object: config.object,
    single: Boolean(config.single),
    recent_only: Boolean(config.recentOnly),
  }));
}

function safeInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeCursor(value) {
  const cursor = cleanStripeValue(value, 255);
  return /^[A-Za-z0-9_:-]+$/.test(cursor) ? cursor : '';
}

async function stripeGet(secretKey, path, parameters = []) {
  const search = new URLSearchParams();
  for (const [key, value] of parameters) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
  }
  const suffix = search.size ? `?${search.toString()}` : '';
  const response = await fetch(`${STRIPE_API_BASE}/${path}${suffix}`, {
    headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`stripe_http_${response.status}`);
    error.status = response.status;
    error.stripeCode = cleanStripeValue(data?.error?.code || data?.error?.type, 100);
    throw error;
  }
  return data;
}

export async function getPayStripePage(resource, options = {}) {
  const config = PAY_STRIPE_RESOURCES[resource];
  if (!config) {
    const error = new Error('stripe_resource_invalid');
    error.status = 400;
    throw error;
  }
  const secretKey = getPayStripeSecret();
  if (!secretKey) {
    const error = new Error('stripe_secret_missing');
    error.status = 503;
    throw error;
  }

  if (config.single) {
    const object = await stripeGet(secretKey, config.path);
    return { resource, config, data: [object], has_more: false, next_cursor: null };
  }

  const limit = safeInteger(options.limit, 100, 1, 100);
  const cursor = safeCursor(options.startingAfter);
  const createdGte = safeInteger(options.createdGte, 0, 0, 4_102_444_800);
  const createdLte = safeInteger(options.createdLte, 0, 0, 4_102_444_800);
  const parameters = [['limit', limit]];
  if (cursor) parameters.push(['starting_after', cursor]);
  if (config.created && createdGte) parameters.push(['created[gte]', createdGte]);
  if (config.created && createdLte) parameters.push(['created[lte]', createdLte]);
  for (const [key, value] of Object.entries(config.defaults || {})) parameters.push([key, value]);
  for (const expansion of config.expand || []) parameters.push(['expand[]', expansion]);

  const page = await stripeGet(secretKey, config.path, parameters);
  const rows = Array.isArray(page.data) ? page.data : [];
  return {
    resource,
    config,
    data: rows,
    has_more: Boolean(page.has_more),
    next_cursor: page.has_more && rows.length ? cleanStripeValue(rows.at(-1)?.id, 255) || null : null,
  };
}
