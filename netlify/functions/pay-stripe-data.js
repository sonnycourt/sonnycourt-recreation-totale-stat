import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { cleanStripeValue, getPayStripePage, stripeResourceCatalog } from './lib/pay-stripe-data.mjs';

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
  const resource = cleanStripeValue(url.searchParams.get('resource'), 80);
  if (!resource) return json(200, { connected: true, resources: stripeResourceCatalog() });

  try {
    const page = await getPayStripePage(resource, {
      limit: Number(url.searchParams.get('limit') || 100),
      startingAfter: url.searchParams.get('starting_after'),
      createdGte: Number(url.searchParams.get('created_gte') || 0),
      createdLte: Number(url.searchParams.get('created_lte') || 0),
    });
    return json(200, {
      connected: true,
      resource,
      object: page.config.object,
      data: page.data,
      has_more: page.has_more,
      next_cursor: page.next_cursor,
      recent_only: Boolean(page.config.recentOnly),
    });
  } catch (error) {
    console.error('pay-stripe-data:', resource, error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    return json(status, { connected: false, error: cleanStripeValue(error?.message, 120) || 'stripe_unavailable', code: cleanStripeValue(error?.stripeCode, 100) || null });
  }
};
