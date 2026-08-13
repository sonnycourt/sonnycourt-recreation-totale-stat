import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';

const CIRCLE_API_BASE = 'https://app.circle.so/api/admin/v2';
const CIRCLE_TAG_NAME = 'ES 2.0 (AVANCÉ)';
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizedEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function records(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function circleMember(payload) {
  return payload?.community_member || payload?.data?.community_member || payload?.data || payload || null;
}

function memberHasTag(member, tagId, tagName = CIRCLE_TAG_NAME) {
  return Array.isArray(member?.member_tags) && member.member_tags.some((tag) => (
    positiveInteger(tag?.id) === tagId || clean(tag?.name, 160) === tagName
  ));
}

function providerError(error) {
  return {
    code: clean(error?.code || 'circle_error', 100),
    status: Number(error?.status || 0) || null,
    message: clean(error?.message || 'Circle indisponible', 500),
  };
}

function nextRetryAt(attempts, now) {
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];
  return new Date(now.getTime() + delay).toISOString();
}

export function mc2CircleEnabled(env = process.env) {
  return clean(env.MC2_CIRCLE_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2CircleReadiness(env = process.env) {
  const tagName = clean(env.MC2_CIRCLE_MEMBER_TAG_NAME || CIRCLE_TAG_NAME, 160);
  const host = clean(env.CIRCLE_COMMUNITY_HOST || 'volt.sonnycourt.com', 240)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  return {
    enabled: mc2CircleEnabled(env),
    token: Boolean(clean(env.CIRCLE_ADMIN_API_TOKEN, 2_000)),
    host: Boolean(host),
    tag_exact: tagName === CIRCLE_TAG_NAME,
    ready: mc2CircleEnabled(env)
      && Boolean(clean(env.CIRCLE_ADMIN_API_TOKEN, 2_000))
      && Boolean(host)
      && tagName === CIRCLE_TAG_NAME,
  };
}

async function circleRequest(path, options = {}, env = process.env) {
  const token = clean(env.CIRCLE_ADMIN_API_TOKEN, 2_000);
  const tagName = clean(env.MC2_CIRCLE_MEMBER_TAG_NAME || CIRCLE_TAG_NAME, 160);
  if (!token) throw Object.assign(new Error('circle_token_missing'), { code: 'circle_token_missing' });
  if (tagName !== CIRCLE_TAG_NAME) {
    throw Object.assign(new Error('circle_tag_name_mismatch'), { code: 'circle_tag_name_mismatch' });
  }

  const base = clean(env.CIRCLE_ADMIN_API_BASE || CIRCLE_API_BASE, 500).replace(/\/$/, '');
  const response = await fetch(`${base}/${String(path).replace(/^\//, '')}`, {
    ...options,
    headers: {
      // Circle Admin API v2 requires the standard Bearer scheme. The token
      // itself identifies the community; overriding the HTTP Host header would
      // route the request away from Circle's documented API host.
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 1_000) }; }
  if (!response.ok) {
    const message = clean(data?.message || data?.error || data?.errors || `circle_http_${response.status}`, 500);
    const error = Object.assign(new Error(message || `circle_http_${response.status}`), {
      code: `circle_http_${response.status}`,
      status: response.status,
      providerResponse: data,
    });
    throw error;
  }
  return data;
}

export async function findCircleMember(email, options = {}) {
  const safeEmail = normalizedEmail(email);
  if (!safeEmail) throw Object.assign(new Error('circle_email_invalid'), { code: 'circle_email_invalid' });
  let payload;
  try {
    payload = await circleRequest(
      `community_members/search?email=${encodeURIComponent(safeEmail)}`,
      { method: 'GET' },
      options.env,
    );
  } catch (error) {
    // Circle documents 404 as the normal "no community member for this email"
    // outcome. Only that response authorizes the subsequent invite.
    if (Number(error?.status) === 404) return null;
    throw error;
  }
  const direct = circleMember(payload);
  if (positiveInteger(direct?.id) && normalizedEmail(direct?.email) === safeEmail) return direct;
  return records(payload).find((member) => normalizedEmail(member?.email) === safeEmail) || null;
}

export async function findCircleTag(options = {}) {
  const payload = await circleRequest('member_tags?page=1&per_page=100', { method: 'GET' }, options.env);
  const matches = records(payload).filter((tag) => clean(tag?.name, 160) === CIRCLE_TAG_NAME);
  if (matches.length !== 1) {
    const errorCode = matches.length ? 'circle_tag_ambiguous' : 'circle_tag_missing';
    throw Object.assign(new Error(errorCode), { code: errorCode });
  }
  return matches[0];
}

export async function inviteCircleMember({ email, name }, options = {}) {
  const payload = await circleRequest('community_members', {
    method: 'POST',
    body: JSON.stringify({
      email: normalizedEmail(email),
      name: clean(name, 200) || undefined,
      skip_invitation: false,
    }),
  }, options.env);
  const member = circleMember(payload);
  if (!positiveInteger(member?.id)) {
    throw Object.assign(new Error('circle_member_create_invalid'), { code: 'circle_member_create_invalid' });
  }
  return member;
}

export async function addCircleMemberTag({ email, tagId }, options = {}) {
  return circleRequest('tagged_members', {
    method: 'POST',
    body: JSON.stringify({
      user_email: normalizedEmail(email),
      member_tag_id: positiveInteger(tagId),
    }),
  }, options.env);
}

export async function queueMc2CircleOnboarding({ token, email, name, stripeEventId }) {
  const safeToken = clean(token, 128);
  const safeEmail = normalizedEmail(email);
  if (!safeToken || !safeEmail) return { ok: false, error: 'circle_job_invalid' };
  const jobKey = `circle_mc2_advanced:${safeToken}`;
  const existing = await supabaseGet(
    `mc2_circle_onboarding_jobs?job_key=eq.${encodeURIComponent(jobKey)}&select=*&limit=1`,
  );
  if (existing.ok && Array.isArray(existing.data) && existing.data[0]) {
    return { ok: true, existing: true, row: existing.data[0] };
  }
  const inserted = await supabasePost('mc2_circle_onboarding_jobs', {
    token: safeToken,
    job_key: jobKey,
    email: safeEmail,
    member_name: clean(name, 200) || null,
    member_tag_name: CIRCLE_TAG_NAME,
    stripe_event_id: clean(stripeEventId, 255) || null,
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
  });
  if (inserted.ok) return { ok: true, existing: false, row: inserted.data?.[0] || null };
  if (inserted.status === 409) {
    const concurrent = await supabaseGet(
      `mc2_circle_onboarding_jobs?job_key=eq.${encodeURIComponent(jobKey)}&select=*&limit=1`,
    );
    if (concurrent.ok && Array.isArray(concurrent.data) && concurrent.data[0]) {
      return { ok: true, existing: true, row: concurrent.data[0] };
    }
  }
  return { ok: false, error: inserted.error || `circle_job_${inserted.status}` };
}

async function patchJob(jobId, body) {
  return supabasePatch('mc2_circle_onboarding_jobs', `id=eq.${encodeURIComponent(jobId)}`, body);
}

export async function processMc2CircleOnboardingJob(job, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const attempts = Number(job.attempts || 0) + 1;
  const claimed = await supabasePatch(
    'mc2_circle_onboarding_jobs',
    `id=eq.${encodeURIComponent(job.id)}&status=in.(pending,retry)`,
    {
      status: 'processing',
      attempts,
      last_attempt_at: now.toISOString(),
      last_error: null,
    },
  );
  const claimedJob = claimed.ok && Array.isArray(claimed.data) ? claimed.data[0] : null;
  if (!claimedJob) return { status: 'not_claimed' };

  const readiness = mc2CircleReadiness(options.env);
  if (!readiness.ready) {
    const failure = { code: 'circle_not_configured', readiness };
    await patchJob(job.id, {
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'retry',
      next_attempt_at: attempts >= MAX_ATTEMPTS ? null : nextRetryAt(attempts, now),
      last_error: 'circle_not_configured',
      provider_response: failure,
    });
    return { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'retry', reason: 'circle_not_configured' };
  }

  try {
    const tag = await findCircleTag({ env: options.env });
    const tagId = positiveInteger(tag?.id);
    if (!tagId) throw Object.assign(new Error('circle_tag_id_invalid'), { code: 'circle_tag_id_invalid' });

    let member = await findCircleMember(claimedJob.email, { env: options.env });
    let memberCreated = false;
    if (!member) {
      member = await inviteCircleMember({ email: claimedJob.email, name: claimedJob.member_name }, { env: options.env });
      memberCreated = true;
      // Persist this irreversible provider-side step immediately. If the worker
      // crashes before tagging, a retry searches Circle and never re-invites.
      await patchJob(job.id, {
        circle_member_id: String(member.id),
        member_created: true,
        provider_response: { member_created: true, tag_added: false },
      });
    }

    let tagAdded = false;
    if (!memberHasTag(member, tagId)) {
      try {
        await addCircleMemberTag({ email: claimedJob.email, tagId }, { env: options.env });
        tagAdded = true;
        await patchJob(job.id, {
          circle_member_id: String(member.id),
          circle_member_tag_id: String(tagId),
          member_created: Boolean(claimedJob.member_created || memberCreated),
          tag_added: true,
          provider_response: { member_created: memberCreated, tag_added: true },
        });
      } catch (error) {
        // A concurrent Stripe retry may have applied the tag between the read
        // and write. Re-read once; never remove or replace any existing tag.
        if (Number(error?.status) !== 422 && Number(error?.status) !== 409) throw error;
        const refreshed = await findCircleMember(claimedJob.email, { env: options.env });
        if (!memberHasTag(refreshed, tagId)) throw error;
        member = refreshed;
      }
    }

    const completedAt = new Date().toISOString();
    const saved = await patchJob(job.id, {
      status: 'succeeded',
      circle_member_id: String(member.id),
      circle_member_tag_id: String(tagId),
      member_created: Boolean(claimedJob.member_created || memberCreated),
      tag_added: Boolean(claimedJob.tag_added || tagAdded),
      next_attempt_at: null,
      last_error: null,
      provider_response: {
        member_created: memberCreated,
        tag_already_present: !tagAdded,
        tag_name: CIRCLE_TAG_NAME,
      },
      succeeded_at: completedAt,
    });
    if (!saved.ok) throw Object.assign(new Error(`circle_job_save_${saved.status}`), { code: 'circle_job_save' });
    await supabasePost('mc2_funnel_events', {
      token: claimedJob.token,
      event_name: 'circle_access_granted',
      event_value: CIRCLE_TAG_NAME,
      page_path: '/commencer/succes/',
      metadata: {
        circle_member_id: String(member.id),
        circle_member_tag_id: String(tagId),
        member_created: memberCreated,
        tag_added: tagAdded,
      },
      dedupe_key: `circle_access_${claimedJob.token}`,
    }, { prefer: 'return=minimal' });
    return { status: 'succeeded', memberCreated, tagAdded, memberId: String(member.id), tagId: String(tagId) };
  } catch (error) {
    const failure = providerError(error);
    const finalFailure = attempts >= MAX_ATTEMPTS;
    await patchJob(job.id, {
      status: finalFailure ? 'failed' : 'retry',
      next_attempt_at: finalFailure ? null : nextRetryAt(attempts, now),
      last_error: `${failure.code}:${failure.message}`.slice(0, 700),
      provider_response: error?.providerResponse || failure,
      failed_at: finalFailure ? new Date().toISOString() : null,
    });
    return { status: finalFailure ? 'failed' : 'retry', error: failure.code };
  }
}

export const MC2_CIRCLE_TAG_NAME = CIRCLE_TAG_NAME;
export const MC2_CIRCLE_MAX_ATTEMPTS = MAX_ATTEMPTS;
