import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import { addSubscriberToGroup, getMailerLiteSubscriberId, removeSubscriberFromGroup } from './mailerlite-webinaire.mjs';

const TYPES = new Set(['registration_confirmation', 'session_reminder_1h']);
const MAX_ATTEMPTS = 5;
const clean = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const encode = (value) => encodeURIComponent(clean(value));
const dateOrNull = (value) => {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
};

function localParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: clean(timeZone, 80) || 'UTC', weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
      hour: Number(value('hour')),
      minute: Number(value('minute')),
      label: `${value('weekday')} ${value('day')} ${value('month')} à ${value('hour')}h${value('minute')}`,
    };
  } catch {
    return { hour: NaN, minute: NaN, label: date.toISOString() };
  }
}

export function mc2SessionEmailsEnabled(env = process.env) {
  return clean(env.MC2_SESSION_EMAILS_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2SessionEmailConfig(env = process.env) {
  return {
    publicBaseUrl: clean(env.MC2_PUBLIC_BASE_URL || 'https://sonnycourt.com').replace(/\/$/, ''),
    apiKey: clean(env.MAILERLITE_API_KEY, 1_000),
    groups: {
      registration_confirmation: clean(env.MAILERLITE_GROUP_MC2_CONFIRMATION || env.ML_MC2_CONFIRMATION, 120),
      session_reminder_1h: clean(env.MAILERLITE_GROUP_MC2_SESSION_REMINDER_1H || env.ML_MC2_REMINDER_1H, 120),
    },
  };
}

export function mc2SessionEmailJobs(row = {}, now = new Date()) {
  const start = dateOrNull(row.session_starts_at);
  if (!row.token || !start) return [];
  const token = clean(row.token, 128);
  const session = start.toISOString();
  const jobs = [{
    token,
    job_key: `mc2_session_email:${token}:${session}:registration_confirmation`,
    message_type: 'registration_confirmation', session_starts_at: session, due_at: now.toISOString(),
  }];
  if (clean(row.slot_kind, 20) !== 'scheduled') return jobs;
  const local = localParts(start, row.visitor_timezone);
  if (![11, 20].includes(local.hour) || local.minute !== 0) return jobs;
  const reminderAt = new Date(start.getTime() - 60 * 60_000);
  // Sous 65 minutes, l'email immédiat suffit et évite deux messages simultanés.
  if (reminderAt.getTime() <= now.getTime() + 5 * 60_000) return jobs;
  jobs.push({
    token,
    job_key: `mc2_session_email:${token}:${session}:session_reminder_1h`,
    message_type: 'session_reminder_1h', session_starts_at: session, due_at: reminderAt.toISOString(),
  });
  return jobs;
}

export async function queueMc2SessionEmails(row, now = new Date(), env = process.env) {
  if (!mc2SessionEmailsEnabled(env)) return { ok: true, enabled: false, queued: 0 };
  let queued = 0;
  for (const job of mc2SessionEmailJobs(row, now)) {
    const inserted = await supabasePost('mc2_session_email_jobs', job);
    if (inserted.ok) queued += 1;
    else if (inserted.status !== 409) throw new Error(`mc2_session_email_queue_${inserted.status}`);
  }
  return { ok: true, enabled: true, queued };
}

async function ensureSubscriber(registration, apiKey) {
  const existing = await getMailerLiteSubscriberId(registration.email, apiKey);
  if (existing) return existing;
  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: registration.email,
      fields: { first_name: registration.prenom || '', name: registration.prenom || '' },
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.data?.id) throw new Error(`mailerlite_subscriber_${response.status}`);
  return json.data.id;
}

async function updateSubscriberFields(subscriberId, registration, config) {
  const start = dateOrNull(registration.session_starts_at);
  const local = localParts(start, registration.visitor_timezone);
  const response = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      first_name: registration.prenom || '', name: registration.prenom || '',
      unique_token_webinaire: registration.token,
      mc2_confirmation_url: `${config.publicBaseUrl}/mc2/confirmation/?t=${encodeURIComponent(registration.token)}`,
      mc2_session_url: `${config.publicBaseUrl}/mc2/session/?t=${encodeURIComponent(registration.token)}`,
      mc2_session_starts_at: start.toISOString(), mc2_session_local_label: local.label,
      mc2_session_kind: registration.slot_kind === 'jit' ? 'just-in-time' : 'scheduled',
      mc2_visitor_timezone: registration.visitor_timezone || 'UTC',
    } }),
  });
  if (!response.ok) throw new Error(`mailerlite_fields_${response.status}`);
}

