import assert from 'node:assert/strict';
import { DRAFTX_PAYMENT_PLANS as plans } from '../src/lib/mc2-draftx-checkout.mjs';
import { buildDraftXSpiffyUrl, trustedSpiffyMessage, SPIFFY_ORIGIN } from '../src/lib/mc2-draftx-spiffy.mjs';

assert.deepEqual(Object.keys(plans), ['once', 'twelve']);
for (const [key, slug, count, amount] of [
  ['once', 'esprit-subconscient-2-0-34-1', 1, 1297],
  ['twelve', 'esprit-subconscient-2-0-2-2-1-1', 12, 197],
]) {
  assert.equal(plans[key].count, count);
  assert.equal(plans[key].amount, amount);
  const url = buildDraftXSpiffyUrl(plans[key], { firstName: 'Test', email: 'test@example.invalid', registrationToken: 'mc2-unit-only-1234567890' }, 'http://127.0.0.1:4390/mc2/session/?coupon=bad');
  assert.equal(url.pathname, '/checkout/' + slug);
  assert.equal(url.searchParams.get('mc2_token'), 'mc2-unit-only-1234567890');
  assert.equal(url.searchParams.get('es2_plan'), key === 'once' ? 'once' : 'monthly');
  assert.equal(url.searchParams.get('coupon'), null);
}
assert.throws(() => buildDraftXSpiffyUrl({ checkoutUrl: SPIFFY_ORIGIN + '/checkout/38556364' }, {}, 'http://localhost:4390'));
const source = {}, frame = { contentWindow: source };
for (const path of ['/es2-derniere-etape', '/es2-derniere-etape/', '/commencer/succes/']) {
  const data = { event: 'redirect', data: { url: 'https://sonnycourt.com' + path + '?order=unit' } };
  assert.deepEqual(trustedSpiffyMessage({ origin: SPIFFY_ORIGIN, source, data }, frame), { redirect: 'https://sonnycourt.com/commencer/succes/?order=unit' });
  assert.equal(trustedSpiffyMessage({ origin: 'https://evil.invalid', source, data }, frame), null);
  assert.equal(trustedSpiffyMessage({ origin: SPIFFY_ORIGIN, source: {}, data }, frame), null);
}
assert.deepEqual(trustedSpiffyMessage({ origin: SPIFFY_ORIGIN, source, data: { type: 'es2:spiffy-height', height: 456 } }, frame), { height: 456 });
console.log('PASS: plans 40007/40006, identity/token, legacy success redirect, origin/source checks. No payment submitted.');
