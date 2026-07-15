import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getSupabaseConfig, supabaseGet } from './supabase-rest.mjs';
import { verifySessionToken, parseCookies } from './admin-es2-crypto.mjs';

/**
 * Auth de la console /setter : sessions signées (cookie httpOnly) + rate limit
 * de connexion 3 tentatives par heure et par IP (Netlify Blobs).
 */

const COOKIE_NAME = 'setter_session';
const STORE_NAME = 'setter-auth-rl';
const MAX_FAILS = 3;
const BLOCK_MS = 60 * 60 * 1000; // 1 heure

/** Secret dérivé de la service role (namespace dédié, distinct admin/closer). */
export function getSetterCookieSecret() {
  const { key } = getSupabaseConfig();
  if (!key || typeof key !== 'string') return '';
  return crypto.createHash('sha256').update(`setter-console-cookie|${key}`).digest('hex');
}

export function signSetterToken(secret, ttlMs, uid) {
  const exp = Date.now() + ttlMs;
  const payload = JSON.stringify({ exp, uid, v: 1 });
  const payloadB64 = Buffer.from(payload, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

export function getSetterCookieValue(cookieHeader) {
  const c = parseCookies(cookieHeader || '');
  return c[COOKIE_NAME] || '';
}

export function buildSetterSetCookie(value, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ];
  return parts.join('; ');
}

/** Vérifie la session ET que l'utilisateur est toujours actif en base. @returns uid ou null */
export async function authSetterUserId(req) {
  const secret = getSetterCookieSecret();
  if (!secret) return null;
  const data = verifySessionToken(getSetterCookieValue(req.headers.get('cookie') || ''), secret);
  const uid = data && Number.isInteger(data.uid) ? data.uid : null;
  if (uid === null) return null;
  const chk = await supabaseGet(`setter_users?id=eq.${uid}&active=eq.true&select=id`);
  if (!chk.ok || !Array.isArray(chk.data) || !chk.data[0]) return null;
  return uid;
}

// ---- Rate limit login : 3 tentatives / heure / IP ----

function clientIp(req) {
  const xf = req.headers.get('x-forwarded-for') || '';
  if (xf) return xf.split(',')[0].trim().slice(0, 64) || 'unknown';
  return (req.headers.get('x-nf-client-connection-ip') || 'unknown').slice(0, 64);
}

export async function checkLoginRateLimit(req) {
  const key = `rl:${clientIp(req)}`;
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(key);
    if (!raw) return { blocked: false };
    const state = JSON.parse(raw);
    const blockedUntil = Number(state.blockedUntil) || 0;
    if (blockedUntil > Date.now()) {
      return { blocked: true, retryAfterSec: Math.ceil((blockedUntil - Date.now()) / 1000) };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

export async function recordLoginFailure(req) {
  const key = `rl:${clientIp(req)}`;
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(key);
    let fails = 0;
    let blockedUntil = 0;
    if (raw) {
      const state = JSON.parse(raw);
      fails = Number(state.fails) || 0;
      blockedUntil = Number(state.blockedUntil) || 0;
    }
    if (blockedUntil > Date.now()) {
      return { blocked: true, retryAfterSec: Math.ceil((blockedUntil - Date.now()) / 1000) };
    }
    fails += 1;
    if (fails >= MAX_FAILS) {
      blockedUntil = Date.now() + BLOCK_MS;
      fails = 0;
    }
    await store.set(key, JSON.stringify({ fails, blockedUntil }));
    if (blockedUntil > Date.now()) {
      return { blocked: true, retryAfterSec: Math.ceil((blockedUntil - Date.now()) / 1000) };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

export async function clearLoginRateLimit(req) {
  try {
    const store = getStore(STORE_NAME);
    await store.delete(`rl:${clientIp(req)}`);
  } catch {
    /* ignore */
  }
}

export { COOKIE_NAME };
