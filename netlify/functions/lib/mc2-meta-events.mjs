import { sendMetaEvent } from './meta-capi.mjs';
import { getSupabaseConfig, supabaseHeaders } from './supabase-rest.mjs';
import { MC2_LIVE_VIDEO_DURATION_SECONDS } from '../../../src/lib/mc2-timing.mjs';

const META_SOURCE = 'meta_ad';
const DEFAULT_VIDEO_DURATION_SECONDS = MC2_LIVE_VIDEO_DURATION_SECONDS;
const VIDEO_MILESTONES = [25, 50, 75];

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function registrationToken(registration) {
  return clean(registration?.token, 128);
}

export function isMc2MetaRegistration(registration) {
  return clean(registration?.traffic_source, 40).toLowerCase() === META_SOURCE;
}

export function mc2MetaEventId(stage, token) {
  const safeStage = clean(stage, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const safeToken = registrationToken({ token }).replace(/[^a-zA-Z0-9_-]+/g, '');
  return safeStage && safeToken ? `mc2-${safeStage}-${safeToken}` : null;
}

export function mc2RegistrationMetaEvents(registration, { created = false, completedNow = false } = {}) {
  if (!isMc2MetaRegistration(registration)) return [];
  const token = registrationToken(registration);
  if (!token) return [];
  const events = [];
  if (created) {
    events.push({
      eventName: 'EmailCaptured',
      eventId: mc2MetaEventId('email', token),
      contentName: 'Masterclass ES2 - Email',
    });
  }
  if (completedNow) {
    events.push({
      eventName: 'Lead',
      eventId: clean(registration.meta_event_id, 255) || mc2MetaEventId('lead', token),
      contentName: 'Masterclass ES2',
    });
  }
  return events;
}

function progressPercent(value, meta = {}) {
  const explicit = positiveNumber(meta.percent);
  if (explicit) return Math.min(100, explicit);
  const minutes = positiveNumber(value);
  const durationSeconds = positiveNumber(meta.duration_seconds) || DEFAULT_VIDEO_DURATION_SECONDS;
  return Math.min(100, (minutes * 60 * 100) / durationSeconds);
}

function previousProgressPercent(row, meta = {}) {
  // Le replay fournit sa propre position précédente : la colonne live ne doit
  // pas servir de référence, sinon chaque ping renvoie les mêmes paliers.
  const explicitPrevious = meta.previous_minutes != null ? Number(meta.previous_minutes) : NaN;
  const minutes = Number.isFinite(explicitPrevious) && explicitPrevious >= 0
    ? explicitPrevious
    : positiveNumber(row?.watch_max_minutes);
  const durationSeconds = positiveNumber(meta.duration_seconds) || DEFAULT_VIDEO_DURATION_SECONDS;
  return Math.min(100, (minutes * 60 * 100) / durationSeconds);
}

export function mc2FunnelMetaEvents({ eventName, value, meta = {}, registration } = {}) {
  const token = registrationToken(registration);
  if (!token) return [];

  // V2 has durable, observed events. Keep legacy business state but do not
  // send its wall-clock CTA or position-based "watched" milestones to Meta.
  if (Number(meta.tracking_schema) === 2 && ['cta_reached', 'video_checkpoint'].includes(eventName)) return [];

  // L'audience de retargeting doit inclure toute personne réellement exposée
  // à l'offre, quelle que soit sa source d'acquisition. Tous les autres
  // événements Meta restent réservés au trafic Meta.
  if (eventName === 'cta_reached' && !registration.saw_offer) {
    return [{
      eventName: 'OfferViewed',
      // L'ID dédié est créé aléatoirement par la session navigateur puis partagé
      // avec la CAPI. Le fallback conserve le tracking CAPI historique.
      eventId: clean(meta.offer_event_id, 255) || mc2MetaEventId('offer', token),
      contentName: 'Masterclass ES2 - Offre',
    }];
  }

  if (!isMc2MetaRegistration(registration)) return [];

  if (eventName === 'session_joined' && !registration.attended_live) {
    return [{
      eventName: 'QualifiedLead',
      eventId: mc2MetaEventId('qualified', token),
      contentName: 'Masterclass ES2 - Présent',
    }];
  }

  if (eventName === 'video_checkpoint') {
    const before = previousProgressPercent(registration, meta);
    const after = progressPercent(value, meta);
    return VIDEO_MILESTONES
      .filter((milestone) => before < milestone && after >= milestone)
      .map((milestone) => ({
        eventName: `QualifiedView${milestone}`,
        eventId: mc2MetaEventId(`view-${milestone}`, token),
        contentName: `Masterclass ES2 - ${milestone}%`,
      }));
  }

  if (['cta_clicked', 'checkout_clicked'].includes(eventName) && !registration.clicked_cta) {
    return [{
      eventName: 'CTA_Clicked',
      eventId: mc2MetaEventId('cta', token),
      contentName: 'Masterclass ES2 - CTA',
    }];
  }

  if (eventName === 'checkout_viewed' && Number(registration.checkout_view_count || 0) === 0) {
    return [{
      eventName: 'InitiateCheckout',
      eventId: mc2MetaEventId('checkout', token),
      contentName: 'Esprit Subconscient 2.0',
    }];
  }

  return [];
}

export function mc2MetaRequestContext(req, pagePath) {
  const headers = req?.headers;
  const forwarded = clean(headers?.get?.('x-forwarded-for'), 500).split(',')[0].trim();
  const ip = clean(headers?.get?.('x-nf-client-connection-ip'), 80) || forwarded || null;
  const userAgent = clean(headers?.get?.('user-agent'), 1000) || null;
  const referer = clean(headers?.get?.('referer'), 1000);
  let url = referer || null;
  try {
    const base = new URL(referer || req?.url || 'https://sonnycourt.com/');
    url = pagePath ? new URL(pagePath, base.origin).toString() : base.toString();
  } catch {
    url = pagePath ? `https://sonnycourt.com${String(pagePath).startsWith('/') ? '' : '/'}${pagePath}` : null;
  }
  return { ip, userAgent, url };
}

const FALLBACK_RETRY_DELAY_MS = 60_000;

function safeSiteUrl(value) {
  const text = clean(value, 500);
  return /^https:\/\/sonnycourt\.com\//.test(text) ? text : null;
}

/**
 * Dernier contexte navigateur connu pour une inscription (IP, user agent),
 * tel que mémorisé par la file de livraison v2. Sert aux événements qui
 * n'ont pas de requête navigateur (webhooks de paiement).
 */
export async function mc2LastKnownBrowserContext(token) {
  const safeToken = registrationToken({ token });
  const { url, key } = getSupabaseConfig();
  if (!safeToken || !url || !key) return {};
  try {
    const response = await fetch(
      `${url}/rest/v1/mc2_tracking_meta_outbox?token=eq.${encodeURIComponent(safeToken)}&or=(context->>source.is.null,context->>source.neq.payment_webhook)&select=context&order=event_time.desc&limit=20`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(4000) },
    );
    if (!response.ok) return {};
    const rows = await response.json();
    const context = rows?.map(row => row.context).find(item => item && (item.ip || item.userAgent)
      && item.source !== 'payment_webhook');
    if (!context || typeof context !== 'object') return {};
    return {
      ip: clean(context.ip, 80) || null,
      userAgent: clean(context.userAgent, 1000) || null,
    };
  } catch {
    return {};
  }
}

