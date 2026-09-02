import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import {
  assertMc2SmsCountryDecision,
  evaluateMc2SmsCountry,
  mc2SmsAvoidedCost,
  mc2SmsCountryFilterEnabled,
  resolveMc2SmsCountry,
} from './mc2-sms-country-filter.mjs';

const MAX_ATTEMPTS = 3;
export const MC2_OFFER_SMS_STALE_MS = 10 * 60 * 1000;
const LIVE_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function countryCallingCode(country) {
  const value = clean(country, 80).toLowerCase();
  if (value.includes('france')) return '33';
  if (value.includes('suisse') || value.includes('switzerland')) return '41';
  if (value.includes('belg')) return '32';
  if (value.includes('luxemb')) return '352';
  if (value.includes('canada')) return '1';
  return '';
}

export function normalizeMc2Phone(value, country = '') {
  let raw = clean(value, 40).replace(/[^\d+]/g, '');
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  if (!raw.startsWith('+')) {
    const code = countryCallingCode(country);
    if (!code) return '';
    raw = `+${code}${raw.replace(/^0+/, '')}`;
  }
  const digits = raw.slice(1).replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : '';
}

export function mc2SmsEnabled() {
  return clean(process.env.MC2_SMS_ENABLED, 10).toLowerCase() === 'true';
}

// Indépendant du rappel LIVE : une publication du code ne peut pas activer
// le nouveau message commercial sans validation explicite de sa copie.
export function mc2OfferH1SmsEnabled() {
  return clean(process.env.MC2_OFFER_H1_SMS_ENABLED, 10).toLowerCase() === 'true';
}

export function generateMc2LiveCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => LIVE_CODE_ALPHABET[byte % LIVE_CODE_ALPHABET.length]).join('');
}

export async function queueMc2Sms({ token, messageType, dueAt, discriminator }) {
  const safeToken = clean(token, 128);
  const safeType = clean(messageType, 40);
  const safeDueAt = iso(dueAt);
  const safeDiscriminator = clean(discriminator || safeDueAt, 160);
  if (!safeToken || !safeDueAt || !['session_live', 'offer_deadline'].includes(safeType)) {
    return { ok: false, error: 'invalid_sms_job' };
  }

  const jobKey = `${safeType}:${safeToken}:${safeDiscriminator}`;
  if (safeType === 'session_live') {
    await supabasePatch(
      'mc2_sms_jobs',
      `token=eq.${encodeURIComponent(safeToken)}&message_type=eq.session_live&status=in.(pending,retry,processing)&job_key=neq.${encodeURIComponent(jobKey)}`,
      { status: 'skipped', skip_reason: 'session_rescheduled' },
    );
  }
  const existing = await supabaseGet(
    `mc2_sms_jobs?job_key=eq.${encodeURIComponent(jobKey)}&select=id,status,due_at&limit=1`,
  );
  if (existing.ok && Array.isArray(existing.data) && existing.data[0]) {
    const row = existing.data[0];
    if (row.status === 'sent' || row.status === 'skipped') return { ok: true, row, existing: true };
    const updated = await supabasePatch(
      'mc2_sms_jobs',
      `id=eq.${encodeURIComponent(row.id)}`,
      { due_at: safeDueAt, status: 'pending', last_error: null, skip_reason: null },
    );
    return { ok: updated.ok, row: updated.data?.[0] || row, existing: true, error: updated.error };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inserted = await supabasePost('mc2_sms_jobs', {
      token: safeToken,
      job_key: jobKey,
      message_type: safeType,
      due_at: safeDueAt,
      live_code: safeType === 'session_live' ? generateMc2LiveCode() : null,
    });
    if (inserted.ok) {
      return { ok: true, row: inserted.data?.[0] || null, error: null };
    }
    if (inserted.status !== 409) {
      return { ok: false, row: null, error: inserted.error };
    }
    const concurrent = await supabaseGet(
      `mc2_sms_jobs?job_key=eq.${encodeURIComponent(jobKey)}&select=id,status,due_at,live_code&limit=1`,
    );
    if (concurrent.ok && Array.isArray(concurrent.data) && concurrent.data[0]) {
      return { ok: true, row: concurrent.data[0], existing: true };
    }
  }
  return { ok: false, row: null, error: 'live_code_collision_limit' };
}

