import crypto from 'node:crypto';
import { getSupabaseConfig } from './supabase-rest.mjs';
import { verifySessionToken, parseCookies } from './admin-es2-crypto.mjs';

const COOKIE_NAME = 'closer_access';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Secret de cookie dérivé de la service role (namespace dédié, distinct de l'admin). */
export function getCloserCookieSecret() {
  const { key } = getSupabaseConfig();
  if (!key || typeof key !== 'string') return '';
  return crypto.createHash('sha256').update(`closer-access-cookie|${key}`).digest('hex');
}

/**
 * Jeton signé incluant l'id du code (cid) pour le tracking au retour.
 * @param {string} secret
 * @param {number} ttlMs
 * @param {number} cid
 */
export function signCloserToken(secret, ttlMs, cid) {
  const exp = Date.now() + ttlMs;
  const payload = JSON.stringify({ exp, cid, v: 1 });
  const payloadB64 = b64url(Buffer.from(payload, 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

/** @returns {{ exp: number, cid: number } | null} */
export function verifyCloserToken(token, secret) {
  return verifySessionToken(token, secret);
}

export function getCloserCookieValue(cookieHeader) {
  const c = parseCookies(cookieHeader || '');
  return c[COOKIE_NAME] || '';
}

/** @param {{ value: string, maxAgeSec: number, secure: boolean }} opts */
export function buildCloserSetCookie(opts) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(opts.value)}`,
    'Path=/',
    `Max-Age=${opts.maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export { COOKIE_NAME };
