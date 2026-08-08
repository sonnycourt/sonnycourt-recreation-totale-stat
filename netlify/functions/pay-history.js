import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getPayHistoryDashboard, getPayHistoryResource } from './lib/pay-history.mjs';

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
    const resource = String(url.searchParams.get('resource') || '').trim();
    if (resource) return json(200, await getPayHistoryResource(resource));
    const dashboard = await getPayHistoryDashboard({
      rangeStart: url.searchParams.get('range_start'),
      rangeEnd: url.searchParams.get('range_end'),
      timeZone: 'Europe/Zurich',
    });
    return json(200, dashboard);
  } catch (error) {
    const code = String(error?.code || error?.message || 'pay_history_unavailable');
    if (code === 'pay_history_not_initialized' || code === 'pay_history_not_configured') {
      return json(200, { ready: false, reason: code });
    }
    console.error('pay-history:', code);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    return json(status, { ready: false, error: code });
  }
};
