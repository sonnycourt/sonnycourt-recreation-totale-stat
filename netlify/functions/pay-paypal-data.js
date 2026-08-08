import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { cleanPayPalValue } from './lib/pay-paypal.mjs';
import { getPayPalTransactions } from './lib/pay-paypal-data.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Méthode non autorisée' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });
  const url = new URL(req.url);
  try {
    const data = await getPayPalTransactions({
      start: cleanPayPalValue(url.searchParams.get('start'), 40),
      end: cleanPayPalValue(url.searchParams.get('end'), 40),
    });
    return json(200, data);
  } catch (error) {
    console.error('pay-paypal-data:', cleanPayPalValue(error?.message, 120));
    const invalid = String(error?.message || '').startsWith('paypal_range_');
    return json(invalid ? 400 : 502, {
      connected: false,
      error: invalid ? cleanPayPalValue(error.message, 80) : 'paypal_transactions_unavailable',
    });
  }
};
