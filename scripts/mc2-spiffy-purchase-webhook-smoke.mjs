import assert from 'node:assert/strict';
import handler from '../netlify/functions/spiffy-purchase-webhook.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SPIFFY_SIGNING_SECRET: process.env.SPIFFY_SIGNING_SECRET,
  MAILERLITE_API_KEY: process.env.MAILERLITE_API_KEY,
  SPIFFY_ONBOARDING_API_KEY: process.env.SPIFFY_ONBOARDING_API_KEY,
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
let purchaseEvent = null;

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
  purchase_bonus_tag: null,
  session_starts_at: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
  offer_expires_at: new Date(Date.now() + (70 * 60 * 60 * 1000)).toISOString(),
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
  if (parsed.pathname.endsWith('/mc2_funnel_events') && method === 'POST') {
    purchaseEvent = JSON.parse(options.body);
    return Response.json([{ id: 123 }]);
  }
  if (parsed.pathname.endsWith('/mc2_funnel_events') && method === 'GET') return Response.json([]);
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
  assert.equal(registrationPatch?.purchase_bonus_tag, 'avec_consultation_sonny');
  for (const [checkoutId, total, initial, contract, mode] of [
    [40006, 19700, 19700, 236400, 'spiffy_12x197'],
    [40006, 236400, 19700, 236400, 'spiffy_12x197'],
    [40007, 129700, 129700, 129700, 'spiffy_one_time_1297'],
    [40007, 199700, 199700, 199700, 'spiffy_one_time_1997'],
  ]) {
    purchaseEvent = null;
    const response = await handler(new Request('https://sonnycourt.com/.netlify/functions/spiffy-purchase-webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'order:success', data: { object: {
        id: 2492500 + checkoutId, checkout: { id: checkoutId },
        order_total: total, customer: { email: paymentEmail }, mc2_token: token,
        ...(total === 129700 ? { metadata: { terms_version: 'cgv-2026-09-v10' } } : {}),
      } } }),
    }));
    assert.equal(response.status, 200);
    assert.equal(registrationPatch.initial_payment_cents, initial);
    assert.equal(registrationPatch.contractual_total_cents, contract);
    assert.equal(registrationPatch.checkout_last_payment_mode, mode);
    assert.equal(registrationPatch.purchase_bonus_tag, 'avec_consultation_sonny');
    if (mode !== 'spiffy_one_time_1997') {
      assert.equal(purchaseEvent.metadata.amount_cents, initial);
      assert.equal(purchaseEvent.metadata.contractual_total_cents, contract);
      assert.equal(purchaseEvent.token, token);
      assert.equal(purchaseEvent.metadata.terms_version, total === 129700 ? 'cgv-2026-09-v10' : null);
      assert.equal(purchaseEvent.metadata.terms_version_source,
        total === 129700 ? 'provider_metadata' : 'provider_acceptance_to_verify');
    }
  }
  // Les relivraisons conservent les bonus déjà accordés, sans écriture réelle.
  for (const tag of ['avec_consultation_sonny', 'sans_consultation_sonny']) {
    registration.purchase_bonus_tag = tag;
    registration.purchased_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const response = await handler(new Request('https://sonnycourt.com/.netlify/functions/spiffy-purchase-webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 200);
    assert.equal(registrationPatch.purchase_bonus_tag, tag);
  }
  registration.purchase_bonus_tag = null;
  const legacyResponse = await handler(new Request('https://sonnycourt.com/.netlify/functions/spiffy-purchase-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
  assert.equal(legacyResponse.status, 200);
  assert.equal(registrationPatch.purchase_bonus_tag, 'avec_consultation_sonny');
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// --- Meta : un seul Purchase par acheteur, identifiants complets, mensualités et remboursements ---
const metaEnv = { META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN, META_PIXEL_ID: process.env.META_PIXEL_ID, CONTEXT: process.env.CONTEXT };
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
process.env.META_ACCESS_TOKEN = 'fixture-token';
process.env.META_PIXEL_ID = '3367958190030822';
delete process.env.CONTEXT;
delete process.env.SPIFFY_SIGNING_SECRET;
delete process.env.MAILERLITE_API_KEY;
const metaRegistration = {
  ...registration,
  traffic_source: 'meta_ad',
  meta_fbc: 'fb.1.1700000000.clickid',
  meta_fbp: 'fb.1.1700000000.browserid',
  optin_variant: 'meta_v2',
  purchased_at: null,
  purchase_bonus_tag: null,
};
const metaCalls = [];
let outboxInserts = [];
let providerPayments = [], providerUnavailable = false;
process.env.SPIFFY_ONBOARDING_API_KEY = 'fixture';
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = options.method || 'GET';
  if (parsed.hostname === 'api.spiffy.co') {
    assert.equal(parsed.pathname, '/v2/payments');
    assert.equal(parsed.searchParams.get('filter[order_id]'), '3100001');
    return providerUnavailable ? Response.json({}, { status: 503 })
      : Response.json({ data: providerPayments, meta: { pagination: { total_count: providerPayments.length } } });
  }
  if (parsed.hostname === 'graph.facebook.com') {
    const body = JSON.parse(options.body);
    assert.equal(body.access_token, 'fixture-token');
    metaCalls.push(body.data[0]);
    return Response.json({ events_received: 1 });
  }
  if (parsed.pathname.endsWith('/mc2_tracking_meta_outbox') && method === 'GET') {
    return Response.json([{ context: { ip: '203.0.113.9', userAgent: 'Mobile Safari fixture', route: '/mc2/session/' } }]);
  }
  if (parsed.pathname.endsWith('/mc2_tracking_meta_outbox') && method === 'POST') {
    const row = JSON.parse(options.body);
    const exists = outboxInserts.some(r => r.delivery_key === row.delivery_key);
    if (!exists) outboxInserts.push(row);
    return Response.json(exists ? [] : [row], { status: 201 });
  }
  if (parsed.pathname.endsWith('/mc2_tracking_meta_outbox') && method === 'PATCH') {
    const row = outboxInserts.find(r => `eq.${r.delivery_key}` === parsed.searchParams.get('delivery_key'));
    if (row) Object.assign(row, JSON.parse(options.body));
    return Response.json(row ? [row] : []);
  }
  if (parsed.pathname.endsWith('/mc2_registrations') && method === 'GET') {
    if (parsed.searchParams.get('token') === `eq.${token}`) return Response.json([metaRegistration]);
    if (parsed.searchParams.get('purchased_at') === 'not.is.null') return Response.json(metaRegistration.purchased_at ? [metaRegistration] : []);
    return Response.json([]);
  }
  if (parsed.pathname.endsWith('/webinaire_registrations') && method === 'GET') return Response.json([]);
  if (parsed.pathname.endsWith('/mc2_registrations') && method === 'PATCH') {
    registrationPatch = JSON.parse(options.body || '{}');
    return Response.json([{ ...metaRegistration, ...registrationPatch }]);
  }
  if (parsed.pathname.endsWith('/mc2_sms_jobs') && method === 'PATCH') return Response.json([]);
  if (parsed.pathname.endsWith('/mc2_funnel_events') && method === 'POST') return Response.json([{ id: 456 }]);
  if (parsed.pathname.endsWith('/mc2_funnel_events') && method === 'GET') return Response.json([]);
  if (parsed.pathname.endsWith('/mc2_replay_recovery_jobs')) return Response.json([]);
  if (parsed.pathname.endsWith('/webinaire_exclusions') && method === 'POST') return new Response('', { status: 201 });
  throw new Error(`unexpected request: ${method} ${url}`);
};
const webhook = (body) => handler(new Request('https://sonnycourt.com/.netlify/functions/spiffy-purchase-webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
try {
  // 1. Première commande : un Purchase, avec clic, navigateur, identifiant interne et page.
  let response = await webhook({ event: 'order:success', data: { object: {
    id: 3100001, checkout: { id: 40006 }, order_total: 19700, customer: { email: paymentEmail }, mc2_token: token,
  } } });
  assert.equal((await response.json()).type, 'sale');
  assert.equal(metaCalls.length, 1);
  assert.equal(metaCalls[0].event_name, 'Purchase');
  assert.equal(metaCalls[0].event_id, `purchase-${token}`);
  assert.equal(metaCalls[0].custom_data.value, 197);
  assert.equal(metaCalls[0].custom_data.currency, 'EUR');
  assert.equal(metaCalls[0].event_source_url, 'https://sonnycourt.com/mc2/session/');
  assert.equal(metaCalls[0].user_data.fbc, 'fb.1.1700000000.clickid');
  assert.equal(metaCalls[0].user_data.fbp, 'fb.1.1700000000.browserid');
  assert.equal(metaCalls[0].user_data.client_ip_address, '203.0.113.9');
  assert.equal(metaCalls[0].user_data.client_user_agent, 'Mobile Safari fixture');
  assert.equal(metaCalls[0].user_data.external_id?.[0]?.length, 64);
  assert.equal(outboxInserts.length, 1, 'Le paiement garde un reçu durable, même après succès');
  assert.equal(outboxInserts[0].status, 'sent');

  // 2. Relivraison de la même commande, achat déjà enregistré : aucun nouveau Purchase.
  metaRegistration.purchased_at = new Date(Date.now() - 3600000).toISOString();
  response = await webhook({ event: 'order:success', data: { object: {
    id: 3100001, checkout: { id: 40006 }, order_total: 19700, customer: { email: paymentEmail }, mc2_token: token,
  } } });
  assert.equal(response.status, 200);
  assert.equal(metaCalls.length, 1, 'Une relivraison ne recompte pas l’achat');

  // 3. Mensualité suivante : événement dédié, pas de Purchase.
  response = await webhook({ event: 'payment:success', data: { object: {
    id: 3100002, order_id: 3100001, installment_number: 2, checkout: { id: 40006 }, payment_amount: 19700, customer: { email: paymentEmail }, mc2_token: token,
  } } });
  assert.equal(response.status, 200);
  assert.equal(metaCalls.length, 2);
  assert.equal(metaCalls[1].event_name, 'MC2_InstallmentPaid');
  assert.equal(metaCalls[1].custom_data.value, 197);
  assert.notEqual(metaCalls[1].event_id, metaCalls[0].event_id);

  // Même commande, deux échéances différentes et une rediffusion : 2 signaux,
  // pas un signal écrasé dans la file, pas un nouveau Purchase.
  const secondInstallment = { event: 'payment:success', data: { object: {
    id: 3100005, order_id: 3100001, installment_number: 3, checkout: { id: 40006 },
    order_total: 236400, payment_amount: 19700, customer: { email: paymentEmail }, mc2_token: token,
  } } };
  const beforeSecond = metaCalls.length;
  await webhook(secondInstallment); await webhook(secondInstallment);
  assert.equal(metaCalls.length, beforeSecond + 1);
  assert.equal(metaCalls.at(-1).event_name, 'MC2_InstallmentPaid');
  assert.equal(metaCalls.at(-1).custom_data.value, 197, 'Ne pas envoyer le total contractuel de la commande');
  assert.notEqual(metaCalls.at(-1).event_id, metaCalls[1].event_id);
  // La notification du règlement INITIAL ne devient pas une mensualité.
  await webhook({ ...secondInstallment, data: { object: { ...secondInstallment.data.object, id: 3100006, installment_number: 1 } } });
  assert.equal(metaCalls.length, beforeSecond + 1);
  // Provider payload without installment_number: read the actual order history.
  providerPayments = [
    { id: 3100010, order_id: 3100001, amount_paid: 19700, created_at: '2026-09-01T10:00:00Z' },
    { id: 3100011, order_id: 3100001, amount_paid: 19700, created_at: '2026-10-01T10:00:00Z' },
  ];
  const providerNotice = { event: 'payment:success', data: { object: {
    id: 3100011, order_id: 3100001, checkout: { id: 40006 }, payment_amount: 19700,
    customer: { email: paymentEmail }, mc2_token: token,
  } } };
  let previousCount = metaCalls.length;
  providerUnavailable = true;
  response = await webhook(providerNotice);
  assert.equal(response.status, 503, 'Unknown installment is retriable, never guessed');
  assert.equal(metaCalls.length, previousCount);
  providerUnavailable = false;
  response = await webhook(providerNotice);
  assert.equal(response.status, 200);
  assert.equal(metaCalls.length, previousCount + 1);
  assert.equal(metaCalls.at(-1).event_name, 'MC2_InstallmentPaid');
  previousCount = metaCalls.length;
  await webhook({ ...providerNotice, data: { object: { ...providerNotice.data.object, id: 3100010 } } });
  assert.equal(metaCalls.length, previousCount, 'Initial charge notification does not become an installment');
  const beforeUnrelated = metaCalls.length;
  await webhook({ event: 'order:refund', data: { object: { id: 777, checkout: { id: 99999 }, customer: { email: registrationEmail }, refund_amount: 9700 } } });
  assert.equal(metaCalls.length, beforeUnrelated, 'Le remboursement d’un autre produit n’est pas un remboursement MC2');

  // 4. Remboursement : signal dédié vers l'acheteur Meta.
  response = await webhook({ event: 'order:refund', data: { object: {
    id: 3100001, order_id: 3100001, checkout: { id: 40006 }, order_total: 19700, refund_amount: 19700, customer: { email: registrationEmail },
  } } });
  assert.equal((await response.json()).type, 'refund');
  assert.equal(metaCalls.at(-1).event_name, 'MC2_Refund');
  assert.equal(metaCalls.at(-1).custom_data.value, 197);

  // 5. Impayé : signal dédié.
  response = await webhook({ event: 'payment:failed', data: { object: {
    id: 3100003, order_id: 3100003, checkout: { id: 40006 }, payment_amount: 19700, customer: { email: registrationEmail },
  } } });
  assert.equal((await response.json()).type, 'payment_failure');
  assert.equal(metaCalls.at(-1).event_name, 'MC2_PaymentFailed');

  // 6. Meta en panne : l'achat part dans la file durable avec le même event_id.
  metaRegistration.purchased_at = null;
  outboxInserts = [];
  const healthyFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (new URL(url).hostname === 'graph.facebook.com') return Response.json({ error: { message: 'fixture outage' } }, { status: 500 });
    return healthyFetch(url, options);
  };
  response = await webhook({ event: 'order:success', data: { object: {
    id: 3100004, checkout: { id: 40007 }, order_total: 129700, customer: { email: paymentEmail }, mc2_token: token,
  } } });
  assert.equal(response.status, 200);
  assert.equal(outboxInserts.length, 1);
  assert.equal(outboxInserts[0].delivery_key, `immediate:${token}:Purchase:purchase-${token}`);
  assert.equal(outboxInserts[0].event_id, `purchase-${token}`);
  assert.equal(outboxInserts[0].context.value, 1297);
  assert.equal(outboxInserts[0].context.url, 'https://sonnycourt.com/mc2/session/');
  globalThis.fetch = healthyFetch;
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({ ...originalEnv, ...metaEnv })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('MC2 Spiffy token purchase webhook smoke: OK');
