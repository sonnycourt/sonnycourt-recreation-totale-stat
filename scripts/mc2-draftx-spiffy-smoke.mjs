import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildDraftXSpiffyUrl, cleanDraftXRegistrationToken, mountDraftXSpiffy, trustedSpiffyMessage, SPIFFY_ORIGIN } from '../src/lib/mc2-draftx-spiffy.mjs';
import { DRAFTX_PAYMENT_PLANS } from '../src/lib/mc2-draftx-checkout.mjs';

for (const [key, id] of [['six', '38556365'], ['twelve', '38556364']]) {
  const url = buildDraftXSpiffyUrl(DRAFTX_PAYMENT_PLANS[key], {
    firstName: '  Léa & Zoé  ', email: '  lea+mc2@example.invalid  ',
  }, 'http://127.0.0.1:4341/mc2/draftx/?t=private&code=OFFRE50POURCENT');
  assert.equal(url.origin, SPIFFY_ORIGIN);
  assert.equal(url.pathname, '/checkout/' + id);
  assert.equal(url.searchParams.get('name_first'), 'Léa & Zoé');
  assert.equal(url.searchParams.get('email'), 'lea+mc2@example.invalid');
  assert.equal(url.searchParams.get('code'), null);
  assert.equal(url.searchParams.get('t'), null);
  assert.equal(url.searchParams.get('mc2_token'), null, 'Never forward a token implicitly from the URL');
  assert.equal(JSON.parse(atob(url.searchParams.get('elements'))).from, 'http://127.0.0.1:4341/mc2/draftx/');
  const linked = buildDraftXSpiffyUrl(DRAFTX_PAYMENT_PLANS[key], { registrationToken: 'mc2-unit-only-1234567890' }, 'https://sonnycourt.com/mc2/session/?t=mc2-unit-only-1234567890');
  assert.equal(linked.searchParams.get('mc2_token'), 'mc2-unit-only-1234567890');
  assert.equal(JSON.parse(atob(linked.searchParams.get('elements'))).from, 'https://sonnycourt.com/mc2/session/');
}
for (const invalid of ['', 'short', 'mc2-preview-123456789', 'preview-1234567890123', '../not-a-reference']) assert.equal(cleanDraftXRegistrationToken(invalid), '');
assert.throws(() => buildDraftXSpiffyUrl({ checkoutUrl: 'https://elsewhere.invalid/checkout/38556364' }, {}, 'http://localhost:4341'));
assert.throws(() => buildDraftXSpiffyUrl({ checkoutUrl: SPIFFY_ORIGIN + '/checkout/1' }, {}, 'http://localhost:4341'));

const source = {};
const frame = { contentWindow: source };
const event = data => ({ source, origin: SPIFFY_ORIGIN, data });
assert.deepEqual(trustedSpiffyMessage(event({ type: 'mc2:draftx-spiffy-ready', identityReady: true }), frame), { ready: true, identityReady: true });
assert.equal(trustedSpiffyMessage({ ...event({ height: 200 }), source: {} }, frame), null);
assert.equal(trustedSpiffyMessage({ ...event({ height: 200 }), origin: 'https://fake.invalid' }, frame), null);
assert.equal(trustedSpiffyMessage(event('not json'), frame), null);
assert.equal(trustedSpiffyMessage(event({ type: 'purchase:success' }), frame), null, 'No client-side payment success is fabricated');
for (const [name, key] of [['order:success', 'forward'], ['redirect', 'url']]) {
  const destination = 'https://sonnycourt.com/commencer/succes/?provider=spiffy&order=unit';
  assert.deepEqual(trustedSpiffyMessage(event(JSON.stringify({ event: name, data: { [key]: destination } })), frame), { redirect: destination });
  for (const unsafe of ['https://evil.invalid/commencer/succes/', 'javascript:alert(1)', 'https://sonnycourt.com/elsewhere/', 'https://person:secret@sonnycourt.com/commencer/succes/']) {
    assert.equal(trustedSpiffyMessage(event({ event: name, data: { [key]: unsafe } }), frame), null);
  }
}
for (const height of [-10, NaN, Infinity, 99, 10001]) assert.equal(trustedSpiffyMessage(event({ type: 'mc2:draftx-spiffy-height', height }), frame), null);
assert.deepEqual(trustedSpiffyMessage(event({ event: 'form:size', data: { height: 440.2 } }), frame), { height: 441 });
assert.deepEqual(trustedSpiffyMessage(event({ type: 'mc2:draftx-spiffy-height', height: 2000 }), frame), { height: 1800 });