/**
 * Un envoi immédiat raté ne doit jamais perdre l'événement : on le confie à
 * la file de livraison v2 (réessais jusqu'à 6 jours, même event_id, donc
 * dédoublonné par Meta si l'envoi initial avait en fait abouti).
 */
export async function queueMc2MetaFallback({ registration, event, context = {}, value, currency, eventTime, claim = false } = {}) {
  const token = registrationToken(registration);
  const eventName = clean(event?.eventName, 64);
  const eventId = clean(event?.eventId, 255);
  const { url, key } = getSupabaseConfig();
  if (!token || !eventName || !eventId || !url || !key) return { ok: false, skipped: true };
  const occurredAt = Number.isFinite(Number(eventTime)) && Number(eventTime) > 0
    ? new Date(Number(eventTime) * 1000)
    : new Date();
  const row = {
    delivery_key: `immediate:${token}:${eventName}:${eventId}`,
    token,
    event_name: eventName,
    event_id: eventId,
    event_time: occurredAt.toISOString(),
    context: {
      source: context.source || 'immediate_fallback',
      ...(context.ip ? { ip: clean(context.ip, 80) } : {}),
      ...(context.userAgent ? { userAgent: clean(context.userAgent, 1000) } : {}),
      ...(safeSiteUrl(context.url) ? { url: safeSiteUrl(context.url) } : {}),
      ...(event?.contentName ? { contentName: clean(event.contentName, 120) } : {}),
      ...(typeof value === 'number' && Number.isFinite(value) ? { value, currency: clean(currency, 3) || 'EUR' } : {}),
    },
    status: claim ? 'processing' : 'pending',
    ...(claim ? { attempts: 1, last_attempt_at: new Date().toISOString() } : {}),
    next_attempt_at: new Date(Date.now() + FALLBACK_RETRY_DELAY_MS).toISOString(),
  };
  try {
    const response = await fetch(`${url}/rest/v1/mc2_tracking_meta_outbox?on_conflict=delivery_key`, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      console.error('MC2 Meta fallback queue failed:', response.status, eventName);
      return { ok: false, status: response.status };
    }
    const inserted = await response.json().catch(() => []);
    return { ok: true, inserted: inserted.length > 0, deliveryKey: row.delivery_key };
  } catch (error) {
    console.error('MC2 Meta fallback queue error:', error?.message || error);
    return { ok: false, error: String(error?.message || error) };
  }
}

