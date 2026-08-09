import assert from 'node:assert/strict';
import { getPayStripePage, stripeResourceCatalog } from '../netlify/functions/lib/pay-stripe-data.mjs';

const originalFetch = globalThis.fetch;
const originalPaySecret = process.env.STRIPE_PAY_SECRET_KEY;
const calls = [];

process.env.STRIPE_PAY_SECRET_KEY = 'sk_test_pay_customer_profile';
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push({ url, init });
  assert.equal(init.headers.Authorization, 'Bearer sk_test_pay_customer_profile');
  if (url.pathname.endsWith('/payment_methods')) {
    return Response.json({ data: [{ id: 'pm_1', object: 'payment_method', customer: 'cus_123', type: 'card', card: { brand: 'visa', last4: '4242' } }], has_more: false });
  }
  if (url.pathname.endsWith('/customers')) return Response.json({ data: [], has_more: false });
  throw new Error(`Unexpected Stripe URL: ${url}`);
};

try {
  assert.equal(stripeResourceCatalog().some((resource) => resource.id === 'payment_methods'), true);
  const methods = await getPayStripePage('payment_methods', { customer: 'cus_123', paymentType: 'card' });
  assert.equal(methods.data[0].card.last4, '4242');
  assert.equal(calls[0].url.searchParams.get('customer'), 'cus_123');
  assert.equal(calls[0].url.searchParams.get('type'), 'card');
  await assert.rejects(() => getPayStripePage('payment_methods', { customer: 'not-a-customer' }), /stripe_customer_invalid/);
  await assert.rejects(() => getPayStripePage('payment_methods', { customer: 'cus_123', paymentType: 'cash' }), /stripe_payment_method_type_invalid/);

  await getPayStripePage('customers');
  assert.deepEqual(calls.at(-1).url.searchParams.getAll('expand[]'), ['data.invoice_settings.default_payment_method', 'data.default_source']);
} finally {
  globalThis.fetch = originalFetch;
  if (originalPaySecret === undefined) delete process.env.STRIPE_PAY_SECRET_KEY;
  else process.env.STRIPE_PAY_SECRET_KEY = originalPaySecret;
}

console.log(JSON.stringify({ stripe_customer_profile_read: 'ok', reusable_payment_method_summary: 'ok', raw_card_data_absent: 'ok' }, null, 2));
