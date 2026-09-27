import assert from 'node:assert/strict';
import {
  MC2_OFFER_FOLLOWUP_DELAY_MS, cancelMc2OfferSms, mc2OfferFollowupSmsEnabled,
  mc2SmsMessage, processMc2SmsJob, queueDueMc2OfferFollowupSms,
} from '../netlify/functions/lib/mc2-sms.mjs';
import scheduled from '../netlify/functions/mc2-sms-scheduled.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalError = console.error;
const token = '12345678-1234-1234-1234-123456789012';
const code = 'A1b2C';
const now = new Date('2026-09-27T14:01:00.000Z');
const seenAt = '2026-09-27T12:00:00.000Z';
const expected = 'Es-tu prêt à commencer ta transformation ?\nSi oui, rejoins Esprit Subconscient 2.0 ici :\nhttps://sonnycourt.com/offre/A1b2C';
const baseJob = { id: 42, token, message_type: 'offer_followup', due_at: '2026-09-27T14:00:00.000Z', attempts: 0 };
const registration = {
  token, telephone: '+41790000000', pays: 'Suisse', sms_consent_at: seenAt,
  statut: 'registered', payment_status: null, purchased_at: null,
  offer_expires_at: '2026-09-30T12:00:00.000Z',
};

// All requests are intercepted. No live Supabase or GatewayAPI traffic.
function fixture(options = {}) {
  const state = { row: { ...baseJob, status: 'pending', ...options.job }, sends: [], events: [], registrationReads: 0 };
  globalThis.fetch = async (url, request = {}) => {
    const u = new URL(url);
    const body = request.body ? JSON.parse(request.body) : null;
    if (u.hostname === 'messaging.gatewayapi.com') {
      state.sends.push(body);
      return Response.json(options.gatewayFail ? { error: 'failure' } : { id: 'mock-only' }, { status: options.gatewayFail ? 500 : 200 });
    }
    assert.equal(u.hostname, 'supabase.test');
    if (u.pathname.endsWith('/mc2_registrations')) {
      state.registrationReads += 1;
      const paid = options.purchaseRace && state.registrationReads > 1 ? { payment_status: 'paid' } : {};
      return Response.json(options.registrationMissing ? [] : [{ ...registration, ...options.registration, ...paid }]);
    }
    if (u.pathname.endsWith('/mc2_tracking_events_v2')) {
      assert.equal(u.searchParams.get('event_name'), 'eq.offer_visible');
      assert.equal(u.searchParams.get('order'), 'received_at.asc');
      assert.equal(u.searchParams.get('token'), `eq.${token}`);
      return Response.json(options.noEvidence ? [] : [{ received_at: options.seenAt || seenAt }], { status: options.evidenceFailure ? 500 : 200 });
    }
    if (u.pathname.endsWith('/mc2_tracking_test_registrations')) return Response.json(options.test ? [{ token }] : []);
    if (u.pathname.endsWith('/mc2_funnel_events') && request.method === 'POST') {
      state.events.push(body);
      return Response.json([]);
    }
    if (u.pathname.endsWith('/mc2_sms_jobs')) {
      if (request.method === 'PATCH') {
        if (body.status === 'processing' && (!['pending', 'retry'].includes(state.row.status) || options.noClaim)) return Response.json([]);
        if (body.provider_status === 'calling') {
          assert.equal(u.searchParams.get('status'), 'eq.processing');
          if (options.cancelAtIntent) return Response.json([]);
        }
        Object.assign(state.row, body);
        return Response.json([{ ...state.row }]);
      }
      if (u.searchParams.get('live_code') === 'not.is.null') return Response.json([{ live_code: code }]);
      if (u.searchParams.get('select') === 'status,skip_reason') {
        return Response.json(options.cancelled ? [{ status: 'skipped', skip_reason: 'spiffy_purchase_completed' }] : [state.row]);
      }
    }
    throw new Error(`Unexpected mocked request: ${request.method || 'GET'} ${url}`);
  };
  return state;
}

