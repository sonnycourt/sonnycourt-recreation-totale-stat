import assert from 'node:assert/strict';
import { mergePayTransactions, payTransactionMetrics, payTransactionProviderLabel } from '../src/scripts/pay-transaction-metrics.js';

const rows = [
  { id: 'sale_pp', provider: 'paypal', kind: 'sale', status: 'Réussi', amount: 10_000, signed_amount: 10_000, refunded: 4_000, currency: 'eur', created: 100 },
  { id: 'refund_pp', provider: 'paypal', kind: 'refund', status: 'Remboursé', amount: 4_000, refunded: 4_000, reference_id: 'sale_pp', currency: 'eur', created: 110 },
  { id: 'sale_stripe', provider: 'stripe', status: 'Remboursé', amount: 9_700, refunded: 9_700, currency: 'eur', created: 120 },
  { id: 'success_stripe', provider: 'stripe', status: 'Réussi', amount: 19_700, currency: 'eur', created: 130 },
  { id: 'pending_stripe', provider: 'stripe', status: 'En attente', amount: 4_700, currency: 'eur', created: 140 },
  { id: 'old_success', provider: 'stripe', status: 'Réussi', amount: 99_900, currency: 'eur', created: 10 },
  { id: 'usd_success', provider: 'stripe', status: 'Réussi', amount: 5_000, currency: 'usd', created: 150 },
];

const metrics = payTransactionMetrics(rows, { currency: 'eur', cutoff: 50 });
assert.deepEqual(metrics, {
  revenue: 29_700,
  refunded: 13_700,
  pending: 4_700,
  successfulCount: 3,
  refundCount: 2,
  pendingCount: 1,
});
assert.equal(payTransactionProviderLabel('stripe'), 'Stripe');
assert.equal(payTransactionProviderLabel('paypal'), 'PayPal');
assert.equal(payTransactionProviderLabel('spiffy'), 'Historique Spiffy');
assert.equal(payTransactionProviderLabel('internal'), 'Pay');

const merged = mergePayTransactions({
  history: [
    { id: 'pi_same', provider: 'stripe', created: 100, can_refund: false, description: 'Archive' },
    { id: 'PP-SAME', provider: 'paypal', created: 90, status: 'Ancien' },
  ],
  stripeArchive: [
    { id: 'pi_same', provider: 'stripe', created: 100, can_refund: false, description: 'Page paginée' },
    { id: 'pi_old', provider: 'stripe', created: 80, can_refund: false },
  ],
  stripeLive: [{ id: 'pi_same', provider: 'stripe', created: 100, can_refund: true, refundable: 9_700, description: 'Live enrichi' }],
  paypalLive: [{ id: 'PP-SAME', provider: 'paypal', created: 110, status: 'Réussi' }],
});
assert.deepEqual(merged.map((item) => `${item.provider}:${item.id}`), ['paypal:PP-SAME', 'stripe:pi_same', 'stripe:pi_old']);
assert.equal(merged.find((item) => item.id === 'pi_same').can_refund, true);
assert.equal(merged.find((item) => item.id === 'pi_same').description, 'Live enrichi');
assert.equal(merged.find((item) => item.id === 'PP-SAME').status, 'Réussi');

console.log(JSON.stringify({
  paypal_refund_deduplication: 'ok',
  currency_isolation: 'ok',
  period_filter: 'ok',
  provider_labels: 'ok',
  live_action_priority: 'ok',
}, null, 2));
