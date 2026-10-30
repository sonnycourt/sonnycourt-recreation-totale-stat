import assert from 'node:assert/strict';
import { mc2SessionH1SmsEnabled, queueDueMc2SessionH1Sms, sessionH1SkipReason } from '../netlify/functions/lib/mc2-session-h1-sms.mjs';
import { mc2OfferH1SmsEnabled, mc2SmsMessage, processMc2SmsJob } from '../netlify/functions/lib/mc2-sms.mjs';
import scheduled from '../netlify/functions/mc2-sms-scheduled.js';
import redirect from '../netlify/functions/mc2-live-redirect.js';

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
const savedError = console.error;
const now = new Date('2026-10-30T10:00:00Z');
const job = { id: 1, token: 'smoke-only', message_type: 'session_h1', due_at: now.toISOString(), attempts: 0, status: 'pending' };
const registration = {
  token: job.token, slot_kind: 'scheduled', session_starts_at: '2026-10-30T11:00:00Z',
  registration_completed_at: '2026-10-29T15:00:00Z', sms_consent_at: '2026-10-29T15:00:00Z',
  telephone: '+33612345678', pays: 'France', statut: 'registered',
};
const expected = 'Ta masterclass avec Sonny commence dans 1 heure !\nReserve ce moment pour toi.\nTon lien pour nous rejoindre :\nhttps://sonnycourt.com/live/A1b2C?r=h1';

function fixture(options = {}) {
  const state = { row: { ...job, ...options.job }, sends: [], events: [], reads: 0 };
  globalThis.fetch = async (url, request = {}) => {
    const u = new URL(url);
    const body = request.body ? JSON.parse(request.body) : null;
    if (u.hostname === 'messaging.gatewayapi.com') {
      state.sends.push(body);
      if (options.networkFailure) throw new Error('ambiguous_network_failure');
      return Response.json({ id: 'mock-only' });
    }
    assert.equal(u.hostname, 'supabase.test', 'No real network allowed');
    if (u.pathname.endsWith('/mc2_registrations')) {
      state.reads += 1;
      return Response.json([{ ...registration, ...options.registration, ...(state.reads > 1 ? options.race : {}) }]);
    }
    if (u.pathname.endsWith('/mc2_funnel_events') && request.method === 'POST') {
      state.events.push(body); return Response.json([]);
    }
    if (u.pathname.endsWith('/mc2_sms_jobs')) {
      if (request.method === 'PATCH') {
        if (body.status === 'processing' && !['pending', 'retry'].includes(state.row.status)) return Response.json([]);
        if (body.provider_status === 'calling' && options.cancelAtIntent) return Response.json([]);
        Object.assign(state.row, body); return Response.json([{ ...state.row }]);
      }
      if (u.searchParams.get('message_type') === 'eq.session_live') {
        assert.equal(u.searchParams.get('due_at'), `eq.${registration.session_starts_at}`);
        return Response.json([{ id: 123, token: job.token, live_code: 'A1b2C' }]);
      }
      if (u.searchParams.get('select') === 'status,skip_reason') return Response.json([state.row]);
    }
    throw new Error(`Unexpected mock request ${request.method || 'GET'} ${url}`);
  };
  return state;
}

