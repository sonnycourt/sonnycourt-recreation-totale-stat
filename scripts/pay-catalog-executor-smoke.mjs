import assert from 'node:assert/strict';
import { preparePayCatalogCommand } from '../netlify/functions/lib/pay-catalog-command.mjs';
import { executePayCatalogCommand, payCatalogWriteState } from '../netlify/functions/lib/pay-catalog-executor.mjs';

function fakeStripe() {
  const calls = [];
  const create = (method, result) => async (params, options) => {
    calls.push({ method, params, options });
    return typeof result === 'function' ? result(params) : result;
  };
  return {
    calls,
    client: {
      products: { create: create('products.create', { id: 'prod_test', object: 'product', active: true, livemode: false }) },
      paymentLinks: { create: create('paymentLinks.create', { id: 'plink_test', object: 'payment_link', active: true, url: 'https://buy.stripe.com/test', livemode: false }) },
      coupons: { create: create('coupons.create', { id: 'coupon_test', object: 'coupon', livemode: false }) },
      promotionCodes: { create: create('promotionCodes.create', (params) => ({ id: 'promo_test', object: 'promotion_code', code: params.code, active: true, livemode: false })) },
    },
  };
}

const disabledEnv = { STRIPE_PAY_SECRET_KEY: 'sk_test_fake' };
assert.deepEqual(payCatalogWriteState(disabledEnv), { configured: true, mode: 'test', writes_enabled: false });

const product = preparePayCatalogCommand('product', {
  name: 'Produit Test', billing_type: 'one_time', amount: 97, currency: 'eur',
}, { confirmation: 'PUBLIER PRODUIT', idempotencyKey: 'product:test:stable-key' });
const disabledStripe = fakeStripe();
await assert.rejects(() => executePayCatalogCommand(product, { env: disabledEnv, client: disabledStripe.client }), /stripe_catalog_writes_disabled/);
assert.equal(disabledStripe.calls.length, 0);

const enabledEnv = { ...disabledEnv, PAY_STRIPE_CATALOG_WRITES_ENABLED: 'true' };
const productStripe = fakeStripe();
const productResult = await executePayCatalogCommand(product, { env: enabledEnv, client: productStripe.client });
assert.equal(productResult.operations[0].result.id, 'prod_test');
assert.equal(productStripe.calls[0].options.idempotencyKey, 'product:test:stable-key:product');
assert.equal(JSON.stringify(productResult).includes('sk_test_fake'), false);

const checkout = preparePayCatalogCommand('checkout', {
  name: 'MC2', slug: 'mc2', billing: 'payment-plan', amount: 197, currency: 'eur',
  plan: { deposit: 47, bridgeAmount: 150, bridgeDelayDays: 14, installments: 11 },
}, { confirmation: 'PUBLIER CHECKOUT', idempotencyKey: 'checkout:mc2:stable-key' });
const checkoutStripe = fakeStripe();
const checkoutResult = await executePayCatalogCommand(checkout, { env: enabledEnv, client: checkoutStripe.client });
assert.equal(checkoutStripe.calls[0].method, 'paymentLinks.create');
assert.equal(checkoutStripe.calls[0].params.line_items[0].price_data.unit_amount, 4_700);
assert.equal(checkoutResult.continuation.handler, 'pay_universal_webhook');

const discount = preparePayCatalogCommand('discount', {
  code: 'TEST-30', type: 'percentage', value: 30, oncePerCustomer: true,
}, { confirmation: 'PUBLIER REDUCTION', idempotencyKey: 'discount:test-30:stable-key' });
const discountStripe = fakeStripe();
const discountResult = await executePayCatalogCommand(discount, { env: enabledEnv, client: discountStripe.client });
assert.equal(discountStripe.calls.length, 2);
assert.equal(discountStripe.calls[1].params.promotion.coupon, 'coupon_test');
assert.equal(discountResult.operations[1].result.code, 'TEST-30');

const brokenStripe = fakeStripe();
brokenStripe.client.promotionCodes.create = async () => { throw new Error('stripe_test_failure'); };
await assert.rejects(async () => {
  try { await executePayCatalogCommand(discount, { env: enabledEnv, client: brokenStripe.client }); }
  catch (error) { assert.equal(error.completed_operations, 1); throw error; }
}, /stripe_test_failure/);

console.log(JSON.stringify({
  disabled_by_default: 'ok',
  allowlisted_methods: 'ok',
  stable_idempotency: 'ok',
  dependency_resolution: 'ok',
  payment_plan_link: 'ok',
  partial_failure_audit: 'ok',
  secret_minimization: 'ok',
}, null, 2));
