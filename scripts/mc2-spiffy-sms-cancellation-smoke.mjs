import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  cancelMc2OfferSmsAfterSpiffyPurchase,
  isMc2SpiffyCheckout,
  mc2SpiffyCheckoutIds,
} from '../netlify/functions/lib/mc2-spiffy-sms-cancellation.mjs';

assert.equal(mc2SpiffyCheckoutIds({}).has('39495'), true);
assert.equal(isMc2SpiffyCheckout({ checkoutId: '39498', payload: {}, env: {} }), true);
assert.equal(isMc2SpiffyCheckout({
  payload: { checkout_url: 'https://sonnycourt.spiffy.co/checkout/esprit-subconscient-2-0-34' },
  env: {},
}), true);
assert.equal(isMc2SpiffyCheckout({ checkoutId: 'other', payload: {}, env: {} }), false);

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
const token = '12345678-1234-1234-1234-123456789012';
let cancellationPatch = null;

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/mc2_registrations')) {
    assert.equal(options.method, undefined);
    return Response.json([{ token }]);
  }
  if (parsed.pathname.endsWith('/mc2_sms_jobs') && options.method === 'PATCH') {
    cancellationPatch = JSON.parse(options.body || '{}');
    return Response.json([{ id: 7, ...cancellationPatch }]);
  }
  throw new Error(`unexpected ${url}`);
};

try {
  const result = await cancelMc2OfferSmsAfterSpiffyPurchase({
    checkoutId: '39495',
    payload: { checkout_id: '39495' },
    email: 'Client@Example.com',
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(cancellationPatch.status, 'skipped');
  assert.equal(cancellationPatch.skip_reason, 'spiffy_purchase_completed');

  const webhook = await fs.readFile(new URL('../netlify/functions/spiffy-purchase-webhook.js', import.meta.url), 'utf8');
  assert.match(webhook, /cancelMc2OfferSmsAfterSpiffyPurchase/);
  assert.ok(
    webhook.indexOf('cancelMc2OfferSmsAfterSpiffyPurchase')
      < webhook.indexOf('if (!row && !isMc2Purchase) return jsonResponse'),
    'l’annulation MC2 doit précéder la sortie du chemin historique',
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log('MC2 Spiffy SMS cancellation smoke: OK');
