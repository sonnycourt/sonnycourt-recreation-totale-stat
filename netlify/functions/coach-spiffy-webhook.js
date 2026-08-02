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
  for (const key of ['total', 'amount', 'amount_total', 'grand_total']) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value) && value > 0) return value > 2000 ? Math.round(value) : Math.round(value * 100);
  }
  return 9700;
}

function coachingOfferSlug(body) {
  const explicit = findValue(body, ['coaching_offer_slug', 'offer_slug']);
  if (['session-1', 'pack-3', 'pack-6'].includes(explicit)) return explicit;
  const haystack = JSON.stringify(body).toLowerCase();
  const configured = {
    'session-1': String(process.env.SPIFFY_COACHING_SESSION_1_IDS || '').split(',').filter(Boolean),
    'pack-3': String(process.env.SPIFFY_COACHING_PACK_3_IDS || '').split(',').filter(Boolean),
    'pack-6': String(process.env.SPIFFY_COACHING_PACK_6_IDS || '').split(',').filter(Boolean),
  };
  return Object.entries(configured).find(([, ids]) => ids.some((id) => haystack.includes(id.trim().toLowerCase())))?.[0] || null;
}

async function activatePurchasedCoaching(body, data, orderId, email, offerSlug) {
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
    p_raw_payload: body,
  });
  if (!recorded.ok) throw new Error(`coaching_order_${recorded.status}`);
  const row = Array.isArray(recorded.data) ? recorded.data[0] : recorded.data;
  if (!row || row.already_processed) return { ok: true, type: 'coaching_order', already_processed: true };

  const clientResult = await supabaseGet(`coaching_clients?id=eq.${row.client_id}&select=id,email,first_name,auth_user_id&limit=1`);
  const client = clientResult.ok && Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  if (!client || client.auth_user_id) return { ok: true, type: 'coaching_order', credits_added: row.credits_added, activation: 'existing_account' };

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const activation = await supabasePost('coaching_account_activations', { client_id: client.id, order_id: row.order_id, token_hash: tokenHash, expires_at: expiresAt });
  if (!activation.ok) throw new Error(`coaching_activation_${activation.status}`);
  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://sonnycourt.com';
  const activationUrl = `${origin.replace(/\/$/, '')}/coaching/activer?token=${encodeURIComponent(token)}`;
  const delivery = await sendCoachingActivationEmail({ email: client.email, firstName: client.first_name, activationUrl, credits: row.credits_added });
  return { ok: true, type: 'coaching_order', credits_added: row.credits_added, activation: delivery.status };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  try {
    const rawBody = await req.text();
    const verdict = verifySignature(rawBody, req.headers);
    if (verdict === 'no_secret') return json(503, { error: 'webhook_secret_missing' });
    if (verdict !== 'ok') return json(401, { error: 'invalid_signature' });

    const body = JSON.parse(rawBody || '{}');
    const data = body?.data || body;
    const event = String(body?.event || body?.type || data?.event || '').toLowerCase();
    const isRefund = event.includes('refund');
    const isSale = !isRefund &&
      (event.includes('order:success') || event.includes('order') || event.includes('success'));
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
      return json(200, await activatePurchasedCoaching(body, data, orderId, email, offerSlug));
    }

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
      await supabasePatch(
        'coach_diagnostic_bookings',
        'id=eq.' + encodeURIComponent(booking.id),
        { status: 'refunded', refunded_at: now.toISOString() },
      );
      return json(200, { ok: true, type: 'refund' });
    }

    const expired = booking.status === 'expired' || new Date(booking.expires_at).getTime() < now.getTime();
    const status = expired ? 'payment_review' : 'paid';
    await supabasePatch(
      'coach_diagnostic_bookings',
      'id=eq.' + encodeURIComponent(booking.id),
      {
        status,
        paid_at: now.toISOString(),
        amount_eur: amountEur(data),
        ...(orderId ? { spiffy_order_id: orderId } : {}),
      },
    );

    if (!expired) {
      await supabasePatch(
        'coach_diagnostic_slots',
        'id=eq.' + encodeURIComponent(booking.slot_id) + '&status=eq.held',
        { status: 'booked', held_until: null },
      );
    }

    return json(200, { ok: true, type: status });
  } catch (error) {
    console.error('coach-spiffy-webhook error:', error);
    return json(500, { ok: false });
  }
};
