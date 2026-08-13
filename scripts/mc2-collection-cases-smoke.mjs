import assert from 'node:assert/strict';
import {
  buildMc2ContractAcceptance,
  buildMc2PaymentAttempt,
  mc2CaseCompleteness,
  mc2CollectionCsvExport,
  mc2CollectionEligible,
  mc2CollectionJsonExport,
  stableStringify,
  validateMc2ContractReadiness,
  validateMc2ContractOffer,
} from '../netlify/functions/lib/mc2-collection-case.mjs';

assert.equal(mc2CollectionEligible({ retryCount: 4, exhausted: true }), false);
assert.equal(mc2CollectionEligible({ retryCount: 5, exhausted: false }), false);
assert.equal(mc2CollectionEligible({ retryCount: 5, exhausted: true }), true);
assert.equal(mc2CollectionEligible({ retryCount: 6, exhausted: true }), false);

const headers = new Headers({
  'user-agent': 'MC2 Test Browser',
  'x-nf-client-connection-ip': '198.51.100.9',
  'x-nf-request-id': 'req-test',
});
const acceptance = buildMc2ContractAcceptance({
  registration: { token: 'mc2-token', contractual_total_cents: 123_500 },
  session: {
    id: 'cs_test_mc2',
    amount_total: 4_700,
    currency: 'eur',
    metadata: { payment_plan: '47_now_then_4x297', contractual_total_cents: '123500' },
  },
  req: { headers },
  acceptedAt: '2026-08-12T12:00:00.000Z',
  env: {},
});
assert.equal(acceptance.client_ip, '198.51.100.9');
assert.equal(acceptance.contractual_total_cents, 123_500);
assert.match(acceptance.evidence_sha256, /^[a-f0-9]{64}$/);
assert.equal(validateMc2ContractReadiness({}).valid, false);
assert.equal(validateMc2ContractReadiness({
  MC2_CONTRACT_VERSION: 'v1',
  MC2_TERMS_URL: 'https://sonnycourt.com/cgv',
  MC2_TERMS_SNAPSHOT_URL: 'https://sonnycourt.com/cgv-v1.pdf',
  MC2_TERMS_SNAPSHOT_SHA256: 'b'.repeat(64),
  MC2_CONTRACT_EXPECTED_SCHEDULE_JSON: JSON.stringify([
    { label: 'Acompte', amount_cents: 4700 },
  ]),
}).valid, true);
const offerEnv = {
  MC2_CONTRACT_EXPECTED_PAYMENT_PLAN: '47_now_then_4x297',
  MC2_CONTRACT_EXPECTED_ENTRY_CENTS: '4700',
  MC2_CONTRACT_EXPECTED_TOTAL_CENTS: '123500',
  MC2_CONTRACT_EXPECTED_SCHEDULE_JSON: JSON.stringify([
    { label: "Aujourd’hui", due_offset_days: 0, amount_cents: 4700, installments: 1 },
    { label: 'Ensuite, 4 échéances', due_offset_days: 14, amount_cents: 29700, installments: 4 },
  ]),
};
assert.deepEqual(validateMc2ContractOffer(acceptance, offerEnv), { valid: true, errors: [] });
assert.equal(validateMc2ContractOffer(acceptance, { ...offerEnv, MC2_CONTRACT_EXPECTED_TOTAL_CENTS: '236400' }).valid, false);

const attempt = buildMc2PaymentAttempt({
  token: 'mc2-token',
  invoice: {
    id: 'in_failed', payment_intent: 'pi_failed', attempt_count: 6, amount_due: 29_700,
    currency: 'eur', status: 'open', hosted_invoice_url: 'https://invoice.test',
  },
  paymentIntent: { id: 'pi_failed' },
  failure: { code: 'card_declined', declineCode: 'insufficient_funds', message: 'Declined', requiresAction: false },
  event: { id: 'evt_failed_6', created: 1_786_536_000, livemode: false },
});
assert.equal(attempt.attempt_sequence, 6);
assert.equal(attempt.retry_sequence, 5);
assert.equal(attempt.stripe_event_id, 'evt_failed_6');

const completeSnapshot = {
  debtor: { email: 'client@example.com', full_name: 'Client Test' },
  address: { line1: '1 rue Test', postal_code: '75001', city: 'Paris', country: 'FR' },
  contract: {
    accepted_at: '2026-08-12T12:00:00Z',
    version: 'v1',
    terms_url: 'https://sonnycourt.com/cgv',
    terms_snapshot_url: 'https://sonnycourt.com/legal-archives/mc2-cgv-v1.pdf',
    terms_snapshot_sha256: 'b'.repeat(64),
    payment_schedule: [{ label: 'Acompte', amount_cents: 4_700 }],
  },
  payment_attempts: Array.from({ length: 5 }, (_, index) => ({
    sequence: index + 2,
    retry_sequence: index + 1,
  })),
  invoices: [{ stripe_invoice_id: 'in_due' }],
  payments: [{ stripe_invoice_id: 'in_initial', amount_paid_cents: 4_700 }],
  balance: { paid_total_cents: 4_700, due_cents: 118_800 },
  stripe: { invoice_id: 'in_due', invoice_pdf_url: 'https://invoice.test/pdf' },
};
assert.deepEqual(mc2CaseCompleteness(completeSnapshot), { complete: true, missing: [] });
assert.equal(mc2CaseCompleteness({ ...completeSnapshot, address: {} }).complete, false);

const approvedCase = {
  id: 1,
  case_number: 'MC2-INFAILED',
  status: 'approved',
  revision: 1,
  snapshot_sha256: 'a'.repeat(64),
  snapshot: {
    ...completeSnapshot,
    offer: { contractual_total_cents: 123_500 },
    balance: { paid_total_cents: 4_700, due_cents: 118_800, currency: 'eur' },
    stripe: { invoice_id: 'in_failed' },
  },
};
assert.equal(mc2CollectionJsonExport(approvedCase).case_number, 'MC2-INFAILED');
assert.match(mc2CollectionCsvExport(approvedCase), /client@example\.com/);
assert.throws(() => mc2CollectionJsonExport({ ...approvedCase, status: 'ready_for_review' }), /not_approved/);
assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');

console.log(JSON.stringify({
  exact_five_retries_gate: 'ok',
  contract_evidence_hash: 'ok',
  exact_terms_snapshot_guard: 'ok',
  contract_offer_mismatch_guard: 'ok',
  immutable_attempt_projection: 'ok',
  completeness_gate: 'ok',
  human_approval_export_gate: 'ok',
}, null, 2));
