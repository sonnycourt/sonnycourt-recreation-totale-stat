import { cleanMc2Token, loadMc2Registration } from './lib/mc2-stripe.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';

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
      'token,email,prenom,telephone,pays,statut,payment_status,initial_payment_cents,contractual_total_cents,checkout_last_payment_mode,billing_full_name,billing_phone,billing_street,billing_street2,billing_zip,billing_city,billing_country',
    );
    if (!registration) return json(404, { error: 'Achat introuvable.' });
    const paid = registration.payment_status === 'paid' && registration.statut === 'purchased';
    // Never release the personal form from a URL flag or a client-side success.
    if (!paid) return json(200, { paid: false, schedule_ready: false, payment_status: registration.payment_status || 'pending' });
    let purchase = {};
    if (String(registration.checkout_last_payment_mode || '').startsWith('spiffy_j7_')) {
      const orderId = String(url.searchParams.get('order') || '').trim();
      const events = await supabaseGet(`mc2_funnel_events?token=eq.${encodeURIComponent(token)}`
        + '&event_name=eq.purchase_completed&metadata->>provider=eq.spiffy'
        + (orderId ? `&metadata->>order_id=eq.${encodeURIComponent(orderId)}` : '')
        + '&select=metadata&order=occurred_at.desc&limit=1');
      if (!events.ok) return json(503, { error: 'Confirmation temporairement indisponible.' });
      purchase = events.data?.[0]?.metadata;
      if (!purchase) return json(200, { paid: false, schedule_ready: false, payment_status: 'pending' });
    }
    const fullName = String(registration.billing_full_name || '').trim();
    const firstName = purchase.purchase_first_name || registration.prenom || '';
    const savedName = fullName && firstName && fullName.startsWith(firstName + ' ')
      ? [firstName, fullName.slice(firstName.length + 1)]
      : fullName.split(/\s+/);
    return json(200, {
      paid,
      payment_status: registration.payment_status || 'pending',
      schedule_ready: paid,
      amount_total: Number(registration.initial_payment_cents || 0),
      currency: 'eur',
      email: purchase.purchase_email || registration.email || '',
      first_name: fullName ? savedName[0] : firstName,
      last_name: fullName ? savedName.slice(1).join(' ') : '',
      phone: registration.billing_phone || registration.telephone || '',
      country: registration.billing_country || registration.pays || '',
      street: registration.billing_street || '',
      street2: registration.billing_street2 || '',
      zip: registration.billing_zip || '',
      city: registration.billing_city || '',
    });
  } catch (error) {
    console.error('mc2-spiffy-status:', error);
    return json(500, { error: 'Confirmation Spiffy indisponible.' });
  }
};
