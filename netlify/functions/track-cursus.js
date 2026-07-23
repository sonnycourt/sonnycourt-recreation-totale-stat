import { supabasePatch } from './lib/supabase-rest.mjs';

// Tracking léger des vidéos de chauffe (cursus 3 jours) sur la page confirmation.
// POST { token, step: 1|2|3, seconds } — écrit la position max atteinte.
// L'update est conditionnel côté PostgREST (colonne < nouvelle valeur) : une
// seule requête, pas d'écrasement d'une valeur plus haute par un ping tardif.

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    const token = String(body.token || '').trim();
    const step = Number(body.step);
    const seconds = Math.floor(Number(body.seconds));

    if (!token || ![1, 2, 3].includes(step)) return jsonResponse(200, { ok: true, skipped: 'bad_input' });
    if (!Number.isFinite(seconds) || seconds <= 0) return jsonResponse(200, { ok: true, skipped: 'no_progress' });

    const col = `cursus_video${step}_seconds`;
    const capped = Math.min(seconds, 7200);

    await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(token)}&${col}=lt.${capped}`,
      { [col]: capped },
    );

    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('track-cursus error:', error);
    return jsonResponse(200, { ok: false });
  }
};
