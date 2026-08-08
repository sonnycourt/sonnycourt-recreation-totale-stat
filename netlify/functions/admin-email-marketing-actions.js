import crypto from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import {
  acquireTestProofLock,
  getBroadcastWorkspace,
  releaseTestProofLock,
  saveBroadcastWorkspace,
} from './lib/email-division-redis.mjs';

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_REQUEST_BYTES = 80_000;
const FINAL_APPROVAL_TTL_MS = 10 * 60 * 1000;
const MANAGED_CAMPAIGN_PREFIX = '[EMAIL DIVISION] ';
const TEST_CAMPAIGN_PREFIX = '[EMAIL DIVISION TEST] ';
const TEST_GROUP_NAME = '[EMAIL DIVISION] TEST INTERNE';
const TEST_CONFIRMATION_PHRASE = 'ENVOYER TEST';
const AUTHORIZED_TEST_RECIPIENT = 'sonnycourt@gmail.com';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isTrustedLocalDevelopment(req) {
  if (!process.env.NETLIFY_DEV) return false;
  try {
    const hostname = new URL(req.url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function singleLine(value, maxLength = 255) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function multiline(value, maxLength = 30_000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

function safeId(value) {
  const id = singleLine(value, 80);
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function emailHtml(draft) {
  const paragraphs = draft.body
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 18px;color:#17211b;font-family:Arial,sans-serif;font-size:17px;line-height:1.65">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const preheader = draft.preheader
    ? `<span style="display:none!important;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(draft.preheader)}</span>`
    : '';
  const cta = draft.ctaLabel && draft.ctaUrl
    ? `<p style="margin:26px 0"><a href="${escapeHtml(draft.ctaUrl)}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#11845b;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none">${escapeHtml(draft.ctaLabel)}</a></p>`
    : '';
  return `${preheader}<div style="max-width:640px;margin:0 auto;padding:28px 20px">${paragraphs}${cta}</div>`;
}

function normalizeDraft(input) {
  const audienceType = input?.audienceType === 'segment' ? 'segment' : 'group';
  const draft = {
    campaignName: singleLine(input?.campaignName, 255),
    subject: singleLine(input?.subject, 255),
    preheader: singleLine(input?.preheader, 255),
    fromName: singleLine(input?.fromName, 255),
    fromAddress: singleLine(input?.fromAddress, 255).toLowerCase(),
    audienceType,
    audienceId: safeId(input?.audienceId),
    body: multiline(input?.body),
    ctaLabel: singleLine(input?.ctaLabel, 120),
    ctaUrl: safeHttpsUrl(input?.ctaUrl),
  };

  const errors = [];
  if (!draft.campaignName) errors.push('campaign_name_required');
  if (!draft.subject) errors.push('subject_required');
  if (!draft.fromName) errors.push('from_name_required');
  if (!isEmail(draft.fromAddress)) errors.push('verified_from_address_required');
  if (!draft.audienceId) errors.push('audience_required');
  if (draft.body.length < 40) errors.push('email_body_too_short');
  if (draft.ctaLabel && !draft.ctaUrl) errors.push('https_cta_url_required');
  if (!draft.ctaLabel && draft.ctaUrl) errors.push('cta_label_required');
  return { draft, errors };
}

function campaignPayload(draft, { create = false } = {}) {
  const payload = {
    name: `${MANAGED_CAMPAIGN_PREFIX}${draft.campaignName}`.slice(0, 255),
    emails: [{
      subject: draft.subject,
      preheader: draft.preheader,
      from_name: draft.fromName,
      from: draft.fromAddress,
      content: emailHtml(draft),
    }],
  };
  if (create) {
    payload.type = 'regular';
    payload.settings = { ecommerce_tracking: false };
  }
  if (draft.audienceType === 'segment') payload.segments = [draft.audienceId];
  else payload.groups = [draft.audienceId];
  return payload;
}

async function mailerLite(apiKey, method, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${MAILERLITE_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'SonnyCourt-Email-Division/1.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`mailerlite_${response.status}`);
      error.status = response.status;
      error.upstream = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function approvalSecret() {
  const cookieSecret = getAdminEs2CookieSecret();
  return cookieSecret
    ? crypto.createHash('sha256').update(`email-division-final-approval|${cookieSecret}`).digest('hex')
    : '';
}

function signApproval(payload) {
  const secret = approvalSecret();
  if (!secret) return '';
  const encoded = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

function verifyApproval(token) {
  const secret = approvalSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra || signature.length !== 64) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || payload.exp < Date.now() || payload.action !== 'send_campaign') return null;
    return payload;
  } catch {
    return null;
  }
}

function publicCampaign(campaign) {
  const email = Array.isArray(campaign?.emails) ? campaign.emails[0] : {};
  return {
    id: singleLine(campaign?.id, 80),
    name: singleLine(campaign?.name, 255),
    status: singleLine(campaign?.status, 40),
    subject: singleLine(email?.subject, 255),
    fromName: singleLine(email?.from_name, 255),
    fromAddress: singleLine(email?.from, 255),
    updatedAt: singleLine(campaign?.updated_at, 80),
    previewUrl: safeHttpsUrl(email?.preview_url),
    audience: Array.isArray(campaign?.filter_for_humans) ? campaign.filter_for_humans.flat(2).map((item) => singleLine(item, 180)).filter(Boolean) : [],
    missingData: Array.isArray(campaign?.missing_data) ? campaign.missing_data.map((item) => singleLine(item, 120)) : [],
    warnings: Array.isArray(campaign?.warnings) ? campaign.warnings.map((item) => singleLine(item?.message || item, 160)) : [],
  };
}

function configuredTestRecipients() {
  const configured = singleLine(process.env.EMAIL_DIVISION_TEST_RECIPIENTS, 255).toLowerCase();
  return configured === AUTHORIZED_TEST_RECIPIENT ? [AUTHORIZED_TEST_RECIPIENT] : [];
}

function capabilities() {
  const draftWritesEnabled = String(process.env.EMAIL_DIVISION_WRITES_ENABLED || '').toLowerCase() === 'true';
  const sendsEnabled = draftWritesEnabled && String(process.env.EMAIL_DIVISION_SENDS_ENABLED || '').toLowerCase() === 'true';
  const testRecipients = configuredTestRecipients();
  const testFlightsEnabled = String(process.env.EMAIL_DIVISION_TEST_FLIGHTS_ENABLED || '').toLowerCase() === 'true'
    && testRecipients.length > 0;
  return {
    mode: sendsEnabled ? 'armed' : draftWritesEnabled ? 'drafts_enabled' : 'construction',
    draftWritesEnabled,
    sendsEnabled,
    automationsMutable: false,
    finalApprovalRequired: true,
    confirmationPhrase: 'ENVOYER',
    testFlightsEnabled,
    testRecipients,
    testConfirmationPhrase: TEST_CONFIRMATION_PHRASE,
  };
}

function comparableDraft(draft) {
  return JSON.stringify({
    campaignName: draft.campaignName,
    subject: draft.subject,
    preheader: draft.preheader,
    fromName: draft.fromName,
    fromAddress: draft.fromAddress,
    audienceType: draft.audienceType,
    audienceId: draft.audienceId,
    body: draft.body,
    ctaLabel: draft.ctaLabel,
    ctaUrl: draft.ctaUrl,
  });
}

async function ensureIsolatedTestGroup(apiKey, recipients) {
  const groupsResult = await mailerLite(apiKey, 'GET', '/groups?limit=1000&page=1');
  let group = (groupsResult?.data || []).find((item) => singleLine(item?.name, 255) === TEST_GROUP_NAME);
  if (!group) {
    const created = await mailerLite(apiKey, 'POST', '/groups', { name: TEST_GROUP_NAME });
    group = created?.data;
  }
  const groupId = safeId(group?.id);
  if (!groupId) throw new Error('test_group_unavailable');

  for (const email of recipients) {
    let subscriber = null;
    try {
      subscriber = (await mailerLite(apiKey, 'GET', `/subscribers/${encodeURIComponent(email)}?include=groups`))?.data || null;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    if (!subscriber) {
      subscriber = (await mailerLite(apiKey, 'POST', '/subscribers', { email, groups: [groupId] }))?.data || null;
    }
    if (singleLine(subscriber?.status, 40) !== 'active') throw new Error('test_recipient_is_not_active');
    const subscriberId = safeId(subscriber?.id);
    if (!subscriberId) throw new Error('test_recipient_unavailable');
    await mailerLite(apiKey, 'POST', `/subscribers/${subscriberId}/groups/${groupId}`);
  }

  const members = await mailerLite(apiKey, 'GET', `/groups/${groupId}/subscribers?filter%5Bstatus%5D=active&limit=1000&page=1`);
  const activeEmails = (members?.data || []).map((item) => singleLine(item?.email, 255).toLowerCase()).filter(isEmail);
  const allowed = new Set(recipients);
  const total = Number(members?.meta?.total ?? activeEmails.length);
  if (total !== recipients.length || activeEmails.some((email) => !allowed.has(email)) || recipients.some((email) => !activeEmails.includes(email))) {
    throw new Error('test_group_is_not_isolated');
  }
  return { id: groupId, name: TEST_GROUP_NAME };
}

async function readBody(req) {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new Error('request_too_large');
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) throw new Error('request_too_large');
  return JSON.parse(text || '{}');
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const session = getSessionFromRequest(req);
  const trustedLocal = isTrustedLocalDevelopment(req);
  const localRead = req.method === 'GET' && trustedLocal;
  if (!session && !localRead) return json(401, { error: 'authentication_required' });

  const currentCapabilities = capabilities();
  if (req.method === 'GET') return json(200, currentCapabilities);
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', allowed: ['GET', 'POST'] });

  // A localhost convenience bypass is deliberately never accepted for writes.
  if (!session) return json(401, { error: 'authenticated_session_required_for_writes' });

  const apiKey = String(process.env.MAILERLITE_API_KEY || '').trim();
  if (!apiKey) return json(503, { error: 'mailerlite_not_configured' });

  let input;
  try {
    input = await readBody(req);
  } catch (error) {
    return json(error?.message === 'request_too_large' ? 413 : 400, { error: error?.message || 'invalid_json' });
  }

  const operation = singleLine(input?.operation, 60);
  let testProofLockHash = '';
  try {
    if (operation === 'send_test_proof') {
      if (!currentCapabilities.testFlightsEnabled) return json(423, { error: 'test_flights_locked' });
      if (input?.confirmation !== TEST_CONFIRMATION_PHRASE || input?.finalApproval !== true) {
        return json(409, { error: 'explicit_test_approval_required' });
      }

      const workspace = await getBroadcastWorkspace();
      if (workspace?.missionDecision?.type !== 'approved') return json(409, { error: 'dossier_approval_required' });
      const approvedSnapshot = workspace?.state?.contentApproval?.snapshot;
      if (!approvedSnapshot) return json(409, { error: 'content_approval_required' });

      let approvedInput;
      try { approvedInput = JSON.parse(approvedSnapshot); } catch { return json(409, { error: 'approved_snapshot_invalid' }); }
      const approved = normalizeDraft(approvedInput);
      const submitted = normalizeDraft(input?.draft);
      if (approved.errors.length || submitted.errors.length) {
        return json(422, { error: 'invalid_draft', fields: [...new Set([...approved.errors, ...submitted.errors])] });
      }
      if (comparableDraft(approved.draft) !== comparableDraft(submitted.draft)) {
        return json(409, { error: 'draft_changed_after_content_approval' });
      }

      const snapshotHash = crypto.createHash('sha256').update(comparableDraft(submitted.draft)).digest('hex');
      if (!await acquireTestProofLock(snapshotHash)) {
        return json(409, { error: 'test_proof_already_requested_for_this_version' });
      }
      testProofLockHash = snapshotHash;

      const recipients = [AUTHORIZED_TEST_RECIPIENT];
      const testGroup = await ensureIsolatedTestGroup(apiKey, recipients);
      const draft = submitted.draft;
      const created = await mailerLite(apiKey, 'POST', '/campaigns', {
        name: `${TEST_CAMPAIGN_PREFIX}${draft.campaignName} · ${snapshotHash.slice(0, 8)}`.slice(0, 255),
        type: 'regular',
        emails: [{ subject: draft.subject, preheader: draft.preheader, from_name: draft.fromName, from: draft.fromAddress, content: emailHtml(draft) }],
        groups: [testGroup.id],
        settings: { ecommerce_tracking: false },
      });
      let campaign = publicCampaign(created?.data || {});
      if (!campaign.id) throw new Error('test_campaign_creation_failed');
      if (campaign.missingData.length || campaign.warnings.length) {
        const error = new Error('test_campaign_preflight_failed');
        error.status = 409;
        error.campaign = campaign;
        throw error;
      }
      const scheduled = await mailerLite(apiKey, 'POST', `/campaigns/${campaign.id}/schedule`, { delivery: 'instant' });
      campaign = publicCampaign(scheduled?.data || created?.data || {});
      const testProof = { campaign, recipients, sentAt: new Date().toISOString(), snapshotHash, sentSnapshot: approvedSnapshot };
      await saveBroadcastWorkspace({
        ...workspace,
        updatedAt: new Date().toISOString(),
        state: { ...(workspace?.state || {}), testProof },
      });
      console.info('[email-division] isolated test proof requested', { campaignId: campaign.id, recipientCount: 1 });
      return json(200, { ok: true, operation, testProof, recipientCount: 1, broadcastSendPerformed: false });
    }

    if (operation === 'create_draft' || operation === 'update_draft') {
      if (!currentCapabilities.draftWritesEnabled) return json(423, { error: 'draft_writes_locked' });
      if (input?.dossierId !== 'broadcast-value' || input?.dossierApproved !== true || input?.contentApproved !== true) {
        return json(409, { error: 'double_approval_prerequisites_missing' });
      }
      const { draft, errors } = normalizeDraft(input?.draft);
      if (errors.length) return json(422, { error: 'invalid_draft', fields: errors });

      let path = '/campaigns';
      let method = 'POST';
      if (operation === 'update_draft') {
        const campaignId = safeId(input?.campaignId);
        if (!campaignId) return json(422, { error: 'campaign_id_required' });
        const existing = await mailerLite(apiKey, 'GET', `/campaigns/${campaignId}`);
        if (existing?.data?.status !== 'draft' || !String(existing?.data?.name || '').startsWith(MANAGED_CAMPAIGN_PREFIX)) {
          return json(409, { error: 'campaign_not_managed_by_email_division' });
        }
        path = `/campaigns/${campaignId}`;
        method = 'PUT';
      }
      const result = await mailerLite(apiKey, method, path, campaignPayload(draft, { create: operation === 'create_draft' }));
      const campaign = publicCampaign(result?.data || {});
      console.info('[email-division] draft synchronized', { operation, campaignId: campaign.id });
      return json(200, { ok: true, operation, campaign });
    }

    if (operation === 'prepare_final_approval') {
      const campaignId = safeId(input?.campaignId);
      if (!campaignId) return json(422, { error: 'campaign_id_required' });
      const result = await mailerLite(apiKey, 'GET', `/campaigns/${campaignId}`);
      const campaign = publicCampaign(result?.data || {});
      if (!campaign.name.startsWith(MANAGED_CAMPAIGN_PREFIX)) return json(409, { error: 'campaign_not_managed_by_email_division' });
      if (campaign.status !== 'draft') return json(409, { error: 'campaign_is_not_draft', campaign });
      const token = signApproval({
        v: 1,
        action: 'send_campaign',
        campaignId,
        updatedAt: campaign.updatedAt,
        exp: Date.now() + FINAL_APPROVAL_TTL_MS,
      });
      if (!token) return json(503, { error: 'approval_signing_unavailable' });
      return json(200, { ok: true, campaign, approvalToken: token, expiresInSeconds: FINAL_APPROVAL_TTL_MS / 1000 });
    }

    if (operation === 'send_campaign') {
      if (!currentCapabilities.sendsEnabled) return json(423, { error: 'broadcast_sends_locked' });
      if (input?.finalApproval !== true || input?.confirmation !== 'ENVOYER') {
        return json(409, { error: 'explicit_final_approval_required' });
      }
      const approval = verifyApproval(input?.approvalToken);
      const campaignId = safeId(input?.campaignId);
      if (!approval || !campaignId || approval.campaignId !== campaignId) {
        return json(409, { error: 'invalid_or_expired_approval' });
      }
      const current = await mailerLite(apiKey, 'GET', `/campaigns/${campaignId}`);
      const campaign = publicCampaign(current?.data || {});
      if (!campaign.name.startsWith(MANAGED_CAMPAIGN_PREFIX)) return json(409, { error: 'campaign_not_managed_by_email_division' });
      if (campaign.status !== 'draft' || campaign.updatedAt !== approval.updatedAt) {
        return json(409, { error: 'campaign_changed_after_approval', campaign });
      }
      if (campaign.missingData.length || campaign.warnings.length) {
        return json(409, { error: 'campaign_preflight_failed', campaign });
      }
      const sent = await mailerLite(apiKey, 'POST', `/campaigns/${campaignId}/schedule`, { delivery: 'instant' });
      console.info('[email-division] broadcast send requested after final approval', { campaignId });
      return json(200, { ok: true, operation, campaign: publicCampaign(sent?.data || {}) });
    }

    return json(422, { error: 'unsupported_operation' });
  } catch (error) {
    if (testProofLockHash) await releaseTestProofLock(testProofLockHash).catch(() => {});
    const upstreamMessage = singleLine(error?.upstream?.message || error?.message || 'mailerlite_action_failed', 180);
    console.error('[admin-email-marketing-actions] operation failed', { operation, message: upstreamMessage });
    const status = [409, 422, 423].includes(error?.status) ? error.status : 502;
    return json(status, {
      error: ['test_group_is_not_isolated', 'test_recipient_is_not_active'].includes(error?.message)
        ? error.message : 'mailerlite_action_failed',
      detail: upstreamMessage,
      campaign: error?.campaign || undefined,
    });
  }
};
