import { loadMc2ReplayAccess } from './lib/mc2-replay-recovery.mjs';
import { supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { ensureMc2OfferDeadline } from './lib/mc2-offer-deadline.mjs';

const EVENTS = new Set(['replay_started', 'replay_progress', 'cta_reached']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function second(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(86_400, Math.floor(number))) : 0;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  try {
    const body = await req.json().catch(() => ({}));
    const event = String(body.event || '').trim();
    if (!EVENTS.has(event)) return json(400, { error: 'Événement invalide' });
    const access = await loadMc2ReplayAccess(body.access);
    if (!access.ok) return json(404, { error: 'Accès invalide' });
    const currentSecond = second(body.currentSecond);
    const nowIso = new Date().toISOString();
    const patch = { last_presence_at: nowIso, last_event_at: nowIso };
    let offerDeadline = null;
    if (event === 'cta_reached') {
      patch.saw_offer = true;
      offerDeadline = await ensureMc2OfferDeadline({
        token: access.registration.token,
        registration: access.registration,
        source: 'replay',
        now: new Date(nowIso),
      });
      if (!offerDeadline.ok) return json(500, { error: 'Expiration de l’offre non initialisée' });
    }
    await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(access.registration.token)}`, patch);
    if (event === 'replay_progress') {
      await supabasePatch(
        'mc2_registrations',
        `token=eq.${encodeURIComponent(access.registration.token)}&watch_max_seconds_replay=lt.${currentSecond}`,
        { watch_max_seconds_replay: currentSecond, last_presence_at: nowIso, last_event_at: nowIso },
      );
    }
    await supabasePost('mc2_funnel_events', {
      token: access.registration.token,
      event_name: event === 'replay_progress' ? 'video_checkpoint' : event,
      event_value: String(currentSecond),
      page_path: '/mc2/replay/',
      metadata: { route: '/mc2/replay/' },
      dedupe_key: event === 'replay_progress'
        ? `recovery_replay_${access.job.id}_${Math.floor(currentSecond / 60)}`
        : `recovery_${event}_${access.job.id}`,
    }, { prefer: 'return=minimal' }).catch(() => {});
    return json(200, {
      ok: true,
      ...(offerDeadline ? {
        offer_activated_at: offerDeadline.activatedAt,
        offer_expires_at: offerDeadline.offerExpiresAt,
        offer_sms_due_at: offerDeadline.smsDueAt,
        offer_sms_queued: offerDeadline.smsQueued,
      } : {}),
    });
  } catch (error) {
    console.error('mc2-replay-track:', error);
    return json(500, { error: 'Erreur serveur' });
  }
};
