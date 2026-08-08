import assert from 'node:assert/strict';
import { preparePayCatalogCommand } from '../netlify/functions/lib/pay-catalog-command.mjs';

const product = preparePayCatalogCommand('product', {
  name: 'Esprit Subconscient 2.0', description: 'Programme', billing_type: 'recurring',
  amount: 197, currency: 'EUR', interval_unit: 'month', interval_count: 1,
}, { confirmation: 'PUBLIER PRODUIT', idempotencyKey: 'product:es2:2026-08-09' });
assert.equal(product.mode, 'dry_run');
assert.equal(product.executable, false);
assert.equal(product.operations[0].stripe_method, 'products.create');
assert.equal(product.operations[0].params.default_price_data.unit_amount, 19_700);
assert.deepEqual(product.operations[0].params.default_price_data.recurring, { interval: 'month', interval_count: 1 });

const checkout = preparePayCatalogCommand('checkout', {
  name: 'Consultation', slug: 'premiere-consultation', billing: 'one-time', amount: 97, currency: 'eur',
  allow_promotion_codes: true, success_url: 'https://sonnycourt.com/confirmation', metadata: { offer_slug: 'consultation' },
}, { confirmation: 'PUBLIER CHECKOUT', idempotencyKey: 'checkout:consultation:2026' });
assert.equal(checkout.flow, 'one_time');
assert.equal(checkout.operations[0].stripe_method, 'paymentLinks.create');
assert.equal(checkout.operations[0].params.line_items[0].price_data.unit_amount, 9_700);
assert.equal(checkout.operations[0].params.metadata.checkout_id, 'premiere-consultation');

const mc2 = preparePayCatalogCommand('checkout', {
  name: 'MC2', slug: 'mc2', billing: 'payment-plan', amount: 197, currency: 'eur',
  plan: { deposit: 47, bridgeAmount: 150, bridgeDelayDays: 14, installments: 11 },
  metadata: { funnel: 'mc2' },
}, { confirmation: 'PUBLIER CHECKOUT', idempotencyKey: 'checkout:mc2:2026-08-09' });
assert.equal(mc2.flow, 'central_payment_plan');
assert.equal(mc2.schedule.total_minor, 236_400);
assert.deepEqual(mc2.schedule.phases.map((phase) => [phase.kind, phase.count, phase.amount_minor]), [
  ['immediate', 1, 4_700],
  ['bridge', 1, 15_000],
  ['installments', 11, 19_700],
]);
assert.equal(mc2.continuation.handler, 'pay_universal_webhook');

const discount = preparePayCatalogCommand('discount', {
  code: 'LANCEMENT-30', type: 'percentage', value: 30, appliesRecurring: true,
  oncePerCustomer: true, maxRedemptions: 50, expiresAt: '2026-12-31T23:59:59Z',
}, { confirmation: 'PUBLIER REDUCTION', idempotencyKey: 'discount:lancement-30:2026' });
assert.equal(discount.operations[0].params.percent_off, 30);
assert.equal(discount.operations[0].params.duration, 'forever');
assert.equal(discount.operations[1].params.promotion.coupon, '$coupon.id');
assert.equal(discount.operations[1].params.restrictions.first_time_transaction, true);

assert.throws(() => preparePayCatalogCommand('product', { name: 'Test', billing_type: 'one_time', amount: 10, currency: 'eur' }, {
  confirmation: 'OUI', idempotencyKey: 'product:test:2026-08-09',
}), /pay_catalog_confirmation_required/);
assert.throws(() => preparePayCatalogCommand('checkout', {
  name: 'Test', slug: 'mauvais_slug', billing: 'one-time', amount: 10, currency: 'eur',
}, { confirmation: 'PUBLIER CHECKOUT', idempotencyKey: 'checkout:test:2026-08-09' }), /pay_catalog_slug_invalid/);
assert.throws(() => preparePayCatalogCommand('discount', {
  code: 'TEST', type: 'percentage', value: 101,
}, { confirmation: 'PUBLIER REDUCTION', idempotencyKey: 'discount:test:2026-08-09' }), /pay_catalog_discount_value_invalid/);
assert.throws(() => preparePayCatalogCommand('product', {
  name: 'Test', billing_type: 'recurring', amount: 10, currency: 'eur', interval_unit: 'month', interval_count: 37,
}, { confirmation: 'PUBLIER PRODUIT', idempotencyKey: 'product:interval:2026-08-09' }), /pay_catalog_interval_invalid/);
assert.throws(() => preparePayCatalogCommand('checkout', {
  name: 'Test', slug: 'plan-sans-acompte', billing: 'payment-plan', amount: 197, currency: 'eur',
  plan: { deposit: 0, installments: 11 },
}, { confirmation: 'PUBLIER CHECKOUT', idempotencyKey: 'checkout:no-deposit:2026' }), /pay_catalog_deposit_required/);
assert.throws(() => preparePayCatalogCommand('checkout', {
  name: 'Test', slug: 'redirection-invalide', billing: 'one-time', amount: 10, currency: 'eur',
  success_url: 'https://user:secret@example.com/confirmation',
}, { confirmation: 'PUBLIER CHECKOUT', idempotencyKey: 'checkout:bad-redirect:2026' }), /pay_catalog_success_url_invalid/);

console.log(JSON.stringify({
  product_publication_plan: 'ok',
  payment_link_plan: 'ok',
  mc2_complex_schedule: 'ok',
  discount_coupon_chain: 'ok',
  explicit_confirmation: 'ok',
  strict_validation: 'ok',
  idempotency: 'ok',
  live_execution: 'disabled',
}, null, 2));
