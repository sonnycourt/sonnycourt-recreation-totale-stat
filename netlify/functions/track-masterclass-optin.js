import { supabasePost } from './lib/supabase-rest.mjs';

const ALLOWED_EVENTS = new Set([
  'page_view',
  'popup_opened',
  'step_1_completed',
  'step_2_completed',
  'registration_completed',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY_RE = /^[A-Z]{2}$/;
const ALLOWED_PATHS = new Set([
  '/masterclass/',
  '/masterclass',
  '/meta/masterclass/',
  '/meta/masterclass',
  '/tt/masterclass/',
  '/tt/masterclass',
]);

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanText(value, maxLength) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function getGeoCountryCode(req, context) {
  const candidates = [
    context?.geo?.country?.code,
    req.headers.get('x-nf-country'),
    req.headers.get('x-country'),
  ];
  for (const raw of candidates) {
    const code = String(raw || '').trim().toUpperCase();
    if (COUNTRY_RE.test(code)) return code;
  }
  return null;
}

function isAllowedRequest(req) {
  const raw = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!raw) return true;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return (
      host === 'sonnycourt.com' ||
      host === 'www.sonnycourt.com' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.netlify.app')
    );
  } catch {
    return false;
  }
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (process.env.MASTERCLASS_OPTIN_TRACKING_ENABLED === 'false') {
    return json(202, { accepted: false, disabled: true });
  }

  if (!isAllowedRequest(req)) {
    return json(403, { error: 'Forbidden' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const funnelId = cleanText(body?.funnel_id, 36);
  const eventName = cleanText(body?.event_name, 40);
  if (!UUID_RE.test(funnelId || '') || !ALLOWED_EVENTS.has(eventName)) {
    return json(400, { error: 'Invalid event' });
  }

  const path = cleanText(body?.path, 120);
  if (!ALLOWED_PATHS.has(path)) {
    return json(400, { error: 'Invalid path' });
  }

  const sessionDateRaw = cleanText(body?.session_date, 40);
  const sessionDateMs = sessionDateRaw ? Date.parse(sessionDateRaw) : NaN;
  const sessionDate = Number.isFinite(sessionDateMs)
    ? new Date(sessionDateMs).toISOString()
    : null;

  const row = {
    funnel_id: funnelId,
    event_name: eventName,
    variant: cleanText(body?.variant, 40) || 'v2',
    path: path.endsWith('/') ? path : `${path}/`,
    traffic_source: cleanText(body?.traffic_source, 40),
    country_code: getGeoCountryCode(req, context),
    selected_country: cleanText(body?.selected_country, 80),
    session_date: sessionDate,
  };

  const result = await supabasePost(
    'masterclass_optin_events?on_conflict=funnel_id,event_name',
    row,
    { prefer: 'resolution=ignore-duplicates,return=minimal' },
  );

  if (!result.ok) {
    console.error('track-masterclass-optin insert:', result.status, result.error);
    return json(503, { accepted: false });
  }

  return json(202, { accepted: true });
};
