import { finalizeCoachingBooking } from './lib/coaching-integrations.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function publicKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const url = process.env.SUPABASE_URL;
  const key = publicKey();
  const authorization = req.headers.get('authorization') || '';
  if (!url || !key) return json(503, { error: 'La réservation doit encore être configurée.' });
  if (!authorization.startsWith('Bearer ')) return json(401, { error: 'Reconnecte-toi pour confirmer.' });

  const body = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(body.slot_id || ''))) return json(400, { error: 'Créneau invalide.' });
  const response = await fetch(`${url}/rest/v1/rpc/coaching_book_session`, {
    method: 'POST',
    headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slot_id: body.slot_id, p_timezone: String(body.timezone || 'Europe/Zurich').slice(0, 80) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = String(payload?.message || payload?.error || '');
    const conflict = detail.includes('slot_unavailable');
    const noCredit = detail.includes('no_credit');
    return json(conflict ? 409 : noCredit ? 402 : response.status, { error: conflict ? 'Ce créneau vient d’être pris. Choisis-en un autre.' : noCredit ? 'Tu n’as plus de crédit disponible.' : 'La réservation n’a pas pu être confirmée.' });
  }
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row?.session_id) return json(500, { error: 'Réservation incomplète.' });
  const integrations = await finalizeCoachingBooking(row.session_id).catch((error) => {
    console.error('coaching booking integrations:', error);
    return { status: 'deferred' };
  });
  return json(200, { ok: true, ...row, integrations });
};
