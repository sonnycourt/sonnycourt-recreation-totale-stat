// Politique pure, sans effet de bord. Non branchée aux routes tant que
// l'archivage atomique et les protections des files ne sont pas installés.
import { isWebinarBuyerStatus, isWebinarRegistrationExclusion, isMc2ReactivatedNoShow } from './webinaire-exclusions.mjs';

export function hasConfirmedPlaybackCta(events = []) {
  // Ni saw_offer, ni offer_available, ni la position maximale, ni une simple
  // présence ne prouvent que le CTA a été atteint pendant la lecture.
  return events.some(event => event.event_name === 'cta_playback_present');
}

export function mc2ReregistrationDecision({
  registrations = [], events = [], exclusionReason = null,
  historicalCtaConfirmed = false, historyLoaded = true, now = Date.now(),
} = {}) {
  // Tracking lacunaire != panne de lecture de la base. Une panne ne doit pas
  // autoriser à écraser une inscription dont le paiement est inconnu.
  if (!historyLoaded) return { action: 'retry', reason: 'history_unavailable' };
  if (registrations.some(isWebinarBuyerStatus)) return { action: 'blocked', reason: 'buyer' };
  if (historicalCtaConfirmed || hasConfirmedPlaybackCta(events)) return { action: 'blocked', reason: 'cta_playback' };
  if (exclusionReason && !isWebinarRegistrationExclusion(exclusionReason) && !isMc2ReactivatedNoShow(exclusionReason)) {
    return { action: 'review', reason: 'protected_exclusion' };
  }
  const completed = registrations.filter(row => row.registration_completed_at
    || ['registered', 'present', 'completed', 'expired'].includes(row.statut));
  const active = completed.find(row => Number.isFinite(Date.parse(row.session_ends_at))
    && Date.parse(row.session_ends_at) > now);
  if (active) return { action: 'existing_session', reason: 'session_active' };
  if (completed.some(row => !Number.isFinite(Date.parse(row.session_ends_at)))) {
    return { action: 'review', reason: 'session_end_unknown' };
  }
  return { action: completed.length ? 'reregister' : 'register', reason: 'no_confirmed_cta' };
}
