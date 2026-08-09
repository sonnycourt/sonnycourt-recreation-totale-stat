import crypto from 'crypto';
import {
  MC2_CONTRACT_TOTAL_CENTS,
  MC2_STRIPE_ENTRY_PRICE_ID,
  cleanMc2Token,
  loadMc2Registration,
  mc2PublicOrigin,
  mc2Stripe,
  mc2StripePublishableKey,
} from './lib/mc2-stripe.mjs';
import { supabasePatch } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function firstName(value) {
  return clean(value, 100).split(/\s+/)[0] || 'Élève';
}

async function reusableSession(stripe, registration) {
  if (!registration.stripe_checkout_session_id) return null;
  const session = await stripe.checkout.sessions.retrieve(registration.stripe_checkout_session_id).catch(() => null);
  return session?.status === 'open' && session.client_secret ? session : null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = cleanMc2Token(body.token);
    if (!token) return json(400, { error: 'Lien de paiement incomplet.' });

    const registration = await loadMc2Registration(token);
    if (!registration) return json(404, { error: 'Inscription MC2 introuvable.' });
    if (registration.payment_status === 'paid' || registration.statut === 'purchased') {
      return json(409, { error: 'Cette inscription est déjà réglée.' });
    }
    if (registration.offer_expires_at && new Date(registration.offer_expires_at).getTime() < Date.now()) {
      return json(410, { error: 'Cette offre a expiré.' });
    }

    const stripe = mc2Stripe();
    const existing = await reusableSession(stripe, registration);
    if (existing) {
      return json(200, {
        client_secret: existing.client_secret,
        publishable_key: mc2StripePublishableKey(),
        checkout_session_id: existing.id,
        customer: { name: registration.prenom, email: registration.email },
      });
    }

    const metadata = {
      system: 'es2_mc2',
      funnel: 'mc2',
      mc2_token: token,
      traffic_source: clean(registration.traffic_source || 'organic', 40),
      payment_plan: '47_now_150_d14_11x197',
      contractual_total_cents: String(MC2_CONTRACT_TOTAL_CENTS),
    };
    const returnUrl = `${mc2PublicOrigin(req)}/commencer/succes/?session_id={CHECKOUT_SESSION_ID}&t=${encodeURIComponent(token)}`;
    const customerId = clean(registration.stripe_customer_id, 80) || undefined;
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'custom',
      mode: 'payment',
      line_items: [{ price: MC2_STRIPE_ENTRY_PRICE_ID, quantity: 1 }],
      return_url: returnUrl,
      payment_method_types: ['card'],
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      client_reference_id: token,
      metadata,
      ...(customerId
        ? { customer: customerId, customer_update: { address: 'auto', name: 'auto' } }
        : { customer_email: registration.email, customer_creation: 'always' }),
      payment_intent_data: {
        setup_future_usage: 'off_session',
        receipt_email: registration.email,
        statement_descriptor_suffix: 'ES2',
        metadata: { ...metadata, customer_first_name: firstName(registration.prenom) },
      },
      invoice_creation: { enabled: true },
    }, {
      idempotencyKey: `mc2-checkout:${token}:${clean(body.nonce, 80) || crypto.randomUUID()}`,
    });

    if (!session.client_secret) throw new Error('stripe_checkout_client_secret_missing');
    const saved = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(token)}`, {
      stripe_checkout_session_id: session.id,
      payment_status: 'checkout_open',
      checkout_engaged: true,
      checkout_last_viewed_at: new Date().toISOString(),
      last_intent_at: new Date().toISOString(),
    });
    if (!saved.ok) throw new Error('mc2_checkout_not_saved');

    return json(200, {
      client_secret: session.client_secret,
      publishable_key: mc2StripePublishableKey(),
      checkout_session_id: session.id,
      offer: { amount: 4700, currency: 'eur', contractual_total: MC2_CONTRACT_TOTAL_CENTS },
      customer: { name: registration.prenom, email: registration.email },
    });
  } catch (error) {
    console.error('mc2-stripe-checkout:', error);
    const message = String(error?.message || '');
    if (message.includes('missing')) return json(503, { error: 'Stripe doit encore être activé pour MC2.' });
    return json(500, { error: 'Le paiement sécurisé ne peut pas être préparé.' });
  }
};
