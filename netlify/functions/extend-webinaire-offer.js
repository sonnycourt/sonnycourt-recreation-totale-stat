import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const hoursToAdd = Number(body?.hoursToAdd ?? 24);
    if (!email || !email.includes('@')) {
      return jsonResponse(400, { error: 'Email invalide' });
    }
    if (!Number.isFinite(hoursToAdd) || hoursToAdd <= 0) {
      return jsonResponse(400, { error: "Nombre d'heures invalide" });
    }

    const lookup = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=email,prenom,offre_expires_at&limit=1`,
    );
    if (!lookup.ok) {
      return jsonResponse(500, { error: 'Erreur lecture prospect' });
    }
    const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
    if (!row) {
      return jsonResponse(404, { error: 'Prospect introuvable' });
    }

    const nowMs = Date.now();
    const currentExpiryMs = new Date(row.offre_expires_at).getTime();
    const baseMs = Number.isFinite(currentExpiryMs) ? currentExpiryMs : nowMs;
    const nextExpiryMs = baseMs + Math.round(hoursToAdd * 3600 * 1000);
    const nextExpiryIso = new Date(nextExpiryMs).toISOString();

    const update = await supabasePatch(
      'webinaire_registrations',
      `email=eq.${encodeURIComponent(email)}`,
      { offre_expires_at: nextExpiryIso },
    );
    if (!update.ok) {
      return jsonResponse(500, { error: 'Erreur mise à jour offre' });
    }

    return jsonResponse(200, {
      ok: true,
      email: row.email || email,
      firstName: row.prenom || '',
      offreExpiresAt: nextExpiryIso,
      hoursAdded: hoursToAdd,
    });
  } catch (error) {
    console.error('extend-webinaire-offer error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
