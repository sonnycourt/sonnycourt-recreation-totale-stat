import { getStore } from '@netlify/blobs';

const STORE_NAME = 'mc2-video-config';
const KEY = 'active-source';
const FORCE_REFRESH_KEY = 'force-refresh-at';

const PRIMARY_DEFAULT =
  'https://vz-601d6eb4-a9a.b-cdn.net/950991b8-2093-4637-a8b5-cd8b98a8f819/playlist.m3u8';
const BACKUP_DEFAULT = '';

function normalizeSource(raw) {
  return raw === 'backup' ? 'backup' : 'primary';
}

export function getMc2VideoSources(env = process.env) {
  return {
    primary: env.MC2_LIVE_VIDEO_URL_PRIMARY || PRIMARY_DEFAULT,
    backup: env.MC2_LIVE_VIDEO_URL_BACKUP || BACKUP_DEFAULT,
  };
}

async function getActiveVideoSource() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(KEY);
    return normalizeSource(String(raw || '').trim());
  } catch {
    return 'primary';
  }
}

export async function getMc2ForceRefreshAt() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(FORCE_REFRESH_KEY);
    return raw ? String(raw).trim() || null : null;
  } catch {
    return null;
  }
}

export async function resolveMc2VideoConfig(env = process.env) {
  const sources = getMc2VideoSources(env);
  const requestedSource = await getActiveVideoSource();
  const activeSource = requestedSource === 'backup' && sources.backup ? 'backup' : 'primary';
  const activeUrl = activeSource === 'backup' ? sources.backup : sources.primary;
  return { activeSource, activeUrl, sources };
}
