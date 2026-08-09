import {
  MC2_CONTRACT_TOTAL_CENTS,
  MC2_STRIPE_FIRST_INVOICE_COUPON_ID,
  MC2_STRIPE_MONTHLY_PRICE_ID,
  mc2Stripe,
  stripeId,
} from './lib/mc2-stripe.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';

const DAY_SECONDS = 24 * 60 * 60;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isoFromUnix(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toISOString() : null;
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

async function createInstallmentSchedule(stripe, session, registration) {
  if (registration.stripe_subscription_schedule_id) {
    return stripe.subscriptionSchedules.retrieve(registration.stripe_subscription_schedule_id);
  }
  const paymentIntent = await stripe.paymentIntents.retrieve(stripeId(session.payment_intent));
  const paymentMethodId = stripeId(paymentIntent.payment_method);
  const customerId = stripeId(session.customer) || stripeId(paymentIntent.customer);
  if (!paymentMethodId || !customerId) throw new Error('mc2_saved_payment_method_missing');

  const startDate = Number(paymentIntent.created) + (14 * DAY_SECONDS);
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
    phases: [
      {
        items: [{ price: MC2_STRIPE_MONTHLY_PRICE_ID, quantity: 1 }],
        discounts: [{ coupon: MC2_STRIPE_FIRST_INVOICE_COUPON_ID }],
        duration: { interval: 'month', interval_count: 1 },
        proration_behavior: 'none',
        metadata: {
          system: 'es2_mc2',
          mc2_token: registration.token,
          installment_stage: 'd14_150',
          payment_plan: '47_now_150_d14_11x197',
        },
      },
      {
        items: [{ price: MC2_STRIPE_MONTHLY_PRICE_ID, quantity: 1 }],
        discounts: [],
        duration: { interval: 'month', interval_count: 11 },
        proration_behavior: 'none',
        metadata: {
          system: 'es2_mc2',
          mc2_token: registration.token,
          installment_stage: 'monthly_197',
          payment_plan: '47_now_150_d14_11x197',
        },
      },
    ],
    metadata: {
      system: 'es2_mc2',
      mc2_token: registration.token,
      checkout_session_id: session.id,
      contractual_total_cents: String(MC2_CONTRACT_TOTAL_CENTS),
    },
  }, {
    idempotencyKey: `mc2-schedule:${session.id}`,
  });
}

async function processCheckoutCompleted(stripe, session, event) {
  if (session.metadata?.system !== 'es2_mc2') return { skipped: 'system' };
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return { skipped: 'payment' };
  const token = String(session.metadata.mc2_token || '').trim();
  const registration = await registrationBy(`token=eq.${encodeURIComponent(token)}`);
  if (!registration) throw new Error('mc2_registration_missing');
  const schedule = await createInstallmentSchedule(stripe, session, registration);
  const nowIso = new Date().toISOString();
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(token)}`, {
    statut: 'purchased',
    payment_status: 'paid',
    stripe_customer_id: stripeId(session.customer),
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: stripeId(session.payment_intent),
    stripe_subscription_schedule_id: schedule.id,
    initial_payment_cents: Number(session.amount_total || 4700),
    contractual_total_cents: MC2_CONTRACT_TOTAL_CENTS,
    paid_installment_count: Math.max(Number(registration.paid_installment_count || 0), 1),
    paid_total_cents: Math.max(Number(registration.paid_total_cents || 0), Number(session.amount_total || 4700)),
    purchased_at: registration.purchased_at || nowIso,
    last_payment_at: nowIso,
    last_event_at: nowIso,
  });
  if (!updated.ok) throw new Error(`mc2_purchase_update_${updated.status}`);
  await recordFunnelEvent(token, 'purchase_completed', session.amount_total || 4700, {
    stripe_event_id: event.id,
    checkout_session_id: session.id,
    schedule_id: schedule.id,
    payment_plan: '47_now_150_d14_11x197',
  });
  return { status: 'paid', token, schedule_id: schedule.id };
}

function invoiceSubscriptionId(invoice) {
  return stripeId(invoice.subscription)
    || stripeId(invoice.parent?.subscription_details?.subscription)
    || stripeId(invoice.subscription_details?.subscription);
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
  return { registration, subscriptionId, scheduleId };
}

async function processInvoicePaid(stripe, invoice, event) {
  if (invoice.status !== 'paid') return { skipped: 'invoice' };
  const context = await registrationForInvoice(stripe, invoice);
  if (!context.registration) return { skipped: 'registration' };
  const row = context.registration;
  const amount = Math.max(Number(invoice.amount_paid || 0), 0);
  const nowIso = new Date().toISOString();
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
    statut: 'purchased',
    payment_status: 'paid',
    stripe_subscription_id: context.subscriptionId,
    paid_installment_count: Number(row.paid_installment_count || 0) + 1,
    paid_total_cents: Number(row.paid_total_cents || 0) + amount,
    last_payment_at: nowIso,
    last_event_at: nowIso,
  });
  if (!updated.ok) throw new Error(`mc2_invoice_update_${updated.status}`);
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
  const nowIso = new Date().toISOString();
  const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(context.registration.token)}`, {
    payment_status: 'past_due',
    stripe_subscription_id: context.subscriptionId,
    payment_failed_at: nowIso,
    last_event_at: nowIso,
  });
  if (!updated.ok) throw new Error(`mc2_invoice_failed_${updated.status}`);
  await recordFunnelEvent(context.registration.token, 'installment_failed', invoice.amount_due || 0, {
    stripe_event_id: event.id,
    invoice_id: invoice.id,
  });
  return { status: 'installment_failed', token: context.registration.token };
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
  await recordFunnelEvent(registration.token, status, charge.amount_refunded || charge.amount || 0, {
    stripe_event_id: event.id,
    charge_id: charge.id,
  });
  return { status, token: registration.token };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const secret = String(process.env.STRIPE_MC2_WEBHOOK_SECRET || '').trim();
  if (!secret) return json(503, { error: 'webhook_secret_missing' });
  try {
    const rawBody = await req.text();
    const stripe = mc2Stripe();
    const event = stripe.webhooks.constructEvent(rawBody, req.headers.get('stripe-signature') || '', secret);
    if (await eventWasProcessed(event.id)) return json(200, { received: true, duplicate: true });
    let result = { skipped: 'event' };
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      result = await processCheckoutCompleted(stripe, event.data.object, event);
    } else if (event.type === 'invoice.paid') {
      result = await processInvoicePaid(stripe, event.data.object, event);
    } else if (event.type === 'invoice.payment_failed') {
      result = await processInvoiceFailed(stripe, event.data.object, event);
    } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      result = await processChargeAlert(event.data.object, event);
    }
    await markEventProcessed(event);
    return json(200, { received: true, ...result });
  } catch (error) {
    console.error('mc2-stripe-webhook:', error);
    if (String(error?.type || '').includes('StripeSignature')) return json(400, { error: 'invalid_signature' });
    return json(500, { received: false });
  }
};
