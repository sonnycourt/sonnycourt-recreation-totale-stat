import { createHash } from 'node:crypto';

const PROVIDERS = new Set(['stripe', 'paypal']);
const ROUTING_KEYS = Object.freeze([
  'pay_checkout_id',
  'checkout_id',
  'offer_slug',
  'funnel',
  'pay_route',
  'payment_plan_id',
  'pay_origin',
  'source',
]);

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeIso(value) {
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeRoute(value) {
  const route = clean(value, 160).toLowerCase();
  return /^[a-z0-9][a-z0-9._:/-]*$/.test(route) ? route : '';
}

function identifier(value) {
  return clean(typeof value === 'string' ? value : value?.id, 255);
}

export function payRoutingMetadata(...sources) {
  const result = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of ROUTING_KEYS) {
      const value = clean(source[key], 255);
      if (value && !result[key]) result[key] = value;
    }
  }
  return result;
}

export function payEventTargets(metadata = {}) {
  const checkoutId = safeRoute(metadata.pay_checkout_id || metadata.checkout_id);
  const offerSlug = safeRoute(metadata.offer_slug);
  const funnel = safeRoute(metadata.funnel);
  const explicitRoute = safeRoute(metadata.pay_route);
  return [...new Set([
    'pay',
    explicitRoute,
    checkoutId ? `checkout:${checkoutId}` : '',
    offerSlug ? `offer:${offerSlug}` : '',
    funnel ? `funnel:${funnel}` : '',
  ].filter(Boolean))];
}

function stripeParts(event, options = {}) {
  const object = event?.data?.object || {};
  const metadata = payRoutingMetadata(
    object.metadata,
    object.subscription_details?.metadata,
    object.payment_intent_data?.metadata,
    options.metadata,
  );
  return {
    eventId: identifier(event?.id),
    eventType: clean(event?.type, 180),
    objectId: identifier(object),
    objectType: clean(object.object, 100),
    sourceCreatedAt: safeIso(event?.created) || safeIso(object.created),
    sourceUpdatedAt: safeIso(object.updated || object.created || event?.created),
    livemode: Boolean(event?.livemode ?? object.livemode),
    metadata,
  };
}

function paypalParts(event, options = {}) {
  const resource = event?.resource || {};
  const metadata = payRoutingMetadata(
    resource.metadata,
    resource.supplementary_data?.related_ids,
    options.metadata,
  );
  return {
    eventId: identifier(event?.id),
    eventType: clean(event?.event_type, 180),
    objectId: identifier(resource),
    objectType: clean(resource.resource_type || resource.type || resource.status_details?.reason, 100) || 'resource',
    sourceCreatedAt: safeIso(event?.create_time) || safeIso(resource.create_time),
    sourceUpdatedAt: safeIso(event?.update_time) || safeIso(resource.update_time) || safeIso(event?.create_time),
    livemode: options.livemode !== false,
    metadata,
  };
}

export function payWebhookEnvelope(provider, event, options = {}) {
  const normalizedProvider = clean(provider, 20).toLowerCase();
  if (!PROVIDERS.has(normalizedProvider)) throw new Error('pay_webhook_provider_invalid');
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('pay_webhook_event_invalid');
  const parts = normalizedProvider === 'stripe' ? stripeParts(event, options) : paypalParts(event, options);
  if (!parts.eventId || !parts.eventType) throw new Error('pay_webhook_identity_missing');
  const fingerprint = options.rawBody || JSON.stringify({
    provider: normalizedProvider,
    event_id: parts.eventId,
    event_type: parts.eventType,
    object_id: parts.objectId,
    source_updated_at: parts.sourceUpdatedAt,
  });
  return {
    provider: normalizedProvider,
    event_id: parts.eventId,
    event_type: parts.eventType,
    object_type: parts.objectType || null,
    object_id: parts.objectId || null,
    livemode: parts.livemode,
    source_created_at: parts.sourceCreatedAt,
    source_updated_at: parts.sourceUpdatedAt,
    payload_hash: createHash('sha256').update(String(fingerprint)).digest('hex'),
    status: 'received',
    attempts: 0,
    routing: {
      targets: payEventTargets(parts.metadata),
      metadata: parts.metadata,
    },
  };
}

export function payWebhookDedupeKey(envelope) {
  const provider = clean(envelope?.provider, 20).toLowerCase();
  const eventId = identifier(envelope?.event_id);
  if (!PROVIDERS.has(provider) || !eventId) throw new Error('pay_webhook_dedupe_invalid');
  return `${provider}:${eventId}`;
}

export function payIncomingVersionWins(existingValue, incomingValue) {
  const existing = new Date(String(existingValue || ''));
  const incoming = new Date(String(incomingValue || ''));
  if (!Number.isFinite(incoming.getTime())) return false;
  if (!Number.isFinite(existing.getTime())) return true;
  return incoming.getTime() >= existing.getTime();
}

export const PAY_WEBHOOK_CONFLICT_TARGET = 'provider,event_id';