async function loadRegistration(token) {
  const result = await supabaseGet(
    `mc2_registrations?token=eq.${encode(token)}`
      + '&select=token,email,prenom,slot_kind,visitor_timezone,session_starts_at,statut,payment_status,purchased_at&limit=1',
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

function nextAttempt(attempts, now) {
  const minutes = [5, 15, 60, 180][Math.min(Math.max(attempts - 1, 0), 3)];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

async function skipJob(job, reason) {
  await supabasePatch('mc2_session_email_jobs', `id=eq.${encode(job.id)}`, { status: 'skipped', skip_reason: reason });
  return { status: 'skipped', reason };
}

export async function processMc2SessionEmailJob(job, now = new Date(), env = process.env) {
  if (!TYPES.has(job.message_type)) return { status: 'skipped', reason: 'invalid_type' };
  const attempts = Math.max(0, Number(job.attempts) || 0) + 1;
  const claimed = await supabasePatch(
    'mc2_session_email_jobs', `id=eq.${encode(job.id)}&status=in.(pending,retry)`,
    { status: 'processing', attempts, last_attempt_at: now.toISOString(), last_error: null },
  );
  if (!claimed.ok || !Array.isArray(claimed.data) || claimed.data.length !== 1) {
    return { status: 'skipped', reason: 'already_claimed' };
  }
  const registration = await loadRegistration(job.token);
  const currentSession = dateOrNull(registration?.session_starts_at)?.toISOString();
  if (!registration) return skipJob(job, 'registration_missing');
  if (currentSession !== dateOrNull(job.session_starts_at)?.toISOString()) return skipJob(job, 'session_rescheduled');
  const start = new Date(currentSession);
  if (job.message_type === 'session_reminder_1h' ? now >= start : now >= new Date(start.getTime() + 75 * 60_000)) {
    return skipJob(job, 'message_expired');
  }
  if (job.message_type === 'session_reminder_1h') {
    const local = localParts(start, registration.visitor_timezone);
    if (registration.slot_kind !== 'scheduled' || ![11, 20].includes(local.hour) || local.minute !== 0) {
      return skipJob(job, 'not_scheduled_11_or_20');
    }
  }

  try {
    const config = mc2SessionEmailConfig(env);
    const groupId = config.groups[job.message_type];
    if (!config.apiKey) throw new Error('mailerlite_api_key_missing');
    if (!groupId) throw new Error(`mailerlite_group_missing:${job.message_type}`);
    if (!registration.email) throw new Error('registration_email_missing');
    const subscriberId = await ensureSubscriber(registration, config.apiKey);
    await updateSubscriberFields(subscriberId, registration, config);
    // Premier essai : reset du groupe pour un événement MailerLite ponctuel.
    // Retry : aucun reset, donc aucune possibilité de deuxième email.
    if (attempts === 1 && !(await removeSubscriberFromGroup(subscriberId, groupId, config.apiKey))) {
      throw new Error('mailerlite_group_reset_failed');
    }
    const assigned = await addSubscriberToGroup(subscriberId, groupId, config.apiKey);
    if (!assigned.assigned && !assigned.alreadyInGroup) throw new Error('mailerlite_group_assignment_failed');
    const saved = await supabasePatch('mc2_session_email_jobs', `id=eq.${encode(job.id)}`, {
      status: 'delivered', delivered_at: now.toISOString(), mailerlite_group_id: groupId,
      mailerlite_subscriber_id: subscriberId, last_error: null,
    });
    if (!saved.ok) throw new Error(`mc2_session_email_delivered_save_${saved.status}`);
    return { status: 'delivered', messageType: job.message_type };
  } catch (error) {
    const exhausted = attempts >= MAX_ATTEMPTS;
    await supabasePatch('mc2_session_email_jobs', `id=eq.${encode(job.id)}`, {
      status: exhausted ? 'skipped' : 'retry',
      due_at: exhausted ? job.due_at : nextAttempt(attempts, now),
      last_error: clean(error?.message || 'delivery_failed', 300),
      skip_reason: exhausted ? 'delivery_attempts_exhausted' : null,
    });
    return { status: exhausted ? 'skipped' : 'retry', error: clean(error?.message, 300) };
  }
}
