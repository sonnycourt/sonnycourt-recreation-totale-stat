import assert from 'node:assert/strict';
import handler from '../netlify/functions/spiffy-purchase-webhook.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SPIFFY_SIGNING_SECRET: process.env.SPIFFY_SIGNING_SECRET,
  MAILERLITE_API_KEY: process.env.MAILERLITE_API_KEY,
};

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
delete process.env.SPIFFY_SIGNING_SECRET;
delete process.env.MAILERLITE_API_KEY;

const token = 'e6011f98-3eed-4660-9548-550dd8398786';
const registrationEmail = 'registration@example.com';
const paymentEmail = 'payment-different@example.com';
const mc2Lookups = [];
let registrationPatch = null;

const registration = {
  token,
  email: registrationEmail,
  prenom: 'Test',
  telephone: '+41780000000',
  traffic_source: null,
  tt_click_id: null,
  meta_fbc: null,
  meta_fbp: null,
  checkout_last_plan: 'monthly',
  checkout_last_payment_mode: 'spiffy_3x767',
  checkout_last_route: '/mc2/session/',
  checkout_last_viewed_at: new Date().toISOString(),
  payment_status: 'pending',
  statut: 'registered',
  purchased_at: null,
};

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = options.method || 'GET';

  if (parsed.pathname.endsWith('/mc2_registrations') && method === 'GET') {
    mc2Lookups.push(parsed.href);
    if (parsed.searchParams.get('token') === `eq.${token}`) return Response.json([registration]);
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/webinaire_registrations') && method === 'GET') {
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/mc2_registrations') && method === 'PATCH') {
    registrationPatch = JSON.parse(options.body || '{}');
    return Response.json([{ ...registration, ...registrationPatch }]);
  }
  if (parsed.pathname.endsWith('/mc2_sms_jobs') && method === 'PATCH') {
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/mc2_replay_recovery_jobs') && method === 'GET') {
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/mc2_replay_recovery_jobs') && method === 'PATCH') {
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/webinaire_exclusions') && method === 'POST') {
    const excluded = JSON.parse(options.body || '{}');
    assert.equal(excluded.email, registrationEmail);
    return new Response('', { status: 201 });
  }
  throw new Error(`unexpected request: ${method} ${url}`);
};

try {
  const payload = {
    event_name: 'order:success',
    order_id: 2492404,
    order_total: 230100,
    checkout: {
      checkout_id: 40006,
      url_slug: 'esprit-subconscient-2-0-2-2-1-1',
    },
    customer: { email: paymentEmail },
    mc2_token: token,
  };
  const response = await handler(new Request('https://sonnycourt.com/.netlify/functions/spiffy-purchase-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.type, 'sale');
  assert.ok(mc2Lookups.length >= 2, 'le token doit servir aux deux recherches MC2');
  assert.ok(mc2Lookups.every((url) => url.includes(`token=eq.${token}`)));
  assert.equal(registrationPatch?.statut, 'purchased');
  assert.equal(registrationPatch?.payment_status, 'paid');
  assert.equal(registrationPatch?.initial_payment_cents, 76700);
  assert.equal(registrationPatch?.contractual_total_cents, 230100);
  assert.equal(registrationPatch?.checkout_last_plan, 'monthly');
  assert.equal(registrationPatch?.checkout_last_payment_mode, 'spiffy_3x767');
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('MC2 Spiffy token purchase webhook smoke: OK');
