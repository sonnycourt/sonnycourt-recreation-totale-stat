import { coachingAppUrl } from './lib/coaching-origin.mjs';
import { authenticatedCoachingClient, coachingStripe } from './lib/coaching-stripe.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function coachingPortalConfiguration(stripe) {
  const configured = String(process.env.STRIPE_COACHING_PORTAL_CONFIGURATION_ID || '').trim();
  if (configured) return configured;

  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const match = existing.data.find((configuration) => configuration.metadata?.system === 'sonnycourt_coaching');
  if (match) return match.id;

  const created = await stripe.billingPortal.configurations.create({
    name: 'Coaching OS',
    default_return_url: coachingAppUrl('/credits'),
    business_profile: {
      headline: 'Gère ton membership et tes informations de paiement.',
      privacy_policy_url: 'https://sonnycourt.com/confidentialite/',
      terms_of_service_url: 'https://sonnycourt.com/conditions-utilisation/',
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ['address', 'name', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'unused', 'customer_service', 'low_quality', 'other'],
        },
      },
      subscription_update: { enabled: false },
    },
    metadata: { system: 'sonnycourt_coaching' },
  });
  return created.id;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  try {
    const account = await authenticatedCoachingClient(req);
    if (!account) return json(401, { error: 'Reconnecte-toi pour continuer.' });
    if (!account.client.stripe_customer_id) return json(404, { error: 'Aucun membership Stripe actif.' });
    const stripe = coachingStripe();
    const configuration = await coachingPortalConfiguration(stripe);
    const session = await stripe.billingPortal.sessions.create({
      customer: account.client.stripe_customer_id,
      configuration,
      return_url: coachingAppUrl('/credits'),
    });
    return json(200, { url: session.url });
  } catch (error) {
    console.error('coaching-stripe-portal:', error);
    return json(500, { error: 'Le portail Stripe est indisponible.' });
  }
};
