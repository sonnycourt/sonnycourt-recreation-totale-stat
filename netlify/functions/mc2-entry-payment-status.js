import { entryRegistrationByToken, confirmMc2EntryPayment } from './lib/mc2-entry-payment.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});
export default async req => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return json(403, { error: 'origin_not_allowed' });
    const { token, orderId } = await req.json();
    const row = await entryRegistrationByToken(token);
    if (!row) return json(404, { error: 'invalid_token' });
    const result = await confirmMc2EntryPayment(req, row, { orderId: String(orderId || '') });
    return json(200, { ...result, redirectTo: result.paid || result.historical ? `/mc2/confirmation?t=${encodeURIComponent(token)}` : undefined });
  } catch (error) {
    console.error('MC2 entry payment verification failed:', error?.message);
    return json(503, { error: 'verification_temporarily_unavailable' });
  }
};
