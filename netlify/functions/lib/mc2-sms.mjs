import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';

const MAX_ATTEMPTS = 3;
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

function checkoutUrl(liveCode) {
  const origin = clean(process.env.MC2_PUBLIC_ORIGIN || 'https://sonnycourt.com', 240).replace(/\/$/, '');
  const code = clean(liveCode, 5);
  return code ? `${origin}/commencer/${code}` : '';
}

export function mc2SmsMessage(type, token, options = {}) {
  if (type === 'session_live') {
    return `ON EST LIVE !\nRejoins-nous maintenant ici :\n${liveUrl(options.liveCode, token)}`;
  }
  if (type === 'offer_deadline') {
    return `DERNIERE CHANCE !\nIl ne te reste plus que 15 minutes pour t'inscrire à Esprit Subconscient 2.0\nClique ici :\n${checkoutUrl(options.liveCode)}`;
  }
  return '';
}

async function findMc2LiveCode(token) {
  const safeToken = clean(token, 128);
  if (!safeToken) return '';
  const result = await supabaseGet(
    `mc2_sms_jobs?token=eq.${encodeURIComponent(safeToken)}&message_type=eq.session_live&live_code=not.is.null&select=live_code&order=created_at.desc&limit=1`,
  );
  const code = result.ok && Array.isArray(result.data) ? clean(result.data[0]?.live_code, 5) : '';
  return /^[A-Za-z0-9]{5}$/.test(code) ? code : '';
}

async function ensureMc2LiveCode(job) {
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
    if (updated.status !== 409) break;
  }
  return '';
}

export async function sendGatewaySms({ phone, message, reference }) {
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

async function skipJob(job, reason) {
  await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
    status: 'skipped',
    skip_reason: clean(reason, 160),
  });
  return { status: 'skipped', reason };
}

export async function processMc2SmsJob(job, now = new Date()) {
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

  const registrationResult = await supabaseGet(
    `mc2_registrations?token=eq.${encodeURIComponent(job.token)}&select=token,telephone,pays,sms_consent_at,statut,payment_status,session_starts_at,offer_expires_at&limit=1`,
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
  }

  const liveCode = job.message_type === 'session_live'
    ? await ensureMc2LiveCode(claimedJob)
    : await findMc2LiveCode(job.token);
  if (!liveCode) {
    await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'retry',
      last_error: 'live_code_unavailable',
    });
    return { status: 'retry' };
  }

  const message = mc2SmsMessage(job.message_type, job.token, { liveCode });
  try {
    const provider = await sendGatewaySms({ phone, message, reference: `mc2-${job.id}` });
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
      page_path: job.message_type === 'session_live' ? '/masterclass/session/' : '/commencer/',
      metadata: { sms_job_id: job.id, provider: 'gatewayapi' },
      dedupe_key: `sms_job_${job.id}_sent`,
    }, { prefer: 'return=minimal' });
    return { status: 'sent' };
  } catch (error) {
    const attempts = Number(claimedJob.attempts || 1);
    await supabasePatch('mc2_sms_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: attempts >= MAX_ATTEMPTS ? 'skipped' : 'retry',
      last_error: clean(error?.message || 'sms_failed', 300),
      skip_reason: attempts >= MAX_ATTEMPTS ? 'max_attempts' : null,
      provider_response: error?.providerResponse || {},
    });
    return { status: attempts >= MAX_ATTEMPTS ? 'failed_final' : 'retry' };
  }
}
