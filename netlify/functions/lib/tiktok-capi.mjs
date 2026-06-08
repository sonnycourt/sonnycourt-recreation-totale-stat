import crypto from 'crypto';

/**
 * TikTok Events API (CAPI) — envoi server-side.
 * Doc : https://business-api.tiktok.com/portal/docs?id=1771101027431426
 *
 * Sécurité : ne fait jamais échouer l'appelant. En cas d'erreur ou de config
 * manquante, log + return { ok:false } sans throw.
 */

const TIKTOK_EVENT_ENDPOINT =
  'https://business-api.tiktok.com/open_api/v1.3/event/track/';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Email : trim + lowercase puis SHA-256. */
function hashEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return undefined;
  return sha256(normalized);
}

/** Téléphone : format E.164 (garde le +, retire espaces/séparateurs) puis SHA-256. */
function hashPhone(phone) {
  let normalized = String(phone || '').trim().replace(/[\s\-().]/g, '');
  if (!normalized) return undefined;
  if (!normalized.startsWith('+')) normalized = '+' + normalized;
  if (normalized.replace(/\D/g, '').length < 6) return undefined;
  return sha256(normalized);
}

/**
 * Envoie un event à TikTok.
 * @param {object} p
 * @param {string} p.eventName            - ex 'CompleteRegistration', 'CompletePayment'
 * @param {string} [p.eventId]            - id de déduplication (doit matcher le pixel navigateur)
 * @param {string} [p.email]
 * @param {string} [p.phone]
 * @param {string} [p.ip]
 * @param {string} [p.userAgent]
 * @param {string} [p.ttclid]
 * @param {string} [p.url]
 * @param {number} [p.eventTime]          - unix secondes (défaut: maintenant)
 * @param {number} [p.value]              - montant (pour CompletePayment)
 * @param {string} [p.currency]           - ex 'EUR'
 * @param {string} [p.contentName]
 */
export async function sendTikTokEvent(p = {}) {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const pixelId = process.env.TIKTOK_PIXEL_ID;

  if (!accessToken || !pixelId) {
    console.warn('TikTok CAPI: TIKTOK_ACCESS_TOKEN ou TIKTOK_PIXEL_ID manquant, event ignoré');
    return { ok: false, skipped: true };
  }
  if (!p.eventName) {
    return { ok: false, error: 'eventName manquant' };
  }

  const user = {};
  const hEmail = hashEmail(p.email);
  const hPhone = hashPhone(p.phone);
  if (hEmail) user.email = hEmail;
  if (hPhone) user.phone = hPhone;
  if (p.ip) user.ip = String(p.ip);
  if (p.userAgent) user.user_agent = String(p.userAgent);
  if (p.ttclid) user.ttclid = String(p.ttclid);

  const properties = {};
  if (typeof p.value === 'number' && !Number.isNaN(p.value)) {
    properties.value = p.value;
    properties.currency = p.currency || 'EUR';
  }
  if (p.contentName) {
    properties.content_name = p.contentName;
    properties.content_type = 'product';
  }

  const eventData = {
    event: p.eventName,
    event_time: p.eventTime || Math.floor(Date.now() / 1000),
    user,
  };
  if (p.eventId) eventData.event_id = String(p.eventId);
  if (p.url) eventData.page = { url: p.url };
  if (Object.keys(properties).length > 0) eventData.properties = properties;

  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [eventData],
  };

  try {
    const res = await fetch(TIKTOK_EVENT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    // TikTok renvoie code:0 en cas de succès.
    if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
      console.error('TikTok CAPI error:', res.status, JSON.stringify(json));
      return { ok: false, status: res.status, response: json };
    }
    return { ok: true, response: json };
  } catch (err) {
    console.error('TikTok CAPI fetch error:', err);
    return { ok: false, error: String(err) };
  }
}
