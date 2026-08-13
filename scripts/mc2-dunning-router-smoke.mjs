import assert from 'node:assert/strict';
import { MC2_PAY_METADATA, routeMc2StripeEvent } from '../netlify/functions/lib/mc2-pay-router.mjs';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const writes = [];
let activeRecovery = null;
const registration = {
  token: 'mc2-test-token',
  email: 'client@example.com',
  prenom: 'Client',
  stripe_customer_id: 'cus_mc2',
  stripe_subscription_id: 'sub_mc2',
  stripe_subscription_schedule_id: 'sub_sched_mc2',
  payment_status: 'past_due',
  payment_failed_at: '2026-08-12T08:00:00.000Z',
  paid_installment_count: 1,
  paid_total_cents: 4_700,
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').at(-1);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (method !== 'GET') writes.push({ table, method, body, query: parsed.search });
  if (method === 'GET' && table === 'mc2_stripe_webhook_events') return response([]);
  if (method === 'GET' && table === 'mc2_registrations') return response([registration]);
  if (method === 'GET' && table === 'mc2_payment_recoveries') {
    return response(activeRecovery ? [activeRecovery] : []);
  }
  if (method === 'GET' && table === 'mc2_dunning_jobs') return response([]);
  if (method === 'PATCH' && table === 'mc2_registrations') {
    Object.assign(registration, body);
    return response([{ ...registration }]);
  }
  if (method === 'PATCH' && table === 'mc2_dunning_jobs') return response([{ id: 1, ...body }]);
  if (method === 'POST' && table === 'mc2_payment_recoveries') return response([body], 201);
  if (method === 'POST' && table === 'mc2_dunning_jobs') return response([{ id: 1, ...body }], 201);
  if (method === 'POST' && ['mc2_funnel_events', 'mc2_stripe_webhook_events'].includes(table)) {
    return response([], 201);
  }
  throw new Error(`Unexpected Supabase call: ${method} ${table}${parsed.search}`);
};

const stripe = {
  subscriptions: {
    retrieve: async () => ({
      id: 'sub_mc2',
      status: 'past_due',
      schedule: 'sub_sched_mc2',
      metadata: { ...MC2_PAY_METADATA, mc2_token: registration.token },
    }),
    update: async (id, payload) => {
      writes.push({ table: 'stripe_subscriptions', method: 'POST', id, body: payload });
      return { id, ...payload };
    },
  },
  subscriptionSchedules: {
    update: async (id, payload) => {
      writes.push({ table: 'stripe_schedules', method: 'POST', id, body: payload });
      return { id, ...payload };
    },
  },
  invoices: {
    pay: async (id, payload) => {
      writes.push({ table: 'stripe_invoices', method: 'POST', id, body: payload });
      return { id, status: 'paid' };
    },
  },
  paymentIntents: {
    retrieve: async () => ({
      id: 'pi_failed',
      status: 'requires_payment_method',
      last_payment_error: {
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Fonds insuffisants',
      },
    }),
  },
};

const invoice = {
  id: 'in_mc2_failed',
  object: 'invoice',
  customer: 'cus_mc2',
  subscription: 'sub_mc2',
  payment_intent: 'pi_failed',
  amount_due: 19_700,
  currency: 'eur',
  status: 'open',
  attempt_count: 2,
  next_payment_attempt: 1_786_464_000,
  subscription_details: {
    metadata: { ...MC2_PAY_METADATA, mc2_token: registration.token },
  },
};

const failed = await routeMc2StripeEvent({
  id: 'evt_mc2_failed_2',
  type: 'invoice.payment_failed',
  created: 1_786_460_000,
  livemode: false,
  data: { object: invoice },
}, { stripe });

assert.equal(failed.status, 'installment_failed');
assert.equal(failed.stage, 2);
assert.equal(registration.payment_status, 'past_due');
assert.equal(registration.payment_retry_count, 1);
assert.equal(registration.payment_failure_code, 'insufficient_funds');
const recoveryFailure = writes.find((item) => item.table === 'mc2_payment_recoveries');
assert.equal(recoveryFailure.body.status, 'retry_scheduled');
assert.equal(recoveryFailure.body.attempt_count, 2);
const failureJob = writes.find((item) => item.table === 'mc2_dunning_jobs' && item.method === 'POST');
assert.equal(failureJob.body.message_type, 'payment_failed');
assert.equal(failureJob.body.dunning_stage, 2);

writes.length = 0;
invoice.status = 'paid';
invoice.amount_paid = 19_700;
invoice.attempt_count = 3;
invoice.payment_intent = 'pi_recovered';

const paid = await routeMc2StripeEvent({
  id: 'evt_mc2_recovered',
  type: 'invoice.paid',
  created: 1_786_550_000,
  livemode: false,
  data: { object: invoice },
}, { stripe });

assert.equal(paid.status, 'installment_paid');
assert.equal(registration.payment_status, 'paid');
assert.equal(registration.payment_retry_count, 0);
assert.equal(registration.payment_next_retry_at, null);
const recoveryPaid = writes.find((item) => item.table === 'mc2_payment_recoveries');
assert.equal(recoveryPaid.body.status, 'recovered');
const cancellation = writes.find((item) => item.table === 'mc2_dunning_jobs' && item.method === 'PATCH');
assert.equal(cancellation.body.status, 'cancelled');
const cleanupJob = writes.find((item) => item.table === 'mc2_dunning_jobs' && item.method === 'POST');
assert.equal(cleanupJob.body.message_type, 'payment_recovered_cleanup');

writes.length = 0;
registration.payment_status = 'past_due';
activeRecovery = {
  stripe_invoice_id: 'in_mc2_card_update',
  stripe_subscription_id: 'sub_mc2',
  status: 'retry_scheduled',
};

const cardUpdated = await routeMc2StripeEvent({
  id: 'evt_mc2_customer_updated',
  type: 'customer.updated',
  created: 1_786_560_000,
  livemode: false,
  data: {
    previous_attributes: {
      invoice_settings: { default_payment_method: 'pm_old' },
    },
    object: {
      id: 'cus_mc2',
      object: 'customer',
      metadata: { ...MC2_PAY_METADATA, mc2_token: registration.token },
      invoice_settings: { default_payment_method: 'pm_new' },
    },
  },
}, { stripe });

assert.equal(cardUpdated.status, 'payment_method_updated');
assert.equal(cardUpdated.invoice_retry, 'requested');
const subscriptionUpdate = writes.find((item) => item.table === 'stripe_subscriptions');
assert.equal(subscriptionUpdate.body.default_payment_method, 'pm_new');
const scheduleUpdate = writes.find((item) => item.table === 'stripe_schedules');
assert.equal(scheduleUpdate.body.default_settings.default_payment_method, 'pm_new');
const invoiceRetry = writes.find((item) => item.table === 'stripe_invoices');
assert.equal(invoiceRetry.id, 'in_mc2_card_update');
assert.equal(invoiceRetry.body.payment_method, 'pm_new');

console.log(JSON.stringify({
  failed_payment_persisted: 'ok',
  stage_specific_email_queued: 'ok',
  recovered_payment_stops_dunning: 'ok',
  updated_card_replaces_subscription_card: 'ok',
  updated_card_replaces_schedule_card: 'ok',
  updated_card_retries_open_invoice: 'ok',
}, null, 2));
