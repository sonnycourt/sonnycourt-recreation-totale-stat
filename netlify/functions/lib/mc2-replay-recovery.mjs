import crypto from 'crypto';
import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import {
  addSubscriberToGroup,
  getMailerLiteSubscriberId,
  removeSubscriberFromGroup,
} from './mailerlite-webinaire.mjs';
import {
  MC2_REPLAY_COUNTDOWN_REMOVED_SECONDS,
  MC2_REPLAY_CTA_SECONDS,
  mc2OfferExpiresAt,
  mc2SessionEndsAt,
} from '../../../src/lib/mc2-timing.mjs';
import { mc2SessionEmailConfig } from './mc2-session-emails.mjs';

const VALID_SEGMENTS = new Set(['no_show', 'left_before_cta', 'offer_seen_no_purchase']);
const INITIAL_MESSAGE_BY_SEGMENT = {
  no_show: 'no_show_initial',
  left_before_cta: 'left_before_cta_initial',
  offer_seen_no_purchase: 'offer_expired_downsell',
};
const REPLAY_REMINDER_TYPES = new Set(['replay_24h', 'replay_4h']);
const VALID_MESSAGE_TYPES = new Set([
  ...Object.values(INITIAL_MESSAGE_BY_SEGMENT),
  ...REPLAY_REMINDER_TYPES,
]);
const ACTIVE_STATUSES = 'pending,retry,processing';
const MAX_DELIVERY_ATTEMPTS = 5;

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function positiveInt(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(max, Math.floor(number))
    : fallback;
}

