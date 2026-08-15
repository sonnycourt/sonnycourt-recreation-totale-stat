import { cleanMc2Token, loadMc2Registration, mc2Stripe } from './lib/mc2-stripe.mjs';

const SAFE_INTENT_STATUSES = new Set([
  'canceled',
  'processing',
  'requires_action',
  'requires_capture',
  'requires_confirmation',
  'requires_payment_method',
  'succeeded',
]);

function safeText(value, allowed, max = 100) {
  const text = String(value || '').trim().slice(0, max);
  return allowed ? (allowed.has(text) ? text : '') : text.replace(/[^a-z0-9_-]/gi, '');
}

function paymentAuthentication(session) {
  const intent = session?.payment_intent && typeof session.payment_intent === 'object'
    ? session.payment_intent
    : null;
  const charge = intent?.latest_charge && typeof intent.latest_charge === 'object'
    ? intent.latest_charge
    : null;
  const threeDSecure = charge?.payment_method_details?.card?.three_d_secure;
  const intentStatus = safeText(intent?.status, SAFE_INTENT_STATUSES, 48);
  if (!threeDSecure || typeof threeDSecure !== 'object') {
    return {
      attempted: false,
      state: intentStatus === 'requires_action' ? 'required' : 'not_observed',
      intent_status: intentStatus,
    };
  }
  return {
    attempted: true,
    state: 'attempted',
    result: safeText(threeDSecure.result, null, 48),
    flow: safeText(threeDSecure.authentication_flow, null, 48),
    reason: safeText(threeDSecure.result_reason, null, 100),
    intent_status: intentStatus,
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Méthode non autorisée' });
  try {
    const url = new URL(req.url);
    const token = cleanMc2Token(url.searchParams.get('t'));
    const sessionId = String(url.searchParams.get('session_id') || '').trim().slice(0, 100);
    if (!token || !sessionId) return json(400, { error: 'Confirmation incomplète.' });
    const session = await mc2Stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.latest_charge'],
    });
    if (session.metadata?.system !== 'es2_mc2' || session.metadata?.mc2_token !== token) {
      return json(404, { error: 'Paiement introuvable.' });
    }
    const registration = await loadMc2Registration(token);
    return json(200, {
      paid: session.payment_status === 'paid',
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      schedule_ready: Boolean(registration?.stripe_subscription_schedule_id),
      first_name: registration?.prenom || '',
      phone: registration?.telephone || '',
      country: registration?.pays || '',
      authentication: paymentAuthentication(session),
    });
  } catch (error) {
    console.error('mc2-stripe-status:', error);
    return json(500, { error: 'Confirmation Stripe indisponible.' });
  }
};
