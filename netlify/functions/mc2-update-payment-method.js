import {
  cleanMc2Token,
  loadMc2Registration,
  mc2PublicOrigin,
  mc2Stripe,
} from './lib/mc2-stripe.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function mc2PortalConfiguration(stripe, origin) {
  const configured = String(process.env.STRIPE_MC2_PORTAL_CONFIGURATION_ID || '').trim();
  if (configured) return configured;

  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const match = existing.data.find((configuration) => configuration.metadata?.system === 'es2_mc2');
  if (match) return match.id;

  const created = await stripe.billingPortal.configurations.create({
    name: 'Esprit Subconscient 2.0 — paiement',
    default_return_url: `${origin}/`,
    business_profile: {
      headline: 'Mets à jour ta carte en toute sécurité.',
      privacy_policy_url: `${origin}/confidentialite/`,
      terms_of_service_url: `${origin}/conditions-utilisation/`,
    },
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: false },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { system: 'es2_mc2' },
  });
  return created.id;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = cleanMc2Token(body.token);
    if (!token) return json(400, { error: 'Lien de mise à jour incomplet.' });

    const registration = await loadMc2Registration(
      token,
      'token,statut,payment_status,stripe_customer_id',
    );
    if (!registration) return json(404, { error: 'Dossier de paiement introuvable.' });
    if (!registration.stripe_customer_id || registration.statut !== 'purchased') {
      return json(409, { error: 'Aucun échéancier actif n’est associé à ce lien.' });
    }

    const stripe = mc2Stripe();
    const origin = mc2PublicOrigin(req);
    const configuration = await mc2PortalConfiguration(stripe, origin);
    const returnUrl = `${origin}/paiement/actualiser/?done=1&t=${encodeURIComponent(token)}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: registration.stripe_customer_id,
      configuration,
      return_url: returnUrl,
      flow_data: {
        type: 'payment_method_update',
        after_completion: {
          type: 'redirect',
          redirect: { return_url: returnUrl },
        },
      },
    });
    return json(200, { url: session.url });
  } catch (error) {
    console.error('mc2-update-payment-method:', error);
    return json(500, { error: 'La mise à jour sécurisée est momentanément indisponible.' });
  }
};
