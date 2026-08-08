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
    const overview = await getPayPalConnectionOverview();
    return json(200, { ...overview, writes_enabled: overview.mode !== 'live' || process.env.PAYPAL_LIVE_WRITES_ENABLED === 'true' });
  } catch (error) {
    console.error('pay-paypal-overview:', cleanPayPalValue(error?.message, 120));
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    return json(status, {
      connected: false,
      error: status === 503 ? 'paypal_credentials_missing' : 'paypal_unavailable',
    });
  }
};
