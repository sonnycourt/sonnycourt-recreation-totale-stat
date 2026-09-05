import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import statusHandler from '../netlify/functions/mc2-spiffy-status.js';

const page = await fs.readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const replay = await fs.readFile(new URL('../src/pages/mc2/replay.astro', import.meta.url), 'utf8');
const offer = await fs.readFile(new URL('../src/components/mc2/DealOffer.astro', import.meta.url), 'utf8');
const success = await fs.readFile(new URL('../src/pages/commencer/succes.astro', import.meta.url), 'utf8');
const legacySuccess = await fs.readFile(new URL('../src/pages/es2-derniere-etape.astro', import.meta.url), 'utf8');
const billing = await fs.readFile(new URL('../netlify/functions/mc2-billing-info.js', import.meta.url), 'utf8');
const checkoutCss = await fs.readFile(new URL('../spiffy/es2-checkout-theme.css', import.meta.url), 'utf8');
const inlineJs = await fs.readFile(new URL('../spiffy/es2-mc2-inline-checkout.js', import.meta.url), 'utf8');
const validationPatch = await fs.readFile(new URL('../spiffy/es2-mc2-validation-feedback.html', import.meta.url), 'utf8');
const purchaseWebhook = await fs.readFile(new URL('../netlify/functions/spiffy-purchase-webhook.js', import.meta.url), 'utf8');

// La page session consomme l'offre approuvée, qui possède désormais tout le checkout.
assert.match(page, /import DealOffer from ['"]\.\.\/\.\.\/components\/mc2\/DealOffer\.astro['"]/);
assert.match(page, /<DealOffer\s*\/>/);
assert.match(replay, /<DealOffer\s+checkoutEmbedMode=["']iframe["']\s*\/>/);

// Les deux checkouts réels sont intégrés, avec le comptant présélectionné.
assert.match(offer, /spiffy\.load\(["']sonnycourt["']\)/);
assert.match(offer, /data-monthly-checkout="https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-2-2-1-1"/);
assert.match(offer, /data-once-checkout="https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-34-1"/);
assert.match(offer, /data-payment-plan="once" aria-pressed="true"/);
assert.match(offer, /data-payment-plan="three" aria-pressed="false"/);
assert.match(offer, /Versement unique/);
assert.match(offer, /Versement en 3 fois/);
assert.match(offer, /3 × 767 €/);
assert.match(offer, /let activePlan = 'once'/);
assert.match(offer, /const planPanels = new Map\(\)/);
assert.match(offer, /Object\.keys\(plans\)\.map\(createPlanPanel\)/);
assert.match(offer, /panel\.hidden = !selected/);
assert.doesNotMatch(offer, /replaceCheckoutChildren/);
assert.ok(
  offer.indexOf("window.spiffy.load('sonnycourt')") > offer.indexOf('Object.keys(plans).map(createPlanPanel)'),
  'Spiffy doit être chargé seulement après le montage des deux formulaires',
);
assert.match(offer, /document\.createElement\(['"]spiffy-checkout['"]\)/);
assert.match(offer, /document\.createElement\(['"]iframe['"]\)/);
assert.match(offer, /data-checkout-embed-mode=\{checkoutEmbedMode\}/);
assert.match(offer, /slot\.dataset\.checkoutEmbedMode === ['"]iframe['"]/);
assert.match(offer, /if \(useDirectIframe\)/);
assert.match(offer, /if \(!useDirectIframe && window\.spiffy\?\.load\)/);
assert.match(offer, /frame\.setAttribute\(['"]allow['"], ['"]payment['"]\)/);
assert.match(offer, /url\.searchParams\.set\(['"]mc2_token['"], mc2Token\)/);
assert.doesNotMatch(offer, /url\.searchParams\.set\(['"]name_first['"]/);
assert.doesNotMatch(offer, /url\.searchParams\.set\(['"]email['"]/);
assert.match(offer, /payload\.event !== 'form:size' && payload\.type !== 'es2:spiffy-height'/);
assert.doesNotMatch(offer, /spiffy\.on\(['"]order:success['"]\)/);
assert.doesNotMatch(offer, /window\.location\.assign\(/);

// Les ajustements Spiffy conservent le thème clair et la validation en français.
assert.match(checkoutCss, /background:\s*#f7f9fc !important/);
assert.match(checkoutCss, /\.StripeElement iframe\[name\^="__privateStripeFrame"\][\s\S]*filter: none !important/);
assert.match(checkoutCss, /Le prénom est requis\./);
assert.match(checkoutCss, /Renseigne une adresse e-mail valide\./);
assert.match(inlineJs, /Carte bancaire/);
assert.match(inlineJs, /J’accepte les/);
assert.match(inlineJs, /https:\/\/sonnycourt\.com\/cgv\//);
assert.match(inlineJs, /Ou choisir PayPal/);
assert.match(inlineJs, /Renseigne ta carte bancaire\./);
assert.match(validationPatch, /Renseigne ta carte bancaire\./);
assert.match(validationPatch, /es2:spiffy-validation-focus/);

// Le retour d'achat et le statut fournisseur restent pilotés côté serveur.
assert.match(success, /provider === 'spiffy'/);
assert.match(success, /mc2-spiffy-status/);
assert.match(success, /localStorage\.getItem\('mc2_registration_token'\)/);
assert.match(success, /PAYMENT_STATUS_MAX_ATTEMPTS = 15/);
assert.match(success, /PAYMENT_STATUS_RETRY_MS = 2000/);
assert.match(success, /attempt < PAYMENT_STATUS_MAX_ATTEMPTS - 1/);
assert.doesNotMatch(success, /if \(!data\.paid\) throw/);
assert.match(legacySuccess, /commencer\/succes\/\?provider=spiffy/);
assert.match(billing, /provider === 'spiffy'/);
assert.match(billing, /registration\.payment_status !== 'paid'/);
assert.match(purchaseWebhook, /monthly: \{ initialCents: 76_700, contractualTotalCents: 230_100, paymentMode: 'spiffy_3x767' \}/);
assert.match(purchaseWebhook, /payment_status:\s*'paid'/);
assert.match(purchaseWebhook, /statut:\s*'purchased'/);
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
  initial_payment_cents: 76700,
  contractual_total_cents: 230100,
}]);
try {
  const response = await statusHandler(new Request(`https://sonnycourt.com/.netlify/functions/mc2-spiffy-status?t=${'a'.repeat(32)}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.paid, true);
  assert.equal(payload.schedule_ready, true);
  assert.equal(payload.amount_total, 76700);
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log(JSON.stringify({
  embedded_spiffy: 'ok',
  three_times_and_once: 'ok',
  customer_fields_provider_hosted: 'ok',
  post_purchase_address: 'provider_aware',
}, null, 2));
