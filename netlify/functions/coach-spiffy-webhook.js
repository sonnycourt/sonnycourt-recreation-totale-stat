import crypto from 'crypto';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { deleteCoachingGoogleMeeting, finalizeCoachingBooking, sendCoachingActivationEmail } from './lib/coaching-integrations.mjs';
import { coachingAppUrl } from './lib/coaching-origin.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function verifySignature(rawBody, headers) {
  const secretRaw = process.env.SPIFFY_SIGNING_SECRET;
  if (!secretRaw) return 'no_secret';
  const id = headers.get('webhook-id') || headers.get('svix-id');
  const timestamp = headers.get('webhook-timestamp') || headers.get('svix-timestamp');
  const signature = headers.get('webhook-signature') || headers.get('svix-signature');
  if (!id || !timestamp || !signature) return 'no_headers';

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60) return 'stale';

  let key;
  try { key = Buffer.from(secretRaw.replace(/^whsec_/, ''), 'base64'); }
  catch { return 'invalid'; }
  const expected = crypto
    .createHmac('sha256', key)
    .update(id + '.' + timestamp + '.' + rawBody)
    .digest('base64');

  const provided = signature.split(' ').map((part) => part.split(',').pop());
  const match = provided.some((value) => {
    try {
      return value && value.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
    } catch {
      return false;
    }
  });
  return match ? 'ok' : 'invalid';
}

function verifyPrivateWebhookToken(req) {
  const expected = process.env.COACHING_SPIFFY_WEBHOOK_TOKEN;
  if (!expected) return 'no_secret';
  const provided = new URL(req.url).searchParams.get('token') || req.headers.get('x-coaching-webhook-token') || '';
  try {
    return provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)) ? 'ok' : 'invalid';
  } catch {
    return 'invalid';
  }
}

