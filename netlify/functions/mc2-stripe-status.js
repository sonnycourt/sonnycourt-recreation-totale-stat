import { cleanMc2Token, loadMc2Registration, mc2Stripe } from './lib/mc2-stripe.mjs';

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
    const session = await mc2Stripe().checkout.sessions.retrieve(sessionId);
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
    });
  } catch (error) {
    console.error('mc2-stripe-status:', error);
    return json(500, { error: 'Confirmation Stripe indisponible.' });
  }
};
