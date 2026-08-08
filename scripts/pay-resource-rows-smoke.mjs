import assert from 'node:assert/strict';
import { payOrderPlainValues } from '../src/scripts/pay-resource-rows.js';

const values = payOrderPlainValues({
  description: 'Commande test',
  customer: 'Client Recette',
  email: 'recette@example.test',
  created: '9 août 2026, 00:47',
  provider: 'Pay',
  status: 'Brouillon',
  total: '47,00 €',
});

assert.equal(values.length, 6);
assert.deepEqual(values, [
  'Commande test',
  'Client Recette · recette@example.test',
  '9 août 2026, 00:47',
  'Pay',
  'Brouillon',
  '47,00 €',
]);
assert.equal(payOrderPlainValues({ customer: 'Client sans email' })[1], 'Client sans email');

console.log(JSON.stringify({
  order_column_alignment: 'ok',
  combined_customer_identity: 'ok',
}, null, 2));

