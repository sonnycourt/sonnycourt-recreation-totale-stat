import {
  MC2_CONTRACT_TOTAL_CENTS,
  MC2_ENTRY_PAYMENT_CENTS,
  MC2_INSTALLMENT_COUNT,
  MC2_INSTALLMENT_FIRST_OFFSET_DAYS,
  MC2_INSTALLMENT_INTERVAL_DAYS,
  MC2_INSTALLMENT_OFFSETS_DAYS,
  MC2_PAYMENT_PLAN,
  MC2_STRIPE_INSTALLMENT_PRICE_ID,
  isValidMc2InstallmentPrice,
  mc2Stripe,
  stripeId,
} from './mc2-stripe.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import { cancelMc2OfferSms } from './mc2-sms.mjs';
import { cancelMc2ReplayRecoveryJobs } from './mc2-replay-recovery.mjs';
import {
  attemptMc2CircleOnboardingImmediately,
  mc2CircleEnabled,
  queueMc2CircleOnboarding,
} from './mc2-circle-onboarding.mjs';
import { addMc2BuyerToMailerLite } from './mc2-mailerlite-buyers.mjs';
import { queueMc2ContractDocument } from './mc2-contract-documents.mjs';
import { mc2MetaEventId, sendMc2MetaEvents } from './mc2-meta-events.mjs';
import {
  cancelMc2DunningJobs,
  mc2DunningStage,
  mc2NextRetryAt,
  mc2PaymentFailure,
  queueMc2DunningJob,
  upsertMc2Recovery,
} from './mc2-payment-recovery.mjs';
import {
  buildMc2PaymentAttempt,
  mc2CollectionEligible,
  mc2CollectionEnabled,
  persistMc2PaymentAttempt,
  queueMc2CollectionCase,
} from './mc2-collection-case.mjs';

const DAY_SECONDS = 24 * 60 * 60;
const MC2_SYSTEM = 'es2_mc2';

export const MC2_PAY_METADATA = Object.freeze({
  pay_origin: 'sonnycourt_pay',
  source: 'sonnycourt_pay',
  pay_route: 'pay',
  checkout_id: 'es2-mc2-commencer',
  offer_slug: 'es2-complete',
  system: MC2_SYSTEM,
  funnel: 'mc2',
  payment_plan: MC2_PAYMENT_PLAN,
});

function metadataFor(extra = {}) {
  return { ...MC2_PAY_METADATA, ...extra };
}

function eventMetadata(event) {
  const object = event?.data?.object || {};
  return {
    ...(object.subscription_details?.metadata || {}),
    ...(object.metadata || {}),
  };
}

export function isMc2StripeEvent(event) {
  return eventMetadata(event).system === MC2_SYSTEM;
}

