import { getStore } from '@netlify/blobs';

const STORE_NAME = 'admin-es2-auth-rl';
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000;

export function clientIp(req) {
  const xf = req.headers.get('x-forwarded-for') || req.headers.get('X-Forwarded-For') || '';
  if (xf) return xf.split(',')[0].trim().slice(0, 64) || 'unknown';
  return (req.headers.get('x-nf-client-connection-ip') || 'unknown').slice(0, 64);
}

/**
 * @returns {Promise<{ blocked: boolean, retryAfterSec?: number }>}
 */
export async function checkRateLimit(req) {
  const ip = clientIp(req);
  const key = `rl:${ip}`;
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

/**
 * @returns {Promise<{ blocked: boolean, retryAfterSec?: number }>}
 */
export async function recordFailure(req) {
  const ip = clientIp(req);
  const key = `rl:${ip}`;
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

export async function clearRateLimit(req) {
  const ip = clientIp(req);
  const key = `rl:${ip}`;
  try {
    const store = getStore(STORE_NAME);
    await store.delete(key);
  } catch {
    /* ignore */
  }
}
