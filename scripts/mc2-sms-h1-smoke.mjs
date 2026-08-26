import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  MC2_OFFER_SMS_STALE_MS,
  ensureMc2OfferCode,
  mc2OfferH1SmsEnabled,
  mc2SmsMessage,
  processMc2SmsJob,
} from '../netlify/functions/lib/mc2-sms.mjs';
import { estimateMc2SmsSegments } from '../netlify/functions/lib/mc2-sms-country-filter.mjs';
import { MC2_OFFER_SMS_LEAD_MS } from '../netlify/functions/lib/mc2-offer-deadline.mjs';

const code = 'A1b2C';
const token = '12345678-1234-1234-1234-123456789012';
const expected = "DERNIERE HEURE !\nIl ne reste plus qu'une heure pour rejoindre Esprit Subconscient 2.0.\nInscris-toi ici :\nhttps://sonnycourt.com/offre/A1b2C";
assert.equal(mc2SmsMessage('offer_deadline', token, { liveCode: code }), expected);
assert.equal(expected.length, 139);
assert.equal(estimateMc2SmsSegments(expected), 1);
assert.equal(MC2_OFFER_SMS_LEAD_MS, 60 * 60 * 1000);
assert.equal(MC2_OFFER_SMS_STALE_MS, 10 * 60 * 1000);

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
process.env.GATEWAYAPI_TOKEN = 'gateway-token';
process.env.MC2_OFFER_H1_SMS_ENABLED = 'true';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

