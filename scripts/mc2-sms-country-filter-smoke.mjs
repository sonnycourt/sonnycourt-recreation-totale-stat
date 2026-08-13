import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_MC2_SMS_ALLOWED_COUNTRIES,
  assertMc2SmsCountryDecision,
  estimateMc2SmsSegments,
  evaluateMc2SmsCountry,
  mc2CountryFromPhone,
  mc2SmsAllowedCountries,
  normalizeMc2CountryIso2,
  resolveMc2SmsCountry,
} from '../netlify/functions/lib/mc2-sms-country-filter.mjs';

assert.equal(normalizeMc2CountryIso2('Suisse'), 'CH');
assert.equal(normalizeMc2CountryIso2("Côte d'Ivoire"), 'CI');
assert.equal(normalizeMc2CountryIso2('Belgium'), 'BE');
assert.equal(normalizeMc2CountryIso2('inconnu'), '');

assert.deepEqual([...mc2SmsAllowedCountries({})], [...DEFAULT_MC2_SMS_ALLOWED_COUNTRIES]);
assert.equal(mc2CountryFromPhone('+41789482376').countryCode, 'CH');
assert.equal(mc2CountryFromPhone('+12025550123').countryCode, '');
assert.equal(mc2CountryFromPhone('+12025550123').detail, 'phone_prefix_ambiguous_nanp');

const enabled = { MC2_SMS_COUNTRY_FILTER_ENABLED: 'true' };
assert.equal(evaluateMc2SmsCountry({ resolved: { countryCode: 'FR' }, env: enabled }).eligible, true);
assert.equal(evaluateMc2SmsCountry({ resolved: { countryCode: 'MA' }, env: enabled }).reasonCode, 'sms_country_not_allowed');
assert.equal(evaluateMc2SmsCountry({ resolved: {}, env: enabled }).reasonCode, 'sms_country_unknown');
assert.equal(evaluateMc2SmsCountry({ resolved: { countryCode: 'MA' }, env: {} }).eligible, true);

assert.throws(
  () => assertMc2SmsCountryDecision(null, enabled),
  /sms_country_decision_missing/,
);
assert.doesNotThrow(() => assertMc2SmsCountryDecision(null, {}));

const billingWins = await resolveMc2SmsCountry({
  registration: { billing_country: 'BE', pays: 'France', telephone: '+41789482376' },
  stripeFactory: () => { throw new Error('Stripe ne doit pas être appelé'); },
});
assert.equal(billingWins.countryCode, 'BE');
assert.equal(billingWins.source, 'supabase_post_purchase');

const stripeWins = await resolveMc2SmsCountry({
  registration: { stripe_customer_id: 'cus_test', pays: 'France', telephone: '+41789482376' },
  stripeFactory: () => ({
    customers: { retrieve: async () => ({ id: 'cus_test', address: { country: 'CH' } }) },
    checkout: { sessions: { retrieve: async () => ({}) } },
  }),
});
assert.equal(stripeWins.countryCode, 'CH');
assert.equal(stripeWins.detail, 'customer_billing');

const selectedWins = await resolveMc2SmsCountry({
  registration: { pays: 'Canada', telephone: '+352621123456' },
  stripeFactory: () => { throw new Error('Stripe ne doit pas être appelé'); },
});
assert.equal(selectedWins.countryCode, 'CA');
assert.equal(selectedWins.source, 'supabase_registration');

const phoneFallback = await resolveMc2SmsCountry({
  registration: { telephone: '+352621123456' },
  stripeFactory: () => { throw new Error('Stripe ne doit pas être appelé'); },
});
assert.equal(phoneFallback.countryCode, 'LU');
assert.equal(phoneFallback.source, 'phone_prefix');

assert.equal(estimateMc2SmsSegments('Message court'), 1);
assert.equal(estimateMc2SmsSegments('é'.repeat(80)), 1);
assert.ok(estimateMc2SmsSegments('🙂'.repeat(80)) >= 2);

const smsSource = fs.readFileSync(
  new URL('../netlify/functions/lib/mc2-sms.mjs', import.meta.url),
  'utf8',
);
assert.match(smsSource, /resolveMc2SmsCountry/);
assert.match(smsSource, /sms_country_filtered/);
assert.ok(
  smsSource.indexOf('resolveMc2SmsCountry({ registration, phone })')
    < smsSource.indexOf('const provider = await sendGatewaySms'),
  'Le filtre pays doit s’exécuter avant GatewayAPI',
);

console.log('MC2 SMS country filter smoke: OK');
