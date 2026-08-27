import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import handler from '../netlify/functions/mc2-offer-redirect.js';

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

const token = '12345678-1234-1234-1234-123456789012';
const code = 'A1b2C';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function run({ jobs = [{ id: 1, token, message_type: 'session_live' }], registrations, outage = false } = {}) {
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (outage) return json({ error: 'down' }, 500);
    if (parsed.pathname.endsWith('/mc2_sms_jobs')) return json(jobs);
    if (parsed.pathname.endsWith('/mc2_registrations')) return json(registrations || [{
      token,
      statut: 'registered',
      payment_status: null,
      offer_expires_at: '2099-08-23T16:00:00.000Z',
    }]);
    if (parsed.pathname.endsWith('/mc2_funnel_events') && options.method === 'POST') return json([]);
    throw new Error(`unexpected ${url}`);
  };
  return handler(new Request(`https://sonnycourt.com/offre/${code}`));
}

try {
  const netlify = await fs.readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(netlify, /from = "\/offre\/\*"[\s\S]*to = "\/\.netlify\/functions\/mc2-offer-redirect\?code=:splat"/);

  const valid = await run();
  assert.equal(valid.status, 302);
  assert.equal(valid.headers.get('location'), `/mc2/session/?t=${token}`);
  assert.equal(valid.headers.get('cache-control'), 'no-store');
  assert.equal(valid.headers.get('referrer-policy'), 'no-referrer');

  const invalidFormat = await handler(new Request('https://sonnycourt.com/offre/1234!'));
  assert.equal(invalidFormat.status, 404);
  assert.equal(await invalidFormat.text(), 'Lien invalide.');

  const unknown = await run({ jobs: [] });
  assert.equal(unknown.status, 404);
  assert.equal(await unknown.text(), 'Lien invalide.');

  const ambiguous = await run({ jobs: [{ id: 1, token }, { id: 2, token: 'other' }] });
  assert.equal(ambiguous.status, 404);
  assert.equal(await ambiguous.text(), 'Lien invalide.');

  const expired = await run({ registrations: [{
    token,
    statut: 'registered',
    offer_expires_at: '2020-08-23T16:00:00.000Z',
  }] });
  assert.equal(expired.status, 302);
  assert.equal(expired.headers.get('location'), `/mc2/session/?t=${token}`);
  assert.match(expired.headers.get('set-cookie') || '', new RegExp(`mc2_registration_token=${token}`));

  const purchased = await run({ registrations: [{
    token,
    statut: 'purchased',
    payment_status: 'paid',
    offer_expires_at: '2099-08-23T16:00:00.000Z',
  }] });
  assert.equal(purchased.status, 302);
  assert.equal(purchased.headers.get('location'), `/commencer/succes/?provider=spiffy&t=${token}`);

  const outage = await run({ outage: true });
  assert.equal(outage.status, 503);
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log('MC2 offer redirect smoke: OK');
