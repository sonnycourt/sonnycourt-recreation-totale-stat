// Rate-limit anti-brute-force pour /oracle-es2 (mêmes règles que admin-es2-login).
// Store Netlify Blobs séparé pour ne pas bloquer/débloquer en commun avec l'admin.
// 5 échecs consécutifs par IP => blocage 15 min.

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'oracle-es2-auth-rl';
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000;

/** IP client depuis un event Netlify (handler classique : headers = objet plat). */
export function clientIpFromEvent(event) {
  const h = (event && event.headers) || {};
  const xf = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  if (xf) return xf.split(',')[0].trim().slice(0, 64) || 'unknown';
  return (h['x-nf-client-connection-ip'] || 'unknown').slice(0, 64);
}

/** @returns {Promise<{ blocked: boolean, retryAfterSec?: number }>} */
export async function checkRateLimit(ip) {
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

/** @returns {Promise<{ blocked: boolean, retryAfterSec?: number }>} */
export async function recordFailure(ip) {
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

export async function clearRateLimit(ip) {
  const key = `rl:${ip}`;
  try {
    const store = getStore(STORE_NAME);
    await store.delete(key);
  } catch {
    /* ignore */
  }
}
