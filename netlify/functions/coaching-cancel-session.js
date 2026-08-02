import { googleAccessTokenForCoach } from './lib/coaching-google.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function publicKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const authorization = req.headers.get('authorization') || '';
  const key = publicKey();
  if (!authorization.startsWith('Bearer ') || !key || !process.env.SUPABASE_URL) return json(401, { error: 'Reconnecte-toi.' });
  const body = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(body.session_id || ''))) return json(400, { error: 'Séance invalide.' });
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/coaching_cancel_session`, {
    method: 'POST', headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_id: body.session_id, p_reason: String(body.reason || '').slice(0, 500) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return json(response.status, { error: 'Cette séance ne peut pas être déplacée.' });
  const found = await supabaseGet(`coaching_sessions?id=eq.${body.session_id}&select=google_event_id,coaching_coaches(id,google_calendar_id)&limit=1`);
  const booked = found.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (booked?.google_event_id && booked.coaching_coaches?.id) {
    try {
      const token = await googleAccessTokenForCoach(booked.coaching_coaches.id);
      if (token) await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(booked.coaching_coaches.google_calendar_id || 'primary')}/events/${encodeURIComponent(booked.google_event_id)}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch (error) { console.error('coaching cancellation calendar:', error); }
  }
  const row = Array.isArray(payload) ? payload[0] : payload;
  return json(200, { ok: true, ...row });
};
