import assert from 'node:assert/strict';
import { normalizePayRecoveryPolicy, payRecoveryEligibleRows, payRecoverySchedule } from '../src/scripts/pay-recovery-policy.js';

assert.deepEqual(normalizePayRecoveryPolicy({}), { enabled: false, firstDelayHours: 24, followUpDelayHours: 72, maxReminders: 1 });
assert.deepEqual(payRecoverySchedule('2026-08-09T10:00:00Z', { firstDelayHours: 24, followUpDelayHours: 72, maxReminders: 2 }), [
  '2026-08-10T10:00:00.000Z', '2026-08-12T10:00:00.000Z',
]);
assert.equal(payRecoveryEligibleRows([
  ['9 août', 'Ada', 'ada@example.com', 'Stripe', '97 €', 'refusé'],
  ['9 août', 'Sans email', '—', 'PayPal', '97 €', 'refusé'],
]).length, 1);

console.log(JSON.stringify({ disabled_by_default: 'ok', deterministic_schedule: 'ok', missing_email_skipped: 'ok' }, null, 2));
