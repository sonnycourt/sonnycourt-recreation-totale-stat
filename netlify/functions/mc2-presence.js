import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function cleanToken(value) {
  return String(value || '').trim().slice(0, 128);
}

function cleanSecond(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = cleanToken(body?.token);
    if (!token) return jsonResponse(400, { error: 'Token manquant' });

    const stage = ['waiting', 'session', 'replay'].includes(String(body?.stage || '').toLowerCase())
      ? String(body.stage).toLowerCase()
      : 'session';
    const mode = String(body?.mode || '').toLowerCase() === 'test' ? 'test' : 'real';
    const currentSecond = cleanSecond(body?.currentSecond);
    const nowIso = new Date().toISOString();
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return jsonResponse(500, { error: 'Supabase non configuré' });

    const presence = await fetch(`${url}/rest/v1/mc2_presence?on_conflict=token`, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({
        token,
        stage,
        current_second: currentSecond,
        is_playing: Boolean(body?.isPlaying),
        mode,
        updated_at: nowIso,
      }),
    });
    if (!presence.ok) return jsonResponse(500, { error: 'Erreur présence MC2' });

    const encodedToken = encodeURIComponent(token);
    const summary = { last_presence_at: nowIso };
    await fetch(`${url}/rest/v1/mc2_registrations?token=eq.${encodedToken}`, {
      method: 'PATCH',
      headers: supabaseHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(summary),
    });

    if (currentSecond > 0 && (stage === 'session' || stage === 'replay')) {
      const maxColumn = stage === 'session' ? 'watch_max_seconds_live' : 'watch_max_seconds_replay';
      await fetch(`${url}/rest/v1/mc2_registrations?token=eq.${encodedToken}&${maxColumn}=lt.${currentSecond}`, {
        method: 'PATCH',
        headers: supabaseHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ [maxColumn]: currentSecond, last_presence_at: nowIso }),
      });
      if (stage === 'session') {
        await fetch(`${url}/rest/v1/mc2_registrations?token=eq.${encodedToken}&watch_first_second_live=is.null`, {
          method: 'PATCH',
          headers: supabaseHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ watch_first_second_live: currentSecond }),
        });
      }
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('mc2-presence error:', error);
    return jsonResponse(500, { error: 'Erreur serveur' });
  }
};