async function registrationBy(query) {
  const result = await supabaseGet(`mc2_registrations?${query}&select=*&limit=1`);
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function eventWasProcessed(eventId) {
  const result = await supabaseGet(
    `mc2_stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`,
  );
  return result.ok && Array.isArray(result.data) && result.data.length > 0;
}

async function markEventProcessed(event) {
  const inserted = await supabasePost('mc2_stripe_webhook_events', {
    event_id: event.id,
    event_type: event.type,
    livemode: Boolean(event.livemode),
  }, { prefer: 'return=minimal' });
  if (!inserted.ok && inserted.status !== 409) throw new Error(`mc2_stripe_event_${inserted.status}`);
}

async function recordFunnelEvent(token, eventName, value, metadata = {}) {
  const inserted = await supabasePost('mc2_funnel_events', {
    token,
    event_name: eventName,
    event_value: value == null ? null : String(value),
    page_path: '/commencer/',
    metadata,
    dedupe_key: metadata.stripe_event_id ? `stripe_${metadata.stripe_event_id}` : null,
  }, { prefer: 'return=minimal' });
  if (!inserted.ok && inserted.status !== 409) console.error('mc2 stripe funnel event:', inserted.error);
}

export function mc2InstallmentSchedulePhases() {
  return MC2_INSTALLMENT_OFFSETS_DAYS.map((dueOffsetDays, index) => ({
    items: [{ price: MC2_STRIPE_INSTALLMENT_PRICE_ID, quantity: 1 }],
    discounts: [],
    billing_cycle_anchor: 'phase_start',
    duration: { interval: 'week', interval_count: MC2_INSTALLMENT_INTERVAL_DAYS / 7 },
    proration_behavior: 'none',
    metadata: metadataFor({
      installment_stage: 'every_21_days_297',
      installment_number: String(index + 1),
      installment_count: String(MC2_INSTALLMENT_COUNT),
      due_offset_days: String(dueOffsetDays),
    }),
  }));
}

async function createInstallmentSchedule(stripe, session, registration, completedAtEpochSeconds) {
  if (registration.stripe_subscription_schedule_id) {
    return stripe.subscriptionSchedules.retrieve(registration.stripe_subscription_schedule_id);
  }
  const paymentIntent = await stripe.paymentIntents.retrieve(stripeId(session.payment_intent));
  const paymentMethodId = stripeId(paymentIntent.payment_method);
  const customerId = stripeId(session.customer) || stripeId(paymentIntent.customer);
  if (!paymentMethodId || !customerId) throw new Error('mc2_saved_payment_method_missing');
  if (!/^price_[A-Za-z0-9]+$/.test(MC2_STRIPE_INSTALLMENT_PRICE_ID)) {
    throw new Error('mc2_installment_price_missing');
  }

  const installmentPrice = await stripe.prices.retrieve(MC2_STRIPE_INSTALLMENT_PRICE_ID);
  if (!isValidMc2InstallmentPrice(installmentPrice)) {
    throw new Error('mc2_installment_price_mismatch');
  }

  // Keep the Customer default aligned with the payment method explicitly used
  // by the schedule. This also gives the recovery flow one canonical card to
  // replace when the customer updates it later.
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
    metadata: metadataFor({
      mc2_token: registration.token,
      contractual_total_cents: String(MC2_CONTRACT_TOTAL_CENTS),
    }),
  }, {
    idempotencyKey: `mc2-customer-payment-method:${session.id}`,
  });

  const paidAt = Number(completedAtEpochSeconds || session.created || paymentIntent.created);
  const startDate = paidAt + (MC2_INSTALLMENT_FIRST_OFFSET_DAYS * DAY_SECONDS);
  return stripe.subscriptionSchedules.create({
    customer: customerId,
    start_date: startDate,
    end_behavior: 'cancel',
    billing_mode: { type: 'flexible' },
    default_settings: {
      collection_method: 'charge_automatically',
      default_payment_method: paymentMethodId,
      billing_cycle_anchor: 'phase_start',
      automatic_tax: { enabled: true },
      description: 'Échéancier Esprit Subconscient 2.0',
    },
    phases: mc2InstallmentSchedulePhases().map((phase) => ({
      ...phase,
      metadata: metadataFor({ ...phase.metadata, mc2_token: registration.token }),
    })),
    metadata: metadataFor({
      mc2_token: registration.token,
      checkout_session_id: session.id,
      contractual_total_cents: String(MC2_CONTRACT_TOTAL_CENTS),
    }),
  }, {
    idempotencyKey: `mc2-schedule:${session.id}`,
  });
}

