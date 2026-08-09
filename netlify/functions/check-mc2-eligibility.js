import { supabaseGet } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
    if (!email || !email.includes('@')) return jsonResponse(400, { error: 'Email invalide' });

    const exclusions = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=email,raison&limit=1`,
    );
    if (exclusions.ok && Array.isArray(exclusions.data) && exclusions.data.length > 0) {
      return jsonResponse(200, { eligible: false, reason: 'excluded' });
    }

    const existing = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}&select=token,statut,session_starts_at,session_ends_at,offer_expires_at&limit=1`,
    );
    if (!existing.ok) return jsonResponse(500, { error: 'Erreur base de données MC2' });

    const row = Array.isArray(existing.data) ? existing.data[0] : null;
    const sessionEnd = row ? new Date(row.session_ends_at).getTime() : 0;
    if (row && Number.isFinite(sessionEnd) && Date.now() < sessionEnd) {
      return jsonResponse(200, {
        eligible: false,
        reason: 'already_registered',
        token: row.token,
        statut: row.statut,
        session_date: row.session_starts_at,
        session_ends_at: row.session_ends_at,
        offre_expires_at: row.offer_expires_at,
      });
    }

    return jsonResponse(200, { eligible: true });
  } catch (error) {
    console.error('check-mc2-eligibility error:', error);
    return jsonResponse(500, { error: 'Erreur serveur' });
  }
};
