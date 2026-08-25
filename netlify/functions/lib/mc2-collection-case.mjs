import crypto from 'node:crypto';
import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';
import { mc2Stripe, stripeId } from './mc2-stripe.mjs';

export const MC2_COLLECTION_REQUIRED_RETRIES = 5;
const MAX_JOB_ATTEMPTS = 5;

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

function hash(value) {
  const serialized = typeof value === 'string' ? value : stableStringify(value);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function mc2CollectionEnabled(env = process.env) {
  return clean(env.MC2_COLLECTION_CASES_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2CollectionExportsEnabled(env = process.env) {
  return clean(env.MC2_COLLECTION_EXPORTS_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2CollectionEligible({ retryCount = 0, exhausted = false } = {}) {
  return Boolean(exhausted) && Number(retryCount || 0) === MC2_COLLECTION_REQUIRED_RETRIES;
}

export function mc2ContractVersion(env = process.env) {
  return clean(env.MC2_CONTRACT_VERSION, 80) || 'mc2-cgv-2026-08-v5';
}

export function mc2ContractAcceptanceText(env = process.env) {
  return clean(env.MC2_CONTRACT_ACCEPTANCE_TEXT, 1_000)
    || "J’accepte les CGV et l’échéancier clairement indiqué ci-dessus.";
}

export function validateMc2ContractReadiness(env = process.env) {
  const sha = clean(env.MC2_TERMS_SNAPSHOT_SHA256, 128).toLowerCase();
  const errors = [];
  if (!clean(env.MC2_CONTRACT_VERSION, 80)) errors.push('contract_version_missing');
  if (!clean(env.MC2_TERMS_URL, 500)) errors.push('terms_url_missing');
  if (!clean(env.MC2_TERMS_SNAPSHOT_URL, 500)) errors.push('terms_snapshot_url_missing');
  if (!/^[a-f0-9]{64}$/.test(sha)) errors.push('terms_snapshot_sha256_invalid');
  if (!mc2ExpectedContractSchedule(env).length) errors.push('expected_schedule_json_invalid');
  return { valid: errors.length === 0, errors };
}

export function mc2ExpectedContractSchedule(env = process.env) {
  try {
    const value = JSON.parse(String(env.MC2_CONTRACT_EXPECTED_SCHEDULE_JSON || ''));
    if (!Array.isArray(value) || !value.length) return [];
    const rows = value.map((item) => ({
      label: clean(item?.label, 160),
      due_offset_days: Math.max(0, Number(item?.due_offset_days || 0)),
      amount_cents: Math.max(0, Number(item?.amount_cents || 0)),
      installments: Math.max(1, Number(item?.installments || 1)),
    }));
    if (rows.some((item) => !item.label || !Number.isSafeInteger(item.amount_cents) || item.amount_cents <= 0
      || !Number.isSafeInteger(item.installments) || item.installments < 1)) return [];
    return rows;
  } catch {
    return [];
  }
}

export function validateMc2ContractOffer(payload, env = process.env) {
  const expectedPlan = clean(env.MC2_CONTRACT_EXPECTED_PAYMENT_PLAN, 120);
  const expectedEntry = Number(env.MC2_CONTRACT_EXPECTED_ENTRY_CENTS || 0);
  const expectedTotal = Number(env.MC2_CONTRACT_EXPECTED_TOTAL_CENTS || 0);
  const schedule = mc2ExpectedContractSchedule(env);
  const errors = [];
  if (!expectedPlan) errors.push('expected_payment_plan_missing');
  else if (payload?.payment_plan !== expectedPlan) errors.push('payment_plan_mismatch');
  if (!Number.isSafeInteger(expectedEntry) || expectedEntry <= 0) errors.push('expected_entry_cents_missing');
  else if (Number(payload?.initial_payment_cents || 0) !== expectedEntry) errors.push('entry_cents_mismatch');
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal <= 0) errors.push('expected_total_cents_missing');
  else if (Number(payload?.contractual_total_cents || 0) !== expectedTotal) errors.push('contractual_total_mismatch');
  if (!schedule.length) errors.push('expected_schedule_json_invalid');
  else {
    const scheduleTotal = schedule.reduce((total, item) => total + (item.amount_cents * item.installments), 0);
    if (schedule[0].amount_cents !== expectedEntry) errors.push('schedule_entry_mismatch');
    if (scheduleTotal !== expectedTotal) errors.push('schedule_total_mismatch');
  }
  return { valid: errors.length === 0, errors };
}

export function mc2ClientIp(req) {
  return clean(
    req?.headers?.get?.('x-nf-client-connection-ip')
      || req?.headers?.get?.('x-forwarded-for')?.split(',')[0]
      || req?.headers?.get?.('cf-connecting-ip'),
    80,
  ) || null;
}

export function buildMc2ContractAcceptance({ registration, session, req, acceptedAt, env = process.env }) {
  const row = {
    token: clean(registration?.token, 128),
    stripe_checkout_session_id: clean(session?.id, 255),
    contract_version: mc2ContractVersion(env),
    terms_url: clean(env.MC2_TERMS_URL, 500) || 'https://sonnycourt.com/cgv/',
    terms_snapshot_url: clean(env.MC2_TERMS_SNAPSHOT_URL, 500) || null,
    terms_snapshot_sha256: clean(env.MC2_TERMS_SNAPSHOT_SHA256, 128) || null,
    acceptance_text: mc2ContractAcceptanceText(env),
    payment_plan: clean(session?.metadata?.payment_plan, 120) || '47_now_then_4x297_days_14_35_56_77',
    payment_schedule: mc2ExpectedContractSchedule(env),
    initial_payment_cents: Math.max(0, Number(session?.amount_total || 4_700)),
    contractual_total_cents: Math.max(0, Number(session?.metadata?.contractual_total_cents || registration?.contractual_total_cents || 0)),
    currency: clean(session?.currency, 10).toLowerCase() || 'eur',
    accepted_at: iso(acceptedAt) || new Date().toISOString(),
    client_ip: mc2ClientIp(req),
    client_user_agent: clean(req?.headers?.get?.('user-agent'), 1_000) || null,
    request_id: clean(req?.headers?.get?.('x-nf-request-id'), 255) || null,
  };
  return { ...row, evidence_sha256: hash(row) };
}

export async function persistMc2ContractAcceptance(payload) {
  const result = await supabasePost(
    'mc2_contract_acceptances?on_conflict=stripe_checkout_session_id,contract_version',
    payload,
    { prefer: 'resolution=ignore-duplicates,return=representation' },
  );
  if (!result.ok) throw new Error(`mc2_contract_acceptance_${result.status}`);
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

export function buildMc2PaymentAttempt({ token, invoice, paymentIntent, failure, event }) {
  const attemptSequence = Math.max(1, Number(invoice?.attempt_count || 1));
  const payload = {
    token: clean(token, 128),
    stripe_event_id: clean(event?.id, 255),
    stripe_invoice_id: clean(stripeId(invoice), 255),
    stripe_payment_intent_id: clean(stripeId(paymentIntent) || stripeId(invoice?.payment_intent), 255) || null,
    attempt_sequence: attemptSequence,
    retry_sequence: Math.max(0, attemptSequence - 1),
    status: failure?.requiresAction ? 'action_required' : 'failed',
    amount_due_cents: Math.max(0, Number(invoice?.amount_due || 0)),
    currency: clean(invoice?.currency, 10).toLowerCase() || 'eur',
    failure_code: clean(failure?.code, 120) || null,
    decline_code: clean(failure?.declineCode, 120) || null,
    failure_message: clean(failure?.message, 500) || null,
    next_retry_at: iso(invoice?.next_payment_attempt),
    occurred_at: iso(event?.created) || new Date().toISOString(),
    evidence: {
      invoice_status: clean(invoice?.status, 80) || null,
      invoice_hosted_url: clean(invoice?.hosted_invoice_url, 1_000) || null,
      invoice_pdf_url: clean(invoice?.invoice_pdf, 1_000) || null,
      livemode: Boolean(event?.livemode),
    },
  };
  return payload;
}

export async function persistMc2PaymentAttempt(payload) {
  const result = await supabasePost(
    'mc2_payment_attempts?on_conflict=stripe_event_id',
    payload,
    { prefer: 'resolution=ignore-duplicates,return=representation' },
  );
  if (!result.ok) throw new Error(`mc2_payment_attempt_${result.status}`);
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

export async function queueMc2CollectionCase({ token, invoiceId, stripeEventId, retryCount }) {
  const safeToken = clean(token, 128);
  const safeInvoice = clean(invoiceId, 255);
  const retries = Number(retryCount || 0);
  if (!safeToken || !safeInvoice || retries !== MC2_COLLECTION_REQUIRED_RETRIES) {
    return { ok: false, error: 'mc2_collection_not_eligible' };
  }
  const jobKey = `mc2_collection:${safeInvoice}:r${retries}`;
  const result = await supabasePost('mc2_collection_case_jobs', {
    token: safeToken,
    stripe_invoice_id: safeInvoice,
    source_stripe_event_id: clean(stripeEventId, 255) || null,
    job_key: jobKey,
    retry_count: retries,
    status: 'pending',
  });
  if (result.ok) return { ok: true, existing: false, row: result.data?.[0] || null };
  if (result.status !== 409) return { ok: false, error: `mc2_collection_job_${result.status}` };
  const existing = await supabaseGet(
    `mc2_collection_case_jobs?job_key=eq.${encode(jobKey)}&select=*&limit=1`,
  );
  return {
    ok: existing.ok,
    existing: true,
    row: existing.ok && Array.isArray(existing.data) ? existing.data[0] || null : null,
  };
}

async function one(table, query) {
  const result = await supabaseGet(`${table}?${query}&select=*&limit=1`);
  if (!result.ok) throw new Error(`${table}_${result.status}`);
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function many(table, query) {
  const result = await supabaseGet(`${table}?${query}&select=*&limit=500`);
  if (!result.ok) throw new Error(`${table}_${result.status}`);
  return Array.isArray(result.data) ? result.data : [];
}

function addressFrom(registration, stripeCustomer) {
  const address = stripeCustomer?.address || {};
  return {
    full_name: clean(registration.billing_full_name || stripeCustomer?.name, 160) || null,
    phone: clean(registration.billing_phone || stripeCustomer?.phone || registration.telephone, 40) || null,
    line1: clean(registration.billing_street || address.line1, 220) || null,
    line2: clean(registration.billing_street2 || address.line2, 220) || null,
    postal_code: clean(registration.billing_zip || address.postal_code, 30) || null,
    city: clean(registration.billing_city || address.city, 120) || null,
    state: clean(address.state, 120) || null,
    country: clean(registration.billing_country || address.country || registration.pays, 80) || null,
    completed_at: iso(registration.billing_completed_at),
    source: registration.billing_completed_at ? 'post_purchase_form' : 'stripe_customer',
  };
}

function invoiceLine(line) {
  return {
    id: clean(line?.id, 255) || null,
    description: clean(line?.description, 500) || null,
    amount_cents: Math.max(0, Number(line?.amount || 0)),
    currency: clean(line?.currency, 10).toLowerCase() || null,
    period_start: iso(line?.period?.start),
    period_end: iso(line?.period?.end),
  };
}

export function mc2CaseCompleteness(snapshot) {
  const missing = [];
  if (!snapshot?.debtor?.email) missing.push('debtor.email');
  if (!snapshot?.debtor?.full_name) missing.push('debtor.full_name');
  if (!snapshot?.address?.line1) missing.push('address.line1');
  if (!snapshot?.address?.postal_code) missing.push('address.postal_code');
  if (!snapshot?.address?.city) missing.push('address.city');
  if (!snapshot?.address?.country) missing.push('address.country');
  if (!snapshot?.contract?.accepted_at) missing.push('contract.accepted_at');
  if (!snapshot?.contract?.version) missing.push('contract.version');
  if (!snapshot?.contract?.terms_url) missing.push('contract.terms_url');
  if (!snapshot?.contract?.terms_snapshot_url) missing.push('contract.terms_snapshot_url');
  if (!snapshot?.contract?.terms_snapshot_sha256) missing.push('contract.terms_snapshot_sha256');
  if (!(snapshot?.contract?.payment_schedule || []).length) missing.push('contract.payment_schedule');
  const retrySequences = new Set(
    (snapshot?.payment_attempts || [])
      .map((attempt) => Number(attempt?.retry_sequence))
      .filter((sequence) => Number.isInteger(sequence) && sequence >= 1),
  );
  for (let sequence = 1; sequence <= MC2_COLLECTION_REQUIRED_RETRIES; sequence += 1) {
    if (!retrySequences.has(sequence)) missing.push(`payment_attempts.retry_${sequence}`);
  }
  if (!(snapshot?.invoices || []).length) missing.push('invoices');
  if (Number(snapshot?.balance?.paid_total_cents || 0) > 0 && !(snapshot?.payments || []).length) {
    missing.push('payments');
  }
  if (!snapshot?.stripe?.invoice_id) missing.push('stripe.invoice_id');
  if (!snapshot?.stripe?.invoice_pdf_url && !snapshot?.stripe?.hosted_invoice_url) {
    missing.push('stripe.invoice_document');
  }
  if (!snapshot?.balance?.due_cents) missing.push('balance.due_cents');
  return { complete: missing.length === 0, missing };
}

function caseNumber(invoiceId) {
  return `MC2-${clean(invoiceId, 48).replace(/[^a-zA-Z0-9]/g, '').slice(-18).toUpperCase()}`;
}

async function loadStripeEvidence(stripe, registration, job) {
  const [customer, invoice, schedule, subscriptionInvoices, checkoutSession] = await Promise.all([
    registration.stripe_customer_id
      ? stripe.customers.retrieve(registration.stripe_customer_id).catch(() => null)
      : null,
    stripe.invoices.retrieve(job.stripe_invoice_id, { expand: ['payments', 'lines.data'] }),
    registration.stripe_subscription_schedule_id
      ? stripe.subscriptionSchedules.retrieve(registration.stripe_subscription_schedule_id).catch(() => null)
      : null,
    registration.stripe_subscription_id
      ? stripe.invoices.list({
        subscription: registration.stripe_subscription_id,
        limit: 100,
      }).catch(() => null)
      : null,
    registration.stripe_checkout_session_id
      ? stripe.checkout.sessions.retrieve(registration.stripe_checkout_session_id, {
        expand: ['invoice'],
      }).catch(() => null)
      : null,
  ]);
  const invoiceHistory = [];
  const known = new Set();
  for (const item of [checkoutSession?.invoice, ...(subscriptionInvoices?.data || []), invoice]) {
    if (!item || typeof item === 'string' || !item.id || known.has(item.id)) continue;
    known.add(item.id);
    invoiceHistory.push(item);
  }
  invoiceHistory.sort((left, right) => Number(left.created || 0) - Number(right.created || 0));
  return { customer, invoice, schedule, checkoutSession, invoiceHistory };
}

export async function prepareMc2CollectionCase(job, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const env = options.env || process.env;
  if (!mc2CollectionEnabled(env)) return { status: 'disabled' };
  if (Number(job.retry_count || 0) !== MC2_COLLECTION_REQUIRED_RETRIES) {
    return { status: 'skipped', reason: 'not_exactly_five_retries' };
  }
  const claimed = await supabasePatch(
    'mc2_collection_case_jobs',
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

  try {
    const registration = await one('mc2_registrations', `token=eq.${encode(job.token)}`);
    const recovery = await one('mc2_payment_recoveries', `stripe_invoice_id=eq.${encode(job.stripe_invoice_id)}`);
    if (!registration || !recovery) throw new Error('registration_or_recovery_missing');
    if (registration.payment_status !== 'unpaid' || recovery.status !== 'exhausted') {
      await supabasePatch('mc2_collection_case_jobs', `id=eq.${encode(job.id)}`, {
        status: 'skipped',
        skip_reason: 'debt_no_longer_exhausted',
      });
      return { status: 'skipped', reason: 'debt_no_longer_exhausted' };
    }
    if (Number(recovery.retry_count || 0) !== MC2_COLLECTION_REQUIRED_RETRIES) {
      throw new Error('retry_count_not_exactly_five');
    }

    const [acceptance, attempts, dunning] = await Promise.all([
      one('mc2_contract_acceptances', `token=eq.${encode(job.token)}&order=accepted_at.desc`),
      many('mc2_payment_attempts', `stripe_invoice_id=eq.${encode(job.stripe_invoice_id)}&order=occurred_at.asc`),
      many('mc2_dunning_jobs', `stripe_invoice_id=eq.${encode(job.stripe_invoice_id)}&order=created_at.asc`),
    ]);
    const stripe = options.stripe || mc2Stripe();
    const stripeEvidence = await loadStripeEvidence(stripe, registration, job);
    const amountDue = Math.max(0, Number(stripeEvidence.invoice?.amount_remaining || recovery.amount_due_cents || 0));
    const contractualTotal = Math.max(0, Number(registration.contractual_total_cents || 0));
    const paidTotal = Math.max(0, Number(registration.paid_total_cents || 0));
    const balanceDue = Math.max(0, contractualTotal - paidTotal);

    const snapshot = {
      schema_version: 'mc2-collection-case-v1',
      prepared_at: now.toISOString(),
      debtor: {
        first_name: clean(registration.prenom, 120) || null,
        full_name: clean(registration.billing_full_name || stripeEvidence.customer?.name, 160) || null,
        email: clean(registration.email, 200).toLowerCase() || null,
        phone: clean(registration.billing_phone || registration.telephone || stripeEvidence.customer?.phone, 40) || null,
      },
      address: addressFrom(registration, stripeEvidence.customer),
      contract: acceptance ? {
        version: acceptance.contract_version,
        terms_url: acceptance.terms_url,
        terms_snapshot_url: acceptance.terms_snapshot_url,
        terms_snapshot_sha256: acceptance.terms_snapshot_sha256,
        acceptance_text: acceptance.acceptance_text,
        accepted_at: acceptance.accepted_at,
        client_ip: acceptance.client_ip,
        client_user_agent: acceptance.client_user_agent,
        evidence_sha256: acceptance.evidence_sha256,
        payment_plan: acceptance.payment_plan,
        payment_schedule: acceptance.payment_schedule,
      } : null,
      offer: {
        name: 'Esprit Subconscient 2.0',
        payment_plan: acceptance?.payment_plan || 'mc2_installment_plan',
        initial_payment_cents: Math.max(0, Number(registration.initial_payment_cents || 0)),
        contractual_total_cents: contractualTotal,
        currency: clean(recovery.currency, 10).toLowerCase() || 'eur',
        purchased_at: iso(registration.purchased_at),
      },
      balance: {
        paid_total_cents: paidTotal,
        overdue_invoice_cents: amountDue,
        due_cents: balanceDue,
        currency: clean(recovery.currency, 10).toLowerCase() || 'eur',
      },
      payment_attempts: attempts.map((attempt) => ({
        sequence: attempt.attempt_sequence,
        retry_sequence: attempt.retry_sequence,
        occurred_at: attempt.occurred_at,
        status: attempt.status,
        amount_due_cents: attempt.amount_due_cents,
        currency: attempt.currency,
        failure_code: attempt.failure_code,
        decline_code: attempt.decline_code,
        failure_message: attempt.failure_message,
        next_retry_at: attempt.next_retry_at,
        stripe_event_id: attempt.stripe_event_id,
        stripe_payment_intent_id: attempt.stripe_payment_intent_id,
      })),
      communications: dunning.map((message) => ({
        type: message.message_type,
        stage: message.dunning_stage,
        status: message.status,
        sent_at: message.sent_at,
        provider: message.mailerlite_group_id ? 'mailerlite' : null,
        provider_reference: message.mailerlite_group_id,
      })),
      payments: stripeEvidence.invoiceHistory
        .filter((item) => Number(item.amount_paid || 0) > 0)
        .map((item) => ({
          stripe_invoice_id: item.id,
          invoice_number: item.number || null,
          paid_at: iso(item.status_transitions?.paid_at),
          amount_paid_cents: Math.max(0, Number(item.amount_paid || 0)),
          currency: clean(item.currency, 10).toLowerCase() || null,
          hosted_invoice_url: item.hosted_invoice_url || null,
          invoice_pdf_url: item.invoice_pdf || null,
        })),
      invoices: stripeEvidence.invoiceHistory.map((item) => ({
        stripe_invoice_id: item.id,
        invoice_number: item.number || null,
        status: item.status || null,
        created_at: iso(item.created),
        due_at: iso(item.due_date),
        next_payment_attempt_at: iso(item.next_payment_attempt),
        amount_due_cents: Math.max(0, Number(item.amount_due || 0)),
        amount_paid_cents: Math.max(0, Number(item.amount_paid || 0)),
        amount_remaining_cents: Math.max(0, Number(item.amount_remaining || 0)),
        currency: clean(item.currency, 10).toLowerCase() || null,
        hosted_invoice_url: item.hosted_invoice_url || null,
        invoice_pdf_url: item.invoice_pdf || null,
      })),
      stripe: {
        customer_id: registration.stripe_customer_id || null,
        checkout_session_id: registration.stripe_checkout_session_id || null,
        payment_intent_id: registration.stripe_payment_intent_id || null,
        subscription_id: registration.stripe_subscription_id || null,
        schedule_id: registration.stripe_subscription_schedule_id || null,
        invoice_id: job.stripe_invoice_id,
        invoice_number: stripeEvidence.invoice?.number || null,
        invoice_status: stripeEvidence.invoice?.status || null,
        invoice_created_at: iso(stripeEvidence.invoice?.created),
        hosted_invoice_url: stripeEvidence.invoice?.hosted_invoice_url || null,
        invoice_pdf_url: stripeEvidence.invoice?.invoice_pdf || null,
        schedule_status: stripeEvidence.schedule?.status || null,
        invoice_lines: (stripeEvidence.invoice?.lines?.data || []).map(invoiceLine),
      },
    };
    const completeness = mc2CaseCompleteness(snapshot);
    const snapshotSha = hash(snapshot);
    const existing = await one('mc2_collection_cases', `stripe_invoice_id=eq.${encode(job.stripe_invoice_id)}`);
    if (existing && ['approved', 'rejected', 'exported', 'recovered', 'closed'].includes(existing.status)) {
      await supabasePatch('mc2_collection_case_jobs', `id=eq.${encode(job.id)}`, {
        status: 'skipped',
        skip_reason: 'case_already_human_reviewed',
        completed_at: now.toISOString(),
      });
      return { status: 'skipped', reason: 'case_already_human_reviewed', caseId: existing.id };
    }
    const revision = existing ? Number(existing.revision || 1) + (existing.snapshot_sha256 === snapshotSha ? 0 : 1) : 1;
    const status = completeness.complete ? 'ready_for_review' : 'needs_information';
    const caseRow = {
      case_number: existing?.case_number || caseNumber(job.stripe_invoice_id),
      token: job.token,
      stripe_invoice_id: job.stripe_invoice_id,
      stripe_customer_id: registration.stripe_customer_id || null,
      stripe_subscription_id: registration.stripe_subscription_id || null,
      status,
      revision,
      currency: snapshot.balance.currency,
      contractual_total_cents: contractualTotal,
      paid_total_cents: paidTotal,
      balance_due_cents: balanceDue,
      overdue_invoice_cents: amountDue,
      automatic_retry_count: MC2_COLLECTION_REQUIRED_RETRIES,
      completeness,
      snapshot,
      snapshot_sha256: snapshotSha,
      prepared_at: now.toISOString(),
      ready_for_review_at: completeness.complete ? now.toISOString() : null,
    };
    const saved = await supabasePost(
      'mc2_collection_cases?on_conflict=stripe_invoice_id',
      caseRow,
      { prefer: 'resolution=merge-duplicates,return=representation' },
    );
    if (!saved.ok) throw new Error(`collection_case_upsert_${saved.status}`);
    const savedCase = saved.data?.[0];
    if (!savedCase?.id) throw new Error('collection_case_id_missing');
    // Toujours assurer la présence de la révision : si un run précédent s'est
    // interrompu juste après l'upsert du dossier, le retry répare la pièce sans
    // créer de doublon.
    const revisionResult = await supabasePost(
      'mc2_collection_case_revisions?on_conflict=case_id,revision',
      {
        case_id: savedCase.id,
        revision,
        snapshot,
        snapshot_sha256: snapshotSha,
        completeness,
      },
      { prefer: 'resolution=ignore-duplicates,return=representation' },
    );
    if (!revisionResult.ok) throw new Error(`collection_revision_${revisionResult.status}`);
    const auditPayload = { revision, status, snapshot_sha256: snapshotSha, completeness };
    const audit = await supabasePost(
      'mc2_collection_case_audit?on_conflict=case_id,event_sha256',
      {
        case_id: savedCase.id,
        event_type: existing ? 'case_refreshed' : 'case_prepared',
        actor_type: 'system',
        payload: auditPayload,
        event_sha256: hash({ case_id: savedCase.id, event_type: existing ? 'case_refreshed' : 'case_prepared', ...auditPayload }),
      },
      { prefer: 'resolution=ignore-duplicates,return=representation' },
    );
    if (!audit.ok) throw new Error(`collection_audit_${audit.status}`);
    await supabasePatch('mc2_collection_case_jobs', `id=eq.${encode(job.id)}`, {
      status: 'completed',
      completed_at: now.toISOString(),
      last_error: null,
    });
    return { status: 'completed', caseId: savedCase.id, caseNumber: savedCase.case_number, completeness };
  } catch (error) {
    const attempts = Number(claimedJob.attempts || 1);
    const final = attempts >= MAX_JOB_ATTEMPTS;
    const dueAt = new Date(now.getTime() + Math.min(12, 2 ** attempts) * 60 * 60_000).toISOString();
    await supabasePatch('mc2_collection_case_jobs', `id=eq.${encode(job.id)}`, {
      status: final ? 'failed' : 'retry',
      due_at: final ? claimedJob.due_at : dueAt,
      last_error: clean(error?.message || 'collection_case_failed', 500),
    });
    return { status: final ? 'failed' : 'retry', error: clean(error?.message, 500) };
  }
}

export function publicMc2CollectionCase(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    case_number: clean(row.case_number, 120),
    status: clean(row.status, 80),
    revision: Number(row.revision || 1),
    currency: clean(row.currency, 10).toLowerCase() || 'eur',
    contractual_total_cents: Math.max(0, Number(row.contractual_total_cents || 0)),
    paid_total_cents: Math.max(0, Number(row.paid_total_cents || 0)),
    balance_due_cents: Math.max(0, Number(row.balance_due_cents || 0)),
    overdue_invoice_cents: Math.max(0, Number(row.overdue_invoice_cents || 0)),
    automatic_retry_count: Number(row.automatic_retry_count || 0),
    completeness: row.completeness || {},
    prepared_at: row.prepared_at || null,
    ready_for_review_at: row.ready_for_review_at || null,
    approved_at: row.approved_at || null,
    exported_at: row.exported_at || null,
    provider_name: row.provider_name || null,
    provider_reference: row.provider_reference || null,
  };
}

export function mc2CollectionJsonExport(row, evidence = {}) {
  if (!row || row.status !== 'approved') throw new Error('collection_case_not_approved');
  return {
    case_number: row.case_number,
    exported_at: new Date().toISOString(),
    revision: row.revision,
    snapshot_sha256: row.snapshot_sha256,
    dossier: row.snapshot,
    immutable_history: {
      revisions: Array.isArray(evidence.revisions) ? evidence.revisions : [],
      audit: Array.isArray(evidence.audit) ? evidence.audit : [],
    },
  };
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function mc2CollectionCsvExport(row) {
  const data = mc2CollectionJsonExport(row);
  const snapshot = data.dossier || {};
  const headers = ['case_number', 'full_name', 'email', 'phone', 'address', 'country', 'contract_version', 'accepted_at', 'contractual_total_cents', 'paid_total_cents', 'balance_due_cents', 'currency', 'stripe_invoice_id'];
  const address = snapshot.address || {};
  const values = [
    data.case_number,
    snapshot.debtor?.full_name,
    snapshot.debtor?.email,
    snapshot.debtor?.phone,
    [address.line1, address.line2, address.postal_code, address.city].filter(Boolean).join(', '),
    address.country,
    snapshot.contract?.version,
    snapshot.contract?.accepted_at,
    snapshot.balance?.contractual_total_cents || snapshot.offer?.contractual_total_cents,
    snapshot.balance?.paid_total_cents,
    snapshot.balance?.due_cents,
    snapshot.balance?.currency,
    snapshot.stripe?.invoice_id,
  ];
  return `${headers.map(csvCell).join(',')}\n${values.map(csvCell).join(',')}\n`;
}
