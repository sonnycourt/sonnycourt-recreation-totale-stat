import crypto from 'node:crypto';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import { cleanMc2Token, mc2Stripe } from './lib/mc2-stripe.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 220) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  try {
    const body = await req.json().catch(() => ({}));
    const token = cleanMc2Token(body.t);
    const sessionId = clean(body.session_id, 255);
    if (!token || !sessionId) return json(400, { error: 'Identification manquante' });
    const registrationResult = await supabaseGet(
      `mc2_registrations?token=eq.${encodeURIComponent(token)}`
        + '&select=token,email,stripe_checkout_session_id,stripe_customer_id,payment_status&limit=1',
    );
    const registration = registrationResult.ok && Array.isArray(registrationResult.data)
      ? registrationResult.data[0]
      : null;
    if (!registration || registration.stripe_checkout_session_id !== sessionId) {
      return json(404, { error: 'Achat introuvable' });
    }
    const session = await mc2Stripe().checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid' || session.client_reference_id !== token) {
      return json(403, { error: 'Paiement non confirmé' });
    }
    const patch = {
      billing_full_name: clean(body.full_name, 160),
      billing_phone: clean(body.phone, 40),
      billing_street: clean(body.street),
      billing_street2: clean(body.street2) || null,
      billing_zip: clean(body.zip, 30),
      billing_city: clean(body.city, 120),
      billing_country: clean(body.country, 80),
      billing_completed_at: new Date().toISOString(),
    };
    const missing = ['billing_full_name', 'billing_phone', 'billing_street', 'billing_zip', 'billing_city', 'billing_country']
      .filter((field) => !patch[field]);
    if (missing.length) return json(400, { error: 'Champs obligatoires manquants', missing });
    const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(token)}`, patch);
    if (!updated.ok) return json(500, { error: 'Enregistrement impossible' });
    if (registration.stripe_customer_id) {
      const addressFingerprint = crypto.createHash('sha256')
        .update(JSON.stringify(patch))
        .digest('hex')
        .slice(0, 24);
      await mc2Stripe().customers.update(registration.stripe_customer_id, {
        name: patch.billing_full_name,
        phone: patch.billing_phone,
        address: {
          line1: patch.billing_street,
          line2: patch.billing_street2 || undefined,
          postal_code: patch.billing_zip,
          city: patch.billing_city,
          country: /^[A-Za-z]{2}$/.test(patch.billing_country) ? patch.billing_country.toUpperCase() : undefined,
        },
      }, { idempotencyKey: `mc2-billing:${token}:${addressFingerprint}` });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error('mc2-billing-info:', error);
    return json(500, { error: 'Erreur serveur' });
  }
};
