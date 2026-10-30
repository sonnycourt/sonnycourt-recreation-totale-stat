import { supabasePost } from './supabase-rest.mjs';
import { mc2EntryPaymentPending } from '../../../src/lib/mc2-entry-payment.mjs';

export const MC2_SESSION_H1_LEAD_MS = 60 * 60_000;
export const MC2_SESSION_H1_STALE_MS = 10 * 60_000;

// Default off: enable only after Sonny approves the copy and runs the SQL.
// This flag also replaces the offer-deadline SMS; the live SMS is untouched.
export function mc2SessionH1SmsEnabled() {
  return String(process.env.MC2_SESSION_H1_SMS_ENABLED || '').trim().toLowerCase() === 'true';
}

export async function queueDueMc2SessionH1Sms(now = new Date()) {
  if (!mc2SessionH1SmsEnabled()) return { ok: true, enabled: false, queued: 0 };
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return { ok: false, error: 'invalid_session_h1_time' };
  const result = await supabasePost('rpc/queue_mc2_session_h1_sms', { p_now: date.toISOString() });
  return { ok: result.ok, enabled: true, queued: Number(result.data) || 0, error: result.error };
}

export function sessionH1SkipReason(registration, job, now = new Date()) {
  if (!registration) return 'registration_missing';
  if (registration.slot_kind !== 'scheduled') return 'session_h1_not_scheduled';
  if (!registration.sms_consent_at) return 'sms_consent_missing';
  if (mc2EntryPaymentPending(registration)) return 'entry_payment_pending';
  if (registration.statut === 'purchased' || registration.purchased_at
    || ['paid', 'succeeded', 'active', 'complete', 'completed'].includes(registration.payment_status)) {
    return 'already_purchased';
  }
  const start = Date.parse(registration.session_starts_at);
  const due = Date.parse(job.due_at);
  const completed = Date.parse(registration.registration_completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(due) || due !== start - MC2_SESSION_H1_LEAD_MS) {
    return 'session_h1_rescheduled';
  }
  if (!Number.isFinite(completed) || completed > due) return 'session_h1_late_registration';
  if (now.getTime() < due) return 'not_due';
  if (now.getTime() - due > MC2_SESSION_H1_STALE_MS) return 'session_h1_stale';
  return null;
}
