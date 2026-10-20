import { makePremiumBilling } from './lib/es2-premium-billing.mjs';
const service = makePremiumBilling();
export const config = { rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
export default async req => {
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée.' });
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return reply(403, { error: 'Origine non autorisée.' });
  try {
    const text = await req.text();
    if (text.length > 4096) return reply(413, { error: 'Formulaire trop long.' });
    const result = await service(JSON.parse(text));
    return reply(result.status, result.data);
  } catch {
    return reply(503, { error: 'La confirmation est temporairement indisponible. Réessaie sans effectuer de nouveau paiement.' });
  }
};
