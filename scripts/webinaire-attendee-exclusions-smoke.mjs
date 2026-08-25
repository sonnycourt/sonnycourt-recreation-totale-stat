import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  excludeWebinarAttendee,
  excludeWebinarBuyer,
  isWebinarBuyerStatus,
  isWebinarRegistrationExclusion,
} from '../netlify/functions/lib/webinaire-exclusions.mjs';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';

let request = null;
globalThis.fetch = async (url, options) => {
  request = { url: String(url), options };
  return new Response(null, { status: 201 });
};

const result = await excludeWebinarAttendee(' TEST@Example.COM ', 'participant_mc2');
assert.equal(result.ok, true);
assert.match(request.url, /webinaire_exclusions\?on_conflict=email$/);
assert.match(request.options.headers.Prefer, /resolution=ignore-duplicates/);
assert.deepEqual(JSON.parse(request.options.body), {
  email: 'test@example.com',
  raison: 'participant_mc2',
});

const buyerResult = await excludeWebinarBuyer('buyer@example.com');
assert.equal(buyerResult.ok, true);
assert.match(request.options.headers.Prefer, /resolution=merge-duplicates/);
assert.deepEqual(JSON.parse(request.options.body), {
  email: 'buyer@example.com',
  raison: 'acheteur_es',
});
assert.equal(isWebinarRegistrationExclusion('inscrit_mc2'), true);
assert.equal(isWebinarRegistrationExclusion('participant_webinaire'), true);
assert.equal(isWebinarRegistrationExclusion('acheteur_es'), false);
assert.equal(isWebinarBuyerStatus({ statut: 'purchased' }), true);
assert.equal(isWebinarBuyerStatus({ payment_status: 'paid' }), true);
assert.equal(isWebinarBuyerStatus({ statut: 'registered' }), false);

const legacy = await readFile(new URL('../netlify/functions/update-webinaire-status.js', import.meta.url), 'utf8');
const mc2 = await readFile(new URL('../netlify/functions/track-mc2-event.js', import.meta.url), 'utf8');
const replay = await readFile(new URL('../netlify/functions/mc2-replay-track.js', import.meta.url), 'utf8');
const spiffy = await readFile(new URL('../netlify/functions/spiffy-purchase-webhook.js', import.meta.url), 'utf8');
assert.match(legacy, /statut === 'present'/);
assert.match(legacy, /excludeWebinarAttendee\(email, 'participant_webinaire'\)/);
assert.match(mc2, /eventName === 'session_joined'/);
assert.match(mc2, /excludeWebinarAttendee\(row\.email, 'participant_mc2'\)/);
assert.match(replay, /excludeWebinarAttendee\(access\.registration\.email, 'participant_mc2'\)/);
assert.match(spiffy, /excludeWebinarBuyer\(email, 'acheteur_es'\)/);

console.log('webinaire attendee exclusions smoke: ok');