function dateOrNull(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

function encode(value) {
  return encodeURIComponent(clean(value, 500));
}

export function mc2ReplayRecoveryEnabled(env = process.env) {
  return clean(env.MC2_REPLAY_RECOVERY_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2ReplayRecoveryConfig(env = process.env) {
  const noShowDelay = clean(env.MC2_REPLAY_NO_SHOW_DELAY_MINUTES, 20);
  const beforeCtaDelay = clean(env.MC2_REPLAY_BEFORE_CTA_DELAY_MINUTES ?? '90', 20);
  const offerDelay = clean(env.MC2_OFFER_FOLLOWUP_DELAY_MINUTES ?? '5', 20);
  return {
    // Sans override, le no-show part à 14 h pour une session de 11 h et à
    // 9 h le lendemain pour une session de 20 h (heure du prospect).
    noShowDelayMinutes: noShowDelay === '' ? null : positiveInt(noShowDelay, 0, 14 * 24 * 60),
    beforeCtaDelayMinutes: beforeCtaDelay === '' ? null : positiveInt(beforeCtaDelay, 0, 14 * 24 * 60),
    offerDelayMinutes: offerDelay === '' ? null : positiveInt(offerDelay, 0, 14 * 24 * 60),
    // La vidéo live contient 20 min d'attente que le replay ne contient
    // pas. On retire donc exactement ce décalage au point de reprise.
    liveCountdownSeconds: positiveInt(
      env.MC2_LIVE_COUNTDOWN_SECONDS,
      MC2_REPLAY_COUNTDOWN_REMOVED_SECONDS,
      60 * 60,
    ),
    replayUrl: clean(
      env.MC2_REPLAY_VIDEO_URL
        || 'https://vz-601d6eb4-a9a.b-cdn.net/4b25a40b-d993-45b5-a896-e374629db914/playlist.m3u8',
      2_000,
    ),
    replayCtaSeconds: positiveInt(env.MC2_REPLAY_CTA_SECONDS, MC2_REPLAY_CTA_SECONDS, 24 * 60 * 60),
    publicBaseUrl: clean(env.MC2_PUBLIC_BASE_URL || 'https://sonnycourt.com', 500).replace(/\/$/, ''),
    groups: {
      no_show: clean(env.MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW || env.ML_MC2_REPLAY_NO_SHOW, 120),
      left_before_cta: clean(env.MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA || env.ML_MC2_REPLAY_BEFORE_CTA, 120),
      offer_seen_no_purchase: clean(env.MAILERLITE_GROUP_MC2_OFFER_SEEN || env.ML_MC2_OFFER_SEEN, 120),
      no_show_initial: clean(env.MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW || env.ML_MC2_REPLAY_NO_SHOW, 120),
      left_before_cta_initial: clean(env.MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA || env.ML_MC2_REPLAY_BEFORE_CTA, 120),
      offer_expired_downsell: clean(env.MAILERLITE_GROUP_MC2_OFFER_SEEN || env.ML_MC2_OFFER_SEEN, 120),
      replay_24h: clean(env.MAILERLITE_GROUP_MC2_REPLAY_24H, 120),
      replay_4h: clean(env.MAILERLITE_GROUP_MC2_REPLAY_4H, 120),
    },
  };
}

export function mc2RecoveryInitialMessageType(segment) {
  return INITIAL_MESSAGE_BY_SEGMENT[segment] || null;
}

function localSessionHour(row = {}) {
  const start = dateOrNull(row.session_starts_at);
  if (!start) return NaN;
  try {
    return Number(new Intl.DateTimeFormat('fr-FR', {
      timeZone: clean(row.visitor_timezone, 80) || 'UTC',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(start).find((part) => part.type === 'hour')?.value);
  } catch {
    return NaN;
  }
}

function noShowDelayMinutes(row, config) {
  if (config.noShowDelayMinutes != null) return config.noShowDelayMinutes;
  return localSessionHour(row) === 20 ? 13 * 60 : 3 * 60;
}

export function mc2RecoveryMessageTypes(row = {}, segment = mc2RecoverySegment(row)) {
  if (!VALID_SEGMENTS.has(segment) || isMc2Purchased(row)) return [];
  const types = [mc2RecoveryInitialMessageType(segment)].filter(Boolean);
  if (segment !== 'offer_seen_no_purchase' && dateOrNull(row.offer_expires_at)) {
    types.push('replay_24h', 'replay_4h');
  }
  return types;
}

export function isMc2Purchased(row = {}) {
  const status = clean(row.statut, 40).toLowerCase();
  const paymentStatus = clean(row.payment_status, 40).toLowerCase();
  return status === 'purchased'
    || Boolean(row.purchased_at)
    || ['paid', 'succeeded', 'active', 'complete', 'completed'].includes(paymentStatus);
}

export function mc2RecoverySegment(row = {}) {
  if (isMc2Purchased(row)) return null;
  if (row.saw_offer === true) return 'offer_seen_no_purchase';
  if (row.attended_live === true) return 'left_before_cta';
  return 'no_show';
}

export function mc2RecoveryDueAt(
  row = {},
  segment,
  env = process.env,
  messageType = mc2RecoveryInitialMessageType(segment),
) {
  const config = mc2ReplayRecoveryConfig(env);
  const start = dateOrNull(row.session_starts_at);
  // Recalcul depuis le début pour neutraliser les anciennes lignes enregistrées
  // à +75 minutes, qui feraient partir le replay avant la fin de la vidéo live.
  const end = mc2SessionEndsAt(start);
  if (!start || !VALID_SEGMENTS.has(segment) || !VALID_MESSAGE_TYPES.has(messageType)) return null;
  if (messageType === 'replay_24h' || messageType === 'replay_4h') {
    const offerExpires = dateOrNull(row.offer_expires_at);
    if (!offerExpires) return null;
    const hours = messageType === 'replay_24h' ? 24 : 4;
    return new Date(offerExpires.getTime() - hours * 60 * 60_000);
  }
  if (messageType === 'no_show_initial' && segment === 'no_show') {
    return new Date(start.getTime() + noShowDelayMinutes(row, config) * 60_000);
  }
  if (messageType === 'left_before_cta_initial' && segment === 'left_before_cta' && config.beforeCtaDelayMinutes != null) {
    // Une personne partie en cours de route est relancée à partir de sa
    // dernière présence réelle, et non arbitrairement à la fin du webinaire.
    // Les anciennes inscriptions sans présence enregistrée gardent le fallback
    // historique sur la fin de session.
    const abandonmentAnchor = dateOrNull(row.last_presence_at) || end;
    return new Date(abandonmentAnchor.getTime() + config.beforeCtaDelayMinutes * 60_000);
  }
  if (messageType === 'offer_expired_downsell' && segment === 'offer_seen_no_purchase' && config.offerDelayMinutes != null) {
    const offerExpires = dateOrNull(row.offer_expires_at);
    if (!offerExpires) return null;
    return new Date(offerExpires.getTime() + config.offerDelayMinutes * 60_000);
  }
  return null;
}

export function mc2RecoveryResumeSeconds(row = {}, segment, env = process.env) {
  if (segment !== 'left_before_cta') return 0;
  const watched = positiveInt(row.watch_max_seconds_live, 0, 24 * 60 * 60);
  return Math.max(0, watched - mc2ReplayRecoveryConfig(env).liveCountdownSeconds);
}

export function mc2RecoveryJobKey(
  row = {},
  segment,
  messageType = mc2RecoveryInitialMessageType(segment),
) {
  const session = dateOrNull(row.session_starts_at)?.toISOString() || 'unknown';
  const discriminator = messageType === mc2RecoveryInitialMessageType(segment) ? segment : messageType;
  return `mc2_recovery:${clean(row.token, 128)}:${session}:${discriminator}`;
}

export async function queueMc2ReplayRecovery(
  row,
  segment,
  env = process.env,
  messageType = mc2RecoveryInitialMessageType(segment),
) {
  if (!row?.token || !VALID_SEGMENTS.has(segment) || !VALID_MESSAGE_TYPES.has(messageType) || isMc2Purchased(row)) {
    return { ok: false, skipped: 'ineligible' };
  }
  const dueAt = mc2RecoveryDueAt(row, segment, env, messageType);
  if (!dueAt) return { ok: false, skipped: 'timing_not_configured' };
  const body = {
    token: clean(row.token, 128),
    job_key: mc2RecoveryJobKey(row, segment, messageType),
    session_starts_at: dateOrNull(row.session_starts_at)?.toISOString(),
    segment,
    message_type: messageType,
    due_at: dueAt.toISOString(),
    resume_seconds: mc2RecoveryResumeSeconds(row, segment, env),
  };
  const inserted = await supabasePost('mc2_replay_recovery_jobs', body);
  if (inserted.ok) return { ok: true, created: true, row: inserted.data?.[0] || null };
  if (inserted.status !== 409) throw new Error(`mc2_replay_queue_${inserted.status}`);
  return { ok: true, created: false };
}

export async function queueMc2ReplayRecoverySequence(row, env = process.env) {
  const segment = mc2RecoverySegment(row);
  const results = [];
  for (const messageType of mc2RecoveryMessageTypes(row, segment)) {
    results.push({ messageType, ...(await queueMc2ReplayRecovery(row, segment, env, messageType)) });
  }
  return results;
}

export async function cancelMc2ReplayRecoveryJobs({ token, email, reason = 'purchase_completed', env = process.env }) {
  const safeToken = clean(token, 128);
  if (!safeToken) return { ok: false, error: 'token_missing' };
  const jobs = await supabaseGet(
    `mc2_replay_recovery_jobs?token=eq.${encode(safeToken)}&select=id,status,mailerlite_group_id,mailerlite_subscriber_id`,
  );
  const result = await supabasePatch(
    'mc2_replay_recovery_jobs',
    `token=eq.${encode(safeToken)}&status=in.(${ACTIVE_STATUSES},delivered)`,
    { status: 'cancelled', skip_reason: clean(reason, 160) },
  );
  const sessionEmailJobs = await supabaseGet(
    `mc2_session_email_jobs?token=eq.${encode(safeToken)}&select=id,status,mailerlite_group_id,mailerlite_subscriber_id`,
  );
  await supabasePatch(
    'mc2_session_email_jobs',
    `token=eq.${encode(safeToken)}&status=in.(${ACTIVE_STATUSES})`,
    { status: 'cancelled', skip_reason: clean(reason, 160) },
  );
  // Retire aussi les groupes déclencheurs pour éviter qu'une automation
  // MailerLite encore en attente ne relance un acheteur.
  const apiKey = clean(env.MAILERLITE_API_KEY, 1_000);
  const safeEmail = clean(email, 320).toLowerCase();
  if (apiKey && safeEmail) {
    const subscriberId = await getMailerLiteSubscriberId(safeEmail, apiKey);
    if (subscriberId) {
      const groups = [...new Set([
        ...Object.values(mc2ReplayRecoveryConfig(env).groups),
        ...Object.entries(mc2SessionEmailConfig(env).groups)
          .filter(([messageType]) => messageType.startsWith('offer_'))
          .map(([, groupId]) => groupId),
      ].filter(Boolean))];
      await Promise.allSettled(groups.map((groupId) => removeSubscriberFromGroup(subscriberId, groupId, apiKey)));
    }
  }
  // Le groupe mémorisé par chaque job livré reste la source de secours si les
  // variables ont changé entre l'envoi et l'achat.
  if (apiKey && jobs.ok && Array.isArray(jobs.data)) {
    const delivered = jobs.data.filter((item) => item.mailerlite_group_id && item.mailerlite_subscriber_id);
    await Promise.allSettled(delivered.map((item) => removeSubscriberFromGroup(
      item.mailerlite_subscriber_id,
      item.mailerlite_group_id,
      apiKey,
    )));
  }
  if (apiKey && sessionEmailJobs.ok && Array.isArray(sessionEmailJobs.data)) {
    const delivered = sessionEmailJobs.data.filter((item) => item.mailerlite_group_id && item.mailerlite_subscriber_id);
    await Promise.allSettled(delivered.map((item) => removeSubscriberFromGroup(
      item.mailerlite_subscriber_id,
      item.mailerlite_group_id,
      apiKey,
    )));
  }
  return result;
}

async function loadRegistration(token) {
  const result = await supabaseGet(
    `mc2_registrations?token=eq.${encode(token)}&select=token,email,prenom,telephone,pays,traffic_source,meta_fbc,meta_fbp,optin_variant,visitor_timezone,session_starts_at,session_ends_at,offer_expires_at,attended_live,saw_offer,watch_max_seconds_live,watch_max_seconds_replay,last_presence_at,statut,payment_status,purchased_at&limit=1`,
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function skipJob(job, reason) {
  const skipped = await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encode(job.id)}`, {
    status: reason === 'purchased' ? 'cancelled' : 'skipped',
    skip_reason: clean(reason, 160),
  });
  if (!skipped.ok) throw new Error(`mc2_replay_skip_save_${skipped.status}`);
  return { status: reason === 'purchased' ? 'cancelled' : 'skipped', reason };
}

async function rescheduleJob(job, dueAt, previousAttempts) {
  const saved = await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encode(job.id)}`, {
    status: 'pending',
    due_at: dueAt.toISOString(),
    attempts: previousAttempts,
    last_attempt_at: null,
    last_error: null,
  });
  if (!saved.ok) throw new Error(`mc2_replay_reschedule_save_${saved.status}`);
  return { status: 'rescheduled', dueAt: dueAt.toISOString() };
}

function nextDeliveryAttempt(attempts, now) {
  const delaysMinutes = [5, 30, 120, 360];
  const delay = delaysMinutes[Math.min(Math.max(attempts - 1, 0), delaysMinutes.length - 1)];
  return new Date(now.getTime() + delay * 60_000).toISOString();
}

async function updateMailerLiteFields(subscriberId, fields, apiKey) {
  const response = await fetch(`https://connect.mailerlite.com/api/subscribers/${subscriberId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`mailerlite_fields_${response.status}`);
}

async function ensureMailerLiteSubscriber(registration, apiKey) {
  const existingId = await getMailerLiteSubscriberId(registration.email, apiKey);
  if (existingId) return existingId;
  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    // Aucun groupe ni automation historique. Le seul déclencheur est ajouté
    // plus bas, une fois le segment revalidé et uniquement avec le flag actif.
    body: JSON.stringify({
      email: registration.email,
      fields: {
        first_name: registration.prenom || '',
        name: registration.prenom || '',
      },
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.data?.id) throw new Error(`mailerlite_subscriber_${response.status}`);
  return json.data.id;
}

export async function processMc2ReplayRecoveryJob(job, now = new Date(), env = process.env) {
  const messageType = clean(job.message_type, 80) || mc2RecoveryInitialMessageType(job.segment);
  if (!VALID_MESSAGE_TYPES.has(messageType)) return { status: 'skipped', reason: 'invalid_message_type' };
  const attempts = positiveInt(job.attempts, 0, MAX_DELIVERY_ATTEMPTS) + 1;
  const claimed = await supabasePatch(
    'mc2_replay_recovery_jobs',
    `id=eq.${encode(job.id)}&status=in.(pending,retry)`,
    { status: 'processing', attempts, last_attempt_at: now.toISOString(), last_error: null },
  );
  if (!claimed.ok || !Array.isArray(claimed.data) || claimed.data.length !== 1) {
    return { status: 'skipped', reason: 'already_claimed' };
  }

  const registration = await loadRegistration(job.token);
  if (!registration) return skipJob(job, 'registration_missing');
  if (isMc2Purchased(registration)) return skipJob(job, 'purchased');
  if (dateOrNull(job.session_starts_at)?.toISOString() !== dateOrNull(registration.session_starts_at)?.toISOString()) {
    return skipJob(job, 'session_rescheduled');
  }
  const liveSegment = mc2RecoverySegment(registration);
  const segmentStillEligible = REPLAY_REMINDER_TYPES.has(messageType)
    ? liveSegment === 'no_show' || liveSegment === 'left_before_cta'
    : liveSegment === job.segment;
  if (!segmentStillEligible) return skipJob(job, `segment_changed:${liveSegment || 'none'}`);
  const canonicalDueAt = mc2RecoveryDueAt(registration, liveSegment, env, messageType);
  if (!canonicalDueAt) return skipJob(job, 'timing_not_configured');
  if (canonicalDueAt && now < canonicalDueAt) {
    // Corrige aussi les jobs déjà créés avec l'ancien session_ends_at à +75 min.
    const rescheduled = await rescheduleJob(job, canonicalDueAt, Math.max(0, attempts - 1));
    return messageType === 'left_before_cta_initial'
      ? { ...rescheduled, reason: 'viewer_still_active' }
      : rescheduled;
  }

  try {
    const config = mc2ReplayRecoveryConfig(env);
    const deliverySegment = REPLAY_REMINDER_TYPES.has(messageType) ? liveSegment : job.segment;
    // Le job initial peut avoir été créé pendant que la personne regardait
    // encore. On recalcule donc son échéance avec la dernière présence connue
    // juste avant l'envoi, afin de garantir 90 minutes de vraie absence.
    if (messageType === 'left_before_cta_initial') {
      const refreshedDueAt = mc2RecoveryDueAt(registration, job.segment, env, messageType);
      if (refreshedDueAt && refreshedDueAt.getTime() > now.getTime()) {
        const rescheduled = await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encode(job.id)}`, {
          status: 'pending',
          attempts: positiveInt(job.attempts, 0, MAX_DELIVERY_ATTEMPTS),
          due_at: refreshedDueAt.toISOString(),
          last_attempt_at: null,
          last_error: null,
        });
        if (!rescheduled.ok) throw new Error(`mc2_replay_reschedule_${rescheduled.status}`);
        return { status: 'rescheduled', reason: 'viewer_still_active', dueAt: refreshedDueAt.toISOString() };
      }
    }
    const apiKey = clean(env.MAILERLITE_API_KEY, 1_000);
    const groupId = config.groups[messageType] || config.groups[job.segment];
    if (!apiKey) throw new Error('mailerlite_api_key_missing');
    if (!groupId) throw new Error(`mailerlite_group_missing:${messageType}`);
    if (!registration.email) throw new Error('registration_email_missing');

    const subscriberId = await ensureMailerLiteSubscriber(registration, apiKey);
    const accessCode = clean(job.access_code, 128) || crypto.randomBytes(24).toString('base64url');
    const hasReplay = messageType !== 'offer_expired_downsell';
    const offerExpiresAt = dateOrNull(registration.offer_expires_at)
      || mc2OfferExpiresAt(registration.session_starts_at);
    if (hasReplay && (!offerExpiresAt || now >= offerExpiresAt)) return skipJob(job, 'offer_expired');
    const replayUrl = hasReplay
      ? `${config.publicBaseUrl}/mc2/replay/?access=${encodeURIComponent(accessCode)}`
      : '';
    const offerUrl = `${config.publicBaseUrl}/mc2/session/?t=${encodeURIComponent(registration.token)}`;
    // Les liens de replay partagent l'échéance commerciale canonique.
    const expiresAt = offerExpiresAt || now;

    const accessSaved = await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encode(job.id)}`, {
      access_code: accessCode,
      access_starts_at: now.toISOString(),
      access_expires_at: expiresAt.toISOString(),
      resume_seconds: mc2RecoveryResumeSeconds(registration, deliverySegment, env),
    });
    if (!accessSaved.ok) throw new Error(`mc2_replay_access_save_${accessSaved.status}`);
    await updateMailerLiteFields(subscriberId, {
      mc2_recovery_segment: deliverySegment,
      mc2_replay_url: replayUrl,
      mc2_replay_expires_at: expiresAt.toISOString(),
      mc2_offer_url: offerUrl,
      mc2_replay_resume_seconds: String(mc2RecoveryResumeSeconds(registration, deliverySegment, env)),
    }, apiKey);
    // Les groupes sont des déclencheurs ponctuels. Au premier essai du job, on
    // force un nouvel événement même si ce contact a déjà traversé ce segment.
    // Aux retries, on ne retire plus le groupe : si l'ajout précédent a déjà
    // déclenché MailerLite, le 422 « déjà membre » empêche un doublon.
    if (attempts === 1) {
      const removed = await removeSubscriberFromGroup(subscriberId, groupId, apiKey);
      if (!removed) throw new Error('mailerlite_group_reset_failed');
    }
    const assigned = await addSubscriberToGroup(subscriberId, groupId, apiKey);
    if (!assigned.assigned && !assigned.alreadyInGroup) throw new Error('mailerlite_group_assignment_failed');

    const delivered = await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encode(job.id)}`, {
      status: 'delivered',
      delivered_at: now.toISOString(),
      mailerlite_group_id: groupId,
      mailerlite_subscriber_id: subscriberId,
      last_error: null,
    });
    if (!delivered.ok) {
      // Ne surtout pas retirer le groupe : le retry verra « déjà membre » et
      // pourra réparer Supabase sans déclencher une seconde communication.
      throw new Error(`mc2_replay_delivered_save_${delivered.status}`);
    }
    return { status: 'delivered', segment: job.segment, messageType };
  } catch (error) {
    const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
    await supabasePatch('mc2_replay_recovery_jobs', `id=eq.${encode(job.id)}`, {
      status: exhausted ? 'skipped' : 'retry',
      due_at: exhausted ? job.due_at : nextDeliveryAttempt(attempts, now),
      last_error: clean(error?.message || 'delivery_failed', 300),
      skip_reason: exhausted ? 'delivery_attempts_exhausted' : null,
    });
    return { status: exhausted ? 'skipped' : 'retry', error: clean(error?.message, 300) };
  }
}

