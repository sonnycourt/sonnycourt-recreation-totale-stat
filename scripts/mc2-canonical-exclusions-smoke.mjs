import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import checkMc2Eligibility from '../netlify/functions/check-mc2-eligibility.js';
import checkWebinaireEligibility from '../netlify/functions/check-webinaire-eligibility.js';
import registerMc2 from '../netlify/functions/register-mc2.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';

let scenario = {};
let requests = [];
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  requests.push({ url, method: options.method || 'GET', body: options.body || null });
  let rows = [];
  if (url.includes('/webinaire_exclusions?')) rows = scenario.exclusions || [];
  else if (url.includes('/mc2_registrations?')) rows = scenario.mc2 || [];
  else if (url.includes('/webinaire_registrations?')) rows = scenario.legacy || [];
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

async function post(handler, email = 'test@example.com') {
  const response = await handler(new Request('https://sonnycourt.com/.netlify/functions/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }));
  return { status: response.status, body: await response.json() };
}

const completedMc2 = {
  token: 'mc2-token',
  statut: 'registered',
  registration_completed_at: '2026-08-20T12:00:00.000Z',
  session_starts_at: '2026-08-20T20:00:00.000Z',
  session_ends_at: '2026-08-20T21:15:00.000Z',
  offer_expires_at: null,
};

scenario = { exclusions: [{ raison: 'inscrit_mc2' }], mc2: [completedMc2] };
let result = await post(checkMc2Eligibility);
assert.equal(result.body.reason, 'already_registered');
assert.equal(result.body.token, 'mc2-token');

scenario = { exclusions: [{ raison: 'manuel' }], mc2: [completedMc2] };
result = await post(checkMc2Eligibility);
assert.equal(result.body.reason, 'excluded');

scenario = { exclusions: [], mc2: [], legacy: [{ token: 'legacy-token', statut: 'inscrit' }] };
result = await post(checkMc2Eligibility);
assert.equal(result.body.reason, 'excluded');

scenario = { exclusions: [], mc2: [], legacy: [] };
result = await post(checkMc2Eligibility);
assert.equal(result.body.eligible, true);

const legacyRegistration = {
  token: 'legacy-token',
  statut: 'inscrit',
  session_date: '2026-08-20T20:00:00.000Z',
  session_ends_at: '2026-08-20T21:15:00.000Z',
  offre_expires_at: '2026-08-21T20:00:00.000Z',
};
scenario = { exclusions: [{ raison: 'inscrit_webinaire' }], legacy: [legacyRegistration] };
result = await post(checkWebinaireEligibility);
assert.equal(result.body.reason, 'already_registered');
assert.equal(result.body.token, 'legacy-token');

scenario = { exclusions: [{ raison: 'acheteur_es' }], legacy: [legacyRegistration] };
result = await post(checkWebinaireEligibility);
assert.equal(result.body.reason, 'excluded');

const nextQuarterMs = Math.ceil((Date.now() + 1_000) / (15 * 60_000)) * (15 * 60_000);
scenario = { exclusions: [{ raison: 'inscrit_mc2' }], mc2: [completedMc2], legacy: [] };
requests = [];
const registerResponse = await registerMc2(new Request('https://sonnycourt.com/.netlify/functions/register-mc2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'test@example.com',
    prenom: 'Test',
    telephone: '+33600000000',
    pays: 'France',
    creneau: 'jit',
    session_starts_at: new Date(nextQuarterMs).toISOString(),
    slot_kind: 'jit',
    visitor_timezone: 'UTC',
  }),
}));
assert.equal(registerResponse.status, 409);
const registerBody = await registerResponse.json();
assert.equal(registerBody.token, 'mc2-token');
assert.equal(requests.some((request) => request.method === 'PATCH'), false);

const registerMc2Source = await readFile(new URL('../netlify/functions/register-mc2.js', import.meta.url), 'utf8');
const registerLegacy = await readFile(new URL('../netlify/functions/register-webinaire.js', import.meta.url), 'utf8');
const backfill = await readFile(new URL('../sql/webinaire_exclusions_canonical_backfill.sql', import.meta.url), 'utf8');
assert.match(registerMc2Source, /return jsonResponse\(409, registrationResponse\(existingRow, true\)\)/);
assert.match(registerMc2Source, /persistMc2RegistrationExclusion\(completedRow\)/);
assert.match(registerMc2Source, /webinaire_registrations\?email=eq\./);
assert.match(registerLegacy, /excludeWebinarAttendee\(email, 'inscrit_webinaire'\)/);
assert.match(backfill, /on conflict \(email\) do update/);
assert.match(backfill, /registration_completed_at is not null/);

console.log(JSON.stringify({
  canonical_table: 'webinaire_exclusions',
  mc2_completed_registration: 'existing_token_preserved',
  legacy_registration: 'blocks_mc2_registration',
  replay_and_buyers: 'dynamic_exclusion',
  historical_backfill: 'idempotent_sql',
}, null, 2));
