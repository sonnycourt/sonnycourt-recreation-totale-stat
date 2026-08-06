import syncAvailability from './coaching-sync-availability.js';
import { supabaseGet } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async () => {
  const secret = process.env.COACHING_SYNC_SECRET || '';
  if (secret.length < 32) return json(503, { error: 'Synchronisation non configurée.' });

  const coachesResult = await supabaseGet('coaching_coaches?status=eq.active&calendar_connected_at=not.is.null&select=slug&order=slug.asc');
  if (!coachesResult.ok) return json(502, { error: 'Impossible de lire les coachs connectés.' });

  const coaches = Array.isArray(coachesResult.data) ? coachesResult.data : [];
  const results = [];
  for (const coach of coaches) {
    const response = await syncAvailability(new Request('https://coaching.sonnycourt.com/.netlify/functions/coaching-sync-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coaching-sync-secret': secret },
      body: JSON.stringify({ coach_slug: coach.slug }),
    }));
    const payload = await response.json().catch(() => ({}));
    results.push({ coach: coach.slug, ok: response.ok, status: response.status, available: payload.available || 0 });
  }

  return json(results.every((result) => result.ok) ? 200 : 207, { ok: results.every((result) => result.ok), results });
};