// Exercise the actual parent redirect handler with DOM stubs; no browser/order.
for (const plan of Object.values(DRAFTX_PAYMENT_PLANS)) {
  let listener, assigned;
  const view = {
    location: { href: 'http://localhost:4342/mc2/draftx/', assign: url => { assigned = url; } },
    addEventListener: (_, callback) => { listener = callback; }, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {},
  };
  const doc = { defaultView: view, createElement: tag => ({ tag, contentWindow: {}, style: {}, setAttribute() {}, remove() {}, append() {} }) };
  const slot = { ownerDocument: doc, dataset: {}, setAttribute() {}, replaceChildren(...nodes) { this.children = nodes; } };
  const handle = mountDraftXSpiffy(slot, plan, { firstName: 'Test', email: 'test@example.invalid', registrationToken: 'mc2-unit-only-1234567890' });
  const mountedFrame = slot.children[1];
  listener({ origin: SPIFFY_ORIGIN, source: {}, data: { event: 'redirect', data: { url: 'https://sonnycourt.com/commencer/succes/' } } });
  assert.equal(assigned, undefined, 'Another iframe cannot initiate our redirect');
  listener({ origin: SPIFFY_ORIGIN, source: mountedFrame.contentWindow, data: JSON.stringify({ event: 'order:success', data: { forward: 'https://sonnycourt.com/commencer/succes/?order=unit' } }) });
  const destination = new URL(assigned);
  assert.equal(destination.searchParams.get('t'), 'mc2-unit-only-1234567890');
  assert.equal(destination.searchParams.get('order'), 'unit');
  assert.equal(destination.searchParams.get('provider'), 'spiffy');
  handle.destroy();
  assert.equal(slot.children.length, 0);
}

const bridge = readFileSync(new URL('../spiffy/mc2-draftx-embedded.html', import.meta.url), 'utf8');
assert.match(bridge, /<p data-mc2-terms>J’accepte les <a href="https:\/\/sonnycourt.com\/cgv\/"[^>]*>CGV<\/a> et le récapitulatif ci-dessus\.<\/p>/, 'Link the canonical CGV and keep the approved recap wording');
assert.doesNotMatch(bridge, /\.submit\(|fetch\(|XMLHttpRequest|Stripe\(/);
assert.match(bridge, /window\.parent === window/);
assert.match(bridge, /name_first/);
assert.match(bridge, /MutationObserver/);
const localizeSource = bridge.match(/function localizeValidationMessage\(text\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(localizeSource, 'The validation message translator is present');
const localize = runInNewContext('(' + localizeSource + ')');
const frenchValidation = 'Vérifie que tous les champs obligatoires sont correctement remplis.';
assert.equal(localize("Make sure you've filled in all required fields correctly"), frenchValidation);
assert.equal(localize("  Make sure you've filled in all required fields correctly\n"), frenchValidation);
assert.equal(localize(frenchValidation), frenchValidation, 'Translation is idempotent');
assert.equal(localize('Your card was declined.'), 'Your card was declined.', 'Do not replace other payment errors with a generic message');
assert.match(bridge, /characterData: true/, 'Handle messages updated in an existing alert');
assert.match(bridge, /\.payment-type__icon,.mc2-draftx-embed \.payment-gateway__secure \{ display:none!important; \}/);
// Keep Spiffy's checkbox and its label/pseudo-elements intact. Overriding them
// made the visible square change validation colour without staying checked.
const bridgeCss = bridge.split('<style>')[1];
assert.doesNotMatch(bridgeCss, /\.custom-control|input\s*\[\s*type\s*=\s*["']?checkbox|:checked|::before|::after/);
assert.doesNotMatch(bridge, /\.checked\s*=|setAttribute\(\s*['"]checked/);
assert.match(bridgeCss, /\.terms \[data-mc2-terms\] \{ padding:5px 0 0 8px!important; \}/, 'Align only the paragraph, not the native checkbox or its label');
const offer = readFileSync(new URL('../src/components/mc2/DealOfferDraftX.astro', import.meta.url), 'utf8');
assert.doesNotMatch(offer, /aria-label="PayPal"/);
console.log('PASS — identités, 2 checkouts, référence MC2 explicite uniquement, redirection filtrée, aucun paiement réel.');
