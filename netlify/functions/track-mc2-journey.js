import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';
import { mc2MetaRequestContext } from './lib/mc2-meta-events.mjs';
import { TRACKING_EVENTS, UUID_PATTERN, trackingMedia, OFFER_VERSION, sanitizeTrackingMeta } from '../../src/lib/mc2-tracking-contract.mjs';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export function validateJourneyEvent(event, now = Date.now()) {
  if (!event || !UUID_PATTERN.test(event.event_id || '') || !UUID_PATTERN.test(event.visit_id || '')
    || !/^[a-zA-Z0-9_-]{16,160}$/.test(event.token || '') || /^(preview|mc2-preview)/i.test(event.token)
    || !TRACKING_EVENTS.has(event.event_name) || !['/mc2/session/', '/mc2/replay/'].includes(event.route)) return null;
  const at = Date.parse(event.client_occurred_at);
  if (!Number.isFinite(at) || at > now + 60000 || at < now - 86400000) return null;
  const media = trackingMedia(event.route);
  const metadata = sanitizeTrackingMeta(event.metadata);
  if (event.event_name === 'playback_interval') {
    const { position_start: start, position_end: end, elapsed_seconds: elapsed } = metadata;
    const a = Date.parse(metadata.interval_started_at), b = Date.parse(metadata.interval_ended_at);
    if (!(start >= 0 && end > start && end <= media.duration + 5 && elapsed > 0 && elapsed <= 20
      && b > a && b - a <= 22000 && Math.abs(b - at) < 60000 && end - start <= elapsed * 2.6)) return null;
  }
  return { event_id: event.event_id, token: event.token, event_name: event.event_name,
    visit_id: event.visit_id, route: event.route, schema_version: 2,
    client_occurred_at: new Date(at).toISOString(), webinar_version: media.version,
    offer_version: OFFER_VERSION, metadata: { ...metadata, media_id: media.id, cta_second: media.cta, duration_seconds: media.duration } };
}

export default async (req, runtime) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json(403, { error: 'origin' });
  const context = String(runtime?.deploy?.context || process.env.CONTEXT || '');
  if (context && context !== 'production') return json(503, { error: 'non_production' });
  try {
    const raw = await req.text();
    if (raw.length > 48000) return json(413, { error: 'size' });
    const body = JSON.parse(raw);
    if (body.schema_version !== 2 || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 24) return json(400, { error: 'batch' });
    const accepted = [], rejected = [], rows = [];
    for (const event of body.events) {
      const row = validateJourneyEvent(event);
      if (row) rows.push(row); else if (typeof event?.event_id === 'string') rejected.push(event.event_id);
    }
    if (!rows.length) return json(200, { accepted, rejected });
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return json(503, { error: 'storage_unavailable' });
    const dbFetch = (path, options = {}) => fetch(`${url}/rest/v1/${path}`, {
      ...options, headers: supabaseHeaders(options.headers), signal: AbortSignal.timeout(6000),
    });
    // Lookup only; this endpoint NEVER patches registrations, schedules or payments.
    const tokens = [...new Set(rows.map(e => e.token))];
    const known = await dbFetch(`mc2_registrations?token=in.(${tokens.map(encodeURIComponent).join(',')})&select=token`);
    if (!known.ok) return json(503, { error: 'registration_lookup' });
    const knownTokens = new Set((await known.json()).map(r => r.token));
    const validRows = rows.filter(row => { if (knownTokens.has(row.token)) return true; rejected.push(row.event_id); return false; });
    if (!validRows.length) return json(200, { accepted, rejected });
    const context = mc2MetaRequestContext(req, '/mc2/session/');
    const saved = await dbFetch('rpc/mc2_tracking_ingest_v2', { method: 'POST',
      body: JSON.stringify({ items: validRows, request_context: { ip: context.ip, userAgent: context.userAgent } }) });
    if (!saved.ok) return json(503, { error: 'storage_unavailable' });
    // The RPC commits the observation and its optional Meta task together, without calling Meta.
    const result = await saved.json();
    if (!Array.isArray(result?.accepted)) return json(503, { error: 'storage_acknowledgement' });
    return json(200, { accepted: result.accepted, rejected });
  } catch { return json(503, { error: 'temporarily_unavailable' }); }
};
