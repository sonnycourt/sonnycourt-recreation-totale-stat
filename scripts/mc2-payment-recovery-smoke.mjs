import assert from 'node:assert/strict';
import {
  mc2DunningGroupForJob,
  mc2DunningGroups,
  mc2DunningStage,
  mc2NextRetryAt,
  mc2PaymentFailure,
} from '../netlify/functions/lib/mc2-payment-recovery.mjs';

assert.equal(mc2DunningStage({ attempt_count: 1 }), 1);
assert.equal(mc2DunningStage({ attempt_count: 6 }), 6);
assert.equal(mc2DunningStage({ attempt_count: 99 }), 6);
assert.equal(mc2NextRetryAt({ next_payment_attempt: 1_786_377_600 }), '2026-08-10T16:00:00.000Z');
assert.equal(mc2NextRetryAt({}), null);

assert.deepEqual(mc2PaymentFailure({
  status: 'requires_payment_method',
  last_payment_error: {
    code: 'card_declined',
    decline_code: 'insufficient_funds',
    message: 'Fonds insuffisants',
  },
}), {
  code: 'card_declined',
  declineCode: 'insufficient_funds',
  message: 'Fonds insuffisants',
  requiresAction: false,
});

assert.equal(mc2PaymentFailure({ status: 'requires_action' }).requiresAction, true);

const env = {
  ML_MC2_FAIL_1: 'group-1',
  ML_MC2_FAIL_6: 'group-6',
  ML_MC2_ACTION: 'group-action',
  ML_MC2_FINAL: 'group-final',
};
const groups = mc2DunningGroups(env);
assert.equal(groups.stages[0], 'group-1');
assert.equal(groups.stages[5], 'group-6');
assert.equal(mc2DunningGroupForJob({ message_type: 'payment_failed', dunning_stage: 1 }, env), 'group-1');
assert.equal(mc2DunningGroupForJob({ message_type: 'payment_failed', dunning_stage: 6 }, env), 'group-6');
assert.equal(mc2DunningGroupForJob({ message_type: 'payment_action_required' }, env), 'group-action');
assert.equal(mc2DunningGroupForJob({ message_type: 'payment_final_failed' }, env), 'group-final');

console.log(JSON.stringify({
  retry_stages: 'ok',
  stripe_failure_mapping: 'ok',
  mailerlite_routing: 'ok',
}, null, 2));
