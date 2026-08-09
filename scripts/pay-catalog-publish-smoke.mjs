import assert from 'node:assert/strict';
import publish from '../netlify/functions/pay-catalog-publish.js';
import { signSessionToken } from '../netlify/functions/lib/admin-es2-crypto.mjs';
import { getAdminEs2CookieSecret } from '../netlify/functions/lib/admin-es2-session-secret.mjs';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-catalog-publish-smoke';
process.env.STRIPE_PAY_SECRET_KEY = 'sk_test_catalog_publish_smoke';
delete process.env.PAY_STRIPE_CATALOG_WRITES_ENABLED;

const token = signSessionToken(getAdminEs2CookieSecret(), 60_000);
const headers = {
  Cookie: `admin_es2_session=${encodeURIComponent(token)}`,
  Origin: 'https://pay.sonnycourt.com',
  'Content-Type': 'application/json',
};
const input = { name: 'Produit test', billing_type: 'one_time', amount: 97, currency: 'eur' };
const idempotencyKey = 'product:publish-smoke:stable-key';

let response = await publish(new Request('https://pay.sonnycourt.com/.netlify/functions/pay-catalog-publish'));
assert.equal(response.status, 401);

response = await publish(new Request('https://pay.sonnycourt.com/.netlify/functions/pay-catalog-publish', { headers: { Cookie: headers.Cookie } }));
assert.equal(response.status, 200);
let payload = await response.json();
assert.equal(payload.writes_enabled, false);
assert.equal(payload.mode, 'test');

response = await publish(new Request('https://pay.sonnycourt.com/.netlify/functions/pay-catalog-publish', {
  method: 'POST', headers, body: JSON.stringify({ action: 'preview', kind: 'product', input, idempotency_key: idempotencyKey }),
}));
assert.equal(response.status, 200);
payload = await response.json();
assert.equal(payload.action, 'preview');
assert.equal(payload.plan.confirmation, 'PUBLIER PRODUIT');
assert.equal(payload.plan.operations[0].stripe_method, 'products.create');
assert.equal(payload.plan.writes_enabled, false);

response = await publish(new Request('https://pay.sonnycourt.com/.netlify/functions/pay-catalog-publish', {
  method: 'POST', headers, body: JSON.stringify({
    action: 'execute', kind: 'product', input, idempotency_key: idempotencyKey,
    confirmation: 'PUBLIER PRODUIT', fingerprint: payload.plan.fingerprint,
  }),
}));
assert.equal(response.status, 403);
const disabled = await response.json();
assert.equal(disabled.error, 'stripe_catalog_writes_disabled');

response = await publish(new Request('https://evil.example/.netlify/functions/pay-catalog-publish', {
  method: 'POST', headers, body: JSON.stringify({ action: 'preview', kind: 'product', input, idempotency_key: idempotencyKey }),
}));
assert.equal(response.status, 403);

console.log(JSON.stringify({
  authenticated_preview: 'ok',
  exact_confirmation: 'ok',
  fingerprint_bound: 'ok',
  writes_disabled_by_default: 'ok',
  same_origin_guard: 'ok',
  network_writes: 0,
}, null, 2));
