import { supabaseGet, supabasePatch } from './supabase-rest.mjs';
import { MC2_OFFER_SMS_LEAD_MS, mc2OfferH1SmsEnabled, queueMc2Sms } from './mc2-sms.mjs';
import { queueMc2OfferEmails } from './mc2-session-emails.mjs';
import {
  MC2_LIVE_CTA_SECONDS as SHARED_LIVE_CTA_SECONDS,
  MC2_LIVE_VIDEO_LEAD_MS as SHARED_LIVE_VIDEO_LEAD_MS,
} from '../../../src/lib/mc2-timing.mjs';

export const MC2_OFFER_DURATION_MS = 72 * 60 * 60 * 1000;
export { MC2_OFFER_SMS_LEAD_MS };
export const MC2_LIVE_VIDEO_LEAD_MS = SHARED_LIVE_VIDEO_LEAD_MS;
export const MC2_LIVE_CTA_SECONDS = SHARED_LIVE_CTA_SECONDS;

function validDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

export function mc2LiveCtaAt(registration) {
  const sessionStart = validDate(registration?.session_starts_at);
  if (!sessionStart) return null;
  return new Date(
    sessionStart.getTime() - MC2_LIVE_VIDEO_LEAD_MS + MC2_LIVE_CTA_SECONDS * 1000,
  );
}

/**
 * Source de vérité serveur de la fenêtre commerciale MC2.
 *
 * - live : l'ancre est calculée depuis la session enregistrée (non falsifiable
 *   par le navigateur) et correspond exactement à 01:37:28 dans la diffusion ;
 * - replay : l'ancre est la première réception serveur de `cta_reached`.
 *
 * Le PATCH `offer_expires_at=is.null` rend l'initialisation idempotente même si
 * plusieurs onglets atteignent le CTA simultanément.
 */
export async function ensureMc2OfferDeadline({ token, registration, source = 'live', now = new Date() }) {
  const safeToken = String(token || '').trim().slice(0, 128);
  if (!safeToken) return { ok: false, error: 'token_missing' };

  let expiresAt = validDate(registration?.offer_expires_at);
  let activatedAt = source === 'live' ? validDate(registration?.session_starts_at) : validDate(now);
  if (!activatedAt) activatedAt = validDate(now);

  if (!expiresAt) {
    const candidate = new Date(activatedAt.getTime() + MC2_OFFER_DURATION_MS).toISOString();
    const saved = await supabasePatch(
      'mc2_registrations',
      `token=eq.${encodeURIComponent(safeToken)}&offer_expires_at=is.null`,
      { offer_expires_at: candidate, last_event_at: validDate(now).toISOString() },
    );
    if (!saved.ok) return { ok: false, error: 'offer_deadline_not_saved' };
    expiresAt = validDate(saved.data?.[0]?.offer_expires_at);

    // Un autre onglet a pu gagner la course entre la lecture et le PATCH.
    if (!expiresAt) {
      const current = await supabaseGet(
        `mc2_registrations?token=eq.${encodeURIComponent(safeToken)}&select=offer_expires_at&limit=1`,
      );
      expiresAt = validDate(current.data?.[0]?.offer_expires_at);
    }
  }
  if (!expiresAt) return { ok: false, error: 'offer_deadline_missing' };

  const queued = mc2OfferH1SmsEnabled()
    ? await queueMc2Sms({
      token: safeToken,
      messageType: 'offer_deadline',
      dueAt: new Date(expiresAt.getTime() - MC2_OFFER_SMS_LEAD_MS),
      discriminator: expiresAt.toISOString(),
    })
    : { ok: false, disabled: true };
  if (!queued.ok && !queued.disabled) console.error('MC2 offer SMS queue failed:', queued.error);

  let emailQueue = { ok: false, enabled: false, queued: 0 };
  try {
    const offerCtaAt = source === 'live' ? mc2LiveCtaAt(registration) : validDate(now);
    emailQueue = await queueMc2OfferEmails({
      token: safeToken,
      session_starts_at: registration?.session_starts_at,
      offer_expires_at: expiresAt.toISOString(),
      offer_cta_at: offerCtaAt?.toISOString(),
    });
  } catch (error) {
    // La file email ne doit jamais empêcher l'affichage de l'offre.
    console.error('MC2 offer email queue failed:', error?.message || error);
  }

  return {
    ok: true,
    activatedAt: activatedAt.toISOString(),
    offerExpiresAt: expiresAt.toISOString(),
    smsDueAt: new Date(expiresAt.getTime() - MC2_OFFER_SMS_LEAD_MS).toISOString(),
    smsQueued: queued.ok,
    smsDisabled: queued.disabled === true,
    emailJobsQueued: Number(emailQueue.queued || 0),
    emailJobsDisabled: emailQueue.enabled === false,
  };
}
