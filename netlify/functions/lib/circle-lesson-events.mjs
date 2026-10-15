import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 65536;
const EVENT = 'courses_lesson_completed';
const id = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function authenticated(candidate, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof candidate !== 'string' || candidate.length > 256) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export function parseCircleEvent(payload, { communityId, spaceIds, now = new Date() }) {
  // Observed in Circle's webhook tester: {body:{type,data}}.
  // Also accept the unwrapped body, which transports may send directly.
  const event = payload?.body && typeof payload.body === 'object' ? payload.body : payload;
  if (!event || event.type !== EVENT) return { ignored: 'event_type' };
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_data');
  const community = id(data.community_id);
  const member = id(data.community_member_id);
  const space = id(data.space_id);
  if (!community || !member || !space) throw new Error('missing_identity');
  if (community !== id(communityId) || !spaceIds.includes(space)) return { ignored: 'outside_scope' };
  // Real Circle event verified 2026-10-15: data.lesson_id is present,
  // along with courses_section_id, community_id, member_id and space_id.
  // No source timestamp or event ID in that event: received_at remains distinct.
  // Missing lesson identity is quarantined, never guessed from the course.
  const lesson = id(data.course_lesson_id ?? data.lesson_id);
  const providerAt = timestamp(event.occurred_at ?? data.completed_at);
  if (providerAt && Date.parse(providerAt) > now.getTime() + 300000) throw new Error('future_timestamp');
  const eventId = typeof event.id === 'string' || Number.isSafeInteger(event.id) ? String(event.id).slice(0, 200) : null;
  const serialized = JSON.stringify(event);
  return { row: {
    community_id: community, community_member_id: member, space_id: space,
    lesson_id: lesson, event_type: EVENT,
    provider_occurred_at: providerAt, provider_event_id: eventId,
    payload_sha256: createHash('sha256').update(serialized).digest('hex'),
    payload: event,
    resolution_status: lesson ? 'identified' : 'needs_lesson_id',
  } };
}

export function allowedSpaces(value = '') {
  const values = value.split(',').map(x => x.trim()).filter(Boolean);
  if (!values.length || values.some(x => !id(x))) return [];
  return [...new Set(values.map(Number))];
}
