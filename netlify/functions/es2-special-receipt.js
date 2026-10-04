import { makeReceiptService } from './lib/es2-special-receipt.mjs';
const service = makeReceiptService();
export default async req => {
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json(403, { error: 'Origine non autorisée.' });
  try {
    const body = await req.json();
    const result = await service(body || {});
    return json(result.status, result.data);
  } catch {
    return json(503, { error: 'Confirmation temporairement indisponible. Réessaie dans un instant.' });
  }
};
