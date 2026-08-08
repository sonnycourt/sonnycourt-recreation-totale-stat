import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { cleanPayPalValue, getPayPalConnectionOverview } from './lib/pay-paypal.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Méthode non autorisée' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });

  try {
    return json(200, await getPayPalConnectionOverview());
  } catch (error) {
    console.error('pay-paypal-overview:', cleanPayPalValue(error?.message, 120));
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    return json(status, {
      connected: false,
      error: status === 503 ? 'paypal_credentials_missing' : 'paypal_unavailable',
    });
  }
};
