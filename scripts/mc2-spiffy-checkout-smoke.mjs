import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import statusHandler from '../netlify/functions/mc2-spiffy-status.js';

const page = await fs.readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const success = await fs.readFile(new URL('../src/pages/commencer/succes.astro', import.meta.url), 'utf8');
const legacySuccess = await fs.readFile(new URL('../src/pages/es2-derniere-etape.astro', import.meta.url), 'utf8');
const billing = await fs.readFile(new URL('../netlify/functions/mc2-billing-info.js', import.meta.url), 'utf8');
const inlineCss = await fs.readFile(new URL('../spiffy/es2-mc2-inline-overrides.css', import.meta.url), 'utf8');
const inlineJs = await fs.readFile(new URL('../spiffy/es2-mc2-inline-checkout.js', import.meta.url), 'utf8');
const validationPatch = await fs.readFile(new URL('../spiffy/es2-mc2-validation-feedback.html', import.meta.url), 'utf8');
const purchaseWebhook = await fs.readFile(new URL('../netlify/functions/spiffy-purchase-webhook.js', import.meta.url), 'utf8');

assert.match(page, /spiffy\.load\(["']sonnycourt["']\)/);
assert.match(page, /pageTakeover:\s*false/);
assert.match(page, /thanksPageTakeover:\s*false/);
assert.match(page, /monthly:\s*'https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-2-2-1-1'/);
assert.match(page, /once:\s*'https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-34-1'/);
assert.doesNotMatch(page, /monthly:\s*'https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-2-2-1'/);
assert.doesNotMatch(page, /once:\s*'https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-34'/);
assert.match(page, /isLocalPreview \? SPIFFY_PREVIEW_CHECKOUT_URLS : SPIFFY_CHECKOUT_URLS/);
assert.match(page, /document\.createElement\(['"]spiffy-checkout['"]\)/);
assert.match(page, /url\.searchParams\.set\(['"]name_first['"],\s*firstName\)/);
assert.match(page, /url\.searchParams\.set\(['"]email['"],\s*email\)/);
assert.match(page, /url\.searchParams\.set\(['"]country['"],\s*country\)/);
assert.doesNotMatch(page, /id="preview-spiffy-first-name"/);
assert.doesNotMatch(page, /id="preview-spiffy-email"/);
assert.doesNotMatch(page, /id="preview-spiffy-country"/);
assert.match(page, /const firstName = String\(reg\.prenom \|\| ''\)\.trim\(\)/);
assert.match(page, /const email = String\(reg\.email \|\| ''\)\.trim\(\)/);
assert.match(page, /const country = String\(reg\.pays \|\| ''\)\.trim\(\)/);
assert.match(page, /url\.searchParams\.set\(['"]es2_plan['"],\s*plan\)/);
assert.match(page, /url\.searchParams\.set\(['"]mc2_token['"],\s*reg\.token\)/);
assert.match(page, /event\.data\?\.type !== ['"]es2:spiffy-height['"]/);
assert.match(page, /event\.data\?\.type === ['"]es2:spiffy-validation-focus['"]/);
assert.match(page, /spiffy\.on\(['"]order:success['"],\s*handleSpiffyOrderSuccess\)/);
assert.match(page, /mc2-spiffy-status\?t=/);
assert.match(page, /status\?\.paid && status\?\.schedule_ready/);
assert.match(page, /id="preview-payment-success"/);
assert.match(page, /id="preview-payment-success-cta"/);
assert.match(page, /Rejoindre mon espace membre/);
assert.match(page, /\/commencer\/succes\/\?provider=spiffy&t=/);
assert.doesNotMatch(page, /window\.location\.(?:assign|replace)\([^)]*commencer\/succes/);

assert.match(inlineCss, /\.checkout\[data-es2-inline="true"\]/);
assert.match(inlineCss, /\.payment-type--paypal/);
assert.match(inlineCss, /\.es2-inline-payment-separator/);
assert.match(inlineCss, /\.es2-inline-plan__row/);
assert.match(inlineCss, /data-es2-duplicate-terms/);
assert.match(inlineJs, /Carte bancaire/);
assert.match(inlineJs, /J’accepte les/);
assert.match(inlineJs, /https:\/\/sonnycourt\.com\/cgv\//);
assert.match(inlineJs, /data-es2-inline-plan/);
assert.match(inlineJs, /paymentSection\.insertAdjacentElement\('afterend', inlinePlan\)/);
assert.match(inlineJs, /12 mensualités de 197 €/);
assert.match(inlineJs, /≈ 6 € par jour/);
assert.doesNotMatch(inlineJs, /Ton plan de paiement/);
assert.match(inlineJs, /Ou choisir PayPal/);
assert.match(inlineJs, /buttonSection\.insertAdjacentElement\('afterend', separator\)/);
assert.match(inlineJs, /separator\.insertAdjacentElement\('afterend', paypalProxy\)/);
assert.match(inlineJs, /if \(source\) source\.click\(\)/);
assert.match(inlineJs, /if \(checkoutButton\) checkoutButton\.click\(\)/);
assert.match(inlineJs, /es2:spiffy-height/);
assert.match(inlineJs, /Renseigne ta carte bancaire\./);
assert.match(inlineJs, /data-es2-toggle-bound/);
assert.match(inlineJs, /data-es2-validation-active/);
assert.match(inlineJs, /StripeElement--complete/);
assert.match(inlineCss, /StripeElement\[data-es2-attention="true"\]/);
assert.match(inlineCss, /data-es2-native-validation/);
assert.match(validationPatch, /Renseigne ta carte bancaire\./);
assert.match(validationPatch, /data-es2-toggle-bound/);
assert.match(validationPatch, /es2:spiffy-validation-focus/);
assert.match(validationPatch, /data-es2-native-validation/);
assert.match(inlineJs, /termsSections\[termsSections\.length - 1\]/);
assert.match(inlineJs, /checkoutRow\.style\.setProperty\('margin-left', '0', 'important'\)/);
assert.match(inlineJs, /root\.getBoundingClientRect\(\)\.bottom/);

assert.match(success, /provider === 'spiffy'/);
assert.match(success, /mc2-spiffy-status/);
assert.match(success, /localStorage\.getItem\('mc2_registration_token'\)/);
assert.match(success, /provider,/);
assert.match(legacySuccess, /commencer\/succes\/\?provider=spiffy/);
assert.match(billing, /provider === 'spiffy'/);
assert.match(billing, /registration\.payment_status !== 'paid'/);
assert.match(purchaseWebhook, /mc2_registrations\?email=eq\./);
assert.match(purchaseWebhook, /payment_status:\s*'paid'/);
assert.match(purchaseWebhook, /statut:\s*'purchased'/);
assert.match(purchaseWebhook, /initial_payment_cents:\s*plan\.initialCents/);
assert.match(purchaseWebhook, /contractual_total_cents:\s*plan\.contractualTotalCents/);
assert.match(purchaseWebhook, /cancelMc2OfferSms/);
assert.match(purchaseWebhook, /cancelMc2ReplayRecoveryJobs/);

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
globalThis.fetch = async () => Response.json([{
  token: 'a'.repeat(32),
  prenom: 'Test',
  telephone: '+41780000000',
  pays: 'CH',
  statut: 'purchased',
  payment_status: 'paid',
  initial_payment_cents: 19700,
  contractual_total_cents: 236400,
}]);
try {
  const response = await statusHandler(new Request(`https://sonnycourt.com/.netlify/functions/mc2-spiffy-status?t=${'a'.repeat(32)}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.paid, true);
  assert.equal(payload.schedule_ready, true);
  assert.equal(payload.amount_total, 19700);
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log(JSON.stringify({
  embedded_spiffy: 'ok',
  monthly_and_once: 'ok',
  mc2_prefill: 'ok',
  post_purchase_address: 'provider_aware',
}, null, 2));
