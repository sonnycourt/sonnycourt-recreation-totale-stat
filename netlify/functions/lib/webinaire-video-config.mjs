import { getStore } from '@netlify/blobs';

const STORE_NAME = 'webinaire-video-config';
const KEY = 'active-source';
const FORCE_REFRESH_KEY = 'force-refresh-at';

const PRIMARY_DEFAULT =
  'https://sonnycourt-videos-public.b-cdn.net/WEBINAIRE%20W2%20(compresse).mp4';

function normalizeSource(raw) {
  if (raw === 'backup') return 'backup';
  return 'primary';
}

export function getVideoSources() {
  return {
    primary: process.env.WEBINAIRE_VIDEO_URL_PRIMARY || PRIMARY_DEFAULT,
    backup: process.env.WEBINAIRE_VIDEO_URL_BACKUP || '',
  };
}

export async function getActiveVideoSource() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(KEY);
    return normalizeSource(String(raw || '').trim());
  } catch {
    return 'primary';
  }
}

export async function setActiveVideoSource(source) {
  const normalized = normalizeSource(source);
  const store = getStore(STORE_NAME);
  await store.set(KEY, normalized);
  return normalized;
}

export async function clearActiveVideoSourceOverride() {
  const store = getStore(STORE_NAME);
  await store.delete(KEY);
}

/**
 * Récupère le timestamp ISO du dernier "force refresh viewers" demandé par l'admin.
 * Les pages session/replay comparent cette valeur à leur heure de chargement et
 * rechargent automatiquement si la valeur est plus récente.
 */
export async function getForceRefreshAt() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(FORCE_REFRESH_KEY);
    if (!raw) return null;
    const ts = String(raw).trim();
    if (!ts) return null;
    return ts;
  } catch {
    return null;
  }
}

/**
 * Stocke maintenant comme nouveau timestamp "force refresh viewers".
 * Tous les viewers actifs vont recharger leur page lors du prochain poll (max 7s).
 */
export async function setForceRefreshNow() {
  const store = getStore(STORE_NAME);
  const iso = new Date().toISOString();
  await store.set(FORCE_REFRESH_KEY, iso);
  return iso;
}

export async function resolveActiveVideoConfig() {
  const sources = getVideoSources();
  const activeSource = await getActiveVideoSource();
  const activeUrl = activeSource === 'backup' && sources.backup ? sources.backup : sources.primary;
  return { activeSource, activeUrl, sources };
}

