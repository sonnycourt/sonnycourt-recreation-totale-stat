import { deliverCoachingPurchaseActivation } from './lib/coaching-purchases.mjs';
import { coachingStripe, stripeSubscriptionStatus, validCoachingOfferSlug } from './lib/coaching-stripe.mjs';
import { deleteCoachingGoogleMeeting, finalizeCoachingBooking } from './lib/coaching-integrations.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function id(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function timestamp(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toISOString() : null;
}

function nameParts(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || 'Élève', lastName: parts.join(' ') };
}

function invoiceTax(invoice) {
  if (Array.isArray(invoice.total_taxes)) return invoice.total_taxes.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (Array.isArray(invoice.total_tax_amounts)) return invoice.total_tax_amounts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return 0;
}

function safeAudit(eventType, object) {
  return {
    event: eventType,
    stripe_object: object.object,
    livemode: Boolean(object.livemode),
    created: object.created || null,
    payment_status: object.payment_status || object.status || null,
  };
}

async function recordStripeOrder({ referenceId, paymentId, customerId, subscriptionId, email, name, offerSlug, amount, tax, currency, country, eventType, object }) {
  const names = nameParts(name);
  const result = await supabasePost('rpc/coaching_record_stripe_order', {
    p_checkout_session_id: referenceId,
    p_payment_id: paymentId || null,
    p_customer_id: customerId || null,
    p_subscription_id: subscriptionId || null,
    p_email: String(email || '').trim().toLowerCase(),
    p_first_name: names.firstName,
    p_last_name: names.lastName,
    p_offer_slug: offerSlug,
    p_amount_cents: Math.max(Number(amount || 0), 0),
    p_tax_cents: Math.max(Number(tax || 0), 0),
    p_currency: String(currency || 'eur').toUpperCase(),
    p_country: String(country || '').toUpperCase(),
    p_raw_payload: safeAudit(eventType, object),
  });
  if (!result.ok) throw new Error(`stripe_order_${result.status}`);
  const purchase = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!purchase) throw new Error('stripe_order_missing');
  const activation = await deliverCoachingPurchaseActivation({ purchase, offerSlug });
  return { purchase, activation };
}

async function importFirstConsultation(session, purchase) {
  const bookingToken = session.metadata?.booking_token;
  if (!bookingToken) throw new Error('stripe_booking_token_missing');
  const result = await supabaseGet(
    `coach_diagnostic_bookings?public_token=eq.${encodeURIComponent(bookingToken)}` +
    '&status=in.(pending_payment,payment_review,paid)&select=id,slot_id,status,expires_at,customer_email&limit=1',
  );
  const booking = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!booking) throw new Error('stripe_booking_not_found');

  const now = new Date();
  const paidAlready = booking.status === 'paid';
  const expired = booking.status === 'payment_review' || (!paidAlready && new Date(booking.expires_at).getTime() < now.getTime());
  const status = expired ? 'payment_review' : 'paid';
  const paymentId = id(session.payment_intent);
  const updated = await supabasePatch('coach_diagnostic_bookings', `id=eq.${encodeURIComponent(booking.id)}`, {
    status,
    ...(!paidAlready ? { paid_at: now.toISOString() } : {}),
    amount_eur: Number(session.amount_total || 9700) / 100,
    payment_provider: 'stripe',
    provider_order_id: session.id,
    provider_payment_id: paymentId,
    stripe_checkout_session_id: session.id,
  });
  if (!updated.ok) throw new Error(`stripe_booking_update_${updated.status}`);
  if (expired) return { status: 'payment_review' };

  const slot = await supabasePatch(
    'coach_diagnostic_slots',
    `id=eq.${encodeURIComponent(booking.slot_id)}&status=in.(held,booked)`,
    { status: 'booked', held_until: null },
  );
  if (!slot.ok || !Array.isArray(slot.data) || !slot.data[0]) throw new Error('stripe_slot_not_booked');

  const imported = await supabasePost('rpc/coaching_import_first_consultation_stripe', {
    p_checkout_session_id: session.id,
    p_booking_id: booking.id,
  });
  if (!imported.ok) throw new Error(`stripe_first_consultation_${imported.status}`);
  const row = Array.isArray(imported.data) ? imported.data[0] : imported.data;
  const sessionId = typeof row === 'string' ? row : row?.coaching_import_first_consultation_stripe || row?.session_id;
  if (!sessionId) throw new Error('stripe_first_consultation_session_missing');
  const integrations = await finalizeCoachingBooking(sessionId).catch((error) => {
    console.error('Stripe first consultation integrations:', error);
    return { calendar: { status: 'deferred' }, client_email: { status: 'deferred' }, coach_email: { status: 'deferred' } };
  });
  return { status: 'imported', coaching_order_id: purchase.order_id, session_id: sessionId, integrations };
}