function findValue(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 7) return null;
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim()) return String(obj[key]).trim();
  }
  for (const value of Object.values(obj)) {
    const found = findValue(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function findEmail(obj, depth = 0) {
  if (!obj || depth > 7) return null;
  if (typeof obj === 'string') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj) ? obj : null;
  if (typeof obj !== 'object') return null;
  for (const key of ['email', 'customer_email', 'buyer_email']) {
    if (typeof obj[key] === 'string' && obj[key].includes('@')) return obj[key];
  }
  for (const value of Object.values(obj)) {
    const found = findEmail(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function amountEur(obj) {
  return amountCents(obj, 9700) / 100;
}

function amountCents(obj, fallback = null) {
  for (const key of ['amount_cents', 'total_cents']) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  for (const key of ['order_total', 'total', 'amount', 'amount_total', 'grand_total']) {
    const raw = String(obj?.[key] ?? '').trim();
    const value = Number(raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100);
  }
  return fallback;
}

const COACHING_OFFER_SLUGS = new Set([
  'session-1',
  'pack-3',
  'pack-6',
  'membership-3',
  'membership-6',
  'membership-12',
  'es2-complete-coaching',
]);

function coachingOfferSlug(req, body) {
  const requestUrl = new URL(req.url);
  const explicit = requestUrl.searchParams.get('offer')
    || requestUrl.searchParams.get('offer_slug')
    || findValue(body, ['coaching_offer_slug', 'offer_slug']);
  if (COACHING_OFFER_SLUGS.has(explicit)) return explicit;
  const payloadIds = ['checkout_id', 'product_id', 'offer_id', 'checkout_uuid', 'checkout_slug', 'product_slug', 'checkout_url']
    .map((key) => findValue(body, [key]))
    .filter(Boolean)
    .flatMap((value) => {
      const normalized = value.toLowerCase();
      const pathPart = normalized.split(/[/?#]/).filter(Boolean).pop();
      return pathPart && pathPart !== normalized ? [normalized, pathPart] : [normalized];
    });
  const configured = {
    'session-1': String(process.env.SP_SESSION || process.env.SPIFFY_COACHING_SESSION_1_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'pack-3': String(process.env.SP_PACK3 || process.env.SPIFFY_COACHING_PACK_3_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'pack-6': String(process.env.SP_PACK6 || process.env.SPIFFY_COACHING_PACK_6_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'membership-3': String(process.env.SPIFFY_COACHING_MEMBERSHIP_3_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'membership-6': String(process.env.SPIFFY_COACHING_MEMBERSHIP_6_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'membership-12': String(process.env.SPIFFY_COACHING_MEMBERSHIP_12_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'es2-complete-coaching': [
      'esprit-subconscient-2-0-39',
      'esprit-subconscient-2-0-36',
      ...String(process.env.SPIFFY_ES2_COMPLETE_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    ],
  };
  return Object.entries(configured).find(([, ids]) => ids.some((id) => payloadIds.includes(id)))?.[0] || null;
}

function coachingProviderOrderId(body, orderId, offerSlug) {
  if (offerSlug !== 'es2-complete-coaching') return orderId;
  const subscriptionId = findValue(body, ['subscription_id', 'subscriptionId', 'recurring_id']);
  // Une formule ES2 en 12 fois peut émettre un événement à chaque échéance.
  // La clé stable de souscription empêche de recréditer 12 crédits chaque mois.
  return subscriptionId ? `es2-subscription:${subscriptionId}` : orderId;
}

function isFirstConsultationCheckout(body) {
  const checkoutId = findValue(body, ['checkout_id', 'checkout_uuid']);
  if (!checkoutId) return false;
  const configured = String(process.env.SP_FIRST || process.env.SPIFFY_FIRST_CONSULTATION_IDS || '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(checkoutId.toLowerCase());
}

function classifyEvent(req, body) {
  const requestUrl = new URL(req.url);
  const purchaseEvents = new Set([
    'purchase', 'purchased', 'product.purchased', 'product:purchased',
    'order.paid', 'order:paid', 'order.success', 'order:success',
    'payment.succeeded', 'payment:succeeded',
    'checkout.complete', 'checkout:complete', 'checkout.completed', 'checkout:completed',
  ]);
  const candidates = [
    requestUrl.searchParams.get('event'),
    req.headers.get('x-spiffy-event'),
    body?.event,
    body?.webhook_event,
    body?.data?.event,
    body?.data?.webhook_event,
    body?.type,
    body?.data?.type,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  for (const value of candidates) {
    const refund = /(^|[.:_-])(refund|refunded)([.:_-]|$)/.test(value) || value === 'refund';
    if (refund) return { value, isRefund: true, isSale: false };
    if (purchaseEvents.has(value)) return { value, isRefund: false, isSale: true };
  }
  return { value: candidates[0] || '', isRefund: false, isSale: false };
}

function safeAuditPayload(body, event) {
  return {
    event: event || null,
    checkout_id: findValue(body, ['checkout_id']),
    offer_name: findValue(body, ['offer_name']),
    payment_gateway: findValue(body, ['payment_gateway']),
    created_at: findValue(body, ['created_at']),
    subscription_id: findValue(body, ['subscription_id', 'subscriptionId', 'recurring_id']),
  };
}

async function cleanRefundedCalendarEvents(engagementId) {
  if (!engagementId) return { status: 'skipped', deleted: 0 };
  const found = await supabaseGet(
    `coaching_sessions?engagement_id=eq.${encodeURIComponent(engagementId)}&status=eq.cancelled&cancellation_reason=eq.${encodeURIComponent('Remboursement Spiffy')}&google_event_id=not.is.null&select=google_event_id,coaching_coaches(id,slug,google_calendar_id)`,
  );
  if (!found.ok) return { status: 'error', deleted: 0 };
  const results = await Promise.allSettled((found.data || []).map((session) => deleteCoachingGoogleMeeting({
    coachId: session.coaching_coaches?.id,
    coachSlug: session.coaching_coaches?.slug,
    calendarId: session.coaching_coaches?.google_calendar_id,
    eventId: session.google_event_id,
  })));
  const failed = results.filter((result) => result.status === 'rejected').length;
  return { status: failed ? 'partial' : 'done', deleted: results.length - failed, failed };
}

async function activatePurchasedCoaching(body, data, orderId, email, offerSlug, event) {
  if (!orderId || !email) return { ok: true, skipped: 'coaching_identity' };
  const purchaseAmountCents = amountCents(data) || amountCents(body);
  if (!purchaseAmountCents) throw new Error('coaching_amount_missing');
  const firstName = findValue(body, ['first_name', 'firstname', 'name_first', 'customer_first_name']) || 'Élève';
  const lastName = findValue(body, ['last_name', 'lastname', 'name_last', 'customer_last_name']) || '';
  const country = findValue(body, ['country_code', 'billing_country', 'country']) || '';
  const currency = findValue(body, ['currency', 'currency_code']) || 'EUR';
  const taxRaw = Number(findValue(body, ['tax_total', 'tax', 'tax_amount']) || 0);
  const taxCents = taxRaw > 10000 ? Math.round(taxRaw) : Math.round(taxRaw * 100);
  const recorded = await supabasePost('rpc/coaching_record_spiffy_order', {
    p_provider_order_id: orderId,
    p_email: email,
    p_first_name: firstName,
    p_last_name: lastName,
    p_offer_slug: offerSlug,
    p_amount_cents: purchaseAmountCents,
    p_tax_cents: taxCents,
    p_currency: currency,
    p_country: country,
    // Les webhooks Spiffy peuvent contenir adresse, téléphone et informations
    // de carte partielles. Le Coaching OS ne conserve que le minimum d'audit.
    p_raw_payload: safeAuditPayload(body, event),
  });
  if (!recorded.ok) throw new Error(`coaching_order_${recorded.status}`);
  const row = Array.isArray(recorded.data) ? recorded.data[0] : recorded.data;
  if (!row) throw new Error('coaching_order_missing');

  let subscription = null;
  if (offerSlug.startsWith('membership-')) {
    const subscriptionId = findValue(body, ['subscription_id', 'subscriptionId', 'recurring_id']);
    if (subscriptionId) {
      const savedSubscription = await supabasePost('rpc/coaching_upsert_spiffy_subscription', {
        p_provider_subscription_id: subscriptionId,
        p_client_id: row.client_id,
        p_offer_slug: offerSlug,
        p_status: findValue(body, ['subscription_status', 'status']) || 'active',
        p_current_period_start: findValue(body, ['current_period_start', 'period_start']) || null,
        p_current_period_end: findValue(body, ['current_period_end', 'period_end']) || null,
      });
      if (!savedSubscription.ok) throw new Error(`coaching_subscription_${savedSubscription.status}`);
      subscription = { status: 'active', provider_subscription_id: subscriptionId };
    } else subscription = { status: 'pending_provider_id' };
  }

  const clientResult = await supabaseGet(`coaching_clients?id=eq.${row.client_id}&select=id,email,first_name,auth_user_id&limit=1`);
  const client = clientResult.ok && Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  if (!client) throw new Error('coaching_client_missing');
  const identifiers = { order_id: row.order_id, client_id: row.client_id, engagement_id: row.engagement_id };
  if (client.auth_user_id) return { ok: true, type: 'coaching_order', already_processed: Boolean(row.already_processed), credits_added: row.credits_added, activation: 'existing_account', subscription, ...identifiers };
  const deliveredResult = await supabaseGet(`coaching_email_deliveries?order_id=eq.${row.order_id}&kind=eq.account_activation&recipient_email=eq.${encodeURIComponent(client.email)}&status=eq.sent&select=id&limit=1`);
  if (!deliveredResult.ok) throw new Error(`coaching_activation_delivery_check_${deliveredResult.status}`);
  if (Array.isArray(deliveredResult.data) && deliveredResult.data[0]) {
    return { ok: true, type: 'coaching_order', already_processed: true, credits_added: row.credits_added, activation: 'already_sent', subscription, ...identifiers };
  }
  if (!process.env.MAILERSEND_API_KEY || !process.env.COACHING_EMAIL_FROM) throw new Error('coaching_activation_email_not_configured');

  let credits = Number(row.credits_added || 0);
  if (!credits) {
    const orderResult = await supabaseGet(`coaching_orders?id=eq.${row.order_id}&select=id,coaching_offers(sessions_count)&limit=1`);
    const order = orderResult.ok && Array.isArray(orderResult.data) ? orderResult.data[0] : null;
    credits = Number(order?.coaching_offers?.sessions_count || 0);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  // Une relivraison Spiffy après une panne email ne doit ni recréditer la
  // commande ni laisser plusieurs liens d'activation valides.
  const closed = await supabasePatch('coaching_account_activations', `client_id=eq.${client.id}&used_at=is.null`, { used_at: new Date().toISOString() });
  if (!closed.ok) throw new Error(`coaching_activation_close_${closed.status}`);
  const activation = await supabasePost('coaching_account_activations', { client_id: client.id, order_id: row.order_id, token_hash: tokenHash, expires_at: expiresAt });
  if (!activation.ok) throw new Error(`coaching_activation_${activation.status}`);
  const activationUrl = coachingAppUrl(`/activer?token=${encodeURIComponent(token)}`);
  const delivery = await sendCoachingActivationEmail({
    email: client.email,
    firstName: client.first_name,
    activationUrl,
    credits,
    firstConsultation: offerSlug === 'first-consultation',
  });
  if (delivery.status !== 'sent') throw new Error(`coaching_activation_email_${delivery.status}`);
  const loggedDelivery = await supabasePost('coaching_email_deliveries', {
    order_id: row.order_id,
    client_id: client.id,
    kind: 'account_activation',
    recipient_email: client.email,
    provider: 'mailersend',
    status: 'sent',
  });
  if (!loggedDelivery.ok) throw new Error(`coaching_activation_delivery_log_${loggedDelivery.status}`);
  return { ok: true, type: 'coaching_order', already_processed: Boolean(row.already_processed), credits_added: row.credits_added, activation: delivery.status, subscription, ...identifiers };
}

async function importFirstConsultationSession(orderId, bookingId) {
  if (!orderId || !bookingId) return { status: 'skipped' };
  const imported = await supabasePost('rpc/coaching_import_first_consultation', {
    p_provider_order_id: orderId,
    p_legacy_booking_id: bookingId,
  });
  if (!imported.ok) throw new Error(`coaching_first_consultation_${imported.status}`);
  const row = Array.isArray(imported.data) ? imported.data[0] : imported.data;
  const sessionId = typeof row === 'string' ? row : row?.coaching_import_first_consultation || row?.session_id;
  if (!sessionId) throw new Error('coaching_first_consultation_session_missing');
  const integrations = await finalizeCoachingBooking(sessionId).catch((error) => {
    console.error('coaching first consultation integrations:', error);
    return { calendar: { status: 'deferred' }, client_email: { status: 'deferred' }, coach_email: { status: 'deferred' } };
  });
  return { status: 'imported', session_id: sessionId, integrations };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  try {
    const rawBody = await req.text();
    const signatureVerdict = verifySignature(rawBody, req.headers);
    const tokenVerdict = verifyPrivateWebhookToken(req);
    if (signatureVerdict !== 'ok' && tokenVerdict !== 'ok') {
      if (signatureVerdict === 'no_secret' && tokenVerdict === 'no_secret') return json(503, { error: 'webhook_secret_missing' });
      return json(401, { error: 'invalid_signature' });
    }

    const body = JSON.parse(rawBody || '{}');
    const data = body?.data || body;
    const { value: event, isRefund, isSale } = classifyEvent(req, body);
    if (!isRefund && !isSale) return json(200, { ok: true, skipped: 'event' });

    const token = findValue(body, ['coach_booking_token', 'booking_token']);
    const email = (findEmail(body) || '').trim().toLowerCase();
    const rawOrderId = findValue(body, ['order_id', 'orderId', 'order_uuid', 'transaction_id']);
    const offerSlug = coachingOfferSlug(req, body);
    const orderId = coachingProviderOrderId(body, rawOrderId, offerSlug);
    const firstConsultation = isFirstConsultationCheckout(body);
    let coachingRefund = null;

    if (isRefund && orderId) {
      const existingOrder = await supabaseGet(`coaching_orders?provider=eq.spiffy&provider_order_id=eq.${encodeURIComponent(orderId)}&select=id,engagement_id&limit=1`);
      if (existingOrder.ok && Array.isArray(existingOrder.data) && existingOrder.data[0]) {
        const refunded = await supabasePost('rpc/coaching_refund_spiffy_order', { p_provider_order_id: orderId });
        if (!refunded.ok) throw new Error(`coaching_refund_${refunded.status}`);
        const calendar = await cleanRefundedCalendarEvents(existingOrder.data[0].engagement_id);
        coachingRefund = { status: 'refunded', integrations: { calendar } };
        if (!firstConsultation && !token) return json(200, { ok: true, type: 'coaching_refund', integrations: { calendar } });
      }
    }

    if (isSale && offerSlug) {
      return json(200, await activatePurchasedCoaching(body, data, orderId, email, offerSlug, event));
    }

    // Un checkout inconnu ne doit jamais être rapproché par email d'une
    // réservation de première consultation. Le token est prioritaire ; sinon
    // l'identifiant 39602 doit être explicitement configuré côté Netlify.
    if (!token && !firstConsultation) return json(200, { ok: true, skipped: 'checkout' });

    let query = '';
    if (isRefund && orderId) query = 'spiffy_order_id=eq.' + encodeURIComponent(orderId);
    else if (token) query = 'public_token=eq.' + encodeURIComponent(token);
    else if (email) query = 'customer_email=eq.' + encodeURIComponent(email) + '&order=created_at.desc';
    else return json(200, coachingRefund ? { ok: true, type: 'coaching_refund', coaching: coachingRefund, legacy: 'identity_missing' } : { ok: true, skipped: 'identity' });

    const found = await supabaseGet(
      'coach_diagnostic_bookings?' + query +
      '&status=in.(pending_payment,paid,expired,payment_review)&select=id,slot_id,status,expires_at&limit=1',
    );
    const booking = found.ok && Array.isArray(found.data) ? found.data[0] : null;
    if (!booking) return json(200, coachingRefund ? { ok: true, type: 'coaching_refund', coaching: coachingRefund, legacy: 'booking_not_found' } : { ok: true, skipped: 'booking_not_found' });

    const now = new Date();
    if (isRefund) {
      const refundedBooking = await supabasePatch(
        'coach_diagnostic_bookings',
        'id=eq.' + encodeURIComponent(booking.id),
        { status: 'refunded', refunded_at: now.toISOString() },
      );
      if (!refundedBooking.ok) throw new Error(`diagnostic_refund_${refundedBooking.status}`);
      const releasedSlot = await supabasePatch(
        'coach_diagnostic_slots',
        'id=eq.' + encodeURIComponent(booking.slot_id) + '&status=eq.booked&starts_at=gt.' + encodeURIComponent(now.toISOString()),
        { status: 'available', held_until: null },
      );
      if (!releasedSlot.ok) throw new Error(`diagnostic_refund_slot_${releasedSlot.status}`);
      return json(200, { ok: true, type: 'refund', ...(coachingRefund ? { coaching: coachingRefund } : {}) });
    }

    const paymentAlreadyRecorded = booking.status === 'paid' || booking.status === 'payment_review';
    const expired = booking.status === 'payment_review' || booking.status === 'expired' ||
      (!paymentAlreadyRecorded && new Date(booking.expires_at).getTime() < now.getTime());
    const status = expired ? 'payment_review' : 'paid';
    const paidBooking = await supabasePatch(
      'coach_diagnostic_bookings',
      'id=eq.' + encodeURIComponent(booking.id),
      {
        status,
        ...(!paymentAlreadyRecorded ? { paid_at: now.toISOString() } : {}),
        amount_eur: amountEur(data),
        ...(orderId ? { spiffy_order_id: orderId } : {}),
      },
    );
    if (!paidBooking.ok) throw new Error(`diagnostic_payment_${paidBooking.status}`);

    if (!expired) {
      const bookedSlot = await supabasePatch(
        'coach_diagnostic_slots',
        'id=eq.' + encodeURIComponent(booking.slot_id) + '&status=in.(held,booked)',
        { status: 'booked', held_until: null },
      );
      if (!bookedSlot.ok || !Array.isArray(bookedSlot.data) || !bookedSlot.data[0]) throw new Error('diagnostic_slot_not_booked');
    }

    let coaching = null;
    let session = null;
    if (firstConsultation && orderId) {
      coaching = await activatePurchasedCoaching(body, data, orderId, email, 'first-consultation', event);
      session = status === 'paid'
        ? await importFirstConsultationSession(orderId, booking.id)
        : { status: 'payment_review' };
    }

    return json(200, { ok: true, type: status, ...(coaching ? { coaching, session } : {}) });
  } catch (error) {
    console.error('coach-spiffy-webhook error:', error);
    return json(500, { ok: false });
  }
};
