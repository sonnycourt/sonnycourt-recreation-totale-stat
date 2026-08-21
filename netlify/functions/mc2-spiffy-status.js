import { cleanMc2Token, loadMc2Registration } from './lib/mc2-stripe.mjs';

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
    if (!token) return json(400, { error: 'Confirmation incomplète.' });
    const registration = await loadMc2Registration(
      token,
      'token,prenom,telephone,pays,statut,payment_status,initial_payment_cents,contractual_total_cents',
    );
    if (!registration) return json(404, { error: 'Achat introuvable.' });
    const paid = registration.payment_status === 'paid' && registration.statut === 'purchased';
    return json(200, {
      paid,
      payment_status: registration.payment_status || 'pending',
      schedule_ready: paid,
      amount_total: Number(registration.initial_payment_cents || 0),
      currency: 'eur',
      first_name: registration.prenom || '',
      phone: registration.telephone || '',
      country: registration.pays || '',
    });
  } catch (error) {
    console.error('mc2-spiffy-status:', error);
    return json(500, { error: 'Confirmation Spiffy indisponible.' });
  }
};
