import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

export const WHATSAPP_URL = 'https://wa.me/33756980133?text=Bonjour%20Romain%2C%20je%20viens%20de%20m%27inscrire%20%C3%A0%20Esprit%20Subconscient%202.0%20%F0%9F%98%8A';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const tokenPattern = /^[a-zA-Z0-9_-]{20,100}$/;

function key() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configuration unavailable');
  return createHash('sha256').update('mc2-whatsapp-qr-v1\0' + process.env.SUPABASE_SERVICE_ROLE_KEY).digest();
}

export function seal(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  // Compact payload keeps the QR readable at its existing 180px display size.
  const expires = Buffer.alloc(4);
  expires.writeUInt32BE(Math.floor(Date.now() / 1000) + 30 * 86400);
  const data = Buffer.concat([cipher.update(Buffer.concat([expires, Buffer.from(token)])), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

function unseal(reference) {
  if (!reference || reference.length > 500 || !/^[\w-]+$/.test(reference)) throw new Error('Invalid reference');
  const data = Buffer.from(reference, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  const payload = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
  const token = payload.subarray(4).toString();
  if (!tokenPattern.test(token) || payload.readUInt32BE(0) * 1000 < Date.now()) throw new Error('Expired reference');
  return token;
}

async function database(path, body) {
  const base = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) throw new Error('Configuration unavailable');
  return fetch(`${base}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(1200),
  });
}

async function record(token, channel) {
  const event = `success_whatsapp_${channel}`;
  const response = await database('mc2_funnel_events', {
    token, event_name: event, page_path: '/masterclass/success/',
    dedupe_key: `${event}_v1`,
    metadata: { channel: channel === 'button_clicked' ? 'button' : 'qr', measurement: 'first_open_per_registration', message_sent_confirmed: false },
  });
  if (!response.ok && response.status !== 409) throw new Error('Tracking unavailable');
}

export default async function handler(req) {
  const url = new URL(req.url);
  if (req.method === 'GET' || req.method === 'HEAD') {
    // An opened QR link is not proof that a WhatsApp message was sent.
    const preview = /prefetch|preview/i.test(`${req.headers.get('purpose') || ''} ${req.headers.get('sec-purpose') || ''}`)
      || /bot|crawler|spider|facebookexternalhit/i.test(req.headers.get('user-agent') || '');
    if (req.method === 'GET' && !preview) {
      try { await record(unseal(url.searchParams.get('r')), 'qr_opened'); } catch { /* Always let the visitor continue. */ }
    }
    return new Response(null, { status: 302, headers: { ...headers, Location: WHATSAPP_URL } });
  }
  if (req.method !== 'POST') return json(405, { ok: false });
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) return json(403, { ok: false });
  try {
    const raw = await req.text();
    if (raw.length > 1024) return json(413, { ok: false });
    const { token, action } = JSON.parse(raw);
    if (!tokenPattern.test(token || '') || !['prepare', 'button_clicked'].includes(action)) return json(400, { ok: false });
    const response = await database(`mc2_registrations?token=eq.${encodeURIComponent(token)}&select=statut&limit=1`);
    if (!response.ok) return json(503, { ok: false });
    const rows = await response.json();
    if (rows[0]?.statut !== 'purchased') return json(404, { ok: false });
    if (action === 'button_clicked') {
      await record(token, 'button_clicked');
      return json(200, { ok: true });
    }
    const link = `${url.origin}/.netlify/functions/mc2-whatsapp?r=${seal(token)}`;
    const svg = await QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 220 });
    return json(200, { ok: true, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
  } catch { return json(503, { ok: false }); }
}