try {
  Object.assign(process.env, { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'dummy', GATEWAYAPI_TOKEN: 'dummy', MC2_PUBLIC_ORIGIN: 'https://sonnycourt.com', MC2_SMS_COUNTRY_FILTER_ENABLED: 'false', MC2_OFFER_H1_SMS_ENABLED: 'true' });
  delete process.env.MC2_SESSION_H1_SMS_ENABLED;
  globalThis.fetch = async () => { throw new Error('Disabled means no network'); };
  assert.equal(mc2SessionH1SmsEnabled(), false);
  assert.equal(mc2OfferH1SmsEnabled(), true, 'old strategy preserved until activation');
  assert.deepEqual(await queueDueMc2SessionH1Sms(now), { ok: true, enabled: false, queued: 0 });
  const disabled = fixture();
  assert.equal((await processMc2SmsJob(job, now)).reason, 'session_h1_sms_disabled');
  assert.equal(disabled.sends.length, 0);
  process.env.MC2_SESSION_H1_SMS_ENABLED = 'true';
  assert.equal(mc2OfferH1SmsEnabled(), false, 'activation stops the deadline SMS');
  assert.equal(mc2SmsMessage('session_h1', job.token, { liveCode: 'A1b2C' }), expected);
  assert.ok(expected.length <= 160, `Single GSM segment: ${expected.length}`);
  assert.match(mc2SmsMessage('session_live', job.token, { liveCode: 'A1b2C' }), /live\/A1b2C$/);
  assert.equal(sessionH1SkipReason(registration, job, now), null);

  globalThis.fetch = async (url, request) => {
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/queue_mc2_session_h1_sms');
    assert.deepEqual(JSON.parse(request.body), { p_now: now.toISOString() });
    return Response.json(2);
  };
  assert.equal((await queueDueMc2SessionH1Sms(now)).queued, 2);
  assert.equal((await queueDueMc2SessionH1Sms('bad-date')).ok, false);

  const success = fixture();
  assert.equal((await processMc2SmsJob(job, now)).status, 'sent');
  assert.equal((await processMc2SmsJob(job, now)).status, 'not_claimed');
  assert.equal(success.sends.length, 1);
  assert.equal(success.sends[0].message, expected);
  assert.equal(success.events[0].event_name, 'sms_session_h1_sent');
  assert.equal(success.reads, 2);

  for (const [options, reason] of [
    [{ registration: { slot_kind: 'jit' } }, 'session_h1_not_scheduled'],
    [{ registration: { sms_consent_at: null } }, 'sms_consent_missing'],
    [{ registration: { telephone: 'invalid' } }, 'phone_invalid'],
    [{ registration: { registration_completed_at: null } }, 'session_h1_late_registration'],
    [{ registration: { registration_completed_at: '2026-10-30T10:00:01Z' } }, 'session_h1_late_registration'],
    [{ registration: { session_starts_at: '2026-10-30T20:00:00Z' } }, 'session_h1_rescheduled'],
    [{ registration: { entry_payment_required: true } }, 'entry_payment_pending'],
    [{ registration: { payment_status: 'paid' } }, 'already_purchased'],
    [{ race: { session_starts_at: '2026-10-31T11:00:00Z' } }, 'session_h1_rescheduled'],
    [{ race: { sms_consent_at: null } }, 'sms_consent_missing'],
    [{ race: { payment_status: 'paid' } }, 'already_purchased'],
    [{ job: { provider_status: 'calling' } }, 'gateway_attempt_already_started'],
    [{ job: { due_at: '2026-10-30T10:01:00Z' } }, 'not_due'],
    [{ cancelAtIntent: true }, 'job_cancelled'],
  ]) {
    const state = fixture(options);
    const result = await processMc2SmsJob({ ...job, ...options.job }, now);
    assert.equal(result.reason || result.status, reason);
    assert.equal(state.sends.length, 0, reason);
  }
  const stale = fixture();
  assert.equal((await processMc2SmsJob(job, new Date('2026-10-30T10:10:01Z'))).reason, 'session_h1_stale');
  assert.equal(stale.sends.length, 0);
  const deadline = fixture();
  assert.equal((await processMc2SmsJob({ ...job, message_type: 'offer_deadline' }, now)).reason, 'offer_h1_sms_disabled');
  assert.equal(deadline.sends.length, 0);
  const failure = fixture({ networkFailure: true });
  assert.equal((await processMc2SmsJob(job, now)).status, 'failed_final');
  assert.equal((await processMc2SmsJob(job, now)).status, 'not_claimed');
  assert.equal(failure.sends.length, 1);

  const clicks = [];
  globalThis.fetch = async (url, request = {}) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'supabase.test');
    if (u.pathname.endsWith('/mc2_sms_jobs')) return Response.json([{ id: 123, token: job.token }]);
    if (u.pathname.endsWith('/mc2_funnel_events')) { clicks.push(JSON.parse(request.body)); return Response.json([]); }
    throw new Error('Unexpected redirect request');
  };
  for (const suffix of ['?r=h1', '']) {
    const response = await redirect(new Request(`https://sonnycourt.com/live/A1b2C${suffix}`));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), '/mc2/session/');
    assert.match(response.headers.get('Set-Cookie'), /mc2_registration_token=smoke-only/);
  }
  assert.deepEqual(clicks.map(e => e.event_name), ['sms_session_h1_link_clicked', 'sms_live_link_clicked']);
  assert.notEqual(clicks[0].dedupe_key, clicks[1].dedupe_key);

  process.env.MC2_SMS_ENABLED = 'true';
  console.error = () => {};
  let liveQueueRead = false;
  globalThis.fetch = async (url, request = {}) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'supabase.test');
    if (u.pathname.includes('/rpc/')) return Response.json({ message: 'missing migration' }, { status: 404 });
    if (u.pathname.endsWith('/mc2_sms_jobs')) {
      if (request.method !== 'PATCH') liveQueueRead = true;
      return Response.json([]);
    }
    throw new Error('Unexpected scheduler request');
  };
  assert.equal((await scheduled()).status, 200);
  assert.equal(liveQueueRead, true);
} finally {
  globalThis.fetch = savedFetch; console.error = savedError;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
console.log('Session H-1: mocked sends, default-off, strategy switch, eligibility, race guards, deduplication, separate click tracking and scheduler isolation OK');
