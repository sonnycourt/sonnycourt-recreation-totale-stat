import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const checkout = await fs.readFile(
  new URL('../src/pages/commencer.astro', import.meta.url),
  'utf8',
);
const checkoutBackend = await fs.readFile(
  new URL('../netlify/functions/mc2-stripe-checkout.js', import.meta.url),
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
assert.match(checkout, /createExpressCheckoutElement\(\{[\s\S]*applePay:\s*['"]auto['"][\s\S]*googlePay:\s*['"]auto['"]/);
assert.match(checkout, /availablePaymentMethods\?\.applePay\s*\|\|\s*availablePaymentMethods\?\.googlePay/);
assert.match(checkout, /confirm\(\{\s*expressCheckoutConfirmEvent:\s*event\s*\}\)/);
assert.match(checkout, /stripeCheckout\.loadActions\(\)/);
assert.match(checkout, /checkoutActions\.updateEmail\(email\)/);
assert.match(checkout, /action:\s*['"]update_identity['"]/);
assert.doesNotMatch(checkout, /firstNameInput\.readOnly\s*=\s*true/);
assert.doesNotMatch(checkout, /emailInput\.readOnly\s*=\s*true/);
assert.match(checkoutBackend, /body\.action === ['"]update_identity['"]/);
assert.match(checkoutBackend, /identity_editable:\s*['"]v1['"]/);
assert.match(checkoutBackend, /stripe\.customers\.update\(checkoutSession\.customer, \{ name: prenom, email \}\)/);
assert.doesNotMatch(checkoutBackend, /customer_email:\s*registration\.email/);
assert.doesNotMatch(checkoutBackend, /receipt_email:\s*registration\.email/);
assert.match(checkout, /expressCheckout\.classList\.toggle\(['"]is-locked['"],\s*!unlocked\)/);
assert.match(checkout, /recordContractAcceptance\(\)[\s\S]*expressCheckoutConfirmEvent/);
assert.match(checkout, /Cette validation autorise ArgEntrepreneur Sàrl[\s\S]*4 échéances de 297/);
assert.match(checkout, /id="commitment" aria-describedby="future-debit-consent"/);
assert.match(checkout, /const installmentDates = \[14, 35, 56, 77\]/);
assert.doesNotMatch(checkout, /setMonth\(dueDate\.getMonth\(\) \+ index\)/);

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
  express_wallets: 'apple_pay_google_pay_when_device_eligible',
  schedule: '47_then_4x297_days_14_35_56_77_total_1235',
}, null, 2));
