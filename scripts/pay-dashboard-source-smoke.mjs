import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canUseStripePreview, createDashboardDay } from '../src/scripts/pay-dashboard-source.js';

const overview = {
  connected: true,
  transaction_window: {
    since: Date.parse('2026-07-10T00:00:00Z') / 1_000,
    until: Date.parse('2026-08-09T23:59:59Z') / 1_000,
    truncated: false,
  },
};

assert.equal(canUseStripePreview(overview, [], new Date('2026-08-02T00:00:00Z'), new Date('2026-08-08T00:00:00Z')), true);
assert.equal(canUseStripePreview({ ...overview, transaction_window: { ...overview.transaction_window, until: Date.parse('2026-08-09T12:00:00Z') / 1_000 } }, [], new Date('2026-08-09T00:00:00Z'), new Date('2026-08-09T00:00:00Z')), true);
assert.equal(canUseStripePreview({ ...overview, transaction_window: { ...overview.transaction_window, truncated: true } }, [], new Date('2026-08-02T00:00:00Z'), new Date('2026-08-08T00:00:00Z')), false);
assert.equal(canUseStripePreview(overview, [], new Date('2026-01-01T00:00:00Z'), new Date('2026-01-07T00:00:00Z')), false);
assert.equal(canUseStripePreview(overview, null, new Date('2026-08-02T00:00:00Z'), new Date('2026-08-08T00:00:00Z')), false);
assert.deepEqual(createDashboardDay(new Date('2026-08-08T00:00:00Z'), { liveReady: true, historyReady: false }), {
  date: new Date('2026-08-08T00:00:00Z'), revenue: 0, refunds: 0, refundCount: 0, orders: null, plans: null, pastDue: null,
});
assert.deepEqual(createDashboardDay(new Date('2026-08-08T00:00:00Z'), { liveReady: false, historyReady: true }), {
  date: new Date('2026-08-08T00:00:00Z'), revenue: null, refunds: null, refundCount: null, orders: 0, plans: 0, pastDue: 0,
});

const dashboard = fs.readFileSync(new URL('../src/pages/pay/index.astro', import.meta.url), 'utf8');
const overviewFunction = fs.readFileSync(new URL('../netlify/functions/pay-stripe-overview.js', import.meta.url), 'utf8');
assert.doesNotMatch(dashboard, /demoDataForRange/);
assert.match(dashboard, /Aucune valeur approximative n’est affichée/);
assert.match(overviewFunction, /transactions:\s*transactionRows/);
assert.doesNotMatch(overviewFunction, /transactions:\s*transactionRows\.slice/);

console.log(JSON.stringify({ exact_preview_window: 'ok', complete_preview_payload: 'ok', truncated_preview_blocked: 'ok', stale_preview_blocked: 'ok', unavailable_series: 'null_not_zero', fabricated_fallback: 'absent' }, null, 2));
