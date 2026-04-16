import { getStore } from '@netlify/blobs';

const STORE_NAME = 'webinaire-live-playback-command';
const KEY = 'cmd';

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function setPlaybackCommand(command) {
  const store = getStore(STORE_NAME);
  const action = String(command?.action || '').trim();
  if (!action) return null;

  const payload = {
    id: makeId(),
    action,
    ts: Date.now(),
    meta: command?.meta || null,
  };
  await store.set(KEY, JSON.stringify(payload));
  return payload;
}

export async function getPlaybackCommand() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.action) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isSeekLiveOffsetCommand(cmd) {
  return Boolean(cmd && String(cmd.action) === 'seek_live_offset');
}

