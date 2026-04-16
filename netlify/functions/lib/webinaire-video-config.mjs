import { getStore } from '@netlify/blobs';

const STORE_NAME = 'webinaire-video-config';
const KEY = 'active-source';

const PRIMARY_DEFAULT =
  'https://sonnycourt-videos-public.b-cdn.net/Webinaire%20-%20V1%20(Pour%20Partage%20Et%20Timing).mp4';

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

export async function resolveActiveVideoConfig() {
  const sources = getVideoSources();
  const activeSource = await getActiveVideoSource();
  const activeUrl = activeSource === 'backup' && sources.backup ? sources.backup : sources.primary;
  return { activeSource, activeUrl, sources };
}

