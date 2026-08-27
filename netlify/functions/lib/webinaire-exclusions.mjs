import { getSupabaseConfig, supabaseHeaders } from './supabase-rest.mjs';

const REGISTRATION_REASONS = new Set([
  'inscrit_webinaire',
  'inscrit_mc2',
  'participant_webinaire',
  'participant_mc2',
]);

const MC2_REACTIVATED_NO_SHOW_REASON = 'no_show_reactive_mc2';

export function isWebinarRegistrationExclusion(reason) {
  return REGISTRATION_REASONS.has(String(reason || '').trim().toLowerCase());
}

export function isMc2ReactivatedNoShow(reason) {
  return String(reason || '').trim().toLowerCase() === MC2_REACTIVATED_NO_SHOW_REASON;
}

export function isWebinarBuyerStatus(row = {}) {
  const status = String(row.statut || row.status || '').trim().toLowerCase();
  const paymentStatus = String(row.payment_status || '').trim().toLowerCase();
  return status === 'acheteur'
    || status === 'purchased'
    || row.purchased === true
    || Boolean(row.purchased_at)
    || ['paid', 'succeeded', 'active', 'complete', 'completed'].includes(paymentStatus);
}

async function saveWebinarExclusion(email, raison, replaceExisting = false) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { ok: false, status: 400, error: 'Email invalide' };
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) return { ok: false, status: 500, error: 'Supabase non configuré' };

  const response = await fetch(
    `${url}/rest/v1/webinaire_exclusions?on_conflict=email`,
    {
      method: 'POST',
      headers: supabaseHeaders({
        Prefer: `resolution=${replaceExisting ? 'merge' : 'ignore'}-duplicates,return=minimal`,
      }),
      body: JSON.stringify({
        email: normalizedEmail,
        raison: String(raison || 'participant_webinaire').trim(),
      }),
    },
  );

  return {
    ok: response.ok,
    status: response.status,
    error: response.ok ? null : await response.text(),
  };
}

export async function excludeWebinarAttendee(email, raison) {
  return saveWebinarExclusion(email, raison, false);
}

export async function excludeWebinarBuyer(email, raison = 'acheteur_es') {
  return saveWebinarExclusion(email, raison, true);
}

export async function replaceWebinarExclusion(email, raison) {
  return saveWebinarExclusion(email, raison, true);
}
