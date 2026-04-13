import crypto from 'node:crypto';

const COOKIE_NAME = 'admin_es2_session';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = 4 - (str.length % 4);
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(s, 'base64');
}

/**
 * @param {string} secret
 * @param {number} ttlMs
 */
export function signSessionToken(secret, ttlMs) {
  const exp = Date.now() + ttlMs;
  const payload = JSON.stringify({ exp, v: 1 });
  const payloadB64 = b64url(Buffer.from(payload, 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

/**
 * @param {string} token
 * @param {string} secret
 * @returns {{ exp: number } | null}
 */
export function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig || sig.length !== 64) return null;
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  return data;
}

export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(val);
  }
  return out;
}

export function getSessionCookieValue(cookieHeader) {
  const c = parseCookies(cookieHeader || '');
  return c[COOKIE_NAME] || '';
}

/**
 * @param {{ value: string, maxAgeSec: number, secure: boolean }} opts
 */
export function buildSessionSetCookie(opts) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(opts.value)}`,
    'Path=/',
    `Max-Age=${opts.maxAgeSec}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildSessionClearCookie(secure) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export { COOKIE_NAME };
