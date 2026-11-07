import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  mc2FunnelMetaEvents,
  mc2MetaRequestContext,
  mc2RegistrationMetaEvents,
  sendMc2MetaEvents,
} from '../netlify/functions/lib/mc2-meta-events.mjs';

const metaRegistration = {
  token: '11111111-2222-4333-8444-555555555555',
  email: 'lead@example.com',
  telephone: '+33 6 12 34 56 78',
  traffic_source: 'meta_ad',
  meta_fbc: 'fb.1.123.click',
  meta_fbp: 'fb.1.123.browser',
  meta_event_id: 'browser-lead-id',
  optin_variant: 'meta_v2_test',
};

assert.deepEqual(mc2RegistrationMetaEvents({ ...metaRegistration, traffic_source: null }, {
  created: true,
  completedNow: true,
}), []);
assert.deepEqual(
  mc2RegistrationMetaEvents(metaRegistration, { created: true }).map((event) => event.eventName),
  ['EmailCaptured'],
);
assert.deepEqual(
  mc2RegistrationMetaEvents(metaRegistration, { completedNow: true }).map((event) => [event.eventName, event.eventId]),
  [['Lead', 'browser-lead-id']],
);

assert.deepEqual(
  mc2FunnelMetaEvents({ eventName: 'session_joined', registration: metaRegistration }).map((event) => event.eventName),
  ['QualifiedLead'],
);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'session_joined',
  registration: { ...metaRegistration, attended_live: true },
}), []);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 30,
  meta: { percent: 31, duration_seconds: 8048 },
  registration: { ...metaRegistration, watch_max_minutes: 15 },
}).map((event) => event.eventName), ['QualifiedView25']);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 60,
  meta: { percent: 63, duration_seconds: 8048 },
  registration: { ...metaRegistration, watch_max_minutes: 34 },
}).map((event) => event.eventName), ['QualifiedView50']);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 75,
  meta: { percent: 79, duration_seconds: 8048 },
  registration: { ...metaRegistration, watch_max_minutes: 68 },
}).map((event) => event.eventName), ['QualifiedView75']);
assert.deepEqual(
  mc2FunnelMetaEvents({
    eventName: 'cta_reached',
    meta: { offer_event_id: 'mc2-offer-browser-session' },
    registration: metaRegistration,
  }),
  [{
    eventName: 'OfferViewed',
    eventId: 'mc2-offer-browser-session',
    contentName: 'Masterclass ES2 - Offre',
  }],
);
const organicRegistration = {
  ...metaRegistration,
  traffic_source: null,
  meta_fbc: null,
  meta_fbp: null,
};
assert.deepEqual(
  mc2FunnelMetaEvents({
    eventName: 'cta_reached',
    meta: { offer_event_id: 'mc2-offer-organic-session' },
    registration: organicRegistration,
  }),
  [{
    eventName: 'OfferViewed',
    eventId: 'mc2-offer-organic-session',
    contentName: 'Masterclass ES2 - Offre',
  }],
);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'session_joined',
  registration: organicRegistration,
}), []);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'cta_reached',
  meta: { offer_event_id: 'mc2-offer-browser-session' },
  registration: { ...metaRegistration, saw_offer: true },
}), []);
assert.deepEqual(
  mc2FunnelMetaEvents({ eventName: 'cta_clicked', registration: metaRegistration }).map((event) => event.eventName),
  ['CTA_Clicked'],
);
assert.deepEqual(
  mc2FunnelMetaEvents({ eventName: 'checkout_viewed', registration: metaRegistration }).map((event) => event.eventName),
  ['InitiateCheckout'],
);

// Replay : la position précédente vient du replay, pas de la colonne live.
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 61,
  meta: { previous_minutes: 60, duration_seconds: 6707 },
  registration: { ...metaRegistration, watch_max_minutes: 0 },
}), [], 'Un ping replay après le palier ne doit pas le renvoyer');
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 60,
  meta: { previous_minutes: 30, duration_seconds: 6707 },
  registration: { ...metaRegistration, watch_max_minutes: 0 },
}).map((event) => event.eventName), ['QualifiedView50']);