function metaDeliveryConfirmed(result) {
  return Boolean(result?.ok) && Number(result?.response?.events_received) > 0;
}

export async function sendMc2MetaEvents({
  events,
  registration,
  req,
  pagePath,
  context: contextOverride,
  value,
  currency,
  eventTime,
  fallback = true,
  durable = false,
} = {}) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const eligibleEvents = events.filter((event) => (
    event?.eventName === 'OfferViewed' || isMc2MetaRegistration(registration)
  ));
  if (eligibleEvents.length === 0) return [];
  const requestContext = mc2MetaRequestContext(req, pagePath);
  const context = {
    ...(contextOverride?.source ? { source: contextOverride.source } : {}),
    ip: contextOverride?.ip || requestContext.ip,
    userAgent: contextOverride?.userAgent || requestContext.userAgent,
    url: contextOverride?.url || requestContext.url,
  };
  // Freeze BEFORE the initial request: a retry is the original event, not a new one.
  const occurredAt = Number.isFinite(Number(eventTime)) && Number(eventTime) > 0
    ? Math.floor(Number(eventTime)) : Math.floor(Date.now() / 1000);
  const deployContext = String(process.env.CONTEXT || '').trim().toLowerCase();
  const canDeliver = (!deployContext || deployContext === 'production' || process.env.META_CAPI_ALLOW_NON_PRODUCTION === 'true')
    && process.env.META_PIXEL_ID && process.env.META_ACCESS_TOKEN;
  return Promise.all(eligibleEvents.map(async (event) => {
    // Payment notifications keep a durable receipt even on success. An insert
    // claim prevents duplicate webhooks from resending after Meta's dedup window.
    const receipt = durable && canDeliver
      ? await queueMc2MetaFallback({ registration, event, context, value, currency, eventTime: occurredAt, claim: true }) : null;
    if (receipt?.ok && !receipt.inserted) return { ok: true, duplicate: true, queued: true };
    const result = await sendMetaEvent({
      eventName: event.eventName,
      eventId: event.eventId,
      email: registration.email,
      phone: registration.telephone,
      externalId: registration.token,
      ip: context.ip,
      userAgent: context.userAgent,
      fbc: registration.meta_fbc,
      fbp: registration.meta_fbp,
      url: context.url,
      eventTime: occurredAt,
      value,
      currency,
      contentName: event.contentName,
      optinVariant: registration.optin_variant,
    });
    if (receipt?.ok && receipt.inserted) {
      try {
        const { url } = getSupabaseConfig();
        const confirmed = metaDeliveryConfirmed(result);
        const response = await fetch(`${url}/rest/v1/mc2_tracking_meta_outbox?delivery_key=eq.${encodeURIComponent(receipt.deliveryKey)}&status=eq.processing&attempts=eq.1`, {
          method: 'PATCH', headers: supabaseHeaders(), signal: AbortSignal.timeout(4000),
          body: JSON.stringify(confirmed
            ? { status: 'sent', sent_at: new Date().toISOString(), last_error: null }
            : { status: 'retry', next_attempt_at: new Date(Date.now() + FALLBACK_RETRY_DELAY_MS).toISOString(), last_error: 'meta_not_acknowledged' }),
        });
        if (!response.ok) console.error('MC2 Meta receipt update failed:', response.status);
      } catch { /* The worker recovers the lease with the same ID and time. */ }
      return { ...result, fallbackQueued: !metaDeliveryConfirmed(result) };
    }
    // Config absente ou hors production : rien à rattraper. Sinon, un refus ou
    // un délai dépassé part dans la file durable, avec le même event_id.
    if (fallback && !result?.skipped && !metaDeliveryConfirmed(result)) {
      const queued = await queueMc2MetaFallback({ registration, event, context, value, currency, eventTime: occurredAt });
      return { ...result, fallbackQueued: Boolean(queued?.ok) };
    }
    return result;
  }));
}
