import { authenticated, allowedSpaces, MAX_BODY_BYTES, parseCircleEvent } from './lib/circle-lesson-events.mjs';

const reply = (statusCode, body) => ({ statusCode, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
}, body: JSON.stringify(body) });

export function createHandler({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
    const secret = env.CIRCLE_LESSON_WEBHOOK_SECRET;
    if (!secret || secret.length < 32) return reply(503, { error: 'not_configured' });
    // Circle's editor exposes only an endpoint URL. Use a dedicated random
    // capability, never a Circle/Supabase credential, and never log the URL.
    if (!authenticated(event.queryStringParameters?.key, secret)) return reply(401, { error: 'unauthorized' });
    const input = typeof event.body === 'string' ? event.body : '';
    if (input.length > MAX_BODY_BYTES * 2) return reply(413, { error: 'body_too_large' });
    let raw, payload;
    try {
      raw = event.isBase64Encoded ? Buffer.from(input, 'base64').toString('utf8') : input;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return reply(413, { error: 'body_too_large' });
      payload = JSON.parse(raw);
    } catch { return reply(400, { error: 'invalid_json' }); }
    const spaces = allowedSpaces(env.CIRCLE_LESSON_ALLOWED_SPACE_IDS);
    if (!spaces.length || !env.CIRCLE_LESSON_COMMUNITY_ID) return reply(503, { error: 'scope_not_configured' });
    let parsed;
    try { parsed = parseCircleEvent(payload, { communityId: env.CIRCLE_LESSON_COMMUNITY_ID, spaceIds: spaces, now: now() }); }
    catch { return reply(422, { error: 'invalid_circle_event' }); }
    if (parsed.ignored) return reply(200, { ignored: parsed.ignored });
    if (event.queryStringParameters?.probe === '1') {
      // Explicit diagnostic endpoint: no database write, no personal data echoed.
      return reply(200, { probe: true, identified: parsed.row.lesson_id !== null,
        provider_timestamp: parsed.row.provider_occurred_at !== null,
        event_id: parsed.row.provider_event_id !== null,
        data_fields: Object.keys(parsed.row.payload.data).sort() });
    }
    if (env.CIRCLE_LESSON_TRACKING_ENABLED !== 'true') return reply(503, { error: 'tracking_not_enabled' });
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(503, { error: 'storage_not_configured' });
    try {
      const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/circle_lesson_events`, {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'return=minimal' },
        body: JSON.stringify(parsed.row),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        // Do not treat other constraints/storage errors as duplicate success.
        if (response.status === 409 && failure.code === '23505' && parsed.row.provider_event_id &&
            String(failure.message).includes('circle_lesson_provider_event_unique')) return reply(200, { duplicate: true });
        console.error('circle_lesson_storage_failed', response.status);
        return reply(503, { error: 'storage_failed' });
      }
      if (!parsed.row.lesson_id) console.warn('circle_lesson_identity_missing');
      return reply(200, { stored: true, identified: parsed.row.lesson_id !== null });
    } catch {
      console.error('circle_lesson_storage_unavailable');
      return reply(503, { error: 'storage_unavailable' });
    }
  };
}

export const handler = createHandler();