async function processCheckoutCompleted(stripe, session, event) {
  if (session.metadata?.system !== MC2_SYSTEM) return { skipped: 'system' };
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return { skipped: 'payment' };
  const token = String(session.metadata.mc2_token || '').trim();
  const registration = await registrationBy(`token=eq.${encodeURIComponent(token)}`);
  if (!registration) throw new Error('mc2_registration_missing');
  const schedule = await createInstallmentSchedule(stripe, session, registration, event.created);
  const nowIso = new Date().toISOString();
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(token)}`, {
    statut: 'purchased',
    payment_status: 'paid',
    stripe_customer_id: stripeId(session.customer),
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: stripeId(session.payment_intent),
    stripe_subscription_schedule_id: schedule.id,
    initial_payment_cents: Number(session.amount_total || MC2_ENTRY_PAYMENT_CENTS),
    contractual_total_cents: MC2_CONTRACT_TOTAL_CENTS,
    paid_installment_count: Math.max(Number(registration.paid_installment_count || 0), 1),
    paid_total_cents: Math.max(
      Number(registration.paid_total_cents || 0),
      Number(session.amount_total || MC2_ENTRY_PAYMENT_CENTS),
    ),
    purchased_at: registration.purchased_at || nowIso,
    last_payment_at: nowIso,
    last_event_at: nowIso,
  });
  if (!updated.ok) throw new Error(`mc2_purchase_update_${updated.status}`);
  try {
    const purchaseRegistration = {
      ...registration,
      email: registration.email || session.customer_details?.email || session.customer_email,
      telephone: registration.telephone || session.customer_details?.phone,
    };
    await sendMc2MetaEvents({
      events: [{
        eventName: 'Purchase',
        eventId: mc2MetaEventId('purchase', session.id),
        contentName: 'Esprit Subconscient 2.0',
      }],
      registration: purchaseRegistration,
      pagePath: '/commencer/succes/',
      eventTime: Number(event.created) || undefined,
      value: Number(session.amount_total || MC2_ENTRY_PAYMENT_CENTS) / 100,
      currency: String(session.currency || 'eur').toUpperCase(),
    });
  } catch (error) {
    // Seul Stripe confirme l'achat ; Meta ne doit jamais bloquer le webhook.
    console.error('MC2 Meta Purchase failed:', error?.message || error);
  }
  // Le document est figé uniquement après confirmation du paiement initial.
  // Son insertion est idempotente par inscription ; une rediffusion Stripe ne
  // crée ni nouveau document ni nouveau lien personnel.
  const contractDocument = await queueMc2ContractDocument({
    registration,
    session,
    event,
  });
  if (!contractDocument.ok) throw new Error(contractDocument.error || 'mc2_contract_document_failed');
  let circleOnboarding = null;
  // Queue only after Stripe has confirmed the initial MC2 payment. Persist the
  // job before touching Circle, then try the same idempotent processor inline
  // with one short deadline. Any outage/timeout leaves a retry for the worker.
  if (mc2CircleEnabled()) {
    const circleQueued = await queueMc2CircleOnboarding({
      token,
      email: registration.email || session.customer_details?.email || session.customer_email,
      name: registration.prenom || session.customer_details?.name,
      stripeEventId: event.id,
    });
    // Do not acknowledge the Stripe event if its durable job was not stored.
    // Stripe may safely redeliver: the schedule and queue both use idempotency.
    if (!circleQueued.ok) throw new Error(`mc2_circle_queue_${circleQueued.error || 'failed'}`);
    circleOnboarding = await attemptMc2CircleOnboardingImmediately(circleQueued.row);
  }
  const smsCancellation = await cancelMc2OfferSms(token);
  if (!smsCancellation.ok) console.error('mc2 purchase SMS cancellation:', smsCancellation.error);
  const replayCancellation = await cancelMc2ReplayRecoveryJobs({
    token,
    email: registration.email,
  });
  if (!replayCancellation.ok) console.error('mc2 purchase replay cancellation:', replayCancellation.error);
  // Le groupe acheteur sert de source de vérité MailerLite et ne déclenche
  // aucune communication tant qu'aucune automation n'y est reliée.
  const buyerGroup = await addMc2BuyerToMailerLite({
    email: registration.email || session.customer_details?.email || session.customer_email,
  });
  if (!buyerGroup.ok) {
    console.error('mc2 purchase MailerLite buyer group:', buyerGroup.error || buyerGroup.skipped);
  }
  await recordFunnelEvent(token, 'purchase_completed', session.amount_total || MC2_ENTRY_PAYMENT_CENTS, {
    stripe_event_id: event.id,
    checkout_session_id: session.id,
    schedule_id: schedule.id,
    payment_plan: MC2_PAY_METADATA.payment_plan,
  });
  return {
    status: 'paid',
    token,
    schedule_id: schedule.id,
    circle_onboarding: circleOnboarding?.status || (mc2CircleEnabled() ? 'deferred' : 'disabled'),
    contract_document: contractDocument.enabled
      ? contractDocument.queued ? 'queued' : 'existing'
      : 'disabled',
  };
}

function invoiceSubscriptionId(invoice) {
  return stripeId(invoice.subscription)
    || stripeId(invoice.parent?.subscription_details?.subscription)
    || stripeId(invoice.subscription_details?.subscription);
}

function invoicePaymentIntentId(invoice) {
  return stripeId(invoice.payment_intent)
    || stripeId(invoice.payments?.data?.[0]?.payment?.payment_intent)
    || stripeId(invoice.confirmation_secret?.payment_intent);
}

async function registrationForInvoice(stripe, invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { registration: null, subscriptionId: null };
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const token = String(subscription.metadata?.mc2_token || '').trim();
  const scheduleId = stripeId(subscription.schedule);
  const registration = token
    ? await registrationBy(`token=eq.${encodeURIComponent(token)}`)
    : scheduleId
      ? await registrationBy(`stripe_subscription_schedule_id=eq.${encodeURIComponent(scheduleId)}`)
      : null;
  return { registration, subscriptionId, scheduleId, subscription };
}

async function processInvoicePaid(stripe, invoice, event) {
  if (invoice.status !== 'paid') return { skipped: 'invoice' };
  const context = await registrationForInvoice(stripe, invoice);
  if (!context.registration) return { skipped: 'registration' };
  const row = context.registration;
  const amount = Math.max(Number(invoice.amount_paid || 0), 0);
  const nowIso = new Date().toISOString();
  const invoiceId = stripeId(invoice);
  const wasRecovering = ['past_due', 'unpaid'].includes(String(row.payment_status || '').toLowerCase());
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
    statut: 'purchased',
    payment_status: 'paid',
    stripe_subscription_id: context.subscriptionId,
    paid_installment_count: Number(row.paid_installment_count || 0) + 1,
    paid_total_cents: Number(row.paid_total_cents || 0) + amount,
    payment_retry_count: 0,
    payment_next_retry_at: null,
    payment_failure_code: null,
    payment_failure_message: null,
    payment_recovered_at: wasRecovering ? nowIso : row.payment_recovered_at,
    payment_exhausted_at: null,
    last_payment_at: nowIso,
    last_event_at: nowIso,
  });
  if (!updated.ok) throw new Error(`mc2_invoice_update_${updated.status}`);
  if (invoiceId && wasRecovering) {
    await upsertMc2Recovery({
      stripe_invoice_id: invoiceId,
      token: row.token,
      stripe_customer_id: stripeId(invoice.customer) || row.stripe_customer_id,
      stripe_subscription_id: context.subscriptionId,
      stripe_payment_intent_id: invoicePaymentIntentId(invoice),
      status: 'recovered',
      attempt_count: Math.max(1, Number(invoice.attempt_count || 1)),
      retry_count: Math.max(0, Number(invoice.attempt_count || 1) - 1),
      amount_due_cents: Math.max(Number(invoice.amount_due || amount), 0),
      currency: String(invoice.currency || 'eur').toLowerCase(),
      next_retry_at: null,
      recovered_at: nowIso,
      exhausted_at: null,
      last_stripe_event_id: event.id,
    });
    await cancelMc2DunningJobs({ token: row.token, invoiceId });
    await queueMc2DunningJob({
      token: row.token,
      invoiceId,
      eventId: event.id,
      messageType: 'payment_recovered_cleanup',
    });
  }
  await recordFunnelEvent(row.token, 'installment_paid', amount, {
    stripe_event_id: event.id,
    invoice_id: invoice.id,
    installment_stage: invoice.lines?.data?.[0]?.metadata?.installment_stage || null,
  });
  return { status: 'installment_paid', token: row.token, amount };
}

async function processInvoiceFailed(stripe, invoice, event) {
  const context = await registrationForInvoice(stripe, invoice);
  if (!context.registration) return { skipped: 'registration' };
  const invoiceId = stripeId(invoice);
  if (!invoiceId) return { skipped: 'invoice_id' };
  const paymentIntentId = invoicePaymentIntentId(invoice);
  const paymentIntent = paymentIntentId
    ? await stripe.paymentIntents.retrieve(paymentIntentId)
    : null;
  const failure = mc2PaymentFailure(paymentIntent, invoice);
  const stage = mc2DunningStage(invoice);
  const nextRetryAt = mc2NextRetryAt(invoice);
  const nowIso = new Date().toISOString();
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(context.registration.token)}`, {
    payment_status: 'past_due',
    stripe_subscription_id: context.subscriptionId,
    payment_failed_at: nowIso,
    payment_retry_count: Math.max(0, stage - 1),
    payment_next_retry_at: nextRetryAt,
    payment_failure_code: failure.declineCode || failure.code,
    payment_failure_message: failure.message,
    payment_exhausted_at: null,
    last_event_at: nowIso,
  });
  if (!updated.ok) throw new Error(`mc2_invoice_failed_${updated.status}`);
  await upsertMc2Recovery({
    stripe_invoice_id: invoiceId,
    token: context.registration.token,
    stripe_customer_id: stripeId(invoice.customer) || context.registration.stripe_customer_id,
    stripe_subscription_id: context.subscriptionId,
    stripe_payment_intent_id: paymentIntentId,
    status: failure.requiresAction
      ? 'payment_action_required'
      : nextRetryAt ? 'retry_scheduled' : 'failed',
    attempt_count: Math.max(1, Number(invoice.attempt_count || 1)),
    retry_count: Math.max(0, Number(invoice.attempt_count || 1) - 1),
    amount_due_cents: Math.max(Number(invoice.amount_due || 0), 0),
    currency: String(invoice.currency || 'eur').toLowerCase(),
    failure_code: failure.code,
    decline_code: failure.declineCode,
    failure_message: failure.message,
    next_retry_at: nextRetryAt,
    first_failed_at: context.registration.payment_failed_at || nowIso,
    last_failed_at: nowIso,
    recovered_at: null,
    exhausted_at: null,
    last_stripe_event_id: event.id,
  });
  // Une ligne append-only par webhook d'échec : le dossier final ne dépend pas
  // de l'état courant mutable de mc2_payment_recoveries.
  if (mc2CollectionEnabled()) {
    await persistMc2PaymentAttempt(buildMc2PaymentAttempt({
      token: context.registration.token,
      invoice,
      paymentIntent,
      failure,
      event,
    }));
  }
  await queueMc2DunningJob({
    token: context.registration.token,
    invoiceId,
    eventId: event.id,
    messageType: failure.requiresAction ? 'payment_action_required' : 'payment_failed',
    stage,
  });
  await recordFunnelEvent(context.registration.token, 'installment_failed', invoice.amount_due || 0, {
    stripe_event_id: event.id,
    invoice_id: invoiceId,
    attempt_count: Number(invoice.attempt_count || 1),
    retry_count: Math.max(0, Number(invoice.attempt_count || 1) - 1),
    next_retry_at: nextRetryAt,
    failure_code: failure.declineCode || failure.code,
    requires_action: failure.requiresAction,
  });
  return {
    status: failure.requiresAction ? 'payment_action_required' : 'installment_failed',
    token: context.registration.token,
    stage,
    next_retry_at: nextRetryAt,
  };
}

