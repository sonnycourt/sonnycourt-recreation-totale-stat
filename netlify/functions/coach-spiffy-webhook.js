import crypto from 'crypto';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { sendCoachingActivationEmail } from './lib/coaching-integrations.mjs';

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
  return amountCents(obj) / 100;
}

function amountCents(obj) {
  for (const key of ['amount_cents', 'total_cents']) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  for (const key of ['order_total', 'total', 'amount', 'amount_total', 'grand_total']) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value) && value > 0) return value > 2000 ? Math.round(value) : Math.round(value * 100);
  }
  return 9700;
}

function coachingOfferSlug(body) {
  const explicit = findValue(body, ['coaching_offer_slug', 'offer_slug']);
  if (['session-1', 'pack-3', 'pack-6'].includes(explicit)) return explicit;
  const payloadIds = ['checkout_id', 'product_id', 'offer_id', 'checkout_uuid']
    .map((key) => findValue(body, [key]))
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  const configured = {
    'session-1': String(process.env.SPIFFY_COACHING_SESSION_1_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'pack-3': String(process.env.SPIFFY_COACHING_PACK_3_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
    'pack-6': String(process.env.SPIFFY_COACHING_PACK_6_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
  };
  return Object.entries(configured).find(([, ids]) => ids.some((id) => payloadIds.includes(id)))?.[0] || null;
}

function isFirstConsultationCheckout(body) {
  const checkoutId = findValue(body, ['checkout_id', 'checkout_uuid']);
  if (!checkoutId) return false;
  const configured = String(process.env.SPIFFY_FIRST_CONSULTATION_IDS || '')
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
  };
}

async function activatePurchasedCoaching(body, data, orderId, email, offerSlug, event) {
  if (!orderId || !email) return { ok: true, skipped: 'coaching_identity' };
  const firstName = findValue(body, ['first_name', 'firstname', 'name_first', 'customer_first_name']) || 'Bonjour';
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
    p_amount_cents: amountCents(data),
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

  const clientResult = await supabaseGet(`coaching_clients?id=eq.${row.client_id}&select=id,email,first_name,auth_user_id&limit=1`);
  const client = clientResult.ok && Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  if (!client) throw new Error('coaching_client_missing');
  if (client.auth_user_id) return { ok: true, type: 'coaching_order', already_processed: Boolean(row.already_processed), credits_added: row.credits_added, activation: 'existing_account' };
  const deliveredResult = await supabaseGet(`coaching_email_deliveries?order_id=eq.${row.order_id}&kind=eq.account_activation&recipient_email=eq.${encodeURIComponent(client.email)}&status=eq.sent&select=id&limit=1`);
  if (!deliveredResult.ok) throw new Error(`coaching_activation_delivery_check_${deliveredResult.status}`);
  if (Array.isArray(deliveredResult.data) && deliveredResult.data[0]) {
    return { ok: true, type: 'coaching_order', already_processed: true, credits_added: row.credits_added, activation: 'already_sent' };
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
  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://sonnycourt.com';
  const activationUrl = `${origin.replace(/\/$/, '')}/coaching/activer?token=${encodeURIComponent(token)}`;
  const delivery = await sendCoachingActivationEmail({ email: client.email, firstName: client.first_name, activationUrl, credits });
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
  return { ok: true, type: 'coaching_order', already_processed: Boolean(row.already_processed), credits_added: row.credits_added, activation: delivery.status };
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
    const orderId = findValue(body, ['order_id', 'orderId']) || findValue(data, ['id']);
    const offerSlug = coachingOfferSlug(body);

    if (isRefund && orderId) {
      const existingOrder = await supabaseGet(`coaching_orders?provider=eq.spiffy&provider_order_id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`);
      if (existingOrder.ok && Array.isArray(existingOrder.data) && existingOrder.data[0]) {
        const refunded = await supabasePost('rpc/coaching_refund_spiffy_order', { p_provider_order_id: orderId });
        if (!refunded.ok) throw new Error(`coaching_refund_${refunded.status}`);
        return json(200, { ok: true, type: 'coaching_refund' });
      }
    }

    if (isSale && offerSlug) {
      return json(200, await activatePurchasedCoaching(body, data, orderId, email, offerSlug, event));
    }

    // Un checkout inconnu ne doit jamais être rapproché par email d'une
    // réservation de première consultation. Le token est prioritaire ; sinon
    // l'identifiant 39602 doit être explicitement configuré côté Netlify.
    if (!token && !isFirstConsultationCheckout(body)) return json(200, { ok: true, skipped: 'checkout' });

    let query = '';
    if (token) query = 'public_token=eq.' + encodeURIComponent(token);
    else if (email) query = 'customer_email=eq.' + encodeURIComponent(email) + '&order=created_at.desc';
    else return json(200, { ok: true, skipped: 'identity' });

    const found = await supabaseGet(
      'coach_diagnostic_bookings?' + query +
      '&status=in.(pending_payment,paid,expired)&select=id,slot_id,status,expires_at&limit=1',
    );
    const booking = found.ok && Array.isArray(found.data) ? found.data[0] : null;
    if (!booking) return json(200, { ok: true, skipped: 'booking_not_found' });

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
      return json(200, { ok: true, type: 'refund' });
    }

    const expired = booking.status === 'expired' || new Date(booking.expires_at).getTime() < now.getTime();
    const status = expired ? 'payment_review' : 'paid';
    const paidBooking = await supabasePatch(
      'coach_diagnostic_bookings',
      'id=eq.' + encodeURIComponent(booking.id),
      {
        status,
        paid_at: now.toISOString(),
        amount_eur: amountEur(data),
        ...(orderId ? { spiffy_order_id: orderId } : {}),
      },
    );
    if (!paidBooking.ok) throw new Error(`diagnostic_payment_${paidBooking.status}`);

    if (!expired) {
      const bookedSlot = await supabasePatch(
        'coach_diagnostic_slots',
        'id=eq.' + encodeURIComponent(booking.slot_id) + '&status=eq.held',
        { status: 'booked', held_until: null },
      );
      if (!bookedSlot.ok || !Array.isArray(bookedSlot.data) || !bookedSlot.data[0]) throw new Error('diagnostic_slot_not_booked');
    }

    return json(200, { ok: true, type: status });
  } catch (error) {
    console.error('coach-spiffy-webhook error:', error);
    return json(500, { ok: false });
  }
};
