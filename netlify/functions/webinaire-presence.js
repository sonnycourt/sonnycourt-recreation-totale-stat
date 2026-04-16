import { getStore } from '@netlify/blobs';

const STORE_NAME = 'webinaire-live-presence';
const PREFIX = 'presence:';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanToken(value) {
  return String(value || '')
    .trim()
    .slice(0, 128);
}

function cleanStage(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'waiting' || v === 'session' || v === 'replay') return v;
  return 'session';
}

function cleanCurrentSecond(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json();
    const token = cleanToken(body?.token);
    const stage = cleanStage(body?.stage);
    const currentSecond = cleanCurrentSecond(body?.currentSecond);
    const isPlaying = Boolean(body?.isPlaying);
    if (!token) return jsonResponse(400, { error: 'Token manquant' });

    const store = getStore(STORE_NAME);
    const key = `${PREFIX}${token}`;
    const payload = {
      token,
      stage,
      ts: Date.now(),
      currentSecond,
      isPlaying,
    };
    await store.set(key, JSON.stringify(payload));
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('webinaire-presence error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

