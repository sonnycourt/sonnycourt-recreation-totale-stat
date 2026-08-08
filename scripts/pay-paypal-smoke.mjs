import assert from 'node:assert/strict';
import {
  getPayPalAccessToken,
  getPayPalConfig,
  getPayPalConnectionOverview,
  paypalRequest,
  resetPayPalTokenCache,
} from '../netlify/functions/lib/pay-paypal.mjs';
import {
  classifyPayPalTransaction,
  getPayPalTransactions,
  normalizePayPalTransaction,
  splitPayPalSearchRange,
} from '../netlify/functions/lib/pay-paypal-data.mjs';

const env = {
  PAYPAL_MODE: 'live',
  PAYPAL_CLIENT_ID: 'client-id-for-local-smoke-test',
  PAYPAL_CLIENT_SECRET: 'client-secret-for-local-smoke-test',
};

assert.equal(getPayPalConfig(env).apiBase, 'https://api-m.paypal.com');
assert.equal(getPayPalConfig({ ...env, PAYPAL_MODE: 'sandbox' }).apiBase, 'https://api-m.sandbox.paypal.com');

const calls = [];
const fetchImpl = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.endsWith('/v1/oauth2/token')) {
    assert.equal(init.method, 'POST');
    assert.equal(init.body, 'grant_type=client_credentials');
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`);
    return Response.json({ access_token: 'access-token-for-smoke-test', app_id: 'APP-TEST', scope: 'https://uri.paypal.com/services/reporting/search/read https://uri.paypal.com/services/applications/webhooks', expires_in: 3600 });
  }
  if (url.includes('/v1/reporting/transactions')) {
    if (url.includes('page_size=1')) return Response.json({ total_items: 42, transaction_details: [] });
    assert.match(url, /page_size=500/);
    return Response.json({
      total_items: 1,
      total_pages: 1,
      transaction_details: [{
        transaction_info: {
          transaction_id: 'TXN-1',
          transaction_event_code: 'T0002',
          transaction_status: 'S',
          transaction_initiation_date: '2026-08-05T12:00:00Z',
          transaction_updated_date: '2026-08-05T12:01:00Z',
          transaction_amount: { currency_code: 'EUR', value: '97.00' },
          fee_amount: { currency_code: 'EUR', value: '-3.12' },
          transaction_subject: 'Plan ES2',
          paypal_reference_id_type: 'SUB',
        },
        payer_info: { email_address: 'client@example.com', payer_name: { given_name: 'Ada', surname: 'Lovelace' } },
      }],
    });
  }
  if (url.endsWith('/v1/notifications/webhooks')) {
    assert.equal(init.headers.Authorization, 'Bearer access-token-for-smoke-test');
    return Response.json({ webhooks: [{ id: 'WH-TEST' }] });
  }
  if (url.includes('/v1/catalogs/products')) return Response.json({ total_items: 2, products: [] });
  if (url.includes('/v1/billing/plans')) return Response.json({ total_items: 3, plans: [] });
  if (url.includes('/v1/billing/subscriptions')) return Response.json({ total_items: 4, subscriptions: [] });
  if (url.includes('/v2/invoicing/invoices')) return Response.json({ total_items: 5, items: [] });
  if (url.endsWith('/v2/payments/captures/TESTCAPTURE/refund')) {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['PayPal-Request-Id'], 'refund-test-1');
    assert.deepEqual(JSON.parse(init.body), { amount: { value: '12.50', currency_code: 'EUR' } });
    return Response.json({ id: 'REFUND-TEST', status: 'COMPLETED' });
  }
  throw new Error(`Unexpected PayPal call: ${url}`);
};

resetPayPalTokenCache();
const token = await getPayPalAccessToken({ env, fetchImpl, now: () => 1_800_000_000_000 });
assert.equal(token.appId, 'APP-TEST');
assert.equal(token.accessToken, 'access-token-for-smoke-test');

const overview = await getPayPalConnectionOverview({ env, fetchImpl, now: () => 1_800_000_000_000 });
assert.deepEqual(overview.capabilities, {
  transaction_search: true, webhooks: true, catalog_products: true, billing_plans: true, subscriptions: true, invoices: true,
});
assert.deepEqual(overview.probes, {
  transaction_count: 42, webhook_count: 1, product_count: 2, plan_count: 3, subscription_count: 4, invoice_count: 5,
});
assert.equal(calls.filter((call) => call.url.endsWith('/v1/oauth2/token')).length, 1);
assert.ok(!JSON.stringify(overview).includes(env.PAYPAL_CLIENT_SECRET));
assert.ok(!JSON.stringify(overview).includes(token.accessToken));

const refundProbe = await paypalRequest('/v2/payments/captures/TESTCAPTURE/refund', {
  method: 'POST', requestId: 'refund-test-1', body: { amount: { value: '12.50', currency_code: 'EUR' } },
}, { env, fetchImpl, now: () => 1_800_000_000_000 });
assert.equal(refundProbe.id, 'REFUND-TEST');

assert.equal(classifyPayPalTransaction('T1107', -5000), 'refund');
assert.equal(classifyPayPalTransaction('T0002', 9700), 'payment_plan');
assert.equal(splitPayPalSearchRange(new Date('2026-01-01T00:00:00Z'), new Date('2026-03-15T00:00:00Z')).length, 3);

const normalized = normalizePayPalTransaction({
  transaction_info: {
    transaction_id: 'REF-1', transaction_event_code: 'T1107', transaction_status: 'S',
    transaction_initiation_date: '2026-08-04T12:00:00Z',
    transaction_amount: { currency_code: 'EUR', value: '-12.50' },
    sales_tax_amount: { currency_code: 'EUR', value: '1.25' },
    shipping_tax_amount: { currency_code: 'EUR', value: '0.25' },
  },
  payer_info: { country_code: 'CH' },
});
assert.equal(normalized.status, 'Remboursé');
assert.equal(normalized.refunded, 1250);
assert.equal(normalized.tax, 150);
assert.equal(normalized.country, 'CH');

const transactions = await getPayPalTransactions({
  env,
  fetchImpl,
  start: '2026-08-01T00:00:00Z',
  end: '2026-08-08T00:00:00Z',
  now: () => new Date('2026-08-09T12:00:00Z').getTime(),
});
assert.equal(transactions.transactions.length, 1);
assert.equal(transactions.transactions[0].is_plan_payment, true);
assert.equal(transactions.transactions[0].can_refund, true);
assert.equal(transactions.transactions[0].refundable, 9700);
assert.equal(transactions.metrics.revenue.eur, 9700);

console.log('✅ PayPal connection smoke tests passed');
