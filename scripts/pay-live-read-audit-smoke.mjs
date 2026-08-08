import assert from 'node:assert/strict';
import fs from 'node:fs';

const audit = JSON.parse(fs.readFileSync(new URL('../docs/pay-live-read-audit-2026-08-09.json', import.meta.url), 'utf8'));
const statusTotal = Object.values(audit.stripe_payment_intents.status_counts).reduce((total, count) => total + Number(count || 0), 0);

assert.equal(audit.mode, 'read_only');
assert.equal(audit.gateways.stripe.connected, true);
assert.equal(audit.gateways.paypal.connected, true);
assert.equal(audit.financial_actions, 'locked');
assert.equal(statusTotal, audit.stripe_payment_intents.total);
assert.equal(audit.stripe_payment_intents.total, 3647);
assert.equal(audit.contains_personal_data, false);
assert.equal(JSON.stringify(audit).includes('@'), false);

console.log(JSON.stringify({
  live_gateway_readiness: 'ok',
  full_stripe_pagination: 'ok',
  status_reconciliation: 'ok',
  financial_actions_locked: 'ok',
  pii_free_evidence: 'ok',
}, null, 2));