async function processPaidCheckout(session, eventType) {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return { skipped: 'checkout_mode' };
  const offerSlug = validCoachingOfferSlug(session.metadata?.offer_slug);
  if (!offerSlug) return { skipped: 'offer' };
  const customer = session.customer_details || {};
  const recorded = await recordStripeOrder({
    referenceId: session.id,
    paymentId: id(session.payment_intent),
    customerId: id(session.customer),
    subscriptionId: null,
    email: customer.email || session.customer_email,
    name: customer.name || session.metadata?.customer_first_name,
    offerSlug,
    amount: session.amount_total,
    tax: session.total_details?.amount_tax,
    currency: session.currency,
    country: customer.address?.country,
    eventType,
    object: session,
  });
  const firstConsultation = offerSlug === 'first-consultation'
    ? await importFirstConsultation(session, recorded.purchase)
    : null;
  return { status: 'paid', order_id: recorded.purchase.order_id, activation: recorded.activation.status, first_consultation: firstConsultation };
}

async function processPaidInvoice(invoice, eventType) {
  const stripe = coachingStripe();
  const subscriptionId = id(invoice.subscription);
  if (!subscriptionId || invoice.status !== 'paid') return { skipped: 'invoice' };
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const offerSlug = validCoachingOfferSlug(subscription.metadata?.offer_slug);
  if (!offerSlug || !offerSlug.startsWith('membership-')) return { skipped: 'offer' };
  const customer = await stripe.customers.retrieve(id(subscription.customer));
  if (customer.deleted) throw new Error('stripe_customer_deleted');
  const priceId = id(subscription.items?.data?.[0]?.price);
  const recorded = await recordStripeOrder({
    referenceId: invoice.id,
    paymentId: id(invoice.payment_intent),
    customerId: customer.id,
    subscriptionId,
    email: invoice.customer_email || customer.email,
    name: invoice.customer_name || customer.name || subscription.metadata?.customer_first_name,
    offerSlug,
    amount: invoice.amount_paid,
    tax: invoiceTax(invoice),
    currency: invoice.currency,
    country: invoice.customer_address?.country || customer.address?.country,
    eventType,
    object: invoice,
  });
  const saved = await supabasePost('rpc/coaching_upsert_stripe_subscription', {
    p_provider_subscription_id: subscriptionId,
    p_provider_customer_id: customer.id,
    p_provider_price_id: priceId,
    p_client_id: recorded.purchase.client_id,
    p_offer_slug: offerSlug,
    p_status: stripeSubscriptionStatus(subscription.status),
    p_current_period_start: timestamp(subscription.current_period_start),
    p_current_period_end: timestamp(subscription.current_period_end),
    p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  });
  if (!saved.ok) throw new Error(`stripe_subscription_${saved.status}`);
  return { status: 'paid', order_id: recorded.purchase.order_id, activation: recorded.activation.status, subscription_id: subscriptionId };
}

