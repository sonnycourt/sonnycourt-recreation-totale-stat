import { getStore } from '@netlify/blobs';

const STORE_NAME = 'webinaire-ui-timing';
const KEY = 'timing';

const DEFAULTS = {
  ctaAppearSeconds: 1800, // 30 min after live start
  guideShowBeforeMinutes: 60, // 60 min before session_date
  guideHideAfterMinutes: 15, // 15 min after session_date
};

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function sanitizeUiTiming(input = {}) {
  return {
    ctaAppearSeconds: clamp(toInt(input.ctaAppearSeconds, DEFAULTS.ctaAppearSeconds), 0, 4 * 60 * 60),
    guideShowBeforeMinutes: clamp(toInt(input.guideShowBeforeMinutes, DEFAULTS.guideShowBeforeMinutes), 0, 24 * 60),
    guideHideAfterMinutes: clamp(toInt(input.guideHideAfterMinutes, DEFAULTS.guideHideAfterMinutes), 0, 24 * 60),
  };
}

export async function getUiTimingConfig() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return sanitizeUiTiming(parsed);
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setUiTimingConfig(input = {}) {
  const payload = sanitizeUiTiming(input);
  const store = getStore(STORE_NAME);
  await store.set(KEY, JSON.stringify(payload));
  return payload;
}

