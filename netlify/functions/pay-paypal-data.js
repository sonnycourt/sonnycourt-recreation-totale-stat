import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { cleanPayPalValue, getPayPalConfig } from './lib/pay-paypal.mjs';
import { getPayPalTransactions } from './lib/pay-paypal-data.mjs';
import { getPayPalResourcePage, PAYPAL_READ_RESOURCES } from './lib/pay-paypal-resources.mjs';

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
  const resource = cleanPayPalValue(url.searchParams.get('resource'), 40).toLowerCase();
  try {
    if (resource && resource !== 'transactions') {
      if (!PAYPAL_READ_RESOURCES.includes(resource)) return json(400, { error: 'paypal_resource_invalid' });
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || undefined);
      const data = await getPayPalResourcePage(resource, { page, pageSize });
      const mode = getPayPalConfig().mode;
      return json(200, { ...data, mode, writes_enabled: mode !== 'live' || process.env.PAYPAL_LIVE_WRITES_ENABLED === 'true' });
    }
    const data = await getPayPalTransactions({
      start: cleanPayPalValue(url.searchParams.get('start'), 40),
      end: cleanPayPalValue(url.searchParams.get('end'), 40),
    });
    const mode = getPayPalConfig().mode;
    return json(200, { ...data, mode, writes_enabled: mode !== 'live' || process.env.PAYPAL_LIVE_WRITES_ENABLED === 'true' });
  } catch (error) {
    console.error('pay-paypal-data:', cleanPayPalValue(error?.message, 120));
    const invalid = String(error?.message || '').startsWith('paypal_range_');
    return json(invalid ? 400 : 502, {
      connected: false,
      error: invalid ? cleanPayPalValue(error.message, 80) : resource ? `paypal_${resource}_unavailable` : 'paypal_transactions_unavailable',
    });
  }
};
