import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import {
  addSubscriberToGroup,
  getMailerLiteSubscriberId,
  removeSubscriberFromGroup,
} from './mailerlite-webinaire.mjs';

const MAX_DELIVERY_ATTEMPTS = 5;
const DUNNING_STAGE_MAX = 6; // Échec initial + cinq reprises Stripe.

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function iso(value) {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function encode(value) {
  return encodeURIComponent(clean(String(value ?? ''), 500));
}

export function mc2DunningEnabled(env = process.env) {
  return clean(env.MC2_DUNNING_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2DunningStage(invoice = {}) {
  const attempt = Math.max(1, Number(invoice.attempt_count || 1));
  return Math.min(DUNNING_STAGE_MAX, Math.floor(attempt));
}

export function mc2NextRetryAt(invoice = {}) {
  return iso(invoice.next_payment_attempt);
}

export function mc2PaymentFailure(paymentIntent = {}, invoice = {}) {
  const error = paymentIntent?.last_payment_error || invoice?.last_payment_error || {};
  return {
    code: clean(error.code || error.type || invoice?.last_finalization_error?.code, 120) || null,
    declineCode: clean(error.decline_code, 120) || null,
    message: clean(error.message || invoice?.last_finalization_error?.message, 500) || null,
    requiresAction: paymentIntent?.status === 'requires_action' || Boolean(error.payment_method?.card?.three_d_secure),
  };
}

export function mc2DunningGroups(env = process.env) {
  const stages = Array.from({ length: DUNNING_STAGE_MAX }, (_, index) => clean(
    env[`MAILERLITE_GROUP_MC2_PAYMENT_FAILED_${index + 1}`]
      || env[`ML_MC2_FAIL_${index + 1}`],
    120,
  ));
  return {
    stages,
    actionRequired: clean(
      env.MAILERLITE_GROUP_MC2_PAYMENT_ACTION_REQUIRED || env.ML_MC2_ACTION,
      120,
    ),
    finalFailed: clean(
      env.MAILERLITE_GROUP_MC2_PAYMENT_FINAL_FAILED || env.ML_MC2_FINAL,
      120,
    ),
  };
}

export function mc2DunningGroupForJob(job, env = process.env) {
  const groups = mc2DunningGroups(env);
  if (job.message_type === 'payment_action_required') return groups.actionRequired;
  if (job.message_type === 'payment_final_failed') return groups.finalFailed;
  if (job.message_type === 'payment_failed') {
    const stage = Math.min(DUNNING_STAGE_MAX, Math.max(1, Number(job.dunning_stage || 1)));
    return groups.stages[stage - 1] || '';
  }
  return '';
}

export async function upsertMc2Recovery(row) {
  const result = await supabasePost(
    'mc2_payment_recoveries?on_conflict=stripe_invoice_id',
    row,
    { prefer: 'resolution=merge-duplicates,return=representation' },
  );
  if (!result.ok) throw new Error(`mc2_recovery_upsert_${result.status}`);
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

export async function queueMc2DunningJob({
  token,
  invoiceId,
  eventId,
  messageType,
  stage = 0,
  dueAt = new Date(),
}) {
  const safeToken = clean(token, 128);
  const safeInvoice = clean(invoiceId, 255);
  const safeType = clean(messageType, 80);
  const safeEvent = clean(eventId, 255);
  const safeStage = Math.floor(Math.min(DUNNING_STAGE_MAX, Math.max(0, Number(stage || 0))));
  if (!safeToken || !safeEvent || ![
    'payment_failed',
    'payment_action_required',
    'payment_final_failed',
    'payment_recovered_cleanup',
  ].includes(safeType)) {
    throw new Error('mc2_dunning_job_invalid');
  }
  // The Stripe event id changes when Stripe emits several updates for the same
  // invoice. The business identity must therefore be invoice + stage, otherwise
  // one retry could trigger the same customer email twice.
  const jobKey = safeType === 'payment_recovered_cleanup'
    ? `${safeType}:${safeInvoice || safeToken}`
    : safeType === 'payment_final_failed'
      ? `${safeType}:${safeInvoice || safeToken}`
      : `${safeType}:${safeInvoice || 'no_invoice'}:${safeStage}`;
  const inserted = await supabasePost('mc2_dunning_jobs', {
    token: safeToken,
    stripe_invoice_id: safeInvoice || null,
    job_key: jobKey,
    message_type: safeType,
    dunning_stage: safeStage,
    due_at: iso(dueAt) || new Date().toISOString(),
  });
  if (inserted.ok) return { ok: true, row: inserted.data?.[0] || null, existing: false };
  if (inserted.status !== 409) throw new Error(`mc2_dunning_job_${inserted.status}`);
  const existing = await supabaseGet(
    `mc2_dunning_jobs?job_key=eq.${encode(jobKey)}&select=*&limit=1`,
  );
  return {
    ok: existing.ok,
    row: existing.ok && Array.isArray(existing.data) ? existing.data[0] || null : null,
    existing: true,
  };
}

export async function cancelMc2DunningJobs({ token, invoiceId, reason = 'payment_recovered' }) {
  const filters = [
    `token=eq.${encode(token)}`,
    'status=in.(pending,retry,processing)',
  ];
  if (invoiceId) filters.push(`stripe_invoice_id=eq.${encode(invoiceId)}`);
  return supabasePatch('mc2_dunning_jobs', filters.join('&'), {
    status: 'cancelled',
    skip_reason: clean(reason, 160),
  });
}

async function skipJob(job, reason) {
  await supabasePatch('mc2_dunning_jobs', `id=eq.${encode(job.id)}`, {
    status: 'skipped',
    skip_reason: clean(reason, 160),
  });
  return { status: 'skipped', reason };
}

function nextDeliveryAttempt(attempts, now) {
  const delaysMinutes = [5, 30, 120, 360];
  const delay = delaysMinutes[Math.min(Math.max(attempts - 1, 0), delaysMinutes.length - 1)];
  return new Date(now.getTime() + delay * 60_000).toISOString();
}

async function cleanupMailerLiteGroups(subscriberId, apiKey, env) {
  const groups = mc2DunningGroups(env);
  const ids = [...new Set([
    ...groups.stages,
    groups.actionRequired,
    groups.finalFailed,
  ].filter(Boolean))];
  const results = await Promise.all(ids.map((groupId) => (
    removeSubscriberFromGroup(subscriberId, groupId, apiKey)
  )));
  return { removed: results.filter(Boolean).length, total: ids.length };
}

export async function processMc2DunningJob(job, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const env = options.env || process.env;
  const claimed = await supabasePatch(
    'mc2_dunning_jobs',
    `id=eq.${encode(job.id)}&status=in.(pending,retry)`,
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
    `mc2_registrations?token=eq.${encode(job.token)}&select=token,email,prenom,payment_status&limit=1`,
  );
  const registration = registrationResult.ok && Array.isArray(registrationResult.data)
    ? registrationResult.data[0]
    : null;
  if (!registration?.email) return skipJob(job, 'registration_or_email_missing');

  if (job.message_type !== 'payment_recovered_cleanup'
    && !['past_due', 'unpaid'].includes(String(registration.payment_status || '').toLowerCase())) {
    return skipJob(job, registration.payment_status === 'paid' ? 'already_recovered' : 'payment_not_collectible');
  }

  try {
    const apiKey = clean(env.MAILERLITE_API_KEY, 1_000);
    if (!apiKey) throw new Error('mailerlite_api_key_missing');
    const subscriberId = await getMailerLiteSubscriberId(registration.email, apiKey);
    if (!subscriberId) throw new Error('mailerlite_subscriber_missing');
    let providerResponse;
    let groupId = null;
    if (job.message_type === 'payment_recovered_cleanup') {
      providerResponse = await cleanupMailerLiteGroups(subscriberId, apiKey, env);
    } else {
      groupId = mc2DunningGroupForJob(job, env);
      if (!groupId) throw new Error(`mailerlite_group_missing:${job.message_type}:${job.dunning_stage}`);
      const groupResult = await addSubscriberToGroup(subscriberId, groupId, apiKey);
      if (!groupResult.assigned && !groupResult.alreadyInGroup) throw new Error('mailerlite_group_assignment_failed');
      providerResponse = groupResult;
    }
    await supabasePatch('mc2_dunning_jobs', `id=eq.${encode(job.id)}`, {
      status: 'sent',
      mailerlite_group_id: groupId,
      mailerlite_subscriber_id: subscriberId,
      provider_response: providerResponse,
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    return { status: 'sent', groupId, subscriberId };
  } catch (error) {
    const attempts = Number(claimedJob.attempts || 1);
    const final = attempts >= MAX_DELIVERY_ATTEMPTS;
    await supabasePatch('mc2_dunning_jobs', `id=eq.${encode(job.id)}`, {
      status: final ? 'skipped' : 'retry',
      due_at: final ? claimedJob.due_at : nextDeliveryAttempt(attempts, now),
      last_error: clean(error?.message || 'mailerlite_failed', 300),
      skip_reason: final ? 'max_delivery_attempts' : null,
    });
    return { status: final ? 'failed_final' : 'retry', error: clean(error?.message, 300) };
  }
}
