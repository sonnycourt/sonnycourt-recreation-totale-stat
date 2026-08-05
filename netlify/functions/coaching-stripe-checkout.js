import crypto from 'crypto';
import { coachingAppUrl, coachingMarketingUrl } from './lib/coaching-origin.mjs';
import {
  authenticatedCoachingClient,
  coachingStripe,
  coachingStripePublishableKey,
  loadCoachingOffer,
  validCoachingOfferSlug,
} from './lib/coaching-stripe.mjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function firstName(value) {
  return clean(value, 100).split(/\s+/)[0] || 'Élève';
}

async function firstConsultationContext(bookingToken) {
  const result = await supabaseGet(
    `coach_diagnostic_bookings?public_token=eq.${encodeURIComponent(bookingToken)}` +
    '&status=in.(pending_payment,payment_review)&select=id,public_token,status,expires_at,customer_name,customer_email,stripe_checkout_session_id,coach_diagnostic_slots(starts_at,ends_at,status)&limit=1',
  );
  const booking = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!booking) throw new Error('booking_not_found');
  if (booking.status === 'pending_payment' && new Date(booking.expires_at).getTime() < Date.now()) throw new Error('booking_expired');
  return booking;
}

async function reusableFirstConsultationSession(stripe, booking) {
  if (!booking.stripe_checkout_session_id) return null;
  const existing = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id).catch(() => null);
  return existing && existing.status === 'open' && existing.client_secret ? existing : null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  try {
    const body = await req.json().catch(() => ({}));
    const offerSlug = validCoachingOfferSlug(body.offer_slug);
    if (!offerSlug) return json(400, { error: 'Offre coaching invalide.' });

    const stripe = coachingStripe();
    const publishableKey = coachingStripePublishableKey();
    const offer = await loadCoachingOffer(offerSlug);
    const membership = offerSlug.startsWith('membership-');
    let booking = null;
    let account = null;

    if (offerSlug === 'first-consultation') {
      const bookingToken = clean(body.booking, 80);
      if (!bookingToken) return json(400, { error: 'Réservation manquante.' });
      booking = await firstConsultationContext(bookingToken);
      const reusable = await reusableFirstConsultationSession(stripe, booking);
      if (reusable) {
        return json(200, {
          client_secret: reusable.client_secret,
          publishable_key: publishableKey,
          checkout_session_id: reusable.id,
          offer: { slug: offer.slug, name: offer.name, amount: offer.price_cents, currency: offer.currency },
        });
      }
    } else {
      account = await authenticatedCoachingClient(req);
      if (!account) return json(401, { error: 'Reconnecte-toi pour continuer.' });
    }

    const email = booking?.customer_email || account.client.email;
    const name = booking?.customer_name || [account.client.first_name, account.client.last_name].filter(Boolean).join(' ');
    const country = account?.client.country || '';
    const customerId = account?.client.stripe_customer_id || undefined;
    const metadata = {
      system: 'sonnycourt_coaching',
      offer_slug: offer.slug,
      customer_first_name: firstName(name),
      ...(booking ? { booking_token: booking.public_token, legacy_booking_id: booking.id } : { coaching_client_id: account.client.id }),
    };
    const returnUrl = booking
      ? coachingMarketingUrl(`/coach-romain/confirmation?booking=${encodeURIComponent(booking.public_token)}&stripe_session_id={CHECKOUT_SESSION_ID}`)
      : coachingAppUrl('/achat-confirme?stripe_session_id={CHECKOUT_SESSION_ID}');
    const sessionOptions = {
      ui_mode: 'custom',
      mode: membership ? 'subscription' : 'payment',
      line_items: [{ price: offer.stripe_price_id, quantity: 1 }],
      return_url: returnUrl,
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      client_reference_id: booking?.public_token || account.client.id,
      metadata,
      ...(customerId
        ? { customer: customerId, customer_update: { address: 'auto', name: 'auto' } }
        : { customer_email: email, ...(!membership ? { customer_creation: 'always' } : {}) }),
      ...(membership
        ? { subscription_data: { metadata } }
        : { payment_intent_data: { metadata }, invoice_creation: { enabled: true } }),
    };

    const idempotencySeed = booking?.public_token || clean(body.nonce, 80) || crypto.randomUUID();
    const session = await stripe.checkout.sessions.create(sessionOptions, {
      idempotencyKey: `coaching:${offer.slug}:${idempotencySeed}`,
    });
    if (!session.client_secret) throw new Error('stripe_checkout_client_secret_missing');

    if (booking) {
      const saved = await supabasePatch(
        'coach_diagnostic_bookings',
        `id=eq.${encodeURIComponent(booking.id)}&status=in.(pending_payment,payment_review)`,
        { payment_provider: 'stripe', stripe_checkout_session_id: session.id },
      );
      if (!saved.ok || !Array.isArray(saved.data) || !saved.data[0]) throw new Error('stripe_booking_session_not_saved');
    }

    return json(200, {
      client_secret: session.client_secret,
      publishable_key: publishableKey,
      checkout_session_id: session.id,
      offer: { slug: offer.slug, name: offer.name, amount: offer.price_cents, currency: offer.currency },
      customer: { name, email, country },
    });
  } catch (error) {
    console.error('coaching-stripe-checkout:', error);
    const message = String(error?.message || '');
    if (message === 'booking_expired') return json(409, { error: 'Ce créneau n’est plus réservé. Choisis-en un autre.' });
    if (message === 'booking_not_found') return json(404, { error: 'Réservation introuvable.' });
    if (message.includes('missing')) return json(503, { error: 'Le paiement Stripe doit encore être configuré.' });
    return json(500, { error: 'Le paiement sécurisé ne peut pas être préparé.' });
  }
};