try {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'dummy', GATEWAYAPI_TOKEN: 'dummy',
    MC2_PUBLIC_ORIGIN: 'https://sonnycourt.com', MC2_SMS_COUNTRY_FILTER_ENABLED: 'true',
    MC2_SMS_ALLOWED_COUNTRIES: 'FR,CH,BE,CA,LU,MC',
  });
  delete process.env.MC2_OFFER_FOLLOWUP_SMS_ENABLED;
  globalThis.fetch = async () => { throw new Error('Disabled queue must not use the network'); };
  assert.equal(mc2OfferFollowupSmsEnabled(), false);
  assert.deepEqual(await queueDueMc2OfferFollowupSms(now), { ok: true, enabled: false, queued: 0 });
  assert.equal(MC2_OFFER_FOLLOWUP_DELAY_MS, 7_200_000);
  assert.equal(mc2SmsMessage('offer_followup', token, { liveCode: code }), expected);
  assert.match(mc2SmsMessage('offer_followup', token), new RegExp(`/mc2/session/\\?t=${token}$`));
  const disabled = fixture();
  assert.equal((await processMc2SmsJob(baseJob, now)).reason, 'offer_followup_sms_disabled');
  assert.equal(disabled.sends.length, 0);

  process.env.MC2_OFFER_FOLLOWUP_SMS_ENABLED = 'true';
  globalThis.fetch = async (url, request) => {
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/queue_mc2_offer_followup_sms');
    assert.deepEqual(JSON.parse(request.body), { p_now: now.toISOString() });
    return Response.json(2);
  };
  assert.equal((await queueDueMc2OfferFollowupSms(now)).queued, 2);
  assert.equal((await queueDueMc2OfferFollowupSms('not-a-date')).error, 'invalid_followup_time');
  globalThis.fetch = async () => Response.json({ message: 'missing migration' }, { status: 404 });
  assert.equal((await queueDueMc2OfferFollowupSms(now)).ok, false);

  const success = fixture();
  assert.equal((await processMc2SmsJob(baseJob, now)).status, 'sent');
  assert.equal((await processMc2SmsJob(baseJob, now)).status, 'not_claimed');
  assert.equal(success.sends.length, 1, 'a repeated worker invocation must not send twice');
  assert.equal(success.sends[0].message, expected);
  assert.equal(success.events[0].event_name, 'sms_offer_followup_sent');
  assert.equal(success.registrationReads, 2, 'purchase rechecked immediately before sending');

  const cases = [
    [{ noClaim: true }, 'not_claimed'],
    [{ registrationMissing: true }, 'registration_missing'],
    [{ registration: { sms_consent_at: null } }, 'sms_consent_missing'],
    [{ registration: { telephone: 'bad' } }, 'phone_invalid'],
    [{ registration: { statut: 'purchased' } }, 'already_purchased'],
    [{ registration: { purchased_at: seenAt } }, 'already_purchased'],
    ...['paid', 'active', 'succeeded', 'complete', 'completed'].map(payment_status => [{ registration: { payment_status } }, 'already_purchased']),
    [{ purchaseRace: true }, 'already_purchased'],
    [{ registration: { offer_expires_at: now.toISOString() } }, 'offer_expired'],
    [{ noEvidence: true }, 'offer_not_seen'],
    [{ evidenceFailure: true }, 'followup_evidence_unavailable'],
    [{ test: true }, 'test_registration'],
    [{ seenAt: '2026-09-26T12:00:00Z' }, 'offer_followup_schedule_invalid'],
    [{ registration: { pays: 'Maroc', telephone: '+212600000000' } }, 'sms_country_not_allowed'],
    [{ cancelled: true }, 'spiffy_purchase_completed'],
    [{ cancelAtIntent: true }, 'job_cancelled'],
    [{ job: { provider_status: 'calling', attempts: 1 } }, 'gateway_attempt_already_started'],
    [{ job: { due_at: '2026-09-27T14:02:00Z' } }, 'not_due'],
  ];
  for (const [options, reason] of cases) {
    const state = fixture(options);
    const result = await processMc2SmsJob({ ...baseJob, ...options.job }, now);
    assert.equal(result.reason || result.status, reason, JSON.stringify(options));
    assert.equal(state.sends.length, 0, reason);
  }
  const stale = fixture();
  assert.equal((await processMc2SmsJob(baseJob, new Date('2026-09-27T14:10:01Z'))).reason, 'offer_sms_stale');
  assert.equal(stale.sends.length, 0);
  const failure = fixture({ gatewayFail: true });
  assert.equal((await processMc2SmsJob(baseJob, now)).status, 'failed_final');
  assert.equal((await processMc2SmsJob(baseJob, now)).status, 'not_claimed');
  assert.equal(failure.sends.length, 1);

  globalThis.fetch = async (url, request) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('message_type'), 'in.(offer_deadline,offer_followup)');
    assert.equal(u.searchParams.get('status'), 'in.(pending,retry,processing)');
    assert.equal(JSON.parse(request.body).skip_reason, 'purchase_completed');
    return Response.json([]);
  };
  assert.equal((await cancelMc2OfferSms(token)).ok, true);

  // A queue error must not interrupt the established SMS worker.
  process.env.MC2_SMS_ENABLED = 'true';
  let fetchedOriginalQueue = false;
  console.error = () => {};
  globalThis.fetch = async (url, request = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json({ message: 'schema not installed' }, { status: 404 });
    if (u.pathname.endsWith('/mc2_sms_jobs') && request.method === 'PATCH') return Response.json([]);
    if (u.pathname.endsWith('/mc2_sms_jobs')) { fetchedOriginalQueue = true; return Response.json([]); }
    throw new Error(`Unexpected scheduler request ${url}`);
  };
  assert.equal((await scheduled()).status, 200);
  assert.equal(fetchedOriginalQueue, true);
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}
console.log('MC2 H+2 SMS: mocked delivery, purchase guards, personal link, deduplication, default-off and scheduler isolation OK');
