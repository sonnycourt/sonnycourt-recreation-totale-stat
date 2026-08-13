import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const checkout = await fs.readFile(
  new URL('../src/pages/commencer.astro', import.meta.url),
  'utf8',
);

assert.match(checkout, /stripe\.initCheckout\(\{[\s\S]*elementsOptions:\s*\{\s*appearance:\s*stripeAppearance\s*\}/);
assert.match(checkout, /inputs:\s*['"]spaced['"]/);
assert.match(checkout, /labels:\s*['"]above['"]/);
assert.match(checkout, /fontSizeBase:\s*['"]16px['"]/);
assert.match(checkout, /createPaymentElement\(\{[\s\S]*defaultCollapsed:\s*false/);
assert.match(checkout, /radios:\s*['"]never['"]/);
assert.match(checkout, /spacedAccordionItems:\s*false/);
assert.match(checkout, /billingDetails:\s*\{[\s\S]*address:\s*['"]if_required['"]/);
assert.match(checkout, /terms:\s*\{\s*card:\s*['"]never['"]\s*\}/);
assert.match(checkout, /Cette validation autorise ArgEntrepreneur Sàrl[\s\S]*4 échéances de 297/);
assert.match(checkout, /id="commitment" aria-describedby="future-debit-consent"/);

for (const marker of [
  '47&nbsp;€',
  '4 × 297&nbsp;€',
  '1&nbsp;235&nbsp;€',
  'id="commitment"',
  '/cgv/',
  'stripeCheckout.confirm()',
  'mc2-contract-acceptance',
  'checkout_session_id: checkoutSessionId',
]) assert.ok(checkout.includes(marker), `Marqueur MC2 manquant : ${marker}`);

console.log(JSON.stringify({
  stripe_payment_element: 'secure',
  compact_appearance: 'configured',
  billing_address: 'if_required',
  future_debit_consent: 'explicit',
  schedule: '47_then_4x297_total_1235',
}, null, 2));