export async function cancelMc2OfferSms(token, reason = 'purchase_completed') {
  const safeToken = clean(token, 128);
  if (!safeToken) return { ok: false };
  return supabasePatch(
    'mc2_sms_jobs',
    `token=eq.${encodeURIComponent(safeToken)}&message_type=eq.offer_deadline&status=in.(pending,retry,processing)`,
    { status: 'skipped', skip_reason: clean(reason, 120) || 'cancelled' },
  );
}

function sessionUrl(token) {
  const origin = clean(process.env.MC2_PUBLIC_ORIGIN || 'https://sonnycourt.com', 240).replace(/\/$/, '');
  const path = clean(process.env.MC2_SMS_SESSION_PATH || '/mc2/session/', 120) || '/mc2/session/';
  return `${origin}${path.startsWith('/') ? path : `/${path}`}?t=${encodeURIComponent(token)}`;
}

function liveUrl(liveCode, token) {
  const origin = clean(process.env.MC2_PUBLIC_ORIGIN || 'https://sonnycourt.com', 240).replace(/\/$/, '');
  const code = clean(liveCode, 5);
  return code ? `${origin}/live/${code}` : sessionUrl(token);
}

function offerUrl(liveCode, token) {
  const origin = clean(process.env.MC2_PUBLIC_ORIGIN || 'https://sonnycourt.com', 240).replace(/\/$/, '');
  const code = clean(liveCode, 5);
  return code ? `${origin}/offre/${code}` : sessionUrl(token);
}

export function mc2SmsMessage(type, token, options = {}) {
  if (type === 'session_live') {
    return `ON EST LIVE !\nRejoins-nous maintenant ici :\n${liveUrl(options.liveCode, token)}`;
  }
  if (type === 'offer_deadline') {
    return `DERNIERE CHANCE !\nTon offre Esprit Subconscient 2.0 expire dans 4 heures.\nPrends ta place ici :\n${offerUrl(options.liveCode, token)}`;
  }
  return '';
}

async function findMc2LiveCode(token) {
  const safeToken = clean(token, 128);
  if (!safeToken) return '';
  const result = await supabaseGet(
    `mc2_sms_jobs?token=eq.${encodeURIComponent(safeToken)}&live_code=not.is.null&select=live_code&order=created_at.asc&limit=1`,
  );
  const code = result.ok && Array.isArray(result.data) ? clean(result.data[0]?.live_code, 5) : '';
  return /^[A-Za-z0-9]{5}$/.test(code) ? code : '';
}

async function ensureMc2ShortCode(job) {
  const current = clean(job?.live_code, 5);
  if (/^[A-Za-z0-9]{5}$/.test(current)) return current;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateMc2LiveCode();
    const updated = await supabasePatch(
      'mc2_sms_jobs',
      `id=eq.${encodeURIComponent(job.id)}&live_code=is.null`,
      { live_code: candidate },
    );
    const row = updated.ok && Array.isArray(updated.data) ? updated.data[0] : null;
    if (row?.live_code) return row.live_code;
    if (updated.status !== 409) {
      const concurrent = await supabaseGet(
        `mc2_sms_jobs?id=eq.${encodeURIComponent(job.id)}&select=live_code&limit=1`,
      );
      const code = concurrent.ok && Array.isArray(concurrent.data)
        ? clean(concurrent.data[0]?.live_code, 5)
        : '';
      return /^[A-Za-z0-9]{5}$/.test(code) ? code : '';
    }
  }
  return '';
}

export async function ensureMc2OfferCode(job) {
  const existing = await findMc2LiveCode(job?.token);
  if (existing) return existing;
  const safeToken = clean(job?.token, 128);
  if (!safeToken) return '';
  const liveJobs = await supabaseGet(
    `mc2_sms_jobs?token=eq.${encodeURIComponent(safeToken)}`
      + '&message_type=eq.session_live&select=id,token,live_code&order=created_at.desc&limit=1',
  );
  const liveJob = liveJobs.ok && Array.isArray(liveJobs.data) ? liveJobs.data[0] : null;
  return ensureMc2ShortCode(liveJob?.id ? liveJob : job);
}

export async function sendGatewaySms({ phone, message, reference, countryDecision }) {
  // Garde-fou central : une future utilisation directe de ce helper ne pourra
  // pas contourner le filtre dès que celui-ci sera activé.
  assertMc2SmsCountryDecision(countryDecision);
  const apiToken = clean(process.env.GATEWAYAPI_TOKEN, 1_000);
  const sender = clean(process.env.GATEWAYAPI_SENDER || 'SonnyCourt', 11);
  if (!apiToken) throw new Error('gatewayapi_token_missing');
  if (!phone || !message) throw new Error('gatewayapi_payload_invalid');

  const response = await fetch('https://messaging.gatewayapi.com/mobile/single', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      message,
      recipient: Number(phone.replace(/^\+/, '')),
      reference: clean(reference, 64),
      // Un SMS MC2 devient trompeur s'il arrive après son urgence réelle.
      expiration: 'PT10M',
    }),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 1_000) }; }
  if (!response.ok) {
    const error = new Error(`gatewayapi_${response.status}`);
    error.providerResponse = data;
    throw error;
  }
  return data;
}