async function processInvoiceUpdated(stripe, invoice, event) {
  const attemptCount = Math.max(0, Number(invoice.attempt_count || 0));
  if (!attemptCount || invoice.status === 'paid') return { skipped: 'invoice_state' };
  const context = await registrationForInvoice(stripe, invoice);
  if (!context.registration) return { skipped: 'registration' };
  const invoiceId = stripeId(invoice);
  if (!invoiceId) return { skipped: 'invoice_id' };
  const nextRetryAt = mc2NextRetryAt(invoice);
  const exhausted = !nextRetryAt && (
    attemptCount >= 6
    || invoice.status === 'uncollectible'
    || context.subscription?.status === 'unpaid'
  );
  const nowIso = new Date().toISOString();
  const registrationPatch = {
    payment_next_retry_at: nextRetryAt,
    payment_retry_count: Math.max(0, attemptCount - 1),
    last_event_at: nowIso,
  };
  if (exhausted) {
    registrationPatch.payment_status = 'unpaid';
    registrationPatch.payment_exhausted_at = nowIso;
  }
  const updated = await supabasePatch(
    'mc2_registrations',
    `token=eq.${encodeURIComponent(context.registration.token)}`,
    registrationPatch,
  );
  if (!updated.ok) throw new Error(`mc2_invoice_retry_update_${updated.status}`);
  await upsertMc2Recovery({
    stripe_invoice_id: invoiceId,
    token: context.registration.token,
    stripe_customer_id: stripeId(invoice.customer) || context.registration.stripe_customer_id,
    stripe_subscription_id: context.subscriptionId,
    stripe_payment_intent_id: invoicePaymentIntentId(invoice),
    status: exhausted ? 'exhausted' : nextRetryAt ? 'retry_scheduled' : 'failed',
    attempt_count: attemptCount,
    retry_count: Math.max(0, attemptCount - 1),
    amount_due_cents: Math.max(Number(invoice.amount_due || 0), 0),
    currency: String(invoice.currency || 'eur').toLowerCase(),
    next_retry_at: nextRetryAt,
    exhausted_at: exhausted ? nowIso : null,
    last_stripe_event_id: event.id,
  });
  const retryCount = Math.max(0, attemptCount - 1);
  if (mc2CollectionEnabled() && mc2CollectionEligible({ retryCount, exhausted })) {
    const queued = await queueMc2CollectionCase({
      token: context.registration.token,
      invoiceId,
      stripeEventId: event.id,
      retryCount,
    });
    if (!queued.ok) throw new Error(queued.error || 'mc2_collection_queue_failed');
  }
  if (exhausted && attemptCount < 6) {
    await queueMc2DunningJob({
      token: context.registration.token,
      invoiceId,
      eventId: event.id,
      messageType: 'payment_final_failed',
      stage: Math.min(6, attemptCount),
    });
  }
  await recordFunnelEvent(
    context.registration.token,
    exhausted ? 'installment_exhausted' : 'installment_retry_scheduled',
    invoice.amount_due || 0,
    {
      stripe_event_id: event.id,
      invoice_id: invoiceId,
      attempt_count: attemptCount,
      next_retry_at: nextRetryAt,
    },
  );
  return {
    status: exhausted ? 'installment_exhausted' : 'installment_retry_scheduled',
    token: context.registration.token,
    next_retry_at: nextRetryAt,
  };
}

