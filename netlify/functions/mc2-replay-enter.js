import crypto from 'crypto';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { isMc2Purchased, mc2RecoveryResumeSeconds } from './lib/mc2-replay-recovery.mjs';
import { mc2OfferExpiresAt } from '../../src/lib/mc2-timing.mjs';

const DIRECT_LATE_CUTOFF_MS = 20 * 60 * 1000;

function response(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}

function cleanToken(value) {
  const token = String(value || '').trim().slice(0, 128);
  return /^[A-Za-z0-9_-]{24,128}$/.test(token) ? token : '';
}

function redirectTo(path) {
  return response(302, 'Redirection…', { Location: path });
}

export default async (req) => {
  if (req.method !== 'GET') return response(405, 'Méthode non autorisée.');

  try {
    const token = cleanToken(new URL(req.url).searchParams.get('t'));
    if (!token) return response(404, 'Lien invalide.');

    const registrationResult = await supabaseGet(
      `mc2_registrations?token=eq.${encodeURIComponent(token)}`
        + '&select=token,email,prenom,session_starts_at,session_ends_at,offer_expires_at,attended_live,saw_offer,watch_max_seconds_live,statut,payment_status,purchased_at&limit=1',
    );
    const registration = registrationResult.ok && Array.isArray(registrationResult.data)
      ? registrationResult.data[0] || null
      : null;
    if (!registration) return response(404, 'Lien invalide.');
    if (isMc2Purchased(registration)) return redirectTo('/mc2/session/?t=' + encodeURIComponent(token));

    const now = new Date();
    const sessionStartMs = new Date(registration.session_starts_at || '').getTime();
    if (!Number.isFinite(sessionStartMs)) return response(404, 'Session invalide.');

    const offerExpiryMs = new Date(registration.offer_expires_at || '').getTime();
    if (registration.saw_offer === true && Number.isFinite(offerExpiryMs)) {
      return redirectTo('/mc2/session/?t=' + encodeURIComponent(token));
    }
    if (now.getTime() < sessionStartMs + DIRECT_LATE_CUTOFF_MS) {
      return redirectTo('/mc2/session/?t=' + encodeURIComponent(token));
    }

    const accessExpiresAt = new Date(registration.offer_expires_at || '')
      .getTime() > 0
      ? new Date(registration.offer_expires_at)
      : mc2OfferExpiresAt(registration.session_starts_at);
    if (now >= accessExpiresAt) return response(410, 'Le replay n’est plus disponible.');

    const sessionKey = new Date(sessionStartMs).toISOString();
    const jobKey = `mc2_direct_replay:${token}:${sessionKey}`;
    const existingResult = await supabaseGet(
      `mc2_replay_recovery_jobs?job_key=eq.${encodeURIComponent(jobKey)}&select=*&limit=1`,
    );
    const existing = existingResult.ok && Array.isArray(existingResult.data)
      ? existingResult.data[0] || null
      : null;
    const accessCode = String(existing?.access_code || '').trim()
      || crypto.randomBytes(24).toString('base64url');
    const segment = registration.attended_live === true ? 'left_before_cta' : 'no_show';
    const replayJob = {
      token,
      job_key: jobKey,
      session_starts_at: sessionKey,
      segment,
      message_type: segment === 'no_show' ? 'no_show_initial' : 'left_before_cta_initial',
      due_at: now.toISOString(),
      status: 'delivered',
      attempts: Number(existing?.attempts || 0),
      access_code: accessCode,
      access_starts_at: existing?.access_starts_at || now.toISOString(),
      access_expires_at: accessExpiresAt.toISOString(),
      resume_seconds: mc2RecoveryResumeSeconds(registration, segment),
      last_error: null,
      skip_reason: null,
      delivered_at: existing?.delivered_at || now.toISOString(),
    };

    const saved = existing?.id
      ? await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encodeURIComponent(existing.id)}`, replayJob)
      : await supabasePost('mc2_replay_recovery_jobs', replayJob);
    if (!saved.ok) throw new Error(`mc2_direct_replay_save_${saved.status}`);

    return redirectTo('/mc2/replay/?access=' + encodeURIComponent(accessCode));
  } catch (error) {
    console.error('mc2-replay-enter:', error);
    return response(500, 'Accès replay momentanément indisponible.');
  }
};
