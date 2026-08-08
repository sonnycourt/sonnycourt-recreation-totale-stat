const PAYPAL_LIVE_API = 'https://api-m.paypal.com';
const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const REQUEST_TIMEOUT_MS = 12_000;

let cachedAccessToken = null;

export function cleanPayPalValue(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function getPayPalConfig(env = process.env) {
  const mode = cleanPayPalValue(env.PAYPAL_MODE, 20).toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
  return {
    mode,
    clientId: cleanPayPalValue(env.PAYPAL_CLIENT_ID, 300),
    clientSecret: cleanPayPalValue(env.PAYPAL_CLIENT_SECRET, 300),
    apiBase: mode === 'sandbox' ? PAYPAL_SANDBOX_API : PAYPAL_LIVE_API,
  };
}

function paypalError(status, data, fallback) {
  const error = new Error(cleanPayPalValue(data?.name || data?.error || fallback, 100) || fallback);
  error.status = status;
  error.code = cleanPayPalValue(data?.issue || data?.error, 100) || null;
  return error;
}

async function paypalFetch(url, options, fetchImpl) {
  const response = await fetchImpl(url, {
    ...options,
    signal: options?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw paypalError(response.status, data, `paypal_http_${response.status}`);
  return data;
}

export async function getPayPalAccessToken({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const config = getPayPalConfig(env);
  if (!config.clientId || !config.clientSecret) {
    const error = new Error('paypal_credentials_missing');
    error.status = 503;
    throw error;
  }

  const timestamp = now();
  if (cachedAccessToken && cachedAccessToken.cacheKey === `${config.mode}:${config.clientId}` && cachedAccessToken.expiresAt > timestamp + 30_000) {
    return cachedAccessToken;
  }

  const authorization = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64');
  const data = await paypalFetch(`${config.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      Accept: 'application/json',
      'Accept-Language': 'fr_CH',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  }, fetchImpl);

  if (!cleanPayPalValue(data.access_token, 4_000)) throw paypalError(502, data, 'paypal_token_missing');

  cachedAccessToken = {
    accessToken: data.access_token,
    appId: cleanPayPalValue(data.app_id, 200),
    scopes: cleanPayPalValue(data.scope, 8_000).split(/\s+/).filter(Boolean),
    expiresAt: timestamp + Math.max(60, Number(data.expires_in || 300)) * 1_000,
    cacheKey: `${config.mode}:${config.clientId}`,
    config,
  };
  return cachedAccessToken;
}

export async function paypalGet(path, parameters = [], options = {}) {
  const token = await getPayPalAccessToken(options);
  const url = new URL(path, `${token.config.apiBase}/`);
  for (const [key, value] of parameters) url.searchParams.append(key, String(value));
  return paypalFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
    },
  }, options.fetchImpl || fetch);
}

export async function paypalRequest(path, request = {}, options = {}) {
  const token = await getPayPalAccessToken(options);
  const url = new URL(path, `${token.config.apiBase}/`);
  return paypalFetch(url, {
    method: request.method || 'GET',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
      ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(request.requestId ? { 'PayPal-Request-Id': cleanPayPalValue(request.requestId, 100) } : {}),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  }, options.fetchImpl || fetch);
}

export async function getPayPalConnectionOverview(options = {}) {
  const token = await getPayPalAccessToken(options);
  const nowValue = typeof options.now === 'function' ? options.now() : Date.now();
  const end = new Date(nowValue - 4 * 60 * 60 * 1_000);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1_000);

  const [transactions, webhooks, products, plans, subscriptions, invoices] = await Promise.allSettled([
    paypalGet('/v1/reporting/transactions', [
      ['start_date', start.toISOString()],
      ['end_date', end.toISOString()],
      ['fields', 'transaction_info'],
      ['page_size', 1],
    ], options),
    paypalGet('/v1/notifications/webhooks', [], options),
    paypalGet('/v1/catalogs/products', [['page_size', 1], ['page', 1], ['total_required', 'true']], options),
    paypalGet('/v1/billing/plans', [['page_size', 1], ['page', 1], ['total_required', 'true']], options),
    paypalGet('/v1/billing/subscriptions', [['page_size', 1], ['page', 1], ['total_required', 'true']], options),
    paypalGet('/v2/invoicing/invoices', [['page_size', 1], ['page', 1], ['total_required', 'true']], options),
  ]);

  return {
    connected: true,
    mode: token.config.mode,
    app_id: token.appId || null,
    scopes: token.scopes,
    capabilities: {
      transaction_search: transactions.status === 'fulfilled',
      webhooks: webhooks.status === 'fulfilled',
      catalog_products: products.status === 'fulfilled',
      billing_plans: plans.status === 'fulfilled',
      subscriptions: subscriptions.status === 'fulfilled',
      invoices: invoices.status === 'fulfilled',
    },
    probes: {
      transaction_count: transactions.status === 'fulfilled' ? Number(transactions.value?.total_items || 0) : null,
      webhook_count: webhooks.status === 'fulfilled' ? (webhooks.value?.webhooks || []).length : null,
      product_count: products.status === 'fulfilled' ? Number(products.value?.total_items || 0) : null,
      plan_count: plans.status === 'fulfilled' ? Number(plans.value?.total_items || 0) : null,
      subscription_count: subscriptions.status === 'fulfilled' ? Number(subscriptions.value?.total_items || 0) : null,
      invoice_count: invoices.status === 'fulfilled' ? Number(invoices.value?.total_items || 0) : null,
    },
  };
}

export function resetPayPalTokenCache() {
  cachedAccessToken = null;
}
