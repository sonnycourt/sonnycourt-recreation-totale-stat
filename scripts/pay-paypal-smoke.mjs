import assert from 'node:assert/strict';
import {
  getPayPalAccessToken,
  getPayPalConfig,
  getPayPalConnectionOverview,
  resetPayPalTokenCache,
} from '../netlify/functions/lib/pay-paypal.mjs';

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
    assert.match(url, /page_size=1/);
    return Response.json({ total_items: 42, transaction_details: [] });
  }
  if (url.endsWith('/v1/notifications/webhooks')) {
    assert.equal(init.headers.Authorization, 'Bearer access-token-for-smoke-test');
    return Response.json({ webhooks: [{ id: 'WH-TEST' }] });
  }
  throw new Error(`Unexpected PayPal call: ${url}`);
};

resetPayPalTokenCache();
const token = await getPayPalAccessToken({ env, fetchImpl, now: () => 1_800_000_000_000 });
assert.equal(token.appId, 'APP-TEST');
assert.equal(token.accessToken, 'access-token-for-smoke-test');

const overview = await getPayPalConnectionOverview({ env, fetchImpl, now: () => 1_800_000_000_000 });
assert.deepEqual(overview.capabilities, { transaction_search: true, webhooks: true });
assert.deepEqual(overview.probes, { transaction_count: 42, webhook_count: 1 });
assert.equal(calls.filter((call) => call.url.endsWith('/v1/oauth2/token')).length, 1);
assert.ok(!JSON.stringify(overview).includes(env.PAYPAL_CLIENT_SECRET));
assert.ok(!JSON.stringify(overview).includes(token.accessToken));

console.log('✅ PayPal connection smoke tests passed');