const req = new Request('https://sonnycourt.com/.netlify/functions/register-mc2', {
  headers: {
    referer: 'https://sonnycourt.com/meta/masterclass/',
    'x-nf-client-connection-ip': '203.0.113.20',
    'user-agent': 'MC2 smoke',
  },
});
assert.deepEqual(mc2MetaRequestContext(req), {
  ip: '203.0.113.20',
  userAgent: 'MC2 smoke',
  url: 'https://sonnycourt.com/meta/masterclass/',
});

const previousFetch = globalThis.fetch;
const previousToken = process.env.META_ACCESS_TOKEN;
const previousPixel = process.env.META_PIXEL_ID;
const previousContext = process.env.CONTEXT;
let capiRequest = null;
process.env.META_ACCESS_TOKEN = 'test-access-token';
process.env.META_PIXEL_ID = '3367958190030822';
delete process.env.CONTEXT;
globalThis.fetch = async (url, options) => {
  capiRequest = { url: String(url), options };
  return new Response(JSON.stringify({ events_received: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

await sendMc2MetaEvents({
  events: mc2RegistrationMetaEvents(metaRegistration, { completedNow: true }),
  registration: metaRegistration,
  req,
});
assert.match(capiRequest.url, /\/3367958190030822\/events$/);
const capiBody = JSON.parse(capiRequest.options.body);
assert.equal(capiBody.data[0].event_name, 'Lead');
assert.equal(capiBody.data[0].event_id, 'browser-lead-id');
assert.equal(capiBody.data[0].event_source_url, 'https://sonnycourt.com/meta/masterclass/');
assert.equal(Array.isArray(capiBody.data[0].user_data.external_id), true);
assert.equal(capiBody.data[0].user_data.external_id[0].length, 64);
assert.equal(capiRequest.options.body.includes('lead@example.com'), false);
assert.equal(capiRequest.options.body.includes('+33 6 12 34 56 78'), false);

await sendMc2MetaEvents({
  events: mc2FunnelMetaEvents({
    eventName: 'cta_reached',
    meta: { offer_event_id: 'mc2-offer-browser-session' },
    registration: metaRegistration,
  }),
  registration: metaRegistration,
  req,
  pagePath: '/mc2/session/',
});
const offerCapiBody = JSON.parse(capiRequest.options.body);
assert.equal(offerCapiBody.data[0].event_name, 'OfferViewed');
assert.equal(offerCapiBody.data[0].event_id, 'mc2-offer-browser-session');
assert.equal(offerCapiBody.data[0].event_source_url, 'https://sonnycourt.com/mc2/session/');

capiRequest = null;
await sendMc2MetaEvents({
  events: mc2FunnelMetaEvents({
    eventName: 'cta_reached',
    meta: { offer_event_id: 'mc2-offer-organic-session' },
    registration: organicRegistration,
  }),
  registration: organicRegistration,
  req,
  pagePath: '/mc2/replay/',
});
const organicOfferCapiBody = JSON.parse(capiRequest.options.body);
assert.equal(organicOfferCapiBody.data[0].event_name, 'OfferViewed');
assert.equal(organicOfferCapiBody.data[0].event_id, 'mc2-offer-organic-session');
assert.equal(organicOfferCapiBody.data[0].event_source_url, 'https://sonnycourt.com/mc2/replay/');

capiRequest = null;
await sendMc2MetaEvents({
  events: [{
    eventName: 'Lead',
    eventId: 'organic-lead-must-not-send',
    contentName: 'Masterclass ES2',
  }],
  registration: organicRegistration,
  req,
});
assert.equal(capiRequest, null);

// Envoi immédiat refusé par Meta : l'événement part dans la file durable,
// avec le même event_id. Succès confirmé : rien n'est mis en file.
const previousSupabaseUrl = process.env.SUPABASE_URL;
const previousSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
let outboxInsert = null;
let metaStatus = 500;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'graph.facebook.com') {
    capiRequest = { url: String(url), options };
    return new Response(JSON.stringify(metaStatus === 200 ? { events_received: 1 } : { error: { message: 'fixture' } }), {
      status: metaStatus, headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(parsed.hostname, 'database.invalid');
  assert.ok(parsed.pathname.endsWith('/mc2_tracking_meta_outbox'));
  assert.equal(options.method, 'POST');
  assert.equal(parsed.searchParams.get('on_conflict'), 'delivery_key');
  assert.match(String(options.headers.Prefer), /ignore-duplicates/);
  outboxInsert = JSON.parse(options.body);
  return new Response('', { status: 201 });
};
const failedResults = await sendMc2MetaEvents({
  events: mc2RegistrationMetaEvents(metaRegistration, { completedNow: true }),
  registration: metaRegistration,
  req,
  context: { ip: '198.51.100.7', userAgent: 'Webhook fixture', url: 'https://sonnycourt.com/mc2/session/' },
  value: 197,
  currency: 'EUR',
});
assert.equal(failedResults[0].fallbackQueued, true);
assert.equal(outboxInsert.delivery_key, `immediate:${metaRegistration.token}:Lead:browser-lead-id`);
assert.equal(outboxInsert.event_id, 'browser-lead-id');
assert.equal(outboxInsert.status, 'pending');
assert.deepEqual(outboxInsert.context, {
  source: 'immediate_fallback',
  ip: '198.51.100.7',
  userAgent: 'Webhook fixture',
  url: 'https://sonnycourt.com/mc2/session/',
  contentName: 'Masterclass ES2',
  value: 197,
  currency: 'EUR',
});
const overriddenBody = JSON.parse(capiRequest.options.body);
assert.equal(overriddenBody.data[0].user_data.client_ip_address, '198.51.100.7');
assert.equal(overriddenBody.data[0].user_data.client_user_agent, 'Webhook fixture');
assert.equal(overriddenBody.data[0].event_source_url, 'https://sonnycourt.com/mc2/session/');
assert.equal(overriddenBody.data[0].custom_data.value, 197);

outboxInsert = null;
metaStatus = 200;
const okResults = await sendMc2MetaEvents({
  events: mc2RegistrationMetaEvents(metaRegistration, { completedNow: true }),
  registration: metaRegistration,
  req,
});
assert.equal(okResults[0].ok, true);
assert.equal(outboxInsert, null, 'Un envoi confirmé ne passe pas par la file');

if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
else process.env.SUPABASE_URL = previousSupabaseUrl;
if (previousSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseKey;
globalThis.fetch = async (url, options) => {
  capiRequest = { url: String(url), options };
  return new Response(JSON.stringify({ events_received: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

process.env.CONTEXT = 'deploy-preview';
capiRequest = null;
await sendMc2MetaEvents({
  events: mc2RegistrationMetaEvents(metaRegistration, { completedNow: true }),
  registration: metaRegistration,
  req,
});
assert.equal(capiRequest, null);

globalThis.fetch = previousFetch;
if (previousToken === undefined) delete process.env.META_ACCESS_TOKEN;
else process.env.META_ACCESS_TOKEN = previousToken;
if (previousPixel === undefined) delete process.env.META_PIXEL_ID;
else process.env.META_PIXEL_ID = previousPixel;
if (previousContext === undefined) delete process.env.CONTEXT;
else process.env.CONTEXT = previousContext;

const adapter = await readFile(new URL('../src/components/Mc2PaidOptinAdapter.astro', import.meta.url), 'utf8');
const register = await readFile(new URL('../netlify/functions/register-mc2.js', import.meta.url), 'utf8');
const tracker = await readFile(new URL('../netlify/functions/track-mc2-event.js', import.meta.url), 'utf8');
const registrationReader = await readFile(new URL('../netlify/functions/get-mc2-registration.js', import.meta.url), 'utf8');
const router = await readFile(new URL('../netlify/functions/lib/mc2-pay-router.mjs', import.meta.url), 'utf8');
const optinTracker = await readFile(new URL('../netlify/functions/track-mc2-optin.js', import.meta.url), 'utf8');
const organicOptin = await readFile(new URL('../src/pages/mc2/index.astro', import.meta.url), 'utf8');
const sessionPage = await readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const replayPage = await readFile(new URL('../src/pages/mc2/replay.astro', import.meta.url), 'utf8');
const replayTracker = await readFile(new URL('../netlify/functions/mc2-replay-track.js', import.meta.url), 'utf8');
const replayRecovery = await readFile(new URL('../netlify/functions/lib/mc2-replay-recovery.mjs', import.meta.url), 'utf8');
const offerBackfill = await readFile(new URL('../netlify/functions/admin-mc2-meta-offer-backfill.js', import.meta.url), 'utf8');

assert.match(adapter, /fbq\('track', 'Lead',[\s\S]*eventID: event\.eventId/);
assert.match(adapter, /fbq\('trackCustom', event\.eventName,[\s\S]*eventID: event\.eventId/);
assert.match(register, /completedNow: isComplete && !completedBefore/);
assert.match(register, /offer_expires_at: null/);
assert.match(tracker, /mc2FunnelMetaEvents/);
assert.match(tracker, /browserMetaEvents = meta\.offer_event_id/);
assert.match(tracker, /metaEvents: browserMetaEvents/);
assert.match(registrationReader, /metaTrackingEligible: row\.traffic_source === 'meta_ad'/);
assert.match(router, /eventName: 'Purchase'/);
assert.match(router, /value: Number\(session\.amount_total \|\| expectedInitial\) \/ 100/);
assert.match(optinTracker, /'\/meta\/masterclass\/'/);
assert.match(organicOptin, /fetch\('\/\.netlify\/functions\/track-mc2-optin'/);
assert.match(sessionPage, /const offerViewedEventId = getOfferViewedEventId\(reg\)/);
assert.match(sessionPage, /if \(reg\.metaTrackingEligible && window\.__mc2JourneyV2\?\.schema !== 2\) \{\s*fireMetaBrowserEvents\(\[\{/);
for (const eventName of ['cta_reached', 'video_checkpoint']) {
  assert.deepEqual(mc2FunnelMetaEvents({ eventName, value: 99, meta: { tracking_schema: 2 }, registration: metaRegistration }), [], 'Legacy clocks must not contaminate v2 Meta observations');
}
assert.match(sessionPage, /trackWebinaireEvent\(reg\.token, 'cta_reached', undefined, \{\s*offer_event_id: offerViewedEventId/);
assert.match(sessionPage, /fireMetaBrowserEvents\(result\?\.metaEvents\)/);
assert.match(sessionPage, /fbq\('trackCustom', event\.eventName,[\s\S]*eventID: event\.eventId/);
assert.match(sessionPage, /'mc2_offer_event_id_' \+ String\(registration\?\.token/);
assert.match(sessionPage, /pageStorage\.getItem\(storageKey\) === '1'/);
assert.match(replayPage, /trackWebinaireEvent\(token, 'cta_reached'\)/);
assert.match(replayTracker, /mc2FunnelMetaEvents\(\{[\s\S]*eventName: funnelEventName/);
assert.match(replayTracker, /sendMc2MetaEvents\(\{[\s\S]*pagePath: '\/mc2\/replay\/'/);
assert.match(replayRecovery, /select=token,session_generation,email,prenom,telephone,pays,traffic_source,meta_fbc,meta_fbp,optin_variant,/);
assert.match(replayTracker, /previous_minutes: second\(access\.registration\.watch_max_seconds_replay\) \/ 60/);
assert.match(offerBackfill, /getSessionFromRequest\(req\)/);
assert.match(offerBackfill, /const MAX_EXPECTED = 5/);
assert.match(offerBackfill, /registration\.saw_offer !== true \|\| purchased\(registration\)/);
assert.match(offerBackfill, /eventName: 'OfferViewed'/);

const confirmationPage = await readFile(new URL('../src/pages/mc2/confirmation.astro', import.meta.url), 'utf8');
const successPage = await readFile(new URL('../src/pages/commencer/succes.astro', import.meta.url), 'utf8');
const pixelComponent = await readFile(new URL('../src/components/mc2/Mc2MetaPixelPageView.astro', import.meta.url), 'utf8');
assert.match(confirmationPage, /<Mc2MetaPixelPageView \/>/);
assert.match(successPage, /<Mc2MetaPixelPageView \/>/);
assert.match(pixelComponent, /fbq\('init', '3367958190030822'\)/);
assert.match(pixelComponent, /fbq\('track', 'PageView'\)/);
assert.doesNotMatch(pixelComponent, /fbq\(['"]track(?:Custom)?['"],\s*['"](?:Purchase|Lead)/, 'La page ne doit recompter aucun événement métier');

console.log('mc2 meta events smoke: ok');
