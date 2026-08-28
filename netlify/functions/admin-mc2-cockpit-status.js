import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';
import { ACTIVE_WINDOW_MS, summarizeMc2Cockpit } from './lib/mc2-cockpit.mjs';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });

  try {
    const now = new Date();
    const activeSince = new Date(now.getTime() - ACTIVE_WINDOW_MS).toISOString();
    const recentSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const scheduleFrom = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const scheduleTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const registrationSelect = [
      'token', 'slot_kind', 'session_starts_at', 'session_ends_at',
      'registration_completed_at', 'statut', 'attended_live',
      'watch_max_seconds_live', 'watch_max_seconds_replay', 'saw_offer',
      'checkout_clicked', 'checkout_view_count', 'checkout_engaged',
      'payment_status', 'purchased_at', 'registered_at',
    ].join(',');

    const [presenceResult, recentResult, scheduledResult, checkoutActuallySeenResult] = await Promise.all([
      supabaseGet(`mc2_presence?updated_at=gte.${encodeURIComponent(activeSince)}&select=token,stage,current_second,is_playing,mode,updated_at&order=updated_at.desc&limit=2000`),
      supabaseGet(`mc2_registrations?registered_at=gte.${encodeURIComponent(recentSince)}&select=${registrationSelect}&order=registered_at.desc&limit=3000`),
      supabaseGet(`mc2_registrations?slot_kind=eq.scheduled&session_starts_at=gte.${encodeURIComponent(scheduleFrom)}&session_starts_at=lte.${encodeURIComponent(scheduleTo)}&select=${registrationSelect}&order=session_starts_at.asc&limit=3000`),
      supabaseGet(`mc2_funnel_events?event_name=eq.checkout_actually_seen&occurred_at=gte.${encodeURIComponent(recentSince)}&select=token&limit=3000`),
    ]);

    if (!presenceResult.ok || !recentResult.ok || !scheduledResult.ok || !checkoutActuallySeenResult.ok) {
      return json(503, { error: 'Les données MC2 sont momentanément indisponibles.' });
    }

    return json(200, summarizeMc2Cockpit({
      presenceRows: Array.isArray(presenceResult.data) ? presenceResult.data : [],
      recentRegistrations: Array.isArray(recentResult.data) ? recentResult.data : [],
      scheduledRegistrations: Array.isArray(scheduledResult.data) ? scheduledResult.data : [],
      checkoutActuallySeenEvents: Array.isArray(checkoutActuallySeenResult.data)
        ? checkoutActuallySeenResult.data
        : [],
      now,
    }));
  } catch (error) {
    console.error('admin-mc2-cockpit-status error:', error);
    return json(500, { error: 'Erreur interne.' });
  }
};
