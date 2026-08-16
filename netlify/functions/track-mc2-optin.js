import { supabasePost } from './lib/supabase-rest.mjs';

const ALLOWED_EVENTS = new Set([
  'page_view',
  'cta_clicked',
  'popup_opened',
  'step_1_completed',
  'step_2_completed',
  'commitment_checked',
  'registration_submitted',
  'registration_completed',
]);
const ALLOWED_PATHS = new Set([
  '/mc2/',
  '/meta/mc2/',
  '/tt/mc2/',
  '/masterclass/',
  '/meta/masterclass/',
  '/tt/masterclass/',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function countryCode(req, context) {
  const candidates = [context?.geo?.country?.code, req.headers.get('x-nf-country')];
  for (const value of candidates) {
    const code = String(value || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return null;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const funnelId = clean(body?.funnel_id, 36);
    const eventName = clean(body?.event_name, 40);
    const path = clean(body?.path, 120);
    if (!UUID_RE.test(funnelId || '') || !ALLOWED_EVENTS.has(eventName) || !ALLOWED_PATHS.has(path)) {
      return json(400, { error: 'Invalid event' });
    }

    const sessionMs = Date.parse(String(body?.session_date || ''));
    const row = {
      funnel_id: funnelId,
      event_name: eventName,
      variant: clean(body?.variant, 80) || 'mc2',
      path,
      traffic_source: clean(body?.traffic_source, 40),
      country_code: countryCode(req, context),
      selected_country: clean(body?.selected_country, 80),
      session_date: Number.isFinite(sessionMs) ? new Date(sessionMs).toISOString() : null,
    };
    const result = await supabasePost(
      'mc2_optin_events?on_conflict=funnel_id,event_name',
      row,
      { prefer: 'resolution=ignore-duplicates,return=minimal' },
    );
    if (!result.ok) return json(503, { accepted: false });
    return json(202, { accepted: true });
  } catch (error) {
    console.error('track-mc2-optin error:', error);
    return json(500, { accepted: false });
  }
};
