import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const checkout = await fs.readFile(new URL('../src/pages/commencer.astro', import.meta.url), 'utf8');
const success = await fs.readFile(new URL('../src/pages/commencer/succes.astro', import.meta.url), 'utf8');
const tracker = await fs.readFile(new URL('../netlify/functions/track-mc2-event.js', import.meta.url), 'utf8');
const status = await fs.readFile(new URL('../netlify/functions/mc2-stripe-status.js', import.meta.url), 'utf8');

for (const event of [
  'checkout_viewed',
  'stripe_element_ready',
  'payment_details_started',
  'payment_details_completed',
  'terms_accepted',
  'payment_confirmation_started',
  'payment_authentication_outcome',
  'payment_error',
  'checkout_abandoned',
]) {
  assert.ok(checkout.includes(`'${event}'`) || success.includes(`'${event}'`), `Événement frontal manquant : ${event}`);
  assert.ok(tracker.includes(`'${event}'`), `Événement serveur non autorisé : ${event}`);
}

assert.match(checkout, /paymentElement\.on\(['"]ready['"]/);
assert.match(checkout, /paymentElement\.on\(['"]focus['"]/);
assert.match(checkout, /paymentElement\.on\(['"]change['"],[\s\S]*event\?\.empty\s*===\s*false[\s\S]*event\?\.complete/);
assert.match(checkout, /checkbox\?\.addEventListener\(['"]change['"][\s\S]*terms_accepted/);
assert.match(checkout, /paymentConfirmationStarted\s*=\s*true[\s\S]*stripeCheckout\.confirm/);
assert.match(checkout, /addEventListener\(['"]pagehide['"][\s\S]*navigator\.sendBeacon/);
assert.match(checkout, /fetch\(['"]\/\.netlify\/functions\/track-mc2-event['"][\s\S]*\.catch\(\(\)\s*=>\s*\{\}\)/);

assert.match(status, /expand:\s*\[['"]payment_intent\.latest_charge['"]\]/);
assert.match(status, /payment_method_details\?\.card\?\.three_d_secure/);
assert.match(status, /authentication:\s*paymentAuthentication\(session\)/);
assert.match(success, /trackAuthentication\(data\.authentication\)/);

const sanitizer = tracker.slice(
  tracker.indexOf('function sanitizeMeta'),
  tracker.indexOf('function dedupeKey'),
);
assert.doesNotMatch(sanitizer, /card_number|cardholder|\bcvc\b|\blast4\b|\bemail\b|first_name|last_name|\bphone\b/i);
for (const safeField of [
  'error_type',
  'error_code',
  'decline_code',
  'intent_status',
  'authentication_result',
  'last_stage',
]) assert.ok(sanitizer.includes(safeField), `Métadonnée sûre absente : ${safeField}`);
assert.ok(sanitizer.includes('payment_details_started'), 'État de saisie absent de l’abandon');

const safeError = checkout.slice(
  checkout.indexOf('function safePaymentErrorMeta'),
  checkout.indexOf('function trackAuthentication'),
);
assert.doesNotMatch(safeError, /\.message|card_number|cardholder|\bcvc\b|\blast4\b|\bemail\b/i);

console.log(JSON.stringify({
  checkout_observability: 'non_blocking',
  card_data_collected: false,
  pii_collected: false,
  authentication_observed: 'safe_3ds_outcome_only',
  storage: 'mc2_funnel_events_existing_table',
}, null, 2));