function providerMessageId(payload) {
  return clean(
    payload?.id || payload?.message_id || payload?.msg_id || payload?.ids?.[0] || '',
    160,
  ) || null;
}

async function skipJob(job, reason, metadata = null) {
  const patch = {
    status: 'skipped',
    skip_reason: clean(reason, 160),
  };
  if (metadata) patch.provider_response = metadata;
  await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, patch);
  return { status: 'skipped', reason, ...(metadata ? { metadata } : {}) };
}

async function mc2OfferStillEligible(token, now = new Date()) {
  const safeToken = clean(token, 128);
  if (!safeToken) return { eligible: false, reason: 'registration_missing' };
  const result = await supabaseGet(
    `mc2_registrations?token=eq.${encodeURIComponent(safeToken)}`
      + '&select=statut,payment_status,offer_expires_at&limit=1',
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return { eligible: false, reason: 'registration_missing' };
  if (row.statut === 'purchased' || row.payment_status === 'paid') {
    return { eligible: false, reason: 'already_purchased' };
  }
  const expiresAt = new Date(row.offer_expires_at || '').getTime();
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) {
    return { eligible: false, reason: 'offer_expired' };
  }
  return { eligible: true };
}

async function mc2OfferJobStillProcessing(jobId) {
  if (!jobId) return { active: false, error: 'sms_job_missing' };
  const result = await supabaseGet(
    `mc2_sms_jobs?id=eq.${encodeURIComponent(jobId)}&select=status,skip_reason&limit=1`,
  );
  if (!result.ok) return { active: false, error: 'sms_job_lookup_failed' };
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return { active: false, error: 'sms_job_missing' };
  return {
    active: row.status === 'processing',
    reason: clean(row.skip_reason, 160) || 'job_cancelled',
  };
}