async function currentRecoveryForToken(token) {
  const result = await supabaseGet(
    `mc2_payment_recoveries?token=eq.${encodeURIComponent(token)}`
      + '&status=in.(failed,retry_scheduled,payment_action_required)'
      + '&select=*&order=updated_at.desc&limit=1',
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function processCustomerUpdated(stripe, customer, event) {
  const defaultPaymentMethod = stripeId(customer.invoice_settings?.default_payment_method);
  const previousDefault = stripeId(
    event.data?.previous_attributes?.invoice_settings?.default_payment_method,
  );
  if (!defaultPaymentMethod || previousDefault === defaultPaymentMethod) {
    return { skipped: 'payment_method_unchanged' };
  }
  const customerId = stripeId(customer);
  const registration = customerId
    ? await registrationBy(`stripe_customer_id=eq.${encodeURIComponent(customerId)}`)
    : null;
  if (!registration) return { skipped: 'registration' };

  const recovery = await currentRecoveryForToken(registration.token);
  const subscriptionId = recovery?.stripe_subscription_id || registration.stripe_subscription_id;
  const scheduleId = registration.stripe_subscription_schedule_id;
  if (scheduleId) {
    await stripe.subscriptionSchedules.update(scheduleId, {
      default_settings: { default_payment_method: defaultPaymentMethod },
    }, {
      idempotencyKey: `mc2-sync-schedule-payment-method:${event.id}:${scheduleId}`,
    });
  }
  if (subscriptionId) {
    await stripe.subscriptions.update(subscriptionId, {
      default_payment_method: defaultPaymentMethod,
    }, {
      idempotencyKey: `mc2-sync-payment-method:${event.id}:${subscriptionId}`,
    });
  }

  const updated = await supabasePatch(
    'mc2_registrations',
    `token=eq.${encodeURIComponent(registration.token)}`,
    { last_event_at: new Date().toISOString() },
  );
  if (!updated.ok) throw new Error(`mc2_payment_method_update_${updated.status}`);

  let invoiceRetry = 'not_needed';
  if (recovery?.stripe_invoice_id) {
    try {
      await stripe.invoices.pay(recovery.stripe_invoice_id, {
        payment_method: defaultPaymentMethod,
      }, {
        idempotencyKey: `mc2-pay-updated-card:${event.id}:${recovery.stripe_invoice_id}`,
      });
      invoiceRetry = 'requested';
    } catch (error) {
      // A failed immediate attempt emits invoice.payment_failed and remains in
      // Stripe's retry policy. Returning 2xx prevents a useless customer.updated
      // webhook loop while preserving the recovery state.
      invoiceRetry = `failed:${String(error?.code || error?.type || 'stripe_error').slice(0, 80)}`;
    }
  }

  await recordFunnelEvent(registration.token, 'payment_method_updated', null, {
    stripe_event_id: event.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId || null,
    stripe_subscription_schedule_id: scheduleId || null,
    invoice_retry: invoiceRetry,
  });
  return {
    status: 'payment_method_updated',
    token: registration.token,
    invoice_retry: invoiceRetry,
  };
}

async function processChargeAlert(charge, event) {
  const customerId = stripeId(charge.customer);
  const paymentIntentId = stripeId(charge.payment_intent);
  const registration = paymentIntentId
    ? await registrationBy(`stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}`)
    : customerId
      ? await registrationBy(`stripe_customer_id=eq.${encodeURIComponent(customerId)}`)
      : null;
  if (!registration) return { skipped: 'registration' };
  const disputed = event.type === 'charge.dispute.created';
  const refunded = event.type === 'charge.refunded' && Boolean(charge.refunded);
  if (!disputed && !refunded) return { skipped: 'charge' };
  const status = disputed ? 'disputed' : 'refunded';
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(registration.token)}`, {
    payment_status: status,
    last_event_at: new Date().toISOString(),
  });
  if (!updated.ok) throw new Error(`mc2_charge_alert_${updated.status}`);
  await cancelMc2DunningJobs({ token: registration.token, reason: status });
  await recordFunnelEvent(registration.token, status, charge.amount_refunded || charge.amount || 0, {
    stripe_event_id: event.id,
    charge_id: charge.id,
  });
  return { status, token: registration.token };
}

export async function routeMc2StripeEvent(event, options = {}) {
  if (!isMc2StripeEvent(event)) return { handled: false };
  if (await eventWasProcessed(event.id)) return { handled: true, duplicate: true };
  const stripe = options.stripe || mc2Stripe();
  let result = { skipped: 'event' };
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    result = await processCheckoutCompleted(stripe, event.data.object, event);
  } else if (event.type === 'invoice.paid') {
    result = await processInvoicePaid(stripe, event.data.object, event);
  } else if (event.type === 'invoice.payment_failed') {
    result = await processInvoiceFailed(stripe, event.data.object, event);
  } else if (event.type === 'invoice.payment_action_required') {
    result = await processInvoiceFailed(stripe, event.data.object, event);
  } else if (event.type === 'invoice.updated') {
    result = await processInvoiceUpdated(stripe, event.data.object, event);
  } else if (event.type === 'customer.updated') {
    result = await processCustomerUpdated(stripe, event.data.object, event);
  } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    result = await processChargeAlert(event.data.object, event);
  }
  await markEventProcessed(event);
  return { handled: true, duplicate: false, ...result };
}
