import assert from 'node:assert/strict';
import {
  payCatalogDraftConfirmation,
  payCatalogDraftIdempotencyKey,
  payCatalogDraftInput,
  payCatalogDraftKind,
} from '../src/scripts/pay-catalog-draft.js';

assert.equal(payCatalogDraftKind('products'), 'product');
assert.equal(payCatalogDraftConfirmation('discounts'), 'PUBLIER REDUCTION');

const product = payCatalogDraftInput('products', {
  name: 'Produit', billingType: 'recurring', amount: 197, currency: 'EUR', intervalUnit: 'month', intervalCount: 1,
});
assert.equal(product.billing_type, 'recurring');
assert.equal(product.currency, 'eur');

const checkout = payCatalogDraftInput('checkouts', {
  name: 'MC2', slug: 'mc2', billing: 'payment-plan', amount: 297, currency: 'EUR',
  allowPromotionCodes: true,
  plan: { deposit: 47, bridgeDelayDays: 14, installments: 4 },
});
assert.equal(checkout.billing, 'payment_plan');
assert.deepEqual(checkout.plan, { deposit: 47, bridge_amount: 0, bridge_delay_days: 14, installments: 4 });
assert.equal(checkout.metadata.checkout_id, 'mc2');
assert.equal(checkout.allow_promotion_codes, true);

const discount = payCatalogDraftInput('discounts', {
  code: 'test-30', type: 'percentage', value: 30, appliesRecurring: true, oncePerCustomer: true,
});
assert.equal(discount.code, 'TEST-30');
assert.equal(discount.applies_recurring, true);

const key = payCatalogDraftIdempotencyKey('products', { id: 1786230000000, updatedAt: '2026-08-09T12:00:00.000Z' });
assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/);
assert.equal(key, payCatalogDraftIdempotencyKey('products', { id: 1786230000000, updatedAt: '2026-08-09T12:00:00.000Z' }));
assert.throws(() => payCatalogDraftInput('orders', {}), /pay_catalog_draft_kind_invalid/);

console.log(JSON.stringify({
  draft_mapping: 'ok',
  mc2_mapping: 'ok',
  explicit_confirmation: 'ok',
  stable_idempotency: 'ok',
}, null, 2));
