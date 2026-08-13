import { mc2Stripe } from './mc2-stripe.mjs';

export const DEFAULT_MC2_SMS_ALLOWED_COUNTRIES = Object.freeze([
  'FR',
  'CH',
  'BE',
  'CA',
  'LU',
  'MC',
]);

const COUNTRY_ALIASES = Object.freeze({
  FR: 'FR', FRANCE: 'FR',
  CH: 'CH', SUISSE: 'CH', SWITZERLAND: 'CH', SCHWEIZ: 'CH', SVIZZERA: 'CH',
  BE: 'BE', BELGIQUE: 'BE', BELGIUM: 'BE', BELGIE: 'BE',
  CA: 'CA', CANADA: 'CA',
  LU: 'LU', LUXEMBOURG: 'LU',
  MC: 'MC', MONACO: 'MC',
  MA: 'MA', MAROC: 'MA', MOROCCO: 'MA',
  SN: 'SN', SENEGAL: 'SN',
  CI: 'CI', COTE_D_IVOIRE: 'CI', IVORY_COAST: 'CI',
  DZ: 'DZ', ALGERIE: 'DZ', ALGERIA: 'DZ',
  TN: 'TN', TUNISIE: 'TN', TUNISIA: 'TN',
  US: 'US', ETATS_UNIS: 'US', UNITED_STATES: 'US', USA: 'US',
  GB: 'GB', ROYAUME_UNI: 'GB', UNITED_KINGDOM: 'GB', UK: 'GB',
  DE: 'DE', ALLEMAGNE: 'DE', GERMANY: 'DE',
  AT: 'AT', AUTRICHE: 'AT', AUSTRIA: 'AT',
  NL: 'NL', PAYS_BAS: 'NL', NETHERLANDS: 'NL',
  ES: 'ES', ESPAGNE: 'ES', SPAIN: 'ES',
  IT: 'IT', ITALIE: 'IT', ITALY: 'IT',
  PT: 'PT', PORTUGAL: 'PT',
  IE: 'IE', IRLANDE: 'IE', IRELAND: 'IE',
  AU: 'AU', AUSTRALIE: 'AU', AUSTRALIA: 'AU',
  NZ: 'NZ', NOUVELLE_ZELANDE: 'NZ', NEW_ZEALAND: 'NZ',
});

const PHONE_PREFIX_COUNTRIES = Object.freeze([
  ['+352', 'LU'],
  ['+377', 'MC'],
  ['+212', 'MA'],
  ['+221', 'SN'],
  ['+225', 'CI'],
  ['+213', 'DZ'],
  ['+216', 'TN'],
  ['+33', 'FR'],
  ['+41', 'CH'],
  ['+32', 'BE'],
  ['+44', 'GB'],
  ['+49', 'DE'],
  ['+43', 'AT'],
  ['+31', 'NL'],
  ['+34', 'ES'],
  ['+39', 'IT'],
  ['+351', 'PT'],
  ['+353', 'IE'],
  ['+61', 'AU'],
  ['+64', 'NZ'],
]);

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizedCountryKey(value) {
  return clean(value, 100)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeMc2CountryIso2(value) {
  const key = normalizedCountryKey(value);
  if (!key) return '';
  return COUNTRY_ALIASES[key] || (/^[A-Z]{2}$/.test(key) ? key : '');
}

export function mc2SmsCountryFilterEnabled(env = process.env) {
  return clean(env.MC2_SMS_COUNTRY_FILTER_ENABLED, 10).toLowerCase() === 'true';
}

export function mc2SmsAllowedCountries(env = process.env) {
  const configured = clean(env.MC2_SMS_ALLOWED_COUNTRIES, 1_000);
  const values = configured ? configured.split(',') : DEFAULT_MC2_SMS_ALLOWED_COUNTRIES;
  return new Set(values.map(normalizeMc2CountryIso2).filter(Boolean));
}

export function mc2CountryFromPhone(phone) {
  let normalized = clean(phone, 40).replace(/[^\d+]/g, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  if (!normalized.startsWith('+')) {
    return { countryCode: '', source: 'phone_prefix', detail: 'phone_not_e164' };
  }
  // +1 couvre plusieurs pays NANP : sans une donnée d'adresse, on refuse de
  // deviner Canada ou États-Unis et le filtre reste volontairement fail-closed.
  if (normalized.startsWith('+1')) {
    return { countryCode: '', source: 'phone_prefix', detail: 'phone_prefix_ambiguous_nanp' };
  }
  const match = PHONE_PREFIX_COUNTRIES.find(([prefix]) => normalized.startsWith(prefix));
  return match
    ? { countryCode: match[1], source: 'phone_prefix', detail: match[0] }
    : { countryCode: '', source: 'phone_prefix', detail: 'phone_prefix_unknown' };
}

function registrationBillingCountry(registration = {}) {
  const candidates = [
    ['billing_country_code', registration.billing_country_code],
    ['billing_country', registration.billing_country],
    ['address_country', registration.address_country],
    ['shipping_country', registration.shipping_country],
  ];
  for (const [field, value] of candidates) {
    const countryCode = normalizeMc2CountryIso2(value);
    if (countryCode) return { countryCode, source: 'supabase_post_purchase', detail: field };
  }
  return null;
}

async function stripeCountry(registration = {}, stripeFactory = mc2Stripe) {
  const customerId = clean(registration.stripe_customer_id, 100);
  const checkoutSessionId = clean(registration.stripe_checkout_session_id, 100);
  if (!customerId && !checkoutSessionId) return null;

  const stripe = stripeFactory();
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !customer.deleted) {
      const billing = normalizeMc2CountryIso2(customer.address?.country);
      if (billing) return { countryCode: billing, source: 'stripe', detail: 'customer_billing' };
      const shipping = normalizeMc2CountryIso2(customer.shipping?.address?.country);
      if (shipping) return { countryCode: shipping, source: 'stripe', detail: 'customer_shipping' };
    }
  }

  if (checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const billing = normalizeMc2CountryIso2(session.customer_details?.address?.country);
    if (billing) return { countryCode: billing, source: 'stripe', detail: 'checkout_billing' };
    const shipping = normalizeMc2CountryIso2(session.shipping_details?.address?.country);
    if (shipping) return { countryCode: shipping, source: 'stripe', detail: 'checkout_shipping' };
  }
  return null;
}

