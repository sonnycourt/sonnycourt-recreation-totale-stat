import { sendMetaEvent } from './meta-capi.mjs';
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
  const minutes = positiveNumber(row?.watch_max_minutes);
  const durationSeconds = positiveNumber(meta.duration_seconds) || DEFAULT_VIDEO_DURATION_SECONDS;
  return Math.min(100, (minutes * 60 * 100) / durationSeconds);
}

export function mc2FunnelMetaEvents({ eventName, value, meta = {}, registration } = {}) {
  if (!isMc2MetaRegistration(registration)) return [];
  const token = registrationToken(registration);
  if (!token) return [];

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

  if (eventName === 'cta_reached' && !registration.saw_offer) {
    return [{
      eventName: 'OfferViewed',
      // L'ID dédié est créé aléatoirement par la session navigateur puis partagé
      // avec la CAPI. Le fallback conserve le tracking CAPI historique.
      eventId: clean(meta.offer_event_id, 255) || mc2MetaEventId('offer', token),
      contentName: 'Masterclass ES2 - Offre',
    }];
  }

  if (eventName === 'cta_clicked' && !registration.clicked_cta) {
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

export async function sendMc2MetaEvents({
  events,
  registration,
  req,
  pagePath,
  value,
  currency,
  eventTime,
} = {}) {
  if (!isMc2MetaRegistration(registration) || !Array.isArray(events) || events.length === 0) return [];
  const context = mc2MetaRequestContext(req, pagePath);
  return Promise.all(events.map((event) => sendMetaEvent({
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
    eventTime,
    value,
    currency,
    contentName: event.contentName,
    optinVariant: registration.optin_variant,
  })));
}