export async function processMc2SmsJob(job, now = new Date()) {
  if (job?.message_type === 'offer_deadline' && !mc2OfferH1SmsEnabled()) {
    return skipJob(job, 'offer_h1_sms_disabled');
  }
  const claimed = await supabasePatch(
    'mc2_sms_jobs',
    `id=eq.${encodeURIComponent(job.id)}&status=in.(pending,retry)`,
    {
      status: 'processing',
      attempts: Number(job.attempts || 0) + 1,
      last_attempt_at: now.toISOString(),
      last_error: null,
    },
  );
  const claimedJob = claimed.ok && Array.isArray(claimed.data) ? claimed.data[0] : null;
  if (!claimedJob) return { status: 'not_claimed' };
  if (job.message_type === 'offer_deadline' && claimedJob.provider_status === 'calling') {
    return skipJob(job, 'gateway_attempt_already_started');
  }

  const registrationResult = await supabaseGet(
    `mc2_registrations?token=eq.${encodeURIComponent(job.token)}&select=*&limit=1`,
  );
  const registration = registrationResult.ok && Array.isArray(registrationResult.data)
    ? registrationResult.data[0]
    : null;
  if (!registration) return skipJob(job, 'registration_missing');
  if (!registration.sms_consent_at) return skipJob(job, 'sms_consent_missing');

  const phone = normalizeMc2Phone(registration.telephone, registration.pays);
  if (!phone) return skipJob(job, 'phone_invalid');

  if (job.message_type === 'session_live') {
    const sessionStart = new Date(registration.session_starts_at).getTime();
    if (!Number.isFinite(sessionStart)
      || Math.abs(now.getTime() - sessionStart) > 10 * 60_000) {
      return skipJob(job, 'session_sms_stale');
    }
  }

  if (job.message_type === 'offer_deadline') {
    if (registration.statut === 'purchased' || registration.payment_status === 'paid') {
      return skipJob(job, 'already_purchased');
    }
    const expires = new Date(registration.offer_expires_at).getTime();
    if (!Number.isFinite(expires) || now.getTime() >= expires) return skipJob(job, 'offer_expired');
    const dueAt = new Date(job.due_at).getTime();
    const expectedDueAt = expires - 60 * 60 * 1000;
    if (!Number.isFinite(dueAt) || Math.abs(dueAt - expectedDueAt) > 60 * 1000) {
      return skipJob(job, 'offer_sms_legacy_schedule');
    }
    if (now.getTime() - dueAt > MC2_OFFER_SMS_STALE_MS) {
      return skipJob(job, 'offer_sms_stale');
    }
  }

  let countryDecision = { enforced: false, eligible: true, reasonCode: 'sms_country_filter_disabled' };
  if (mc2SmsCountryFilterEnabled()) {
    const resolvedCountry = await resolveMc2SmsCountry({ registration, phone });
    countryDecision = evaluateMc2SmsCountry({ resolved: resolvedCountry });
    if (!countryDecision.eligible) {
      const previewMessage = mc2SmsMessage(job.message_type, job.token, {
        liveCode: clean(job.live_code, 5) || 'XXXXX',
      });
      const avoided = mc2SmsAvoidedCost(previewMessage);
      const countryFilter = { ...countryDecision, ...avoided };
      await supabasePost('mc2_funnel_events', {
        token: job.token,
        event_name: 'sms_country_filtered',
        event_value: countryDecision.countryCode || 'unknown',
        page_path: '/mc2/session/',
        metadata: { sms_job_id: job.id, message_type: job.message_type, ...countryFilter },
        dedupe_key: `sms_job_${job.id}_country_filtered`,
      }, { prefer: 'return=minimal' });
      return skipJob(job, countryDecision.reasonCode, { country_filter: countryFilter });
    }
  }

  const liveCode = job.message_type === 'session_live'
    ? await ensureMc2ShortCode(claimedJob)
    : await ensureMc2OfferCode(claimedJob);
  if (!liveCode) {
    await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'retry',
      last_error: 'live_code_unavailable',
    });
    return { status: 'retry' };
  }

  const message = mc2SmsMessage(job.message_type, job.token, { liveCode });
  // Une vente peut arriver pendant la résolution du pays ou du lien court.
  // Cette seconde lecture est volontairement placée au dernier instant avant
  // l'appel Gateway afin qu'un achat Spiffy/Stripe coupe aussi cette course.
  if (job.message_type === 'offer_deadline') {
    const eligibility = await mc2OfferStillEligible(job.token, now);
    if (!eligibility.eligible) return skipJob(job, eligibility.reason);
    // Le webhook Spiffy peut annuler le job pendant que ce worker prépare le
    // message. Relire le statut après la vérification achat ferme cette course
    // sans dépendre d'une écriture financière dans mc2_registrations.
    const active = await mc2OfferJobStillProcessing(job.id);
    if (active.error) {
      await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
        status: 'retry',
        last_error: active.error,
      });
      return { status: 'retry' };
    }
    if (!active.active) return { status: 'skipped', reason: active.reason };
    // Marque durablement l'intention AVANT l'appel externe. Si Netlify est
    // interrompu après cette écriture, la reprise refusera un second appel
    // Gateway plutôt que de risquer un doublon.
    const intent = await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      provider_status: 'calling',
    });
    if (!intent.ok) {
      await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
        status: 'retry',
        last_error: 'gateway_attempt_marker_failed',
      });
      return { status: 'retry' };
    }
  }
  try {
    const provider = await sendGatewaySms({
      phone,
      message,
      reference: `mc2-${job.id}`,
      countryDecision,
    });
    await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'sent',
      provider_message_id: providerMessageId(provider),
      provider_status: 'accepted',
      provider_response: provider,
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    await supabasePost('mc2_funnel_events', {
      token: job.token,
      event_name: job.message_type === 'session_live' ? 'sms_live_sent' : 'sms_offer_deadline_sent',
      event_value: phone.slice(-4),
      page_path: '/mc2/session/',
      metadata: {
        sms_job_id: job.id,
        provider: 'gatewayapi',
        country_filter: countryDecision,
      },
      dedupe_key: `sms_job_${job.id}_sent`,
    }, { prefer: 'return=minimal' });
    return { status: 'sent' };
  } catch (error) {
    const attempts = Number(claimedJob.attempts || 1);
    const exhausted = job.message_type === 'offer_deadline' || attempts >= MAX_ATTEMPTS;
    await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: exhausted ? 'skipped' : 'retry',
      last_error: clean(error?.message || 'sms_failed', 300),
      skip_reason: exhausted ? 'max_attempts' : null,
      provider_response: error?.providerResponse || {},
    });
    return { status: exhausted ? 'failed_final' : 'retry' };
  }
}