export async function resolveMc2SmsCountry({ registration = {}, phone = '', stripeFactory = mc2Stripe } = {}) {
  const postPurchase = registrationBillingCountry(registration);
  if (postPurchase) return postPurchase;

  try {
    const fromStripe = await stripeCountry(registration, stripeFactory);
    if (fromStripe) return fromStripe;
  } catch (error) {
    // Une panne Stripe ne doit jamais autoriser un SMS. On poursuit uniquement
    // vers les sources locales explicites puis on bloque si le pays reste inconnu.
    console.warn('MC2 SMS country Stripe lookup failed:', clean(error?.message || 'stripe_lookup_failed', 160));
  }

  const selected = normalizeMc2CountryIso2(registration.pays || registration.country_code);
  if (selected) return { countryCode: selected, source: 'supabase_registration', detail: 'pays' };

  return mc2CountryFromPhone(phone || registration.telephone);
}

export function evaluateMc2SmsCountry({ resolved, env = process.env } = {}) {
  if (!mc2SmsCountryFilterEnabled(env)) {
    return {
      enforced: false,
      eligible: true,
      reasonCode: 'sms_country_filter_disabled',
      countryCode: resolved?.countryCode || '',
      countrySource: resolved?.source || '',
      countryDetail: resolved?.detail || '',
    };
  }

  const countryCode = normalizeMc2CountryIso2(resolved?.countryCode);
  const base = {
    enforced: true,
    countryCode,
    countrySource: clean(resolved?.source, 80),
    countryDetail: clean(resolved?.detail, 120),
  };
  if (!countryCode) {
    return { ...base, eligible: false, reasonCode: 'sms_country_unknown' };
  }
  if (!mc2SmsAllowedCountries(env).has(countryCode)) {
    return { ...base, eligible: false, reasonCode: 'sms_country_not_allowed' };
  }
  return { ...base, eligible: true, reasonCode: 'sms_country_allowed' };
}

export function assertMc2SmsCountryDecision(decision, env = process.env) {
  if (!mc2SmsCountryFilterEnabled(env)) return;
  if (!decision || decision.enforced !== true) throw new Error('sms_country_decision_missing');
  if (decision.eligible !== true) throw new Error(decision.reasonCode || 'sms_country_not_eligible');
}

const GSM_BASIC = new Set(Array.from(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
));
const GSM_EXTENDED = new Set(Array.from('^{}\\[~]|€'));

export function estimateMc2SmsSegments(message) {
  const chars = Array.from(clean(message, 10_000));
  let gsmUnits = 0;
  let gsm = true;
  for (const char of chars) {
    if (GSM_BASIC.has(char)) gsmUnits += 1;
    else if (GSM_EXTENDED.has(char)) gsmUnits += 2;
    else { gsm = false; break; }
  }
  if (gsm) return Math.max(1, Math.ceil(gsmUnits / (gsmUnits <= 160 ? 160 : 153)));
  return Math.max(1, Math.ceil(chars.length / (chars.length <= 70 ? 70 : 67)));
}

export function mc2SmsAvoidedCost(message, env = process.env) {
  const segments = estimateMc2SmsSegments(message);
  const unitCost = Number.parseFloat(clean(env.MC2_SMS_ESTIMATED_SEGMENT_COST_EUR, 40));
  return {
    estimatedSegmentsAvoided: segments,
    estimatedCostAvoidedEur: Number.isFinite(unitCost) && unitCost >= 0
      ? Number((segments * unitCost).toFixed(6))
      : null,
  };
}
