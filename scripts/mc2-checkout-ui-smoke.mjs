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
assert.match(checkout, /createExpressCheckoutElement\(\{[\s\S]*applePay:\s*['"]auto['"][\s\S]*googlePay:\s*['"]auto['"]/);
assert.match(checkout, /availablePaymentMethods\?\.applePay\s*\|\|\s*availablePaymentMethods\?\.googlePay/);
assert.match(checkout, /confirm\(\{\s*expressCheckoutConfirmEvent:\s*event\s*\}\)/);
assert.match(checkout, /expressCheckout\.classList\.toggle\(['"]is-locked['"],\s*!unlocked\)/);
assert.match(checkout, /recordContractAcceptance\(\)[\s\S]*expressCheckoutConfirmEvent/);
assert.match(checkout, /id="commitment" required/);
assert.match(checkout, /J’accepte les[\s\S]*CGV[\s\S]*autorise les prélèvements conformément à l’échéancier indiqué ci-dessus/);
assert.doesNotMatch(checkout, /id="future-debit-consent"/);
assert.doesNotMatch(checkout, /Commande avec obligation de paiement/);
assert.match(checkout, /Je commence ma transformation pour 47&nbsp;€ aujourd’hui/);
assert.match(checkout, /Informations relatives au règlement/);
assert.match(checkout, /premier règlement exigible et débité aujourd’hui est fixé à 47&nbsp;€/);
assert.match(checkout, /quatre échéances distinctes[\s\S]*de 297&nbsp;€ chacune/);
assert.match(checkout, /prix total de 1&nbsp;235&nbsp;€/);
assert.match(checkout, /id="installment-date-14"[\s\S]*id="installment-date-35"[\s\S]*id="installment-date-56"[\s\S]*id="installment-date-77"/);
assert.match(checkout, /const installmentDates = \[14, 35, 56, 77\]/);
assert.doesNotMatch(checkout, /setMonth\(dueDate\.getMonth\(\) \+ index\)/);

const offerVisualIndex = checkout.indexOf('class="offer-summary__visual"');
const countdownIndex = checkout.indexOf('class="page-countdown"');
const offerDetailsIndex = checkout.indexOf('class="offer-summary__details"');
assert.ok(offerVisualIndex >= 0 && countdownIndex > offerVisualIndex && offerDetailsIndex > countdownIndex, 'Le countdown doit rester sous le visuel et avant la liste produit.');
assert.match(checkout, /<div><strong>00<\/strong><small>jours<\/small><\/div>/);
assert.match(checkout, /id="countdown-hours"/);
assert.match(checkout, /id="countdown-minutes"/);
assert.match(checkout, /id="countdown-seconds"/);
assert.match(checkout, /\.page-countdown__progress \{ display: none; \}/);
assert.match(checkout, /\.order-mobile-countdown[\s\S]*display: none/);
assert.doesNotMatch(checkout, /Plus que\s*<strong>\s*2 places|Plus que 2 places/i);

assert.match(checkout, /5 modules et plus de 36 heures de formation/);
assert.match(checkout, /La communauté privée Volt<\/p>/);
assert.match(checkout, /réveiller le meilleur en toi/);
assert.match(checkout, /historique-es2-kevin-3-etoiles/);
assert.match(checkout, /historique-es2-cedric-1-etoile/);
assert.match(checkout, /Réponse de Sonny Court/);
assert.match(checkout, /class="legal-note legal-note--page-bottom"/);

for (const marker of [
  '47&nbsp;€',
  'quatre échéances distinctes',
  '297&nbsp;€ chacune',
  '1&nbsp;235&nbsp;€',
  'id="commitment"',
  '/cgv/',
  'stripeCheckout.confirm()',
  'mc2-contract-acceptance',
  'checkout_session_id: checkoutSessionId',
]) assert.ok(checkout.includes(marker), `Marqueur MC2 manquant : ${marker}`);

for (const criticalId of [
  'checkout-form',
  'customer-first-name',
  'customer-email',
  'stripe-payment-element',
  'stripe-express-checkout-element',
  'commitment',
  'buy-button',
  'stripe-error',
  'payment-loading',
]) assert.ok(checkout.includes(`id="${criticalId}"`), `ID checkout critique manquant : ${criticalId}`);

console.log(JSON.stringify({
  stripe_payment_element: 'secure',
  compact_appearance: 'configured',
  billing_address: 'if_required',
  future_debit_consent: 'explicit',
  express_wallets: 'apple_pay_google_pay_when_device_eligible',
  schedule: '47_then_4x297_days_14_35_56_77_total_1235',
}, null, 2));
