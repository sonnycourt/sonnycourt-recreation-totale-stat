import { supabaseGet } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get('t') || url.searchParams.get('token') || '').trim().slice(0, 128);
    if (!token) return jsonResponse(400, { error: 'Token manquant' });

    const result = await supabaseGet(
      `mc2_registrations?token=eq.${encodeURIComponent(token)}&select=token,prenom,email,telephone,pays,session_slot_id,slot_kind,visitor_timezone,session_starts_at,session_ends_at,offer_expires_at,statut,traffic_source,registered_at,registration_completed_at,attended_live,watch_first_second_live,watch_max_seconds_live,saw_offer,clicked_cta&limit=1`,
    );
    if (!result.ok) return jsonResponse(500, { error: 'Erreur base de données MC2' });
    if (!Array.isArray(result.data) || result.data.length === 0) {
      return jsonResponse(404, { error: 'Token invalide' });
    }

    const row = result.data[0];
    return jsonResponse(200, {
      valid: true,
      token: row.token,
      prenom: row.prenom || '',
      email: row.email || undefined,
      telephone: row.telephone || undefined,
      pays: row.pays || '',
      creneau: row.session_slot_id,
      slotKind: row.slot_kind,
      visitorTimezone: row.visitor_timezone || 'UTC',
      sessionStartsAt: row.session_starts_at,
      sessionEndsAt: row.session_ends_at,
      offreExpiresAt: row.offer_expires_at,
      statut: row.statut || 'partial',
      registeredAt: row.registered_at,
      registrationCompletedAt: row.registration_completed_at,
      metaTrackingEligible: row.traffic_source === 'meta_ad',
      attended_live: row.attended_live === true,
      watchFirstSecondLive: row.watch_first_second_live,
      watchMaxSecondsLive: row.watch_max_seconds_live || 0,
      sawOffer: row.saw_offer === true,
      clickedCta: row.clicked_cta === true,
    });
  } catch (error) {
    console.error('get-mc2-registration error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error?.message : undefined,
    });
  }
};
