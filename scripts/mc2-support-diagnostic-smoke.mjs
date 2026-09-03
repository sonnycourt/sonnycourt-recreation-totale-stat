import assert from 'node:assert/strict';
import handler, { authorizeMc2SupportRequest } from '../netlify/functions/mc2-support-diagnostic.js';
import { summarizeMc2SupportDiagnostic } from '../netlify/functions/lib/mc2-support-diagnostic.mjs';
import {
  parseEmail,
  requestMc2Diagnostic,
} from '../plugins/mc2-support/skills/mc2-support/scripts/diagnose.mjs';

const NOW = new Date('2026-08-28T10:00:00.000Z');
const secretToken = 'secret-registration-token-never-returned';

const summary = summarizeMc2SupportDiagnostic({
  now: NOW,
  registration: {
    token: secretToken,
    telephone: '+41790000000',
    pays: 'Canada',
    visitor_timezone: 'America/Toronto',
    slot_kind: 'scheduled',
    statut: 'present',
    registration_completed_at: '2026-08-27T17:35:00.000Z',
    session_starts_at: '2026-08-28T00:00:00.000Z',
    session_ends_at: '2026-08-28T02:00:00.000Z',
    session_page_view_count: 1,
    attended_live: true,
    session_joined_at: '2026-08-27T23:59:31.000Z',
    watch_max_seconds_live: 6088,
    watch_max_seconds_replay: 0,
    saw_offer: true,
    checkout_view_count: 1,
    checkout_engaged: false,
    purchased_at: null,
  },
  events: [
    { event_name: 'session_page_viewed', occurred_at: '2026-08-27T23:59:30.000Z' },
    { event_name: 'session_joined', occurred_at: '2026-08-27T23:59:31.000Z' },
    { event_name: 'cta_reached', occurred_at: '2026-08-28T01:39:00.000Z' },
    { event_name: 'checkout_actually_seen', occurred_at: '2026-08-28T01:39:01.000Z' },
  ],
  sessionEmails: [
    { message_type: 'registration_confirmation', status: 'delivered', due_at: '2026-08-27T17:35:00.000Z', delivered_at: '2026-08-27T17:35:05.000Z' },
  ],
});

assert.equal(summary.readOnly, true);
assert.equal(summary.diagnosis.status, 'healthy');
assert.match(summary.diagnosis.headline, /checkout/);
assert.equal(summary.journey.liveWatchSeconds, 6088);
assert.equal(summary.journey.offerSeen, true);
assert.equal(summary.journey.checkoutSeen, true);
assert.equal(summary.communications.delivered, 1);
assert.doesNotMatch(JSON.stringify(summary), /secret-registration-token|\+41790000000/);

const noShow = summarizeMc2SupportDiagnostic({
  now: NOW,
  registration: {
    slot_kind: 'scheduled',
    statut: 'registered',
    session_starts_at: '2026-08-27T00:00:00.000Z',
    session_ends_at: '2026-08-27T02:00:00.000Z',
  },
});
assert.equal(noShow.diagnosis.status, 'attention');
assert.match(noShow.diagnosis.headline, /no-show/);

const upcoming = summarizeMc2SupportDiagnostic({
  now: NOW,
  registration: {
    slot_kind: 'scheduled',
    statut: 'registered',
    session_starts_at: '2026-08-29T00:00:00.000Z',
    session_ends_at: '2026-08-29T02:00:00.000Z',
  },
});
assert.equal(upcoming.diagnosis.status, 'healthy');
assert.match(upcoming.diagnosis.headline, /pas encore commencé/);

const missing = summarizeMc2SupportDiagnostic({ registration: null, now: NOW });
assert.equal(missing.found, false);
assert.equal(missing.diagnosis.status, 'not_found');

const authRequest = new Request('https://sonnycourt.com/.netlify/functions/mc2-support-diagnostic', {
  method: 'POST',
  headers: { Authorization: 'Bearer valid-support-key-12345678901234567890' },
});
assert.equal(authorizeMc2SupportRequest(authRequest, {
  MC2_SUPPORT_API_KEYS: JSON.stringify({ brother: 'valid-support-key-12345678901234567890' }),
}), 'brother');
assert.equal(authorizeMc2SupportRequest(authRequest, {
  MC2_SUPPORT_API_KEYS: JSON.stringify({ brother: 'different-support-key-123456789012345' }),
}), null);
assert.equal(authorizeMc2SupportRequest(authRequest, { MC2_SUPPORT_API_KEYS: '{invalid' }), null);

assert.equal(parseEmail(['--email', 'Personne@Example.com']), 'personne@example.com');
assert.equal(parseEmail(['--email', 'adresse-invalide']), '');
let pluginAuthorization = '';
const pluginPayload = await requestMc2Diagnostic({
  email: 'personne@example.com',
  apiToken: 'valid-support-key-12345678901234567890',
  endpoint: 'https://example.test/mc2-support',
  fetchImpl: async (_url, options) => {
    pluginAuthorization = options.headers.Authorization;
    return new Response(JSON.stringify({ readOnly: true, found: true }));
  },
});
assert.equal(pluginPayload.readOnly, true);
assert.equal(pluginAuthorization, 'Bearer valid-support-key-12345678901234567890');

const previousFetch = globalThis.fetch;
const previousEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  MC2_SUPPORT_API_KEYS: process.env.MC2_SUPPORT_API_KEYS,
};

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';
process.env.MC2_SUPPORT_API_KEYS = JSON.stringify({ brother: 'valid-support-key-12345678901234567890' });

const requestedUrls = [];
globalThis.fetch = async (url) => {
  const value = String(url);
  requestedUrls.push(value);
  if (value.includes('/mc2_registrations?')) {
    return new Response(JSON.stringify([{
      token: secretToken,
      telephone: '+41790000000',
      pays: 'Canada',
      visitor_timezone: 'America/Toronto',
      slot_kind: 'scheduled',
      statut: 'registered',
      registered_at: '2026-08-27T17:35:00.000Z',
      session_starts_at: '2026-08-28T00:00:00.000Z',
      session_ends_at: '2026-08-28T02:00:00.000Z',
      session_page_view_count: 0,
      attended_live: false,
      watch_max_seconds_live: 0,
      watch_max_seconds_replay: 0,
      saw_offer: false,
      checkout_view_count: 0,
      checkout_engaged: false,
      purchased_at: null,
    }]));
  }
  return new Response('[]');
};

try {
  const unauthorized = await handler(new Request('https://sonnycourt.com/.netlify/functions/mc2-support-diagnostic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'personne@example.com' }),
  }));
  assert.equal(unauthorized.status, 401);

  const readAttempt = await handler(new Request('https://sonnycourt.com/.netlify/functions/mc2-support-diagnostic', {
    method: 'GET',
    headers: { Authorization: 'Bearer valid-support-key-12345678901234567890' },
  }));
  assert.equal(readAttempt.status, 405);

  const response = await handler(new Request('https://sonnycourt.com/.netlify/functions/mc2-support-diagnostic', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-support-key-12345678901234567890',
    },
    body: JSON.stringify({ email: 'personne@example.com' }),
  }));

  assert.ok(
    requestedUrls.some((url) => url.includes('mc2_registrations?email=eq.personne%40example.com')),
    'registration lookup must use an exact normalized email match',
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  const body = await response.text();
  assert.doesNotMatch(body, /personne@example\.com|secret-registration-token|\+41790000000|service-role-secret/);
  assert.equal(JSON.parse(body).readOnly, true);
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('mc2 support diagnostic smoke: ok');