try {
  assert.equal(mc2OfferH1SmsEnabled(), true);

  let patchCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (options.method === 'PATCH') {
      patchCount += 1;
      return patchCount === 1 ? json({ message: 'duplicate' }, 409) : json([{ live_code: code }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.has('live_code')) return json([]);
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.get('message_type') === 'eq.session_live') {
      return json([{ id: 7, token, live_code: null }]);
    }
    return json([]);
  };
  assert.equal(await ensureMc2OfferCode({ id: 8, token, live_code: null }), code);
  assert.equal(patchCount, 2, 'une collision doit générer un nouveau code');

  let gatewayCalls = 0;
  let finalPatch = null;
  const dueAt = new Date('2026-08-23T10:00:00.000Z');
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'messaging.gatewayapi.com') {
      gatewayCalls += 1;
      return json({ error: 'provider unavailable' }, 500);
    }
    if (parsed.pathname.endsWith('/mc2_registrations')) return json([{
      token,
      telephone: '+41789482376',
      pays: 'Suisse',
      sms_consent_at: '2026-08-20T10:00:00.000Z',
      statut: 'registered',
      payment_status: null,
      offer_expires_at: '2026-08-23T11:00:00.000Z',
    }]);
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      if (body.status === 'processing') return json([{ id: 12, token, message_type: 'offer_deadline', attempts: 1 }]);
      finalPatch = body;
      return json([{ id: 12, ...body }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.has('live_code')) {
      return json([{ live_code: code }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.get('select') === 'status,skip_reason') {
      return json([{ status: 'processing', skip_reason: null }]);
    }
    return json([]);
  };
  const failure = await processMc2SmsJob({
    id: 12,
    token,
    message_type: 'offer_deadline',
    attempts: 0,
    due_at: dueAt.toISOString(),
  }, new Date('2026-08-23T10:01:00.000Z'));
  assert.equal(failure.status, 'failed_final');
  assert.equal(gatewayCalls, 1);
  assert.equal(finalPatch.status, 'skipped');
  assert.equal(finalPatch.skip_reason, 'max_attempts');

  let eligibilityReads = 0;
  let purchaseRaceSkip = null;
  gatewayCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'messaging.gatewayapi.com') {
      gatewayCalls += 1;
      return json({ id: 'must-not-send' });
    }
    if (parsed.pathname.endsWith('/mc2_registrations')) {
      eligibilityReads += 1;
      return json([{
        token,
        telephone: '+41789482376',
        pays: 'Suisse',
        sms_consent_at: '2026-08-20T10:00:00.000Z',
        statut: eligibilityReads === 1 ? 'registered' : 'purchased',
        payment_status: eligibilityReads === 1 ? null : 'paid',
        offer_expires_at: '2026-08-23T11:00:00.000Z',
      }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      if (body.status === 'processing') {
        return json([{ id: 14, token, message_type: 'offer_deadline', attempts: 1 }]);
      }
      purchaseRaceSkip = body;
      return json([{ id: 14, ...body }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.has('live_code')) {
      return json([{ live_code: code }]);
    }
    return json([]);
  };
  const purchaseRace = await processMc2SmsJob({
    id: 14,
    token,
    message_type: 'offer_deadline',
    attempts: 0,
    due_at: dueAt.toISOString(),
  }, new Date('2026-08-23T10:01:00.000Z'));
  assert.equal(purchaseRace.status, 'skipped');
  assert.equal(purchaseRace.reason, 'already_purchased');
  assert.equal(purchaseRaceSkip.skip_reason, 'already_purchased');
  assert.equal(gatewayCalls, 0, 'un achat détecté juste avant Gateway doit bloquer l’envoi');

  let recoveredSkip = null;
  gatewayCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'messaging.gatewayapi.com') {
      gatewayCalls += 1;
      return json({ id: 'must-not-send' });
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      if (body.status === 'processing') {
        return json([{
          id: 15,
          token,
          message_type: 'offer_deadline',
          attempts: 2,
          provider_status: 'calling',
        }]);
      }
      recoveredSkip = body;
      return json([{ id: 15, ...body }]);
    }
    throw new Error(`unexpected network call ${url}`);
  };
  const recovered = await processMc2SmsJob({
    id: 15,
    token,
    message_type: 'offer_deadline',
    attempts: 1,
    due_at: dueAt.toISOString(),
  }, new Date('2026-08-23T10:02:00.000Z'));
  assert.equal(recovered.status, 'skipped');
  assert.equal(recovered.reason, 'gateway_attempt_already_started');
  assert.equal(recoveredSkip.skip_reason, 'gateway_attempt_already_started');
  assert.equal(gatewayCalls, 0, 'un appel Gateway commencé ne doit jamais être rejoué');

  let registrationReads = 0;
  gatewayCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'messaging.gatewayapi.com') {
      gatewayCalls += 1;
      return json({ id: 'must-not-send' });
    }
    if (parsed.pathname.endsWith('/mc2_registrations')) {
      registrationReads += 1;
      return json([{
        token,
        telephone: '+41789482376',
        pays: 'Suisse',
        sms_consent_at: '2026-08-20T10:00:00.000Z',
        statut: 'registered',
        payment_status: null,
        offer_expires_at: '2026-08-23T11:00:00.000Z',
      }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      if (body.status === 'processing') {
        return json([{ id: 16, token, message_type: 'offer_deadline', attempts: 1 }]);
      }
      return json([{ id: 16, ...body }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.has('live_code')) {
      return json([{ live_code: code }]);
    }
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && parsed.searchParams.get('select') === 'status,skip_reason') {
      return json([{ status: 'skipped', skip_reason: 'spiffy_purchase_completed' }]);
    }
    return json([]);
  };
  const cancelledRace = await processMc2SmsJob({
    id: 16,
    token,
    message_type: 'offer_deadline',
    attempts: 0,
    due_at: dueAt.toISOString(),
  }, new Date('2026-08-23T10:01:00.000Z'));
  assert.equal(registrationReads, 2);
  assert.equal(cancelledRace.status, 'skipped');
  assert.equal(cancelledRace.reason, 'spiffy_purchase_completed');
  assert.equal(gatewayCalls, 0, 'une annulation Spiffy concurrente doit bloquer Gateway');

  let staleSkip = null;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/mc2_registrations')) return json([{
      token,
      telephone: '+41789482376',
      pays: 'Suisse',
      sms_consent_at: '2026-08-20T10:00:00.000Z',
      statut: 'registered',
      offer_expires_at: '2026-08-23T11:00:00.000Z',
    }]);
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      if (body.status === 'processing') return json([{ id: 13, token, message_type: 'offer_deadline', attempts: 1 }]);
      staleSkip = body;
      return json([{ id: 13, ...body }]);
    }
    throw new Error(`unexpected network call ${url}`);
  };
  const stale = await processMc2SmsJob({
    id: 13,
    token,
    message_type: 'offer_deadline',
    attempts: 0,
    due_at: dueAt.toISOString(),
  }, new Date('2026-08-23T10:10:01.000Z'));
  assert.equal(stale.status, 'skipped');
  assert.equal(stale.reason, 'offer_sms_stale');
  assert.equal(staleSkip.skip_reason, 'offer_sms_stale');

  let legacySkip = null;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/mc2_registrations')) return json([{
      token,
      telephone: '+41789482376',
      pays: 'Suisse',
      sms_consent_at: '2026-08-20T10:00:00.000Z',
      statut: 'registered',
      offer_expires_at: '2026-08-23T11:00:00.000Z',
    }]);
    if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      if (body.status === 'processing') return json([{ id: 17, token, message_type: 'offer_deadline', attempts: 1 }]);
      legacySkip = body;
      return json([{ id: 17, ...body }]);
    }
    throw new Error(`unexpected network call ${url}`);
  };
  const legacy = await processMc2SmsJob({
    id: 17,
    token,
    message_type: 'offer_deadline',
    attempts: 0,
    due_at: '2026-08-23T10:45:00.000Z',
  }, new Date('2026-08-23T10:45:00.000Z'));
  assert.equal(legacy.status, 'skipped');
  assert.equal(legacy.reason, 'offer_sms_legacy_schedule');
  assert.equal(legacySkip.skip_reason, 'offer_sms_legacy_schedule');

  const source = await fs.readFile(new URL('../netlify/functions/lib/mc2-sms.mjs', import.meta.url), 'utf8');
  assert.match(source, /page_path:\s*'\/mc2\/session\/'/);
  assert.match(source, /MC2_OFFER_H1_SMS_ENABLED/);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

console.log('MC2 SMS H-1 smoke: OK');