export async function loadMc2RecoveryAccess(accessCode, now = new Date()) {
  const safeCode = clean(accessCode, 128);
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(safeCode)) return { ok: false, reason: 'invalid' };
  const result = await supabaseGet(
    `mc2_replay_recovery_jobs?access_code=eq.${encode(safeCode)}&select=*&limit=1`,
  );
  const job = result.ok && Array.isArray(result.data) ? result.data[0] || null : null;
  if (!job || job.status !== 'delivered') return { ok: false, reason: 'invalid' };
  const starts = dateOrNull(job.access_starts_at);
  const expires = dateOrNull(job.access_expires_at);
  if (!starts || !expires) return { ok: false, reason: 'invalid' };
  if (now < starts) return { ok: false, reason: 'not_started' };
  if (now >= expires) return { ok: false, reason: 'expired' };
  const registration = await loadRegistration(job.token);
  if (!registration) return { ok: false, reason: 'invalid' };
  if (isMc2Purchased(registration)) return { ok: false, reason: 'purchased' };
  return { ok: true, job, registration, starts, expires };
}

export async function loadMc2ReplayAccess(accessCode, now = new Date()) {
  const result = await loadMc2RecoveryAccess(accessCode, now);
  if (!result.ok) return result;
  if (result.job.segment === 'offer_seen_no_purchase') return { ok: false, reason: 'not_replay' };
  return result;
}
