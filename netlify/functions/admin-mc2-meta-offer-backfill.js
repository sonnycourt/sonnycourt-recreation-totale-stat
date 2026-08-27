import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { mc2MetaEventId, sendMc2MetaEvents } from './lib/mc2-meta-events.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';

const WINDOW_START = '2026-08-27T18:00:00.000Z';
const WINDOW_END = '2026-08-27T19:56:00.000Z';
const MAX_EXPECTED = 5;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function purchased(row = {}) {
  const status = String(row.statut || '').trim().toLowerCase();
  const paymentStatus = String(row.payment_status || '').trim().toLowerCase();
  return status === 'purchased'
    || Boolean(row.purchased_at)
    || ['paid', 'succeeded', 'active', 'complete', 'completed'].includes(paymentStatus);
}

function pagePath(value) {
  return value === '/mc2/replay/' ? '/mc2/replay/' : '/mc2/session/';
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Unauthorized' });

  const body = await req.json().catch(() => ({}));
  const apply = body?.apply === true;
  const eventsResult = await supabaseGet(
    'mc2_funnel_events'
      + '?event_name=eq.cta_reached'
      + `&occurred_at=gte.${encodeURIComponent(WINDOW_START)}`
      + `&occurred_at=lte.${encodeURIComponent(WINDOW_END)}`
      + '&select=token,page_path,metadata,occurred_at'
      + '&order=occurred_at.asc&limit=50',
  );
  if (!eventsResult.ok || !Array.isArray(eventsResult.data)) {
    return json(500, { error: 'Lecture événements impossible' });
  }

  const firstEventByToken = new Map();
  for (const event of eventsResult.data) {
    if (event?.token && !firstEventByToken.has(event.token)) firstEventByToken.set(event.token, event);
  }

  const candidates = [];
  for (const [token, event] of firstEventByToken) {
    const registrationResult = await supabaseGet(
      `mc2_registrations?token=eq.${encodeURIComponent(token)}`
        + '&select=token,email,telephone,traffic_source,meta_fbc,meta_fbp,optin_variant,saw_offer,statut,payment_status,purchased_at&limit=1',
    );
    const registration = registrationResult.ok && Array.isArray(registrationResult.data)
      ? registrationResult.data[0]
      : null;
    if (!registration || registration.saw_offer !== true || purchased(registration)) continue;
    candidates.push({ registration, event });
  }

  if (candidates.length < 1 || candidates.length > MAX_EXPECTED) {
    return json(409, {
      error: 'Fenêtre de rattrapage inattendue, aucun envoi',
      candidates: candidates.length,
    });
  }

  const pages = candidates.reduce((counts, item) => {
    const path = pagePath(item.event.page_path);
    counts[path] = (counts[path] || 0) + 1;
    return counts;
  }, {});
  if (!apply) return json(200, { ok: true, dry_run: true, candidates: candidates.length, pages });

  let sent = 0;
  for (const { registration, event } of candidates) {
    const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
    const eventId = String(metadata.offer_event_id || '').trim()
      || mc2MetaEventId('offer', registration.token);
    const result = await sendMc2MetaEvents({
      events: [{
        eventName: 'OfferViewed',
        eventId,
        contentName: 'Masterclass ES2 - Offre',
      }],
      registration,
      pagePath: pagePath(event.page_path),
      eventTime: Math.floor(new Date(event.occurred_at).getTime() / 1000),
    });
    const response = result[0];
    if (!response?.ok || Number(response?.response?.events_received || 0) < 1) {
      return json(502, { error: 'Meta a refusé un événement', sent, candidates: candidates.length });
    }
    sent += 1;
  }

  return json(200, { ok: true, dry_run: false, candidates: candidates.length, sent, pages });
};
