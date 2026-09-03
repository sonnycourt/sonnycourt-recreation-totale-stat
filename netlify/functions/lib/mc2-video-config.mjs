import { getStore } from '@netlify/blobs';

const STORE_NAME = 'mc2-video-config';
const KEY = 'active-source';
const FORCE_REFRESH_KEY = 'force-refresh-at';

const PRIMARY_DEFAULT =
  'https://vz-601d6eb4-a9a.b-cdn.net/b253a12e-7673-4447-ba19-1b868051efd6/playlist.m3u8';
const LEGACY_PRIMARY =
  'https://vz-601d6eb4-a9a.b-cdn.net/eb8f090e-919d-4994-92b9-a9b516b35600/playlist.m3u8';
const BACKUP_DEFAULT = '';

function normalizeSource(raw) {
  return raw === 'backup' ? 'backup' : 'primary';
}

export function getMc2VideoSources(env = process.env) {
  const configuredPrimary = String(env.MC2_LIVE_VIDEO_URL_PRIMARY || '').trim();
  return {
    // Empêche l'ancienne variable Netlify de réinjecter silencieusement la
    // vidéo remplacée. Une future URL différente reste utilisable par le cockpit.
    primary: configuredPrimary && configuredPrimary !== LEGACY_PRIMARY
      ? configuredPrimary
      : PRIMARY_DEFAULT,
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
