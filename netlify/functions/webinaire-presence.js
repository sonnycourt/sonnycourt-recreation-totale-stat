import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';

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
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function cleanMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'test') return 'test';
  return 'real';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json();
    const token = cleanToken(body?.token);
    if (!token) return jsonResponse(400, { error: 'Token manquant' });

    const { url, key } = getSupabaseConfig();
    if (!url || !key) return jsonResponse(500, { error: 'Supabase non configuré' });

    const payload = {
      token,
      stage: cleanStage(body?.stage),
      current_second: cleanCurrentSecond(body?.currentSecond),
      is_playing: Boolean(body?.isPlaying),
      mode: cleanMode(body?.mode),
      updated_at: new Date().toISOString(),
    };

    const res = await fetch(`${url}/rest/v1/webinaire_presence?on_conflict=token`, {
      method: 'POST',
      headers: supabaseHeaders({
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('webinaire-presence upsert failed:', res.status, errText);
      return jsonResponse(500, { error: 'Internal server error' });
    }
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('webinaire-presence error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
