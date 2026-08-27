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
  meta: { percent: 31, duration_seconds: 7103 },
  registration: { ...metaRegistration, watch_max_minutes: 15 },
}).map((event) => event.eventName), ['QualifiedView25']);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 60,
  meta: { percent: 63, duration_seconds: 7103 },
  registration: { ...metaRegistration, watch_max_minutes: 30 },
}).map((event) => event.eventName), ['QualifiedView50']);
assert.deepEqual(mc2FunnelMetaEvents({
  eventName: 'video_checkpoint',
  value: 75,
  meta: { percent: 79, duration_seconds: 7103 },
  registration: { ...metaRegistration, watch_max_minutes: 60 },
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
assert.match(tracker, /mc2FunnelMetaEvents/);
assert.match(tracker, /browserMetaEvents = meta\.offer_event_id/);
assert.match(tracker, /metaEvents: browserMetaEvents/);
assert.match(registrationReader, /metaTrackingEligible: row\.traffic_source === 'meta_ad'/);
assert.match(router, /eventName: 'Purchase'/);
assert.match(router, /value: Number\(session\.amount_total \|\| expectedInitial\) \/ 100/);
assert.match(optinTracker, /'\/meta\/masterclass\/'/);
assert.match(organicOptin, /fetch\('\/\.netlify\/functions\/track-mc2-optin'/);
assert.match(sessionPage, /const offerViewedEventId = getOfferViewedEventId\(reg\)/);
assert.match(sessionPage, /if \(reg\.metaTrackingEligible\) \{\s*fireMetaBrowserEvents\(\[\{/);
assert.match(sessionPage, /trackWebinaireEvent\(reg\.token, 'cta_reached', undefined, \{\s*offer_event_id: offerViewedEventId/);
assert.match(sessionPage, /fireMetaBrowserEvents\(result\?\.metaEvents\)/);
assert.match(sessionPage, /fbq\('trackCustom', event\.eventName,[\s\S]*eventID: event\.eventId/);
assert.match(sessionPage, /'mc2_offer_event_id_' \+ String\(registration\?\.token/);
assert.match(sessionPage, /localStorage\.getItem\(storageKey\) === '1'/);
assert.match(replayPage, /trackWebinaireEvent\(token, 'cta_reached'\)/);
assert.match(replayTracker, /mc2FunnelMetaEvents\(\{[\s\S]*eventName: funnelEventName/);
assert.match(replayTracker, /sendMc2MetaEvents\(\{[\s\S]*pagePath: '\/mc2\/replay\/'/);
assert.match(replayRecovery, /select=token,email,prenom,telephone,pays,traffic_source,meta_fbc,meta_fbp,optin_variant,/);
assert.match(offerBackfill, /getSessionFromRequest\(req\)/);
assert.match(offerBackfill, /const MAX_EXPECTED = 5/);
assert.match(offerBackfill, /registration\.saw_offer !== true \|\| purchased\(registration\)/);
assert.match(offerBackfill, /eventName: 'OfferViewed'/);

console.log('mc2 meta events smoke: ok');
