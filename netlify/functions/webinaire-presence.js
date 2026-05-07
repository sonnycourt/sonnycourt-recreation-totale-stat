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

    // Bump watch_max_seconds_{live|replay} dans webinaire_registrations (atomique via filter lt).
    // Permet le graphique de rétention à la minute dans le cockpit.
    if (payload.current_second > 0 && (payload.stage === 'session' || payload.stage === 'replay')) {
      const maxColumn = payload.stage === 'session' ? 'watch_max_seconds_live' : 'watch_max_seconds_replay';
      const encodedToken = encodeURIComponent(token);
      // PATCH ne s'applique que si la valeur en base est strictement inférieure à la nouvelle (atomique).
      void fetch(
        `${url}/rest/v1/webinaire_registrations?token=eq.${encodedToken}&${maxColumn}=lt.${payload.current_second}`,
        {
          method: 'PATCH',
          headers: supabaseHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ [maxColumn]: payload.current_second }),
        },
      ).catch((err) => {
        console.error('webinaire-presence watch_max bump failed:', err?.message);
      });

      // LIVE uniquement : enregistrer le moment d'entrée (premier ping où current_second > 0).
      // Atomique via filter is.null : ne s'applique que si la colonne est encore NULL.
      if (payload.stage === 'session') {
        void fetch(
          `${url}/rest/v1/webinaire_registrations?token=eq.${encodedToken}&watch_first_second_live=is.null`,
          {
            method: 'PATCH',
            headers: supabaseHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ watch_first_second_live: payload.current_second }),
          },
        ).catch((err) => {
          console.error('webinaire-presence watch_first bump failed:', err?.message);
        });
      }
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('webinaire-presence error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