async function syncSubscription(subscription) {
  const offerSlug = validCoachingOfferSlug(subscription.metadata?.offer_slug);
  if (!offerSlug) return { skipped: 'offer' };
  let clientId = subscription.metadata?.coaching_client_id || null;
  if (!clientId) {
    const found = await supabaseGet(
      `coaching_clients?stripe_customer_id=eq.${encodeURIComponent(id(subscription.customer))}&select=id&limit=1`,
    );
    clientId = found.ok && Array.isArray(found.data) ? found.data[0]?.id : null;
  }
  if (!clientId) return { skipped: 'client' };
  const saved = await supabasePost('rpc/coaching_upsert_stripe_subscription', {
    p_provider_subscription_id: subscription.id,
    p_provider_customer_id: id(subscription.customer),
    p_provider_price_id: id(subscription.items?.data?.[0]?.price),
    p_client_id: clientId,
    p_offer_slug: offerSlug,
    p_status: stripeSubscriptionStatus(subscription.status),
    p_current_period_start: timestamp(subscription.current_period_start),
    p_current_period_end: timestamp(subscription.current_period_end),
    p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  });
  if (!saved.ok) throw new Error(`stripe_subscription_${saved.status}`);
  return { status: 'synced' };
}

async function processFullRefund(charge) {
  if (!charge.refunded || Number(charge.amount_refunded || 0) < Number(charge.amount || 0)) return { skipped: 'partial_refund' };
  const paymentId = id(charge.payment_intent);
  if (!paymentId) return { skipped: 'payment' };
  const existing = await supabaseGet(
    `coaching_orders?provider=eq.stripe&provider_payment_id=eq.${encodeURIComponent(paymentId)}&select=id,engagement_id&limit=1`,
  );
  const order = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
  if (!order) return { skipped: 'order' };
  const refunded = await supabasePost('rpc/coaching_refund_stripe_order', { p_provider_reference: paymentId });
  if (!refunded.ok) throw new Error(`stripe_refund_${refunded.status}`);

  const sessions = await supabaseGet(
    `coaching_sessions?engagement_id=eq.${encodeURIComponent(order.engagement_id)}` +
    `&status=eq.cancelled&cancellation_reason=eq.${encodeURIComponent('Remboursement Stripe')}` +
    '&google_event_id=not.is.null&select=google_event_id,coaching_coaches(id,slug,google_calendar_id)',
  );
  if (sessions.ok) {
    await Promise.allSettled((sessions.data || []).map((session) => deleteCoachingGoogleMeeting({
      coachId: session.coaching_coaches?.id,
      coachSlug: session.coaching_coaches?.slug,
      calendarId: session.coaching_coaches?.google_calendar_id,
      eventId: session.google_event_id,
    })));
  }
  await supabasePatch(
    'coach_diagnostic_bookings',
    `provider_payment_id=eq.${encodeURIComponent(paymentId)}&status=in.(paid,payment_review)`,
    { status: 'refunded', refunded_at: new Date().toISOString() },
  );
  return { status: 'refunded' };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const secret = process.env.STRIPE_COACHING_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: 'webhook_secret_missing' });

  try {
    const rawBody = await req.text();
    const event = coachingStripe().webhooks.constructEvent(rawBody, req.headers.get('stripe-signature') || '', secret);
    let result = { skipped: 'event' };
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      result = await processPaidCheckout(event.data.object, event.type);
    } else if (event.type === 'invoice.paid') {
      result = await processPaidInvoice(event.data.object, event.type);
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      result = await syncSubscription(event.data.object);
    } else if (event.type === 'charge.refunded') {
      result = await processFullRefund(event.data.object);
    }
    return json(200, { received: true, ...result });
  } catch (error) {
    console.error('coaching-stripe-webhook:', error);
    if (String(error?.type || '').includes('StripeSignature')) return json(400, { error: 'invalid_signature' });
    return json(500, { received: false });
  }
};
