import { issueCoachingAccountActivation } from './lib/coaching-purchases.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const genericResponse = () => json(200, {
  ok: true,
  message: 'Si cette adresse correspond à une réservation, un lien d’activation vient d’être envoyé.',
});

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  if (!validEmail(email)) return json(400, { error: 'Adresse email invalide.' });

  try {
    const clientResult = await supabaseGet(
      `coaching_clients?email=eq.${encodeURIComponent(email)}&select=id,email,first_name,auth_user_id&limit=1`,
    );
    const client = clientResult.ok && Array.isArray(clientResult.data) ? clientResult.data[0] : null;
    if (!client || client.auth_user_id) return genericResponse();

    const orderResult = await supabaseGet(
      `coaching_orders?client_id=eq.${encodeURIComponent(client.id)}&status=eq.paid` +
      '&select=id,created_at,coaching_offers(slug,sessions_count)&order=created_at.desc&limit=1',
    );
    const order = orderResult.ok && Array.isArray(orderResult.data) ? orderResult.data[0] : null;
    if (!order) return genericResponse();

    const recentResult = await supabaseGet(
      `coaching_account_activations?client_id=eq.${encodeURIComponent(client.id)}` +
      '&select=created_at&order=created_at.desc&limit=1',
    );
    const recent = recentResult.ok && Array.isArray(recentResult.data) ? recentResult.data[0] : null;
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000) return genericResponse();

    const offer = order.coaching_offers || {};
    await issueCoachingAccountActivation({
      client,
      orderId: order.id,
      credits: Number(offer.sessions_count || 0),
      firstConsultation: offer.slug === 'first-consultation',
      deliveryKind: 'account_activation_resend',
    });
  } catch (error) {
    console.error('coaching-resend-activation:', error);
  }
  return genericResponse();
};
