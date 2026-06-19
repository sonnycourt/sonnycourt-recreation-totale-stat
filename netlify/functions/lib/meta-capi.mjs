import crypto from 'crypto';

/**
 * Meta Conversions API (CAPI) — envoi server-side.
 * Doc : https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * Calqué sur lib/tiktok-capi.mjs. Mêmes garanties :
 * ne fait jamais échouer l'appelant. En cas d'erreur ou de config manquante,
 * log + return { ok:false } sans throw.
 *
 * Mapping des events (équivalents TikTok) :
 *   CompleteRegistration -> Lead
 *   CompletePayment      -> Purchase
 *   AttendedLive         -> AttendedLive (custom)
 *   QualifiedView        -> QualifiedView (custom)
 */

const META_API_VERSION = 'v21.0';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Email : trim + lowercase puis SHA-256. */
function hashEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return undefined;
  return sha256(normalized);
}

/** Téléphone : E.164 sans le + ni séparateurs (Meta veut les chiffres seuls) puis SHA-256. */
function hashPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 6) return undefined;
  return sha256(digits);
}

/**
 * Envoie un event à Meta.
 * @param {object} p
 * @param {string} p.eventName            - ex 'Lead', 'Purchase', 'AttendedLive'
 * @param {string} [p.eventId]            - id de déduplication (doit matcher le pixel navigateur)
 * @param {string} [p.email]
 * @param {string} [p.phone]
 * @param {string} [p.ip]
 * @param {string} [p.userAgent]
 * @param {string} [p.fbc]               - cookie _fbc (ou reconstruit depuis fbclid)
 * @param {string} [p.fbp]               - cookie _fbp
 * @param {string} [p.url]               - event_source_url
 * @param {number} [p.eventTime]         - unix secondes (défaut: maintenant)
 * @param {number} [p.value]             - montant (pour Purchase)
 * @param {string} [p.currency]          - ex 'EUR'
 * @param {string} [p.contentName]
 */
export async function sendMetaEvent(p = {}) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const pixelId = process.env.META_PIXEL_ID;

  if (!accessToken || !pixelId) {
    console.warn('Meta CAPI: META_ACCESS_TOKEN ou META_PIXEL_ID manquant, event ignoré');
    return { ok: false, skipped: true };
  }
  if (!p.eventName) {
    return { ok: false, error: 'eventName manquant' };
  }

  const userData = {};
  const hEmail = hashEmail(p.email);
  const hPhone = hashPhone(p.phone);
  if (hEmail) userData.em = [hEmail];
  if (hPhone) userData.ph = [hPhone];
  if (p.ip) userData.client_ip_address = String(p.ip);
  if (p.userAgent) userData.client_user_agent = String(p.userAgent);
  if (p.fbc) userData.fbc = String(p.fbc);
  if (p.fbp) userData.fbp = String(p.fbp);

  const customData = {};
  if (typeof p.value === 'number' && !Number.isNaN(p.value)) {
    customData.value = p.value;
    customData.currency = p.currency || 'EUR';
  }
  if (p.contentName) {
    customData.content_name = p.contentName;
  }

  const eventData = {
    event_name: p.eventName,
    event_time: p.eventTime || Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: userData,
  };
  if (p.eventId) eventData.event_id = String(p.eventId);
  if (p.url) eventData.event_source_url = String(p.url);
  if (Object.keys(customData).length > 0) eventData.custom_data = customData;

  const payload = {
    data: [eventData],
    access_token: accessToken,
  };

  const endpoint = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    // Meta renvoie { events_received: N } en cas de succès, { error: {...} } sinon.
    if (!res.ok || (json && json.error)) {
      console.error('Meta CAPI error:', res.status, JSON.stringify(json));
      return { ok: false, status: res.status, response: json };
    }
    return { ok: true, response: json };
  } catch (err) {
    console.error('Meta CAPI fetch error:', err);
    return { ok: false, error: String(err) };
  }
}
