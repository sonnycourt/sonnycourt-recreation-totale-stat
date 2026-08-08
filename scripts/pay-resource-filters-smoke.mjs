import assert from 'node:assert/strict';
import { matchesResourceFilter, normalizeResourceFilter, normalizeResourceView, normalizeSavedResourceViews } from '../src/scripts/pay-resource-filters.js';

const row = { plain: ['Plan ES2', 'Stripe', '197,00 €', 'En retard'] };
assert.equal(matchesResourceFilter(row, { column: 0, operator: 'contains', value: 'es2' }), true);
assert.equal(matchesResourceFilter(row, { column: 1, operator: 'equals', value: 'stripe' }), true);
assert.equal(matchesResourceFilter(row, { column: 3, operator: 'starts_with', value: 'en ' }), true);
assert.equal(matchesResourceFilter(row, { column: 0, operator: 'ends_with', value: 'es2' }), true);
assert.equal(matchesResourceFilter(row, { column: 0, operator: 'not_contains', value: 'paypal' }), true);
assert.equal(matchesResourceFilter(row, { column: 8, operator: 'contains', value: 'stripe' }, 4), false);
assert.deepEqual(normalizeResourceFilter({ column: -2, operator: 'unknown', value: '  test  ' }, 4), { column: 0, operator: 'contains', value: 'test' });

const view = normalizeResourceView({
  id: 123,
  name: ' Plans en retard ',
  query: ' sonny ',
  provider: 'stripe',
  status: 'En retard',
  advanced: { column: 2, operator: 'contains', value: '197' },
}, 4);
assert.deepEqual(view, {
  id: '123',
  name: 'Plans en retard',
  query: 'sonny',
  provider: 'stripe',
  status: 'en retard',
  advanced: { column: 2, operator: 'contains', value: '197' },
});
assert.equal(normalizeSavedResourceViews([view, { id: '', name: 'invalide' }], 4).length, 1);

console.log(JSON.stringify({ advanced_conditions: 'ok', normalized_views: 'ok', invalid_values_guarded: 'ok' }, null, 2));
